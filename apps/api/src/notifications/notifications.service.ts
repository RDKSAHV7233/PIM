import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  CursorPaginationQuery,
  decodeCursorToken,
  encodeCursorToken,
  isCursorPagination,
  resolveCursorLimit,
} from "../common/pagination/cursor-pagination";
import type { AppRole } from "../common/rbac/roles";
import { OutboundWebhooksService } from "../outbound-webhooks/outbound-webhooks.service";
import { PrismaService } from "../prisma/prisma.service";
import { type NotificationEventType } from "./notification-event.types";

type NotificationListRow = {
  id: string;
  eventType: NotificationEventType;
  title: string;
  message: string;
  actionUrl: string | null;
  actionLabel: string | null;
  metadata: Record<string, unknown> | null;
  readAt: Date | string | null;
  createdAt: Date | string;
};

type NotificationRecipient = {
  userId: string;
  tenantKey: string;
};

type CreateNotificationInput = NotificationRecipient & {
  eventType: NotificationEventType;
  title: string;
  message: string;
  actionUrl?: string | null;
  actionLabel?: string | null;
  metadata?: Record<string, unknown>;
};

const REVIEWER_VISIBLE_TYPES: readonly NotificationEventType[] = ["approval_decision"];

const NOTIFICATION_SELECT = {
  id: true,
  eventType: true,
  title: true,
  message: true,
  actionUrl: true,
  actionLabel: true,
  metadata: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.UserNotificationSelect;

const NOTIFICATION_ORDER_BY: Prisma.UserNotificationOrderByWithRelationInput[] = [
  { readAt: { sort: "asc", nulls: "first" } },
  { createdAt: "desc" },
  { id: "desc" },
];

const PRODUCT_NOTIFICATION_FALLBACK_URL = "/catalog/products";
const PRODUCT_NOTIFICATION_FALLBACK_LABEL = "View products";

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outboundWebhooksService: OutboundWebhooksService,
  ) {}

  async listForUser(userId: string, role: AppRole, pagination?: CursorPaginationQuery) {
    const unreadCount = await this.countUnread(userId, role);
    const baseWhere = this.buildNotificationWhere(userId, role);

    if (isCursorPagination(pagination)) {
      const limit = resolveCursorLimit(pagination?.limit);
      const token = decodeCursorToken(pagination?.cursor);
      const tokenId = typeof token?.id === "string" ? token.id.trim() : "";
      const cursor = this.parseNotificationCursor(token?.sort);
      if (pagination?.cursor && (!token || !tokenId || !cursor)) {
        throw new BadRequestException("Invalid cursor.");
      }
      const rows = await this.prisma.tenant().userNotification.findMany({
        where: this.buildNotificationPageWhere(baseWhere, tokenId, cursor),
        orderBy: NOTIFICATION_ORDER_BY,
        take: limit + 1,
        select: NOTIFICATION_SELECT,
      });

      const hasNext = rows.length > limit;
      const pageRows = hasNext ? rows.slice(0, limit) : rows;
      const items = pageRows.map((row) => this.normalizeRow(row));
      const last = pageRows[pageRows.length - 1];
      const nextCursor = hasNext ? this.encodeNotificationCursor(last) : null;

      return {
        items,
        unreadCount,
        limit,
        nextCursor,
      };
    }

    const rows = await this.prisma.tenant().userNotification.findMany({
      where: baseWhere,
      orderBy: NOTIFICATION_ORDER_BY,
      take: 20,
      select: NOTIFICATION_SELECT,
    });

    return {
      items: rows.map((row) => this.normalizeRow(row)),
      unreadCount,
      limit: 20,
      nextCursor: null,
    };
  }

  async markRead(notificationId: string, userId: string) {
    const updated = await this.prisma.tenant().userNotification.updateMany({
      where: {
        id: notificationId,
        userId,
      },
      data: {
        readAt: new Date(),
      },
    });
    if (updated.count === 0) {
      throw new NotFoundException("Notification not found");
    }
    return { id: notificationId, read: true as const };
  }

  async markAllRead(userId: string, role: AppRole) {
    const updated = await this.prisma.tenant().userNotification.updateMany({
      where: {
        ...this.buildNotificationWhere(userId, role),
        readAt: null,
      },
      data: {
        readAt: new Date(),
      },
    });
    return { updated: updated.count };
  }

  async retargetProductNotifications(productId: string) {
    const normalizedProductId = String(productId ?? "").trim();
    if (normalizedProductId.length === 0) {
      return { updated: 0 };
    }

    const productDetailPrefix = `/products/${encodeURIComponent(normalizedProductId)}`;
    const updated = await this.prisma.tenant().userNotification.updateMany({
      where: {
        OR: [
          {
            metadata: {
              path: ["productId"],
              equals: normalizedProductId,
            },
          },
          {
            actionUrl: {
              startsWith: productDetailPrefix,
            },
          },
        ],
      },
      data: {
        actionUrl: PRODUCT_NOTIFICATION_FALLBACK_URL,
        actionLabel: PRODUCT_NOTIFICATION_FALLBACK_LABEL,
      },
    });

    return { updated: updated.count };
  }

  async emitImportStatus(jobId: string, status: "completed" | "failed" | "dead_letter") {
    const job = await this.prisma.tenant().bulkImportJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        tenantKey: true,
        sourceName: true,
        totalRows: true,
        failedRows: true,
        deadLetterRows: true,
      },
    });
    if (!job) {
      return;
    }

    const recipientId = await this.findWriteActor("/api/v1/bulk-import/jobs", job.id);
    if (!recipientId) {
      return;
    }

    const sourceName = job.sourceName?.trim() || `Import job ${job.id}`;
    if (status === "completed") {
      await this.createNotification({
        tenantKey: job.tenantKey,
        userId: recipientId,
        eventType: "import_completed",
        title: "Import complete",
        message: `${sourceName} finished successfully.`,
        actionUrl: `/operations/imports?bulkJobId=${encodeURIComponent(job.id)}`,
        actionLabel: "View import",
        metadata: {
          bulkJobId: job.id,
          totalRows: job.totalRows,
        },
      });
      return;
    }

    await this.createNotification({
      tenantKey: job.tenantKey,
      userId: recipientId,
      eventType: job.deadLetterRows || job.failedRows ? "import_repair_required" : "import_failed",
      title: job.deadLetterRows || job.failedRows ? "Import repair required" : "Import failed",
      message: `${sourceName} needs attention. ${job.deadLetterRows || job.failedRows || 0} rows require repair.`,
      actionUrl: `/operations/imports?bulkJobId=${encodeURIComponent(job.id)}`,
      actionLabel: "Repair import",
      metadata: {
        bulkJobId: job.id,
        failedRows: job.failedRows,
        deadLetterRows: job.deadLetterRows,
      },
    });
  }

  async emitPublishStatus(jobId: string, status: "completed" | "failed" | "dead_letter") {
    const job = await this.prisma.tenant().marketplaceExportJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        tenantKey: true,
        createdBy: true,
        channel: true,
        failureReason: true,
        productId: true,
        product: {
          select: {
            title: true,
          },
        },
      },
    });
    if (!job) {
      return;
    }

    const recipientId = typeof job.createdBy === "string" && job.createdBy.trim().length > 0
      ? job.createdBy.trim()
      : null;
    if (!recipientId) {
      return;
    }

    const productId = String(job.productId ?? "").trim();
    const productTitle = String(job.product?.title ?? "Product").trim();
    const channel = String(job.channel ?? "").trim();
    const baseInput = {
      tenantKey: String(job.tenantKey ?? "default").trim() || "default",
      userId: recipientId,
      actionUrl:
        status === "completed"
          ? `/channels/submissions?connectorSlug=${encodeURIComponent(channel)}`
          : `/products/${encodeURIComponent(productId)}?tab=channels`,
      metadata: {
        exportJobId: jobId,
        productId,
        channel,
      },
    };

    if (status === "completed") {
      await this.createNotification({
        ...baseInput,
        eventType: "publish_succeeded",
        title: "Channel publish succeeded",
        message: `${productTitle} was published successfully to ${channel}.`,
        actionLabel: "View job",
      });
      return;
    }

    await this.createNotification({
      ...baseInput,
      eventType: "publish_failed",
      title: "Channel publish failed",
      message: `${productTitle} could not be published to ${channel}. ${String(job.failureReason ?? "Fix the product and try again.").trim()}`,
      actionLabel: "Fix product",
    });
  }

  async emitApprovalDecision(productId: string, status: "approved" | "rejected") {
    const product = await this.prisma.tenant().product.findUnique({
      where: { id: productId },
      select: { id: true, tenantKey: true, title: true },
    });
    if (!product) {
      return;
    }

    const recipientId = await this.findLatestSubmittedForReviewActor(productId);
    if (!recipientId) {
      return;
    }

    await this.createNotification({
      tenantKey: product.tenantKey,
      userId: recipientId,
      eventType: "approval_decision",
      title: "Approval decision received",
      message: `${product.title} was ${status === "approved" ? "approved" : "rejected"}.`,
      actionUrl: `/products/${encodeURIComponent(product.id)}?tab=quality`,
      actionLabel: "Review approval",
      metadata: {
        productId: product.id,
        status,
      },
    });
  }

  async emitConnectorDown(
    tenantKey: string,
    userId: string,
    installationId: string,
    connectorLabel: string,
    reason?: string | null,
  ) {
    await this.createNotification({
      tenantKey,
      userId,
      eventType: "connector_down",
      title: "Connector health needs attention",
      message: `${connectorLabel} is currently unhealthy.${reason ? ` ${reason.trim()}` : ""}`,
      actionUrl: `/channels/connectors/${encodeURIComponent(installationId)}`,
      actionLabel: "Open connector",
      metadata: {
        installationId,
        connectorLabel,
        reason: reason ?? null,
      },
    });
  }

  async emitConnectorCredentialsExpired(
    tenantKey: string,
    userId: string,
    installationId: string,
    connectorLabel: string,
  ) {
    await this.createNotification({
      tenantKey,
      userId,
      eventType: "connector_credentials_expired",
      title: "Connector credentials expired",
      message: `${connectorLabel} credentials expired. Reconnect the account before the next publish or export run.`,
      actionUrl: `/channels/connectors/${encodeURIComponent(installationId)}`,
      actionLabel: "Reconnect account",
      metadata: {
        installationId,
        connectorLabel,
      },
    });
  }

  async emitScheduledExportFailed(
    tenantKey: string,
    userId: string,
    exportJobId: string,
    channel: string,
    reason?: string | null,
  ) {
    await this.createNotification({
      tenantKey,
      userId,
      eventType: "scheduled_export_failed",
      title: "Scheduled export failed",
      message: `${channel} export job ${exportJobId} failed.${reason ? ` ${reason.trim()}` : ""}`,
      actionUrl: `/operations/jobs`,
      actionLabel: "Open jobs",
      metadata: {
        exportJobId,
        channel,
        reason: reason ?? null,
      },
    });
  }

  async emitReadinessBlockerDetected(
    tenantKey: string,
    userId: string,
    productId: string,
    channel: string,
    blockers: string[],
  ) {
    await this.createNotification({
      tenantKey,
      userId,
      eventType: "readiness_blocker_detected",
      title: "Publish readiness blocker detected",
      message: `${blockers.length} blocker${blockers.length === 1 ? "" : "s"} need attention before ${channel} export can run.`,
      actionUrl: `/products/${encodeURIComponent(productId)}?tab=channels`,
      actionLabel: "Fix blockers",
      metadata: {
        productId,
        channel,
        blockers,
      },
    });
  }

  async emitMappingValidationFailed(
    tenantKey: string,
    userId: string,
    channel: string,
    categoryId: string,
    blockers: string[],
  ) {
    await this.createNotification({
      tenantKey,
      userId,
      eventType: "mapping_validation_failed",
      title: "Mapping validation failed",
      message: `${channel} mapping still has ${blockers.length} blocker${blockers.length === 1 ? "" : "s"} to resolve.`,
      actionUrl: `/channels/mappings?channel=${encodeURIComponent(channel)}&categoryId=${encodeURIComponent(categoryId)}`,
      actionLabel: "Open mapping",
      metadata: {
        channel,
        categoryId,
        blockers,
      },
    });
  }

  async emitQueueDlqThresholdExceeded(
    tenantKey: string,
    userId: string,
    queueName: string,
    threshold: number,
  ) {
    await this.createNotification({
      tenantKey,
      userId,
      eventType: "queue_dlq_threshold_exceeded",
      title: "Dead-letter queue threshold exceeded",
      message: `${queueName} exceeded the configured DLQ threshold of ${threshold}. Review operations before jobs back up further.`,
      actionUrl: `/operations/jobs`,
      actionLabel: "Review jobs",
      metadata: {
        queueName,
        threshold,
      },
    });
  }

  private async createNotification(input: CreateNotificationInput) {
    const created = await this.prisma.tenant(input.tenantKey).userNotification.create({
      data: {
        id: randomUUID(),
        tenantKey: input.tenantKey,
        userId: input.userId,
        eventType: input.eventType,
        title: input.title,
        message: input.message,
        actionUrl: input.actionUrl ?? null,
        actionLabel: input.actionLabel ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

    try {
      await this.outboundWebhooksService.enqueueNotificationEvent({
        tenantKey: input.tenantKey,
        notificationId: created.id,
        eventType: input.eventType,
        userId: input.userId,
        title: input.title,
        message: input.message,
        actionUrl: input.actionUrl ?? null,
        actionLabel: input.actionLabel ?? null,
        metadata: input.metadata ?? {},
        createdAt: created.createdAt.toISOString(),
      });
    } catch {
      // Outbound delivery must not break the primary notification path.
    }
  }

  private async countUnread(userId: string, role: AppRole) {
    return this.prisma.tenant().userNotification.count({
      where: {
        ...this.buildNotificationWhere(userId, role),
        readAt: null,
      },
    });
  }

  private async findWriteActor(resource: string, resourceId: string) {
    const row = await this.prisma.tenant().auditLog.findFirst({
      where: {
        action: "POST",
        resource,
        resourceId,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        actorId: true,
      },
    });
    return row?.actorId ? String(row.actorId).trim() : null;
  }

  private async findLatestSubmittedForReviewActor(productId: string) {
    const row = await this.prisma.tenant().auditLog.findFirst({
      where: {
        action: "STATUS_TRANSITION",
        resourceId: productId,
        metadata: {
          path: ["toStatus"],
          equals: "in_review",
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        actorId: true,
      },
    });
    return row?.actorId ? String(row.actorId).trim() : null;
  }

  private normalizeRow(row: {
    id: string;
    eventType: string;
    title: string;
    message: string;
    actionUrl: string | null;
    actionLabel: string | null;
    metadata: Prisma.JsonValue;
    readAt: Date | null;
    createdAt: Date;
  }): NotificationListRow {
    return {
      id: row.id,
      eventType: row.eventType as NotificationEventType,
      title: row.title,
      message: row.message,
      actionUrl: row.actionUrl,
      actionLabel: row.actionLabel,
      metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null,
      readAt: row.readAt,
      createdAt: row.createdAt,
    };
  }

  private buildNotificationWhere(userId: string, role: AppRole): Prisma.UserNotificationWhereInput {
    if (role === "reviewer") {
      return {
        userId,
        eventType: {
          in: [...REVIEWER_VISIBLE_TYPES],
        },
      };
    }
    return { userId };
  }

  private buildNotificationPageWhere(
    baseWhere: Prisma.UserNotificationWhereInput,
    tokenId: string,
    cursor: { readRank: number; createdAt: Date } | null,
  ): Prisma.UserNotificationWhereInput {
    if (!cursor || !tokenId) {
      return baseWhere;
    }
    return {
      AND: [
        baseWhere,
        this.buildNotificationCursorWhere(tokenId, cursor),
      ],
    };
  }

  private buildNotificationCursorWhere(
    tokenId: string,
    cursor: { readRank: number; createdAt: Date },
  ): Prisma.UserNotificationWhereInput {
    if (cursor.readRank <= 0) {
      return {
        OR: [
          {
            readAt: null,
            ...this.buildNotificationOlderThanWhere(tokenId, cursor.createdAt),
          },
          {
            readAt: {
              not: null,
            },
          },
        ],
      };
    }

    return {
      readAt: {
        not: null,
      },
      ...this.buildNotificationOlderThanWhere(tokenId, cursor.createdAt),
    };
  }

  private buildNotificationOlderThanWhere(tokenId: string, createdAt: Date): Prisma.UserNotificationWhereInput {
    return {
      OR: [
        {
          createdAt: {
            lt: createdAt,
          },
        },
        {
          createdAt,
          id: {
            lt: tokenId,
          },
        },
      ],
    };
  }

  private parseNotificationCursor(value?: string | null) {
    const raw = String(value ?? "").trim();
    if (!raw) {
      return null;
    }
    const [rankPart, timestampPart] = raw.split("|");
    const readRank = Number(rankPart);
    const createdAt = new Date(timestampPart ?? "");
    if (!Number.isFinite(readRank) || Number.isNaN(createdAt.getTime())) {
      return null;
    }
    return { readRank, createdAt };
  }

  private encodeNotificationCursor(row: Record<string, unknown> | undefined) {
    if (!row?.id) {
      return null;
    }
    const createdAt = row.createdAt instanceof Date
      ? row.createdAt
      : row.createdAt
        ? new Date(String(row.createdAt))
        : null;
    const readRank = Number(row.readRank ?? (row.readAt ? 1 : 0));
    if (!createdAt || Number.isNaN(createdAt.getTime()) || !Number.isFinite(readRank)) {
      return null;
    }
    return encodeCursorToken({
      sort: `${readRank}|${createdAt.toISOString()}`,
      id: String(row.id),
    });
  }
}
