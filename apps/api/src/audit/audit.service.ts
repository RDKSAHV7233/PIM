import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  CursorPaginationQuery,
  decodeCursorToken,
  encodeCursorToken,
  isCursorPagination,
  resolveCursorLimit,
} from "../common/pagination/cursor-pagination";
import { PrismaService } from "../prisma/prisma.service";

export interface AuditLogRecordInput {
  actorId: string;
  actorRole: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  private isSensitiveTextValue(value: string): boolean {
    return /\b(token|secret|credential|api[\s_-]?key|access[\s_-]?key|refresh[\s_-]?token|private[\s_-]?key|key)\b/i.test(
      value,
    );
  }

  private sanitizeMetadataValue(key: string, value: unknown): unknown {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.includes("token") ||
      normalizedKey.includes("secret") ||
      normalizedKey.includes("credential") ||
      normalizedKey.endsWith("key")
    ) {
      return "[REDACTED]";
    }
    if (typeof value === "string" && this.isSensitiveTextValue(value)) {
      return "[REDACTED]";
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeMetadataValue(key, item));
    }
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        out[nestedKey] = this.sanitizeMetadataValue(nestedKey, nestedValue);
      }
      return out;
    }
    return value;
  }

  private sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      out[key] = this.sanitizeMetadataValue(key, value);
    }
    return out;
  }

  async record(input: AuditLogRecordInput) {
    const metadata = JSON.stringify(this.sanitizeMetadata(input.metadata ?? {}));
    try {
      // RLS-BYPASS: manual tenant filter
      await this.prisma.tenant().$executeRawUnsafe(
        `
        INSERT INTO audit_logs (
          id,
          actor_id,
          actor_role,
          action,
          resource,
          resource_id,
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        `,
        randomUUID(),
        input.actorId,
        input.actorRole,
        input.action,
        input.resource,
        input.resourceId ?? null,
        metadata,
      );
    } catch {
      // Audit logging should not break the primary request path.
    }
  }

  async list(limit = 50, actorId?: string, pagination?: CursorPaginationQuery) {
    if (isCursorPagination(pagination)) {
      const safeLimit = resolveCursorLimit(pagination?.limit);
      const token = decodeCursorToken(pagination?.cursor);
      if (pagination?.cursor && !token) {
        throw new BadRequestException("Invalid cursor.");
      }
      const cursorDate = token ? new Date(token.sort) : null;
      if (token && (!cursorDate || Number.isNaN(cursorDate.getTime()))) {
        throw new BadRequestException("Invalid cursor.");
      }

      const params: Array<string | number | Date> = [];
      const clauses: string[] = [];
      if (actorId) {
        params.push(actorId);
        clauses.push(`actor_id = $${params.length}`);
      }
      if (token && cursorDate) {
        params.push(cursorDate);
        const dateParam = params.length;
        params.push(token.id);
        const idParam = params.length;
        clauses.push(
          `(created_at < $${dateParam} OR (created_at = $${dateParam} AND id < $${idParam}))`,
        );
      }

      const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      params.push(safeLimit + 1);
      const limitParam = params.length;
      // RLS-BYPASS: manual tenant filter
      const rows = (await this.prisma.tenant().$queryRawUnsafe(
        `
        SELECT
          id,
          actor_id AS "actorId",
          actor_role AS "actorRole",
          action,
          resource,
          resource_id AS "resourceId",
          metadata,
          created_at AS "createdAt"
        FROM audit_logs
        ${whereSql}
        ORDER BY created_at DESC, id DESC
        LIMIT $${limitParam}
        `,
        ...params,
      )) as Array<Record<string, unknown>>;

      const hasNext = rows.length > safeLimit;
      const items = hasNext ? rows.slice(0, safeLimit) : rows;
      const last = items[items.length - 1] as { id?: string; createdAt?: unknown } | undefined;
      const createdAt = last?.createdAt instanceof Date
        ? last.createdAt
        : typeof last?.createdAt === "string"
        ? new Date(last.createdAt)
        : null;

      return {
        items,
        limit: safeLimit,
        nextCursor: hasNext && last?.id && createdAt && !Number.isNaN(createdAt.getTime())
          ? encodeCursorToken({
              sort: createdAt.toISOString(),
              id: String(last.id),
            })
          : null,
      };
    }

    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 50;
    if (actorId) {
      // RLS-BYPASS: manual tenant filter
      return this.prisma.tenant().$queryRawUnsafe(
        `
        SELECT
          id,
          actor_id AS "actorId",
          actor_role AS "actorRole",
          action,
          resource,
          resource_id AS "resourceId",
          metadata,
          created_at AS "createdAt"
        FROM audit_logs
        WHERE actor_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        `,
        actorId,
        safeLimit,
      );
    }

    // RLS-BYPASS: manual tenant filter
    return this.prisma.tenant().$queryRawUnsafe(
      `
      SELECT
        id,
        actor_id AS "actorId",
        actor_role AS "actorRole",
        action,
        resource,
        resource_id AS "resourceId",
        metadata,
        created_at AS "createdAt"
      FROM audit_logs
      ORDER BY created_at DESC
      LIMIT $1
      `,
      safeLimit,
    );
  }
}

