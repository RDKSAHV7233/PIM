// apps/api/src/connectors/shopify/shopify-category-rules.ts
//
// Shopify does not enforce category-specific field requirements server-side the
// way Flipkart/Amazon do — a merchant's store can sell anything under any
// "Product type" free-text label. This registry exists to give the mapping UI
// and publish-readiness checks (evaluatePublishReadiness) an authoritative
// schema to compare a mapping against, mirroring the pattern already
// established in flipkart-category-rules.ts.
//
// ADR-0008 (Target Schema Registry) §6 classifies Shopify's intended schema
// source as `api_fetched (potential)` — unlike Flipkart/Meesho/Myntra/Nykaa,
// Shopify plausibly CAN expose category/field requirements live via its own
// Admin API (e.g. metafield definitions, the Standardized Product Taxonomy),
// so a hardcoded local registry is not this connector's ADR-intended long-term
// shape. This module is a deliberate INTERIM `local_registry`-source stopgap
// (ADR-0008 §2) — the fastest way to give fetchProductTypeSchema a real,
// non-empty return value now — not a claim that Shopify's schema is
// API-unfetchable. Replacing it with a live `api_fetched` implementation is
// tracked as Shopify shadow-sprint follow-up work, not part of this file.
//
// Base required fields mirror this connector's own REQUIRED_FIELDS constant
// (the same list validateProduct's LOCAL_RULES path already enforces) plus the
// warning-level fields validateProduct already recommends (brand, productType).
// Field paths use ProductPayload's canonical names (e.g. "sku", "mainImageUrl")
// for top-level fields, and the "attributes." prefix only for genuinely
// custom/attribute-sourced fields — the same convention
// SYSTEM_CONNECTOR_DEFAULTS.shopify already uses in connector-mapping.service.ts.

import { ProductTypeSchema } from "../../connector-framework/connector.interface";

export type ShopifyFieldRule = {
  fieldPath: string;
  required: boolean;
  sellerMessage: string;
};

export type ShopifyCategoryRule = {
  /** Human-readable category label */
  displayName: string;
  /** Required and recommended fields for this category */
  fields: ShopifyFieldRule[];
  /** Valid values for select-type attributes, keyed by attribute name */
  validValues?: Record<string, string[]>;
};

// ─── field rule builders ───────────────────────────────────────────────────────

function req(fieldPath: string, sellerMessage: string): ShopifyFieldRule {
  return { fieldPath, required: true, sellerMessage };
}

function opt(fieldPath: string, sellerMessage: string): ShopifyFieldRule {
  return { fieldPath, required: false, sellerMessage };
}

// ─── shared base fields ────────────────────────────────────────────────────────
// Every Shopify listing must have these regardless of product type — kept in
// sync with this connector's own REQUIRED_FIELDS constant (validateProduct).

const BASE_FIELDS: ShopifyFieldRule[] = [
  req("sku", "Add a stable SKU before syncing to Shopify."),
  req("title", "Product title is required for Shopify sync."),
  req("description", "Description is required for Shopify sync."),
  req("mainImageUrl", "A primary HTTPS image is required for Shopify sync."),
  opt("brand", "Brand is recommended for cleaner Shopify merchandising and search."),
  opt("productType", "Product type is recommended so Shopify collections and filters stay structured."),
  opt("sellingPrice", "Selling price is recommended; a zero or missing price blocks a real sale."),
  opt("attributes.inventoryQty", "Inventory quantity keeps Shopify stock levels accurate."),
  opt("additionalImageUrls", "Adding more images improves listing quality on Shopify."),
];

// ─── category registry ─────────────────────────────────────────────────────────

export const SHOPIFY_CATEGORY_RULES: Record<string, ShopifyCategoryRule> = {

  // ── default (fallback for unmapped/uncategorised product types) ────────────
  default: {
    displayName: "General / Uncategorised",
    fields: BASE_FIELDS,
  },

  // ── apparel ───────────────────────────────────────────────────────────────
  // color/size/material are OPTIONAL here, not required: the only evidence for
  // them is that SYSTEM_CONNECTOR_DEFAULTS.shopify (connector-mapping.service.ts)
  // declares "attributes.color" -> "options.color" / "attributes.size" ->
  // "options.size" mapping TARGETS. A mapping target existing is not the same
  // claim as the destination marketplace requiring a value for it — Shopify
  // itself does not reject a product for lacking size/color options, and no
  // Vexa-specific Shopify business rule, validation rule, or documented
  // contract requiring them was found. Marked required only if such a rule is
  // later confirmed (see the module-level ADR-0008 note on api_fetched being
  // the eventual authoritative source for this).
  apparel: {
    displayName: "Clothing & Apparel",
    fields: [
      ...BASE_FIELDS,
      opt("attributes.color", "Color is recommended for apparel listings on Shopify."),
      opt("attributes.size", "Size is recommended for apparel listings on Shopify."),
      opt("attributes.material", "Fabric/material is recommended for apparel on Shopify."),
    ],
    validValues: {
      size: ["XS", "S", "M", "L", "XL", "XXL", "XXXL", "Free Size"],
    },
  },
};

// ─── lookup helpers ────────────────────────────────────────────────────────────

/**
 * Return the category rule for a given product type slug, falling back to
 * 'default'. Case-insensitive. Strips trailing path/underscore segments
 * (e.g. "apparel/kurtis" -> "apparel"), mirroring
 * flipkart-category-rules.ts's getCategoryRule.
 */
export function getCategoryRule(categorySlug: string): ShopifyCategoryRule {
  if (!categorySlug || typeof categorySlug !== "string") {
    return SHOPIFY_CATEGORY_RULES.default;
  }
  const normalised = categorySlug.trim().toLowerCase().split("/")[0].split("_")[0];
  return SHOPIFY_CATEGORY_RULES[normalised] ?? SHOPIFY_CATEGORY_RULES.default;
}

/**
 * Convert a ShopifyCategoryRule into a ProductTypeSchema so the mapping UI and
 * evaluatePublishReadiness can drive field requirements without knowing this
 * registry's internal shape.
 *
 * schemaVersion follows ADR-0008 §3's naming convention
 * ({source}-{connector}-{category}-{date}), e.g. "LOCAL-shopify-apparel-2026Q3".
 */
export function ruleToProductTypeSchema(
  categorySlug: string,
  rule: ShopifyCategoryRule,
): ProductTypeSchema {
  const requiredAttributes = rule.fields.filter((f) => f.required).map((f) => f.fieldPath);
  const optionalAttributes = rule.fields.filter((f) => !f.required).map((f) => f.fieldPath);
  const normalizedCategory = String(categorySlug ?? "").trim().toLowerCase() || "default";
  return {
    productType: categorySlug,
    requiredAttributes,
    optionalAttributes,
    validValues: rule.validValues ?? {},
    schemaVersion: `LOCAL-shopify-${normalizedCategory}-2026Q3`,
  };
}
