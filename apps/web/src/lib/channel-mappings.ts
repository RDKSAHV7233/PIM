import type {
  AttributeDefinition,
  ConnectorMappingPreflight,
  ConnectorMappingResolved,
  ConnectorPublishReadiness,
  ConnectorTaxonomyItem,
  MarketplaceChannel,
  MarketplaceChannelMapping,
  Product,
} from "@/lib/api";
import {
  DEFAULT_MARKETPLACE_CHANNEL,
  mapMarketplaceChannelToConnectorSlug,
  normalizeMarketplaceChannel,
} from "@/lib/marketplace-channels";

export type ProtectedMappingActionKind = "publish" | "archive" | "rollback";
export type ConnectorTaxonomyOption = Pick<ConnectorTaxonomyItem, "id" | "path" | "requiredAttributes">;

export function normalizeChannel(
  value: string | undefined,
  channels: Array<{ channel: MarketplaceChannel }>,
): MarketplaceChannel {
  return normalizeMarketplaceChannel(
    value,
    channels.map((entry) => entry.channel),
    channels[0]?.channel ?? DEFAULT_MARKETPLACE_CHANNEL,
  );
}

export function mapChannelToConnectorSlug(channel: MarketplaceChannel): string {
  return mapMarketplaceChannelToConnectorSlug(channel);
}

export function definitionForConnector(
  definitions: Array<{ id: string; slug: string; connectorVersion: string }>,
  connectorSlug: string,
) {
  return definitions.find((entry) => entry.slug === connectorSlug) ?? null;
}

export function presentMappingLevel(level: string): string {
  if (level === "tenant_connector_default") {
    return "Default mapping";
  }
  if (level === "tenant_connector_category_mapping") {
    return "Category mapping";
  }
  return level;
}

export function presentCompatibilityState(state: string | null | undefined): string {
  switch (state) {
    case "compatible":
      return "Compatible";
    case "deprecated":
      return "Needs review";
    case "remap_required":
      return "Needs remap";
    case "blocked":
      return "Blocked";
    default:
      return state ?? "n/a";
  }
}

export function presentLifecycleState(state: string): string {
  switch (state) {
    case "draft":
      return "Draft";
    case "validated":
      return "Ready to publish";
    case "published":
      return "Live";
    case "superseded":
      return "Replaced";
    case "archived":
      return "Archived";
    default:
      return state;
  }
}

function protectedActionLabel(action: ProtectedMappingActionKind): string {
  if (action === "archive") {
    return "archive";
  }
  if (action === "rollback") {
    return "rollback";
  }
  return "publish";
}

export function resolveStepUpErrorMessage(
  code: string,
  action: ProtectedMappingActionKind | "",
): { title: string; description: string } | null {
  if (!code) {
    return null;
  }
  const actionLabel = action ? protectedActionLabel(action) : "continue";
  switch (code) {
    case "STEP_UP_PASSWORD_REQUIRED":
      return {
        title: "Step-up re-authentication required",
        description: `Enter your password to ${actionLabel} this mapping version.`,
      };
    case "STEP_UP_INVALID_CREDENTIALS":
      return {
        title: "Step-up re-authentication failed",
        description: `The password was not accepted. Re-enter your password to ${actionLabel} this mapping version.`,
      };
    case "STEP_UP_REQUIRED":
      return {
        title: "Step-up re-authentication required",
        description: `Confirm your password before you ${actionLabel} this mapping version.`,
      };
    case "STEP_UP_TOKEN_INVALID":
      return {
        title: "Step-up session expired",
        description: `Your elevated session expired before ${actionLabel} completed. Re-authenticate and try again.`,
      };
    case "STEP_UP_TOKEN_SESSION_MISMATCH":
      return {
        title: "Step-up session mismatch",
        description: `Your step-up re-authentication no longer matches the current session. Refresh the page and try ${actionLabel} again.`,
      };
    case "STEP_UP_SCOPE_MISMATCH":
      return {
        title: "Step-up scope mismatch",
        description: `The existing step-up token does not authorize this ${actionLabel} action. Re-authenticate and retry.`,
      };
    default:
      return {
        title: "Step-up re-authentication failed",
        description: `The privileged ${actionLabel} action could not be completed. Try again.`,
      };
  }
}

function requiredAttributesFromTaxonomy(items: ConnectorTaxonomyItem[]): string[] {
  const values = new Set<string>();
  for (const item of items) {
    for (const attr of item.requiredAttributes) {
      const normalized = String(attr ?? "").trim();
      if (normalized) {
        values.add(normalized);
      }
    }
  }
  return Array.from(values).sort();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function extractResolvedCategoryTarget(resolvedMapping: Record<string, unknown> | null): string {
  const category = resolvedMapping?.category;
  if (!category || typeof category !== "object" || Array.isArray(category)) {
    return "";
  }
  const target = (category as Record<string, unknown>).target;
  return typeof target === "string" ? target.trim() : "";
}

function invertFieldMap(fieldMap: Record<string, string>): Record<string, string> {
  const inverted: Record<string, string> = {};
  for (const [sourceField, targetField] of Object.entries(fieldMap)) {
    const source = String(sourceField ?? "").trim();
    const target = String(targetField ?? "").trim();
    if (source && target) {
      inverted[target] = source;
    }
  }
  return inverted;
}

function buildSourceFieldOptions(
  attributeDefinitions: AttributeDefinition[],
  currentFieldMap: Record<string, string>,
  sampleProduct: Product | null,
): Array<{ value: string; label: string; preview: string | null }> {
  const options = new Map<string, string>();
  const commonFields: Array<[string, string]> = [
    ["title", "Title"],
    ["brand", "Brand"],
    ["description", "Description"],
    ["hsnCode", "HSN code"],
    ["gstRate", "GST rate"],
    ["status", "Status"],
    ["mrp", "MRP"],
    ["sellingPrice", "Selling price"],
  ];
  for (const [value, label] of commonFields) {
    options.set(value, label);
  }
  for (const definition of attributeDefinitions) {
    const appliesLabel = definition.required ? "Required attribute" : "Attribute";
    options.set(`attributes.${definition.key}`, `${definition.name} (${appliesLabel})`);
  }
  for (const sourceField of Object.keys(currentFieldMap)) {
    if (!options.has(sourceField)) {
      options.set(sourceField, sourceField);
    }
  }
  return Array.from(options.entries())
    .map(([value, label]) => ({
      value,
      label,
      preview: previewSourceFieldValue(sampleProduct, value),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function readNestedRecord(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function compactPreviewValue(value: string, max = 72): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, max - 3))}...`;
}

function formatPreviewValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? compactPreviewValue(trimmed) : "Blank string";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "Empty list";
    }
    const formatted = value
      .slice(0, 3)
      .map((entry) => formatPreviewValue(entry) ?? "Empty")
      .join(", ");
    return value.length > 3 ? `${formatted} (+${value.length - 3} more)` : formatted;
  }
  if (typeof value === "object") {
    return compactPreviewValue(JSON.stringify(value));
  }
  return compactPreviewValue(String(value));
}

function previewSourceFieldValue(sampleProduct: Product | null, sourceField: string): string | null {
  if (!sampleProduct) {
    return null;
  }

  const latestVariant = sampleProduct.variants?.[0] ?? null;
  const normalizedField = String(sourceField ?? "").trim();
  if (!normalizedField) {
    return null;
  }

  if (normalizedField === "mrp") {
    return formatPreviewValue(latestVariant?.mrp ?? null);
  }
  if (normalizedField === "sellingPrice") {
    return formatPreviewValue(latestVariant?.sellingPrice ?? null);
  }
  if (normalizedField === "inventoryQty") {
    return formatPreviewValue(latestVariant?.inventoryQty ?? null);
  }
  if (normalizedField === "sku" || normalizedField === "skuCode" || normalizedField === "attributes.sku") {
    return formatPreviewValue(latestVariant?.skuCode ?? readNestedRecord(sampleProduct.attributes, ["sku"]));
  }

  if (normalizedField.startsWith("attributes.")) {
    const attributePath = normalizedField.slice("attributes.".length).split(".");
    return (
      formatPreviewValue(readNestedRecord(sampleProduct.attributes, attributePath)) ??
      formatPreviewValue(readNestedRecord(latestVariant?.attributes ?? null, attributePath))
    );
  }

  return (
    formatPreviewValue(readNestedRecord(sampleProduct, normalizedField.split("."))) ??
    formatPreviewValue(readNestedRecord(sampleProduct.attributes, normalizedField.split("."))) ??
    formatPreviewValue(readNestedRecord(latestVariant?.attributes ?? null, normalizedField.split(".")))
  );
}

interface BuildMappingsViewModelArgs {
  mapping: MarketplaceChannelMapping;
  resolved: ConnectorMappingResolved | null;
  taxonomyMatches: ConnectorTaxonomyItem[];
  unmappedCategories: ConnectorTaxonomyOption[];
  categoryAttributes: AttributeDefinition[];
  sampleProduct: Product | null;
  selectedCategoryId: string;
  selectedChannel: MarketplaceChannel;
  selectedProductId: string;
  selectedInstallationId?: string;
  fallbackAcknowledged?: boolean;
  fallbackAckVersionId?: string;
  taxonomyQ: string;
}

export function buildMappingsViewModel({
  mapping,
  resolved,
  taxonomyMatches,
  unmappedCategories,
  categoryAttributes,
  sampleProduct,
  selectedCategoryId,
  selectedChannel,
  selectedProductId,
  selectedInstallationId,
  fallbackAcknowledged,
  fallbackAckVersionId,
  taxonomyQ,
}: BuildMappingsViewModelArgs) {
  const redirectTo = `/channels/mappings?categoryId=${encodeURIComponent(selectedCategoryId)}&channel=${encodeURIComponent(selectedChannel)}${selectedInstallationId ? `&installationId=${encodeURIComponent(selectedInstallationId)}` : ""}${taxonomyQ ? `&taxonomyQ=${encodeURIComponent(taxonomyQ)}` : ""}${selectedProductId ? `&productId=${encodeURIComponent(selectedProductId)}` : ""}${fallbackAcknowledged ? "&fallbackAcknowledged=true" : ""}${fallbackAckVersionId ? `&fallbackAckVersionId=${encodeURIComponent(fallbackAckVersionId)}` : ""}`;
  const taxonomyDefaults = requiredAttributesFromTaxonomy(taxonomyMatches);
  const resolvedCategoryTarget = extractResolvedCategoryTarget(resolved?.resolvedMapping ?? null);
  const targetCategoryOptions = uniqueStrings([
    resolvedCategoryTarget,
    ...taxonomyMatches.map((item) => item.id),
    ...unmappedCategories.map((item) => item.id),
  ]);
  const selectedTargetCategory = resolvedCategoryTarget || targetCategoryOptions[0] || "";
  const requiredTargetFields = uniqueStrings([...mapping.requiredFields, ...taxonomyDefaults]);
  const currentFieldMap = Object.fromEntries(
    Object.entries(mapping.fieldMap).map(([sourceField, targetField]) => [String(sourceField), String(targetField)]),
  );
  const mappedTargetToSource = invertFieldMap(currentFieldMap);
  const targetFieldOptions = uniqueStrings([...requiredTargetFields, ...Object.values(currentFieldMap)]);
  const sourceFieldOptions = buildSourceFieldOptions(
    categoryAttributes.filter((definition) => definition.appliesTo === "product"),
    currentFieldMap,
    sampleProduct,
  );
  const mappingDraftRulesDefault = JSON.stringify(
    {
      field_mappings: currentFieldMap,
      required_fields: requiredTargetFields,
      category: {
        source: selectedCategoryId,
        target: selectedTargetCategory,
      },
      taxonomy_required_attributes: taxonomyDefaults,
    },
    null,
    2,
  );
  const fallbackPolicyDefault = JSON.stringify(
    {
      enabled: true,
      warning_tag: "fallback_category_mapping",
      ack_message: "Fallback category will be used for publish if no explicit mapping exists.",
      default_category: selectedTargetCategory,
    },
    null,
    2,
  );
  const resolvedMappingJson = resolved ? JSON.stringify(resolved.resolvedMapping, null, 2) : "{}";

  return {
    redirectTo,
    taxonomyDefaults,
    targetCategoryOptions,
    selectedTargetCategory,
    requiredTargetFields,
    mappedTargetToSource,
    targetFieldOptions,
    sourceFieldOptions,
    mappingDraftRulesDefault,
    fallbackPolicyDefault,
    resolvedMappingJson,
  };
}

export function statusToneForPreflight(
  state: ConnectorMappingPreflight | ConnectorPublishReadiness | null,
): "success" | "danger" {
  return state?.ok ? "success" : "danger";
}

export function describeReadinessCode(code: string): string {
  if (code === "fallback_ack_required") return "Fallback acknowledgement is required before readiness can clear.";
  if (code === "fallback_mapping_applied") return "A tenant fallback mapping is being applied for this category scope.";
  if (code === "using_system_default_mapping") return "This scope is falling back to the system default mapping pack.";
  if (code === "required_attribute_mapping_missing") return "One or more required attribute mappings are still missing.";
  if (code === "field_mappings_missing") return "No field mappings are defined for this scope yet.";
  if (code === "connector_not_installed") return "Connector not installed for this channel.";
  if (code === "connector_credentials_expired") return "Connector credentials have expired.";
  if (code === "mapping_compatibility_blocked") return "Mapping compatibility is blocked.";
  if (code === "mapping_remap_required") return "Mapping remap is required.";
  return code.replace(/_/g, " ");
}
