import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { runWithAdvisoryLock } from "../common/scheduling/advisory-lock";
import { discoverAcrossTenants, type TenantIterationOverall, type TenantIterationSummary } from "../common/tenant/tenant-iteration";
import { PrismaService } from "../prisma/prisma.service";
import { CommercialNotificationsService } from "./commercial-notifications.service";
import { PlanUsageService, type PlanProfileSummary } from "./plan-usage.service";

const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_REMINDER_INITIAL_DELAY_MS = 5 * 60 * 1000;  // 5 minutes after boot

/** COMMERCIAL_REMINDERS_INITIAL_DELAY_MS lets tests and operators shorten the boot delay; anything invalid keeps the default. */
function resolveInitialDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(String(env.COMMERCIAL_REMINDERS_INITIAL_DELAY_MS ?? "").trim());
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_REMINDER_INITIAL_DELAY_MS;
}
const TRIAL_WARNING_DAYS = [7, 1]; // email reminder thresholds
const TRIAL_NOTIFICATION_DAYS = [7, 2]; // in-app UserNotification thresholds

export interface TrialReminderResult {
  /** Tenants whose trial ends within the window (across every tenant that could be read). */
  discovered: number;
  /** Of those, the tenants that hit a reminder threshold today. */
  eligible: number;
  /** Tenants that actually had a reminder action performed (email sent or in-app notification created). */
  acted: number;
  emailsSent: number;
  /** Eligible tenants whose reminder failed: each is a missed reminder. */
  failed: number;
  /** SUCCESS only when every tenant could be read and no eligible tenant's reminder failed. */
  status: TenantIterationOverall;
  discovery: TenantIterationSummary;
}

interface TrialReminderRow {
  tenantKey: string;
  trialEndsAt: Date | string;
  billingContactEmail: string | null;
}

@Injectable()
export class CommercialRemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommercialRemindersService.name);
  private initialTimeout: NodeJS.Timeout | null = null;
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly planUsageService: PlanUsageService,
    private readonly commercialNotificationsService: CommercialNotificationsService,
  ) {}

  onModuleInit(): void {
    if (!this.isEnabled()) {
      return;
    }
    this.initialTimeout = setTimeout(() => {
      void this.runScheduledReminders();
      this.intervalHandle = setInterval(() => void this.runScheduledReminders(), REMINDER_INTERVAL_MS);
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

  async runReminders(): Promise<void> {
    try {
      await this.sendTrialEndingReminders();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown");
      this.logger.error(`Commercial reminders run failed: ${message}`);
    }
  }

  private async runScheduledReminders(): Promise<void> {
    let ran = false;
    try {
      ran = await runWithAdvisoryLock("commercial-reminders", () => this.runReminders());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown");
      this.logger.error(`Scheduler lock failure for commercial-reminders: ${message}`);
      return;
    }
    if (!ran) {
      this.logger.debug("Skipped commercial reminders: another replica holds the scheduler lock.");
    }
  }

  private async sendTrialEndingReminders(): Promise<TrialReminderResult> {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);

    // SEC-DB-RLS-001: this used to be ONE scan through `this.prisma.tenant()` (no argument), which under row level security sees only
    // the default tenant, so trial-ending reminders would have gone to one tenant and silently skipped every other. It now
    // discovers per tenant, inside that tenant's own transaction (discoverAcrossTenants), and the query ALSO filters by the tenant it
    // is given, so it is correct whether or not the runtime role bypasses RLS. Sending is unchanged and goes through the services
    // below, which carry their own tenant client.
    const discovery = await discoverAcrossTenants<TrialReminderRow>(this.prisma.tenant(), async (tx, tenantKey) => {
      // RLS-BYPASS: manual tenant filter — WHERE "tenantKey" = ${tenantKey} below, on a transaction whose tenant context is that tenant.
      return tx.$queryRaw<TrialReminderRow[]>(Prisma.sql`
        SELECT "tenantKey", "trialEndsAt", "billingContactEmail"
        FROM "TenantPlanProfile"
        WHERE "tenantKey" = ${tenantKey}
          AND "billingStatus" = 'trial'
          AND "accessStatus" = 'active'
          AND "trialEndsAt" IS NOT NULL
          AND "trialEndsAt" > ${now}
          AND "trialEndsAt" <= ${windowEnd}
      `);
    });
    const rows = discovery.rows;

    if (discovery.summary.tenantsFailed > 0) {
      // A tenant we could not read is a tenant whose reminder we may have missed: never silent.
      this.logger.error(
        `Trial ending reminders could not check ${discovery.summary.tenantsFailed}/${discovery.summary.tenantsEvaluated} tenant(s); their reminders were NOT evaluated this run.`,
      );
    }

    let sent = 0;
    let eligible = 0;
    let acted = 0;
    let failed = 0;
    for (const row of rows) {
      const trialEndsAt = new Date(row.trialEndsAt);
      const msRemaining = trialEndsAt.getTime() - now.getTime();
      const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));

      const shouldSendEmail = TRIAL_WARNING_DAYS.includes(daysRemaining);
      const shouldSendNotification = TRIAL_NOTIFICATION_DAYS.includes(daysRemaining);
      if (!shouldSendEmail && !shouldSendNotification) {
        continue;
      }
      eligible++;

      try {
        const profile = await this.planUsageService.getTenantPlanProfile(row.tenantKey);
        if (profile.billingStatus !== "trial" || profile.accessStatus !== "active") {
          continue;
        }
        if (shouldSendEmail) {
          const result = await this.commercialNotificationsService.notifyTrialEnding({
            tenantKey: row.tenantKey,
            profile,
            daysRemaining,
          });
          sent += result.recipientCount;
          this.logger.log(`Trial ending reminder sent: tenantKey=${row.tenantKey} daysRemaining=${daysRemaining} recipients=${result.recipientCount}`);
        }
        if (shouldSendNotification) {
          await this.createTrialEndingUserNotifications(row.tenantKey, daysRemaining);
        }
        acted++;
      } catch (error: unknown) {
        failed++;
        const message = error instanceof Error ? error.message : String(error ?? "unknown");
        // A reminder that was not delivered is a missed commercial touchpoint: an error, not a warning.
        this.logger.error(`Trial ending reminder failed for ${row.tenantKey}: ${message}`);
      }
    }

    if (rows.length > 0) {
      this.logger.log(`Trial ending reminder pass: ${rows.length} tenants in window, ${sent} emails sent`);
    }
    const status = failed > 0 && discovery.summary.overall === "SUCCESS" ? "PARTIAL_FAILURE" : discovery.summary.overall;
    return { discovered: rows.length, eligible, acted, emailsSent: sent, failed, status, discovery: discovery.summary };
  }

  private async createTrialEndingUserNotifications(tenantKey: string, daysRemaining: number): Promise<void> {
    const tenantDb = this.prisma.tenant(tenantKey);
    const admins = await tenantDb.authIdentity.findMany({
      where: { tenantKey, role: "admin", isActive: true },
      select: { userId: true },
      take: 20,
    });
    if (admins.length === 0) {
      return;
    }
    const dayWord = daysRemaining === 1 ? "day" : "days";
    // Use an ISO date key so the job can run multiple times per day without duplicating notifications.
    const todayKey = new Date().toISOString().slice(0, 10);
    await Promise.all(
      admins.map(({ userId }) => {
        const id = `trial.ending.${daysRemaining}d.${tenantKey}.${userId}.${todayKey}`;
        return tenantDb.userNotification.upsert({
          where: { id },
          update: {},
          create: {
            id,
            tenantKey,
            userId,
            eventType: "trial.ending",
            title: `Trial ending in ${daysRemaining} ${dayWord}`,
            message: `Your Vexa PIM trial ends in ${daysRemaining} ${dayWord}. Upgrade your plan to keep access.`,
            metadata: { daysRemaining },
          },
        });
      }),
    );
  }

  private isEnabled(): boolean {
    // Gated by QUEUE_WORKER_ENABLED: the timer should run on the process that
    // executes background work. QUEUE_WORKER_ENABLED=true means "this process
    // IS a worker," so reminders run when it's true and stay off when it's
    // explicitly false (e.g. a future read-only/web-only deployment). Default
    // matches QueueService — true when unset — so single-process deployments
    // (current Railway setup) and local dev get reminders by default.
    const workerEnabled = String(process.env.QUEUE_WORKER_ENABLED ?? "true").trim().toLowerCase();
    return workerEnabled === "true";
  }
}
