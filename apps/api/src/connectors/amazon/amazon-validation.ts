import { ConnectorIssue, ProductPayload } from "../../connector-framework/connector.interface";

export const AMAZON_DEFAULT_REQUIRED_FIELDS = [
  "title",
  "brand",
  "description",
  "hsnCode",
  "gstRate",
  "attributes.color",
  "attributes.material",
] as const;

export const AMAZON_DEFAULT_FIELD_MAP: Record<string, string> = {
  title: "item_name",
  brand: "brand_name",
  description: "product_description",
  hsnCode: "hsn_code",
  gstRate: "tax_rate",
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

function getProductFieldValue(fieldPath: string, product: ProductPayload): unknown {
  switch (fieldPath) {
    case "title":
      return product.title;
    case "brand":
      return product.brand;
    case "description":
      return product.description;
    case "hsnCode":
      return product.hsnCode;
    case "gstRate":
      return product.gstRate;
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
