import type { ShopifyChannelProjection } from "./shopify-channel-projection";
import {
  buildCompensatingWritePayload,
  buildShopifyVnextMutationPayload,
  buildShopifyVnextProductIdentifier,
  buildShopifyVnextProductSetInput,
  ShopifyRollbackSnapshot,
} from "./shopify-vnext-mutation-adapter";

function projection(overrides: Partial<ShopifyChannelProjection> = {}): ShopifyChannelProjection {
  return {
    identity: { sku: "SKU-1" },
    content: {
      title: "Classic Tee",
      description: "<p>A comfortable tee</p>",
      seoTitle: "SEO Tee",
      seoDescription: "SEO Description",
      tags: ["summer", " cotton ", ""],
      status: "ACTIVE",
    },
    brand: { vendor: "Acme" },
    productType: "apparel",
    attributes: [{ key: "Color", value: "Red", source: "mapped" }],
    variants: [
      {
        sku: "SKU-1",
        sellingPrice: 799,
        mrp: 999,
        compareAtPrice: 899,
        barcode: "1234567890",
        weight: 0.2,
        weightUnit: "KILOGRAMS",
        options: [],
      },
    ],
    media: {
      mainImageUrl: "https://cdn.example.com/main.jpg",
      additionalImageUrls: [],
    },
    taxonomy: { categoryScope: "cat-apparel", productType: "apparel" },
    readiness: {
      schemaVersion: "LOCAL-shopify-default-2026Q3",
      requiredFields: ["sku", "title", "description", "mainImageUrl"],
      missingRequiredFields: [],
      coveredRequiredFields: ["sku", "title", "description", "mainImageUrl"],
    },
    ...overrides,
  };
}

describe("buildShopifyVnextProductSetInput", () => {
  it("builds ProductSetInput from projection content, identity, media, and scalar variant data", () => {
    const input = buildShopifyVnextProductSetInput(projection());

    expect(input).toEqual(expect.objectContaining({
      title: "Classic Tee",
      handle: "classic-tee-sku-1",
      descriptionHtml: "<p>A comfortable tee</p>",
      status: "ACTIVE",
      vendor: "Acme",
      productType: "apparel",
      seo: { title: "SEO Tee", description: "SEO Description" },
      tags: ["summer", "cotton"],
    }));
    expect(input.files).toEqual([
      {
        originalSource: "https://cdn.example.com/main.jpg",
        alt: "Classic Tee",
        contentType: "IMAGE",
        filename: "product-image.jpg",
      },
    ]);
    expect(input.variants).toEqual([
      {
        price: "799.00",
        compareAtPrice: "899.00",
        inventoryPolicy: "CONTINUE",
        taxable: true,
        inventoryItem: {
          tracked: false,
          sku: "SKU-1",
          measurement: { weight: { value: 0.2, unit: "KILOGRAMS" } },
        },
        barcode: "1234567890",
        optionValues: [{ optionName: "Title", name: "Default Title" }],
      },
    ]);
  });

  it("derives multi-variant productOptions and variant optionValues from projection variants", () => {
    const input = buildShopifyVnextProductSetInput(projection({
      variants: [
        {
          sku: "SKU-RED-M",
          sellingPrice: 799,
          mrp: 999,
          options: [{ optionName: "Color", name: "Red" }, { optionName: "Size", name: "M" }],
        },
        {
          sku: "SKU-BLUE-L",
          sellingPrice: 849,
          mrp: 999,
          options: [{ optionName: "Color", name: "Blue" }, { optionName: "Size", name: "L" }],
        },
      ],
    }));

    expect(input.productOptions).toEqual([
      { name: "Color", position: 1, values: [{ name: "Red" }, { name: "Blue" }] },
      { name: "Size", position: 2, values: [{ name: "M" }, { name: "L" }] },
    ]);
    expect(input.variants).toEqual([
      expect.objectContaining({ inventoryItem: { tracked: false, sku: "SKU-RED-M" }, optionValues: [{ optionName: "Color", name: "Red" }, { optionName: "Size", name: "M" }] }),
      expect.objectContaining({ inventoryItem: { tracked: false, sku: "SKU-BLUE-L" }, optionValues: [{ optionName: "Color", name: "Blue" }, { optionName: "Size", name: "L" }] }),
    ]);
  });

  it("includes projection-derived mapped attributes as safe PIM metafields", () => {
    const input = buildShopifyVnextProductSetInput(projection({
      attributes: [
        { key: "Color", value: "Red", source: "mapped" },
        { key: "care instructions", value: ["cold wash"], source: "mapped" },
        { key: "empty", value: "", source: "mapped" },
      ],
    }));

    expect(input.metafields).toEqual([
      { namespace: "pim_connector", key: "sku", type: "single_line_text_field", value: "SKU-1" },
      { namespace: "pim_connector", key: "source_sku", type: "single_line_text_field", value: "SKU-1" },
      { namespace: "pim_connector", key: "color", type: "single_line_text_field", value: "Red" },
      { namespace: "pim_connector", key: "care_instructions", type: "json", value: "[\"cold wash\"]" },
    ]);
  });

  it("does not invent legacy-only fields the projection does not carry", () => {
    const input = buildShopifyVnextProductSetInput(projection());
    const serialized = JSON.stringify(input);

    expect(serialized).not.toContain("harmonizedSystemCode");
    expect(serialized).not.toContain("taxCodes");
  });

  it("includes additional images with deterministic filenames", () => {
    const input = buildShopifyVnextProductSetInput(projection({
      media: {
        mainImageUrl: "https://cdn.example.com/main.jpeg",
        additionalImageUrls: ["https://cdn.example.com/side.png"],
      },
    }));

    expect(input.files).toEqual([
      expect.objectContaining({ originalSource: "https://cdn.example.com/main.jpeg", filename: "product-image.jpeg" }),
      expect.objectContaining({ originalSource: "https://cdn.example.com/side.png", filename: "product-image-2.png" }),
    ]);
  });
});

describe("buildShopifyVnextProductIdentifier", () => {
  it("uses an existing Shopify product gid when one is supplied", () => {
    expect(buildShopifyVnextProductIdentifier(projection(), "gid://shopify/Product/123")).toEqual({
      id: "gid://shopify/Product/123",
    });
  });

  it("falls back to the projection-derived handle", () => {
    expect(buildShopifyVnextProductIdentifier(projection())).toEqual({ handle: "classic-tee-sku-1" });
  });
});

describe("buildShopifyVnextMutationPayload", () => {
  it("threads correlationId alongside the Shopify payload without embedding it in ProductSetInput", () => {
    const payload = buildShopifyVnextMutationPayload(
      projection(),
      "vnext_12345678-1234-4234-9234-123456789abc",
      "gid://shopify/Product/123",
    );

    expect(payload.correlationId).toBe("vnext_12345678-1234-4234-9234-123456789abc");
    expect(payload.identifier).toEqual({ id: "gid://shopify/Product/123" });
    expect(payload.input).toEqual(expect.objectContaining({ title: "Classic Tee" }));
    expect(JSON.stringify(payload.input)).not.toContain("vnext_12345678");
  });
});

describe("buildCompensatingWritePayload", () => {
  const SNAPSHOT: ShopifyRollbackSnapshot = {
    capturedAt: "2026-09-30T10:00:00.000Z",
    product: {
      id: "gid://shopify/Product/123",
      title: "Before Title",
      handle: "before-title-sku-1",
      descriptionHtml: "<p>Before description</p>",
      status: "ACTIVE",
      vendor: "Before Vendor",
      productType: "before-type",
      tags: ["before", "rollback"],
      seo: { title: "Before SEO", description: "Before SEO description" },
      options: [
        { name: "Size", position: 1, values: ["S", "M"] },
        { name: "Color", position: 2, values: ["Black"] },
      ],
      variants: [
        {
          id: "gid://shopify/ProductVariant/1",
          sku: "SKU-BEFORE",
          price: "799.00",
          compareAtPrice: "999.00",
          barcode: "12345",
          inventoryPolicy: "CONTINUE",
          taxable: true,
          selectedOptions: [
            { name: "Size", value: "S" },
            { name: "Color", value: "Black" },
          ],
          inventoryItem: {
            id: "gid://shopify/InventoryItem/1",
            sku: "SKU-BEFORE",
            tracked: true,
          },
        },
        {
          id: "gid://shopify/ProductVariant/2",
          sku: "SKU-BEFORE-M",
          price: "849.00",
          compareAtPrice: null,
          barcode: null,
          inventoryPolicy: "DENY",
          taxable: false,
          selectedOptions: [
            { name: "Size", value: "M" },
            { name: "Color", value: "Black" },
          ],
          inventoryItem: {
            id: "gid://shopify/InventoryItem/2",
            sku: "SKU-BEFORE-M",
            tracked: false,
          },
        },
      ],
      images: [
        {
          id: "gid://shopify/ProductImage/1",
          src: "https://cdn.example.com/before.jpg",
          altText: "Before image",
        },
      ],
    },
  };

  it("builds a compensating ProductSet payload from the captured Shopify state", () => {
    const payload = buildCompensatingWritePayload(SNAPSHOT, "vnext_rollback-1");

    expect(payload.correlationId).toBe("vnext_rollback-1");
    expect(payload.identifier).toEqual({ id: "gid://shopify/Product/123" });
    expect(payload.input).toEqual(expect.objectContaining({
      title: "Before Title",
      handle: "before-title-sku-1",
      descriptionHtml: "<p>Before description</p>",
      status: "ACTIVE",
      vendor: "Before Vendor",
      productType: "before-type",
      tags: ["before", "rollback"],
      seo: { title: "Before SEO", description: "Before SEO description" },
    }));
    expect(payload.input.variants).toEqual([
      {
        price: "799.00",
        compareAtPrice: "999.00",
        inventoryPolicy: "CONTINUE",
        taxable: true,
        inventoryItem: { tracked: true, sku: "SKU-BEFORE" },
        barcode: "12345",
        optionValues: [
          { optionName: "Size", name: "S" },
          { optionName: "Color", name: "Black" },
        ],
      },
      {
        price: "849.00",
        inventoryPolicy: "DENY",
        taxable: false,
        inventoryItem: { tracked: false, sku: "SKU-BEFORE-M" },
        optionValues: [
          { optionName: "Size", name: "M" },
          { optionName: "Color", name: "Black" },
        ],
      },
    ]);
    expect(payload.input.productOptions).toEqual([
      { name: "Size", position: 1, values: [{ name: "S" }, { name: "M" }] },
      { name: "Color", position: 2, values: [{ name: "Black" }] },
    ]);
    expect(payload.input.files).toEqual([
      {
        originalSource: "https://cdn.example.com/before.jpg",
        alt: "Before image",
        contentType: "IMAGE",
        filename: "product-image.jpg",
      },
    ]);
  });

  it("does not include rollback snapshot metadata inside the Shopify input", () => {
    const payload = buildCompensatingWritePayload(SNAPSHOT, "vnext_rollback-1");
    const serializedInput = JSON.stringify(payload.input);

    expect(serializedInput).not.toContain("capturedAt");
    expect(serializedInput).not.toContain("vnext_rollback-1");
    expect(serializedInput).not.toContain("gid://shopify/ProductVariant/1");
    expect(serializedInput).not.toContain("gid://shopify/ProductImage/1");
  });
});
