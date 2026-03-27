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
import { ListAuditEventsDto, type AuditEntityTypeFilter } from "./dto/list-audit-events.dto";

export interface AuditLogRecordInput {
  actorId: string;
  actorRole: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

type AuditExplorerRow = {
  id: string;
  actorId: string;
  actorRole: string;
  action: string;
  resource: string;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date | string;
  entityType?: string;
};

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

  private parseDateBoundary(value: string | undefined, mode: "from" | "to"): Date | null {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
      return null;
    }
    const candidate =
      normalized.length <= 10 && mode === "to" ? new Date(`${normalized}T23:59:59.999Z`) : new Date(normalized);
    if (Number.isNaN(candidate.getTime())) {
      throw new BadRequestException(`Invalid ${mode === "from" ? "dateFrom" : "dateTo"} value.`);
    }
    return candidate;
  }

  private entityTypeCaseSql() {
    return `
      CASE
        WHEN COALESCE(metadata->>'model', '') = 'Product' OR resource ILIKE '%product%' THEN 'product'
        WHEN COALESCE(metadata->>'model', '') = 'Category' OR resource ILIKE '%categor%' THEN 'category'
        WHEN resource ILIKE '%mapping%' OR COALESCE(metadata->>'lifecycle_state', '') <> '' THEN 'mapping'
        WHEN resource ILIKE '%connector%' OR resource = 'CONNECTOR_PERMISSION' THEN 'connector'
        WHEN resource ILIKE '%billing%'
          OR resource = 'TENANT_PLAN_PROFILE'
          OR resource ILIKE '%plan_profile%'
          OR action IN (
            'PLAN_TIER_CHANGE',
            'TENANT_ACCESS_SUSPENDED',
            'TENANT_ACCESS_RESUMED',
            'TENANT_BILLING_STATUS_SET',
            'TENANT_COMMERCIAL_STATE_UPDATED',
            'COMMERCIAL_MUTATION_BLOCKED'
          ) THEN 'plan'
        WHEN resource ILIKE '%account%' OR action LIKE 'consent.%' OR action LIKE 'account.%' THEN 'privacy'
        WHEN resource ILIKE 'auth.%' OR resource = 'auth.step_up' THEN 'auth'
        WHEN resource ILIKE '%import%' THEN 'import'
        WHEN resource ILIKE '%job%' OR resource ILIKE '%submission%' THEN 'job'
        WHEN resource ILIKE '%user%' THEN 'user'
        ELSE 'other'
      END
    `;
  }

  private applyEntityTypeClause(entityType: AuditEntityTypeFilter, clauses: string[]) {
    switch (entityType) {
      case "product":
        clauses.push(`(COALESCE(metadata->>'model', '') = 'Product' OR resource ILIKE '%product%')`);
        break;
      case "category":
        clauses.push(`(COALESCE(metadata->>'model', '') = 'Category' OR resource ILIKE '%categor%')`);
        break;
      case "mapping":
        clauses.push(`(resource ILIKE '%mapping%' OR COALESCE(metadata->>'lifecycle_state', '') <> '')`);
        break;
      case "connector":
        clauses.push(`(resource ILIKE '%connector%' OR resource = 'CONNECTOR_PERMISSION')`);
        break;
      case "user":
        clauses.push(`resource ILIKE '%user%'`);
        break;
      case "plan":
        clauses.push(`(
          resource ILIKE '%billing%'
          OR resource = 'TENANT_PLAN_PROFILE'
          OR resource ILIKE '%plan_profile%'
          OR action IN (
            'PLAN_TIER_CHANGE',
            'TENANT_ACCESS_SUSPENDED',
            'TENANT_ACCESS_RESUMED',
            'TENANT_BILLING_STATUS_SET',
            'TENANT_COMMERCIAL_STATE_UPDATED',
            'COMMERCIAL_MUTATION_BLOCKED'
          )
        )`);
        break;
      case "privacy":
        clauses.push(`(resource ILIKE '%account%' OR action LIKE 'consent.%' OR action LIKE 'account.%')`);
        break;
      case "auth":
        clauses.push(`(resource ILIKE 'auth.%' OR resource = 'auth.step_up')`);
        break;
      case "import":
        clauses.push(`resource ILIKE '%import%'`);
        break;
      case "job":
        clauses.push(`(resource ILIKE '%job%' OR resource ILIKE '%submission%')`);
        break;
      case "other":
        clauses.push(`NOT (
          COALESCE(metadata->>'model', '') IN ('Product', 'Category')
          OR resource ILIKE '%product%'
          OR resource ILIKE '%categor%'
          OR resource ILIKE '%mapping%'
          OR COALESCE(metadata->>'lifecycle_state', '') <> ''
          OR resource ILIKE '%connector%'
          OR resource = 'CONNECTOR_PERMISSION'
          OR resource ILIKE '%billing%'
          OR resource = 'TENANT_PLAN_PROFILE'
          OR resource ILIKE '%plan_profile%'
          OR action IN (
            'PLAN_TIER_CHANGE',
            'TENANT_ACCESS_SUSPENDED',
            'TENANT_ACCESS_RESUMED',
            'TENANT_BILLING_STATUS_SET',
            'TENANT_COMMERCIAL_STATE_UPDATED',
            'COMMERCIAL_MUTATION_BLOCKED'
          )
          OR resource ILIKE '%account%'
          OR action LIKE 'consent.%'
          OR action LIKE 'account.%'
          OR resource ILIKE 'auth.%'
          OR resource = 'auth.step_up'
          OR resource ILIKE '%import%'
          OR resource ILIKE '%job%'
          OR resource ILIKE '%submission%'
          OR resource ILIKE '%user%'
        )`);
        break;
    }
  }

  private buildExplorerWhere(query: ListAuditEventsDto, cursorDate?: Date | null, cursorId?: string | null) {
    const params: Array<string | number | Date> = [];
    const clauses: string[] = [];
    const actorId = String(query.actorId ?? "").trim();
    const action = String(query.action ?? "").trim();
    if (actorId) {
      params.push(actorId);
      clauses.push(`actor_id = $${params.length}`);
    }
    if (action) {
      params.push(action);
      clauses.push(`action = $${params.length}`);
    }
    if (query.entityType) {
      this.applyEntityTypeClause(query.entityType, clauses);
    }

    const dateFrom = this.parseDateBoundary(query.dateFrom, "from");
    if (dateFrom) {
      params.push(dateFrom);
      clauses.push(`created_at >= $${params.length}`);
    }
    const dateTo = this.parseDateBoundary(query.dateTo, "to");
    if (dateTo) {
      params.push(dateTo);
      clauses.push(`created_at <= $${params.length}`);
    }

    if (cursorDate && cursorId) {
      params.push(cursorDate);
      const dateParam = params.length;
      params.push(cursorId);
      const idParam = params.length;
      clauses.push(`(created_at < $${dateParam} OR (created_at = $${dateParam} AND id < $${idParam}))`);
    }

    return {
      params,
      whereSql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    };
  }

  async listEvents(query: ListAuditEventsDto) {
    const rawLimit = Number(String(query.limit ?? "").trim());
    const safeLimit = resolveCursorLimit(Number.isFinite(rawLimit) ? rawLimit : undefined);
    const token = decodeCursorToken(query.cursor);
    if (query.cursor && !token) {
      throw new BadRequestException("Invalid cursor.");
    }
    const cursorDate = token ? new Date(token.sort) : null;
    if (token && (!cursorDate || Number.isNaN(cursorDate.getTime()))) {
      throw new BadRequestException("Invalid cursor.");
    }

    const { params, whereSql } = this.buildExplorerWhere(query, cursorDate, token?.id ?? null);
    params.push(safeLimit + 1);
    const limitParam = params.length;
    const entityTypeSql = this.entityTypeCaseSql();
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
        created_at AS "createdAt",
        ${entityTypeSql} AS "entityType"
      FROM audit_logs
      ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT $${limitParam}
      `,
      ...params,
    )) as AuditExplorerRow[];

    const hasNext = rows.length > safeLimit;
    const items = hasNext ? rows.slice(0, safeLimit) : rows;
    const last = items[items.length - 1];
    const lastDate = last
      ? last.createdAt instanceof Date
        ? last.createdAt
        : new Date(String(last.createdAt))
      : null;

    return {
      items,
      limit: safeLimit,
      nextCursor:
        hasNext && last?.id && lastDate && !Number.isNaN(lastDate.getTime())
          ? encodeCursorToken({ sort: lastDate.toISOString(), id: String(last.id) })
          : null,
    };
  }

  async exportEventsCsv(query: ListAuditEventsDto) {
    const exportQuery: ListAuditEventsDto = {
      ...query,
      cursor: undefined,
      limit: query.limit && String(query.limit).trim() ? query.limit : "1000",
    };
    const result = await this.listEvents(exportQuery);
    const lines = [
      [
        "timestamp",
        "actorId",
        "actorRole",
        "entityType",
        "action",
        "resource",
        "resourceId",
        "metadata",
      ]
        .map((value) => this.escapeCsv(value))
        .join(","),
    ];
    for (const row of result.items) {
      lines.push(
        [
          row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
          row.actorId,
          row.actorRole,
          String(row.entityType ?? "other"),
          row.action,
          row.resource,
          row.resourceId ?? "",
          JSON.stringify(row.metadata ?? {}),
        ]
          .map((value) => this.escapeCsv(value))
          .join(","),
      );
    }
    return lines.join("\n");
  }

  private escapeCsv(value: string) {
    const normalized = String(value ?? "");
    if (/[",\n]/.test(normalized)) {
      return `"${normalized.replace(/"/g, "\"\"")}"`;
    }
    return normalized;
  }
}

