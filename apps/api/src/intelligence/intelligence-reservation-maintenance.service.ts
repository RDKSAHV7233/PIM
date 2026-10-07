import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { runWithAdvisoryLock } from "../common/scheduling/advisory-lock";
import { forEachTenant } from "../common/tenant/tenant-iteration";
import { PrismaDirectService } from "../prisma/prisma-direct.service";
import { IntelligenceExecutionControlService } from "./intelligence-execution-control.service";
import type { ProviderCounterAuditRow, ProviderReservationSweepSummary } from "./intelligence.types";

/**
 * AI-PROV-004b-i: scheduled reservation sweeper and counter audit.
 *
 * Sweeping on admission (IntelligenceExecutionControlService.admit) covers a busy system. This scheduled watchdog
 * covers a quiet one, so a reservation cannot stay unresolved until the next request. It performs the same
 * compare-and-set transitions as the admission sweep and therefore adds no new correctness rule.
 *
 * Lifecycle mirrors the other recovery sweepers: OnModuleInit/OnModuleDestroy, an initial delay, an unref'd
 * interval, an advisory lock so only one replica runs a tick, and a public method that tests can call directly.
 *
 * SEC-DB-RLS-001: both the sweeper and the audit look across tenants, and they do it by explicit tenant iteration
 * (forEachTenant: one transaction per tenant, tenant context set inside it, every query on that transaction). They
 * no longer read through a session setting. A setting that the ordinary runtime can set is not a separately governed
 * path, so the former `app.ai_maintenance` marker is retired. Every query here also filters by the tenant key
 * explicitly, so the result is the same whether or not the role in use is subject to row level security. The
 * transitions themselves go through the tenant-scoped client, one tenant at a time, as before.
 */

const SWEEP_INTERVAL_MS = 60 * 1000;
const SWEEP_INITIAL_DELAY_MS = 60 * 1000;
const SWEEP_LOCK_NAME = "ai-provider-reservation-sweeper";
const TENANT_BATCH = 50;

export type ReservationMaintenanceSummary = ProviderReservationSweepSummary & {
  /** Tenants that had expired work and were swept this tick. */
  tenants: number;
  /** Tenants whose expired work was looked for. */
  tenantsEvaluated: number;
  /** Tenants that could not be read or could not be swept. Non-zero means the tick was degraded. */
  tenantsFailed: number;
};

type ExpectedCounter = { reserved: bigint; spent: bigint; requests: bigint; scope: string | null };

type DriftRow = {
  id: string;
  scope: string | null;
  recorded_reserved: bigint;
  expected_reserved: bigint;
  recorded_spent: bigint;
  expected_spent: bigint;
  recorded_requests: number;
  expected_requests: bigint;
};

const TENANT_SCOPES = ["tenant_day", "tenant_month"] as const;
const PLATFORM_SCOPES = ["platform_day", "platform_month"] as const;

@Injectable()
export class IntelligenceReservationMaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IntelligenceReservationMaintenanceService.name);
  private initialTimeout: NodeJS.Timeout | null = null;
  private intervalHandle: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prismaDirect: PrismaDirectService,
    private readonly control: IntelligenceExecutionControlService,
  ) {}

  onModuleInit(): void {
    if (String(process.env.AI_RESERVATION_SWEEP_DISABLED ?? "").trim().toLowerCase() === "true") {
      this.logger.log("AI reservation sweeper disabled via AI_RESERVATION_SWEEP_DISABLED.");
      return;
    }
    this.initialTimeout = setTimeout(() => {
      void this.runScheduledSweep();
      this.intervalHandle = setInterval(() => void this.runScheduledSweep(), SWEEP_INTERVAL_MS);
      this.intervalHandle.unref();
    }, SWEEP_INITIAL_DELAY_MS);
    this.initialTimeout.unref();
  }

  onModuleDestroy(): void {
    if (this.initialTimeout) {
      clearTimeout(this.initialTimeout);
      this.initialTimeout = null;
    }
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async runScheduledSweep(): Promise<void> {
    try {
      await runWithAdvisoryLock(SWEEP_LOCK_NAME, async () => {
        await this.runSweep();
      });
    } catch (error) {
      this.logger.error(`AI reservation sweep failed: ${error instanceof Error ? error.name : "unknown_error"}`);
    }
  }

  /** Sweeps every tenant that has an expired non-terminal reservation. Returns summed counts. */
  async runSweep(options: { now?: Date } = {}): Promise<ReservationMaintenanceSummary> {
    const total: ReservationMaintenanceSummary = {
      scanned: 0,
      cancelledUnclaimed: 0,
      expiredDispatching: 0,
      skipped: 0,
      tenants: 0,
      tenantsEvaluated: 0,
      tenantsFailed: 0,
    };
    if (this.running) {
      return total;
    }
    this.running = true;
    try {
      const now = options.now ?? new Date();
      const withWork: string[] = [];
      const discovery = await forEachTenant(this.prismaDirect.getClient(), async (tx, tenantKey) => {
        const unclaimed = await tx.aiProviderBudgetReservation.count({
          where: { tenantKey, status: "reserved", expiresAt: { lt: now } },
        });
        const dispatching = await tx.aiProviderBudgetReservation.count({
          where: { tenantKey, status: "dispatching", leaseExpiresAt: { lt: now } },
        });
        if (unclaimed + dispatching > 0) {
          withWork.push(tenantKey);
        }
        return { examinedCount: unclaimed + dispatching, changedCount: 0 };
      });
      total.tenantsEvaluated = discovery.tenantsEvaluated;
      total.tenantsFailed = discovery.tenantsFailed;
      if (discovery.overall !== "SUCCESS") {
        // A tenant that could not be read is not treated as "nothing expired": it is counted, logged, and retried next tick.
        this.logger.warn(
          JSON.stringify({
            event: "ai.provider.sweep.discovery_degraded",
            overall: discovery.overall,
            tenantsEvaluated: discovery.tenantsEvaluated,
            tenantsFailed: discovery.tenantsFailed,
            errorCodes: [...new Set(discovery.results.filter((r) => r.status === "failed").map((r) => r.errorCode ?? "UNKNOWN_ERROR"))],
          }),
        );
      }
      const tenants = withWork.sort().slice(0, TENANT_BATCH);
      total.tenants = tenants.length;
      for (const tenantKey of tenants) {
        try {
          const summary = await this.control.sweepExpired({ tenantKey });
          total.scanned += summary.scanned;
          total.cancelledUnclaimed += summary.cancelledUnclaimed;
          total.expiredDispatching += summary.expiredDispatching;
          total.skipped += summary.skipped;
        } catch (error) {
          // One tenant failing must not stop the others; it is counted and the next tick retries it.
          total.tenantsFailed += 1;
          this.logger.warn(
            JSON.stringify({ event: "ai.provider.sweep.tenant_failed", tenantKey, errorName: error instanceof Error ? error.name : "unknown_error" }),
          );
        }
      }
      if (total.scanned > 0 || total.tenantsFailed > 0) {
        this.logger.log(JSON.stringify({ event: "ai.provider.sweep", ...total }));
      }
      return total;
    } finally {
      this.running = false;
    }
  }

  /**
   * Read-only counter audit. The invariant: for every counter, `reserved` equals the sum of the charges of
   * reservations that are `reserved` or `dispatching`, `spent` equals the settled amounts of `reconciled` and `expired`
   * reservations, and `request_count` equals the number of charges that were admitted and not cancelled. It reports
   * drift and never repairs it.
   *
   * Tenant counters are audited tenant by tenant. A platform counter aggregates the charges of every tenant, so each
   * tenant contributes its own sums and the totals are compared once, after all tenants have been read. If any tenant
   * cannot be read the audit throws: a partial audit that reported "clean" would be the silent failure this avoids.
   */
  async auditCounters(): Promise<ProviderCounterAuditRow[]> {
    const client = this.prismaDirect.getClient();
    const rows: ProviderCounterAuditRow[] = [];
    const platformExpected = new Map<string, ExpectedCounter>();
    const iteration = await forEachTenant(client, async (tx, tenantKey) => {
      const drift = await this.auditTenantCounters(tx, tenantKey);
      for (const row of drift.rows) {
        rows.push(row);
      }
      await this.addPlatformContribution(tx, tenantKey, platformExpected);
      return { examinedCount: drift.examined, changedCount: 0 };
    });
    if (iteration.overall !== "SUCCESS") {
      throw new Error(
        `AI counter audit incomplete: ${iteration.tenantsFailed} of ${iteration.tenantsEvaluated} tenants could not be read.`,
      );
    }

    // ai_platform_budget_periods is a platform table with no row level security and no tenant key, so it is read once.
    const periods = await client.aiPlatformBudgetPeriod.findMany({
      select: { id: true, reservedSpendMicros: true, spentSpendMicros: true, requestCount: true },
    });
    for (const period of periods) {
      const expected = platformExpected.get(period.id) ?? { reserved: 0n, spent: 0n, requests: 0n, scope: null };
      const scope = (expected.scope ?? PLATFORM_SCOPES[0]) as ProviderCounterAuditRow["scope"];
      if (period.reservedSpendMicros !== expected.reserved) {
        rows.push({ scope, counterRowId: period.id, field: "reserved", recorded: period.reservedSpendMicros.toString(), expected: expected.reserved.toString() });
      }
      if (period.spentSpendMicros !== expected.spent) {
        rows.push({ scope, counterRowId: period.id, field: "spent", recorded: period.spentSpendMicros.toString(), expected: expected.spent.toString() });
      }
      if (BigInt(period.requestCount) !== expected.requests) {
        rows.push({ scope, counterRowId: period.id, field: "requests", recorded: String(period.requestCount), expected: expected.requests.toString() });
      }
    }
    return rows.sort(
      (a, b) => a.scope.localeCompare(b.scope) || a.counterRowId.localeCompare(b.counterRowId) || a.field.localeCompare(b.field),
    );
  }

  /** One tenant's budget-policy counters against that tenant's own charges and reservations. */
  private async auditTenantCounters(
    tx: Prisma.TransactionClient,
    tenantKey: string,
  ): Promise<{ rows: ProviderCounterAuditRow[]; examined: number }> {
    // RLS-BYPASS: runs on the per-tenant transaction (tenant context already set) and filters by the tenant key explicitly. Read-only aggregate.
    const drift = await tx.$queryRaw<DriftRow[]>(Prisma.sql`
      SELECT
        p."id" AS "id",
        p."reserved_spend_micros" AS "recorded_reserved",
        COALESCE(SUM(c."amount_micros") FILTER (WHERE r."status" IN ('reserved', 'dispatching')), 0)::bigint AS "expected_reserved",
        p."spent_spend_micros" AS "recorded_spent",
        COALESCE(SUM(c."settled_amount_micros") FILTER (WHERE r."status" IN ('reconciled', 'expired')), 0)::bigint AS "expected_spent",
        p."request_count" AS "recorded_requests",
        COUNT(c."id") FILTER (WHERE r."status" IN ('reserved', 'dispatching', 'reconciled', 'expired')) AS "expected_requests",
        MIN(c."scope") AS "scope"
      FROM "ai_provider_budget_policies" p
      LEFT JOIN "ai_provider_budget_charges" c
        ON c."counter_row_id" = p."id" AND c."scope" IN (${Prisma.join([...TENANT_SCOPES])}) AND c."tenant_key" = ${tenantKey}
      LEFT JOIN "ai_provider_budget_reservations" r
        ON r."id" = c."reservation_id" AND r."tenant_key" = ${tenantKey}
      WHERE p."tenant_key" = ${tenantKey}
      GROUP BY p."id", p."reserved_spend_micros", p."spent_spend_micros", p."request_count"
    `);
    const rows: ProviderCounterAuditRow[] = [];
    for (const row of drift) {
      const scope = (row.scope ?? TENANT_SCOPES[0]) as ProviderCounterAuditRow["scope"];
      if (row.recorded_reserved !== row.expected_reserved) {
        rows.push({ scope, counterRowId: row.id, field: "reserved", recorded: row.recorded_reserved.toString(), expected: row.expected_reserved.toString() });
      }
      if (row.recorded_spent !== row.expected_spent) {
        rows.push({ scope, counterRowId: row.id, field: "spent", recorded: row.recorded_spent.toString(), expected: row.expected_spent.toString() });
      }
      if (BigInt(row.recorded_requests) !== row.expected_requests) {
        rows.push({ scope, counterRowId: row.id, field: "requests", recorded: String(row.recorded_requests), expected: row.expected_requests.toString() });
      }
    }
    return { rows, examined: drift.length };
  }

  /** This tenant's share of every platform counter, added into the running totals. */
  private async addPlatformContribution(
    tx: Prisma.TransactionClient,
    tenantKey: string,
    totals: Map<string, ExpectedCounter>,
  ): Promise<void> {
    // RLS-BYPASS: runs on the per-tenant transaction (tenant context already set) and filters by the tenant key explicitly. Read-only aggregate.
    const sums = await tx.$queryRaw<
      Array<{ id: string; expected_reserved: bigint; expected_spent: bigint; expected_requests: bigint; scope: string | null }>
    >(Prisma.sql`
      SELECT
        c."counter_row_id" AS "id",
        COALESCE(SUM(c."amount_micros") FILTER (WHERE r."status" IN ('reserved', 'dispatching')), 0)::bigint AS "expected_reserved",
        COALESCE(SUM(c."settled_amount_micros") FILTER (WHERE r."status" IN ('reconciled', 'expired')), 0)::bigint AS "expected_spent",
        COUNT(c."id") FILTER (WHERE r."status" IN ('reserved', 'dispatching', 'reconciled', 'expired')) AS "expected_requests",
        MIN(c."scope") AS "scope"
      FROM "ai_provider_budget_charges" c
      LEFT JOIN "ai_provider_budget_reservations" r
        ON r."id" = c."reservation_id" AND r."tenant_key" = ${tenantKey}
      WHERE c."tenant_key" = ${tenantKey} AND c."scope" IN (${Prisma.join([...PLATFORM_SCOPES])})
      GROUP BY c."counter_row_id"
    `);
    for (const row of sums) {
      const current = totals.get(row.id) ?? { reserved: 0n, spent: 0n, requests: 0n, scope: null };
      current.reserved += row.expected_reserved;
      current.spent += row.expected_spent;
      current.requests += row.expected_requests;
      if (row.scope !== null && (current.scope === null || row.scope < current.scope)) {
        current.scope = row.scope;
      }
      totals.set(row.id, current);
    }
  }
}
