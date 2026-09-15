// Coverage for WooCommerceBulkPublishService.executeBulkPublish() — zero
// test coverage before, despite being a checkpoint-resumable, fault-isolated
// bulk operation. This session already found and fixed a real count-
// integrity bug in a different bulk-publish path (PIM#661, marketplace
// .service.ts) — the same class of correctness risk (does success + failed
// + skipped always equal the input count? does one item's failure ever
// silently drop or duplicate another item's result?) had never been checked
// here.

import { WooCommerceBulkPublishService } from "./woocommerce-bulk-publish.service";
import type { WooCommerceConnector } from "./woocommerce.connector";
import type { PrismaDirectService } from "../../prisma/prisma-direct.service";
import type { ConnectorContext, ProductPayload } from "../../connector-framework/connector.interface";

function makeStubs(existingSuccessProductIds: Set<string> = new Set()) {
  const upserts: any[] = [];
  const connectorSubmission = {
    findFirst: jest.fn().mockImplementation(({ where }: any) => {
      const productId = where.idempotencyKey.replace("woo:pub:", "");
      return Promise.resolve(existingSuccessProductIds.has(productId) ? { id: `sub-${productId}` } : null);
    }),
    upsert: jest.fn().mockImplementation((args: any) => {
      upserts.push(args);
      return Promise.resolve({ id: "row" });
    }),
  };
  const prismaDirect = { getClient: jest.fn().mockReturnValue({ connectorSubmission }) } as unknown as PrismaDirectService;
  const connector = { publishProduct: jest.fn() } as unknown as WooCommerceConnector;
  return { prismaDirect, connector, connectorSubmission, upserts };
}

function makeItems(count: number, offset = 0) {
  return Array.from({ length: count }, (_, i) => ({
    productId: `product-${i + offset}`,
    payload: { sku: `SKU-${i + offset}` } as ProductPayload,
  }));
}

const ctx = {} as ConnectorContext;

describe("WooCommerceBulkPublishService.executeBulkPublish — checkpointed, fault-isolated bulk publish (no prior coverage)", () => {
  it("publishes a fresh item and records a SUCCESS submission", async () => {
    const stubs = makeStubs();
    (stubs.connector.publishProduct as jest.Mock).mockResolvedValue({ externalRef: "wc-123" });
    const service = new WooCommerceBulkPublishService(stubs.connector, stubs.prismaDirect);

    const result = await service.executeBulkPublish(ctx, "install-1", "tenant-a", makeItems(1));

    expect(result).toEqual({ success: 1, failed: 0, skipped: 0 });
    expect(stubs.upserts[0].create).toMatchObject({ status: "SUCCESS", externalRef: "wc-123", productId: "product-0" });
  });

  it("skips a product with an existing SUCCESS submission — never calls publishProduct for it", async () => {
    const stubs = makeStubs(new Set(["product-0"]));
    const service = new WooCommerceBulkPublishService(stubs.connector, stubs.prismaDirect);

    const result = await service.executeBulkPublish(ctx, "install-1", "tenant-a", makeItems(1));

    expect(result).toEqual({ success: 0, failed: 0, skipped: 1 });
    expect(stubs.connector.publishProduct).not.toHaveBeenCalled();
  });

  it("isolates one item's failure — the rest of the batch still succeeds, and counts stay accurate", async () => {
    const stubs = makeStubs();
    (stubs.connector.publishProduct as jest.Mock).mockImplementation(async (_ctx: unknown, payload: ProductPayload) => {
      if (payload.sku === "SKU-1") throw new Error("WooCommerce rejected this SKU");
      return { externalRef: `wc-${payload.sku}` };
    });
    const service = new WooCommerceBulkPublishService(stubs.connector, stubs.prismaDirect);

    const result = await service.executeBulkPublish(ctx, "install-1", "tenant-a", makeItems(3));

    expect(result).toEqual({ success: 2, failed: 1, skipped: 0 });
  });

  it("never drops or double-counts an item across a full multi-batch run — success+failed+skipped always equals the input size", async () => {
    const stubs = makeStubs(new Set(["product-5", "product-42"])); // a couple already-published, scattered across batch boundaries
    (stubs.connector.publishProduct as jest.Mock).mockImplementation(async (_ctx: unknown, payload: ProductPayload) => {
      if (payload.sku.endsWith("13")) throw new Error("simulated failure"); // SKU-13 and SKU-113: two deliberate failures, one per batch
      return { externalRef: `wc-${payload.sku}` };
    });
    const service = new WooCommerceBulkPublishService(stubs.connector, stubs.prismaDirect);
    const items = makeItems(150); // spans two BULK_BATCH_SIZE=100 batches

    const result = await service.executeBulkPublish(ctx, "install-1", "tenant-a", items);

    expect(result.success + result.failed + result.skipped).toBe(150);
    expect(result.skipped).toBe(2);
    expect(result.failed).toBe(2);
    expect(result.success).toBe(146);
  });

  it("increments attemptNumber on the update path when re-publishing over a non-SUCCESS prior row (upsert's update branch)", async () => {
    const stubs = makeStubs();
    (stubs.connector.publishProduct as jest.Mock).mockResolvedValue({ externalRef: "wc-retry" });
    const service = new WooCommerceBulkPublishService(stubs.connector, stubs.prismaDirect);

    await service.executeBulkPublish(ctx, "install-1", "tenant-a", makeItems(1));

    expect(stubs.upserts[0].update).toMatchObject({ status: "SUCCESS", attemptNumber: { increment: 1 } });
  });
});
