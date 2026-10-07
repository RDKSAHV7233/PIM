import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { runWithAdvisoryLock } from "../common/scheduling/advisory-lock";
import { discoverAcrossTenants, type TenantIterationOverall, type TenantIterationSummary } from "../common/tenant/tenant-iteration";
import { PrismaService } from "../prisma/prisma.service";
import { CommercialNotificationsService } from "./commercial-notifications.service";
import { PlanUsageService } from "./plan-usage.service";

/**
 * Grace-period escalation service.
 *
 * When a Stripe invoice.payment_failed webhook fires, the Stripe webhook
 * controller sets `billingStatus = 'past_due'` and `graceEndsAt` (7 days out).
 * This service runs on a timer and auto-suspends tenants whose grace period
 * has expired, ensuring unpaid tenants don't retain access indefinitely.
 *
 * Follows the same lifecycle pattern as CommercialRemindersService:
 * - Gated by QUEUE_WORKER_ENABLED (runs on the worker process only)
 * - Initial delay to let the app boot cleanly before hitting the DB
 * - setInterval with .unref() so the timer doesn't prevent process exit
 */

const ESCALATION_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DEFAULT_ESCALATION_INITIAL_DELAY_MS = 3 * 60 * 1000;  // 3 minutes after boot

/** GRACE_PERIOD_ESCALATION_INITIAL_DELAY_MS lets tests and operators shorten the boot delay; anything invalid keeps the default. */
function resolveInitialDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(String(env.GRACE_PERIOD_ESCALATION_INITIAL_DELAY_MS ?? "").trim());
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_ESCALATION_INITIAL_DELAY_MS;
}
const ESCALATION_ACTOR = "system:grace-escalation";
const SUSPENSION_REASON = "grace_period_expired";

export interface GraceEscalationResult {
  /** Tenants found with an expired grace period (across every tenant that could be read). */
  discovered: number;
  suspended: number;
  /** Tenants found but not suspended: each is a billing-enforcement gap. */
  failed: number;
  /** SUCCESS only when every tenant could be read and every discovered tenant was suspended. */
  status: TenantIterationOverall;
  discovery: TenantIterationSummary;
}

interface GraceExpiredRow {
  tenantKey: string;
  graceEndsAt: Date | string;
  billingContactEmail: string | null;
}

@Injectable()
export class GracePeriodEscalationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GracePeriodEscalationService.name);
  private initialTimeout: NodeJS.Timeout | null = null;
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly planUsageService: PlanUsageService,
    private readonly commercialNotificationsService: CommercialNotificationsService,
    private readonly auditService: AuditService,
  ) {}

  onModuleInit(): void {
    if (!this.isEnabled()) {
      return;
    }
    this.logger.log("Grace-period escalation timer scheduled (6-hour interval).");
    this.initialTimeout = setTimeout(() => {
      void this.runScheduledEscalation();
      this.intervalHandle = setInterval(() => void this.runScheduledEscalation(), ESCALATION_INTERVAL_MS);
      this.intervalHandle.unref();
    }, resolveInitialDelayMs());
    this.initialTimeout.unref();
  }

  onModuleDestroy(): void {
    if (this.initialTimeout) {
      clearTimeout(this.initialTimeout);
      this.initialTimeout = null;
    }
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Runs one escalation pass. Resolves with what it found and did, so a caller (and a test) can prove the job actually discovered and
   * acted on the tenants it should have, not merely that it did not throw. A failure of the whole pass is logged and resolves to
   * undefined, as before: the scheduler must never crash the process.
   */
  async runEscalation(): Promise<GraceEscalationResult | undefined> {
    try {
      return await this.escalateExpiredGracePeriods();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown");
      this.logger.error(`Grace-period escalation run failed: ${message}`);
      return undefined;
    }
  }

  private async runScheduledEscalation(): Promise<void> {
    let ran = false;
    try {
      ran = await runWithAdvisoryLock("grace-period-escalation", async () => {
        await this.runEscalation();
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown");
      this.logger.error(`Scheduler lock failure for grace-period-escalation: ${message}`);
      return;
    }
    if (!ran) {
      this.logger.debug("Skipped grace-period escalation: another replica holds the scheduler lock.");
    }
  }

  private async escalateExpiredGracePeriods(): Promise<GraceEscalationResult> {
    const now = new Date();

    // Find tenants whose grace period has expired but are not yet suspended.
    //
    // SEC-DB-RLS-001: this used to be ONE scan through `this.prisma.tenant()` (no argument), which under row level security sees
    // only the default tenant, so billing enforcement would have covered one tenant and silently skipped every other. It now
    // discovers per tenant, inside that tenant's own transaction (discoverAcrossTenants), and the query ALSO filters by the tenant
    // it is given, so it is correct whether or not the runtime role bypasses RLS. The suspension itself is unchanged and runs
    // through the services below, which carry their own tenant client.
    const discovery = await discoverAcrossTenants<GraceExpiredRow>(this.prisma.tenant(), async (tx, tenantKey) => {
      // RLS-BYPASS: manual tenant filter — WHERE "tenantKey" = ${tenantKey} below, on a transaction whose tenant context is that tenant.
      return tx.$queryRaw<GraceExpiredRow[]>(Prisma.sql`
        SELECT "tenantKey", "graceEndsAt", "billingContactEmail"
        FROM "TenantPlanProfile"
        WHERE "tenantKey" = ${tenantKey}
          AND "billingStatus" = 'past_due'
          AND "accessStatus" = 'active'
          AND "graceEndsAt" IS NOT NULL
          AND "graceEndsAt" < ${now}
      `);
    });
    const rows = discovery.rows;

    if (discovery.summary.tenantsFailed > 0) {
      // A tenant we could not read is a tenant whose expired grace period we may have missed: never silent.
      this.logger.error(
        `Grace-period escalation could not check ${discovery.summary.tenantsFailed}/${discovery.summary.tenantsEvaluated} tenant(s); their grace periods were NOT evaluated this run.`,
      );
    }

    if (rows.length === 0) {
      return { discovered: 0, suspended: 0, failed: 0, status: discovery.summary.overall, discovery: discovery.summary };
    }

    this.logger.log(`Grace-period escalation: ${rows.length} tenant(s) with expired grace period found.`);

    let suspended = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const profile = await this.planUsageService.updateCommercialStateForTenant(
          row.tenantKey,
          {
            accessStatus: "suspended",
            suspendedAt: now.toISOString(),
            suspensionReason: SUSPENSION_REASON,
          },
          ESCALATION_ACTOR,
        );

        // Notify tenant admins about the suspension.
        await this.commercialNotificationsService.notifyTenantAdmins({
          tenantKey: row.tenantKey,
          event: "tenant_access_suspended",
          profile,
        });

        // Record in audit log for governance trail.
        await this.auditService.record({
          actorId: ESCALATION_ACTOR,
          actorRole: "admin",
          action: "TENANT_SUSPENDED_GRACE_EXPIRED",
          resource: "TenantPlanProfile",
          resourceId: row.tenantKey,
          tenantKey: row.tenantKey,
          metadata: {
            reason: SUSPENSION_REASON,
            graceEndsAt: String(row.graceEndsAt),
            suspendedAt: now.toISOString(),
          },
        });

        suspended++;
        this.logger.log(
          `Tenant suspended: tenantKey=${row.tenantKey} graceEndsAt=${String(row.graceEndsAt)} reason=${SUSPENSION_REASON}`,
        );
      } catch (error: unknown) {
        failed++;
        const message = error instanceof Error ? error.message : String(error ?? "unknown");
        // An unpaid tenant that was NOT suspended is a billing-enforcement gap: an error, not a warning.
        this.logger.error(`Failed to suspend tenant ${row.tenantKey}: ${message}`);
      }
    }

    this.logger.log(`Grace-period escalation complete: ${suspended}/${rows.length} tenants suspended.`);
    const status = failed > 0 && discovery.summary.overall === "SUCCESS" ? "PARTIAL_FAILURE" : discovery.summary.overall;
    return { discovered: rows.length, suspended, failed, status, discovery: discovery.summary };
  }

  private isEnabled(): boolean {
    const workerEnabled = String(process.env.QUEUE_WORKER_ENABLED ?? "true").trim().toLowerCase();
    return workerEnabled === "true";
  }
}
