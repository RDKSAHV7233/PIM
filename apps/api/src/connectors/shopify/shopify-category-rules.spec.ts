// apps/api/src/connectors/shopify/shopify-category-rules.spec.ts
// Unit tests for the Shopify Target Schema vNext registry and schema conversion,
// mirroring flipkart-category-rules.spec.ts's coverage shape.

import {
  getCategoryRule,
  ruleToProductTypeSchema,
  SHOPIFY_CATEGORY_RULES,
} from "./shopify-category-rules";

// ── getCategoryRule ────────────────────────────────────────────────────────────

describe("getCategoryRule", () => {
  it("returns the default rule for an empty slug", () => {
    expect(getCategoryRule("").displayName).toBe("General / Uncategorised");
  });

  it("returns the default rule for an unknown slug", () => {
    expect(getCategoryRule("unknown_xyz").displayName).toBe("General / Uncategorised");
  });

  it("returns the apparel rule for 'apparel'", () => {
    expect(getCategoryRule("apparel").displayName).toBe("Clothing & Apparel");
  });

  it("is case-insensitive", () => {
    expect(getCategoryRule("APPAREL").displayName).toBe("Clothing & Apparel");
  });

  it("strips sub-category path segment (apparel/kurtis -> apparel)", () => {
    expect(getCategoryRule("apparel/kurtis").displayName).toBe("Clothing & Apparel");
  });

  it("covers all registered categories without throwing", () => {
    for (const slug of Object.keys(SHOPIFY_CATEGORY_RULES)) {
      expect(() => getCategoryRule(slug)).not.toThrow();
    }
  });
});

// ── category field rules ────────────────────────────────────────────────────────

describe("SHOPIFY_CATEGORY_RULES — field rule integrity", () => {
  it("every category has at least the 4 base required fields, matching this connector's own REQUIRED_FIELDS", () => {
    // Kept identical to shopify.connector.ts's REQUIRED_FIELDS constant — if that
    // list changes, this registry must be updated to match, not silently diverge.
    const baseRequired = ["sku", "title", "description", "mainImageUrl"];
    for (const [, rule] of Object.entries(SHOPIFY_CATEGORY_RULES)) {
      const requiredPaths = rule.fields.filter((f) => f.required).map((f) => f.fieldPath);
      for (const base of baseRequired) {
        expect(requiredPaths).toContain(base);
      }
    }
  });

  it("apparel rule recommends (does not require) color and size — no confirmed Shopify business rule mandates them", () => {
    const apparel = SHOPIFY_CATEGORY_RULES.apparel;
    const requiredPaths = apparel.fields.filter((f) => f.required).map((f) => f.fieldPath);
    const optionalPaths = apparel.fields.filter((f) => !f.required).map((f) => f.fieldPath);
    expect(requiredPaths).not.toContain("attributes.color");
    expect(requiredPaths).not.toContain("attributes.size");
    expect(optionalPaths).toContain("attributes.color");
    expect(optionalPaths).toContain("attributes.size");
  });

  it("default rule does not require color or size", () => {
    const defaultRule = SHOPIFY_CATEGORY_RULES.default;
    const requiredPaths = defaultRule.fields.filter((f) => f.required).map((f) => f.fieldPath);
    expect(requiredPaths).not.toContain("attributes.color");
    expect(requiredPaths).not.toContain("attributes.size");
  });
});

// ── ruleToProductTypeSchema ───────────────────────────────────────────────────

describe("ruleToProductTypeSchema", () => {
  it("converts the default rule into a ProductTypeSchema using canonical ProductPayload field names", () => {
    const schema = ruleToProductTypeSchema("default", SHOPIFY_CATEGORY_RULES.default);

    expect(schema.productType).toBe("default");
    expect(schema.schemaVersion).toMatch(/LOCAL-/);
    expect(schema.requiredAttributes).toEqual(
      expect.arrayContaining(["sku", "title", "description", "mainImageUrl"]),
    );
  });

  it("converts an apparel rule into a ProductTypeSchema with color/size as optional", () => {
    const schema = ruleToProductTypeSchema("apparel", SHOPIFY_CATEGORY_RULES.apparel);

    expect(schema.optionalAttributes).toContain("attributes.color");
    expect(schema.optionalAttributes).toContain("attributes.size");
    expect(schema.optionalAttributes).toContain("attributes.material");
    expect(schema.requiredAttributes).not.toContain("attributes.color");
    expect(schema.requiredAttributes).not.toContain("attributes.size");
  });

  it("schemaVersion follows the ADR-0008 naming convention ({source}-{connector}-{category}-{date})", () => {
    const schema = ruleToProductTypeSchema("apparel", SHOPIFY_CATEGORY_RULES.apparel);
    expect(schema.schemaVersion).toBe("LOCAL-shopify-apparel-2026Q3");
  });

  it("required and optional are mutually exclusive", () => {
    for (const [slug, rule] of Object.entries(SHOPIFY_CATEGORY_RULES)) {
      const schema = ruleToProductTypeSchema(slug, rule);
      const reqSet = new Set(schema.requiredAttributes);
      for (const opt of schema.optionalAttributes) {
        expect(reqSet.has(opt)).toBe(false);
      }
    }
  });

  it("carries validValues through for apparel size", () => {
    const schema = ruleToProductTypeSchema("apparel", SHOPIFY_CATEGORY_RULES.apparel);
    expect(schema.validValues["size"]).toContain("XL");
  });

  it("returns an empty validValues object when the rule has none", () => {
    const schema = ruleToProductTypeSchema("default", SHOPIFY_CATEGORY_RULES.default);
    expect(schema.validValues).toEqual({});
  });
});
