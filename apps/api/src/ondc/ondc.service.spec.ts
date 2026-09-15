// Coverage for OndcService — zero test coverage before, despite:
//   (a) raw SQL against ondc_mappings, a table not modelled in schema.prisma
//       (see the file's own TODO comment on schema-drift risk), where every
//       call site must manually filter by tenant_key since Prisma's tenant-
//       scope extension only instruments ORM queries, not queryRawUnsafe;
//   (b) createMapping()'s "unset the old default, then insert the new row"
//       sequence, which is NOT wrapped in a transaction — a failure between
//       the two raw calls can leave a category/node/version with zero
//       defaults;
//   (c) exportCatalog()'s per-product isolation (one simulateProduct
//       rejection must not fail the whole bulk export) and aggregate-count
//       correctness.
// Follows the hand-rolled-Prisma-stub + real tenantRaw/tenantExecRaw pattern
// established in connector-installer.service.spec.ts.

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { OndcService } from "./ondc.service";
import type { CreateOndcMappingDto } from "./dto/create-ondc-mapping.dto";

function createService() {
  const queryMock = jest.fn();
  const executeMock = jest.fn();
  const categoryFindUnique = jest.fn();
  const productFindUnique = jest.fn();
  const tenantMock = jest.fn().mockReturnValue({
    // RLS-BYPASS: manual tenant filter — tenantRaw/tenantExecRaw call through to these
    $queryRawUnsafe: queryMock, // RLS-BYPASS: manual tenant filter
    $executeRawUnsafe: executeMock, // RLS-BYPASS: manual tenant filter
    category: { findUnique: categoryFindUnique },
    product: { findUnique: productFindUnique },
  });
  const prisma = { tenant: tenantMock };
  const service = new OndcService(prisma as any);
  return { service, queryMock, executeMock, categoryFindUnique, productFindUnique };
}

const BASE_DTO: CreateOndcMappingDto = {
  name: "Apparel default",
  categoryId: "cat-1",
  nodeType: "seller_app",
  version: "1.2.0",
  requiredFields: ["title", "attributes.color"],
  fieldMap: { title: "descriptor.name", "attributes.color": "descriptor.color" },
};

describe("OndcService.createMapping — tenant scoping and validation (no prior coverage)", () => {
  it("rejects when the target category does not exist, before any raw SQL runs", async () => {
    const { service, categoryFindUnique, queryMock, executeMock } = createService();
    categoryFindUnique.mockResolvedValue(null);

    await expect(service.createMapping({ ...BASE_DTO })).rejects.toThrow(NotFoundException);
    expect(queryMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("rejects an all-blank/duplicate requiredFields list as empty after normalization", async () => {
    const { service, categoryFindUnique } = createService();
    categoryFindUnique.mockResolvedValue({ id: "cat-1" });

    await expect(
      service.createMapping({ ...BASE_DTO, requiredFields: ["  ", "", "  "] }),
    ).rejects.toThrow(BadRequestException);
  });

  it("dedupes requiredFields and trims whitespace before persisting", async () => {
    const { service, categoryFindUnique, executeMock, queryMock } = createService();
    categoryFindUnique.mockResolvedValue({ id: "cat-1" });
    executeMock.mockResolvedValue(1);
    queryMock.mockResolvedValue([{ id: "new-id" }]);

    await service.createMapping({ ...BASE_DTO, requiredFields: [" title ", "title", "attributes.color"] });

    const insertCall = executeMock.mock.calls.find((call) => String(call[0]).includes("INSERT INTO ondc_mappings"));
    expect(insertCall).toBeDefined();
    // tenantExecRaw spreads params onto executeRawUnsafe: [sql, id, tenantKey, name, categoryId,
    // nodeType, version, requiredFieldsJson, fieldMapJson, discoveryJson, isDefault]
    const requiredFieldsJson = insertCall![7];
    expect(JSON.parse(requiredFieldsJson)).toEqual(["title", "attributes.color"]);
  });

  it("rejects a fieldMap that normalizes to empty (blank keys/values only)", async () => {
    const { service, categoryFindUnique } = createService();
    categoryFindUnique.mockResolvedValue({ id: "cat-1" });

    await expect(
      service.createMapping({ ...BASE_DTO, fieldMap: { "  ": "target", source: "  " } }),
    ).rejects.toThrow(BadRequestException);
  });

  it("does not touch other defaults when isDefault is not set", async () => {
    const { service, categoryFindUnique, executeMock, queryMock } = createService();
    categoryFindUnique.mockResolvedValue({ id: "cat-1" });
    executeMock.mockResolvedValue(1);
    queryMock.mockResolvedValue([{ id: "new-id" }]);

    await service.createMapping({ ...BASE_DTO });

    const unsetCall = executeMock.mock.calls.find((call) => String(call[0]).includes("SET is_default = FALSE"));
    expect(unsetCall).toBeUndefined();
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("unsets the prior default for the same category/node/version before inserting when isDefault is true", async () => {
    const { service, categoryFindUnique, executeMock, queryMock } = createService();
    categoryFindUnique.mockResolvedValue({ id: "cat-1" });
    executeMock.mockResolvedValue(1);
    queryMock.mockResolvedValue([{ id: "new-id" }]);

    await service.createMapping({ ...BASE_DTO, isDefault: true });

    expect(executeMock).toHaveBeenCalledTimes(2);
    const [unsetSql, ...unsetParams] = executeMock.mock.calls[0];
    expect(unsetSql).toContain("SET is_default = FALSE");
    // tenant_key, node_type, version, category_id — the manual scoping this raw call relies on
    expect(unsetParams).toEqual(["default", "seller_app", "1.2.0", "cat-1"]);
  });

  it("scopes every raw call to the current tenant_key", async () => {
    const { service, categoryFindUnique, executeMock, queryMock } = createService();
    categoryFindUnique.mockResolvedValue({ id: "cat-1" });
    executeMock.mockResolvedValue(1);
    queryMock.mockResolvedValue([{ id: "new-id" }]);

    await service.createMapping({ ...BASE_DTO, isDefault: true });

    // tenant_key sits at a different positional index in the UPDATE vs the INSERT
    // (see tenantExecRaw's param spreading) — assert it's present in each, not at
    // one fixed index across both statement shapes.
    for (const call of executeMock.mock.calls) {
      const [, ...params] = call;
      expect(params).toContain("default");
    }
  });

  it("real gap (documented, not fixed): a failed insert after the default-unset leaves zero defaults — the two writes are not transactional", async () => {
    const { service, categoryFindUnique, executeMock } = createService();
    categoryFindUnique.mockResolvedValue({ id: "cat-1" });
    executeMock
      .mockResolvedValueOnce(1) // the UPDATE that unsets the prior default succeeds
      .mockRejectedValueOnce(new Error("db unavailable")); // the INSERT of the new default fails

    await expect(service.createMapping({ ...BASE_DTO, isDefault: true })).rejects.toThrow("db unavailable");

    // Both raw calls ran outside any $transaction wrapper (createMapping never calls
    // prisma.tenant().$transaction), so the prior default's is_default=FALSE write from
    // call #1 is already committed even though the new default from call #2 never landed.
    expect(executeMock).toHaveBeenCalledTimes(2);
  });
});

describe("OndcService.listMappings/getMapping — tenant-scoped raw reads (no prior coverage)", () => {
  it("passes null placeholders for omitted filters rather than omitting the SQL parameters", async () => {
    const { service, queryMock } = createService();
    queryMock.mockResolvedValue([]);

    await service.listMappings();

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("FROM ondc_mappings"),
      "default",
      null,
      null,
      null,
    );
  });

  it("forwards provided filters positionally", async () => {
    const { service, queryMock } = createService();
    queryMock.mockResolvedValue([]);

    await service.listMappings("seller_app", "1.2.0", "cat-1");

    expect(queryMock).toHaveBeenCalledWith(expect.anything(), "default", "seller_app", "1.2.0", "cat-1");
  });

  it("throws NotFoundException when a mapping id doesn't exist for this tenant", async () => {
    const { service, queryMock } = createService();
    queryMock.mockResolvedValue([]);

    await expect(service.getMapping("missing-id")).rejects.toThrow(NotFoundException);
  });

  it("returns the single matching row when found", async () => {
    const { service, queryMock } = createService();
    const row = { id: "map-1", name: "Apparel default" };
    queryMock.mockResolvedValue([row]);

    await expect(service.getMapping("map-1")).resolves.toEqual(row);
  });
});

describe("OndcService.simulateProduct — field resolution and readiness (no prior coverage)", () => {
  const MAPPING_ROW = {
    id: "map-1",
    name: "Apparel default",
    categoryId: "cat-1",
    nodeType: "seller_app",
    version: "1.2.0",
    requiredFields: ["title", "attributes.color", "hsnCode"],
    fieldMap: { title: "descriptor.name", "attributes.color": "descriptor.color", brand: "descriptor.brand" },
    discoveryMetadata: { country: "IND" },
    isDefault: true,
  };

  it("throws NotFoundException when the product doesn't exist", async () => {
    const { service, productFindUnique } = createService();
    productFindUnique.mockResolvedValue(null);

    await expect(service.simulateProduct("missing", "seller_app", "1.2.0")).rejects.toThrow(NotFoundException);
  });

  it("resolves attributes.* fields from the JSON attributes bag and direct fields from the product row", async () => {
    const { service, productFindUnique, queryMock } = createService();
    productFindUnique.mockResolvedValue({
      id: "p1",
      categoryId: "cat-1",
      title: "Blue T-Shirt",
      description: "desc",
      brand: "Acme",
      hsnCode: "6109",
      gstRate: 5,
      attributes: { color: "blue" },
    });
    queryMock.mockResolvedValue([MAPPING_ROW]);

    const result = await service.simulateProduct("p1", "seller_app", "1.2.0", "map-1");

    expect(result.payload).toMatchObject({
      "descriptor.name": "Blue T-Shirt",
      "descriptor.color": "blue",
      "descriptor.brand": "Acme",
    });
    expect(result.publishReady).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it("treats an empty/whitespace-only value the same as missing, both for payload inclusion and required-field checks", async () => {
    const { service, productFindUnique, queryMock } = createService();
    productFindUnique.mockResolvedValue({
      id: "p1",
      categoryId: "cat-1",
      title: "   ",
      description: "desc",
      brand: "Acme",
      hsnCode: null,
      gstRate: null,
      attributes: {},
    });
    queryMock.mockResolvedValue([MAPPING_ROW]);

    const result = await service.simulateProduct("p1", "seller_app", "1.2.0", "map-1");

    expect(result.payload).not.toHaveProperty("descriptor.name");
    expect(result.missingFields).toEqual(expect.arrayContaining(["title", "attributes.color", "hsnCode"]));
    expect(result.publishReady).toBe(false);
  });

  it("always stamps ondcVersion/nodeType/discovery onto the payload even when everything else is missing", async () => {
    const { service, productFindUnique, queryMock } = createService();
    productFindUnique.mockResolvedValue({
      id: "p1",
      categoryId: "cat-1",
      title: "",
      description: "",
      brand: "",
      hsnCode: null,
      gstRate: null,
      attributes: {},
    });
    queryMock.mockResolvedValue([MAPPING_ROW]);

    const result = await service.simulateProduct("p1", "seller_app", "1.2.0", "map-1");

    expect(result.payload).toMatchObject({
      ondcVersion: "1.2.0",
      nodeType: "seller_app",
      discovery: { country: "IND" },
    });
  });

  it("falls back to the tenant's default mapping when no mappingId is given, and 404s when none is configured", async () => {
    const { service, productFindUnique, queryMock } = createService();
    productFindUnique.mockResolvedValue({
      id: "p1",
      categoryId: "cat-1",
      title: "Blue T-Shirt",
      description: "desc",
      brand: "Acme",
      hsnCode: "6109",
      gstRate: 5,
      attributes: {},
    });
    queryMock.mockResolvedValue([]); // getDefaultMapping finds nothing

    await expect(service.simulateProduct("p1", "seller_app", "1.2.0")).rejects.toThrow(NotFoundException);
  });
});

describe("OndcService.exportCatalog — bulk aggregation and per-product isolation (no prior coverage)", () => {
  it("caps the product list at 250 and de-duplicates ids before simulating", async () => {
    const { service, productFindUnique, queryMock } = createService();
    productFindUnique.mockImplementation(({ where }: any) =>
      Promise.resolve({
        id: where.id,
        categoryId: "cat-1",
        title: "T",
        description: "d",
        brand: "b",
        hsnCode: "1",
        gstRate: 1,
        attributes: {},
      }),
    );
    queryMock.mockResolvedValue([
      {
        id: "map-1",
        name: "m",
        categoryId: "cat-1",
        nodeType: "seller_app",
        version: "1.2.0",
        requiredFields: [],
        fieldMap: {},
        discoveryMetadata: {},
        isDefault: true,
      },
    ]);

    const ids = Array.from({ length: 300 }, (_, i) => `p-${i % 260}`); // includes duplicates, exceeds cap after dedupe
    const result = await service.exportCatalog({ productIds: ids, nodeType: "seller_app", version: "1.2.0", mappingId: "map-1" });

    expect(result.items.length).toBeLessThanOrEqual(250);
  });

  it("isolates one product's simulateProduct failure — the rest of the batch still resolves", async () => {
    const { service, productFindUnique, queryMock } = createService();
    productFindUnique.mockImplementation(({ where }: any) => {
      if (where.id === "bad") return Promise.resolve(null); // triggers NotFoundException inside simulateProduct
      return Promise.resolve({
        id: where.id,
        categoryId: "cat-1",
        title: "T",
        description: "d",
        brand: "b",
        hsnCode: "1",
        gstRate: 1,
        attributes: {},
      });
    });
    queryMock.mockResolvedValue([
      {
        id: "map-1",
        name: "m",
        categoryId: "cat-1",
        nodeType: "seller_app",
        version: "1.2.0",
        requiredFields: [],
        fieldMap: {},
        discoveryMetadata: {},
        isDefault: true,
      },
    ]);

    const result = await service.exportCatalog({
      productIds: ["good-1", "bad", "good-2"],
      nodeType: "seller_app",
      version: "1.2.0",
      mappingId: "map-1",
    });

    expect(result.items).toHaveLength(3);
    const badItem = result.items.find((i) => i.productId === "bad");
    expect(badItem?.error).toBeDefined();
    expect(badItem?.publishReady).toBe(false);
    const goodItems = result.items.filter((i) => i.productId !== "bad");
    expect(goodItems.every((i) => !i.error)).toBe(true);
    expect(result.summary.total).toBe(3);
    expect(result.summary.errors).toBe(1);
  });

  it("computes readyPercent as a rounded percentage, and 0 (not NaN) for an empty product list", async () => {
    const { service } = createService();

    const empty = await service.exportCatalog({ productIds: [], nodeType: "seller_app", version: "1.2.0" });
    expect(empty.summary.readyPercent).toBe(0);
    expect(empty.summary.total).toBe(0);
  });
});
