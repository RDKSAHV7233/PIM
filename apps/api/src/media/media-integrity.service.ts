import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { forEachTenant, listTenantKeys } from "../common/tenant/tenant-iteration";
import { PrismaDirectService } from "../prisma/prisma-direct.service";
import { MediaStorageService, MediaStorageProbeResult } from "./media-storage.service";

export type MediaIntegrityStorageKind = "object_key" | "legacy_local_path" | "empty" | "external_url" | "malformed";
export type MediaIntegrityScanStatus = "ok" | "partial" | "failed";

export type MediaIntegrityScanResult = {
  runId: string;
  status: MediaIntegrityScanStatus;
  mode: "read_only";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  coverage: {
    complete: boolean;
    rowsExamined: number;
    rowsEligible: number;
    truncated: boolean;
    continuationPending: boolean;
  };
  limits: {
    pageSize: number;
    maxRowsPerRun: number;
  };
  storage: {
    mode: string;
    backend: string;
    objectStorageConfigured: boolean;
    localProbeEnabled: boolean;
  };
  totals: {
    exists: number;
    missing: number;
    invalidPath: number;
    unverifiable: number;
    storageErrors: number;
  };
  byStorageKind: Record<MediaIntegrityStorageKind, number>;
  impact: {
    affectedTenantCount: number;
    activeProductImpactCount: number;
    /** Tenants whose media could not be read this run (their media was NOT scanned). Always 0 on a healthy run. */
    unreadableTenantCount: number;
  };
  safety: {
    mediaAssetMutations: false;
    productMutations: false;
    storageWrites: false;
    storageDeletes: false;
    rawPathsIncluded: false;
    fileNamesIncluded: false;
    secretValuesIncluded: false;
  };
};

type MediaIntegrityScanOptions = {
  checkpointKey?: string;
  pageSize?: number;
  maxRowsPerRun?: number;
  localFileProbeEnabled?: boolean;
  now?: Date;
};

type MediaIntegrityCursor = {
  createdAt: Date;
  id: string;
};

type MediaIntegrityRow = {
  id: string;
  tenantKey: string | null;
  productId: string | null;
  variantId: string | null;
  storagePath: string;
  createdAt: Date;
  product: {
    status: string | null;
    deletedAt: Date | null;
  } | null;
};

const DEFAULT_CHECKPOINT_KEY = "media-integrity:default";
/** Each tenant keeps its own cursor under `<checkpoint key>::<tenant key>`; the old single global checkpoint key is no longer read. */
const TENANT_CHECKPOINT_SEPARATOR = "::";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_ROWS_PER_RUN = 5_000;
const MAX_PAGE_SIZE = 500;
const MAX_ROWS_PER_RUN = 25_000;
const ACTIVE_PRODUCT_STATUSES = new Set(["approved", "active", "published"]);

@Injectable()
export class MediaIntegrityService {
  private readonly logger = new Logger(MediaIntegrityService.name);

  constructor(
    private readonly prismaDirect: PrismaDirectService,
    private readonly mediaStorage: MediaStorageService,
  ) {}

  async runBoundedScan(options: MediaIntegrityScanOptions = {}): Promise<MediaIntegrityScanResult> {
    const db = this.prismaDirect.getClient();
    const startedAt = options.now ?? new Date();
    const startedMs = startedAt.getTime();
    const checkpointKey = normalizeText(options.checkpointKey) || DEFAULT_CHECKPOINT_KEY;
    const pageSize = boundedInteger(options.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const maxRowsPerRun = boundedInteger(options.maxRowsPerRun, DEFAULT_MAX_ROWS_PER_RUN, 1, MAX_ROWS_PER_RUN);
    const localProbeEnabled = options.localFileProbeEnabled === true;
    const runId = randomUUID();

    await db.mediaIntegrityScanRun.create({
      data: {
        id: runId,
        status: "partial",
        startedAt,
        limits: { pageSize, maxRowsPerRun },
        storage: this.storageSnapshot(localProbeEnabled),
        totals: {},
        byStorageKind: {},
        impact: {},
        safety: safetyContract(),
      },
    });

    try {
      // SEC-DB-RLS-001: this was ONE global scan over every tenant's media with one global (createdAt, id) cursor, read through the
      // context-free client. Under row level security that client sees no tenant's media, so the scan would have examined nothing
      // and, worse, reported complete clean coverage. Media is now scanned per tenant: each tenant has its own cursor and checkpoint
      // (the platform scan-run and checkpoint tables are not row-level-secured), the tenants come from the workspace directory, and
      // every read is a short transaction in that tenant's own context, filtered by that tenant. Storage probes run OUTSIDE any
      // transaction, so a slow object-store call never holds a database transaction open.
      const { tenantKeys } = await listTenantKeys(db as never);
      const checkpointPrefix = `${checkpointKey}${TENANT_CHECKPOINT_SEPARATOR}`;
      const checkpoints = await db.mediaIntegrityScanCheckpoint.findMany({ where: { checkpointKey: { startsWith: checkpointPrefix } } });
      const checkpointByTenant = new Map<string, (typeof checkpoints)[number]>(
        checkpoints.map((checkpoint: (typeof checkpoints)[number]) => [checkpoint.checkpointKey.slice(checkpointPrefix.length), checkpoint]),
      );

      // Least recently completed first (a tenant never scanned goes first), so a tenant that finished a cycle does not starve the
      // others of the per-run row budget, and a tenant in the middle of a cycle (older cycle start) is finished before a new one starts.
      const cycleTime = (tenantKey: string) => checkpointByTenant.get(tenantKey)?.cycleStartedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
      const orderedTenants = [...tenantKeys].sort((a, b) => {
        const timeA = cycleTime(a);
        const timeB = cycleTime(b);
        if (timeA === timeB) {
          return a.localeCompare(b);
        }
        return timeA < timeB ? -1 : 1;
      });

      const totals = emptyTotals();
      const byStorageKind = emptyStorageKindCounts();
      const affectedTenants = new Set<string>();
      let activeProductImpactCount = 0;
      let rowsExamined = 0;
      let rowsEligible = 0;
      let allCyclesStartedFresh = true;
      let continuationPending = false;
      let unreadableTenantCount = 0;

      for (const tenantKey of orderedTenants) {
        const checkpoint = checkpointByTenant.get(tenantKey);
        const startCursor = checkpoint?.cursorCreatedAt && checkpoint.cursorId
          ? { createdAt: checkpoint.cursorCreatedAt, id: checkpoint.cursorId }
          : null;
        if (startCursor) {
          allCyclesStartedFresh = false;
        }

        let eligible: number;
        try {
          eligible = await this.readTenant(tenantKey, (tx) => tx.mediaAsset.count({ where: { tenantKey } }));
        } catch (error: unknown) {
          unreadableTenantCount++;
          this.logUnreadableTenant(tenantKey, error);
          continue;
        }
        rowsEligible += eligible;
        if (eligible === 0 && !startCursor) {
          continue;
        }
        if (rowsExamined >= maxRowsPerRun) {
          // Counted as eligible but not reached this run: its cursor and checkpoint are left exactly as they were.
          continuationPending = true;
          continue;
        }

        let cursor: MediaIntegrityCursor | null = startCursor;
        let reachedEnd = eligible === 0;
        let tenantReadFailed = false;
        while (rowsExamined < maxRowsPerRun && !reachedEnd) {
          const take = Math.min(pageSize, maxRowsPerRun - rowsExamined);
          let rows: MediaIntegrityRow[];
          try {
            rows = await this.loadRows(tenantKey, cursor, take);
          } catch (error: unknown) {
            unreadableTenantCount++;
            tenantReadFailed = true;
            this.logUnreadableTenant(tenantKey, error);
            break;
          }
          if (rows.length === 0) {
            reachedEnd = true;
            cursor = null;
            break;
          }

          for (const row of rows) {
            let defectObserved = false;
            try {
              defectObserved = await this.scanRow(row, totals, byStorageKind, localProbeEnabled);
            } catch {
              totals.storageErrors++;
              defectObserved = true;
            }
            if (defectObserved) {
              affectedTenants.add(normalizeText(row.tenantKey) || "unknown");
              if (isActiveProduct(row)) {
                activeProductImpactCount++;
              }
            }
          }

          rowsExamined += rows.length;
          const last = rows[rows.length - 1];
          cursor = { createdAt: last.createdAt, id: last.id };
          if (rows.length < take) {
            reachedEnd = true;
            cursor = null;
          }
        }

        if (tenantReadFailed) {
          // The tenant's cursor and checkpoint stay where they were; the next run retries it.
          continuationPending = true;
          continue;
        }
        if (cursor) {
          continuationPending = true;
        }
        const checkpointedAt = new Date();
        const cycleStartedAt = cursor ? (checkpoint?.cycleStartedAt ?? startedAt) : checkpointedAt;
        await db.mediaIntegrityScanCheckpoint.upsert({
          where: { checkpointKey: `${checkpointPrefix}${tenantKey}` },
          create: {
            checkpointKey: `${checkpointPrefix}${tenantKey}`,
            cursorCreatedAt: cursor?.createdAt ?? null,
            cursorId: cursor?.id ?? null,
            lastRunId: runId,
            cycleStartedAt,
            rowsEligible: eligible,
          },
          update: {
            cursorCreatedAt: cursor?.createdAt ?? null,
            cursorId: cursor?.id ?? null,
            lastRunId: runId,
            cycleStartedAt,
            rowsEligible: eligible,
          },
        });
      }

      const complete = allCyclesStartedFresh && !continuationPending && unreadableTenantCount === 0 && rowsExamined >= rowsEligible;
      const truncated = continuationPending;
      const status = resolveStatus({ complete, totals });
      const completedAt = new Date();
      const result = this.buildResult({
        runId,
        status,
        startedAt,
        completedAt,
        durationMs: Math.max(0, completedAt.getTime() - startedMs),
        pageSize,
        maxRowsPerRun,
        localProbeEnabled,
        rowsExamined,
        rowsEligible,
        complete,
        truncated,
        continuationPending,
        totals,
        byStorageKind,
        affectedTenantCount: affectedTenants.size,
        activeProductImpactCount,
        unreadableTenantCount,
      });

      await db.mediaIntegrityScanRun.update({
        where: { id: runId },
        data: {
          status,
          completedAt,
          // There is no single global cursor any more: every tenant keeps its own in its own checkpoint.
          cursorCreatedAt: null,
          cursorId: null,
          rowsExamined,
          rowsEligible,
          coverageComplete: complete,
          truncated,
          continuationPending,
          limits: result.limits,
          storage: result.storage,
          totals: result.totals,
          byStorageKind: result.byStorageKind,
          impact: result.impact,
          safety: result.safety,
        },
      });

      return result;
    } catch (error: unknown) {
      const completedAt = new Date();
      const result = this.buildResult({
        runId,
        status: "failed",
        startedAt,
        completedAt,
        durationMs: Math.max(0, completedAt.getTime() - startedMs),
        pageSize,
        maxRowsPerRun,
        localProbeEnabled,
        rowsExamined: 0,
        rowsEligible: 0,
        complete: false,
        truncated: false,
        continuationPending: false,
        totals: emptyTotals(),
        byStorageKind: emptyStorageKindCounts(),
        affectedTenantCount: 0,
        activeProductImpactCount: 0,
        unreadableTenantCount: 0,
      });
      await db.mediaIntegrityScanRun.update({
        where: { id: runId },
        data: {
          status: "failed",
          completedAt,
          rowsExamined: 0,
          rowsEligible: 0,
          coverageComplete: false,
          limits: result.limits,
          storage: result.storage,
          totals: result.totals,
          byStorageKind: result.byStorageKind,
          impact: result.impact,
          safety: result.safety,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      return result;
    }
  }

  classifyStoragePath(storagePath: string): MediaIntegrityStorageKind {
    const value = normalizeText(storagePath);
    if (!value) return "empty";
    if (isLocalPath(value)) return "legacy_local_path";
    if (/^https?:\/\//i.test(value)) return "external_url";
    if (isValidObjectKey(value)) return "object_key";
    return "malformed";
  }

  /**
   * Runs one short read inside the given tenant's own transaction (forEachTenant: tenant context set inside it). A failed read throws,
   * carrying the stable error code, so the caller counts the tenant as unreadable instead of treating it as having no media.
   */
  private async readTenant<T>(tenantKey: string, read: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    let value: T | undefined;
    const summary = await forEachTenant(
      this.prismaDirect.getClient(),
      async (tx) => {
        value = await read(tx);
        return { examinedCount: 1, changedCount: 0 };
      },
      { tenantKeys: [tenantKey] },
    );
    if (summary.tenantsFailed > 0) {
      throw Object.assign(new Error("MEDIA_INTEGRITY_TENANT_READ_FAILED"), { errorCode: summary.results[0]?.errorCode ?? "UNKNOWN" });
    }
    return value as T;
  }

  private logUnreadableTenant(tenantKey: string, error: unknown): void {
    const errorCode = (error as { errorCode?: unknown } | null)?.errorCode;
    // Stable code only: the underlying message can embed connection strings.
    this.logger.error(`Media integrity scan could not read tenant ${tenantKey} (${typeof errorCode === "string" ? errorCode : "UNKNOWN"}); its media was NOT scanned this run.`);
  }

  private async loadRows(tenantKey: string, cursor: MediaIntegrityCursor | null, take: number): Promise<MediaIntegrityRow[]> {
    return this.readTenant(
      tenantKey,
      (tx) =>
        tx.mediaAsset.findMany({
          where: cursor
            ? {
                tenantKey,
                OR: [
                  { createdAt: { gt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { gt: cursor.id } },
                ],
              }
            : { tenantKey },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take,
          select: {
            id: true,
            tenantKey: true,
            productId: true,
            variantId: true,
            storagePath: true,
            createdAt: true,
            product: { select: { status: true, deletedAt: true } },
          },
        }) as Promise<MediaIntegrityRow[]>,
    );
  }

  private async scanRow(
    row: MediaIntegrityRow,
    totals: MediaIntegrityScanResult["totals"],
    byStorageKind: Record<MediaIntegrityStorageKind, number>,
    localProbeEnabled: boolean,
  ): Promise<boolean> {
    const kind = this.classifyStoragePath(row.storagePath);
    byStorageKind[kind]++;

    if (kind === "empty" || kind === "external_url" || kind === "malformed") {
      totals.invalidPath++;
      return true;
    }

    const probe = kind === "object_key"
      ? await this.mediaStorage.probeObjectKey(row.storagePath)
      : await this.mediaStorage.probeLocalPath(row.storagePath, localProbeEnabled);
    return applyProbeResult(probe, totals);
  }

  private storageSnapshot(localProbeEnabled: boolean): MediaIntegrityScanResult["storage"] {
    const snapshot = this.mediaStorage.storageSnapshot();
    return {
      mode: snapshot.mode,
      backend: snapshot.backend,
      objectStorageConfigured: snapshot.objectStorageConfigured,
      localProbeEnabled,
    };
  }

  private buildResult(input: {
    runId: string;
    status: MediaIntegrityScanStatus;
    startedAt: Date;
    completedAt: Date;
    durationMs: number;
    pageSize: number;
    maxRowsPerRun: number;
    localProbeEnabled: boolean;
    rowsExamined: number;
    rowsEligible: number;
    complete: boolean;
    truncated: boolean;
    continuationPending: boolean;
    totals: MediaIntegrityScanResult["totals"];
    byStorageKind: Record<MediaIntegrityStorageKind, number>;
    affectedTenantCount: number;
    activeProductImpactCount: number;
    unreadableTenantCount: number;
  }): MediaIntegrityScanResult {
    return {
      runId: input.runId,
      status: input.status,
      mode: "read_only",
      startedAt: input.startedAt.toISOString(),
      completedAt: input.completedAt.toISOString(),
      durationMs: input.durationMs,
      coverage: {
        complete: input.complete,
        rowsExamined: input.rowsExamined,
        rowsEligible: input.rowsEligible,
        truncated: input.truncated,
        continuationPending: input.continuationPending,
      },
      limits: {
        pageSize: input.pageSize,
        maxRowsPerRun: input.maxRowsPerRun,
      },
      storage: this.storageSnapshot(input.localProbeEnabled),
      totals: input.totals,
      byStorageKind: input.byStorageKind,
      impact: {
        affectedTenantCount: input.affectedTenantCount,
        activeProductImpactCount: input.activeProductImpactCount,
        unreadableTenantCount: input.unreadableTenantCount,
      },
      safety: safetyContract(),
    };
  }
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function isLocalPath(value: string): boolean {
  return (
    path.isAbsolute(value) ||
    /^[A-Za-z]:\\/.test(value) ||
    value.includes("storage/media") ||
    value.includes("storage\\media")
  );
}

function isValidObjectKey(value: string): boolean {
  if (!value.startsWith("media/")) return false;
  if (value.includes("..") || value.includes("\\") || value.startsWith("/") || value.endsWith("/")) return false;
  const parts = value.split("/");
  return parts.length >= 3 && parts.every((part) => /^[A-Za-z0-9._-]+$/.test(part));
}

function emptyTotals(): MediaIntegrityScanResult["totals"] {
  return {
    exists: 0,
    missing: 0,
    invalidPath: 0,
    unverifiable: 0,
    storageErrors: 0,
  };
}

function emptyStorageKindCounts(): Record<MediaIntegrityStorageKind, number> {
  return {
    object_key: 0,
    legacy_local_path: 0,
    empty: 0,
    external_url: 0,
    malformed: 0,
  };
}

function safetyContract(): MediaIntegrityScanResult["safety"] {
  return {
    mediaAssetMutations: false,
    productMutations: false,
    storageWrites: false,
    storageDeletes: false,
    rawPathsIncluded: false,
    fileNamesIncluded: false,
    secretValuesIncluded: false,
  };
}

function applyProbeResult(
  probe: MediaStorageProbeResult,
  totals: MediaIntegrityScanResult["totals"],
): boolean {
  if (probe.status === "exists") {
    totals.exists++;
    return false;
  }
  if (probe.status === "missing") {
    totals.missing++;
    return true;
  }
  if (probe.status === "storage_error") {
    totals.storageErrors++;
    return true;
  }
  totals.unverifiable++;
  return true;
}

function isActiveProduct(row: MediaIntegrityRow): boolean {
  const status = normalizeText(row.product?.status).toLowerCase();
  return Boolean(row.productId && !row.product?.deletedAt && ACTIVE_PRODUCT_STATUSES.has(status));
}

function resolveStatus(input: {
  complete: boolean;
  totals: MediaIntegrityScanResult["totals"];
}): MediaIntegrityScanStatus {
  const defects =
    input.totals.missing +
    input.totals.invalidPath +
    input.totals.unverifiable +
    input.totals.storageErrors;
  if (input.complete && defects === 0) {
    return "ok";
  }
  return "partial";
}
