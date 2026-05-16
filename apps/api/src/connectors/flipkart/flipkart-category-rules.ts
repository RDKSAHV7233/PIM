// apps/api/src/connectors/flipkart/flipkart-category-rules.ts
//
// Flipkart does not expose a public "describe category attributes" API the way
// Amazon's Product Type Definitions API does. This registry is locally maintained
// and should be reviewed against Flipkart's seller category templates each quarter.
//
// Flipkart listing attributes reference:
//   https://seller.flipkart.com/api-docs/listing-api-docs/LMAPIRef.html
//
// CTO decision: local registry + quarterly review is safer than scraping Flipkart's
// seller portal, which has no stable programmatic schema endpoint.

import { ProductTypeSchema } from "../../connector-framework/connector.interface";

export type FieldRule = {
  fieldPath: string;
  required: boolean;
  sellerMessage: string;
};

export type FlipkartCategoryRule = {
  /** Human-readable Flipkart category name */
  displayName: string;
  /** Required and recommended fields for this category */
  fields: FieldRule[];
  /** Valid values for select-type attributes, keyed by attribute name */
  validValues?: Record<string, string[]>;
};

// ─── field rule builders ───────────────────────────────────────────────────────

function req(fieldPath: string, sellerMessage: string): FieldRule {
  return { fieldPath, required: true, sellerMessage };
}

function opt(fieldPath: string, sellerMessage: string): FieldRule {
  return { fieldPath, required: false, sellerMessage };
}

// ─── shared base fields ────────────────────────────────────────────────────────
// Every Flipkart listing must have these regardless of category.

const BASE_FIELDS: FieldRule[] = [
  req("sku",                    "Seller SKU is required for all Flipkart listings."),
  req("title",                  "Product title is required for Flipkart."),
  req("brand",                  "Brand is required for Flipkart."),
  req("description",            "Product description/key specifications are required."),
  req("mainImageUrl",           "At least one product image with an HTTPS URL is required."),
  req("mrp",                    "MRP is required for Flipkart listings."),
  req("sellingPrice",           "Selling price is required for Flipkart listings."),
  req("hsnCode",                "HSN code is required for all Flipkart listings (Indian tax compliance)."),
  req("attributes.packageWeight",    "Package weight (in grams) is required by Flipkart."),
  req("attributes.packageLength",    "Package length (in cm) is required by Flipkart."),
  req("attributes.packageBreadth",   "Package breadth (in cm) is required by Flipkart."),
  req("attributes.packageHeight",    "Package height (in cm) is required by Flipkart."),
  req("attributes.procurementSla",   "Procurement SLA (days) is required for Flipkart."),
  req("attributes.procurementType",  "Procurement type (REGULAR or LIMITED) is required."),
  opt("attributes.shippingProvider", "Specify the shipping provider (e.g. seller-standard, ekart)."),
  opt("additionalImageUrls",         "Adding more images improves listing quality on Flipkart."),
];

// ─── category registry ─────────────────────────────────────────────────────────

export const FLIPKART_CATEGORY_RULES: Record<string, FlipkartCategoryRule> = {

  // ── default (fallback for unmapped categories) ─────────────────────────────
  default: {
    displayName: "General / Uncategorised",
    fields: BASE_FIELDS,
  },

  // ── apparel ───────────────────────────────────────────────────────────────
  apparel: {
    displayName: "Clothing & Apparel",
    fields: [
      ...BASE_FIELDS,
      req("attributes.color",   "Color is required for apparel listings on Flipkart."),
      req("attributes.size",    "Size is required for apparel listings on Flipkart."),
      req("attributes.material","Fabric/material is required for apparel on Flipkart."),
      opt("attributes.fit",     "Fit type (Regular, Slim, Loose) improves discoverability."),
      opt("attributes.occasion","Occasion type (Casual, Formal, Party) is recommended."),
      opt("attributes.pattern", "Pattern (Solid, Striped, Printed) is recommended."),
      opt("attributes.gender",  "Gender (Men, Women, Unisex, Boys, Girls) is recommended."),
    ],
    validValues: {
      size: ["XS","S","M","L","XL","XXL","XXXL","Free Size"],
      fit: ["Regular","Slim","Loose","Comfort"],
      gender: ["Men","Women","Unisex","Boys","Girls","Infant"],
    },
  },

  // ── footwear ──────────────────────────────────────────────────────────────
  footwear: {
    displayName: "Footwear",
    fields: [
      ...BASE_FIELDS,
      req("attributes.color",       "Color is required for footwear on Flipkart."),
      req("attributes.size",        "Shoe size (numeric UK/EU) is required."),
      req("attributes.material",    "Upper material is required for footwear."),
      req("attributes.gender",      "Gender (Men, Women, Unisex) is required for footwear."),
      opt("attributes.closureType", "Closure type (Lace-Up, Slip-On, Velcro) is recommended."),
      opt("attributes.soleMaterial","Sole material is recommended for footwear."),
    ],
    validValues: {
      gender: ["Men","Women","Unisex","Boys","Girls"],
      closureType: ["Lace-Up","Slip-On","Velcro","Buckle","Hook & Loop"],
    },
  },

  // ── electronics ───────────────────────────────────────────────────────────
  electronics: {
    displayName: "Electronics & Accessories",
    fields: [
      ...BASE_FIELDS,
      req("attributes.modelNumber",  "Model number is required for electronics on Flipkart."),
      req("attributes.color",        "Color is required for electronics listings."),
      req("attributes.warrantyType", "Warranty type (Seller Warranty, Brand Warranty) is required."),
      req("attributes.warrantyMonths","Warranty duration in months is required."),
      opt("attributes.batteryLife",  "Battery life (hours) is recommended for battery-powered devices."),
      opt("attributes.connectivity", "Connectivity type (Bluetooth, WiFi, USB) is recommended."),
      opt("attributes.compatibility","Compatible devices/OS is recommended."),
    ],
    validValues: {
      warrantyType: ["Seller Warranty","Brand Warranty","No Warranty"],
    },
  },

  // ── mobile phones ─────────────────────────────────────────────────────────
  mobiles: {
    displayName: "Mobile Phones & Accessories",
    fields: [
      ...BASE_FIELDS,
      req("attributes.modelNumber",  "Model number is required for mobile phones."),
      req("attributes.color",        "Color is required for mobile phone listings."),
      req("attributes.ram",          "RAM (GB) is required for mobile phones."),
      req("attributes.storage",      "Internal storage (GB) is required for mobile phones."),
      req("attributes.os",           "Operating system (Android, iOS) is required."),
      req("attributes.warrantyMonths","Warranty duration in months is required."),
      opt("attributes.screenSize",   "Screen size (inches) is recommended."),
      opt("attributes.batteryCapacity","Battery capacity (mAh) is recommended."),
      opt("attributes.network",      "Network type (4G, 5G) is recommended."),
    ],
    validValues: {
      os: ["Android","iOS","KaiOS","Other"],
      network: ["2G","3G","4G","5G"],
    },
  },

  // ── home & furniture ──────────────────────────────────────────────────────
  home: {
    displayName: "Home & Furniture",
    fields: [
      ...BASE_FIELDS,
      req("attributes.color",       "Color is required for home products."),
      req("attributes.material",    "Material is required for home products."),
      opt("attributes.dimensions",  "Dimensions (L x W x H cm) are recommended for furniture."),
      opt("attributes.finish",      "Surface finish (Matte, Gloss, Natural) is recommended."),
      opt("attributes.assemblyRequired","Assembly required (Yes/No) is recommended."),
      opt("attributes.numberOfPieces","Number of pieces in the set is recommended."),
    ],
  },

  // ── beauty & personal care ────────────────────────────────────────────────
  beauty: {
    displayName: "Beauty & Personal Care",
    fields: [
      ...BASE_FIELDS,
      req("attributes.skinType",       "Skin type (Oily, Dry, Normal, Combination, All) is required."),
      req("attributes.formulation",    "Formulation (Cream, Gel, Serum, Lotion) is required."),
      opt("attributes.ingredients",    "Key ingredients improve search and compliance."),
      opt("attributes.fragranceFamily","Fragrance family is recommended for perfumes/deodorants."),
      opt("attributes.shadeRange",     "Shade/color range is recommended for makeup products."),
    ],
    validValues: {
      skinType: ["Oily","Dry","Normal","Combination","Sensitive","All Skin Types"],
    },
  },

  // ── books ─────────────────────────────────────────────────────────────────
  books: {
    displayName: "Books",
    fields: [
      ...BASE_FIELDS,
      req("attributes.isbn",       "ISBN is required for books on Flipkart."),
      req("attributes.author",     "Author name is required."),
      req("attributes.publisher",  "Publisher name is required."),
      req("attributes.language",   "Language of the book is required."),
      req("attributes.binding",    "Binding type (Paperback, Hardcover) is required."),
      opt("attributes.edition",    "Edition number is recommended."),
      opt("attributes.pages",      "Number of pages is recommended."),
    ],
    validValues: {
      binding: ["Paperback","Hardcover","Board Book","Spiral-Bound","E-Book"],
    },
  },

  // ── toys & baby ───────────────────────────────────────────────────────────
  toys: {
    displayName: "Toys, Baby & Kids",
    fields: [
      ...BASE_FIELDS,
      req("attributes.ageGroup",       "Age group (0-6 months, 3-5 years, etc.) is required."),
      req("attributes.material",       "Material is required — important for toy safety compliance."),
      req("attributes.safetyWarnings", "Safety warnings (choking hazard etc.) are required."),
      opt("attributes.color",          "Color is recommended for toys."),
      opt("attributes.batteryRequired","Battery required (Yes/No/Included) is recommended."),
    ],
  },

  // ── sports & fitness ──────────────────────────────────────────────────────
  sports: {
    displayName: "Sports, Fitness & Outdoors",
    fields: [
      ...BASE_FIELDS,
      req("attributes.color",    "Color is required for sports products."),
      req("attributes.material", "Material is required for sports equipment."),
      opt("attributes.size",     "Size or dimensions are recommended."),
      opt("attributes.weight",   "Product weight is recommended for gym/fitness equipment."),
      opt("attributes.sport",    "Sport category (Running, Cricket, Football) is recommended."),
    ],
  },

  // ── grocery & gourmet ─────────────────────────────────────────────────────
  grocery: {
    displayName: "Grocery & Gourmet Foods",
    fields: [
      ...BASE_FIELDS,
      req("attributes.weight",         "Net weight (grams/kg) is required for grocery items."),
      req("attributes.expiryMonths",   "Shelf life in months is required for grocery."),
      req("attributes.ingredients",    "Ingredients list is required for food products."),
      req("attributes.dietaryInfo",    "Dietary information (Vegan, Gluten-Free) is required."),
      opt("attributes.storageInfo",    "Storage instructions are recommended."),
      opt("attributes.nutritionFacts", "Nutritional information is recommended."),
    ],
  },
};

// ─── lookup helpers ────────────────────────────────────────────────────────────

/**
 * Return the category rule for a given slug, falling back to 'default'.
 * Case-insensitive. Strips trailing path segments (e.g. "apparel/kurtis" → "apparel").
 */
export function getCategoryRule(categorySlug: string): FlipkartCategoryRule {
  if (!categorySlug || typeof categorySlug !== "string") {
    return FLIPKART_CATEGORY_RULES.default;
  }
  const normalised = categorySlug.trim().toLowerCase().split("/")[0].split("_")[0];
  return (
    FLIPKART_CATEGORY_RULES[normalised] ??
    FLIPKART_CATEGORY_RULES.default
  );
}

/**
 * Convert a FlipkartCategoryRule into a ProductTypeSchema so the mapping UI
 * can drive field requirements without knowing internal rule structure.
 */
export function ruleToProductTypeSchema(
  categorySlug: string,
  rule: FlipkartCategoryRule,
): ProductTypeSchema {
  const requiredAttributes = rule.fields
    .filter((f) => f.required)
    .map((f) => f.fieldPath);
  const optionalAttributes = rule.fields
    .filter((f) => !f.required)
    .map((f) => f.fieldPath);
  return {
    productType: categorySlug,
    requiredAttributes,
    optionalAttributes,
    validValues: rule.validValues ?? {},
    schemaVersion: "LOCAL-2026-Q2",
  };
}
