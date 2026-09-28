import Link from "next/link";
import type { ReactNode } from "react";
import { createConnectorMappingVersionAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { JsonPreview } from "@/components/ui/json-preview";
import { Select } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { Textarea } from "@/components/ui/textarea";
import { MappingFieldRowControls } from "@/components/channel/mapping-field-row";
import { WooCommerceCustomMetaFields } from "@/components/channel/woocommerce-custom-meta-fields";
import type {
  AppRole,
  ConnectorMappingPreflight,
  ConnectorMappingResolved,
  ConnectorPublishReadiness,
  MarketplaceChannelMapping,
} from "@/lib/api";
import { type ConnectorTaxonomyOption, describeReadinessCode, presentCompatibilityState, statusToneForPreflight, describeMappingSource, isDefaultMappingLevel } from "@/lib/channel-mappings";

type MappingFieldRow = {
  targetField: string;
  selectedSource: string;
  required: boolean;
};

type MappingFieldGroupKey = "core" | "compliance" | "attributes" | "media";

function classifyMappingFieldGroup(targetField: string): {
  key: MappingFieldGroupKey;
  title: string;
  description: string;
} {
  const normalized = String(targetField ?? "").trim().toLowerCase();
  if (normalized.startsWith("attributes.")) {
    return {
      key: "attributes",
      title: "Attributes",
      description: "Map the product attributes required by the target taxonomy.",
    };
  }
  if (
    normalized.includes("hsn") ||
    normalized.includes("gst") ||
    normalized.includes("tax") ||
    normalized.includes("compliance")
  ) {
    return {
      key: "compliance",
      title: "Compliance",
      description: "Complete tax and compliance fields before validating the draft.",
    };
  }
  if (
    normalized.includes("image") ||
    normalized.includes("media") ||
    normalized.includes("gallery") ||
    normalized.includes("video")
  ) {
    return {
      key: "media",
      title: "Media",
      description: "Map image and media fields only when the target category requires them.",
    };
  }
  return {
    key: "core",
    title: "Core product",
    description: "Title, brand, description, and other core catalog fields come first.",
  };
}

function renderFieldRows(
  rows: MappingFieldRow[],
  fieldInputPrefix: string,
  sourceFieldOptions: Array<{ value: string; label: string; preview: string | null }>,
) {
  if (rows.length === 0) {
    return null;
  }

  const grouped = new Map<
    MappingFieldGroupKey,
    {
      title: string;
      description: string;
      rows: MappingFieldRow[];
    }
  >();

  for (const row of rows) {
    const group = classifyMappingFieldGroup(row.targetField);
    if (!grouped.has(group.key)) {
      grouped.set(group.key, { title: group.title, description: group.description, rows: [] });
    }
    grouped.get(group.key)?.rows.push(row);
  }

  return Array.from(grouped.values()).map((group) => (
    <div key={group.title} className="space-y-2">
      <div className="px-3 pt-3">
        <p className="text-sm font-semibold text-slate-900">{group.title}</p>
        <p className="text-xs text-slate-500">{group.description}</p>
      </div>
      <div className="rounded-lg border border-slate-200">
        <div className="hidden grid-cols-[minmax(0,1.15fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto_auto] gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs uppercase text-slate-500 lg:grid">
          <div>Channel field</div>
          <div>PIM field</div>
          <div>Sample product value</div>
          <div>Required</div>
          <div>Status</div>
        </div>
        <div className="space-y-3 p-3">
          {group.rows.map((row) => (
            <div
              key={row.targetField}
              className="overflow-hidden rounded-lg border border-slate-200 bg-white p-3 lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto_auto] lg:items-start lg:gap-3"
            >
              <div className="flex items-baseline gap-1.5 lg:block">
                <p className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:hidden">
                  Channel field:
                </p>
                <p className="text-sm font-medium text-slate-900">{row.targetField}</p>
              </div>
              <MappingFieldRowControls
                row={row}
                fieldInputPrefix={fieldInputPrefix}
                sourceFieldOptions={sourceFieldOptions}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  ));
}


export function MappingStepUpAlert({
  message,
}: {
  message: { title: string; description: string } | null;
}) {
  if (!message) {
    return null;
  }

  return <InlineAlert tone="warning" title={message.title} message={message.description} />;
}

export function ResolvedMappingSnapshotCard({
  mapping,
  connectorSlug,
  resolved,
  resolvedMappingJson,
}: {
  mapping: MarketplaceChannelMapping;
  connectorSlug: string;
  resolved: ConnectorMappingResolved | null;
  resolvedMappingJson: string;
}) {
  const mappingSource = describeMappingSource(resolved);
  return (
    <Card>
      <CardTitle>Resolved Mapping Snapshot</CardTitle>
      <div className="mt-2 space-y-2 text-sm text-slate-700">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex items-center gap-2">
            <StatusChip label={mappingSource.label} tone={mappingSource.tone} />
          </div>
          <p className="mt-1 text-xs text-slate-600">{mappingSource.description}</p>
        </div>
        <p>
          Channel: <span className="font-medium capitalize">{mapping.channel}</span>
        </p>
        <p>
          Connector slug: <span className="font-medium">{connectorSlug}</span>
        </p>
        <p>
          Channel compatibility:{" "}
          <StatusChip
            label={presentCompatibilityState(resolved?.compatibilityState)}
            tone={
              resolved?.compatibilityState === "blocked"
                ? "danger"
                : resolved?.compatibilityState === "deprecated" || resolved?.compatibilityState === "remap_required"
                  ? "warning"
                  : "success"
            }
          />
        </p>
        <p>Required fields: {mapping.requiredFields.length}</p>
        <p>Matched mapping versions: {resolved?.matchedVersions?.length ?? 0}</p>
      </div>
      <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-800">Advanced: resolved mapping JSON</summary>
        <JsonPreview value={resolvedMappingJson} className="mt-2 max-h-60 border-0 bg-transparent p-0" />
      </details>
    </Card>
  );
}

export type MappingEditorConnector = {
  slug: string;
  definitionId: string;
  definitionVersion: string;
};

export type MappingEditorTaxonomy = {
  matches: ConnectorTaxonomyOption[];
  unmapped: ConnectorTaxonomyOption[];
  defaults: string[];
  categoryOptions: string[];
};

export type MappingEditorFieldMapping = {
  required: string[];
  mappedToSource: Record<string, string>;
  options: string[];
};

export type MappingEditorSampleProduct = {
  label: string | null;
  mode: "selected" | "category_sample" | "none";
  fieldOptions: Array<{ value: string; label: string; preview: string | null }>;
};

export type MappingEditorLabels = {
  mappingType: string;
  attributeMapping: string;
  attributeMappingDescription: string;
  fieldInputPrefix: string;
  advancedJson: string;
  mappingRulesPlaceholder: string;
};

export function MappingEditorCard({
  actorRole,
  canWrite,
  redirectTo,
  selectedCategoryId,
  selectedTargetCategory,
  fallbackPolicyDefault,
  connector,
  taxonomy,
  fieldMapping,
  sampleProduct,
  labels,
  installationId,
}: {
  actorRole: AppRole;
  canWrite: boolean;
  redirectTo: string;
  selectedCategoryId: string;
  selectedTargetCategory: string;
  fallbackPolicyDefault: string;
  connector: MappingEditorConnector;
  taxonomy: MappingEditorTaxonomy;
  fieldMapping: MappingEditorFieldMapping;
  sampleProduct: MappingEditorSampleProduct;
  labels: MappingEditorLabels;
  installationId?: string;
}) {
  const { slug: connectorSlug, definitionId, definitionVersion } = connector;
  const { matches: taxonomyMatches, unmapped: unmappedCategories, defaults: taxonomyDefaults, categoryOptions: targetCategoryOptions } = taxonomy;
  const { required: requiredTargetFields, mappedToSource: mappedTargetToSource, options: targetFieldOptions } = fieldMapping;
  const { label: sampleProductLabel, mode: sampleProductMode, fieldOptions: sourceFieldOptions } = sampleProduct;
  const { mappingType: mappingTypeLabel, attributeMapping: attributeMappingTitle, attributeMappingDescription, fieldInputPrefix, advancedJson: advancedJsonTitle, mappingRulesPlaceholder } = labels;
  const rows: MappingFieldRow[] = targetFieldOptions.map((targetField) => ({
    targetField,
    selectedSource: mappedTargetToSource[targetField] ?? "",
    required: requiredTargetFields.includes(targetField),
  }));
  const missingRequiredRows = rows.filter((row) => row.required && !row.selectedSource);
  const mappedRequiredRows = rows.filter((row) => row.required && row.selectedSource);
  const optionalRows = rows.filter((row) => !row.required);
  const mappedRequiredCount = mappedRequiredRows.length;
  const missingRequiredCount = missingRequiredRows.length;
  const existingMetaTargets = Object.entries(mappedTargetToSource)
    .filter(([key]) => key.startsWith("meta_data."))
    .map(([target, source]) => ({ target, source }));

  return (
    <Card id="mapping-draft">
      <CardTitle>Step 2: Map Required Fields</CardTitle>
      {canWrite ? (
        <form action={createConnectorMappingVersionAction} className="mt-3 grid gap-3" data-mapping-dirty-form="true" id="mapping-edit-form">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <StatusChip label={`${requiredTargetFields.length} required fields`} tone="info" />
              <StatusChip label={`${mappedRequiredCount} mapped`} tone={mappedRequiredCount > 0 ? "success" : "neutral"} />
              <StatusChip label={`${missingRequiredCount} missing`} tone={missingRequiredCount > 0 ? "warning" : "success"} />
            </div>
            <p className="mt-2 text-sm text-slate-700">
              Start with the missing required fields below. Optional fields and advanced controls stay available, but they no longer interrupt the primary mapping lane.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {sampleProductMode === "selected" && sampleProductLabel
                ? `Sample source values come from the selected product: ${sampleProductLabel}.`
                : sampleProductMode === "category_sample" && sampleProductLabel
                ? `Sample source values use a category example product: ${sampleProductLabel}.`
                  : "Sample source values are unavailable until a product context is available for this category."}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-level">
                {mappingTypeLabel}
              </label>
              <Select id="mapping-level" name="mappingLevel" defaultValue="tenant_connector_category_mapping">
                <option value="tenant_connector_default">Default mapping for all categories</option>
                <option value="tenant_connector_category_mapping">Category-specific override</option>
              </Select>
              <p className="text-xs text-slate-500" id="mapping-level-help">
                Default mapping applies to every category unless a category-specific override exists.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-category-scope">
                Category scope
              </label>
              <Input id="mapping-category-scope" name="categoryScope" defaultValue={selectedCategoryId || "*"} readOnly required />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-target-category">
                Publish category
              </label>
              {targetCategoryOptions.length > 0 ? (
                <Select id="mapping-target-category" name="targetCategory" defaultValue={selectedTargetCategory}>
                  {targetCategoryOptions.map((itemId) => {
                    const match = taxonomyMatches.find((entry) => entry.id === itemId) ?? unmappedCategories.find((entry) => entry.id === itemId);
                    return (
                      <option key={itemId} value={itemId}>
                        {match?.path ?? itemId}
                      </option>
                    );
                  })}
                </Select>
              ) : (
                <Input
                  id="mapping-target-category"
                  name="targetCategory"
                  placeholder="Enter target channel category id"
                  defaultValue={selectedTargetCategory}
                  required
                />
              )}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-compatibility">
                Channel compatibility
              </label>
              <Select id="mapping-compatibility" name="compatibilityState" defaultValue="compatible">
                <option value="compatible">Compatible</option>
                <option value="deprecated">Needs review</option>
                <option value="remap_required">Needs remap</option>
                <option value="blocked">Blocked</option>
              </Select>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-sm font-medium text-slate-900">{attributeMappingTitle}</p>
              <p className="text-xs text-slate-500">{attributeMappingDescription}</p>
            </div>
            <div className="space-y-4 p-3">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">Required fields still missing</p>
                <p className="mt-1 text-xs text-amber-800">
                  Finish these required fields before you move to validation and publish.
                </p>
              </div>
              {missingRequiredRows.length > 0 ? (
                renderFieldRows(missingRequiredRows, fieldInputPrefix, sourceFieldOptions)
              ) : (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                  All required fields are mapped. Save the draft, then validate it in version history.
                </div>
              )}

              {mappedRequiredRows.length > 0 ? (
                <details className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-slate-900">
                    Show mapped required fields
                  </summary>
                  <div className="mt-3">{renderFieldRows(mappedRequiredRows, fieldInputPrefix, sourceFieldOptions)}</div>
                </details>
              ) : null}

              {optionalRows.length > 0 ? (
                <details className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-slate-900">
                    Show optional fields
                  </summary>
                  <p className="mt-2 text-xs text-slate-500">
                    Optional fields can improve completeness, but they are not required to create the draft.
                  </p>
                  <div className="mt-3">{renderFieldRows(optionalRows, fieldInputPrefix, sourceFieldOptions)}</div>
                </details>
              ) : null}

              {connectorSlug === "woocommerce" && (
                <WooCommerceCustomMetaFields
                  fieldInputPrefix={fieldInputPrefix}
                  sourceFieldOptions={sourceFieldOptions}
                  existingMetaTargets={existingMetaTargets}
                />
              )}
            </div>
          </div>

          {requiredTargetFields.map((field) => (
            <input key={`required-field-${field}`} type="hidden" name="requiredField" value={field} />
          ))}
          {taxonomyDefaults.map((field) => (
            <input key={`taxonomy-required-${field}`} type="hidden" name="taxonomyRequiredAttribute" value={field} />
          ))}

          <details className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <summary className="cursor-pointer text-sm font-medium text-slate-800">{advancedJsonTitle}</summary>
            <p className="mt-2 text-xs text-slate-500">Use only for exceptional cases. The structured editor above is the primary authoring path.</p>
            <div className="mt-3 grid gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-rules">
                  Override mapping rules (JSON)
                </label>
                <Textarea id="mapping-rules" name="mappingRules" rows={8} placeholder={mappingRulesPlaceholder} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="fallback-policy">
                  Override fallback behavior (JSON)
                </label>
                <Textarea id="fallback-policy" name="fallbackPolicy" rows={5} placeholder={fallbackPolicyDefault} />
              </div>
            </div>
          </details>

          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="connectorSlug" value={connectorSlug} />
          <input type="hidden" name="connectorDefinitionId" value={definitionId} />
          <input type="hidden" name="connectorDefinitionVersion" value={definitionVersion} />
          {installationId ? <input type="hidden" name="installationId" value={installationId} /> : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              Saving takes you straight to the review step to validate and publish this draft.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" className="w-fit">
                Save draft version
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <p className="mt-2 text-sm text-slate-600">Your role is read-only for mapping version management.</p>
      )}
    </Card>
  );
}

export function PublishReadinessCard({
  preflight,
  readiness,
  fallbackAcknowledged,
  fallbackAckVersionId,
  fallbackAckError,
  connectorAccountLabel,
  connectorHealthLabel,
  connectorHealthTone,
  connectorHealthHref,
  payloadPreviewHref,
}: {
  preflight: ConnectorMappingPreflight | null;
  readiness: ConnectorPublishReadiness | null;
  fallbackAcknowledged: boolean;
  fallbackAckVersionId?: string;
  fallbackAckError?: string;
  connectorAccountLabel: string | null;
  connectorHealthLabel: string | null;
  connectorHealthTone: "neutral" | "success" | "warning" | "danger" | "info";
  connectorHealthHref: string;
  payloadPreviewHref: string;
}) {
  const isBlocked = !(preflight?.ok ?? false) || !(readiness?.ok ?? false) || fallbackAckError === "required";
  const mappingCompleteness = readiness?.checks?.mappingCompleteness;
  const productDataReadiness = readiness?.checks?.productDataReadiness;
  const missingRequiredMappings = mappingCompleteness?.missingRequiredMappings ?? [];
  const missingRequiredProductValues = productDataReadiness?.missingRequiredProductValues ?? [];
  const mappingCompletenessOk = Boolean(readiness) && missingRequiredMappings.length === 0;
  const productDataReadinessOk = Boolean(readiness) && missingRequiredProductValues.length === 0;

  return (
    <Card id="mapping-readiness">
      <CardTitle>Publish Readiness</CardTitle>
      <div className="mt-2 grid gap-3 text-sm text-slate-700">
        <p className="text-xs text-slate-500">
          Publish remains blocked until mapping completeness and product data readiness are both clear.
        </p>
        <div>
          <p className="font-medium">Mapping completeness</p>
          <StatusChip label={mappingCompletenessOk ? "ok" : "blocked"} tone={mappingCompletenessOk ? "success" : "danger"} />
          <p className="mt-1 text-xs text-slate-500">
            Required category attributes missing from mappings: {missingRequiredMappings.length}
          </p>
        </div>
        {preflight?.matchedVersionIds?.length ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evaluated mapping versions</p>
            <p className="mt-1 text-sm text-slate-800">
              Readiness is evaluating the currently published mapping version set, not the unsaved draft. Version IDs: {preflight.matchedVersionIds.join(", ")}
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evaluated mapping versions</p>
            <p className="mt-1 text-sm text-slate-800">
              No published mapping version is active for this scope yet. Readiness is currently falling back to the system or tenant default path.
            </p>
          </div>
        )}
        <div>
          <p className="font-medium">Product data readiness</p>
          <StatusChip label={productDataReadinessOk ? "ok" : "blocked"} tone={productDataReadinessOk ? "success" : "danger"} />
          <p className="mt-1 text-xs text-slate-500">
            Channel-required product values missing: {missingRequiredProductValues.length}
          </p>
        </div>
        {isBlocked ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Blocked-state recovery</p>
            {connectorHealthLabel ? (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusChip label={connectorHealthLabel} tone={connectorHealthTone} />
                  {connectorAccountLabel ? <span className="text-sm text-slate-700">{connectorAccountLabel}</span> : null}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Open the connector account cockpit for health, credentials, and retry context, or jump to payload preview for this product and channel.
                </p>
              </>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                No connector account is selected for this channel yet. Install or choose an account before publish can clear.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={connectorHealthHref}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Open connector health
              </Link>
              <Link
                href={payloadPreviewHref}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Open payload preview
              </Link>
            </div>
          </div>
        ) : null}
        {(preflight?.fallbackAckRequired || readiness?.blockers.includes("fallback_ack_required") || fallbackAckError === "required") ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-900">Fallback acknowledgement required</p>
            <p className="mt-1 text-xs text-amber-800">
              A fallback category path is active for this mapping scope. Acknowledge it from version history before publishing the affected version.
            </p>
            {fallbackAcknowledged ? (
              <p className="mt-2 text-xs text-emerald-800">
                Acknowledgement is active{fallbackAckVersionId ? ` for version ${fallbackAckVersionId}.` : "."}
              </p>
            ) : (
              <p className="mt-2 text-xs text-amber-900">Readiness stays blocked until that acknowledgement is recorded in the current workflow.</p>
            )}
          </div>
        ) : null}
        <details className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-800">Blockers and warnings</summary>
          <div className="mt-2 space-y-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Preflight blockers</p>
              <ul className="list-disc pl-5 text-sm text-slate-700">
                {(preflight?.blockers ?? []).length > 0 ? (
                  (preflight?.blockers ?? []).map((item) => (
                    <li key={`pf-b-${item}`}>{describeReadinessCode(item)}</li>
                  ))
                ) : (
                  <li>No preflight blockers are active.</li>
                )}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Readiness blockers</p>
              <ul className="list-disc pl-5 text-sm text-slate-700">
                {(readiness?.blockers ?? []).length > 0 ? (
                  (readiness?.blockers ?? []).map((item) => (
                    <li key={`rd-b-${item}`}>{describeReadinessCode(item)}</li>
                  ))
                ) : (
                  <li>No publish-readiness blockers are active.</li>
                )}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Warnings</p>
              <ul className="list-disc pl-5 text-sm text-slate-700">
                {(readiness?.warnings ?? []).length > 0 ? (
                  (readiness?.warnings ?? []).map((item) => (
                    <li key={`rd-w-${item}`}>{describeReadinessCode(item)}</li>
                  ))
                ) : (
                  <li>No readiness warnings are active.</li>
                )}
              </ul>
            </div>
          </div>
        </details>
        <p className="text-xs text-slate-500">Export jobs now hard-block on readiness; fallback mapping requires explicit acknowledgement.</p>
      </div>
    </Card>
  );
}

export function LegacyTemplateCompatibilityCard() {
  return (
    <Card>
      <CardTitle>Legacy Template Compatibility (Transition Only)</CardTitle>
      <div className="mt-2 space-y-3 text-sm text-slate-700">
        <p>
          Existing template APIs remain available only for transition support. Edit live channel mappings on this page; the older connector template route now redirects here.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/catalog/products" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Open product simulator
          </Link>
          <Link href="/channels/connectors" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Open connectors
          </Link>
        </div>
      </div>
    </Card>
  );
}
