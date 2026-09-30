import type {
  AttributeDefinition,
  ConnectorMappingPreflight,
  ConnectorMappingResolved,
  ConnectorPublishReadiness,
  ConnectorTaxonomyItem,
  MarketplaceChannel,
  MarketplaceChannelMapping,
  Product,
  ShopifyMetafieldDefinition,
} from "@/lib/api";
import {
  DEFAULT_MARKETPLACE_CHANNEL,
  mapMarketplaceChannelToConnectorSlug,
  normalizeMarketplaceChannel,
} from "@/lib/marketplace-channels";
import { labelUndefinedSourceField } from "@/lib/mapping-source-field-label";
import { requiredCoverageBySource } from "@/lib/mapping-required-coverage";
import { clampTaxonomyQuery } from "@/lib/mapping-taxonomy-query";

export type ProtectedMappingActionKind = "publish" | "archive" | "rollback";
export type ConnectorTaxonomyOption = Pick<ConnectorTaxonomyItem, "id" | "path" | "requiredAttributes">;
export type MappingWizardStep = "scope" | "map" | "review";
export type MappingAdvancedPanel = "fallback" | "compatibility" | "resolved" | "json" | "diagnostics";

export interface MappingWizardQueryState {
  categoryId?: string;
  channel?: string;
  installationId?: string;
  productId?: string;
  publishCategoryId?: string;
  fallbackAcknowledged?: string;
  fallbackAckVersionId?: string;
  fallbackAckError?: string;
  stepUpAction?: string;
  stepUpError?: string;
  stepUpVersionId?: string;
  taxonomyQ?: string;
  showContext?: string;
  showTaxonomy?: string;
  showResolved?: string;
  showHistory?: string;
  showAdvanced?: string;
  advancedPanel?: string;
  allVersions?: string;
  step?: string;
}

export interface MappingWizardState {
  step: MappingWizardStep;
  categoryId: string;
  channel: string;
  installationId: string;
  productId: string;
  publishCategoryId: string;
  fallbackAcknowledged: boolean;
  fallbackAckVersionId: string;
  fallbackAckError: string;
  stepUpAction: string;
  stepUpError: string;
  stepUpVersionId: string;
  taxonomyQ: string;
  showAdvanced: boolean;
  advancedPanel: MappingAdvancedPanel | "";
  showAllVersions: boolean;
}

function normalizedWizardStep(value: string): MappingWizardStep | "" {
  if (value === "scope" || value === "map" || value === "review") {
    return value;
  }
  return "";
}

function normalizedAdvancedPanel(value: string): MappingAdvancedPanel | "" {
  if (
    value === "fallback" ||
    value === "compatibility" ||
    value === "resolved" ||
    value === "json" ||
    value === "diagnostics"
  ) {
    return value;
  }
  return "";
}

export function parseMappingWizardState(query: MappingWizardQueryState): MappingWizardState {
  const legacyShowContext = String(query.showContext ?? "").trim() === "1";
  const legacyShowTaxonomy = String(query.showTaxonomy ?? "").trim() === "1" || String(query.taxonomyQ ?? "").trim().length > 0;
  const legacyShowResolved = String(query.showResolved ?? "").trim() === "1";
  const legacyShowHistory = String(query.showHistory ?? "").trim() === "1";
  const stepUpAction = String(query.stepUpAction ?? "").trim();
  const stepUpVersionId = String(query.stepUpVersionId ?? "").trim();
  const requestedStep = normalizedWizardStep(String(query.step ?? "").trim());
  const inferredStep =
    requestedStep ||
    (legacyShowHistory || stepUpAction || stepUpVersionId
      ? "review"
      : legacyShowTaxonomy || legacyShowContext
        ? "scope"
        : legacyShowResolved
          ? "review"
          : "scope");
  const requestedAdvanced = String(query.showAdvanced ?? "").trim() === "true" || legacyShowResolved;
  const advancedPanel = normalizedAdvancedPanel(String(query.advancedPanel ?? "").trim()) || (legacyShowResolved ? "resolved" : "");

  return {
    step: inferredStep,
    categoryId: String(query.categoryId ?? "").trim(),
    channel: String(query.channel ?? "").trim(),
    installationId: String(query.installationId ?? "").trim(),
    productId: String(query.productId ?? "").trim(),
    publishCategoryId: String(query.publishCategoryId ?? "").trim(),
    fallbackAcknowledged: String(query.fallbackAcknowledged ?? "").trim() === "true",
    fallbackAckVersionId: String(query.fallbackAckVersionId ?? "").trim(),
    fallbackAckError: String(query.fallbackAckError ?? "").trim(),
    stepUpAction,
    stepUpError: String(query.stepUpError ?? "").trim(),
    stepUpVersionId,
    taxonomyQ: clampTaxonomyQuery(query.taxonomyQ),
    showAdvanced: requestedAdvanced,
    advancedPanel,
    showAllVersions: String(query.allVersions ?? "").trim() === "1",
  };
}

export function resolveRequestedWizardStep(
  requestedStep: MappingWizardStep,
  options: {
    hasBaseScope: boolean;
    hasPublishCategory: boolean;
    hasDraftContext: boolean;
  },
): MappingWizardStep {
  if (!options.hasBaseScope || !options.hasPublishCategory) {
    return "scope";
  }
  if (requestedStep === "review" && !options.hasDraftContext) {
    return "map";
  }
  return requestedStep;
}

export function buildMappingRoute(state: Partial<MappingWizardState> & { step?: MappingWizardStep | "" }): string {
  const params = new URLSearchParams();
  const entries: Array<[string, string | undefined | null | boolean]> = [
    ["step", state.step ?? ""],
    ["channel", state.channel],
    ["categoryId", state.categoryId],
    ["installationId", state.installationId],
    ["productId", state.productId],
    ["publishCategoryId", state.publishCategoryId],
    ["taxonomyQ", state.taxonomyQ],
    ["fallbackAcknowledged", state.fallbackAcknowledged ? "true" : ""],
    ["fallbackAckVersionId", state.fallbackAckVersionId],
    ["fallbackAckError", state.fallbackAckError],
    ["showAdvanced", state.showAdvanced ? "true" : ""],
    ["advancedPanel", state.advancedPanel],
    ["allVersions", state.showAllVersions ? "1" : ""],
    ["stepUpAction", state.stepUpAction],
    ["stepUpError", state.stepUpError],
    ["stepUpVersionId", state.stepUpVersionId],
  ];

  for (const [key, rawValue] of entries) {
    const value = String(rawValue ?? "").trim();
    if (value) {
      params.set(key, value);
    }
  }

  const query = params.toString();
  return query ? `/channels/mappings?${query}` : "/channels/mappings";
}

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
    return "Default mapping for all categories";
  }
  if (level === "tenant_connector_category_mapping") {
    return "Category-specific override";
  }
  return level;
}

export function describeMappingSource(resolved: ConnectorMappingResolved | null): {
  label: string;
  description: string;
  tone: "neutral" | "info" | "success" | "warning";
} {
  if (!resolved) {
    return { label: "No mapping configured", description: "Configure a default or category-specific mapping to publish.", tone: "warning" };
  }
  const matched = resolved.matchedVersions ?? [];
  if (matched.length === 0) {
    return { label: "Using system default", description: "No tenant mapping exists. The system default field map is active.", tone: "neutral" };
  }
  const hasCategoryMapping = matched.some((v) => v.mappingLevel === "tenant_connector_category_mapping");
  const hasInstallationScope = matched.some((v) => v.installationId);
  if (hasCategoryMapping && hasInstallationScope) {
    return { label: "Using account-specific category override", description: "This category has a mapping override specific to this connector account.", tone: "success" };
  }
  if (hasCategoryMapping) {
    return { label: "Using category override", description: "This category has its own mapping that takes precedence over the default.", tone: "success" };
  }
  if (hasInstallationScope) {
    return { label: "Using account-specific default", description: "This connector account has its own default mapping for all categories.", tone: "info" };
  }
  return { label: "Using default mapping for all categories", description: "This category inherits the tenant default mapping. Create a category override to customize it.", tone: "info" };
}

export function isDefaultMappingLevel(level: string): boolean {
  return level === "tenant_connector_default";
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

type FieldMapValue = string | string[];

function normalizeTargetList(value: FieldMapValue | unknown): string[] {
  const raw = Array.isArray(value) ? value : [value];
  return uniqueStrings(raw.map((item) => String(item ?? "")));
}

function shopifyMetafieldTarget(definition: ShopifyMetafieldDefinition): string {
  const namespace = String(definition.namespace ?? "").trim();
  const key = String(definition.key ?? "").trim();
  return namespace && key ? `productMetafields.${namespace}.${key}` : "";
}

function invertFieldMap(fieldMap: Record<string, FieldMapValue>): Record<string, string> {
  const inverted: Record<string, string> = {};
  for (const [sourceField, rawTargetField] of Object.entries(fieldMap)) {
    const source = String(sourceField ?? "").trim();
    if (!source) {
      continue;
    }
    for (const target of normalizeTargetList(rawTargetField)) {
      inverted[target] = source;
    }
  }
  return inverted;
}

function buildSourceFieldOptions(
  attributeDefinitions: AttributeDefinition[],
  currentFieldMap: Record<string, FieldMapValue>,
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
    const scopeLabel = definition.appliesTo === "variant" ? "Variant attribute" : "Attribute";
    const appliesLabel = definition.required ? `Required ${scopeLabel.toLowerCase()}` : scopeLabel;
    options.set(`attributes.${definition.key}`, `${definition.name} (${appliesLabel})`);
  }
  for (const sourceField of Object.keys(currentFieldMap)) {
    if (!options.has(sourceField)) {
      options.set(sourceField, labelUndefinedSourceField(sourceField));
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
  selectedPublishCategoryId?: string;
  fallbackAcknowledged?: boolean;
  fallbackAckVersionId?: string;
  taxonomyQ: string;
  step?: MappingWizardStep;
  showAdvanced?: boolean;
  advancedPanel?: MappingAdvancedPanel | "";
  shopifyMetafields?: ShopifyMetafieldDefinition[];
  /** Field map of the operator's latest saved, unpublished draft (see lib/mapping-working-draft). */
  draftFieldMap?: Record<string, string | string[]> | null;
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
  selectedPublishCategoryId,
  fallbackAcknowledged,
  fallbackAckVersionId,
  taxonomyQ,
  step = "review",
  showAdvanced = false,
  advancedPanel = "",
  shopifyMetafields = [],
  draftFieldMap = null,
}: BuildMappingsViewModelArgs) {
  const redirectTo = buildMappingRoute({
    step,
    categoryId: selectedCategoryId,
    channel: selectedChannel,
    installationId: selectedInstallationId,
    productId: selectedProductId,
    publishCategoryId: selectedPublishCategoryId,
    taxonomyQ,
    fallbackAcknowledged,
    fallbackAckVersionId,
    showAdvanced,
    advancedPanel,
  });
  const taxonomyDefaults = requiredAttributesFromTaxonomy(taxonomyMatches);
  const resolvedCategoryTarget = extractResolvedCategoryTarget(resolved?.resolvedMapping ?? null);
  const targetCategoryOptions = uniqueStrings([
    selectedPublishCategoryId ?? "",
    resolvedCategoryTarget,
    ...taxonomyMatches.map((item) => item.id),
    ...unmappedCategories.map((item) => item.id),
  ]);
  const selectedTargetCategory = selectedPublishCategoryId || resolvedCategoryTarget || targetCategoryOptions[0] || "";
  const requiredTargetFields = uniqueStrings([...mapping.requiredFields, ...taxonomyDefaults]);
  const currentFieldMap: Record<string, FieldMapValue> = {};
  // Resume the saved draft when there is one; otherwise start from the live/default map.
  for (const [sourceField, targetField] of Object.entries(draftFieldMap ?? mapping.fieldMap)) {
    const source = String(sourceField ?? "").trim();
    const targets = normalizeTargetList(targetField);
    if (!source || targets.length === 0) {
      continue;
    }
    currentFieldMap[source] = targets.length === 1 ? targets[0] : targets;
  }
  const mappedTargetToSource = invertFieldMap(currentFieldMap);
  // A required field the map already covers as a source key (channel renames it) is not missing; this is the
  // same rule the API's readiness check applies, so the wizard and the Readiness card agree.
  const requiredCoveredBySource = requiredCoverageBySource(requiredTargetFields, currentFieldMap, mappedTargetToSource);
  const targetFieldOptions = uniqueStrings([
    ...requiredTargetFields,
    ...shopifyMetafields
      .filter((definition) => String(definition.ownerType ?? "PRODUCT").toUpperCase() === "PRODUCT")
      .map(shopifyMetafieldTarget),
    ...Object.values(currentFieldMap).flatMap((target) => normalizeTargetList(target)),
  ]);
  const sourceFieldOptions = buildSourceFieldOptions(
    categoryAttributes,
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
    requiredCoveredBySource,
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
  if (code === "required_product_data_missing") return "One or more channel-required product values are missing.";
  if (code === "field_mappings_missing") return "No field mappings are defined for this scope yet.";
  if (code === "connector_not_installed") return "Connector not installed for this channel.";
  if (code === "connector_credentials_expired") return "Connector credentials have expired.";
  if (code === "mapping_compatibility_blocked") return "Mapping compatibility is blocked.";
  if (code === "mapping_remap_required") return "Mapping remap is required.";
  return code.replace(/_/g, " ");
}
