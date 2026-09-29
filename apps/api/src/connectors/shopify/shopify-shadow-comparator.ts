// apps/api/src/connectors/shopify/shopify-shadow-comparator.ts
//
// Story 5 of the Shopify shadow-sprint restart: a pure, deterministic semantic
// comparator that checks whether Story 3's ChannelProjection stays faithful to
// the same canonical ProductPayload the legacy Shopify publish path actually
// reads from. This is the verification step the whole shadow sprint exists
// for: proving the new pipeline agrees with reality before it is ever trusted
// to drive a real publish.
//
// Scope: this compares the PROJECTION against its own SOURCE data
// (ProductPayload), not against Shopify's wire-level GraphQL payload or its
// compiled metafields — reproducing compileShopifyMetafieldsFromMapping's
// exact key-naming logic here would duplicate mapping logic Story 2 already
// owns. What this DOES prove: the projection did not drop, corrupt, or
// diverge from any canonical field or mapped attribute value the legacy path
// also has available — the correct, narrow bar for "safe to compare" without
// re-deriving anything.
//
// Pure and side-effect free: no I/O, no Shopify API client, no mutation.

import type { ProductPayload } from "../../connector-framework/connector.interface";
import type { ShopifyChannelProjection } from "./shopify-channel-projection";

export type ShadowComparisonMismatch = {
  field: string;
  expected: unknown;
  actual: unknown;
};

export type ShadowComparisonResult = {
  matches: boolean;
  mismatches: ShadowComparisonMismatch[];
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

function pushMismatch(mismatches: ShadowComparisonMismatch[], field: string, expected: unknown, actual: unknown): void {
  const same = Array.isArray(expected) && Array.isArray(actual)
    ? JSON.stringify(expected) === JSON.stringify(actual)
    : expected === actual;
  if (!same) {
    mismatches.push({ field, expected, actual });
  }
}

/**
 * Compares a ChannelProjection against the exact ProductPayload it was built
 * from. Every canonical field the projection exposes is expected to equal the
 * source value byte-for-byte, since both the projection (Story 3) and the
 * legacy connector's buildProductSetInput read these fields directly off
 * ProductPayload with no transformation on either side (see PR #992's
 * investigation). A mismatch here means the projection itself has drifted
 * from its own source, not that legacy and vNext disagree about mapping.
 */
export function compareProjectionToSource(
  projection: ShopifyChannelProjection,
  productPayload: ProductPayload,
): ShadowComparisonResult {
  const mismatches: ShadowComparisonMismatch[] = [];

  pushMismatch(mismatches, "identity.sku", String(productPayload.sku ?? "").trim(), projection.identity.sku);
  pushMismatch(mismatches, "content.title", String(productPayload.title ?? "").trim(), projection.content.title);
  pushMismatch(
    mismatches,
    "content.description",
    String(productPayload.description ?? "").trim(),
    projection.content.description,
  );
  pushMismatch(
    mismatches,
    "content.status",
    productPayload.status === "DRAFT" ? "DRAFT" : "ACTIVE",
    projection.content.status,
  );
  pushMismatch(mismatches, "brand.vendor", normalizeOptionalString(productPayload.brand), projection.brand.vendor);
  pushMismatch(
    mismatches,
    "productType",
    normalizeOptionalString(productPayload.productType) ?? "",
    projection.productType,
  );
  pushMismatch(
    mismatches,
    "media.mainImageUrl",
    normalizeOptionalString(productPayload.mainImageUrl),
    projection.media.mainImageUrl,
  );
  pushMismatch(
    mismatches,
    "media.additionalImageUrls",
    Array.isArray(productPayload.additionalImageUrls) ? [...productPayload.additionalImageUrls] : [],
    projection.media.additionalImageUrls,
  );

  // Variant parity: same count, and each variant's sku/sellingPrice/mrp must
  // trace back to the source (either the real variants array, or the single
  // synthetic variant Story 3 builds from top-level fields when absent).
  const sourceVariants = Array.isArray(productPayload.variants) && productPayload.variants.length > 0
    ? productPayload.variants
    : [{ sku: productPayload.sku, sellingPrice: productPayload.sellingPrice, mrp: productPayload.mrp }];
  pushMismatch(mismatches, "variants.length", sourceVariants.length, projection.variants.length);
  const variantCount = Math.min(sourceVariants.length, projection.variants.length);
  for (let i = 0; i < variantCount; i += 1) {
    pushMismatch(mismatches, `variants[${i}].sku`, String(sourceVariants[i]?.sku ?? "").trim(), projection.variants[i]?.sku);
    pushMismatch(
      mismatches,
      `variants[${i}].sellingPrice`,
      sourceVariants[i]?.sellingPrice,
      projection.variants[i]?.sellingPrice,
    );
    pushMismatch(mismatches, `variants[${i}].mrp`, sourceVariants[i]?.mrp, projection.variants[i]?.mrp);
  }

  // Mapped-attribute fidelity: every attribute the projection lists as
  // "mapped" must equal the same key's value on the product's own attributes
  // bag — proving the projection didn't corrupt or invent a value.
  for (const attribute of projection.attributes) {
    const sourceValue = productPayload.attributes?.[attribute.key] ?? null;
    pushMismatch(mismatches, `attributes.${attribute.key}`, sourceValue, attribute.value);
  }

  // Readiness fidelity: a field the projection reports missing must actually
  // be empty on the source, and vice versa — catching any future drift
  // between the projection's own field-reading logic and its emptiness rule.
  for (const field of projection.readiness.requiredFields) {
    const isAttributesField = field.startsWith("attributes.");
    const sourceValue = isAttributesField
      ? productPayload.attributes?.[field.slice("attributes.".length)]
      : (productPayload as unknown as Record<string, unknown>)[field];
    const expectedMissing = isEmptyValue(sourceValue);
    const actualMissing = projection.readiness.missingRequiredFields.includes(field);
    pushMismatch(mismatches, `readiness.${field}.missing`, expectedMissing, actualMissing);
  }

  return { matches: mismatches.length === 0, mismatches };
}
