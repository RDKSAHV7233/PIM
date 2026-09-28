// apps/api/src/connectors/shopify/shopify-channel-projection.spec.ts
// Story 3 acceptance tests for buildShopifyChannelProjection.

import { buildShopifyChannelProjection, ShopifyChannelProjection } from "./shopify-channel-projection";
import type { ProductPayload, ProductTypeSchema } from "../../connector-framework/connector.interface";
import type { ResolvedConnectorMapping } from "../../marketplace/mapping-resolution.service";
import { getCategoryRule, ruleToProductTypeSchema } from "./shopify-category-rules";

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
    productType: "apparel",
    ...overrides,
  };
}

function baseMapping(fieldMap: Record<string, string | string[]> = {}): ResolvedConnectorMapping {
  return {
    connectorSlug: "shopify",
    requiredFields: [],
    fieldMap,
    source: "system_pack",
  };
}

const DEFAULT_SCHEMA: ProductTypeSchema = ruleToProductTypeSchema("default", getCategoryRule("default"));

describe("buildShopifyChannelProjection — 1. simple product", () => {
  it("projects identity, content, brand, media from a simple single-variant product", () => {
    const projection = buildShopifyChannelProjection(baseProduct(), "cat-apparel", baseMapping(), DEFAULT_SCHEMA);

    expect(projection.identity.sku).toBe("SKU-1");
    expect(projection.content.title).toBe("Classic Tee");
    expect(projection.content.description).toBe("A comfortable tee");
    expect(projection.content.status).toBe("ACTIVE");
    expect(projection.brand.vendor).toBe("Acme");
    expect(projection.media.mainImageUrl).toBe("https://cdn.example.com/tee.jpg");
  });
});

describe("buildShopifyChannelProjection — 2. variant product", () => {
  it("projects each variant's sku, pricing, and options", () => {
    const product = baseProduct({
      variants: [
        { sku: "SKU-1-RED-M", sellingPrice: 799, mrp: 999, options: [{ optionName: "color", name: "Red" }, { optionName: "size", name: "M" }] },
        { sku: "SKU-1-BLUE-L", sellingPrice: 799, mrp: 999, options: [{ optionName: "color", name: "Blue" }, { optionName: "size", name: "L" }] },
      ],
    });
    const projection = buildShopifyChannelProjection(product, "cat-apparel", baseMapping(), DEFAULT_SCHEMA);

    expect(projection.variants).toHaveLength(2);
    expect(projection.variants[0].sku).toBe("SKU-1-RED-M");
    expect(projection.variants[0].options).toEqual([{ optionName: "color", name: "Red" }, { optionName: "size", name: "M" }]);
    expect(projection.variants[1].sku).toBe("SKU-1-BLUE-L");
  });

  it("falls back to a single synthetic variant from top-level fields when no variants array is present", () => {
    const projection = buildShopifyChannelProjection(baseProduct(), "cat-apparel", baseMapping(), DEFAULT_SCHEMA);
    expect(projection.variants).toHaveLength(1);
    expect(projection.variants[0].sku).toBe("SKU-1");
    expect(projection.variants[0].sellingPrice).toBe(799);
  });
});

describe("buildShopifyChannelProjection — 3. multiple images", () => {
  it("projects mainImageUrl and the full additionalImageUrls array", () => {
    const product = baseProduct({ additionalImageUrls: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"] });
    const projection = buildShopifyChannelProjection(product, "cat-apparel", baseMapping(), DEFAULT_SCHEMA);

    expect(projection.media.additionalImageUrls).toEqual([
      "https://cdn.example.com/a.jpg",
      "https://cdn.example.com/b.jpg",
    ]);
  });
});

describe("buildShopifyChannelProjection — 4. optional unmapped field", () => {
  it("omits attributes that exist on the product but are not declared in the resolved mapping", () => {
    const product = baseProduct({ attributes: { color: "Red", internalNote: "not mapped" } });
    // fieldMap maps only color, not internalNote
    const projection = buildShopifyChannelProjection(product, "cat-apparel", baseMapping({ "attributes.color": "options.color" }), DEFAULT_SCHEMA);

    expect(projection.attributes.find((a) => a.key === "color")).toBeDefined();
    expect(projection.attributes.find((a) => a.key === "internalNote")).toBeUndefined();
  });

  it("leaves seoTitle/seoDescription undefined rather than empty strings when absent", () => {
    const projection = buildShopifyChannelProjection(baseProduct(), "cat-apparel", baseMapping(), DEFAULT_SCHEMA);
    expect(projection.content.seoTitle).toBeUndefined();
    expect(projection.content.seoDescription).toBeUndefined();
  });
});

describe("buildShopifyChannelProjection — 5. mapped custom attribute", () => {
  it("projects a mapped attribute with its real value and source:'mapped'", () => {
    const product = baseProduct({ attributes: { color: "Red" } });
    const projection = buildShopifyChannelProjection(
      product,
      "cat-apparel",
      baseMapping({ "attributes.color": "options.color" }),
      DEFAULT_SCHEMA,
    );

    expect(projection.attributes).toEqual([{ key: "color", value: "Red", source: "mapped" }]);
  });

  it("projects null when a mapped attribute key has no value on the product", () => {
    const projection = buildShopifyChannelProjection(
      baseProduct({ attributes: {} }),
      "cat-apparel",
      baseMapping({ "attributes.color": "options.color" }),
      DEFAULT_SCHEMA,
    );
    expect(projection.attributes).toEqual([{ key: "color", value: null, source: "mapped" }]);
  });
});

describe("buildShopifyChannelProjection — 6. category/taxonomy projection", () => {
  it("projects the passed-in categoryScope and the product's productType", () => {
    const projection = buildShopifyChannelProjection(baseProduct({ productType: "apparel" }), "cat-apparel-shirts", baseMapping(), DEFAULT_SCHEMA);
    expect(projection.taxonomy).toEqual({ categoryScope: "cat-apparel-shirts", productType: "apparel" });
    expect(projection.productType).toBe("apparel");
  });
});

describe("buildShopifyChannelProjection — 7. missing required field / readiness", () => {
  it("reports a missing top-level required field (title) using the real default schema", () => {
    const projection = buildShopifyChannelProjection(baseProduct({ title: "" }), "cat-apparel", baseMapping(), DEFAULT_SCHEMA);
    expect(projection.readiness.missingRequiredFields).toContain("title");
    expect(projection.readiness.coveredRequiredFields).not.toContain("title");
  });

  it("reports every base required field as covered for a well-formed product", () => {
    const projection = buildShopifyChannelProjection(baseProduct(), "cat-apparel", baseMapping(), DEFAULT_SCHEMA);
    expect(projection.readiness.missingRequiredFields).toEqual([]);
    expect(projection.readiness.coveredRequiredFields).toEqual(
      expect.arrayContaining(["sku", "title", "description", "mainImageUrl"]),
    );
  });

  it("REGRESSION (#992): canonical required fields (sku/title/description/mainImageUrl) are read straight off the product and NEVER routed through the mapping — an empty, wrong, or unrelated fieldMap must not affect their readiness", () => {
    const product = baseProduct();
    const noMapping = buildShopifyChannelProjection(product, "cat-apparel", baseMapping({}), DEFAULT_SCHEMA);
    const unrelatedMapping = buildShopifyChannelProjection(
      product,
      "cat-apparel",
      baseMapping({ "attributes.somethingElse": "some.other.path" }),
      DEFAULT_SCHEMA,
    );
    const wrongMapping = buildShopifyChannelProjection(
      // A fieldMap that maps "sku"/"title"/etc. to bogus targets must have zero effect —
      // canonical fields are never resolved via fieldMap lookups, so this is inert.
      product,
      "cat-apparel",
      baseMapping({ sku: "bogus.target", title: "another.bogus.target" }),
      DEFAULT_SCHEMA,
    );

    for (const projection of [noMapping, unrelatedMapping, wrongMapping]) {
      expect(projection.readiness.missingRequiredFields).toEqual([]);
      expect(projection.readiness.coveredRequiredFields).toEqual(
        expect.arrayContaining(["sku", "title", "description", "mainImageUrl"]),
      );
    }
  });

  it("reports a missing attributes.-prefixed required field when a schema declares one", () => {
    const schemaWithRequiredAttribute: ProductTypeSchema = {
      productType: "test-category",
      requiredAttributes: ["attributes.customRequired"],
      optionalAttributes: [],
      validValues: {},
      schemaVersion: "TEST-1",
    };
    const missing = buildShopifyChannelProjection(baseProduct({ attributes: {} }), "cat-x", baseMapping(), schemaWithRequiredAttribute);
    expect(missing.readiness.missingRequiredFields).toEqual(["attributes.customRequired"]);

    const covered = buildShopifyChannelProjection(
      baseProduct({ attributes: { customRequired: "present" } }),
      "cat-x",
      baseMapping(),
      schemaWithRequiredAttribute,
    );
    expect(covered.readiness.coveredRequiredFields).toEqual(["attributes.customRequired"]);
  });
});

describe("buildShopifyChannelProjection — 8. null/empty normalization", () => {
  it("does not throw and normalizes absent optional fields to undefined/empty arrays", () => {
    const product = baseProduct({
      tags: undefined,
      additionalImageUrls: undefined,
      seoTitle: undefined,
      brand: "",
    });
    expect(() => buildShopifyChannelProjection(product, "cat-apparel", baseMapping(), DEFAULT_SCHEMA)).not.toThrow();
    const projection = buildShopifyChannelProjection(product, "cat-apparel", baseMapping(), DEFAULT_SCHEMA);
    expect(projection.content.tags).toEqual([]);
    expect(projection.media.additionalImageUrls).toEqual([]);
    expect(projection.brand.vendor).toBeUndefined();
  });

  it("treats a whitespace-only string as empty for readiness purposes", () => {
    const projection = buildShopifyChannelProjection(baseProduct({ description: "   " }), "cat-apparel", baseMapping(), DEFAULT_SCHEMA);
    expect(projection.readiness.missingRequiredFields).toContain("description");
  });
});

describe("buildShopifyChannelProjection — 9. no Shopify DTO / provider API dependency", () => {
  it("never contains Shopify GraphQL transport keys (optionValues, inventoryItem, descriptionHtml, productSet)", () => {
    const product = baseProduct({
      variants: [{ sku: "SKU-1", sellingPrice: 799, mrp: 999, options: [{ optionName: "color", name: "Red" }] }],
    });
    const projection = buildShopifyChannelProjection(product, "cat-apparel", baseMapping(), DEFAULT_SCHEMA);
    const serialized = JSON.stringify(projection);

    for (const shopifyTransportKey of ["optionValues", "inventoryItem", "descriptionHtml", "productSet", "metafields", "handle"]) {
      expect(serialized.includes(`"${shopifyTransportKey}"`)).toBe(false);
    }
  });
});

describe("buildShopifyChannelProjection — 10. deterministic output", () => {
  it("returns an equal result across repeated calls with identical inputs, without mutating them", () => {
    const product = baseProduct({ attributes: { color: "Red" } });
    const productSnapshot = JSON.parse(JSON.stringify(product));
    const mapping = baseMapping({ "attributes.color": "options.color" });
    const mappingSnapshot = JSON.parse(JSON.stringify(mapping));

    const first: ShopifyChannelProjection = buildShopifyChannelProjection(product, "cat-apparel", mapping, DEFAULT_SCHEMA);
    const second: ShopifyChannelProjection = buildShopifyChannelProjection(product, "cat-apparel", mapping, DEFAULT_SCHEMA);

    expect(first).toEqual(second);
    expect(product).toEqual(productSnapshot);
    expect(mapping).toEqual(mappingSnapshot);
  });
});
