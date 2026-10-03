import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  CursorPaginationQuery,
  decodeCursorToken,
  encodeCursorToken,
  isCursorPagination,
  resolveCursorLimit,
} from "../common/pagination/cursor-pagination";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { PrismaService } from "../prisma/prisma.service";
import { ListAuditEventsDto, type AuditEntityTypeFilter } from "./dto/list-audit-events.dto";

export interface AuditLogRecordInput {
  actorId: string;
  actorRole: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  tenantKey?: string | null;
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

const PLAN_AUDIT_ACTIONS = [
  "PLAN_TIER_CHANGE",
  "TENANT_ACCESS_SUSPENDED",
  "TENANT_ACCESS_RESUMED",
  "TENANT_BILLING_STATUS_SET",
  "TENANT_BILLING_CONTACT_UPDATED",
  "TENANT_COMMERCIAL_STATE_UPDATED",
  "COMMERCIAL_MUTATION_BLOCKED",
  "COMMERCIAL_UPGRADE_REQUEST_CREATED",
  "COMMERCIAL_UPGRADE_REQUEST_REUSED",
  "COMMERCIAL_UPGRADE_REQUEST_LISTED",
  "COMMERCIAL_UPGRADE_REQUEST_EXPORTED",
  "COMMERCIAL_UPGRADE_REQUEST_STATUS_UPDATED",
  "COMMERCIAL_OVERVIEW_VIEWED",
  "COMMERCIAL_TENANT_EXPORTED",
] as const;

const AUDIT_SELECT = {
  id: true,
  actorId: true,
  actorRole: true,
  action: true,
  resource: true,
  resourceId: true,
  metadata: true,
  createdAt: true,
} satisfies Prisma.AuditLogSelect;

// Cap on rows returned by a single CSV export — prevents an unbounded query
// against a large tenant's audit log. See queryEventsForExport()/renderEventsCsv()
// for how truncation past this cap is detected and surfaced.
const AUDIT_EXPORT_ROW_CAP = 5000;

const AUDIT_ORDER_BY = [
  { createdAt: "desc" },
  { id: "desc" },
] satisfies Prisma.AuditLogOrderByWithRelationInput[];

type AuditLogRow = Prisma.AuditLogGetPayload<{
  select: typeof AUDIT_SELECT;
}>;

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
    // Everything, including metadata sanitising and tenant normalisation, stays inside the try: callers
    // fire this with `void` on every mutating request, so it must never reject.
    try {
      const metadata = this.sanitizeMetadata(input.metadata ?? {});
      const tenantKey = input.tenantKey ? normalizeTenantKey(input.tenantKey) : undefined;
      await this.prisma.tenant(tenantKey).auditLog.create({
        data: {
          id: randomUUID(),
          actorId: input.actorId,
          actorRole: input.actorRole,
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId ?? null,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
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
      const cursorId = typeof token?.id === "string" ? token.id.trim() : "";
      if (token && (!cursorDate || Number.isNaN(cursorDate.getTime()) || !cursorId)) {
        throw new BadRequestException("Invalid cursor.");
      }
      const rows = await this.prisma.tenant().auditLog.findMany({
        where: this.combineWhere(
          actorId ? { actorId } : undefined,
          token && cursorDate ? this.buildCursorWhere(cursorDate, cursorId) : undefined,
        ),
        orderBy: AUDIT_ORDER_BY,
        take: safeLimit + 1,
        select: AUDIT_SELECT,
      });

      const hasNext = rows.length > safeLimit;
      const items = hasNext ? rows.slice(0, safeLimit) : rows;
      const last = items[items.length - 1];
      const createdAt = last?.createdAt ?? null;

      return {
        items: items.map((row) => this.normalizeAuditRow(row)),
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
    const rows = await this.prisma.tenant().auditLog.findMany({
      where: actorId ? { actorId } : undefined,
      orderBy: AUDIT_ORDER_BY,
      take: safeLimit,
      select: AUDIT_SELECT,
    });
    return rows.map((row) => this.normalizeAuditRow(row));
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

  private buildExplorerWhere(query: ListAuditEventsDto, cursorDate?: Date | null, cursorId?: string | null) {
    const clauses: Prisma.AuditLogWhereInput[] = [];
    const scalarWhere: Prisma.AuditLogWhereInput = {};
    const actorId = String(query.actorId ?? "").trim();
    const action = String(query.action ?? "").trim();
    const resourceId = String(query.resourceId ?? "").trim();
    if (actorId) {
      scalarWhere.actorId = actorId;
    }
    if (action) {
      scalarWhere.action = action;
    }
    if (resourceId) {
      scalarWhere.resourceId = resourceId;
    }

    const createdAt: Prisma.DateTimeFilter = {};
    const dateFrom = this.parseDateBoundary(query.dateFrom, "from");
    if (dateFrom) {
      createdAt.gte = dateFrom;
    }
    const dateTo = this.parseDateBoundary(query.dateTo, "to");
    if (dateTo) {
      createdAt.lte = dateTo;
    }
    if (Object.keys(createdAt).length > 0) {
      scalarWhere.createdAt = createdAt;
    }

    if (Object.keys(scalarWhere).length > 0) {
      clauses.push(scalarWhere);
    }
    if (query.entityType) {
      clauses.push(this.buildEntityTypeWhere(query.entityType));
    }

    if (cursorDate && cursorId) {
      clauses.push(this.buildCursorWhere(cursorDate, cursorId));
    }

    return this.combineWhere(...clauses);
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

    const rows = await this.prisma.tenant().auditLog.findMany({
      where: this.buildExplorerWhere(query, cursorDate, token?.id ?? null),
      orderBy: AUDIT_ORDER_BY,
      take: safeLimit + 1,
      select: AUDIT_SELECT,
    });

    const hasNext = rows.length > safeLimit;
    const items = hasNext ? rows.slice(0, safeLimit) : rows;
    const last = items[items.length - 1];
    const lastDate = last?.createdAt ?? null;

    return {
      items: items.map((row) => this.normalizeExplorerRow(row)),
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
    return this.renderEventsCsv(result.items);
  }

  async queryEventsForExport(query: ListAuditEventsDto): Promise<{ items: AuditExplorerRow[]; truncated: boolean }> {
    const where = this.buildExplorerWhere(query, null, null);
    // Fetch one row past the cap so truncation can be detected precisely — a
    // plain `take: CAP` can't tell "exactly CAP matching rows" apart from
    // "more than CAP rows, silently cut off here". Without this, a security
    // audit export for a busy tenant/date-range could silently omit events
    // past the cap with zero indication anywhere (same failure class as the
    // compliance.service.ts issue-inbox truncation fixed separately).
    const rows = await this.prisma.tenant().auditLog.findMany({
      where,
      orderBy: AUDIT_ORDER_BY,
      take: AUDIT_EXPORT_ROW_CAP + 1,
      select: AUDIT_SELECT,
    });
    const truncated = rows.length > AUDIT_EXPORT_ROW_CAP;
    const bounded = truncated ? rows.slice(0, AUDIT_EXPORT_ROW_CAP) : rows;
    return { items: bounded.map((row) => this.normalizeExplorerRow(row)), truncated };
  }

  renderEventsCsv(items: AuditExplorerRow[], options?: { truncated?: boolean }) {
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
    for (const row of items) {
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
    if (options?.truncated) {
      // A plain HTTP response header would be invisible here — this endpoint
      // is downloaded via a native browser link (no JS layer reads response
      // headers) and opened directly in a spreadsheet tool. The only way to
      // make truncation actually visible to the admin reviewing the file is
      // to put it in the CSV content itself, as the last row so it's exactly
      // where someone scanning to the end of the export will see it.
      lines.push(
        [
          new Date().toISOString(),
          "",
          "",
          "system",
          "EXPORT_TRUNCATED",
          "audit_export",
          "",
          JSON.stringify({
            message: `This export was capped at ${AUDIT_EXPORT_ROW_CAP} rows. Older events matching your filters exist but are not included — narrow your date range or filters to see them.`,
          }),
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

  private normalizeAuditRow(row: AuditLogRow): AuditExplorerRow {
    return {
      id: row.id,
      actorId: row.actorId,
      actorRole: row.actorRole,
      action: row.action,
      resource: row.resource,
      resourceId: row.resourceId,
      metadata: this.normalizeMetadata(row.metadata),
      createdAt: row.createdAt,
    };
  }

  private normalizeExplorerRow(row: AuditLogRow): AuditExplorerRow {
    const normalized = this.normalizeAuditRow(row);
    return {
      ...normalized,
      entityType: this.inferEntityType(normalized),
    };
  }

  private normalizeMetadata(value: Prisma.JsonValue): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private combineWhere(...clauses: Array<Prisma.AuditLogWhereInput | undefined>): Prisma.AuditLogWhereInput {
    const valid = clauses
      .filter((clause): clause is Prisma.AuditLogWhereInput => clause !== undefined)
      .filter((clause) => Object.keys(clause).length > 0);
    if (valid.length === 0) {
      return {};
    }
    if (valid.length === 1) {
      return valid[0];
    }
    return { AND: valid };
  }

  private buildCursorWhere(createdAt: Date, id: string): Prisma.AuditLogWhereInput {
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
            lt: id,
          },
        },
      ],
    };
  }

  private buildEntityTypeWhere(entityType: AuditEntityTypeFilter): Prisma.AuditLogWhereInput {
    switch (entityType) {
      case "product":
        return this.productEntityWhere();
      case "category":
        return this.categoryEntityWhere();
      case "mapping":
        return this.mappingEntityWhere();
      case "connector":
        return this.connectorEntityWhere();
      case "user":
        return this.userEntityWhere();
      case "plan":
        return this.planEntityWhere();
      case "privacy":
        return this.privacyEntityWhere();
      case "auth":
        return this.authEntityWhere();
      case "import":
        return this.importEntityWhere();
      case "job":
        return this.jobEntityWhere();
      case "other":
        return {
          NOT: [
            this.productEntityWhere(),
            this.categoryEntityWhere(),
            this.mappingEntityWhere(),
            this.connectorEntityWhere(),
            this.userEntityWhere(),
            this.planEntityWhere(),
            this.privacyEntityWhere(),
            this.authEntityWhere(),
            this.importEntityWhere(),
            this.jobEntityWhere(),
          ],
        };
    }
  }

  private productEntityWhere(): Prisma.AuditLogWhereInput {
    return {
      OR: [
        {
          metadata: {
            path: ["model"],
            equals: "Product",
          },
        },
        {
          resource: {
            contains: "product",
            mode: "insensitive",
          },
        },
      ],
    };
  }

  private categoryEntityWhere(): Prisma.AuditLogWhereInput {
    return {
      OR: [
        {
          metadata: {
            path: ["model"],
            equals: "Category",
          },
        },
        {
          resource: {
            contains: "categor",
            mode: "insensitive",
          },
        },
      ],
    };
  }

  private mappingEntityWhere(): Prisma.AuditLogWhereInput {
    return {
      OR: [
        {
          resource: {
            contains: "mapping",
            mode: "insensitive",
          },
        },
        {
          metadata: {
            path: ["lifecycle_state"],
            not: "",
          },
        },
      ],
    };
  }

  private connectorEntityWhere(): Prisma.AuditLogWhereInput {
    return {
      OR: [
        {
          resource: {
            contains: "connector",
            mode: "insensitive",
          },
        },
        {
          resource: "CONNECTOR_PERMISSION",
        },
      ],
    };
  }

  private userEntityWhere(): Prisma.AuditLogWhereInput {
    return {
      resource: {
        contains: "user",
        mode: "insensitive",
      },
    };
  }

  private planEntityWhere(): Prisma.AuditLogWhereInput {
    return {
      OR: [
        {
          resource: {
            contains: "billing",
            mode: "insensitive",
          },
        },
        {
          resource: "TENANT_PLAN_PROFILE",
        },
        {
          resource: {
            contains: "plan_profile",
            mode: "insensitive",
          },
        },
        {
          action: {
            in: [...PLAN_AUDIT_ACTIONS],
          },
        },
      ],
    };
  }

  private privacyEntityWhere(): Prisma.AuditLogWhereInput {
    return {
      OR: [
        {
          resource: {
            contains: "account",
            mode: "insensitive",
          },
        },
        {
          action: {
            startsWith: "consent.",
          },
        },
        {
          action: {
            startsWith: "account.",
          },
        },
      ],
    };
  }

  private authEntityWhere(): Prisma.AuditLogWhereInput {
    return {
      OR: [
        {
          resource: {
            startsWith: "auth.",
            mode: "insensitive",
          },
        },
        {
          resource: "auth.step_up",
        },
      ],
    };
  }

  private importEntityWhere(): Prisma.AuditLogWhereInput {
    return {
      resource: {
        contains: "import",
        mode: "insensitive",
      },
    };
  }

  private jobEntityWhere(): Prisma.AuditLogWhereInput {
    return {
      OR: [
        {
          resource: {
            contains: "job",
            mode: "insensitive",
          },
        },
        {
          resource: {
            contains: "submission",
            mode: "insensitive",
          },
        },
      ],
    };
  }

  private inferEntityType(row: AuditExplorerRow): AuditEntityTypeFilter {
    const metadata = row.metadata;
    const model = typeof metadata?.model === "string" ? metadata.model : "";
    const lifecycleState = typeof metadata?.lifecycle_state === "string" ? metadata.lifecycle_state : "";
    const resource = row.resource.toLowerCase();
    const action = row.action;

    if (model === "Product" || resource.includes("product")) {
      return "product";
    }
    if (model === "Category" || resource.includes("categor")) {
      return "category";
    }
    if (resource.includes("mapping") || lifecycleState.trim().length > 0) {
      return "mapping";
    }
    if (resource.includes("connector") || row.resource === "CONNECTOR_PERMISSION") {
      return "connector";
    }
    if (
      resource.includes("billing") ||
      row.resource === "TENANT_PLAN_PROFILE" ||
      resource.includes("plan_profile") ||
      PLAN_AUDIT_ACTIONS.includes(action as (typeof PLAN_AUDIT_ACTIONS)[number])
    ) {
      return "plan";
    }
    if (resource.includes("account") || action.startsWith("consent.") || action.startsWith("account.")) {
      return "privacy";
    }
    if (resource.startsWith("auth.") || row.resource === "auth.step_up") {
      return "auth";
    }
    if (resource.includes("import")) {
      return "import";
    }
    if (resource.includes("job") || resource.includes("submission")) {
      return "job";
    }
    if (resource.includes("user")) {
      return "user";
    }
    return "other";
  }
}

