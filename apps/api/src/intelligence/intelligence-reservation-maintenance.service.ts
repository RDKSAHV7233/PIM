import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { runWithAdvisoryLock } from "../common/scheduling/advisory-lock";
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
 * Discovery of which tenants have expired work uses the direct client, because it must look across tenants. The
 * transitions themselves always go through the tenant-scoped client, one tenant at a time.
 */

const SWEEP_INTERVAL_MS = 60 * 1000;
const SWEEP_INITIAL_DELAY_MS = 60 * 1000;
const SWEEP_LOCK_NAME = "ai-provider-reservation-sweeper";
const TENANT_BATCH = 50;

export type ReservationMaintenanceSummary = ProviderReservationSweepSummary & { tenants: number };

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
    const total: ReservationMaintenanceSummary = { scanned: 0, cancelledUnclaimed: 0, expiredDispatching: 0, skipped: 0, tenants: 0 };
    if (this.running) {
      return total;
    }
    this.running = true;
    try {
      const now = options.now ?? new Date();
      const [unclaimed, dispatching] = await this.withMaintenanceRead((client) => Promise.all([
        client.aiProviderBudgetReservation.findMany({
          where: { status: "reserved", expiresAt: { lt: now } },
          distinct: ["tenantKey"],
          select: { tenantKey: true },
          take: TENANT_BATCH,
        }),
        client.aiProviderBudgetReservation.findMany({
          where: { status: "dispatching", leaseExpiresAt: { lt: now } },
          distinct: ["tenantKey"],
          select: { tenantKey: true },
          take: TENANT_BATCH,
        }),
      ]));
      const tenants = [...new Set([...unclaimed, ...dispatching].map((row) => row.tenantKey))];
      total.tenants = tenants.length;
      for (const tenantKey of tenants) {
        const summary = await this.control.sweepExpired({ tenantKey });
        total.scanned += summary.scanned;
        total.cancelledUnclaimed += summary.cancelledUnclaimed;
        total.expiredDispatching += summary.expiredDispatching;
        total.skipped += summary.skipped;
      }
      if (total.scanned > 0) {
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
   */
  async auditCounters(): Promise<ProviderCounterAuditRow[]> {
    return this.withMaintenanceRead((client) => this.auditCountersIn(client));
  }

  /**
   * The explicit, read-only maintenance path. These tables force row level security, so a connection with no tenant
   * context sees only the default tenant. The marker below is transaction-local and is honoured only by SELECT policies
   * (see the migration): it cannot insert, update or delete, and it does not depend on owner or BYPASSRLS behaviour.
   */
  private async withMaintenanceRead<T>(work: (client: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prismaDirect.getClient().$transaction(
      async (tx) => {
        // RLS-BYPASS: sets the transaction-local, SELECT-only maintenance marker; it reads no tenant data itself.
        await tx.$queryRaw`SELECT set_config('app.ai_maintenance', 'on', true)`;
        return work(tx);
      },
      { maxWait: 5000, timeout: 30000 },
    );
  }

  private async auditCountersIn(client: Prisma.TransactionClient): Promise<ProviderCounterAuditRow[]> {
    const rows: ProviderCounterAuditRow[] = [];
    const tables: Array<{ table: "ai_provider_budget_policies" | "ai_platform_budget_periods"; scopes: string[] }> = [
      { table: "ai_provider_budget_policies", scopes: ["tenant_day", "tenant_month"] },
      { table: "ai_platform_budget_periods", scopes: ["platform_day", "platform_month"] },
    ];
    for (const { table, scopes } of tables) {
      // RLS-BYPASS: operator audit across tenants by design. Read-only aggregate, no writes, table names are fixed constants.
      const drift = await client.$queryRaw<
        Array<{
          id: string;
          scope: string | null;
          recorded_reserved: bigint;
          expected_reserved: bigint;
          recorded_spent: bigint;
          expected_spent: bigint;
          recorded_requests: number;
          expected_requests: bigint;
        }>
      >(Prisma.sql`
        SELECT
          p."id" AS "id",
          p."reserved_spend_micros" AS "recorded_reserved",
          COALESCE(SUM(c."amount_micros") FILTER (WHERE r."status" IN ('reserved', 'dispatching')), 0)::bigint AS "expected_reserved",
          p."spent_spend_micros" AS "recorded_spent",
          COALESCE(SUM(c."settled_amount_micros") FILTER (WHERE r."status" IN ('reconciled', 'expired')), 0)::bigint AS "expected_spent",
          p."request_count" AS "recorded_requests",
          COUNT(c."id") FILTER (WHERE r."status" IN ('reserved', 'dispatching', 'reconciled', 'expired')) AS "expected_requests",
          MIN(c."scope") AS "scope"
        FROM ${Prisma.raw(`"${table}"`)} p
        LEFT JOIN "ai_provider_budget_charges" c ON c."counter_row_id" = p."id" AND c."scope" IN (${Prisma.join(scopes)})
        LEFT JOIN "ai_provider_budget_reservations" r ON r."id" = c."reservation_id"
        GROUP BY p."id", p."reserved_spend_micros", p."spent_spend_micros", p."request_count"
      `);
      for (const row of drift) {
        const scope = (row.scope ?? scopes[0]) as ProviderCounterAuditRow["scope"];
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
    }
    return rows;
  }
}
