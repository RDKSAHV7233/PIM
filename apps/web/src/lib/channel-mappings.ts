import type {
  AttributeDefinition,
  ConnectorMappingPreflight,
  ConnectorMappingResolved,
  ConnectorPublishReadiness,
  ConnectorTaxonomyItem,
  MarketplaceChannel,
  MarketplaceChannelMapping,
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
): Array<{ value: string; label: string }> {
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
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

interface BuildMappingsViewModelArgs {
  mapping: MarketplaceChannelMapping;
  resolved: ConnectorMappingResolved | null;
  taxonomyMatches: ConnectorTaxonomyItem[];
  unmappedCategories: ConnectorTaxonomyOption[];
  categoryAttributes: AttributeDefinition[];
  selectedCategoryId: string;
  selectedChannel: MarketplaceChannel;
  selectedProductId: string;
  taxonomyQ: string;
}

export function buildMappingsViewModel({
  mapping,
  resolved,
  taxonomyMatches,
  unmappedCategories,
  categoryAttributes,
  selectedCategoryId,
  selectedChannel,
  selectedProductId,
  taxonomyQ,
}: BuildMappingsViewModelArgs) {
  const redirectTo = `/channels/mappings?categoryId=${encodeURIComponent(selectedCategoryId)}&channel=${encodeURIComponent(selectedChannel)}${taxonomyQ ? `&taxonomyQ=${encodeURIComponent(taxonomyQ)}` : ""}${selectedProductId ? `&productId=${encodeURIComponent(selectedProductId)}` : ""}`;
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
