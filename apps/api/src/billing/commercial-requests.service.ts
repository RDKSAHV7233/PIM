import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { PrismaDirectService } from "../prisma/prisma-direct.service";
import { PrismaService } from "../prisma/prisma.service";

const COMMERCIAL_REQUEST_STATUSES = ["open", "acknowledged", "resolved", "cancelled"] as const;
const ACTIVE_COMMERCIAL_REQUEST_STATUSES = ["open", "acknowledged"] as const;

type CommercialRequestStatus = (typeof COMMERCIAL_REQUEST_STATUSES)[number];
type CommercialRequestSlaFilter = "attention";
type RequestedPlanTier = "STARTER" | "GROWTH" | "BUSINESS" | "ENTERPRISE";

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
  requestedPlanTier: string | null;
  currentBillingStatus: string;
  currentAccessStatus: string;
  notes: string | null;
  source: string;
  usageSnapshot: Record<string, unknown> | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUpgradeRequestInput {
  requestedBy: string;
  requesterRole: string;
  currentPlanTier: string;
  requestedPlanTier?: string | null;
  currentBillingStatus: string;
  currentAccessStatus: string;
  usageSnapshot?: Record<string, unknown> | null;
  notes?: string | null;
  source?: string | null;
}

export interface CreateOverageFlagInput {
  resource: string;
  current: number;
  limit: number;
  currentPlanTier: string;
  currentBillingStatus: string;
  currentAccessStatus: string;
  source: string;
  notes?: string | null;
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
  requestedPlanTier: string | null;
  currentBillingStatus: string;
  currentAccessStatus: string;
  usageSnapshot: Prisma.JsonValue | null;
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
  requestedPlanTier: string | null;
  currentBillingStatus: string;
  currentAccessStatus: string;
  usageSnapshot: Prisma.JsonValue | null;
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
    const usageSnapshot = this.normalizeUsageSnapshot(input.usageSnapshot);
    const db = this.prisma.tenant(tenantKey);
    // Concurrency guard: without a transaction-scoped lock, two concurrent calls
    // (e.g. an admin double-clicking "Request upgrade", or two requests racing
    // during a plan-limit check) can both pass the "no existing open request"
    // check before either INSERT commits, creating duplicate open upgrade
    // requests for the same tenant. No unique DB constraint exists on
    // (tenantKey, requestType, status) to catch this at the DB level — see
    // createOrReuseOverageFlag()'s identical guard for the same reasoning.
    // Mirrors the pg_advisory_xact_lock pattern already used for the same
    // "check-then-create must be atomic" problem in stripe.service.ts and
    // connector-framework/connector-webhook-ingestion.service.ts.
    const lockKey = `commercial-request:${tenantKey}:upgrade`;
    const { record: existingRecord, created: createdRecord } = await db.$transaction(async (tx) => {
      // pg_advisory_xact_lock() returns SQL void, which @prisma/client's queryRaw
      // cannot deserialize ("Failed to deserialize column of type 'void'"). Use
      // executeRaw, which discards the result set, to take the lock.
      // RLS-BYPASS: advisory lock, not a tenant-table query — no rows read or
      // written, lockKey is already tenant-namespaced above, nothing to disclose.
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0)::bigint)`);

      const existing = await tx.tenantCommercialRequest.findFirst({
        where: {
          tenantKey,
          requestType: "upgrade",
          status: {
            in: [...ACTIVE_COMMERCIAL_REQUEST_STATUSES],
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      if (existing) {
        return { record: existing, created: false as const };
      }

      const created = await tx.tenantCommercialRequest.create({
        data: {
          tenantKey,
          requestType: "upgrade",
          status: "open",
          requestedBy: String(input.requestedBy ?? "").trim(),
          requesterRole: String(input.requesterRole ?? "").trim() || "admin",
          currentPlanTier: String(input.currentPlanTier ?? "").trim().toUpperCase() || "TRIAL",
          requestedPlanTier: this.normalizeRequestedPlanTier(input.requestedPlanTier),
          currentBillingStatus: String(input.currentBillingStatus ?? "").trim().toLowerCase() || "trial",
          currentAccessStatus: String(input.currentAccessStatus ?? "").trim().toLowerCase() || "active",
          ...(usageSnapshot ? { usageSnapshot } : {}),
          notes: this.normalizeOptionalText(input.notes, 1000),
          source: this.normalizeSource(input.source),
        },
      });
      return { record: created, created: true as const };
    });
    return { item: await this.mapRequest(existingRecord), created: createdRecord };
  }

  /**
   * Deliberately separate from createOrReuseUpgradeRequest: an overage flag is
   * system-detected (a plan limit was silently exceeded by a non-blocking action —
   * e.g. SSO auto-provisioning pushing user count over the plan cap), not something
   * the tenant asked for. Using requestType: "upgrade" here would make it appear on
   * the tenant admin's own /admin/plan page ("Upgrade request pending — Vexa
   * commercial ops is reviewing this request") via getOpenUpgradeRequestForTenant,
   * which hardcodes requestType: "upgrade" — confusing for an admin who never
   * clicked anything. requestType: "<resource>_limit_overage" keeps this row
   * internal-only (visible to commercial ops, invisible to the tenant) while still
   * reusing the same TenantCommercialRequest table and resolve/audit workflow.
   */
  async createOrReuseOverageFlag(
    tenantKeyInput: string,
    input: CreateOverageFlagInput,
  ): Promise<{ item: CommercialRequestSummary; created: boolean }> {
    const tenantKey = normalizeTenantKey(tenantKeyInput);
    const requestType = this.buildOverageRequestType(input.resource);
    const usageSnapshot: Prisma.JsonObject = {
      resource: input.resource,
      current: input.current,
      limit: input.limit,
    };
    const db = this.prisma.tenant(tenantKey);
    // Concurrency guard: this is called from SSO auto-provisioning
    // (oidc-auth.service.ts) on every login, specifically to catch a plan
    // limit silently exceeded by a non-blocking action. Two users completing
    // SSO login for the same tenant at the same time can both pass the
    // "no existing open flag" check before either INSERT commits — the exact
    // scenario this function exists to detect in the first place — creating
    // duplicate overage-flag rows that double-surface the same overage to
    // commercial ops. No unique DB constraint exists on
    // (tenantKey, requestType, status) to catch this at the DB level; mirrors
    // the pg_advisory_xact_lock pattern already used for the same
    // "check-then-create must be atomic" problem in stripe.service.ts and
    // connector-framework/connector-webhook-ingestion.service.ts.
    const lockKey = `commercial-request:${tenantKey}:${requestType}`;
    const { record, created } = await db.$transaction(async (tx) => {
      // pg_advisory_xact_lock() returns SQL void, which @prisma/client's queryRaw
      // cannot deserialize ("Failed to deserialize column of type 'void'"). Use
      // executeRaw, which discards the result set, to take the lock.
      // RLS-BYPASS: advisory lock, not a tenant-table query — no rows read or
      // written, lockKey is already tenant-namespaced above, nothing to disclose.
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0)::bigint)`);

      const existing = await tx.tenantCommercialRequest.findFirst({
        where: {
          tenantKey,
          requestType,
          status: {
            in: [...ACTIVE_COMMERCIAL_REQUEST_STATUSES],
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      if (existing) {
        return { record: existing, created: false as const };
      }

      const inserted = await tx.tenantCommercialRequest.create({
        data: {
          tenantKey,
          requestType,
          status: "open",
          requestedBy: "system",
          requesterRole: "system",
          currentPlanTier: String(input.currentPlanTier ?? "").trim().toUpperCase() || "TRIAL",
          requestedPlanTier: null,
          currentBillingStatus: String(input.currentBillingStatus ?? "").trim().toLowerCase() || "trial",
          currentAccessStatus: String(input.currentAccessStatus ?? "").trim().toLowerCase() || "active",
          usageSnapshot,
          notes: this.normalizeOptionalText(input.notes, 1000),
          source: this.normalizeSource(input.source),
        },
      });
      return { record: inserted, created: true as const };
    });
    return { item: await this.mapRequest(record), created };
  }

  private buildOverageRequestType(resource: string): string {
    const normalized = String(resource ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    return `${normalized || "resource"}_limit_overage`;
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
        requestedPlanTier: true,
        currentBillingStatus: true,
        currentAccessStatus: true,
        usageSnapshot: true,
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
        "requestedPlanTier",
        "currentBillingStatus",
        "currentAccessStatus",
        "usageSnapshot",
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
          item.requestedPlanTier ?? "",
          item.currentBillingStatus,
          item.currentAccessStatus,
          item.usageSnapshot ? JSON.stringify(item.usageSnapshot) : "",
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
      requestedPlanTier: this.normalizeRequestedPlanTier(record.requestedPlanTier),
      currentBillingStatus:
        String(record.currentBillingStatus ?? "trial").trim().toLowerCase() || "trial",
      currentAccessStatus:
        String(record.currentAccessStatus ?? "active").trim().toLowerCase() || "active",
      notes: this.normalizeOptionalText(record.notes, 1000),
      source: this.normalizeSource(record.source),
      usageSnapshot: this.normalizeUsageSnapshotForOutput(record.usageSnapshot),
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
      requestedPlanTier: this.normalizeRequestedPlanTier(row.requestedPlanTier),
      currentBillingStatus:
        String(row.currentBillingStatus ?? "trial").trim().toLowerCase() || "trial",
      currentAccessStatus:
        String(row.currentAccessStatus ?? "active").trim().toLowerCase() || "active",
      notes: this.normalizeOptionalText(row.notes, 1000),
      source: this.normalizeSource(row.source),
      usageSnapshot: this.normalizeUsageSnapshotForOutput(row.usageSnapshot),
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

  private normalizeRequestedPlanTier(value: string | null | undefined): RequestedPlanTier | null {
    const normalized = String(value ?? "").trim().toUpperCase();
    return ["STARTER", "GROWTH", "BUSINESS", "ENTERPRISE"].includes(normalized)
      ? (normalized as RequestedPlanTier)
      : null;
  }

  private normalizeUsageSnapshot(value: Record<string, unknown> | null | undefined): Prisma.JsonObject | undefined {
    if (!value || Array.isArray(value) || typeof value !== "object") {
      return undefined;
    }
    return value as Prisma.JsonObject;
  }

  private normalizeUsageSnapshotForOutput(value: Prisma.JsonValue | null): Record<string, unknown> | null {
    if (!value || Array.isArray(value) || typeof value !== "object") {
      return null;
    }
    return value as Record<string, unknown>;
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
        requestedPlanTier: true,
        currentBillingStatus: true,
        currentAccessStatus: true,
        usageSnapshot: true,
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
      take: 500,
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
