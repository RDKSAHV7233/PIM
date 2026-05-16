// apps/api/src/connectors/flipkart/flipkart-category-rules.spec.ts
// Unit tests for Sprint C: Flipkart category rule registry and schema conversion.

import {
  getCategoryRule,
  ruleToProductTypeSchema,
  FLIPKART_CATEGORY_RULES,
} from "./flipkart-category-rules";

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
    expect(getCategoryRule("Footwear").displayName).toBe("Footwear");
  });

  it("strips sub-category path segment (apparel/kurtis → apparel)", () => {
    expect(getCategoryRule("apparel/kurtis").displayName).toBe("Clothing & Apparel");
  });

  it("returns the electronics rule for 'electronics'", () => {
    expect(getCategoryRule("electronics").displayName).toBe("Electronics & Accessories");
  });

  it("returns the mobiles rule for 'mobiles'", () => {
    expect(getCategoryRule("mobiles").displayName).toBe("Mobile Phones & Accessories");
  });

  it("returns the books rule for 'books'", () => {
    expect(getCategoryRule("books").displayName).toBe("Books");
  });

  it("covers all registered categories without throwing", () => {
    for (const slug of Object.keys(FLIPKART_CATEGORY_RULES)) {
      expect(() => getCategoryRule(slug)).not.toThrow();
    }
  });
});

// ── category field rules ────────────────────────────────────────────────────────

describe("FLIPKART_CATEGORY_RULES — field rule integrity", () => {
  it("every category has at least the 12 base required fields", () => {
    const baseRequired = [
      "sku", "title", "brand", "description", "mainImageUrl",
      "mrp", "sellingPrice", "hsnCode",
      "attributes.packageWeight", "attributes.packageLength",
      "attributes.packageBreadth", "attributes.packageHeight",
    ];
    for (const [slug, rule] of Object.entries(FLIPKART_CATEGORY_RULES)) {
      const requiredPaths = rule.fields.filter((f) => f.required).map((f) => f.fieldPath);
      for (const base of baseRequired) {
        expect(requiredPaths).toContain(base); // Failing here means a category stripped a base field
      }
    }
  });

  it("apparel rule requires color, size, and material", () => {
    const apparel = FLIPKART_CATEGORY_RULES.apparel;
    const requiredPaths = apparel.fields.filter((f) => f.required).map((f) => f.fieldPath);
    expect(requiredPaths).toContain("attributes.color");
    expect(requiredPaths).toContain("attributes.size");
    expect(requiredPaths).toContain("attributes.material");
  });

  it("electronics rule requires modelNumber and warrantyType", () => {
    const electronics = FLIPKART_CATEGORY_RULES.electronics;
    const requiredPaths = electronics.fields.filter((f) => f.required).map((f) => f.fieldPath);
    expect(requiredPaths).toContain("attributes.modelNumber");
    expect(requiredPaths).toContain("attributes.warrantyType");
  });

  it("books rule requires isbn, author, publisher, language, binding", () => {
    const books = FLIPKART_CATEGORY_RULES.books;
    const requiredPaths = books.fields.filter((f) => f.required).map((f) => f.fieldPath);
    expect(requiredPaths).toContain("attributes.isbn");
    expect(requiredPaths).toContain("attributes.author");
    expect(requiredPaths).toContain("attributes.publisher");
    expect(requiredPaths).toContain("attributes.language");
    expect(requiredPaths).toContain("attributes.binding");
  });

  it("grocery rule requires weight, expiryMonths, ingredients, dietaryInfo", () => {
    const grocery = FLIPKART_CATEGORY_RULES.grocery;
    const requiredPaths = grocery.fields.filter((f) => f.required).map((f) => f.fieldPath);
    expect(requiredPaths).toContain("attributes.weight");
    expect(requiredPaths).toContain("attributes.expiryMonths");
    expect(requiredPaths).toContain("attributes.ingredients");
    expect(requiredPaths).toContain("attributes.dietaryInfo");
  });

  it("every field rule has a non-empty sellerMessage", () => {
    for (const [slug, rule] of Object.entries(FLIPKART_CATEGORY_RULES)) {
      for (const field of rule.fields) {
        expect(field.sellerMessage.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("no duplicate fieldPaths within a single category rule", () => {
    for (const [slug, rule] of Object.entries(FLIPKART_CATEGORY_RULES)) {
      const paths = rule.fields.map((f) => f.fieldPath);
      const unique = new Set(paths);
      expect(unique.size).toBe(paths.length);
    }
  });
});

// ── ruleToProductTypeSchema ───────────────────────────────────────────────────

describe("ruleToProductTypeSchema", () => {
  it("converts an apparel rule into a ProductTypeSchema", () => {
    const rule = FLIPKART_CATEGORY_RULES.apparel;
    const schema = ruleToProductTypeSchema("apparel", rule);

    expect(schema.productType).toBe("apparel");
    expect(schema.schemaVersion).toMatch(/LOCAL-/);
    expect(schema.requiredAttributes).toContain("attributes.color");
    expect(schema.requiredAttributes).toContain("attributes.size");
    expect(schema.optionalAttributes).toContain("attributes.fit");
  });

  it("required and optional are mutually exclusive", () => {
    for (const [slug, rule] of Object.entries(FLIPKART_CATEGORY_RULES)) {
      const schema = ruleToProductTypeSchema(slug, rule);
      const reqSet = new Set(schema.requiredAttributes);
      for (const opt of schema.optionalAttributes) {
        expect(reqSet.has(opt)).toBe(false);
      }
    }
  });

  it("carries validValues through for apparel size/fit/gender", () => {
    const schema = ruleToProductTypeSchema("apparel", FLIPKART_CATEGORY_RULES.apparel);
    expect(schema.validValues["size"]).toContain("XL");
    expect(schema.validValues["gender"]).toContain("Unisex");
  });

  it("returns empty validValues object when rule has none", () => {
    const schema = ruleToProductTypeSchema("default", FLIPKART_CATEGORY_RULES.default);
    expect(schema.validValues).toEqual({});
  });
});
