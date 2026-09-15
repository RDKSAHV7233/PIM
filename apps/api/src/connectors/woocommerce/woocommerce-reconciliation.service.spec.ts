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

function makeStubs(installations: any[], submissionsByInstallation: Record<string, any[]>) {
  const connectorDefinition = { findMany: jest.fn().mockResolvedValue([{ id: "def-woo" }]) };
  const connectorInstallation = { findMany: jest.fn().mockResolvedValue(installations) };
  const connectorSubmission = {
    findMany: jest.fn().mockImplementation(({ where }: any) =>
      Promise.resolve(submissionsByInstallation[where.installationId] ?? []),
    ),
  };
  const prismaDirect = {
    getClient: jest.fn().mockReturnValue({ connectorDefinition, connectorInstallation, connectorSubmission }),
  } as unknown as PrismaDirectService;
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService;
  const connector = {
    reconcileSubmission: jest.fn(),
    snapshotToProductPayload: jest.fn().mockReturnValue({ sku: "SKU-1" }),
    updateProduct: jest.fn().mockResolvedValue(undefined),
  };
  return { prismaDirect, logger, connector, connectorSubmission };
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
