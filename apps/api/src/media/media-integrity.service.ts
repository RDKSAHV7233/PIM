import { Injectable } from "@nestjs/common";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_ROWS_PER_RUN = 5_000;
const MAX_PAGE_SIZE = 500;
const MAX_ROWS_PER_RUN = 25_000;
const ACTIVE_PRODUCT_STATUSES = new Set(["approved", "active", "published"]);

@Injectable()
export class MediaIntegrityService {
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
      const [checkpoint, rowsEligible] = await Promise.all([
        db.mediaIntegrityScanCheckpoint.findUnique({ where: { checkpointKey } }),
        db.mediaAsset.count(),
      ]);
      const startCursor = checkpoint?.cursorCreatedAt && checkpoint.cursorId
        ? { createdAt: checkpoint.cursorCreatedAt, id: checkpoint.cursorId }
        : null;

      const totals = emptyTotals();
      const byStorageKind = emptyStorageKindCounts();
      const affectedTenants = new Set<string>();
      let activeProductImpactCount = 0;
      let rowsExamined = 0;
      let nextCursor: MediaIntegrityCursor | null = startCursor;
      let reachedEnd = rowsEligible === 0;

      while (rowsExamined < maxRowsPerRun && !reachedEnd) {
        const take = Math.min(pageSize, maxRowsPerRun - rowsExamined);
        const rows = await this.loadRows(nextCursor, take);
        if (rows.length === 0) {
          reachedEnd = true;
          nextCursor = null;
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
        nextCursor = { createdAt: last.createdAt, id: last.id };
        if (rows.length < take) {
          reachedEnd = true;
          nextCursor = null;
        }
      }

      const complete = !startCursor && rowsExamined >= rowsEligible;
      const continuationPending = Boolean(nextCursor);
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
      });

      await db.mediaIntegrityScanRun.update({
        where: { id: runId },
        data: {
          status,
          completedAt,
          cursorCreatedAt: nextCursor?.createdAt ?? null,
          cursorId: nextCursor?.id ?? null,
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

      await db.mediaIntegrityScanCheckpoint.upsert({
        where: { checkpointKey },
        create: {
          checkpointKey,
          cursorCreatedAt: nextCursor?.createdAt ?? null,
          cursorId: nextCursor?.id ?? null,
          lastRunId: runId,
          cycleStartedAt: nextCursor ? startedAt : completedAt,
          rowsEligible,
        },
        update: {
          cursorCreatedAt: nextCursor?.createdAt ?? null,
          cursorId: nextCursor?.id ?? null,
          lastRunId: runId,
          cycleStartedAt: nextCursor ? (checkpoint?.cycleStartedAt ?? startedAt) : completedAt,
          rowsEligible,
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

  private async loadRows(cursor: MediaIntegrityCursor | null, take: number): Promise<MediaIntegrityRow[]> {
    return this.prismaDirect.getClient().mediaAsset.findMany({
      where: cursor
        ? {
            OR: [
              { createdAt: { gt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { gt: cursor.id } },
            ],
          }
        : undefined,
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
    }) as Promise<MediaIntegrityRow[]>;
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
