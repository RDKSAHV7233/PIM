// apps/api/src/connectors/shopify/shopify-shadow-comparator.spec.ts
// Story 5 acceptance tests for compareProjectionToSource.

import { compareProjectionToSource } from "./shopify-shadow-comparator";
import { buildShopifyChannelProjection, ShopifyChannelProjection } from "./shopify-channel-projection";
import { getCategoryRule, ruleToProductTypeSchema } from "./shopify-category-rules";
import type { ProductPayload, ProductTypeSchema } from "../../connector-framework/connector.interface";
import type { ResolvedConnectorMapping } from "../../marketplace/mapping-resolution.service";

function baseProduct(overrides: Partial<ProductPayload> = {}): ProductPayload {
  return {
    sku: "SKU-1",
    title: "Classic Tee",
    description: "A comfortable tee",
    brand: "Acme",
    hsnCode: "61091000",
    gstRate: 5,
    mrp: 999,
    sellingPrice: 799,
    mainImageUrl: "https://cdn.example.com/tee.jpg",
    attributes: {},
    productType: "default",
    ...overrides,
  };
}

const DEFAULT_SCHEMA: ProductTypeSchema = ruleToProductTypeSchema("default", getCategoryRule("default"));

function baseMapping(fieldMap: Record<string, string | string[]> = {}): ResolvedConnectorMapping {
  return { connectorSlug: "shopify", requiredFields: [], fieldMap, source: "system_pack" };
}

describe("compareProjectionToSource — real Story 3 output (regression: current pipeline must stay faithful)", () => {
  it("reports a perfect match for a well-formed product with no mapped attributes", () => {
    const product = baseProduct();
    const projection = buildShopifyChannelProjection(product, "cat-1", baseMapping(), DEFAULT_SCHEMA);

    const result = compareProjectionToSource(projection, product);

    expect(result.matches).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("reports a perfect match with a mapped custom attribute and multiple variants", () => {
    const product = baseProduct({
      attributes: { color: "Red" },
      variants: [
        { sku: "SKU-1-M", sellingPrice: 799, mrp: 999, options: [{ optionName: "size", name: "M" }] },
        { sku: "SKU-1-L", sellingPrice: 799, mrp: 999, options: [{ optionName: "size", name: "L" }] },
      ],
    });
    const mapping = baseMapping({ "attributes.color": "options.color" });
    const projection = buildShopifyChannelProjection(product, "cat-1", mapping, DEFAULT_SCHEMA);

    const result = compareProjectionToSource(projection, product);

    expect(result.matches).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("reports a perfect match when a required field is genuinely missing (readiness correctly agrees with source)", () => {
    const product = baseProduct({ title: "" });
    const projection = buildShopifyChannelProjection(product, "cat-1", baseMapping(), DEFAULT_SCHEMA);

    const result = compareProjectionToSource(projection, product);

    expect(result.matches).toBe(true);
    expect(projection.readiness.missingRequiredFields).toContain("title");
  });
});

describe("compareProjectionToSource — detects real drift when a projection diverges from its source", () => {
  function realProjection(product: ProductPayload, mapping = baseMapping()): ShopifyChannelProjection {
    return buildShopifyChannelProjection(product, "cat-1", mapping, DEFAULT_SCHEMA);
  }

  it("flags a corrupted identity.sku", () => {
    const product = baseProduct();
    const projection = realProjection(product);
    const corrupted = { ...projection, identity: { sku: "WRONG-SKU" } };

    const result = compareProjectionToSource(corrupted, product);

    expect(result.matches).toBe(false);
    expect(result.mismatches).toContainEqual({ field: "identity.sku", expected: "SKU-1", actual: "WRONG-SKU" });
  });

  it("flags a corrupted content.title", () => {
    const product = baseProduct();
    const projection = realProjection(product);
    const corrupted: ShopifyChannelProjection = {
      ...projection,
      content: { ...projection.content, title: "Someone Else's Title" },
    };

    const result = compareProjectionToSource(corrupted, product);

    expect(result.mismatches).toContainEqual({
      field: "content.title",
      expected: "Classic Tee",
      actual: "Someone Else's Title",
    });
  });

  it("flags a variant count mismatch", () => {
    const product = baseProduct({
      variants: [
        { sku: "SKU-1-M", sellingPrice: 799, mrp: 999 },
        { sku: "SKU-1-L", sellingPrice: 799, mrp: 999 },
      ],
    });
    const projection = realProjection(product);
    const corrupted: ShopifyChannelProjection = { ...projection, variants: [projection.variants[0]] };

    const result = compareProjectionToSource(corrupted, product);

    expect(result.matches).toBe(false);
    expect(result.mismatches).toContainEqual({ field: "variants.length", expected: 2, actual: 1 });
  });

  it("flags a mapped attribute value that no longer matches its source", () => {
    const product = baseProduct({ attributes: { color: "Red" } });
    const mapping = baseMapping({ "attributes.color": "options.color" });
    const projection = realProjection(product, mapping);
    const corrupted: ShopifyChannelProjection = {
      ...projection,
      attributes: projection.attributes.map((a) => (a.key === "color" ? { ...a, value: "Blue" } : a)),
    };

    const result = compareProjectionToSource(corrupted, product);

    expect(result.matches).toBe(false);
    expect(result.mismatches).toContainEqual({ field: "attributes.color", expected: "Red", actual: "Blue" });
  });

  it("flags a readiness mismatch when the projection wrongly reports a present field as missing", () => {
    const product = baseProduct();
    const projection = realProjection(product);
    expect(projection.readiness.missingRequiredFields).not.toContain("sku");
    const corrupted: ShopifyChannelProjection = {
      ...projection,
      readiness: { ...projection.readiness, missingRequiredFields: [...projection.readiness.missingRequiredFields, "sku"] },
    };

    const result = compareProjectionToSource(corrupted, product);

    expect(result.matches).toBe(false);
    expect(result.mismatches).toContainEqual({ field: "readiness.sku.missing", expected: false, actual: true });
  });

  it("flags a readiness mismatch when the projection wrongly reports a missing field as present", () => {
    const product = baseProduct({ description: "" });
    const projection = realProjection(product);
    expect(projection.readiness.missingRequiredFields).toContain("description");
    const corrupted: ShopifyChannelProjection = {
      ...projection,
      readiness: {
        ...projection.readiness,
        missingRequiredFields: projection.readiness.missingRequiredFields.filter((f) => f !== "description"),
      },
    };

    const result = compareProjectionToSource(corrupted, product);

    expect(result.matches).toBe(false);
    expect(result.mismatches).toContainEqual({ field: "readiness.description.missing", expected: true, actual: false });
  });

  it("collects multiple independent mismatches in a single call rather than stopping at the first", () => {
    const product = baseProduct();
    const projection = realProjection(product);
    const corrupted: ShopifyChannelProjection = {
      ...projection,
      identity: { sku: "WRONG" },
      content: { ...projection.content, title: "WRONG" },
    };

    const result = compareProjectionToSource(corrupted, product);

    expect(result.mismatches.length).toBeGreaterThanOrEqual(2);
    expect(result.mismatches.map((m) => m.field)).toEqual(expect.arrayContaining(["identity.sku", "content.title"]));
  });
});
