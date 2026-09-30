import type { ShopifyChannelProjection } from "./shopify-channel-projection";

export type ShopifyProductSetInputLike = Record<string, unknown>;
export type ShopifyProductSetIdentifierLike = { id: string } | { handle: string };
export type ShopifyVnextMutationPayload = {
  correlationId: string;
  input: ShopifyProductSetInputLike;
  identifier: ShopifyProductSetIdentifierLike;
};

export type ShopifyRollbackSnapshotSelectedOption = {
  name: string;
  value: string;
};

export type ShopifyRollbackSnapshotProductOption = {
  name: string;
  position?: number | null;
  values: string[];
};

export type ShopifyRollbackSnapshotVariant = {
  id?: string | null;
  sku?: string | null;
  price?: string | null;
  compareAtPrice?: string | null;
  barcode?: string | null;
  inventoryPolicy?: string | null;
  taxable?: boolean | null;
  selectedOptions: ShopifyRollbackSnapshotSelectedOption[];
  inventoryItem?: {
    id?: string | null;
    sku?: string | null;
    tracked?: boolean | null;
  } | null;
};

export type ShopifyRollbackSnapshotImage = {
  id?: string | null;
  src?: string | null;
  altText?: string | null;
};

export type ShopifyRollbackSnapshot = {
  capturedAt: string;
  product: {
    id: string;
    title?: string | null;
    handle?: string | null;
    descriptionHtml?: string | null;
    status?: string | null;
    vendor?: string | null;
    productType?: string | null;
    tags: string[];
    seo?: { title?: string | null; description?: string | null } | null;
    options: ShopifyRollbackSnapshotProductOption[];
    variants: ShopifyRollbackSnapshotVariant[];
    images: ShopifyRollbackSnapshotImage[];
  };
};

const DEFAULT_CUSTOM_ID_NAMESPACE = "pim_connector";
const DEFAULT_CUSTOM_ID_KEY = "sku";
const DEFAULT_PIM_METAFIELD_NAMESPACE = "pim_connector";

function normalizeOptionalString(value: unknown): string | undefined {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function formatMoney(value: number): string {
  const numeric = Number.isFinite(value) ? value : 0;
  return numeric.toFixed(2);
}

function buildHandleFromProjection(projection: ShopifyChannelProjection): string {
  const seed = `${projection.content.title} ${projection.identity.sku}`;
  return seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "product";
}

function normalizeMetafieldKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "attribute";
}

function stringifyMetafieldValue(value: unknown): { type: string; value: string } | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? { type: "single_line_text_field", value: trimmed } : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return { type: "single_line_text_field", value: String(value) };
  }
  return { type: "json", value: JSON.stringify(value) };
}

function buildProductOptions(projection: ShopifyChannelProjection): Record<string, unknown>[] {
  const firstVariantOptions = projection.variants[0]?.options ?? [];
  if (firstVariantOptions.length === 0) {
    return [{ name: "Title", position: 1, values: [{ name: "Default Title" }] }];
  }
  return firstVariantOptions.map((option, index) => ({
    name: option.optionName,
    position: index + 1,
    values: Array.from(
      new Set(
        projection.variants
          .map((variant) => variant.options.find((candidate) => candidate.optionName === option.optionName)?.name)
          .filter((name): name is string => Boolean(name)),
      ),
    ).map((name) => ({ name })),
  }));
}

function buildVariantInputs(projection: ShopifyChannelProjection): Record<string, unknown>[] {
  return projection.variants.map((variant) => {
    const effectiveCompareAt = variant.compareAtPrice ?? (variant.mrp > 0 ? variant.mrp : null);
    const optionValues = variant.options.length > 0
      ? variant.options
      : [{ optionName: "Title", name: "Default Title" }];
    return {
      price: formatMoney(variant.sellingPrice),
      ...(effectiveCompareAt && Number.isFinite(effectiveCompareAt) && effectiveCompareAt > 0
        ? { compareAtPrice: formatMoney(effectiveCompareAt) }
        : {}),
      inventoryPolicy: "CONTINUE",
      taxable: true,
      inventoryItem: {
        tracked: false,
        sku: String(variant.sku ?? "").trim(),
        ...(variant.weight && variant.weight > 0
          ? { measurement: { weight: { value: variant.weight, unit: variant.weightUnit ?? "KILOGRAMS" } } }
          : {}),
      },
      ...(variant.barcode ? { barcode: variant.barcode } : {}),
      optionValues,
    };
  });
}

function buildMetafields(projection: ShopifyChannelProjection): Record<string, unknown>[] {
  const metafields: Record<string, unknown>[] = [
    {
      namespace: DEFAULT_CUSTOM_ID_NAMESPACE,
      key: DEFAULT_CUSTOM_ID_KEY,
      type: "single_line_text_field",
      value: projection.identity.sku,
    },
    {
      namespace: DEFAULT_PIM_METAFIELD_NAMESPACE,
      key: "source_sku",
      type: "single_line_text_field",
      value: projection.identity.sku,
    },
  ];

  const seen = new Set(metafields.map((field) => `${field.namespace}.${field.key}`));
  for (const attribute of projection.attributes) {
    const rendered = stringifyMetafieldValue(attribute.value);
    if (!rendered) {
      continue;
    }
    const key = normalizeMetafieldKey(attribute.key);
    const identity = `${DEFAULT_PIM_METAFIELD_NAMESPACE}.${key}`;
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    metafields.push({
      namespace: DEFAULT_PIM_METAFIELD_NAMESPACE,
      key,
      type: rendered.type,
      value: rendered.value,
    });
  }

  return metafields;
}

function buildFiles(projection: ShopifyChannelProjection): Record<string, unknown>[] | undefined {
  const title = projection.content.title;
  const urls = [
    normalizeOptionalString(projection.media.mainImageUrl),
    ...projection.media.additionalImageUrls.map((url) => normalizeOptionalString(url)),
  ].filter((url): url is string => Boolean(url));
  if (urls.length === 0) {
    return undefined;
  }
  return urls.map((url, index) => ({
    originalSource: url,
    alt: index === 0 ? title : `${title} ${index + 1}`,
    contentType: "IMAGE",
    ...buildImageFilename(url, index),
  }));
}

function buildImageFilename(url: string, index: number): { filename: string } | Record<string, never> {
  const urlPath = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  const extMatch = urlPath.split("/").pop()?.split(".").slice(1).pop()?.toLowerCase();
  if (!extMatch || !/^[a-z0-9]{2,5}$/.test(extMatch)) {
    return {};
  }
  return { filename: index === 0 ? `product-image.${extMatch}` : `product-image-${index + 1}.${extMatch}` };
}

function buildRollbackProductOptions(product: ShopifyRollbackSnapshot["product"]): Array<Record<string, unknown>> {
  const options: Array<Record<string, unknown>> = [];
  product.options.forEach((option, index) => {
    const name = normalizeOptionalString(option.name);
    if (!name) {
      return;
    }
    const values = option.values
      .map((value) => normalizeOptionalString(value))
      .filter((value): value is string => Boolean(value))
      .map((name) => ({ name }));
    options.push({
      name,
      position: option.position ?? index + 1,
      values: values.length > 0 ? values : [{ name: "Default Title" }],
    });
  });

  return options.length > 0
    ? options
    : [{ name: "Title", position: 1, values: [{ name: "Default Title" }] }];
}

function buildRollbackVariantOptionValues(
  variant: ShopifyRollbackSnapshotVariant,
): Array<Record<string, unknown>> {
  const optionValues: Array<Record<string, unknown>> = [];
  variant.selectedOptions.forEach((option) => {
    const optionName = normalizeOptionalString(option.name);
    const name = normalizeOptionalString(option.value);
    if (optionName && name) {
      optionValues.push({ optionName, name });
    }
  });

  return optionValues.length > 0
    ? optionValues
    : [{ optionName: "Title", name: "Default Title" }];
}

function buildRollbackFiles(product: ShopifyRollbackSnapshot["product"]): Array<Record<string, unknown>> {
  const files: Array<Record<string, unknown>> = [];
  product.images.forEach((image, index) => {
    const originalSource = normalizeOptionalString(image.src);
    if (!originalSource) {
      return;
    }
    files.push({
      originalSource,
      alt: normalizeOptionalString(image.altText) ?? String(product.title ?? ""),
      contentType: "IMAGE",
      ...buildImageFilename(originalSource, index),
    });
  });
  return files;
}

export function buildShopifyVnextProductSetInput(
  projection: ShopifyChannelProjection,
): ShopifyProductSetInputLike {
  const vendor = normalizeOptionalString(projection.brand.vendor);
  const productType = normalizeOptionalString(projection.productType);
  const seoTitle = normalizeOptionalString(projection.content.seoTitle);
  const seoDescription = normalizeOptionalString(projection.content.seoDescription);
  const tags = projection.content.tags.map((tag) => tag.trim()).filter(Boolean);
  const files = buildFiles(projection);

  return {
    title: projection.content.title,
    handle: buildHandleFromProjection(projection),
    descriptionHtml: projection.content.description,
    status: projection.content.status,
    ...(vendor ? { vendor } : {}),
    ...(productType ? { productType } : {}),
    ...(seoTitle || seoDescription
      ? { seo: { ...(seoTitle ? { title: seoTitle } : {}), ...(seoDescription ? { description: seoDescription } : {}) } }
      : {}),
    ...(tags.length > 0 ? { tags } : {}),
    metafields: buildMetafields(projection),
    productOptions: buildProductOptions(projection),
    ...(files ? { files } : {}),
    variants: buildVariantInputs(projection),
  };
}

export function buildShopifyVnextProductIdentifier(
  projection: ShopifyChannelProjection,
  externalRef?: string | null,
): ShopifyProductSetIdentifierLike {
  const normalizedExternalRef = normalizeOptionalString(externalRef);
  if (normalizedExternalRef && /^gid:\/\/shopify\/Product\//.test(normalizedExternalRef)) {
    return { id: normalizedExternalRef };
  }
  return { handle: buildHandleFromProjection(projection) };
}

export function buildShopifyVnextMutationPayload(
  projection: ShopifyChannelProjection,
  correlationId: string,
  externalRef?: string | null,
): ShopifyVnextMutationPayload {
  return {
    correlationId,
    input: buildShopifyVnextProductSetInput(projection),
    identifier: buildShopifyVnextProductIdentifier(projection, externalRef),
  };
}

export function buildCompensatingWritePayload(
  snapshot: ShopifyRollbackSnapshot,
  correlationId: string,
): ShopifyVnextMutationPayload {
  const product = snapshot.product;
  const variants = product.variants.length > 0
    ? product.variants
    : [{
        sku: undefined,
        price: undefined,
        compareAtPrice: undefined,
        barcode: undefined,
        selectedOptions: [{ name: "Title", value: "Default Title" }],
      }];
  const files = buildRollbackFiles(product);
  const input: ShopifyProductSetInputLike = {
    title: String(product.title ?? ""),
    ...(normalizeOptionalString(product.handle) ? { handle: normalizeOptionalString(product.handle) } : {}),
    descriptionHtml: String(product.descriptionHtml ?? ""),
    ...(normalizeOptionalString(product.status) ? { status: normalizeOptionalString(product.status) } : {}),
    ...(normalizeOptionalString(product.vendor) ? { vendor: normalizeOptionalString(product.vendor) } : {}),
    ...(normalizeOptionalString(product.productType) ? { productType: normalizeOptionalString(product.productType) } : {}),
    ...(Array.isArray(product.tags) && product.tags.length > 0
      ? { tags: product.tags.map((tag) => String(tag ?? "").trim()).filter(Boolean) }
      : {}),
    ...(product.seo?.title || product.seo?.description
      ? {
          seo: {
            ...(normalizeOptionalString(product.seo.title) ? { title: normalizeOptionalString(product.seo.title) } : {}),
            ...(normalizeOptionalString(product.seo.description) ? { description: normalizeOptionalString(product.seo.description) } : {}),
          },
        }
      : {}),
    productOptions: buildRollbackProductOptions(product),
    variants: variants.map((variant) => ({
      ...(normalizeOptionalString(variant.price) ? { price: normalizeOptionalString(variant.price) } : {}),
      ...(normalizeOptionalString(variant.compareAtPrice)
        ? { compareAtPrice: normalizeOptionalString(variant.compareAtPrice) }
        : {}),
      ...(normalizeOptionalString(variant.inventoryPolicy)
        ? { inventoryPolicy: normalizeOptionalString(variant.inventoryPolicy) }
        : {}),
      ...(typeof variant.taxable === "boolean" ? { taxable: variant.taxable } : {}),
      inventoryItem: {
        tracked: typeof variant.inventoryItem?.tracked === "boolean" ? variant.inventoryItem.tracked : false,
        ...(normalizeOptionalString(variant.inventoryItem?.sku ?? variant.sku)
          ? { sku: normalizeOptionalString(variant.inventoryItem?.sku ?? variant.sku) }
          : {}),
      },
      ...(normalizeOptionalString(variant.barcode) ? { barcode: normalizeOptionalString(variant.barcode) } : {}),
      optionValues: buildRollbackVariantOptionValues(variant),
    })),
    ...(files.length > 0 ? { files } : {}),
  };

  return {
    correlationId,
    input,
    identifier: { id: product.id },
  };
}
