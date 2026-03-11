import Link from "next/link";
import type { ReactNode } from "react";
import { createConnectorMappingVersionAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { Textarea } from "@/components/ui/textarea";
import type {
  AppRole,
  ConnectorMappingPreflight,
  ConnectorMappingResolved,
  ConnectorPublishReadiness,
  MarketplaceChannelMapping,
} from "@/lib/api";
import { type ConnectorTaxonomyOption, presentCompatibilityState, statusToneForPreflight } from "@/lib/channel-mappings";

function RoleHiddenInput({ role }: { role: AppRole }) {
  return <input type="hidden" name="actorRole" value={role} />;
}

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
  sourceFieldOptions: Array<{ value: string; label: string }>,
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
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Channel field</th>
              <th className="px-3 py-2">PIM field</th>
              <th className="px-3 py-2">Required</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row) => (
              <tr key={row.targetField} className="border-t border-slate-200">
                <td className="px-3 py-2.5 font-medium text-slate-900">{row.targetField}</td>
                <td className="px-3 py-2.5">
                  <Select name={`${fieldInputPrefix}${row.targetField}`} defaultValue={row.selectedSource}>
                    <option value="">Select PIM field</option>
                    {sourceFieldOptions.map((option) => (
                      <option key={`${row.targetField}:${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-3 py-2.5">
                  <StatusChip
                    label={row.required ? "Required" : "Optional"}
                    tone={row.required ? "warning" : "neutral"}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <StatusChip
                    label={row.selectedSource ? "Mapped" : "Missing"}
                    tone={row.selectedSource ? "success" : row.required ? "danger" : "neutral"}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-semibold">{message.title}</p>
      <p className="mt-1">{message.description}</p>
    </div>
  );
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
  return (
    <Card>
      <CardTitle>Resolved Mapping Snapshot</CardTitle>
      <div className="mt-2 space-y-2 text-sm text-slate-700">
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
        <p>Matched mapping versions: {resolved?.matched?.length ?? 0}</p>
      </div>
      <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-800">Advanced: resolved mapping JSON</summary>
        <pre className="mt-2 max-h-60 overflow-auto text-xs text-slate-700">{resolvedMappingJson}</pre>
      </details>
    </Card>
  );
}

export function MappingEditorCard({
  actorRole,
  canWrite,
  connectorSlug,
  definitionId,
  definitionVersion,
  redirectTo,
  selectedCategoryId,
  selectedTargetCategory,
  targetCategoryOptions,
  taxonomyMatches,
  unmappedCategories,
  requiredTargetFields,
  mappedTargetToSource,
  targetFieldOptions,
  sourceFieldOptions,
  taxonomyDefaults,
  mappingDraftRulesDefault,
  fallbackPolicyDefault,
  mappingTypeLabel,
  attributeMappingTitle,
  attributeMappingDescription,
  fieldInputPrefix,
  fallbackTitle,
  advancedJsonTitle,
  mappingRulesPlaceholder,
}: {
  actorRole: AppRole;
  canWrite: boolean;
  connectorSlug: string;
  definitionId: string;
  definitionVersion: string;
  redirectTo: string;
  selectedCategoryId: string;
  selectedTargetCategory: string;
  targetCategoryOptions: string[];
  taxonomyMatches: ConnectorTaxonomyOption[];
  unmappedCategories: ConnectorTaxonomyOption[];
  requiredTargetFields: string[];
  mappedTargetToSource: Record<string, string>;
  targetFieldOptions: string[];
  sourceFieldOptions: Array<{ value: string; label: string }>;
  taxonomyDefaults: string[];
  mappingDraftRulesDefault: string;
  fallbackPolicyDefault: string;
  mappingTypeLabel: string;
  attributeMappingTitle: string;
  attributeMappingDescription: string;
  fieldInputPrefix: string;
  fallbackTitle: string;
  advancedJsonTitle: string;
  mappingRulesPlaceholder: string;
}) {
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

  return (
    <Card id="mapping-draft">
      <CardTitle>Map required fields first</CardTitle>
      {canWrite ? (
        <form action={createConnectorMappingVersionAction} className="mt-3 grid gap-3">
          <RoleHiddenInput role={actorRole} />
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <StatusChip label={`${requiredTargetFields.length} required fields`} tone="info" />
              <StatusChip label={`${mappedRequiredCount} mapped`} tone={mappedRequiredCount > 0 ? "success" : "neutral"} />
              <StatusChip label={`${missingRequiredCount} missing`} tone={missingRequiredCount > 0 ? "warning" : "success"} />
            </div>
            <p className="mt-2 text-sm text-slate-700">
              Start by mapping the missing required fields below. Optional fields and advanced JSON overrides are available after the required fields are covered.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-level">
                {mappingTypeLabel}
              </label>
              <Select id="mapping-level" name="mappingLevel" defaultValue="tenant_connector_category_mapping">
                <option value="tenant_connector_default">Default mapping</option>
                <option value="tenant_connector_category_mapping">Category mapping</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-category-scope">
                Category scope
              </label>
              <Input id="mapping-category-scope" name="categoryScope" defaultValue={selectedCategoryId || "*"} required />
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
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-900">{fallbackTitle}</p>
            <p className="mt-1 text-xs text-slate-500">Use fallback only when you want a backup category path during publish.</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="fallback-enabled">
                  Allow fallback mapping
                </label>
                <Select id="fallback-enabled" name="fallbackEnabled" defaultValue="true">
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-fallback-ack-required">
                  Fallback confirmation
                </label>
                <Select id="mapping-fallback-ack-required" name="fallbackAckRequired" defaultValue="true">
                  <option value="true">Required</option>
                  <option value="false">Not required</option>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="fallback-default-category">
                  Default fallback category
                </label>
                <Input id="fallback-default-category" name="fallbackDefaultCategory" defaultValue={selectedTargetCategory} placeholder="Optional fallback category id" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="fallback-warning-tag">
                  Fallback label
                </label>
                <Input id="fallback-warning-tag" name="fallbackWarningTag" defaultValue="fallback_category_mapping" />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="fallback-ack-message">
                  Confirmation message
                </label>
                <Textarea id="fallback-ack-message" name="fallbackAckMessage" rows={3} defaultValue="Fallback category will be used for publish if no explicit mapping exists." />
              </div>
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
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              Save the draft here, then jump to version history to validate and publish it.
            </p>
            <Button type="submit" className="w-fit">
              Save draft version
            </Button>
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
}: {
  preflight: ConnectorMappingPreflight | null;
  readiness: ConnectorPublishReadiness | null;
}) {
  return (
    <Card id="mapping-readiness">
      <CardTitle>Publish Readiness (Hard Gate)</CardTitle>
      <div className="mt-2 grid gap-3 text-sm text-slate-700">
        <p className="text-xs text-slate-500">
          Use this section after the draft is validated. Publish remains blocked until both mapping preflight and publish readiness are clear.
        </p>
        <div>
          <p className="font-medium">Mapping preflight</p>
          <StatusChip label={preflight?.ok ? "ok" : "blocked"} tone={statusToneForPreflight(preflight)} />
          <p className="mt-1 text-xs text-slate-500">Blockers: {preflight?.blockers.length ?? 0}</p>
        </div>
        <div>
          <p className="font-medium">Publish readiness</p>
          <StatusChip label={readiness?.ok ? "ok" : "blocked"} tone={statusToneForPreflight(readiness)} />
          <p className="mt-1 text-xs text-slate-500">Blockers: {readiness?.blockers.length ?? 0}</p>
        </div>
        <details className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-800">Blockers and warnings</summary>
          <div className="mt-2 space-y-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Preflight blockers</p>
              <ul className="list-disc pl-5 text-sm text-slate-700">
                {(preflight?.blockers ?? []).map((item) => (
                  <li key={`pf-b-${item}`}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Readiness blockers</p>
              <ul className="list-disc pl-5 text-sm text-slate-700">
                {(readiness?.blockers ?? []).map((item) => (
                  <li key={`rd-b-${item}`}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Warnings</p>
              <ul className="list-disc pl-5 text-sm text-slate-700">
                {(readiness?.warnings ?? []).map((item) => (
                  <li key={`rd-w-${item}`}>{item}</li>
                ))}
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
