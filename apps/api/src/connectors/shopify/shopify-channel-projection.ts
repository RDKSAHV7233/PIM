// apps/api/src/connectors/shopify/shopify-channel-projection.ts
//
// Story 3 of the Shopify shadow-sprint restart: a bounded, provider-neutral
// outbound projection built from Vexa's canonical ProductPayload plus Story 1's
// target schema and Story 2's resolved mapping.
//
//   Canonical ProductPayload
//         |
//   Shopify Target Schema        <- Story 1 (fetchProductTypeSchema)
//         |
//   MappingResolutionService     <- Story 2 (resolveForConnector)
//         |
//   ChannelProjection            <- Story 3 (this file)
//
// This projection is PURE and DETERMINISTIC: given the same product,
// categoryScope, resolvedMapping, and targetSchema, buildShopifyChannelProjection
// always returns an equal result, with no I/O, no Shopify API calls, no
// credentials, and no mutation. It does not call MappingResolutionService or
// fetchProductTypeSchema itself — those are async service calls made by a
// future orchestrator (Story 4's non-mutating shadow execution); this module
// only consumes their already-resolved output.
//
// Scope boundary: this projection holds only Vexa's provider-neutral outbound
// semantics (identity, content, brand, product type, attributes, variants,
// media, taxonomy, readiness). It deliberately does NOT hold Shopify GraphQL
// mutation shapes, REST request objects, provider headers, or remote IDs used
// only for mutation — those stay in shopify.connector.ts's
// buildProductSetInput/buildVariantInput, which this file does not call, does
// not duplicate, and does not change. If Shopify ever needs something truly
// provider-specific, it belongs at that later adapter boundary, not here.

import type { ProductPayload, ProductTypeSchema } from "../../connector-framework/connector.interface";
import type { ResolvedConnectorMapping } from "../../marketplace/mapping-resolution.service";

export type ChannelProjectionAttribute = {
  /** Canonical attribute key, e.g. "color", "productType" (no "attributes." prefix). */
  key: string;
  value: unknown;
  /** "mapped" = resolved because the tenant's field mapping declares an attributes.<key> source. */
  source: "mapped";
};

export type ChannelProjectionVariant = {
  sku: string;
  sellingPrice: number;
  mrp: number;
  compareAtPrice?: number;
  barcode?: string;
  weight?: number;
  weightUnit?: string;
  options: Array<{ optionName: string; name: string }>;
};

export type ChannelProjectionReadiness = {
  schemaVersion: string;
  requiredFields: string[];
  missingRequiredFields: string[];
  coveredRequiredFields: string[];
};

export type ShopifyChannelProjection = {
  identity: { sku: string };
  content: {
    title: string;
    description: string;
    seoTitle?: string;
    seoDescription?: string;
    tags: string[];
    status: "ACTIVE" | "DRAFT";
  };
  brand: { vendor?: string };
  productType: string;
  attributes: ChannelProjectionAttribute[];
  variants: ChannelProjectionVariant[];
  media: { mainImageUrl?: string; additionalImageUrls: string[] };
  taxonomy: { categoryScope: string; productType: string };
  readiness: ChannelProjectionReadiness;
};

function normalizeOptionalString(value: unknown): string | undefined {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Reads a single field's value off the canonical ProductPayload, honoring the
 * same "attributes." prefix convention as the mapping/readiness system: an
 * "attributes.X" path reads product.attributes[X] (a distinct data bag, never
 * the top-level field even if names collide); anything else reads the
 * matching top-level ProductPayload field directly, matching how the real
 * Shopify connector reads sku/mainImageUrl/etc. straight off the product,
 * never through the mapping (see PR #992's investigation). This is value
 * lookup only — it does not resolve mapping precedence (Story 2's job) and
 * does not decide which fields are mapped (the caller's resolvedMapping /
 * targetSchema already decided that).
 */
function readCanonicalField(fieldPath: string, product: ProductPayload): unknown {
  const normalized = String(fieldPath ?? "").trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.startsWith("attributes.")) {
    return product.attributes?.[normalized.slice("attributes.".length)];
  }
  if (normalized in product) {
    return (product as unknown as Record<string, unknown>)[normalized];
  }
  return product.attributes?.[normalized];
}

/**
 * Every "attributes.X" source key the resolved mapping declares, paired with
 * its actual value off the product. Consumes MappingResolutionService's
 * already-resolved fieldMap — does not call it and does not duplicate its
 * precedence logic.
 */
function projectMappedAttributes(
  product: ProductPayload,
  resolvedMapping: ResolvedConnectorMapping,
): ChannelProjectionAttribute[] {
  const mappedKeys = Object.keys(resolvedMapping.fieldMap ?? {})
    .filter((sourceKey) => sourceKey.startsWith("attributes."))
    .map((sourceKey) => sourceKey.slice("attributes.".length));
  return mappedKeys.map((key) => ({
    key,
    value: readCanonicalField(`attributes.${key}`, product) ?? null,
    source: "mapped" as const,
  }));
}

function projectVariants(product: ProductPayload): ChannelProjectionVariant[] {
  if (Array.isArray(product.variants) && product.variants.length > 0) {
    return product.variants.map((v) => ({
      sku: String(v.sku ?? "").trim(),
      sellingPrice: v.sellingPrice,
      mrp: v.mrp,
      compareAtPrice: v.compareAtPrice,
      barcode: v.barcode,
      weight: v.weight,
      weightUnit: v.weightUnit,
      options: Array.isArray(v.options) ? v.options.map((o) => ({ ...o })) : [],
    }));
  }
  return [
    {
      sku: String(product.sku ?? "").trim(),
      sellingPrice: product.sellingPrice,
      mrp: product.mrp,
      compareAtPrice: product.compareAtPrice,
      options: [],
    },
  ];
}

function projectReadiness(product: ProductPayload, targetSchema: ProductTypeSchema): ChannelProjectionReadiness {
  const missingRequiredFields: string[] = [];
  const coveredRequiredFields: string[] = [];
  for (const field of targetSchema.requiredAttributes) {
    const value = readCanonicalField(field, product);
    if (isEmptyValue(value)) {
      missingRequiredFields.push(field);
    } else {
      coveredRequiredFields.push(field);
    }
  }
  return {
    schemaVersion: targetSchema.schemaVersion,
    requiredFields: [...targetSchema.requiredAttributes],
    missingRequiredFields,
    coveredRequiredFields,
  };
}

/**
 * Pure, deterministic: the same (product, categoryScope, resolvedMapping,
 * targetSchema) always produces an equal projection. No fetch, no Shopify
 * API client, no credentials, no mutation — see the module header for the
 * full scope boundary.
 */
export function buildShopifyChannelProjection(
  product: ProductPayload,
  categoryScope: string,
  resolvedMapping: ResolvedConnectorMapping,
  targetSchema: ProductTypeSchema,
): ShopifyChannelProjection {
  const productType = normalizeOptionalString(product.productType) ?? "";
  return {
    identity: { sku: String(product.sku ?? "").trim() },
    content: {
      title: String(product.title ?? "").trim(),
      description: String(product.description ?? "").trim(),
      seoTitle: normalizeOptionalString(product.seoTitle),
      seoDescription: normalizeOptionalString(product.seoDescription),
      tags: Array.isArray(product.tags) ? product.tags.map((t) => String(t ?? "").trim()).filter(Boolean) : [],
      status: product.status === "DRAFT" ? "DRAFT" : "ACTIVE",
    },
    brand: { vendor: normalizeOptionalString(product.brand) },
    productType,
    attributes: projectMappedAttributes(product, resolvedMapping),
    variants: projectVariants(product),
    media: {
      mainImageUrl: normalizeOptionalString(product.mainImageUrl),
      additionalImageUrls: Array.isArray(product.additionalImageUrls) ? [...product.additionalImageUrls] : [],
    },
    taxonomy: { categoryScope, productType },
    readiness: projectReadiness(product, targetSchema),
  };
}
