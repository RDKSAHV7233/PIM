import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { runWithTenantContext } from "./tenant-context";
import { DEFAULT_TENANT_KEY, normalizeTenantKey } from "./tenant.constants";

/**
 * The one way a cross-tenant job (a sweeper, a reconciliation, a rollup) acts on every tenant without a runtime identity
 * that bypasses row level security (SEC-DB-RLS-001). Under a restricted database role a connection with no tenant context
 * sees only the default tenant, and the failure is silent. So the job enumerates tenants from the authoritative directory
 * and does its work inside each tenant's own context, one tenant at a time.
 *
 * What the helper guarantees, and what it does not:
 * - Every callback runs inside `runWithTenantContext(tenantKey)`, so `prisma.tenant()` inside it is that tenant's client.
 * - At most `concurrency` tenants run at once (default 4, hard cap 16). Each tenant has its own Prisma client and the
 *   process keeps at most 50 (oldest evicted first), so a low bound keeps a client from being evicted mid-query.
 * - One tenant cannot stall the rest: each has a timeout, and its slot is released when it fires. JavaScript cannot
 *   cancel a query already sent, so a timed-out callback keeps running in the background. Callbacks must be idempotent and
 *   should honour `signal`, which is aborted at the timeout.
 * - A tenant that throws is counted, never swallowed and never fatal to the others. The result says exactly how many
 *   succeeded, failed, timed out or were not started, so a job that processed nothing is visible.
 * - A failure to LIST tenants is different: nothing can be concluded about the tenants not reached, so it throws, after
 *   the tenants already running have finished, with the partial result attached.
 *
 * Limits to know about: tenants whose data exists under a key that is not in `WorkspaceDirectory` are not visited (a
 * superuser sweep used to see them). The directory is the authority; a job's own tests and a read-only production check
 * must confirm that it covers every tenant key that holds data.
 */

export const TENANT_ITERATION_DEFAULTS = {
  concurrency: 4,
  maxConcurrency: 16,
  perTenantTimeoutMs: 60_000,
  pageSize: 100,
  maxLoggedFailures: 20,
} as const;

export type TenantOutcomeKind = "ok" | "failed" | "timed_out";

export interface TenantWorkContext {
  readonly tenantKey: string;
  /** Aborted when the per-tenant timeout fires. Cooperative: the helper cannot stop a query already running. */
  readonly signal: AbortSignal;
}

export interface TenantOutcome<T> {
  tenantKey: string;
  outcome: TenantOutcomeKind;
  durationMs: number;
  /** Present only when `outcome` is `ok`. */
  value?: T;
  /** The error class name only, never its message: messages can carry data. */
  errorName?: string;
  errorCode?: string;
}

export interface TenantIterationOptions {
  /** Names the job in logs and in the result. */
  label: string;
  concurrency?: number;
  perTenantTimeoutMs?: number;
  pageSize?: number;
  /** After this many milliseconds no new tenant is started. Tenants already running finish (or time out). */
  deadlineMs?: number;
  /** Default true: today's superuser sweeps also cover deactivated workspaces, and skipping them would change behaviour. */
  includeInactive?: boolean;
  /** Run exactly these tenants instead of listing the directory (retries, tests). */
  tenantKeys?: readonly string[];
  /** Stops new tenants from starting, for example at shutdown. */
  signal?: AbortSignal;
}

export interface TenantIterationResult<T> {
  label: string;
  /** Tenants taken from the source (the default tenant plus the directory, or the explicit list). */
  listed: number;
  processed: number;
  failed: number;
  timedOut: number;
  /** Known tenants that were not started because of the deadline or the abort signal (explicit lists only). */
  skipped: number;
  /** Rows read from the directory, or null when an explicit list was used. */
  directoryTenants: number | null;
  zeroTenants: boolean;
  deadlineReached: boolean;
  aborted: boolean;
  /** True only when every tenant ran to success and nothing was left unstarted. */
  complete: boolean;
  durationMs: number;
  outcomes: Array<TenantOutcome<T>>;
}

export class TenantIterationListingError extends Error {
  constructor(
    readonly label: string,
    readonly result: TenantIterationResult<unknown>,
    options?: { cause?: unknown },
  ) {
    super(`Tenant iteration "${label}" could not list tenants; ${result.listed} were reached before the failure.`);
    this.name = "TenantIterationListingError";
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export class TenantIterationIncompleteError extends Error {
  constructor(
    readonly label: string,
    readonly result: TenantIterationResult<unknown>,
  ) {
    super(
      `Tenant iteration "${label}" did not complete: ${result.failed} failed, ${result.timedOut} timed out, ` +
        `${result.skipped} not started${result.zeroTenants ? ", no tenants listed" : ""}.`,
    );
    this.name = "TenantIterationIncompleteError";
  }
}

/** For a job where a partial result is worse than a loud failure. */
export function assertTenantIterationComplete<T>(result: TenantIterationResult<T>): void {
  if (!result.complete) {
    throw new TenantIterationIncompleteError(result.label, result);
  }
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function errorFields(error: unknown): { errorName: string; errorCode?: string } {
  const errorName = error instanceof Error ? error.name : "NonError";
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,24}$/.test(code) ? { errorName, errorCode: code } : { errorName };
}

@Injectable()
export class TenantIterationService {
  private readonly logger = new Logger(TenantIterationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async forEachTenant<T>(
    options: TenantIterationOptions,
    work: (context: TenantWorkContext) => Promise<T>,
  ): Promise<TenantIterationResult<T>> {
    const startedAt = Date.now();
    const concurrency = clampInt(
      options.concurrency,
      TENANT_ITERATION_DEFAULTS.concurrency,
      1,
      TENANT_ITERATION_DEFAULTS.maxConcurrency,
    );
    const timeoutMs = clampInt(options.perTenantTimeoutMs, TENANT_ITERATION_DEFAULTS.perTenantTimeoutMs, 1, 3_600_000);
    const pageSize = clampInt(options.pageSize, TENANT_ITERATION_DEFAULTS.pageSize, 1, 1000);
    const deadlineAt =
      typeof options.deadlineMs === "number" && Number.isFinite(options.deadlineMs) && options.deadlineMs > 0
        ? startedAt + options.deadlineMs
        : Number.POSITIVE_INFINITY;

    const explicit = options.tenantKeys ? [...new Set(options.tenantKeys.map((key) => normalizeTenantKey(key)))] : null;
    const counters = { directoryTenants: 0 };
    const source = explicit ? this.explicitSource(explicit) : this.directorySource(pageSize, options.includeInactive ?? true, counters);

    const outcomes: Array<TenantOutcome<T>> = [];
    let listed = 0;
    let deadlineReached = false;
    let aborted = false;
    let listingError: unknown;
    let hasListingError = false;
    let stop = false;

    const worker = async (): Promise<void> => {
      for (;;) {
        if (stop) {
          return;
        }
        if (options.signal?.aborted) {
          aborted = true;
          stop = true;
          return;
        }
        if (Date.now() >= deadlineAt) {
          deadlineReached = true;
          stop = true;
          return;
        }
        let next: IteratorResult<string>;
        try {
          next = await source.next();
        } catch (error) {
          if (!hasListingError) {
            hasListingError = true;
            listingError = error;
          }
          stop = true;
          return;
        }
        if (next.done) {
          return;
        }
        listed += 1;
        outcomes.push(await this.runOne(next.value, work, timeoutMs));
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    const processed = outcomes.filter((outcome) => outcome.outcome === "ok").length;
    const failed = outcomes.filter((outcome) => outcome.outcome === "failed").length;
    const timedOut = outcomes.filter((outcome) => outcome.outcome === "timed_out").length;
    const skipped = explicit ? Math.max(0, explicit.length - listed) : 0;
    const zeroTenants = listed === 0;
    const result: TenantIterationResult<T> = {
      label: options.label,
      listed,
      processed,
      failed,
      timedOut,
      skipped,
      directoryTenants: explicit ? null : counters.directoryTenants,
      zeroTenants,
      deadlineReached,
      aborted,
      complete: !hasListingError && failed === 0 && timedOut === 0 && skipped === 0 && !deadlineReached && !aborted && !zeroTenants,
      durationMs: Date.now() - startedAt,
      outcomes,
    };

    this.report(result, hasListingError);
    if (hasListingError) {
      throw new TenantIterationListingError(options.label, result, { cause: listingError });
    }
    return result;
  }

  private async runOne<T>(
    tenantKey: string,
    work: (context: TenantWorkContext) => Promise<T>,
    timeoutMs: number,
  ): Promise<TenantOutcome<T>> {
    const controller = new AbortController();
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ kind: "timeout" });
      }, timeoutMs);
    });
    // Both branches are handled here, so a rejection that arrives after the timeout is never an unhandled rejection.
    const settled = (async (): Promise<{ kind: "ok"; value: T } | { kind: "error"; error: unknown }> => {
      try {
        const value = await runWithTenantContext(tenantKey, () => work({ tenantKey, signal: controller.signal }));
        return { kind: "ok", value };
      } catch (error) {
        return { kind: "error", error };
      }
    })();
    const raced = await Promise.race([settled, timeout]);
    if (timer) {
      clearTimeout(timer);
    }
    const durationMs = Date.now() - startedAt;
    if (raced.kind === "ok") {
      return { tenantKey, outcome: "ok", durationMs, value: raced.value };
    }
    if (raced.kind === "error") {
      return { tenantKey, outcome: "failed", durationMs, ...errorFields(raced.error) };
    }
    return { tenantKey, outcome: "timed_out", durationMs };
  }

  private async *explicitSource(keys: string[]): AsyncGenerator<string> {
    for (const key of keys) {
      yield key;
    }
  }

  /**
   * The default tenant first, then the directory in keyset pages ordered by tenant key, so a large directory is never one
   * unbounded read and every page is cheap. WorkspaceDirectory is unscoped by design and is read through the default
   * tenant's client, as the rest of the codebase does.
   */
  private async *directorySource(
    pageSize: number,
    includeInactive: boolean,
    counters: { directoryTenants: number },
  ): AsyncGenerator<string> {
    const seen = new Set<string>();
    const first = normalizeTenantKey(DEFAULT_TENANT_KEY);
    seen.add(first);
    yield first;
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.tenant(DEFAULT_TENANT_KEY).workspaceDirectory.findMany({
        where: {
          ...(includeInactive ? {} : { isActive: true }),
          ...(cursor === undefined ? {} : { tenantKey: { gt: cursor } }),
        },
        orderBy: { tenantKey: "asc" },
        take: pageSize,
        select: { tenantKey: true },
      });
      counters.directoryTenants += rows.length;
      for (const row of rows) {
        const key = normalizeTenantKey(row.tenantKey);
        if (!seen.has(key)) {
          seen.add(key);
          yield key;
        }
      }
      if (rows.length < pageSize) {
        return;
      }
      cursor = rows[rows.length - 1].tenantKey;
    }
  }

  private report(result: TenantIterationResult<unknown>, listingFailed: boolean): void {
    const slowest = [...result.outcomes]
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 3)
      .map((outcome) => ({ tenantKey: outcome.tenantKey, durationMs: outcome.durationMs }));
    const summary = {
      event: "tenant.iteration",
      label: result.label,
      listed: result.listed,
      processed: result.processed,
      failed: result.failed,
      timedOut: result.timedOut,
      skipped: result.skipped,
      directoryTenants: result.directoryTenants,
      zeroTenants: result.zeroTenants,
      deadlineReached: result.deadlineReached,
      aborted: result.aborted,
      listingFailed,
      complete: result.complete,
      durationMs: result.durationMs,
      slowest,
    };
    if (result.zeroTenants || listingFailed || result.failed > 0 || result.timedOut > 0 || result.deadlineReached) {
      this.logger.warn(JSON.stringify(summary));
    } else {
      this.logger.log(JSON.stringify(summary));
    }
    if (result.directoryTenants === 0) {
      this.logger.warn(
        JSON.stringify({ event: "tenant.iteration.empty_directory", label: result.label, note: "only the default tenant is visited" }),
      );
    }
    const problems = result.outcomes.filter((outcome) => outcome.outcome !== "ok").slice(0, TENANT_ITERATION_DEFAULTS.maxLoggedFailures);
    for (const problem of problems) {
      this.logger.warn(
        JSON.stringify({
          event: "tenant.iteration.tenant_problem",
          label: result.label,
          tenantKey: problem.tenantKey,
          outcome: problem.outcome,
          errorName: problem.errorName,
          errorCode: problem.errorCode,
          durationMs: problem.durationMs,
        }),
      );
    }
  }
}
