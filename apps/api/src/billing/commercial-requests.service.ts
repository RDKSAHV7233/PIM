import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { PrismaService } from "../prisma/prisma.service";

const COMMERCIAL_REQUEST_STATUSES = ["open", "acknowledged", "resolved", "cancelled"] as const;
const ACTIVE_COMMERCIAL_REQUEST_STATUSES = ["open", "acknowledged"] as const;

type CommercialRequestStatus = (typeof COMMERCIAL_REQUEST_STATUSES)[number];

export interface CommercialRequestSummary {
  id: string;
  tenantKey: string;
  workspaceSlug: string | null;
  displayName: string | null;
  requestType: string;
  status: CommercialRequestStatus;
  requestedBy: string;
  requesterRole: string;
  currentPlanTier: string;
  currentBillingStatus: string;
  currentAccessStatus: string;
  notes: string | null;
  source: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUpgradeRequestInput {
  requestedBy: string;
  requesterRole: string;
  currentPlanTier: string;
  currentBillingStatus: string;
  currentAccessStatus: string;
  notes?: string | null;
  source?: string | null;
}

interface UpgradeRequestOverviewRow {
  totalRequests: number;
  openRequests: number;
  acknowledgedRequests: number;
  resolvedRequests: number;
  cancelledRequests: number;
  recentRequests: number;
  recentResolvedRequests: number;
}

export interface UpgradeRequestOverview {
  totalRequests: number;
  activeRequests: number;
  openRequests: number;
  acknowledgedRequests: number;
  resolvedRequests: number;
  cancelledRequests: number;
  recentRequests: number;
  recentResolvedRequests: number;
}

interface ExportUpgradeRequestsCsvInput {
  tenantKey?: string;
  status?: string;
  limit?: number;
}

interface CommercialRequestListRow {
  id: string;
  tenantKey: string;
  workspaceSlug: string | null;
  displayName: string | null;
  requestType: string;
  status: string;
  requestedBy: string;
  requesterRole: string;
  currentPlanTier: string;
  currentBillingStatus: string;
  currentAccessStatus: string;
  notes: string | null;
  source: string;
  resolvedAt: Date | string | null;
  resolvedBy: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface CommercialRequestRow {
  id: string;
  tenantKey: string;
  requestType: string;
  status: string;
  requestedBy: string;
  requesterRole: string;
  currentPlanTier: string;
  currentBillingStatus: string;
  currentAccessStatus: string;
  notes: string | null;
  source: string;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CommercialRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOpenUpgradeRequestForTenant(tenantKeyInput: string): Promise<CommercialRequestSummary | null> {
    const tenantKey = normalizeTenantKey(tenantKeyInput);
    const record = await this.prisma.tenant(tenantKey).tenantCommercialRequest.findFirst({
      where: {
        tenantKey,
        requestType: "upgrade",
        status: {
          in: [...ACTIVE_COMMERCIAL_REQUEST_STATUSES],
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    if (!record) {
      return null;
    }
    return this.mapRequest(record);
  }

  async createOrReuseUpgradeRequest(
    tenantKeyInput: string,
    input: CreateUpgradeRequestInput,
  ): Promise<{ item: CommercialRequestSummary; created: boolean }> {
    const tenantKey = normalizeTenantKey(tenantKeyInput);
    const existing = await this.getOpenUpgradeRequestForTenant(tenantKey);
    if (existing) {
      return { item: existing, created: false };
    }

    const created = await this.prisma.tenant(tenantKey).tenantCommercialRequest.create({
      data: {
        tenantKey,
        requestType: "upgrade",
        status: "open",
        requestedBy: String(input.requestedBy ?? "").trim(),
        requesterRole: String(input.requesterRole ?? "").trim() || "admin",
        currentPlanTier: String(input.currentPlanTier ?? "").trim().toUpperCase() || "STARTER",
        currentBillingStatus: String(input.currentBillingStatus ?? "").trim().toLowerCase() || "trial",
        currentAccessStatus: String(input.currentAccessStatus ?? "").trim().toLowerCase() || "active",
        notes: this.normalizeOptionalText(input.notes, 1000),
        source: this.normalizeSource(input.source),
      },
    });
    return { item: await this.mapRequest(created), created: true };
  }

  async listUpgradeRequestsInternal(input?: {
    tenantKey?: string;
    status?: string;
    limit?: number;
  }): Promise<CommercialRequestSummary[]> {
    const normalizedLimit = Number.isFinite(input?.limit) ? Math.trunc(Number(input?.limit)) : 25;
    const limit = Math.max(1, Math.min(normalizedLimit || 25, 50));
    const tenantKey = input?.tenantKey ? normalizeTenantKey(input.tenantKey) : undefined;
    const status = input?.status ? this.normalizeStatus(input.status) : undefined;

    // RLS-BYPASS: manual tenant filter
    const rows = await this.prisma.tenant().$queryRaw<CommercialRequestListRow[]>(Prisma.sql`
      SELECT
        req."id" AS "id",
        req."tenantKey" AS "tenantKey",
        wd."workspaceSlug" AS "workspaceSlug",
        wd."displayName" AS "displayName",
        req."requestType" AS "requestType",
        req."status" AS "status",
        req."requested_by" AS "requestedBy",
        req."requester_role" AS "requesterRole",
        req."current_plan_tier" AS "currentPlanTier",
        req."current_billing_status" AS "currentBillingStatus",
        req."current_access_status" AS "currentAccessStatus",
        req."notes" AS "notes",
        req."source" AS "source",
        req."resolved_at" AS "resolvedAt",
        req."resolved_by" AS "resolvedBy",
        req."created_at" AS "createdAt",
        req."updated_at" AS "updatedAt"
      FROM "tenant_commercial_requests" req
      LEFT JOIN "WorkspaceDirectory" wd
        ON wd."tenantKey" = req."tenantKey"
      WHERE req."requestType" = 'upgrade'
        ${tenantKey ? Prisma.sql`AND req."tenantKey" = ${tenantKey}` : Prisma.empty}
        ${status ? Prisma.sql`AND req."status" = ${status}` : Prisma.empty}
      ORDER BY req."created_at" DESC, req."id" DESC
      LIMIT ${limit}
    `);

    return rows.map((row) => this.mapListRow(row));
  }

  async updateUpgradeRequestStatusInternal(
    requestIdInput: string,
    statusInput: string,
    actorId: string,
  ): Promise<CommercialRequestSummary> {
    const requestId = String(requestIdInput ?? "").trim();
    if (!requestId) {
      throw new Error("COMMERCIAL_REQUEST_ID_REQUIRED");
    }

    const status = this.normalizeStatus(statusInput);
    const current = await this.findRequestByIdInternal(requestId);
    if (!current) {
      throw new Error("COMMERCIAL_REQUEST_NOT_FOUND");
    }

    const tenantKey = normalizeTenantKey(current.tenantKey);
    const nextResolvedAt = status === "resolved" || status === "cancelled" ? new Date() : null;
    const nextResolvedBy = status === "resolved" || status === "cancelled" ? actorId : null;

    const updated = await this.prisma.tenant(tenantKey).tenantCommercialRequest.update({
      where: {
        id: requestId,
      },
      data: {
        status,
        resolvedAt: nextResolvedAt,
        resolvedBy: nextResolvedBy,
      },
    });

    return this.mapRequest(updated);
  }

  async getUpgradeRequestOverviewInternal(): Promise<UpgradeRequestOverview> {
    // RLS-BYPASS: manual tenant filter
    const rows = await this.prisma.tenant().$queryRaw<UpgradeRequestOverviewRow[]>(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE req."requestType" = 'upgrade')::int AS "totalRequests",
        COUNT(*) FILTER (WHERE req."requestType" = 'upgrade' AND req."status" = 'open')::int AS "openRequests",
        COUNT(*) FILTER (WHERE req."requestType" = 'upgrade' AND req."status" = 'acknowledged')::int AS "acknowledgedRequests",
        COUNT(*) FILTER (WHERE req."requestType" = 'upgrade' AND req."status" = 'resolved')::int AS "resolvedRequests",
        COUNT(*) FILTER (WHERE req."requestType" = 'upgrade' AND req."status" = 'cancelled')::int AS "cancelledRequests",
        COUNT(*) FILTER (WHERE req."requestType" = 'upgrade' AND req."created_at" >= NOW() - INTERVAL '7 days')::int AS "recentRequests",
        COUNT(*) FILTER (WHERE req."requestType" = 'upgrade' AND req."resolved_at" >= NOW() - INTERVAL '7 days')::int AS "recentResolvedRequests"
      FROM "tenant_commercial_requests" req
    `);
    const row = rows[0] ?? {
      totalRequests: 0,
      openRequests: 0,
      acknowledgedRequests: 0,
      resolvedRequests: 0,
      cancelledRequests: 0,
      recentRequests: 0,
      recentResolvedRequests: 0,
    };
    const openRequests = Number(row.openRequests ?? 0);
    const acknowledgedRequests = Number(row.acknowledgedRequests ?? 0);
    return {
      totalRequests: Number(row.totalRequests ?? 0),
      activeRequests: openRequests + acknowledgedRequests,
      openRequests,
      acknowledgedRequests,
      resolvedRequests: Number(row.resolvedRequests ?? 0),
      cancelledRequests: Number(row.cancelledRequests ?? 0),
      recentRequests: Number(row.recentRequests ?? 0),
      recentResolvedRequests: Number(row.recentResolvedRequests ?? 0),
    };
  }

  async exportUpgradeRequestsCsvInternal(input?: ExportUpgradeRequestsCsvInput): Promise<string> {
    const items = await this.listUpgradeRequestsInternal({
      tenantKey: input?.tenantKey,
      status: input?.status,
      limit: input?.limit ?? 250,
    });
    const lines = [
      [
        "id",
        "tenantKey",
        "workspaceSlug",
        "displayName",
        "status",
        "requestedBy",
        "requesterRole",
        "currentPlanTier",
        "currentBillingStatus",
        "currentAccessStatus",
        "source",
        "createdAt",
        "updatedAt",
        "resolvedAt",
        "resolvedBy",
        "notes",
      ].join(","),
      ...items.map((item) =>
        [
          item.id,
          item.tenantKey,
          item.workspaceSlug ?? "",
          item.displayName ?? "",
          item.status,
          item.requestedBy,
          item.requesterRole,
          item.currentPlanTier,
          item.currentBillingStatus,
          item.currentAccessStatus,
          item.source,
          item.createdAt,
          item.updatedAt,
          item.resolvedAt ?? "",
          item.resolvedBy ?? "",
          item.notes ?? "",
        ]
          .map((value) => this.csvCell(value))
          .join(","),
      ),
    ];
    return `${lines.join("\n")}\n`;
  }

  private async mapRequest(record: CommercialRequestRow): Promise<CommercialRequestSummary> {
    const workspace = await this.prisma.tenant(record.tenantKey).workspaceDirectory.findUnique({
      where: {
        tenantKey: record.tenantKey,
      },
      select: {
        workspaceSlug: true,
        displayName: true,
      },
    });

    return {
      id: record.id,
      tenantKey: normalizeTenantKey(record.tenantKey),
      workspaceSlug: workspace?.workspaceSlug ?? null,
      displayName: workspace?.displayName ?? null,
      requestType: String(record.requestType ?? "upgrade").trim() || "upgrade",
      status: this.normalizeStatus(record.status),
      requestedBy: String(record.requestedBy ?? "").trim(),
      requesterRole: String(record.requesterRole ?? "").trim() || "admin",
      currentPlanTier: String(record.currentPlanTier ?? "STARTER").trim().toUpperCase() || "STARTER",
      currentBillingStatus:
        String(record.currentBillingStatus ?? "trial").trim().toLowerCase() || "trial",
      currentAccessStatus:
        String(record.currentAccessStatus ?? "active").trim().toLowerCase() || "active",
      notes: this.normalizeOptionalText(record.notes, 1000),
      source: this.normalizeSource(record.source),
      resolvedAt: record.resolvedAt ? record.resolvedAt.toISOString() : null,
      resolvedBy: this.normalizeOptionalText(record.resolvedBy, 200),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private mapListRow(row: CommercialRequestListRow): CommercialRequestSummary {
    return {
      id: row.id,
      tenantKey: normalizeTenantKey(row.tenantKey),
      workspaceSlug: row.workspaceSlug ? String(row.workspaceSlug).trim() || null : null,
      displayName: row.displayName ? String(row.displayName).trim() || null : null,
      requestType: String(row.requestType ?? "upgrade").trim() || "upgrade",
      status: this.normalizeStatus(row.status),
      requestedBy: String(row.requestedBy ?? "").trim(),
      requesterRole: String(row.requesterRole ?? "").trim() || "admin",
      currentPlanTier: String(row.currentPlanTier ?? "STARTER").trim().toUpperCase() || "STARTER",
      currentBillingStatus:
        String(row.currentBillingStatus ?? "trial").trim().toLowerCase() || "trial",
      currentAccessStatus:
        String(row.currentAccessStatus ?? "active").trim().toLowerCase() || "active",
      notes: this.normalizeOptionalText(row.notes, 1000),
      source: this.normalizeSource(row.source),
      resolvedAt: this.toIsoString(row.resolvedAt),
      resolvedBy: this.normalizeOptionalText(row.resolvedBy, 200),
      createdAt: this.toIsoString(row.createdAt) ?? new Date(0).toISOString(),
      updatedAt: this.toIsoString(row.updatedAt) ?? new Date(0).toISOString(),
    };
  }

  private normalizeStatus(value: string | null | undefined): CommercialRequestStatus {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (COMMERCIAL_REQUEST_STATUSES.includes(normalized as CommercialRequestStatus)) {
      return normalized as CommercialRequestStatus;
    }
    return "open";
  }

  private normalizeOptionalText(value: string | null | undefined, maxLength: number): string | null {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
      return null;
    }
    return normalized.slice(0, maxLength);
  }

  private normalizeSource(value: string | null | undefined): string {
    const normalized = String(value ?? "").trim().toLowerCase();
    return normalized ? normalized.slice(0, 80) : "admin_plan";
  }

  private toIsoString(value: Date | string | null | undefined): string | null {
    if (!value) {
      return null;
    }
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  private async findRequestByIdInternal(requestId: string): Promise<CommercialRequestRow | null> {
    // RLS-BYPASS: manual tenant filter
    const rows = await this.prisma.tenant().$queryRaw<CommercialRequestRow[]>(Prisma.sql`
      SELECT
        req."id" AS "id",
        req."tenantKey" AS "tenantKey",
        req."requestType" AS "requestType",
        req."status" AS "status",
        req."requested_by" AS "requestedBy",
        req."requester_role" AS "requesterRole",
        req."current_plan_tier" AS "currentPlanTier",
        req."current_billing_status" AS "currentBillingStatus",
        req."current_access_status" AS "currentAccessStatus",
        req."notes" AS "notes",
        req."source" AS "source",
        req."resolved_at" AS "resolvedAt",
        req."resolved_by" AS "resolvedBy",
        req."created_at" AS "createdAt",
        req."updated_at" AS "updatedAt"
      FROM "tenant_commercial_requests" req
      WHERE req."id" = ${requestId}
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  private csvCell(value: string): string {
    const normalized = String(value ?? "");
    return `"${normalized.replace(/"/g, '""')}"`;
  }
}
