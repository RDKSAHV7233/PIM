import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { QUEUE_NAMES } from "../queue/queue.constants";

const DELETION_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

export interface AccountDeletionJobPayload {
  ticketId: string;
  tenantId: string;
  userId: string;
}

@Injectable()
export class AccountDeletionWorkerService implements OnModuleInit {
  private readonly logger = new Logger(AccountDeletionWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly queueService: QueueService,
  ) {}

  onModuleInit() {
    const isDbMode = String(process.env.AUTH_MODE ?? "").trim().toLowerCase() === "db";
    if (!isDbMode) return;

    this.queueService.process<AccountDeletionJobPayload>(
      QUEUE_NAMES.ACCOUNT_DELETION_EXECUTION,
      async (payload) => {
        await this.executeAccountDeletion(payload);
      },
    );

    void this.sweepOverdueDeletions();
  }

  async scheduleAccountDeletion(payload: AccountDeletionJobPayload): Promise<void> {
    const isDbMode = String(process.env.AUTH_MODE ?? "").trim().toLowerCase() === "db";
    if (!isDbMode) return;
    await this.queueService.enqueue(QUEUE_NAMES.ACCOUNT_DELETION_EXECUTION, payload, {
      delayMs: DELETION_GRACE_PERIOD_MS,
    });
  }

  private async sweepOverdueDeletions(): Promise<void> {
    const isDbMode = String(process.env.AUTH_MODE ?? "").trim().toLowerCase() === "db";
    if (!isDbMode) return;

    try {
      const tenantId = normalizeTenantKey(undefined);
      const overdue = await this.prisma.tenant(tenantId).accountDeletionRequest.findMany({
        where: {
          status: "scheduled",
          scheduledFor: { lte: new Date() },
        },
        select: { id: true, userId: true },
        take: 50,
        orderBy: { scheduledFor: "asc" },
      });

      for (const row of overdue) {
        await this.queueService.enqueue(QUEUE_NAMES.ACCOUNT_DELETION_EXECUTION, {
          ticketId: row.id,
          tenantId,
          userId: row.userId,
        } satisfies AccountDeletionJobPayload);
      }

      if (overdue.length > 0) {
        this.logger.log(`Queued ${overdue.length} overdue account deletion(s) on startup.`);
      }
    } catch (error) {
      this.logger.warn("Failed to sweep overdue deletions on startup.", { error: String(error) });
    }
  }

  private async executeAccountDeletion(payload: AccountDeletionJobPayload): Promise<void> {
    const tenantId = normalizeTenantKey(payload.tenantId);
    const { ticketId, userId } = payload;

    const request = await this.prisma.tenant(tenantId).accountDeletionRequest.findUnique({
      where: { id: ticketId },
      select: { id: true, status: true, actorRole: true },
    });

    if (!request || request.status !== "scheduled") {
      this.logger.log(`Deletion ticket ${ticketId} is not in scheduled state (${request?.status ?? "not found"}); skipping.`);
      return;
    }

    try {
      await this.prisma.tenant(tenantId).$transaction([
        this.prisma.tenant(tenantId).userMfaEnrollment.deleteMany({
          where: { tenantKey: tenantId, userId },
        }),
        this.prisma.tenant(tenantId).authIdentity.deleteMany({
          where: { tenantKey: tenantId, userId },
        }),
        this.prisma.tenant(tenantId).accountDeletionRequest.update({
          where: { id: ticketId },
          data: { status: "completed" },
        }),
      ]);

      await this.auditService.record({
        actorId: userId,
        actorRole: (request.actorRole as never) ?? "viewer",
        action: "account.deletion_executed",
        resource: "account_deletion_requests",
        resourceId: ticketId,
        tenantKey: tenantId,
        metadata: { tenantId, userId },
      });

      this.logger.log(`Account deletion executed for user ${userId} (ticket ${ticketId}).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Account deletion failed for ticket ${ticketId}: ${message}`);

      await this.prisma.tenant(tenantId).accountDeletionRequest.update({
        where: { id: ticketId },
        data: { status: "failed" },
      }).catch(() => undefined);

      throw error;
    }
  }
}
