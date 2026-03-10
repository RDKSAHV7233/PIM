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
  return (
    <Card>
      <CardTitle>Create Mapping Draft</CardTitle>
      {canWrite ? (
        <form action={createConnectorMappingVersionAction} className="mt-3 grid gap-3">
          <RoleHiddenInput role={actorRole} />
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

          <div className="rounded-lg border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-sm font-medium text-slate-900">{attributeMappingTitle}</p>
              <p className="text-xs text-slate-500">{attributeMappingDescription}</p>
            </div>
            <div className="overflow-x-auto">
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
                  {targetFieldOptions.map((targetField) => {
                    const selectedSource = mappedTargetToSource[targetField] ?? "";
                    const required = requiredTargetFields.includes(targetField);
                    return (
                      <tr key={targetField} className="border-t border-slate-200">
                        <td className="px-3 py-2.5 font-medium text-slate-900">{targetField}</td>
                        <td className="px-3 py-2.5">
                          <Select name={`${fieldInputPrefix}${targetField}`} defaultValue={selectedSource}>
                            <option value="">Select PIM field</option>
                            {sourceFieldOptions.map((option) => (
                              <option key={`${targetField}:${option.value}`} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusChip label={required ? "Required" : "Optional"} tone={required ? "warning" : "neutral"} />
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusChip label={selectedSource ? "Mapped" : "Missing"} tone={selectedSource ? "success" : required ? "danger" : "neutral"} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
          <Button type="submit" className="w-fit">
            Create draft version
          </Button>
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
    <Card>
      <CardTitle>Publish Readiness (Hard Gate)</CardTitle>
      <div className="mt-2 grid gap-3 text-sm text-slate-700">
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
