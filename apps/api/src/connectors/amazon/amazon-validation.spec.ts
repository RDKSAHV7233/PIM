// apps/api/src/connectors/amazon/amazon-validation.spec.ts
// Unit tests for Sprint B: runAmazonLocalValidation content-level rules.

import { ProductPayload } from "../../connector-framework/connector.interface";
import {
  collectAmazonMissingFields,
  AMAZON_DEFAULT_REQUIRED_FIELDS,
  runAmazonLocalValidation,
  getProductFieldValue,
} from "./amazon-validation";

// ─── base fixture ─────────────────────────────────────────────────────────────
// Passes all local rules — used as the baseline for negative tests.
const BASE: ProductPayload = {
  sku: "TEST-SKU-001",
  title: "Cotton Kurti for Women Blue M",
  description: "Comfortable daily-wear cotton kurti. Machine washable.",
  brand: "TestBrand",
  hsnCode: "62044200",
  gstRate: 5,
  mrp: 999,
  sellingPrice: 799,
  mainImageUrl: "https://cdn.example.com/img/001.jpg",
  countryOfOrigin: "India",
  condition: "new",
  bulletPoints: [
    "100% cotton for all-day comfort",
    "Machine washable",
    "Available in multiple sizes",
  ],
  attributes: {
    color: "Blue",
    material: "Cotton",
    size: "M",
  },
  productType: "SHIRT",
};

const DISPLAY_NAME = "Amazon India";

describe("runAmazonLocalValidation", () => {

  // ── Valid baseline ──────────────────────────────────────────────────────────
  it("returns no errors for a fully valid product", () => {
    const issues = runAmazonLocalValidation(BASE, DISPLAY_NAME);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toHaveLength(0);
  });

  // ── SKU ────────────────────────────────────────────────────────────────────
  it("errors when sku is empty", () => {
    const issues = runAmazonLocalValidation({ ...BASE, sku: "" }, DISPLAY_NAME);
    expect(issues.some((i) => i.fieldPath === "sku" && i.severity === "error")).toBe(true);
  });

  // ── Title ──────────────────────────────────────────────────────────────────
  it("errors when title is missing", () => {
    const issues = runAmazonLocalValidation({ ...BASE, title: "" }, DISPLAY_NAME);
    const err = issues.find((i) => i.fieldPath === "title" && i.severity === "error");
    expect(err).toBeDefined();
    expect(err?.code).toBe("CHANNEL_REQUIRED_FIELD");
  });

  it("errors when title exceeds 200 characters", () => {
    const longTitle = "A".repeat(201);
    const issues = runAmazonLocalValidation({ ...BASE, title: longTitle }, DISPLAY_NAME);
    const err = issues.find((i) => i.fieldPath === "title" && i.code === "TITLE_TOO_LONG");
    expect(err).toBeDefined();
    expect(err?.severity).toBe("error");
    expect(err?.sellerMessage).toMatch(/200/);
  });

  it("accepts a title of exactly 200 characters", () => {
    const exactTitle = "A".repeat(200);
    const issues = runAmazonLocalValidation({ ...BASE, title: exactTitle }, DISPLAY_NAME);
    expect(issues.some((i) => i.fieldPath === "title" && i.code === "TITLE_TOO_LONG")).toBe(false);
  });

  // ── Brand ──────────────────────────────────────────────────────────────────
  it("errors when brand is missing", () => {
    const issues = runAmazonLocalValidation({ ...BASE, brand: "" }, DISPLAY_NAME);
    expect(issues.some((i) => i.fieldPath === "brand" && i.severity === "error")).toBe(true);
  });

  // ── Description ───────────────────────────────────────────────────────────
  it("errors when description is missing", () => {
    const issues = runAmazonLocalValidation({ ...BASE, description: "" }, DISPLAY_NAME);
    expect(issues.some((i) => i.fieldPath === "description" && i.severity === "error")).toBe(true);
  });

  // ── Main image ────────────────────────────────────────────────────────────
  it("errors when mainImageUrl is empty", () => {
    const issues = runAmazonLocalValidation({ ...BASE, mainImageUrl: "" }, DISPLAY_NAME);
    const err = issues.find((i) => i.fieldPath === "mainImageUrl" && i.severity === "error");
    expect(err).toBeDefined();
    expect(err?.code).toBe("CHANNEL_REQUIRED_FIELD");
  });

  it("errors when mainImageUrl is not HTTPS", () => {
    const issues = runAmazonLocalValidation(
      { ...BASE, mainImageUrl: "http://cdn.example.com/img.jpg" },
      DISPLAY_NAME,
    );
    const err = issues.find((i) => i.fieldPath === "mainImageUrl" && i.code === "IMAGE_URL_NOT_HTTPS");
    expect(err).toBeDefined();
    expect(err?.severity).toBe("error");
  });

  it("accepts a valid HTTPS main image URL", () => {
    const issues = runAmazonLocalValidation(BASE, DISPLAY_NAME);
    expect(issues.some((i) => i.fieldPath === "mainImageUrl")).toBe(false);
  });

  // ── Additional images ─────────────────────────────────────────────────────
  it("errors when more than 8 additional images are provided", () => {
    const tooMany = Array.from({ length: 9 }, (_, k) => `https://cdn.example.com/img/${k}.jpg`);
    const issues = runAmazonLocalValidation({ ...BASE, additionalImageUrls: tooMany }, DISPLAY_NAME);
    const err = issues.find((i) => i.code === "TOO_MANY_IMAGES");
    expect(err).toBeDefined();
    expect(err?.severity).toBe("error");
  });

  it("errors when an additional image URL is not HTTPS", () => {
    const issues = runAmazonLocalValidation(
      { ...BASE, additionalImageUrls: ["http://cdn.example.com/extra.jpg"] },
      DISPLAY_NAME,
    );
    const err = issues.find((i) => i.code === "IMAGE_URL_NOT_HTTPS" && i.fieldPath.startsWith("additionalImageUrls"));
    expect(err).toBeDefined();
  });

  it("accepts up to 8 valid HTTPS additional images", () => {
    const valid = Array.from({ length: 8 }, (_, k) => `https://cdn.example.com/img/${k}.jpg`);
    const issues = runAmazonLocalValidation({ ...BASE, additionalImageUrls: valid }, DISPLAY_NAME);
    expect(issues.some((i) => i.code === "TOO_MANY_IMAGES")).toBe(false);
  });

  // ── Bullet points ─────────────────────────────────────────────────────────
  it("warns when bulletPoints is absent", () => {
    const { bulletPoints: _bp, ...withoutBullets } = BASE;
    const issues = runAmazonLocalValidation(withoutBullets as ProductPayload, DISPLAY_NAME);
    const warn = issues.find((i) => i.fieldPath === "bulletPoints" && i.severity === "warning");
    expect(warn).toBeDefined();
    expect(warn?.code).toBe("BULLET_POINTS_MISSING");
  });

  it("warns when bulletPoints is an empty array", () => {
    const issues = runAmazonLocalValidation({ ...BASE, bulletPoints: [] }, DISPLAY_NAME);
    const warn = issues.find((i) => i.fieldPath === "bulletPoints" && i.severity === "warning");
    expect(warn).toBeDefined();
  });

  it("errors when more than 5 bullet points are provided", () => {
    const tooMany = ["1", "2", "3", "4", "5", "6"];
    const issues = runAmazonLocalValidation({ ...BASE, bulletPoints: tooMany }, DISPLAY_NAME);
    const err = issues.find((i) => i.code === "TOO_MANY_BULLET_POINTS");
    expect(err).toBeDefined();
    expect(err?.severity).toBe("error");
  });

  it("accepts exactly 5 bullet points without error", () => {
    const exactly5 = ["1", "2", "3", "4", "5"];
    const issues = runAmazonLocalValidation({ ...BASE, bulletPoints: exactly5 }, DISPLAY_NAME);
    expect(issues.some((i) => i.code === "TOO_MANY_BULLET_POINTS")).toBe(false);
  });

  // ── HSN / GST (India mode) ────────────────────────────────────────────────
  it("errors on missing hsnCode when isIndia=true (default)", () => {
    const issues = runAmazonLocalValidation({ ...BASE, hsnCode: "" }, DISPLAY_NAME, { isIndia: true });
    expect(issues.some((i) => i.fieldPath === "hsnCode" && i.severity === "error")).toBe(true);
  });

  it("does not error on missing hsnCode when isIndia=false", () => {
    const issues = runAmazonLocalValidation({ ...BASE, hsnCode: "" }, DISPLAY_NAME, { isIndia: false });
    expect(issues.some((i) => i.fieldPath === "hsnCode" && i.severity === "error")).toBe(false);
  });

  // ── Country of origin ─────────────────────────────────────────────────────
  it("errors when countryOfOrigin is missing", () => {
    const { countryOfOrigin: _coo, ...withoutCoo } = BASE;
    const issues = runAmazonLocalValidation(withoutCoo as ProductPayload, DISPLAY_NAME);
    const err = issues.find((i) => i.fieldPath === "countryOfOrigin" && i.severity === "error");
    expect(err).toBeDefined();
    expect(err?.code).toBe("CHANNEL_REQUIRED_FIELD");
  });

  // ── Condition ─────────────────────────────────────────────────────────────
  it("errors on an invalid condition value", () => {
    const issues = runAmazonLocalValidation(
      { ...BASE, condition: "broken" as ProductPayload["condition"] },
      DISPLAY_NAME,
    );
    const err = issues.find((i) => i.fieldPath === "condition" && i.code === "INVALID_CONDITION");
    expect(err).toBeDefined();
  });

  it("accepts new / used / refurbished condition values", () => {
    for (const cond of ["new", "used", "refurbished"] as const) {
      const issues = runAmazonLocalValidation({ ...BASE, condition: cond }, DISPLAY_NAME);
      expect(issues.some((i) => i.fieldPath === "condition")).toBe(false);
    }
  });

  // ── Variation consistency ─────────────────────────────────────────────────
  it("errors when variationTheme is set but parentSku is absent", () => {
    const issues = runAmazonLocalValidation(
      { ...BASE, variationTheme: "SIZE" },
      DISPLAY_NAME,
    );
    const err = issues.find((i) => i.code === "VARIATION_MISSING_PARENT_SKU");
    expect(err).toBeDefined();
    expect(err?.severity).toBe("error");
  });

  it("errors when parentSku is set but variationTheme is absent", () => {
    const issues = runAmazonLocalValidation(
      { ...BASE, parentSku: "PARENT-SKU-001" },
      DISPLAY_NAME,
    );
    const err = issues.find((i) => i.code === "VARIATION_MISSING_THEME");
    expect(err).toBeDefined();
    expect(err?.severity).toBe("error");
  });

  it("accepts a product with both parentSku and variationTheme", () => {
    const issues = runAmazonLocalValidation(
      { ...BASE, parentSku: "PARENT-SKU-001", variationTheme: "SIZE" },
      DISPLAY_NAME,
    );
    expect(issues.some((i) => i.code === "VARIATION_MISSING_PARENT_SKU")).toBe(false);
    expect(issues.some((i) => i.code === "VARIATION_MISSING_THEME")).toBe(false);
  });

  // ── Price ─────────────────────────────────────────────────────────────────
  it("errors when mrp is zero or missing", () => {
    const issues = runAmazonLocalValidation({ ...BASE, mrp: 0 }, DISPLAY_NAME);
    expect(issues.some((i) => i.fieldPath === "mrp" && i.severity === "error")).toBe(true);
  });

  it("errors when sellingPrice is zero or missing", () => {
    const issues = runAmazonLocalValidation({ ...BASE, sellingPrice: 0 }, DISPLAY_NAME);
    expect(issues.some((i) => i.fieldPath === "sellingPrice" && i.severity === "error")).toBe(true);
  });

  it("warns when sellingPrice exceeds mrp", () => {
    const issues = runAmazonLocalValidation({ ...BASE, sellingPrice: 1200, mrp: 999 }, DISPLAY_NAME);
    const warn = issues.find((i) => i.code === "SELLING_PRICE_GT_MRP");
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe("warning");
  });

  // ── Category attributes ───────────────────────────────────────────────────
  it("errors when attributes.color is missing", () => {
    const issues = runAmazonLocalValidation(
      { ...BASE, attributes: { ...BASE.attributes, color: "" } },
      DISPLAY_NAME,
    );
    expect(issues.some((i) => i.fieldPath === "attributes.color" && i.severity === "error")).toBe(true);
  });

  it("errors when attributes.material is missing", () => {
    const issues = runAmazonLocalValidation(
      { ...BASE, attributes: { ...BASE.attributes, material: "" } },
      DISPLAY_NAME,
    );
    expect(issues.some((i) => i.fieldPath === "attributes.material" && i.severity === "error")).toBe(true);
  });
});

// ─── collectAmazonMissingFields ───────────────────────────────────────────────
describe("collectAmazonMissingFields", () => {
  it("returns empty array for a complete product", () => {
    const missing = collectAmazonMissingFields(BASE, AMAZON_DEFAULT_REQUIRED_FIELDS);
    expect(missing).toHaveLength(0);
  });

  it("reports missing mainImageUrl", () => {
    const missing = collectAmazonMissingFields({ ...BASE, mainImageUrl: "" }, AMAZON_DEFAULT_REQUIRED_FIELDS);
    expect(missing).toContain("mainImageUrl");
  });

  it("reports missing countryOfOrigin", () => {
    const { countryOfOrigin: _coo, ...withoutCoo } = BASE;
    const missing = collectAmazonMissingFields(withoutCoo as ProductPayload, AMAZON_DEFAULT_REQUIRED_FIELDS);
    expect(missing).toContain("countryOfOrigin");
  });
});

// ─── getProductFieldValue ─────────────────────────────────────────────────────
describe("getProductFieldValue", () => {
  it("resolves top-level fields correctly", () => {
    expect(getProductFieldValue("sku", BASE)).toBe(BASE.sku);
    expect(getProductFieldValue("title", BASE)).toBe(BASE.title);
    expect(getProductFieldValue("mainImageUrl", BASE)).toBe(BASE.mainImageUrl);
    expect(getProductFieldValue("countryOfOrigin", BASE)).toBe(BASE.countryOfOrigin);
    expect(getProductFieldValue("condition", BASE)).toBe(BASE.condition);
    expect(getProductFieldValue("parentSku", BASE)).toBeUndefined();
    expect(getProductFieldValue("variationTheme", BASE)).toBeUndefined();
  });

  it("resolves attributes.* fields correctly", () => {
    expect(getProductFieldValue("attributes.color", BASE)).toBe("Blue");
    expect(getProductFieldValue("attributes.material", BASE)).toBe("Cotton");
    expect(getProductFieldValue("attributes.nonexistent", BASE)).toBeUndefined();
  });

  it("returns undefined for unknown top-level paths", () => {
    expect(getProductFieldValue("nonexistentField", BASE)).toBeUndefined();
  });
});
