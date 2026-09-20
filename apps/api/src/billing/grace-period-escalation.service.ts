import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { runWithAdvisoryLock } from "../common/scheduling/advisory-lock";
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
const ESCALATION_INITIAL_DELAY_MS = 3 * 60 * 1000;  // 3 minutes after boot
const ESCALATION_ACTOR = "system:grace-escalation";
const SUSPENSION_REASON = "grace_period_expired";

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
    }, ESCALATION_INITIAL_DELAY_MS);
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

  async runEscalation(): Promise<void> {
    try {
      await this.escalateExpiredGracePeriods();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown");
      this.logger.error(`Grace-period escalation run failed: ${message}`);
    }
  }

  private async runScheduledEscalation(): Promise<void> {
    let ran = false;
    try {
      ran = await runWithAdvisoryLock("grace-period-escalation", () => this.runEscalation());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown");
      this.logger.error(`Scheduler lock failure for grace-period-escalation: ${message}`);
      return;
    }
    if (!ran) {
      this.logger.debug("Skipped grace-period escalation: another replica holds the scheduler lock.");
    }
  }

  private async escalateExpiredGracePeriods(): Promise<void> {
    const now = new Date();

    // Find tenants whose grace period has expired but are not yet suspended.
    // RLS-BYPASS: intentional cross-tenant scan — scheduled job, no per-request tenant
    // context, deliberately scans every tenant's TenantPlanProfile (no tenant_key filter)
    // to find and escalate ALL expired grace periods system-wide, same pattern as
    // commercial-reminders.service.ts's trial-ending scan.
    const rows = await this.prisma.tenant().$queryRaw<GraceExpiredRow[]>(Prisma.sql`
      SELECT "tenantKey", "graceEndsAt", "billingContactEmail"
      FROM "TenantPlanProfile"
      WHERE "billingStatus" = 'past_due'
        AND "accessStatus" = 'active'
        AND "graceEndsAt" IS NOT NULL
        AND "graceEndsAt" < ${now}
    `);

    if (rows.length === 0) {
      return;
    }

    this.logger.log(`Grace-period escalation: ${rows.length} tenant(s) with expired grace period found.`);

    let suspended = 0;
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
        const message = error instanceof Error ? error.message : String(error ?? "unknown");
        this.logger.warn(`Failed to suspend tenant ${row.tenantKey}: ${message}`);
      }
    }

    this.logger.log(`Grace-period escalation complete: ${suspended}/${rows.length} tenants suspended.`);
  }

  private isEnabled(): boolean {
    const workerEnabled = String(process.env.QUEUE_WORKER_ENABLED ?? "true").trim().toLowerCase();
    return workerEnabled === "true";
  }
}
