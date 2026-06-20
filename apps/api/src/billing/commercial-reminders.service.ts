import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CommercialNotificationsService } from "./commercial-notifications.service";
import { PlanUsageService, type PlanProfileSummary } from "./plan-usage.service";

const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REMINDER_INITIAL_DELAY_MS = 5 * 60 * 1000;  // 5 minutes after boot
const TRIAL_WARNING_DAYS = [7, 1]; // email reminder thresholds
const TRIAL_NOTIFICATION_DAYS = [7, 2]; // in-app UserNotification thresholds

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
      void this.runReminders();
      this.intervalHandle = setInterval(() => void this.runReminders(), REMINDER_INTERVAL_MS);
      this.intervalHandle.unref();
    }, REMINDER_INITIAL_DELAY_MS);
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

  private async sendTrialEndingReminders(): Promise<void> {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);

    const rows = await this.prisma.tenant().$queryRaw<TrialReminderRow[]>(Prisma.sql`
      SELECT "tenantKey", "trialEndsAt", "billingContactEmail"
      FROM "TenantPlanProfile"
      WHERE "billingStatus" = 'trial'
        AND "accessStatus" = 'active'
        AND "trialEndsAt" IS NOT NULL
        AND "trialEndsAt" > ${now}
        AND "trialEndsAt" <= ${windowEnd}
    `);

    let sent = 0;
    for (const row of rows) {
      const trialEndsAt = new Date(row.trialEndsAt);
      const msRemaining = trialEndsAt.getTime() - now.getTime();
      const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));

      const shouldSendEmail = TRIAL_WARNING_DAYS.includes(daysRemaining);
      const shouldSendNotification = TRIAL_NOTIFICATION_DAYS.includes(daysRemaining);
      if (!shouldSendEmail && !shouldSendNotification) {
        continue;
      }

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
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error ?? "unknown");
        this.logger.warn(`Trial ending reminder failed for ${row.tenantKey}: ${message}`);
      }
    }

    if (rows.length > 0) {
      this.logger.log(`Trial ending reminder pass: ${rows.length} tenants in window, ${sent} emails sent`);
    }
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
