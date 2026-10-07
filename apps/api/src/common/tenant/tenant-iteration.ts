import type { Prisma, PrismaClient } from "@prisma/client";
import { DEFAULT_TENANT_KEY } from "./tenant.constants";

/**
 * SEC-DB-RLS-001: the one way a background job or sweep acts on every tenant.
 *
 * Under row level security a connection with no tenant sees only the `default` tenant, so a job that scans "all rows" through the
 * context-free client silently covers one tenant and reports success. A job that must reach every tenant instead lists the
 * tenants from the directory and does its work inside each tenant's own context.
 *
 * Per tenant, exactly this happens:
 *
 *   transaction starts -> set_config('app.tenant_key', <tenant>, true) -> ALL work through that transaction client -> commit/rollback
 *
 * The context is transaction-local, so every query for that tenant has to run on the transaction client the callback receives. The
 * callback is never handed the base client, and it must not close over one: a query on any other connection has no tenant context
 * and would silently see the default tenant only.
 *
 * Why not `PrismaService.tenant(key)`: that creates a client, and a connection pool, per tenant (connection_limit 5 each, 50 clients
 * cached, oldest evicted). Iterating hundreds of tenants would churn pools. This uses the connections of one client.
 *
 * Failure isolation: one tenant failing rolls back only that tenant's transaction. The others keep their committed work, and the
 * overall result is PARTIAL_FAILURE (never SUCCESS) so the caller can surface a degraded run.
 *
 * Orphans: a restricted role cannot see rows whose tenant is not in the directory, so it cannot prove there are none. The summary
 * therefore says `orphanDetection: "UNVERIFIED_BY_RUNTIME_ROLE"`, never an orphan count of zero.
 */

export const TENANT_ITERATION_DEFAULT_CONCURRENCY = 4;
/** Unbounded concurrency is forbidden: each in-flight tenant holds a connection, and the pool is small. */
export const TENANT_ITERATION_MAX_CONCURRENCY = 8;
const DEFAULT_TRANSACTION_TIMEOUT_MS = 60_000;

export type TenantRunStatus = "success" | "failed";
export type TenantIterationOverall = "SUCCESS" | "PARTIAL_FAILURE" | "FAILED";

/** What one tenant's work reports. `failedCount` > 0 marks the tenant failed while its other work stays committed. */
export interface TenantWorkCounts {
  examinedCount: number;
  changedCount: number;
  failedCount?: number;
}

export interface TenantRunResult {
  tenantKey: string;
  status: TenantRunStatus;
  examinedCount: number;
  changedCount: number;
  failedCount: number;
  errorCode?: string;
  durationMs: number;
}

export interface TenantIterationSummary {
  overall: TenantIterationOverall;
  /** Rows in the tenant directory (the default tenant is always iterated in addition). */
  directoryTenantCount: number;
  tenantsEvaluated: number;
  tenantsSucceeded: number;
  tenantsFailed: number;
  examinedTotal: number;
  changedTotal: number;
  failedTotal: number;
  results: TenantRunResult[];
  /** A runtime role cannot see tenants missing from the directory, so this is never reported as zero. */
  orphanDetection: "UNVERIFIED_BY_RUNTIME_ROLE";
}

export interface TenantIterationOptions {
  /** Defaults to TENANT_ITERATION_CONCURRENCY, then 4. Clamped to 1..8. */
  concurrency?: number;
  /** Iterate exactly these tenants instead of the directory (the default tenant is not added). For tests and targeted runs. */
  tenantKeys?: string[];
  timeoutMs?: number;
}

type DirectoryReader = { workspaceDirectory: { findMany: (args: { select: { tenantKey: true } }) => Promise<Array<{ tenantKey: string }>> } };

/** The tenants to iterate: every directory tenant (active or not) plus the default tenant, de-duplicated and sorted. */
export async function listTenantKeys(client: DirectoryReader): Promise<{ tenantKeys: string[]; directoryTenantCount: number }> {
  const rows = await client.workspaceDirectory.findMany({ select: { tenantKey: true } });
  const keys = new Set<string>([DEFAULT_TENANT_KEY]);
  for (const row of rows) {
    const key = String(row.tenantKey ?? "").trim();
    if (key) {
      keys.add(key);
    }
  }
  return { tenantKeys: [...keys].sort(), directoryTenantCount: rows.length };
}

export function resolveTenantIterationConcurrency(requested?: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = requested ?? Number(String(env.TENANT_ITERATION_CONCURRENCY ?? "").trim());
  if (!Number.isFinite(raw) || raw < 1) {
    return TENANT_ITERATION_DEFAULT_CONCURRENCY;
  }
  return Math.min(Math.floor(raw), TENANT_ITERATION_MAX_CONCURRENCY);
}

/** A stable, non-sensitive code. Never the message: it can contain row values. */
function errorCodeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(code)) {
    return code;
  }
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === "string" && /^[A-Za-z0-9_.-]{1,60}$/.test(name) ? name : "UNKNOWN_ERROR";
}

export function summarizeTenantRuns(results: TenantRunResult[], directoryTenantCount: number): TenantIterationSummary {
  const failed = results.filter((r) => r.status === "failed").length;
  const succeeded = results.length - failed;
  const overall: TenantIterationOverall = failed === 0 ? "SUCCESS" : succeeded === 0 ? "FAILED" : "PARTIAL_FAILURE";
  return {
    overall,
    directoryTenantCount,
    tenantsEvaluated: results.length,
    tenantsSucceeded: succeeded,
    tenantsFailed: failed,
    examinedTotal: results.reduce((sum, r) => sum + r.examinedCount, 0),
    changedTotal: results.reduce((sum, r) => sum + r.changedCount, 0),
    failedTotal: results.reduce((sum, r) => sum + r.failedCount, 0),
    results,
    orphanDetection: "UNVERIFIED_BY_RUNTIME_ROLE",
  };
}

export async function forEachTenant(
  client: PrismaClient,
  work: (tx: Prisma.TransactionClient, tenantKey: string) => Promise<TenantWorkCounts>,
  options: TenantIterationOptions = {},
): Promise<TenantIterationSummary> {
  const listed = options.tenantKeys
    ? { tenantKeys: [...new Set(options.tenantKeys.map((k) => String(k).trim()).filter(Boolean))].sort(), directoryTenantCount: options.tenantKeys.length }
    : await listTenantKeys(client as unknown as DirectoryReader);
  const concurrency = Math.min(resolveTenantIterationConcurrency(options.concurrency), Math.max(1, listed.tenantKeys.length));
  const timeout = options.timeoutMs ?? DEFAULT_TRANSACTION_TIMEOUT_MS;
  const results: TenantRunResult[] = new Array(listed.tenantKeys.length);
  let next = 0;

  const runOne = async (index: number): Promise<void> => {
    const tenantKey = listed.tenantKeys[index];
    const started = Date.now();
    try {
      const counts = await client.$transaction(
        async (tx) => {
          // RLS-BYPASS: sets the transaction-local tenant context itself; it reads and writes no tenant rows.
          await tx.$queryRaw`SELECT set_config('app.tenant_key', ${tenantKey}, true)`;
          return work(tx, tenantKey);
        },
        { timeout, maxWait: timeout },
      );
      const failedCount = counts.failedCount ?? 0;
      results[index] = {
        tenantKey,
        status: failedCount > 0 ? "failed" : "success",
        examinedCount: counts.examinedCount,
        changedCount: counts.changedCount,
        failedCount,
        ...(failedCount > 0 ? { errorCode: "ITEM_FAILURES" } : {}),
        durationMs: Date.now() - started,
      };
    } catch (error) {
      results[index] = {
        tenantKey,
        status: "failed",
        examinedCount: 0,
        changedCount: 0,
        failedCount: 0,
        errorCode: errorCodeOf(error),
        durationMs: Date.now() - started,
      };
    }
  };

  const workers = Array.from({ length: concurrency }, async () => {
    while (next < listed.tenantKeys.length) {
      const index = next;
      next += 1;
      await runOne(index);
    }
  });
  await Promise.all(workers);

  return summarizeTenantRuns(results, listed.directoryTenantCount);
}
