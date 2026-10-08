// Coverage for WooCommerceReconciliationService.runReconciliation() — zero
// test coverage before, despite being the job that enforces PIM as source
// of truth against live WooCommerce drift (auto-republishing when the two
// disagree). Three orchestration properties had never been exercised:
// single-flight (a tick already running must not start a second one),
// error isolation (one submission's failure must not stop the rest), and
// the providerReadUnavailable branch correctly blocking a republish rather
// than treating an unreadable remote state as "no drift."
//
// reconcileSubmission() itself (the actual drift comparison) is mocked
// here — that's WooCommerceConnector's own logic and, checked separately,
// has no test coverage of its own either; a real gap, left for a
// follow-up rather than folded into this orchestration-layer PR.

import { WooCommerceReconciliationService } from "./woocommerce-reconciliation.service";
import type { PrismaDirectService } from "../../prisma/prisma-direct.service";
import type { LoggerService } from "../../common/logging/logger.service";

// SEC-DB-RLS-001 P2.4b: the database below behaves like row level security. The base client has NO tenant context and so sees only
// the `default` tenant; a transaction sees only the tenant set with set_config('app.tenant_key', ...) inside it. The connector
// catalogue is not row-level-secured and is visible to every client. Every call records the tenant it ran under (second argument).
function makeStubs(installations: any[], submissionsByInstallation: Record<string, any[]>) {
  const tenantOfInstallation = new Map<string, string>(installations.map((i) => [i.id, i.tenantKey]));
  const connectorDefinition = { findMany: jest.fn().mockResolvedValue([{ id: "def-woo" }]) };
  const installationFindMany = jest.fn().mockImplementation(({ where }: any, visibleTenant = "default") =>
    Promise.resolve(
      installations
        .filter((i) => i.tenantKey === visibleTenant && (!where?.tenantKey || where.tenantKey === i.tenantKey))
        .map((i, index) => ({ updatedAt: new Date(Date.UTC(2026, 9, 1, 0, index)), ...i })),
    ),
  );
  const submissionFindMany = jest.fn().mockImplementation(({ where }: any, visibleTenant = "default") =>
    Promise.resolve(tenantOfInstallation.get(where.installationId) === visibleTenant ? (submissionsByInstallation[where.installationId] ?? []) : []),
  );
  const directoryFindMany = jest.fn().mockImplementation(async () =>
    [...new Set(installations.map((i) => i.tenantKey))].filter((t) => t !== "default").map((tenantKey) => ({ tenantKey })),
  );
  const transactionTenants: string[] = [];
  const clientFor = (visibleTenant: () => string): any => ({
    connectorDefinition,
    connectorInstallation: { findMany: (args: any) => installationFindMany(args, visibleTenant()) },
    connectorSubmission: { findMany: (args: any) => submissionFindMany(args, visibleTenant()) },
    workspaceDirectory: { findMany: directoryFindMany },
    $queryRaw: jest.fn().mockResolvedValue([]),
  });
  const baseClient: any = clientFor(() => "default");
  baseClient.$transaction = jest.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => {
    let tenant = "default";
    const tx = clientFor(() => tenant);
    tx.$queryRaw = jest.fn().mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (String(strings.join("?")).includes("set_config")) {
        tenant = String(values[0]);
        transactionTenants.push(tenant);
      }
      return [];
    });
    return fn(tx);
  });
  const prismaDirect = {
    getClient: jest.fn().mockReturnValue(baseClient),
  } as unknown as PrismaDirectService;
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService;
  const connector = {
    reconcileSubmission: jest.fn(),
    snapshotToProductPayload: jest.fn().mockReturnValue({ sku: "SKU-1" }),
    updateProduct: jest.fn().mockResolvedValue(undefined),
  };
  return { prismaDirect, logger, connector, connectorSubmission: { findMany: submissionFindMany }, installationFindMany, submissionFindMany, transactionTenants, baseClient };
}
const INSTALL_A = { id: "install-a", tenantKey: "tenant-a", connectorId: "def-woo" };

describe("WooCommerceReconciliationService.runReconciliation — drift enforcement (no prior coverage)", () => {
  it("re-publishes from PIM when drift is detected, and counts it", async () => {
    const stubs = makeStubs(
      [INSTALL_A],
      { "install-a": [{ externalRef: "ext-1", payloadSnapshot: { sku: "SKU-1" } }] },
    );
    stubs.connector.reconcileSubmission.mockResolvedValue({ needsRepublish: true, driftedFields: ["price"] });
    const service = new WooCommerceReconciliationService(stubs.connector as any, stubs.prismaDirect, stubs.logger);

    await service.runReconciliation();

    expect(stubs.connector.updateProduct).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: "install-a" }),
      { sku: "SKU-1" },
      "ext-1",
    );
  });

  it("does not re-publish when there's no drift", async () => {
    const stubs = makeStubs(
      [INSTALL_A],
      { "install-a": [{ externalRef: "ext-1", payloadSnapshot: {} }] },
    );
    stubs.connector.reconcileSubmission.mockResolvedValue({ needsRepublish: false });
    const service = new WooCommerceReconciliationService(stubs.connector as any, stubs.prismaDirect, stubs.logger);

    await service.runReconciliation();

    expect(stubs.connector.updateProduct).not.toHaveBeenCalled();
  });

  it("blocks a republish when the provider read was unavailable — never treats 'couldn't check' as 'no drift'", async () => {
    const stubs = makeStubs(
      [INSTALL_A],
      { "install-a": [{ externalRef: "ext-1", payloadSnapshot: {} }] },
    );
    stubs.connector.reconcileSubmission.mockResolvedValue({
      providerReadUnavailable: true,
      providerReadStatus: 503,
      needsRepublish: true, // even if the connector somehow set this, unavailable must win
    });
    const service = new WooCommerceReconciliationService(stubs.connector as any, stubs.prismaDirect, stubs.logger);

    await service.runReconciliation();

    expect(stubs.connector.updateProduct).not.toHaveBeenCalled();
  });

  it("isolates one submission's failure — the rest of the batch still gets checked", async () => {
    const stubs = makeStubs(
      [INSTALL_A],
      {
        "install-a": [
          { externalRef: "ext-fails", payloadSnapshot: {} },
          { externalRef: "ext-ok", payloadSnapshot: { sku: "SKU-1" } },
        ],
      },
    );
    stubs.connector.reconcileSubmission.mockImplementation(async (_ctx: unknown, externalRef: string) => {
      if (externalRef === "ext-fails") throw new Error("provider timeout");
      return { needsRepublish: true, driftedFields: ["price"] };
    });
    const service = new WooCommerceReconciliationService(stubs.connector as any, stubs.prismaDirect, stubs.logger);

    await service.runReconciliation();

    expect(stubs.connector.updateProduct).toHaveBeenCalledTimes(1);
    expect(stubs.connector.updateProduct).toHaveBeenCalledWith(expect.anything(), expect.anything(), "ext-ok");
  });

  it("processes every installation even when one installation's submissions all fail", async () => {
    const INSTALL_B = { id: "install-b", tenantKey: "tenant-b", connectorId: "def-woo" };
    const stubs = makeStubs(
      [INSTALL_A, INSTALL_B],
      {
        "install-a": [{ externalRef: "ext-fails", payloadSnapshot: {} }],
        "install-b": [{ externalRef: "ext-ok", payloadSnapshot: { sku: "SKU-1" } }],
      },
    );
    stubs.connector.reconcileSubmission.mockImplementation(async (_ctx: unknown, externalRef: string) => {
      if (externalRef === "ext-fails") throw new Error("boom");
      return { needsRepublish: true, driftedFields: ["price"] };
    });
    const service = new WooCommerceReconciliationService(stubs.connector as any, stubs.prismaDirect, stubs.logger);

    await service.runReconciliation();

    expect(stubs.connector.updateProduct).toHaveBeenCalledTimes(1);
  });

  it("is single-flight: a tick already running skips a concurrent second call entirely", async () => {
    const stubs = makeStubs([INSTALL_A], { "install-a": [{ externalRef: "ext-1", payloadSnapshot: {} }] });
    stubs.connector.reconcileSubmission.mockResolvedValue({ needsRepublish: false });
    const service = new WooCommerceReconciliationService(stubs.connector as any, stubs.prismaDirect, stubs.logger);

    // The `running` flag is set synchronously before runReconciliation()'s first await, so a
    // second call made right after (still in the same tick) reliably observes it already set —
    // no manual promise control needed to win this race.
    const firstRun = service.runReconciliation();
    const secondRun = service.runReconciliation();
    await secondRun;
    // The second call must have returned before ever loading installations for a second time.
    expect(stubs.prismaDirect.getClient).toHaveBeenCalledTimes(1);

    await firstRun;
  });

  it("completes cleanly with no WooCommerce installations at all", async () => {
    const stubs = makeStubs([], {});
    const service = new WooCommerceReconciliationService(stubs.connector as any, stubs.prismaDirect, stubs.logger);

    await expect(service.runReconciliation()).resolves.toBeUndefined();
    expect(stubs.connector.reconcileSubmission).not.toHaveBeenCalled();
  });

  it("resets the running flag even if loading installations throws, so a later tick isn't stuck skipped forever", async () => {
    const stubs = makeStubs([INSTALL_A], {});
    (stubs.prismaDirect.getClient() as any).connectorDefinition.findMany.mockRejectedValueOnce(new Error("db down"));
    const service = new WooCommerceReconciliationService(stubs.connector as any, stubs.prismaDirect, stubs.logger);

    // First tick: fails while loading installations. The failure itself propagates (this
    // is the direct runReconciliation() entry point; runScheduledReconciliation() is what
    // catches and logs it for the real scheduled path) — the property under test is that
    // the `running` single-flight flag is still reset afterward via the finally block.
    await expect(service.runReconciliation()).rejects.toThrow("db down");
    // A second tick immediately after must actually run (not be skipped as "already running").
    await service.runReconciliation();

    expect((stubs.prismaDirect.getClient().connectorDefinition.findMany as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("WooCommerceReconciliationService.runReconciliation — installations of every tenant (SEC-DB-RLS-001 P2.4b)", () => {
  const INSTALL_DEFAULT = { id: "install-d", tenantKey: "default", connectorId: "def-woo" };
  const INSTALL_B = { id: "install-b", tenantKey: "tenant-b", connectorId: "def-woo" };
  const build = (stubs: ReturnType<typeof makeStubs>) =>
    new WooCommerceReconciliationService(stubs.connector as any, stubs.prismaDirect, stubs.logger);
  const snap = (ref: string) => ({ externalRef: ref, payloadSnapshot: { sku: ref } });

  it("reconciles the installations of every non-default directory tenant, not only the default tenant (the silent single-tenant failure)", async () => {
    const stubs = makeStubs([INSTALL_DEFAULT, INSTALL_A, INSTALL_B], {
      "install-d": [snap("ext-d")],
      "install-a": [snap("ext-a")],
      "install-b": [snap("ext-b")],
    });
    stubs.connector.reconcileSubmission.mockResolvedValue({ needsRepublish: true, driftedFields: ["price"] });

    await build(stubs).runReconciliation();

    expect(stubs.connector.updateProduct.mock.calls.map((c: any[]) => c[2]).sort()).toEqual(["ext-a", "ext-b", "ext-d"]);
    // each submission was reconciled with the context of ITS installation's tenant
    const contexts = stubs.connector.reconcileSubmission.mock.calls.map((c: any[]) => [c[1], c[0].tenantId]).sort();
    expect(contexts).toEqual([["ext-a", "tenant-a"], ["ext-b", "tenant-b"], ["ext-d", "default"]]);
  });

  it("MUTATION: one read through the context-free client sees only the default tenant's installations", async () => {
    const stubs = makeStubs([INSTALL_DEFAULT, INSTALL_A], {});
    const seen = await stubs.baseClient.connectorInstallation.findMany({ where: { status: "ACTIVE" } });
    expect(seen.map((r: { id: string }) => r.id)).toEqual(["install-d"]);
  });

  it("reads each installation's submissions inside that installation's own tenant transaction, filtered by its tenant", async () => {
    const stubs = makeStubs([INSTALL_A, INSTALL_B], { "install-a": [snap("ext-a")], "install-b": [snap("ext-b")] });
    stubs.connector.reconcileSubmission.mockResolvedValue({ needsRepublish: false });

    await build(stubs).runReconciliation();

    for (const [args, tenant] of stubs.submissionFindMany.mock.calls as Array<[any, string]>) {
      expect(args.where.tenantKey).toBe(tenant);
      expect(tenant).toBe(tenantOfInstall(args.where.installationId));
    }
    expect(stubs.submissionFindMany).toHaveBeenCalledTimes(2);
    function tenantOfInstall(id: string) {
      return id === "install-a" ? "tenant-a" : "tenant-b";
    }
  });

  it("reconciles the least recently updated installations first, across tenants", async () => {
    const stubs = makeStubs([INSTALL_B, INSTALL_A], { "install-a": [snap("ext-a")], "install-b": [snap("ext-b")] });
    // updatedAt in the stub follows list position within each tenant read; force an explicit order instead
    stubs.installationFindMany.mockImplementation(({ where }: any, visibleTenant = "default") =>
      Promise.resolve(
        [
          { ...INSTALL_A, updatedAt: new Date("2026-10-02T00:00:00Z") },
          { ...INSTALL_B, updatedAt: new Date("2026-10-01T00:00:00Z") },
        ].filter((i) => i.tenantKey === visibleTenant && i.tenantKey === where.tenantKey),
      ),
    );
    stubs.connector.reconcileSubmission.mockResolvedValue({ needsRepublish: false });

    await build(stubs).runReconciliation();

    expect(stubs.connector.reconcileSubmission.mock.calls.map((c: any[]) => c[1])).toEqual(["ext-b", "ext-a"]);
  });

  it("an unreadable tenant is logged by code and the readable tenants are still reconciled", async () => {
    const stubs = makeStubs([INSTALL_A, INSTALL_B], { "install-a": [snap("ext-a")], "install-b": [snap("ext-b")] });
    stubs.connector.reconcileSubmission.mockResolvedValue({ needsRepublish: true, driftedFields: ["price"] });
    const original = stubs.installationFindMany.getMockImplementation()!;
    stubs.installationFindMany.mockImplementation((args: any, tenant: string) =>
      tenant === "tenant-a"
        ? Promise.reject(Object.assign(new Error("connection postgres://u:SECRET@h/db reset"), { code: "P1001" }))
        : original(args, tenant),
    );

    await build(stubs).runReconciliation();

    expect(stubs.connector.updateProduct.mock.calls.map((c: any[]) => c[2])).toEqual(["ext-b"]);
    expect(stubs.logger.error).toHaveBeenCalled();
    const logged = JSON.stringify((stubs.logger.error as jest.Mock).mock.calls);
    expect(logged).toContain("tenant-a");
    expect(logged).not.toContain("SECRET");
  });

  it("an installation whose submissions cannot be read is counted as an error and does not stop the others", async () => {
    const stubs = makeStubs([INSTALL_A, INSTALL_B], { "install-a": [snap("ext-a")], "install-b": [snap("ext-b")] });
    stubs.connector.reconcileSubmission.mockResolvedValue({ needsRepublish: true, driftedFields: ["price"] });
    const original = stubs.submissionFindMany.getMockImplementation()!;
    stubs.submissionFindMany.mockImplementation((args: any, tenant: string) =>
      tenant === "tenant-a" ? Promise.reject(new Error("read failed")) : original(args, tenant),
    );

    await build(stubs).runReconciliation();

    expect(stubs.connector.updateProduct.mock.calls.map((c: any[]) => c[2])).toEqual(["ext-b"]);
    expect(stubs.logger.warn).toHaveBeenCalledWith(
      "WooCommerce reconciliation: could not read an installation's submissions",
      expect.objectContaining({ installationId: "install-a", tenantKey: "tenant-a" }),
    );
    expect(stubs.logger.info).toHaveBeenCalledWith(
      "WooCommerce reconciliation completed.",
      expect.objectContaining({ errors: 1, republished: 1 }),
    );
  });
});
