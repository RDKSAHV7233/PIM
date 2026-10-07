import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import { DEFAULT_TENANT_KEY } from "../common/tenant/tenant.constants";
import { IntelligenceReservationMaintenanceService } from "./intelligence-reservation-maintenance.service";

/**
 * SEC-DB-RLS-001: the AI reservation sweeper and the counter audit reach every tenant by explicit tenant iteration, never
 * through a session setting. The fake models what matters: the BASE client has no tenant context (a restricted role sees only
 * the default tenant, and here it has no reservation model at all, so any read outside a per-tenant transaction fails loudly),
 * and a transaction sees only the tenant set inside it with set_config.
 */

type Reservation = { tenantKey: string; status: string; expiresAt?: Date; leaseExpiresAt?: Date };
type Sweep = { scanned: number; cancelledUnclaimed: number; expiredDispatching: number; skipped: number };

const NOW = new Date("2026-10-07T12:00:00Z");
const PAST = new Date("2026-10-07T11:00:00Z");
const FUTURE = new Date("2026-10-07T13:00:00Z");
const ZERO: Sweep = { scanned: 0, cancelledUnclaimed: 0, expiredDispatching: 0, skipped: 0 };

function matches(row: Reservation, where: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(where)) {
    const value = (row as Record<string, unknown>)[key];
    if (condition && typeof condition === "object" && "lt" in (condition as object)) {
      if (!(value instanceof Date) || !(value < ((condition as { lt: Date }).lt))) return false;
    } else if (value !== condition) {
      return false;
    }
  }
  return true;
}

function makeDb(config: {
  directory?: string[];
  reservations?: Reservation[];
  failReadFor?: string[];
  failAuditFor?: string[];
  policyRows?: Record<string, unknown[]>;
  platformRows?: Record<string, unknown[]>;
  periods?: unknown[];
  gate?: Promise<void>;
}) {
  const reservations = config.reservations ?? [];
  const counts: Array<{ tenant: string; where: Record<string, unknown> }> = [];
  const transactionTenants: string[] = [];
  const base = {
    // No aiProviderBudgetReservation here on purpose: a read through the base client is a context-free read.
    workspaceDirectory: { findMany: jest.fn(async () => (config.directory ?? []).map((tenantKey) => ({ tenantKey }))) },
    aiPlatformBudgetPeriod: { findMany: jest.fn(async () => config.periods ?? []) },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      let tenant = DEFAULT_TENANT_KEY;
      const tx = {
        aiProviderBudgetReservation: {
          count: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
            if (config.gate) {
              await config.gate;
            }
            counts.push({ tenant, where });
            if ((config.failReadFor ?? []).includes(tenant)) {
              throw Object.assign(new Error("customer detail that must never be logged"), { code: "P2024" });
            }
            // Row level security: the transaction sees only its own tenant.
            return reservations.filter((r) => r.tenantKey === tenant).filter((r) => matches(r, where)).length;
          }),
        },
        $queryRaw: jest.fn(async (arg: unknown, ...values: unknown[]) => {
          if (Array.isArray(arg)) {
            if (arg.join("?").includes("set_config")) {
              // forEachTenant calls this as a tagged template: the tenant is the first interpolated value.
              tenant = String(values[0]);
              transactionTenants.push(tenant);
            }
            return [];
          }
          const text = ((arg as { strings: string[] }).strings ?? []).join("?");
          if ((config.failAuditFor ?? []).includes(tenant)) {
            throw Object.assign(new Error("audit read failed with detail"), { code: "P2034" });
          }
          if (text.includes('FROM "ai_provider_budget_policies"')) {
            return (config.policyRows ?? {})[tenant] ?? [];
          }
          if (text.includes('FROM "ai_provider_budget_charges"')) {
            return (config.platformRows ?? {})[tenant] ?? [];
          }
          return [];
        }),
      };
      return fn(tx);
    }),
  };
  return { base, counts, transactionTenants };
}

function makeService(
  config: Parameters<typeof makeDb>[0],
  sweep: (tenantKey: string) => Promise<Sweep> | Sweep = () => ZERO,
) {
  const db = makeDb(config);
  const control = { sweepExpired: jest.fn(async ({ tenantKey }: { tenantKey: string }) => sweep(tenantKey)) };
  const prismaDirect = { getClient: jest.fn(() => db.base) };
  const service = new IntelligenceReservationMaintenanceService(prismaDirect as never, control as never);
  return { service, db, control };
}

describe("IntelligenceReservationMaintenanceService: the sweeper reaches every tenant by explicit iteration", () => {
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    log = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("finds and sweeps a NON-default tenant's expired reservation (the positive result a global scan would silently miss)", async () => {
    const { service, control } = makeService(
      { directory: ["tenant-a", "tenant-b"], reservations: [{ tenantKey: "tenant-b", status: "reserved", expiresAt: PAST }] },
      () => ({ scanned: 1, cancelledUnclaimed: 1, expiredDispatching: 0, skipped: 0 }),
    );
    const summary = await service.runSweep({ now: NOW });
    expect(control.sweepExpired).toHaveBeenCalledTimes(1);
    expect(control.sweepExpired).toHaveBeenCalledWith({ tenantKey: "tenant-b" });
    expect(summary).toMatchObject({ tenants: 1, scanned: 1, cancelledUnclaimed: 1, tenantsFailed: 0 });
    expect(summary.tenantsEvaluated).toBe(3); // the default tenant plus the two directory tenants
  });

  it("sweeps each tenant that has work and skips tenants that do not, and sums the results", async () => {
    const { service, control } = makeService(
      {
        directory: ["a", "b", "c"],
        reservations: [
          { tenantKey: "a", status: "reserved", expiresAt: PAST },
          { tenantKey: "b", status: "dispatching", leaseExpiresAt: PAST },
          { tenantKey: "c", status: "reserved", expiresAt: FUTURE },
          { tenantKey: DEFAULT_TENANT_KEY, status: "reserved", expiresAt: PAST },
        ],
      },
      () => ({ scanned: 2, cancelledUnclaimed: 1, expiredDispatching: 1, skipped: 0 }),
    );
    const summary = await service.runSweep({ now: NOW });
    expect(control.sweepExpired.mock.calls.map((c) => c[0].tenantKey).sort()).toEqual([DEFAULT_TENANT_KEY, "a", "b"].sort());
    expect(summary).toMatchObject({ tenants: 3, scanned: 6, cancelledUnclaimed: 3, expiredDispatching: 3 });
  });

  it("looks for expired work only inside each tenant's own transaction and always filters by that tenant key explicitly", async () => {
    const { service, db } = makeService({
      directory: ["a", "b"],
      reservations: [{ tenantKey: "a", status: "reserved", expiresAt: PAST }],
    });
    await service.runSweep({ now: NOW });
    expect(db.transactionTenants.sort()).toEqual([DEFAULT_TENANT_KEY, "a", "b"].sort());
    expect(db.counts.length).toBe(6); // two counts per tenant
    for (const entry of db.counts) {
      // The explicit key matters today (the production role bypasses RLS) and after the cutover (RLS enforced): both give one tenant.
      expect(entry.where.tenantKey).toBe(entry.tenant);
    }
  });

  it("does not sweep a reservation that has not expired yet", async () => {
    const { service, control } = makeService({
      directory: ["a"],
      reservations: [{ tenantKey: "a", status: "reserved", expiresAt: FUTURE }],
    });
    const summary = await service.runSweep({ now: NOW });
    expect(control.sweepExpired).not.toHaveBeenCalled();
    expect(summary.tenants).toBe(0);
  });

  it("sweeps at most 50 tenants per tick, in tenant order, and leaves the rest for the next tick", async () => {
    const keys = Array.from({ length: 60 }, (_, i) => `t${String(i).padStart(3, "0")}`);
    const { service, control } = makeService({
      directory: keys,
      reservations: keys.map((tenantKey) => ({ tenantKey, status: "reserved", expiresAt: PAST })),
    });
    const summary = await service.runSweep({ now: NOW });
    expect(control.sweepExpired).toHaveBeenCalledTimes(50);
    expect(summary.tenants).toBe(50);
    expect(control.sweepExpired.mock.calls[0][0].tenantKey).toBe("t000");
  });

  it("a tenant that cannot be read is counted, logged by code only, and never treated as 'nothing expired'", async () => {
    const { service, control } = makeService({
      directory: ["good", "bad"],
      failReadFor: ["bad"],
      reservations: [
        { tenantKey: "good", status: "reserved", expiresAt: PAST },
        { tenantKey: "bad", status: "reserved", expiresAt: PAST },
      ],
    });
    const summary = await service.runSweep({ now: NOW });
    expect(summary.tenantsFailed).toBe(1);
    expect(control.sweepExpired).toHaveBeenCalledWith({ tenantKey: "good" });
    expect(control.sweepExpired).not.toHaveBeenCalledWith({ tenantKey: "bad" });
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("ai.provider.sweep.discovery_degraded");
    expect(logged).toContain("P2024");
    expect(logged).not.toContain("customer detail that must never be logged");
  });

  it("one tenant's sweep failing does not stop the others, and is counted without its message", async () => {
    const { service, control } = makeService(
      {
        directory: ["boom", "fine"],
        reservations: [
          { tenantKey: "boom", status: "reserved", expiresAt: PAST },
          { tenantKey: "fine", status: "reserved", expiresAt: PAST },
        ],
      },
      (tenantKey) => {
        if (tenantKey === "boom") {
          throw new TypeError("row value that must never be logged");
        }
        return { scanned: 1, cancelledUnclaimed: 1, expiredDispatching: 0, skipped: 0 };
      },
    );
    const summary = await service.runSweep({ now: NOW });
    expect(control.sweepExpired).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ tenantsFailed: 1, scanned: 1, cancelledUnclaimed: 1 });
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("ai.provider.sweep.tenant_failed");
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("row value that must never be logged");
    expect(log).toHaveBeenCalled();
  });

  it("returns an empty summary instead of overlapping when a sweep is already running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { service } = makeService({ directory: ["a"], reservations: [], gate });
    const first = service.runSweep({ now: NOW });
    const second = await service.runSweep({ now: NOW });
    expect(second).toMatchObject({ tenants: 0, tenantsEvaluated: 0, scanned: 0 });
    release();
    await first;
  });
});

describe("IntelligenceReservationMaintenanceService: the counter audit adds every tenant's share", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const share = (id: string, reserved: bigint, spent: bigint, requests: bigint, scope = "platform_day") => ({
    id,
    expected_reserved: reserved,
    expected_spent: spent,
    expected_requests: requests,
    scope,
  });
  const period = (id: string, reserved: bigint, spent: bigint, requests: number) => ({
    id,
    reservedSpendMicros: reserved,
    spentSpendMicros: spent,
    requestCount: requests,
  });

  it("is clean when the platform counter equals the sum of ALL tenants' shares (not just the default tenant's)", async () => {
    const { service } = makeService({
      directory: ["a", "b"],
      platformRows: {
        [DEFAULT_TENANT_KEY]: [share("p1", 5n, 1n, 1n)],
        a: [share("p1", 10n, 2n, 2n)],
        b: [share("p1", 20n, 4n, 3n)],
      },
      periods: [period("p1", 35n, 7n, 6)],
    });
    expect(await service.auditCounters()).toEqual([]);
  });

  it("reports platform drift, with the recorded and the expected value", async () => {
    const { service } = makeService({
      directory: ["a", "b"],
      platformRows: { a: [share("p1", 10n, 2n, 2n)], b: [share("p1", 20n, 4n, 3n)] },
      periods: [period("p1", 31n, 6n, 5)],
    });
    // Only `reserved` differs (31 recorded against 10 + 20); spent (6 = 2 + 4) and requests (5 = 2 + 3) agree.
    expect(await service.auditCounters()).toEqual([
      { scope: "platform_day", counterRowId: "p1", field: "reserved", recorded: "31", expected: "30" },
    ]);
  });

  it("falls back to the first platform scope for a counter that has no charges, and reports its drift", async () => {
    const { service } = makeService({ directory: [], periods: [period("lonely", 5n, 0n, 0)] });
    expect(await service.auditCounters()).toEqual([
      { scope: "platform_day", counterRowId: "lonely", field: "reserved", recorded: "5", expected: "0" },
    ]);
  });

  it("reports tenant counter drift from that tenant's own audit, sorted deterministically", async () => {
    const drift = (id: string, scope: string, recordedReserved: bigint, expectedReserved: bigint) => ({
      id,
      scope,
      recorded_reserved: recordedReserved,
      expected_reserved: expectedReserved,
      recorded_spent: 0n,
      expected_spent: 0n,
      recorded_requests: 0,
      expected_requests: 0n,
    });
    const { service } = makeService({
      directory: ["a", "b"],
      policyRows: { a: [drift("pol-a", "tenant_month", 9n, 2n)], b: [drift("pol-b", "tenant_day", 4n, 1n)] },
      periods: [],
    });
    const rows = await service.auditCounters();
    // Tenant "a" is read first, but its row sorts after tenant "b"'s: the order is by scope, not by the order tenants finished.
    expect(rows).toEqual([
      { scope: "tenant_day", counterRowId: "pol-b", field: "reserved", recorded: "4", expected: "1" },
      { scope: "tenant_month", counterRowId: "pol-a", field: "reserved", recorded: "9", expected: "2" },
    ]);
  });

  it("throws, rather than reporting a clean audit, when a tenant could not be read", async () => {
    const { service } = makeService({
      directory: ["a", "bad"],
      failAuditFor: ["bad"],
      platformRows: { a: [share("p1", 10n, 0n, 1n)] },
      periods: [period("p1", 10n, 0n, 1)],
    });
    await expect(service.auditCounters()).rejects.toThrow(/AI counter audit incomplete: 1 of 3 tenants could not be read/);
  });
});

describe("IntelligenceReservationMaintenanceService: no session-setting path remains", () => {
  it("never sets or reads app.ai_maintenance and does not use a maintenance read", () => {
    const source = readFileSync(join(__dirname, "intelligence-reservation-maintenance.service.ts"), "utf8");
    // The comments explain the retirement, so strip them before checking the code itself.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/ai_maintenance/);
    expect(code).not.toMatch(/set_config/);
    expect(code).not.toMatch(/withMaintenanceRead/);
  });

  it("reads tenant data only through forEachTenant transactions", () => {
    const source = readFileSync(join(__dirname, "intelligence-reservation-maintenance.service.ts"), "utf8");
    expect(source).toMatch(/forEachTenant\(/);
    expect(source).not.toMatch(/aiProviderBudgetReservation\.findMany/);
  });
});
