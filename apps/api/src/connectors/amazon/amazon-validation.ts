import { ConnectorIssue, ProductPayload } from "../../connector-framework/connector.interface";

const CONNECTOR_HTTP_TIMEOUT_MS = 30_000;
const AMAZON_TITLE_MAX_LENGTH = 200;
const AMAZON_BULLET_POINTS_MAX = 5;
const AMAZON_ADDITIONAL_IMAGES_MAX = 8;

export const AMAZON_DEFAULT_REQUIRED_FIELDS = [
  "title",
  "brand",
  "description",
  "mainImageUrl",
  "hsnCode",
  "gstRate",
  "countryOfOrigin",
  "attributes.color",
  "attributes.material",
] as const;

export const AMAZON_DEFAULT_FIELD_MAP: Record<string, string> = {
  title: "item_name",
  brand: "brand_name",
  description: "product_description",
  mainImageUrl: "main_product_image_locator",
  hsnCode: "hsn_code",
  gstRate: "tax_rate",
  countryOfOrigin: "country_of_origin",
  "attributes.color": "color_name",
  "attributes.material": "material_type",
  "attributes.size": "size_name",
};

export type AmazonAuthoritativeValidationOutcome = {
  authoritative: boolean;
  source: "LIVE_API" | "LOCAL_RULES";
  missingFields: string[];
  issues: ConnectorIssue[];
  warningMessages: string[];
};

type ValidationEndpointPayload = {
  missingFields?: unknown;
  issues?: Array<{
    severity?: unknown;
    code?: unknown;
    fieldPath?: unknown;
    message?: unknown;
  }>;
  warnings?: unknown;
};

export function buildAmazonMappedPayload(product: ProductPayload): Record<string, unknown> {
  const mappedPayload: Record<string, unknown> = {};
  for (const [sourceField, targetField] of Object.entries(AMAZON_DEFAULT_FIELD_MAP)) {
    const value = getProductFieldValue(sourceField, product);
    if (!isEmpty(value)) {
      mappedPayload[targetField] = value;
    }
  }
  return mappedPayload;
}

export function collectAmazonMissingFields(
  product: ProductPayload,
  requiredFields: readonly string[] = AMAZON_DEFAULT_REQUIRED_FIELDS,
): string[] {
  return requiredFields.filter((fieldPath) => isEmpty(getProductFieldValue(fieldPath, product)));
}

export function buildAmazonFallbackIssues(displayName: string, missingFields: readonly string[]): ConnectorIssue[] {
  return missingFields.map((fieldPath) => ({
    severity: "error",
    code: "CHANNEL_REQUIRED_FIELD",
    fieldPath,
    sellerMessage: `${fieldPath} is required for ${displayName}.`,
  }));
}

/**
 * Content-level validation rules that go beyond "field is missing."
 * Catches title length, image HTTPS format, bullet point count, variation
 * consistency, and India-specific compliance fields.
 * Returns both errors and warnings — caller must split on severity.
 */
export function runAmazonLocalValidation(
  product: ProductPayload,
  displayName: string,
  options: { isIndia?: boolean } = {},
): ConnectorIssue[] {
  const issues: ConnectorIssue[] = [];

  // ── Title ─────────────────────────────────────────────────────────────────
  const title = typeof product.title === "string" ? product.title.trim() : "";
  if (title.length === 0) {
    issues.push({
      code: "CHANNEL_REQUIRED_FIELD",
      fieldPath: "title",
      sellerMessage: `Product title is required for ${displayName}.`,
      severity: "error",
    });
  } else if (title.length > AMAZON_TITLE_MAX_LENGTH) {
    issues.push({
      code: "TITLE_TOO_LONG",
      fieldPath: "title",
      sellerMessage: `Title is ${title.length} characters. Amazon allows a maximum of ${AMAZON_TITLE_MAX_LENGTH} characters.`,
      severity: "error",
    });
  }

  // ── Brand ─────────────────────────────────────────────────────────────────
  if (isEmpty(product.brand)) {
    issues.push({
      code: "CHANNEL_REQUIRED_FIELD",
      fieldPath: "brand",
      sellerMessage: `Brand is required for ${displayName}.`,
      severity: "error",
    });
  }

  // ── Description ───────────────────────────────────────────────────────────
  if (isEmpty(product.description)) {
    issues.push({
      code: "CHANNEL_REQUIRED_FIELD",
      fieldPath: "description",
      sellerMessage: `Product description is required for ${displayName}.`,
      severity: "error",
    });
  }

  // ── Main image ────────────────────────────────────────────────────────────
  const mainImageUrl = typeof product.mainImageUrl === "string" ? product.mainImageUrl.trim() : "";
  if (mainImageUrl.length === 0) {
    issues.push({
      code: "CHANNEL_REQUIRED_FIELD",
      fieldPath: "mainImageUrl",
      sellerMessage: `A main product image is required for ${displayName}.`,
      severity: "error",
    });
  } else if (!/^https:\/\//i.test(mainImageUrl)) {
    issues.push({
      code: "IMAGE_URL_NOT_HTTPS",
      fieldPath: "mainImageUrl",
      sellerMessage: "Amazon requires the main product image to use a permanent HTTPS URL.",
      severity: "error",
    });
  }

  // ── Additional images ─────────────────────────────────────────────────────
  if (Array.isArray(product.additionalImageUrls)) {
    if (product.additionalImageUrls.length > AMAZON_ADDITIONAL_IMAGES_MAX) {
      issues.push({
        code: "TOO_MANY_IMAGES",
        fieldPath: "additionalImageUrls",
        sellerMessage: `Amazon accepts up to ${AMAZON_ADDITIONAL_IMAGES_MAX} additional images. Remove ${product.additionalImageUrls.length - AMAZON_ADDITIONAL_IMAGES_MAX} image(s).`,
        severity: "error",
      });
    }
    product.additionalImageUrls.forEach((url, index) => {
      const trimmed = typeof url === "string" ? url.trim() : "";
      if (trimmed.length > 0 && !/^https:\/\//i.test(trimmed)) {
        issues.push({
          code: "IMAGE_URL_NOT_HTTPS",
          fieldPath: `additionalImageUrls[${index}]`,
          sellerMessage: `Additional image ${index + 1} must use a permanent HTTPS URL.`,
          severity: "error",
        });
      }
    });
  }

  // ── Bullet points ─────────────────────────────────────────────────────────
  const bullets = Array.isArray(product.bulletPoints)
    ? product.bulletPoints.map((b) => (typeof b === "string" ? b.trim() : "")).filter((b) => b.length > 0)
    : [];
  if (bullets.length === 0) {
    issues.push({
      code: "BULLET_POINTS_MISSING",
      fieldPath: "bulletPoints",
      sellerMessage: "Add at least one bullet point. Amazon recommends 3–5 bullet points per listing.",
      severity: "warning",
    });
  } else if (bullets.length > AMAZON_BULLET_POINTS_MAX) {
    issues.push({
      code: "TOO_MANY_BULLET_POINTS",
      fieldPath: "bulletPoints",
      sellerMessage: `Amazon allows up to ${AMAZON_BULLET_POINTS_MAX} bullet points. Remove ${bullets.length - AMAZON_BULLET_POINTS_MAX} bullet point(s).`,
      severity: "error",
    });
  }

  // ── HSN / GST (required for India) ────────────────────────────────────────
  if (options.isIndia !== false) {
    if (isEmpty(product.hsnCode)) {
      issues.push({
        code: "CHANNEL_REQUIRED_FIELD",
        fieldPath: "hsnCode",
        sellerMessage: "HSN code is required for Amazon India listings.",
        severity: "error",
      });
    }
    if (isEmpty(product.gstRate) && product.gstRate !== 0) {
      issues.push({
        code: "CHANNEL_REQUIRED_FIELD",
        fieldPath: "gstRate",
        sellerMessage: "GST rate is required for Amazon India listings.",
        severity: "error",
      });
    }
  }

  // ── Country of origin ─────────────────────────────────────────────────────
  if (isEmpty(product.countryOfOrigin)) {
    issues.push({
      code: "CHANNEL_REQUIRED_FIELD",
      fieldPath: "countryOfOrigin",
      sellerMessage: "Country of origin is required for Amazon listings. Add it to the product attributes.",
      severity: "error",
    });
  }

  // ── Condition ─────────────────────────────────────────────────────────────
  const validConditions = new Set(["new", "used", "refurbished"]);
  if (product.condition !== undefined && !validConditions.has(product.condition)) {
    issues.push({
      code: "INVALID_CONDITION",
      fieldPath: "condition",
      sellerMessage: `Condition must be one of: new, used, refurbished. Got "${product.condition}".`,
      severity: "error",
    });
  }

  // ── Variation consistency ─────────────────────────────────────────────────
  const hasParentSku = typeof product.parentSku === "string" && product.parentSku.trim().length > 0;
  const hasVariationTheme = typeof product.variationTheme === "string" && product.variationTheme.trim().length > 0;

  if (hasVariationTheme && !hasParentSku) {
    issues.push({
      code: "VARIATION_MISSING_PARENT_SKU",
      fieldPath: "parentSku",
      sellerMessage: "A parentSku is required when variationTheme is set. This product will be listed as a variation child.",
      severity: "error",
    });
  }
  if (hasParentSku && !hasVariationTheme) {
    issues.push({
      code: "VARIATION_MISSING_THEME",
      fieldPath: "variationTheme",
      sellerMessage: "A variationTheme (e.g. SIZE, COLOR) is required when parentSku is set.",
      severity: "error",
    });
  }

  // ── SKU ───────────────────────────────────────────────────────────────────
  const sku = typeof product.sku === "string" ? product.sku.trim() : "";
  if (sku.length === 0) {
    issues.push({
      code: "CHANNEL_REQUIRED_FIELD",
      fieldPath: "sku",
      sellerMessage: "A seller SKU is required before publishing to Amazon.",
      severity: "error",
    });
  }

  // ── Price ─────────────────────────────────────────────────────────────────
  if (!isPositiveNumber(product.mrp)) {
    issues.push({
      code: "CHANNEL_REQUIRED_FIELD",
      fieldPath: "mrp",
      sellerMessage: "MRP (list price) is required and must be greater than zero.",
      severity: "error",
    });
  }
  if (!isPositiveNumber(product.sellingPrice)) {
    issues.push({
      code: "CHANNEL_REQUIRED_FIELD",
      fieldPath: "sellingPrice",
      sellerMessage: "Selling price is required and must be greater than zero.",
      severity: "error",
    });
  }
  if (isPositiveNumber(product.sellingPrice) && isPositiveNumber(product.mrp) && product.sellingPrice > product.mrp) {
    issues.push({
      code: "SELLING_PRICE_GT_MRP",
      fieldPath: "sellingPrice",
      sellerMessage: "Selling price is higher than MRP. Review Amazon pricing before publishing.",
      severity: "warning",
    });
  }

  // ── Category attributes ───────────────────────────────────────────────────
  const color = String(product.attributes?.color ?? "").trim();
  const material = String(product.attributes?.material ?? "").trim();
  if (!color) {
    issues.push({
      code: "CHANNEL_REQUIRED_FIELD",
      fieldPath: "attributes.color",
      sellerMessage: `Color is required for ${displayName}. Add it to the product's attributes.`,
      severity: "error",
    });
  }
  if (!material) {
    issues.push({
      code: "CHANNEL_REQUIRED_FIELD",
      fieldPath: "attributes.material",
      sellerMessage: `Material type is required for ${displayName}. Add it to the product's attributes.`,
      severity: "error",
    });
  }

  return issues;
}

export async function runAmazonAuthoritativeValidation(input: {
  productId?: string;
  displayName: string;
  requiredFields: readonly string[];
  mappedPayload: Record<string, unknown>;
  fallbackMissingFields: string[];
  fallbackIssues: ConnectorIssue[];
}): Promise<AmazonAuthoritativeValidationOutcome | null> {
  const featureEnabled = String(process.env.FEATURE_REAL_SPAPI_VALIDATION ?? "false")
    .trim()
    .toLowerCase() === "true";
  if (!featureEnabled) {
    return null;
  }

  const endpoint = String(process.env.PIM_AMAZON_VALIDATION_ENDPOINT ?? "").trim();
  if (!endpoint) {
    return {
      authoritative: false,
      source: "LOCAL_RULES",
      missingFields: input.fallbackMissingFields,
      issues: input.fallbackIssues,
      warningMessages: [
        "Amazon authoritative validation is enabled, but PIM_AMAZON_VALIDATION_ENDPOINT is not configured. Falling back to local rules.",
      ],
    };
  }

  const token = String(process.env.PIM_AMAZON_VALIDATION_TOKEN ?? "").trim();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(CONNECTOR_HTTP_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        productId: input.productId,
        requirements: "LISTING",
        requiredFields: input.requiredFields,
        mappedPayload: input.mappedPayload,
      }),
    });
    if (!response.ok) {
      return {
        authoritative: false,
        source: "LOCAL_RULES",
        missingFields: input.fallbackMissingFields,
        issues: input.fallbackIssues,
        warningMessages: [`Amazon validation endpoint returned ${response.status}. Falling back to local rules.`],
      };
    }

    const payload = (await response.json()) as ValidationEndpointPayload;
    const missingFields = normalizeFieldList(payload.missingFields);
    const issues = normalizeIssues(payload.issues);
    const warningMessages = normalizeWarningMessages(payload.warnings);
    const resolvedMissingFields =
      missingFields.length > 0
        ? missingFields
        : issues
            .filter((issue) => issue.code.includes("REQUIRED") || issue.sellerMessage.toLowerCase().includes("required"))
            .map((issue) => issue.fieldPath)
            .filter((fieldPath) => fieldPath.length > 0);

    return {
      authoritative: true,
      source: "LIVE_API",
      missingFields: uniqueStrings(resolvedMissingFields),
      issues:
        issues.length > 0 ? issues : buildAmazonFallbackIssues(input.displayName, uniqueStrings(resolvedMissingFields)),
      warningMessages,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown validation error";
    return {
      authoritative: false,
      source: "LOCAL_RULES",
      missingFields: input.fallbackMissingFields,
      issues: input.fallbackIssues,
      warningMessages: [`Amazon validation endpoint unavailable (${errorMessage}). Falling back to local rules.`],
    };
  }
}

function normalizeIssues(payloadIssues: ValidationEndpointPayload["issues"]): ConnectorIssue[] {
  const issues = Array.isArray(payloadIssues) ? payloadIssues : [];
  return issues
    .map((issue) => {
      const fieldPath = typeof issue.fieldPath === "string" ? issue.fieldPath.trim() : "";
      if (!fieldPath) {
        return null;
      }
      const sellerMessage =
        typeof issue.message === "string" && issue.message.trim().length > 0
          ? issue.message.trim()
          : `${fieldPath} failed Amazon validation.`;
      return {
        severity: issue.severity === "warning" ? "warning" : "error",
        code:
          typeof issue.code === "string" && issue.code.trim().length > 0
            ? issue.code.trim()
            : "AMAZON_VALIDATION_ISSUE",
        fieldPath,
        sellerMessage,
      } satisfies ConnectorIssue;
    })
    .filter((value): value is ConnectorIssue => value !== null);
}

function normalizeWarningMessages(payloadWarnings: ValidationEndpointPayload["warnings"]): string[] {
  return Array.isArray(payloadWarnings)
    ? payloadWarnings
        .filter((warning): warning is string => typeof warning === "string")
        .map((warning) => warning.trim())
        .filter((warning) => warning.length > 0)
    : [];
}

function normalizeFieldList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    : [];
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(
    new Set(values.map((value) => String(value ?? "").trim()).filter((value) => value.length > 0)),
  );
}

export function getProductFieldValue(fieldPath: string, product: ProductPayload): unknown {
  switch (fieldPath) {
    case "sku":
      return product.sku;
    case "title":
      return product.title;
    case "brand":
      return product.brand;
    case "description":
      return product.description;
    case "mainImageUrl":
      return product.mainImageUrl;
    case "hsnCode":
      return product.hsnCode;
    case "gstRate":
      return product.gstRate;
    case "mrp":
      return product.mrp;
    case "sellingPrice":
      return product.sellingPrice;
    case "countryOfOrigin":
      return product.countryOfOrigin;
    case "condition":
      return product.condition;
    case "asin":
      return product.asin;
    case "parentSku":
      return product.parentSku;
    case "variationTheme":
      return product.variationTheme;
    case "bulletPoints":
      return product.bulletPoints;
    case "additionalImageUrls":
      return product.additionalImageUrls;
    default:
      if (fieldPath.startsWith("attributes.")) {
        return product.attributes?.[fieldPath.slice("attributes.".length)];
      }
      return undefined;
  }
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
}

function isPositiveNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
