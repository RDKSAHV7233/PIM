// Coverage for WooCommerceBrownfieldImportService.importExistingProducts()
// — zero test coverage before, despite implementing the match precedence
// (_vexa_pim_product_id meta_data over WC sku fallback) and idempotent
// re-linking (upsert by idempotencyKey) that every brownfield WooCommerce
// install depends on to avoid creating duplicate ConnectorSubmission rows
// on repeated runs.

import { WooCommerceBrownfieldImportService } from "./woocommerce-brownfield-import.service";
import type { WooCommerceConnector } from "./woocommerce.connector";
import type { PrismaDirectService } from "../../prisma/prisma-direct.service";
import type { ConnectorContext } from "../../connector-framework/connector.interface";

function makeStubs(variantsBySku: Record<string, { id: string; productId: string }>) {
  const rows = new Map<string, any>(); // keyed by idempotencyKey
  const variant = {
    findFirst: jest.fn().mockImplementation(({ where }: any) =>
      Promise.resolve(variantsBySku[where.skuCode] ?? null),
    ),
  };
  const connectorSubmission = {
    upsert: jest.fn().mockImplementation(({ where, create, update }: any) => {
      const key = where.tenantKey_installationId_idempotencyKey.idempotencyKey;
      const row = rows.has(key) ? { ...rows.get(key), ...update } : { ...create };
      rows.set(key, row);
      return Promise.resolve(row);
    }),
  };
  const prismaDirect = { getClient: jest.fn().mockReturnValue({ variant, connectorSubmission }) } as unknown as PrismaDirectService;
  const connector = { listProductsPage: jest.fn() } as unknown as WooCommerceConnector;
  return { prismaDirect, connector, variant, connectorSubmission, rows };
}

function page(items: any[], totalPages = 1) {
  return { items, totalPages };
}

const ctx = {} as ConnectorContext;

describe("WooCommerceBrownfieldImportService.importExistingProducts — brownfield re-link (no prior coverage)", () => {
  it("links via the _vexa_pim_product_id meta_data key when present, taking precedence over sku", async () => {
    const stubs = makeStubs({ "SKU-1": { id: "variant-1", productId: "product-1" } });
    (stubs.connector.listProductsPage as jest.Mock).mockResolvedValue(
      page([{ id: 501, sku: "some-other-sku", meta_data: [{ key: "_vexa_pim_product_id", value: "SKU-1" }] }]),
    );
    const service = new WooCommerceBrownfieldImportService(stubs.connector, stubs.prismaDirect);

    const result = await service.importExistingProducts(ctx, "install-1", "tenant-a");

    expect(result).toEqual({ linked: 1, skuLinked: 0, unmatched: 0, total: 1 });
    expect(stubs.variant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantKey: "tenant-a", skuCode: "SKU-1" } }),
    );
  });

  it("falls back to the WC sku field when no vexa meta_data key exists", async () => {
    const stubs = makeStubs({ "WC-SKU-2": { id: "variant-2", productId: "product-2" } });
    (stubs.connector.listProductsPage as jest.Mock).mockResolvedValue(
      page([{ id: 502, sku: "WC-SKU-2", meta_data: [] }]),
    );
    const service = new WooCommerceBrownfieldImportService(stubs.connector, stubs.prismaDirect);

    const result = await service.importExistingProducts(ctx, "install-1", "tenant-a");

    expect(result).toEqual({ linked: 0, skuLinked: 1, unmatched: 0, total: 1 });
  });

  it("counts a product as unmatched when neither the meta key nor the sku resolves to a real PIM variant", async () => {
    const stubs = makeStubs({});
    (stubs.connector.listProductsPage as jest.Mock).mockResolvedValue(
      page([{ id: 503, sku: "no-such-sku", meta_data: [] }]),
    );
    const service = new WooCommerceBrownfieldImportService(stubs.connector, stubs.prismaDirect);

    const result = await service.importExistingProducts(ctx, "install-1", "tenant-a");

    expect(result).toEqual({ linked: 0, skuLinked: 0, unmatched: 1, total: 1 });
    expect(stubs.connectorSubmission.upsert).not.toHaveBeenCalled();
  });

  it("counts a product with neither a sku nor a vexa meta key as unmatched without ever querying variants", async () => {
    const stubs = makeStubs({});
    (stubs.connector.listProductsPage as jest.Mock).mockResolvedValue(
      page([{ id: 504, sku: null, meta_data: [] }]),
    );
    const service = new WooCommerceBrownfieldImportService(stubs.connector, stubs.prismaDirect);

    const result = await service.importExistingProducts(ctx, "install-1", "tenant-a");

    expect(result.unmatched).toBe(1);
    expect(stubs.variant.findFirst).not.toHaveBeenCalled();
  });

  it("paginates across every page WooCommerce reports, accumulating totals correctly", async () => {
    const stubs = makeStubs({ "SKU-A": { id: "v-a", productId: "product-a" }, "SKU-B": { id: "v-b", productId: "product-b" } });
    (stubs.connector.listProductsPage as jest.Mock)
      .mockResolvedValueOnce(page([{ id: 1, sku: "SKU-A", meta_data: [] }], 2))
      .mockResolvedValueOnce(page([{ id: 2, sku: "SKU-B", meta_data: [] }], 2));
    const service = new WooCommerceBrownfieldImportService(stubs.connector, stubs.prismaDirect);

    const result = await service.importExistingProducts(ctx, "install-1", "tenant-a");

    expect(result).toEqual({ linked: 0, skuLinked: 2, unmatched: 0, total: 2 });
    expect(stubs.connector.listProductsPage).toHaveBeenCalledTimes(2);
    expect(stubs.connector.listProductsPage).toHaveBeenNthCalledWith(1, ctx, 1, 100);
    expect(stubs.connector.listProductsPage).toHaveBeenNthCalledWith(2, ctx, 2, 100);
  });

  it("is idempotent: re-running the import for the same product doesn't create a second row", async () => {
    const stubs = makeStubs({ "SKU-1": { id: "variant-1", productId: "product-1" } });
    (stubs.connector.listProductsPage as jest.Mock).mockResolvedValue(
      page([{ id: 501, sku: "SKU-1", meta_data: [] }]),
    );
    const service = new WooCommerceBrownfieldImportService(stubs.connector, stubs.prismaDirect);

    await service.importExistingProducts(ctx, "install-1", "tenant-a");
    await service.importExistingProducts(ctx, "install-1", "tenant-a");

    expect(stubs.connectorSubmission.upsert).toHaveBeenCalledTimes(2);
    expect(stubs.rows.size).toBe(1); // both calls resolved to the same idempotencyKey — one row, not two
  });

  it("stops cleanly on an empty store (zero total pages) rather than looping or throwing", async () => {
    const stubs = makeStubs({});
    (stubs.connector.listProductsPage as jest.Mock).mockResolvedValue(page([], 0));
    const service = new WooCommerceBrownfieldImportService(stubs.connector, stubs.prismaDirect);

    const result = await service.importExistingProducts(ctx, "install-1", "tenant-a");

    expect(result).toEqual({ linked: 0, skuLinked: 0, unmatched: 0, total: 0 });
    expect(stubs.connector.listProductsPage).toHaveBeenCalledTimes(1);
  });

  it("documents a real edge case: a WC product with no id at all is silently excluded from every count bucket, so total can outrun linked+skuLinked+unmatched", async () => {
    const stubs = makeStubs({ "SKU-1": { id: "variant-1", productId: "product-1" } });
    (stubs.connector.listProductsPage as jest.Mock).mockResolvedValue(
      page([
        { id: null, sku: "SKU-1", meta_data: [] }, // no id — dropped entirely, not counted in any bucket
        { id: 999, sku: "no-match", meta_data: [] },
      ]),
    );
    const service = new WooCommerceBrownfieldImportService(stubs.connector, stubs.prismaDirect);

    const result = await service.importExistingProducts(ctx, "install-1", "tenant-a");

    // total reflects both scanned items, but only one of them landed in a bucket.
    expect(result.total).toBe(2);
    expect(result.linked + result.skuLinked + result.unmatched).toBe(1);
  });
});
