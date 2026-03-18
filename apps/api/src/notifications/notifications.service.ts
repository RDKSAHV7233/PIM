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

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outboundWebhooksService: OutboundWebhooksService,
  ) {}

  async listForUser(userId: string, role: AppRole, pagination?: CursorPaginationQuery) {
    const unreadCount = await this.countUnread(userId, role);
    const eventFilter = role === "reviewer" ? REVIEWER_VISIBLE_TYPES : null;

    if (isCursorPagination(pagination)) {
      const limit = resolveCursorLimit(pagination?.limit);
      const token = decodeCursorToken(pagination?.cursor);
      const cursor = this.parseNotificationCursor(token?.sort);
      if (pagination?.cursor && (!token || !cursor)) {
        throw new BadRequestException("Invalid cursor.");
      }

      const params: Array<string | number | Date | string[]> = [userId];
      const clauses = ["user_id = $1"];

      if (eventFilter) {
        params.push(eventFilter.slice() as unknown as string[]);
        clauses.push(`event_type = ANY($${params.length})`);
      }

      if (token && cursor) {
        params.push(cursor.readRank);
        const rankParam = params.length;
        params.push(cursor.createdAt);
        const createdAtParam = params.length;
        params.push(token.id);
        const idParam = params.length;
        clauses.push(
          `(
            CASE WHEN read_at IS NULL THEN 0 ELSE 1 END > $${rankParam}
            OR (
              CASE WHEN read_at IS NULL THEN 0 ELSE 1 END = $${rankParam}
              AND (
                created_at < $${createdAtParam}
                OR (created_at = $${createdAtParam} AND id < $${idParam})
              )
            )
          )`,
        );
      }

      params.push(limit + 1);
      const limitParam = params.length;
      const whereSql = `WHERE ${clauses.join(" AND ")}`;
      // RLS-BYPASS: manual tenant filter
      const rows = await this.prisma.tenant().$queryRawUnsafe<Array<Record<string, unknown>>>(
        `
        SELECT
          id,
          event_type AS "eventType",
          title,
          message,
          action_url AS "actionUrl",
          action_label AS "actionLabel",
          metadata,
          read_at AS "readAt",
          created_at AS "createdAt",
          CASE WHEN read_at IS NULL THEN 0 ELSE 1 END AS "readRank"
        FROM user_notifications
        ${whereSql}
        ORDER BY "readRank" ASC, created_at DESC, id DESC
        LIMIT $${limitParam}
        `,
        ...params,
      );

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

    const params: Array<string | number | string[]> = [userId];
    const clauses = ["user_id = $1"];
    if (eventFilter) {
      params.push(eventFilter.slice() as unknown as string[]);
      clauses.push(`event_type = ANY($${params.length})`);
    }
    params.push(20);
    const limitParam = params.length;
    // RLS-BYPASS: manual tenant filter
    const rows = await this.prisma.tenant().$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT
        id,
        event_type AS "eventType",
        title,
        message,
        action_url AS "actionUrl",
        action_label AS "actionLabel",
        metadata,
        read_at AS "readAt",
        created_at AS "createdAt"
      FROM user_notifications
      WHERE ${clauses.join(" AND ")}
      ORDER BY CASE WHEN read_at IS NULL THEN 0 ELSE 1 END ASC, created_at DESC, id DESC
      LIMIT $${limitParam}
      `,
      ...params,
    );

    return {
      items: rows.map((row) => this.normalizeRow(row)),
      unreadCount,
      limit: 20,
      nextCursor: null,
    };
  }

  async markRead(notificationId: string, userId: string) {
    // RLS-BYPASS: manual tenant filter
    const updated = await this.prisma.tenant().$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      UPDATE user_notifications
      SET read_at = COALESCE(read_at, NOW())
      WHERE id = $1
        AND user_id = $2
      RETURNING id
      `,
      notificationId,
      userId,
    );
    if (updated.length === 0) {
      throw new NotFoundException("Notification not found");
    }
    return { id: notificationId, read: true as const };
  }

  async markAllRead(userId: string, role: AppRole) {
    const eventFilter = role === "reviewer" ? REVIEWER_VISIBLE_TYPES : null;
    const params: Array<string | string[]> = [userId];
    const clauses = ["user_id = $1", "read_at IS NULL"];
    if (eventFilter) {
      params.push(eventFilter.slice() as unknown as string[]);
      clauses.push(`event_type = ANY($${params.length})`);
    }
    // RLS-BYPASS: manual tenant filter
    const countRows = await this.prisma.tenant().$queryRawUnsafe<Array<{ count: bigint | number }>>(
      `
      WITH updated AS (
        UPDATE user_notifications
        SET read_at = NOW()
        WHERE ${clauses.join(" AND ")}
        RETURNING id
      )
      SELECT COUNT(*)::bigint AS count FROM updated
      `,
      ...params,
    );
    return { updated: Number(countRows[0]?.count ?? 0) };
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
      eventType: "import_failed",
      title: "Import failed",
      message: `${sourceName} needs attention. ${job.deadLetterRows || job.failedRows || 0} rows require repair.`,
      actionUrl: `/operations/imports?bulkJobId=${encodeURIComponent(job.id)}`,
      actionLabel: "View import",
      metadata: {
        bulkJobId: job.id,
        failedRows: job.failedRows,
        deadLetterRows: job.deadLetterRows,
      },
    });
  }

  async emitPublishStatus(jobId: string, status: "completed" | "failed" | "dead_letter") {
    // RLS-BYPASS: manual tenant filter
    const rows = await this.prisma.tenant().$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT
        j.id,
        j."tenantKey" AS "tenantKey",
        j.created_by AS "createdBy",
        j.channel,
        j."failureReason" AS "failureReason",
        j."productId" AS "productId",
        p.title AS "productTitle"
      FROM "MarketplaceExportJob" j
      JOIN "Product" p ON p.id = j."productId"
      WHERE j.id = $1
      LIMIT 1
      `,
      jobId,
    );
    const job = rows[0];
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
    const productTitle = String(job.productTitle ?? "Product").trim();
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
    const params: Array<string | string[]> = [userId];
    const clauses = ["user_id = $1", "read_at IS NULL"];
    if (role === "reviewer") {
      params.push(REVIEWER_VISIBLE_TYPES.slice() as unknown as string[]);
      clauses.push(`event_type = ANY($${params.length})`);
    }
    // RLS-BYPASS: manual tenant filter
    const rows = await this.prisma.tenant().$queryRawUnsafe<Array<{ count: bigint | number }>>(
      `
      SELECT COUNT(*)::bigint AS count
      FROM user_notifications
      WHERE ${clauses.join(" AND ")}
      `,
      ...params,
    );
    return Number(rows[0]?.count ?? 0);
  }

  private async findWriteActor(resource: string, resourceId: string) {
    // RLS-BYPASS: manual tenant filter
    const rows = await this.prisma.tenant().$queryRawUnsafe<Array<{ actorId: string | null }>>(
      `
      SELECT actor_id AS "actorId"
      FROM audit_logs
      WHERE action = 'POST'
        AND resource = $1
        AND resource_id = $2
      ORDER BY created_at DESC
      LIMIT 1
      `,
      resource,
      resourceId,
    );
    return rows[0]?.actorId ? String(rows[0].actorId).trim() : null;
  }

  private async findLatestSubmittedForReviewActor(productId: string) {
    // RLS-BYPASS: manual tenant filter
    const rows = await this.prisma.tenant().$queryRawUnsafe<Array<{ actorId: string | null }>>(
      `
      SELECT actor_id AS "actorId"
      FROM audit_logs
      WHERE action = 'STATUS_TRANSITION'
        AND resource_id = $1
        AND COALESCE(metadata->>'toStatus', '') = 'in_review'
      ORDER BY created_at DESC
      LIMIT 1
      `,
      productId,
    );
    return rows[0]?.actorId ? String(rows[0].actorId).trim() : null;
  }

  private normalizeRow(row: Record<string, unknown>): NotificationListRow {
    return {
      id: String(row.id ?? ""),
      eventType: String(row.eventType ?? "") as NotificationEventType,
      title: String(row.title ?? ""),
      message: String(row.message ?? ""),
      actionUrl: row.actionUrl ? String(row.actionUrl) : null,
      actionLabel: row.actionLabel ? String(row.actionLabel) : null,
      metadata: row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : null,
      readAt: row.readAt instanceof Date ? row.readAt : row.readAt ? String(row.readAt) : null,
      createdAt: row.createdAt instanceof Date ? row.createdAt : String(row.createdAt ?? ""),
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
