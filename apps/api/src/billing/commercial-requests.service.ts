import { Injectable } from "@nestjs/common";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { PrismaDirectService } from "../prisma/prisma-direct.service";
import { PrismaService } from "../prisma/prisma.service";

const COMMERCIAL_REQUEST_STATUSES = ["open", "acknowledged", "resolved", "cancelled"] as const;
const ACTIVE_COMMERCIAL_REQUEST_STATUSES = ["open", "acknowledged"] as const;

type CommercialRequestStatus = (typeof COMMERCIAL_REQUEST_STATUSES)[number];
type CommercialRequestSlaFilter = "attention";

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
  staleOpenRequests: number;
  staleAcknowledgedRequests: number;
  oldestActiveRequestCreatedAt: Date | string | null;
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
  staleOpenRequests: number;
  staleAcknowledgedRequests: number;
  attentionRequiredRequests: number;
  oldestActiveRequestCreatedAt: string | null;
}

interface ExportUpgradeRequestsCsvInput {
  tenantKey?: string;
  status?: string;
  sla?: CommercialRequestSlaFilter;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaDirect: PrismaDirectService,
  ) {}

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
    sla?: string;
    limit?: number;
  }): Promise<CommercialRequestSummary[]> {
    const normalizedLimit = Number.isFinite(input?.limit) ? Math.trunc(Number(input?.limit)) : 25;
    const limit = Math.max(1, Math.min(normalizedLimit || 25, 50));
    const tenantKey = input?.tenantKey ? normalizeTenantKey(input.tenantKey) : undefined;
    const status = input?.status ? this.normalizeStatus(input.status) : undefined;
    const sla = input?.sla ? this.normalizeSla(input.sla) : undefined;
    const db = this.prismaDirect.getClient();
    const rows = await db.tenantCommercialRequest.findMany({
      where: {
        requestType: "upgrade",
        ...(tenantKey ? { tenantKey } : {}),
        ...(status ? { status } : {}),
        ...(sla === "attention"
          ? {
              OR: [
                {
                  status: "open",
                  createdAt: {
                    lt: this.getAttentionOpenCutoff(),
                  },
                },
                {
                  status: "acknowledged",
                  createdAt: {
                    lt: this.getAttentionAcknowledgedCutoff(),
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      select: {
        id: true,
        tenantKey: true,
        requestType: true,
        status: true,
        requestedBy: true,
        requesterRole: true,
        currentPlanTier: true,
        currentBillingStatus: true,
        currentAccessStatus: true,
        notes: true,
        source: true,
        resolvedAt: true,
        resolvedBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const workspaceMap = await this.getWorkspaceDirectoryMap(rows.map((row) => row.tenantKey));
    return rows.map((row) => this.mapListRecord(row, workspaceMap));
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
    const db = this.prismaDirect.getClient();
    const recentCutoff = this.getRecentWindowCutoff();
    const openAttentionCutoff = this.getAttentionOpenCutoff();
    const acknowledgedAttentionCutoff = this.getAttentionAcknowledgedCutoff();
    const [
      totalRequests,
      openRequests,
      acknowledgedRequests,
      resolvedRequests,
      cancelledRequests,
      recentRequests,
      recentResolvedRequests,
      staleOpenRequests,
      staleAcknowledgedRequests,
      oldestActiveRequest,
    ] = await Promise.all([
      db.tenantCommercialRequest.count({
        where: {
          requestType: "upgrade",
        },
      }),
      db.tenantCommercialRequest.count({
        where: {
          requestType: "upgrade",
          status: "open",
        },
      }),
      db.tenantCommercialRequest.count({
        where: {
          requestType: "upgrade",
          status: "acknowledged",
        },
      }),
      db.tenantCommercialRequest.count({
        where: {
          requestType: "upgrade",
          status: "resolved",
        },
      }),
      db.tenantCommercialRequest.count({
        where: {
          requestType: "upgrade",
          status: "cancelled",
        },
      }),
      db.tenantCommercialRequest.count({
        where: {
          requestType: "upgrade",
          createdAt: {
            gte: recentCutoff,
          },
        },
      }),
      db.tenantCommercialRequest.count({
        where: {
          requestType: "upgrade",
          resolvedAt: {
            gte: recentCutoff,
          },
        },
      }),
      db.tenantCommercialRequest.count({
        where: {
          requestType: "upgrade",
          status: "open",
          createdAt: {
            lt: openAttentionCutoff,
          },
        },
      }),
      db.tenantCommercialRequest.count({
        where: {
          requestType: "upgrade",
          status: "acknowledged",
          createdAt: {
            lt: acknowledgedAttentionCutoff,
          },
        },
      }),
      db.tenantCommercialRequest.findFirst({
        where: {
          requestType: "upgrade",
          status: {
            in: [...ACTIVE_COMMERCIAL_REQUEST_STATUSES],
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          createdAt: true,
        },
      }),
    ]);
    const row: UpgradeRequestOverviewRow = {
      totalRequests,
      openRequests,
      acknowledgedRequests,
      resolvedRequests,
      cancelledRequests,
      recentRequests,
      recentResolvedRequests,
      staleOpenRequests,
      staleAcknowledgedRequests,
      oldestActiveRequestCreatedAt: oldestActiveRequest?.createdAt ?? null,
    };
    const normalizedOpenRequests = Number(row.openRequests ?? 0);
    const normalizedAcknowledgedRequests = Number(row.acknowledgedRequests ?? 0);
    const normalizedStaleOpenRequests = Number(row.staleOpenRequests ?? 0);
    const normalizedStaleAcknowledgedRequests = Number(row.staleAcknowledgedRequests ?? 0);
    return {
      totalRequests: Number(row.totalRequests ?? 0),
      activeRequests: normalizedOpenRequests + normalizedAcknowledgedRequests,
      openRequests: normalizedOpenRequests,
      acknowledgedRequests: normalizedAcknowledgedRequests,
      resolvedRequests: Number(row.resolvedRequests ?? 0),
      cancelledRequests: Number(row.cancelledRequests ?? 0),
      recentRequests: Number(row.recentRequests ?? 0),
      recentResolvedRequests: Number(row.recentResolvedRequests ?? 0),
      staleOpenRequests: normalizedStaleOpenRequests,
      staleAcknowledgedRequests: normalizedStaleAcknowledgedRequests,
      attentionRequiredRequests: normalizedStaleOpenRequests + normalizedStaleAcknowledgedRequests,
      oldestActiveRequestCreatedAt: this.toIsoString(row.oldestActiveRequestCreatedAt),
    };
  }

  async exportUpgradeRequestsCsvInternal(input?: ExportUpgradeRequestsCsvInput): Promise<string> {
    const items = await this.listUpgradeRequestsInternal({
      tenantKey: input?.tenantKey,
      status: input?.status,
      sla: input?.sla,
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

  private normalizeSla(value: string | null | undefined): CommercialRequestSlaFilter | undefined {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "attention") {
      return "attention";
    }
    return undefined;
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
    return this.prismaDirect.getClient().tenantCommercialRequest.findFirst({
      where: {
        id: requestId,
      },
      select: {
        id: true,
        tenantKey: true,
        requestType: true,
        status: true,
        requestedBy: true,
        requesterRole: true,
        currentPlanTier: true,
        currentBillingStatus: true,
        currentAccessStatus: true,
        notes: true,
        source: true,
        resolvedAt: true,
        resolvedBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  private getRecentWindowCutoff(): Date {
    return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }

  private getAttentionOpenCutoff(): Date {
    return new Date(Date.now() - 24 * 60 * 60 * 1000);
  }

  private getAttentionAcknowledgedCutoff(): Date {
    return new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  }

  private async getWorkspaceDirectoryMap(
    tenantKeys: string[],
  ): Promise<Map<string, { workspaceSlug: string | null; displayName: string | null }>> {
    const normalizedTenantKeys = Array.from(
      new Set(
        tenantKeys
          .map((tenantKey) => normalizeTenantKey(tenantKey))
          .filter((tenantKey) => tenantKey.length > 0),
      ),
    );
    if (normalizedTenantKeys.length === 0) {
      return new Map();
    }

    const rows = await this.prismaDirect.getClient().workspaceDirectory.findMany({
      where: {
        tenantKey: {
          in: normalizedTenantKeys,
        },
      },
      select: {
        tenantKey: true,
        workspaceSlug: true,
        displayName: true,
      },
    });
    return new Map(
      rows.map((row) => [
        normalizeTenantKey(row.tenantKey),
        {
          workspaceSlug: row.workspaceSlug ?? null,
          displayName: row.displayName ?? null,
        },
      ]),
    );
  }

  private mapListRecord(
    row: CommercialRequestRow,
    workspaceMap: Map<string, { workspaceSlug: string | null; displayName: string | null }>,
  ): CommercialRequestSummary {
    const workspace = workspaceMap.get(normalizeTenantKey(row.tenantKey));
    return this.mapListRow({
      ...row,
      workspaceSlug: workspace?.workspaceSlug ?? null,
      displayName: workspace?.displayName ?? null,
    });
  }

  private csvCell(value: string): string {
    const normalized = String(value ?? "");
    return `"${normalized.replace(/"/g, '""')}"`;
  }
}
