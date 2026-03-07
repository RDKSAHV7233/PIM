import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  archiveConnectorMappingVersionAction,
  createConnectorMappingVersionAction,
  publishConnectorMappingVersionAction,
  rollbackConnectorMappingVersionAction,
  validateConnectorMappingVersionAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiHttpError,
  type AppRole,
  type ConnectorTaxonomyItem,
  type MarketplaceChannel,
  evaluateConnectorMappingPreflight,
  evaluateConnectorPublishReadiness,
  getConnectorDefinitions,
  getConnectorMappingVersions,
  getCategories,
  getMarketplaceChannelMapping,
  getMarketplaceChannels,
  getUnmappedConnectorTaxonomy,
  resolveConnectorMapping,
  searchConnectorTaxonomy,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { filterTestData } from "@/lib/test-data-filter";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

interface ChannelsMappingsPageProps {
  searchParams: Promise<{
    categoryId?: string;
    channel?: MarketplaceChannel;
    productId?: string;
    stepUpAction?: "publish" | "archive" | "rollback";
    stepUpError?: string;
    stepUpVersionId?: string;
    taxonomyQ?: string;
  }>;
}

function RoleHiddenInput({ role }: { role: AppRole }) {
  return <input type="hidden" name="actorRole" value={role} />;
}

function normalizeChannel(
  value: string | undefined,
  channels: Array<{ channel: MarketplaceChannel }>,
): MarketplaceChannel {
  const normalized = String(value ?? "").trim().toLowerCase();
  const matched = channels.find((entry) => entry.channel === normalized);
  return matched?.channel ?? channels[0]?.channel ?? "amazon";
}

function mapChannelToConnectorSlug(channel: MarketplaceChannel): string {
  if (channel === "amazon") {
    return "amazon-in";
  }
  return channel;
}

function definitionForConnector(
  definitions: Array<{ id: string; slug: string; connectorVersion: string }>,
  connectorSlug: string,
) {
  return definitions.find((entry) => entry.slug === connectorSlug) ?? null;
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

type ProtectedMappingActionKind = "publish" | "archive" | "rollback";

function protectedActionLabel(action: ProtectedMappingActionKind): string {
  if (action === "archive") {
    return "archive";
  }
  if (action === "rollback") {
    return "rollback";
  }
  return "publish";
}

function resolveStepUpErrorMessage(
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

function ProtectedMappingActionForm({
  action,
  actorRole,
  connectorSlug,
  description,
  disabled,
  label,
  open,
  redirectTo,
  versionId,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  actorRole: AppRole;
  connectorSlug: string;
  description: string;
  disabled: boolean;
  label: string;
  open?: boolean;
  redirectTo: string;
  versionId: string;
  children?: ReactNode;
}) {
  if (disabled) {
    return (
      <Button type="button" variant="secondary" className="text-xs" disabled>
        {label}
      </Button>
    );
  }

  return (
    <details className="rounded-md border border-slate-200 bg-slate-50" open={open}>
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100">
        {label}
      </summary>
      <form action={action} className="space-y-3 border-t border-slate-200 p-3">
        <RoleHiddenInput role={actorRole} />
        <input type="hidden" name="connectorSlug" value={connectorSlug} />
        <input type="hidden" name="versionId" value={versionId} />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor={`${label}-${versionId}`}>
            Step-up re-authentication
          </label>
          <Input
            id={`${label}-${versionId}`}
            name="stepUpPassword"
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            required
          />
          <p className="text-xs text-slate-500">{description}</p>
        </div>
        {children}
        <Button type="submit" className="text-xs">
          {label}
        </Button>
      </form>
    </details>
  );
}

export default async function ChannelsMappingsPage({ searchParams }: ChannelsMappingsPageProps) {
  const query = await searchParams;
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const canWrite = actorRole !== "viewer";
  const stepUpAction = (String(query.stepUpAction ?? "").trim() as ProtectedMappingActionKind | "") || "";
  const stepUpError = String(query.stepUpError ?? "").trim();
  const stepUpVersionId = String(query.stepUpVersionId ?? "").trim();
  const stepUpMessage = resolveStepUpErrorMessage(stepUpError, stepUpAction);

  try {
    const [channels, categoriesRaw, connectorDefinitions] = await Promise.all([
      getMarketplaceChannels({ role: actorRole, authHeader }),
      getCategories({ role: actorRole, authHeader }),
      getConnectorDefinitions({ role: actorRole, authHeader }),
    ]);

    const categories = filterTestData(categoriesRaw, true);
    const selectedCategoryId = String(query.categoryId ?? "").trim() || categories[0]?.id || "";
    const selectedChannel = normalizeChannel(query.channel, channels);
    const connectorSlug = mapChannelToConnectorSlug(selectedChannel);
    const definition = definitionForConnector(connectorDefinitions, connectorSlug);
    const taxonomyQ = String(query.taxonomyQ ?? "").trim();
    const selectedProductId = String(query.productId ?? "").trim();

    const [mapping, versions, resolved, preflight, readiness, taxonomyMatches, unmappedCategories] =
      await Promise.all([
      getMarketplaceChannelMapping(selectedChannel, selectedCategoryId || undefined, undefined, {
        role: actorRole,
        authHeader,
      }),
      getConnectorMappingVersions(
        connectorSlug,
        {
          categoryScope: selectedCategoryId || undefined,
          includeArchived: true,
        },
        { role: actorRole, authHeader },
      ),
      selectedCategoryId
        ? resolveConnectorMapping(connectorSlug, selectedCategoryId, { role: actorRole, authHeader })
        : Promise.resolve(null),
      selectedCategoryId
        ? evaluateConnectorMappingPreflight(
            connectorSlug,
            { categoryScope: selectedCategoryId, fallbackAcknowledged: false },
            { role: actorRole, authHeader },
          )
        : Promise.resolve(null),
      selectedCategoryId
        ? evaluateConnectorPublishReadiness(
            connectorSlug,
            {
              categoryScope: selectedCategoryId,
              productId: selectedProductId || undefined,
              fallbackAcknowledged: false,
            },
            { role: actorRole, authHeader },
          )
        : Promise.resolve(null),
      searchConnectorTaxonomy(
        connectorSlug,
        {
          q: taxonomyQ || undefined,
          limit: 25,
        },
        { role: actorRole, authHeader },
      ),
      getUnmappedConnectorTaxonomy(connectorSlug, { role: actorRole, authHeader }),
    ]);

    const redirectTo = `/channels/mappings?categoryId=${encodeURIComponent(selectedCategoryId)}&channel=${encodeURIComponent(selectedChannel)}${taxonomyQ ? `&taxonomyQ=${encodeURIComponent(taxonomyQ)}` : ""}${selectedProductId ? `&productId=${encodeURIComponent(selectedProductId)}` : ""}`;
    const taxonomyDefaults = requiredAttributesFromTaxonomy(taxonomyMatches);
    const mappingDraftRulesDefault = JSON.stringify(
      {
        field_mappings: mapping.fieldMap,
        required_fields: mapping.requiredFields,
        category: {
          source: selectedCategoryId,
          target: taxonomyMatches[0]?.id ?? "",
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
      },
      null,
      2,
    );
    const resolvedMappingJson = resolved ? JSON.stringify(resolved.resolvedMapping, null, 2) : "{}";

  return (
      <div className="space-y-5">
        <PageHeader
          title="Mappings"
          description="Manage mapping lifecycle, taxonomy linkage, preflight gates, and fallback policy for channel publishing."
          breadcrumb={
            <>
              Dashboard / Channels / <span className="font-semibold text-slate-700">Mappings</span>
            </>
          }
          actions={
            <Link
              href="/channels/connectors"
              className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Open Connector Detail
            </Link>
          }
        />

        {stepUpMessage ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">{stepUpMessage.title}</p>
            <p className="mt-1">{stepUpMessage.description}</p>
          </div>
        ) : null}

        <FilterBar>
          <form method="get" className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-category">
                Category
              </label>
              <Select id="mapping-category" name="categoryId" defaultValue={selectedCategoryId}>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.path}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-channel">
                Channel
              </label>
              <Select id="mapping-channel" name="channel" defaultValue={selectedChannel}>
                {channels.map((channel) => (
                  <option key={channel.channel} value={channel.channel}>
                    {channel.displayName}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-taxonomy-q">
                Taxonomy search
              </label>
              <Input id="mapping-taxonomy-q" name="taxonomyQ" defaultValue={taxonomyQ} placeholder="Search category path..." />
            </div>
            <div className="flex items-end">
              <Button type="submit">Apply</Button>
            </div>
          </form>
        </FilterBar>

        <section className="grid gap-4 lg:grid-cols-2">
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
                Compatibility:{" "}
                <StatusChip
                  label={resolved?.compatibilityState ?? "n/a"}
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
              <pre className="mt-2 max-h-60 overflow-auto text-xs text-slate-700">
                {resolvedMappingJson}
              </pre>
            </details>
          </Card>

          <Card>
            <CardTitle>Create Mapping Version (Lifecycle)</CardTitle>
            {canWrite ? (
              <form action={createConnectorMappingVersionAction} className="mt-3 grid gap-3">
                <RoleHiddenInput role={actorRole} />
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-level">
                    Mapping Level
                  </label>
                  <Select id="mapping-level" name="mappingLevel" defaultValue="tenant_connector_category_mapping">
                    <option value="tenant_connector_default">tenant_connector_default</option>
                    <option value="tenant_connector_category_mapping">tenant_connector_category_mapping</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-category-scope">
                    Category Scope
                  </label>
                  <Input id="mapping-category-scope" name="categoryScope" defaultValue={selectedCategoryId || "*"} required />
                </div>
                <details className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-slate-800">Advanced mapping fields</summary>
                  <div className="mt-3 grid gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-rules">
                        Mapping Rules (JSON object)
                      </label>
                      <Textarea id="mapping-rules" name="mappingRules" rows={8} defaultValue={mappingDraftRulesDefault} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="fallback-policy">
                        Fallback Policy (JSON object)
                      </label>
                      <Textarea id="fallback-policy" name="fallbackPolicy" rows={5} defaultValue={fallbackPolicyDefault} />
                    </div>
                  </div>
                </details>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-compatibility">
                    Compatibility
                  </label>
                  <Select id="mapping-compatibility" name="compatibilityState" defaultValue="compatible">
                    <option value="compatible">compatible</option>
                    <option value="deprecated">deprecated</option>
                    <option value="remap_required">remap_required</option>
                    <option value="blocked">blocked</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-fallback-ack-required">
                    Fallback Ack Required
                  </label>
                  <Select id="mapping-fallback-ack-required" name="fallbackAckRequired" defaultValue="true">
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </Select>
                </div>
                <input type="hidden" name="redirectTo" value={redirectTo} />
                <input type="hidden" name="connectorSlug" value={connectorSlug} />
                <input type="hidden" name="connectorDefinitionId" value={definition?.id ?? connectorSlug} />
                <input
                  type="hidden"
                  name="connectorDefinitionVersion"
                  value={definition?.connectorVersion ?? "1.0.0"}
                />
                <Button type="submit" className="w-fit">
                  Create draft version
                </Button>
              </form>
            ) : (
              <p className="mt-2 text-sm text-slate-600">Viewer role is read-only for mapping version management.</p>
            )}
          </Card>
        </section>

        <Card>
          <CardTitle>Lifecycle Versions</CardTitle>
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Version</th>
                  <th className="px-3 py-2">Scope</th>
                  <th className="px-3 py-2">Lifecycle</th>
                  <th className="px-3 py-2">Compatibility</th>
                  <th className="px-3 py-2">Updated</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {versions.length > 0 ? (
                  versions.map((version) => (
                    <tr key={version.id} className="border-t border-slate-200 hover:bg-slate-50/50">
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-slate-900">{version.connectorDefinitionVersion}</p>
                        <p className="text-xs text-slate-500">{version.id}</p>
                      </td>
                      <td className="px-3 py-2.5">{version.categoryScope}</td>
                      <td className="px-3 py-2.5">
                        <StatusChip
                          label={version.lifecycleState}
                          tone={
                            version.lifecycleState === "published"
                              ? "success"
                              : version.lifecycleState === "archived" || version.lifecycleState === "superseded"
                                ? "neutral"
                                : "info"
                          }
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusChip
                          label={version.compatibilityState}
                          tone={
                            version.compatibilityState === "blocked"
                              ? "danger"
                              : version.compatibilityState === "deprecated" || version.compatibilityState === "remap_required"
                                ? "warning"
                                : "success"
                          }
                        />
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">{new Date(version.updatedAt).toLocaleString()}</td>
                      <td className="px-3 py-2.5">
                        {canWrite ? (
                          <div className="flex flex-wrap gap-2">
                            <form action={validateConnectorMappingVersionAction}>
                              <RoleHiddenInput role={actorRole} />
                              <input type="hidden" name="connectorSlug" value={connectorSlug} />
                              <input type="hidden" name="versionId" value={version.id} />
                              <input type="hidden" name="redirectTo" value={redirectTo} />
                              <Button
                                type="submit"
                                variant="secondary"
                                className="text-xs"
                                disabled={version.lifecycleState !== "draft"}
                              >
                                Validate
                              </Button>
                            </form>
                            <ProtectedMappingActionForm
                              action={publishConnectorMappingVersionAction}
                              actorRole={actorRole}
                              connectorSlug={connectorSlug}
                              description="Publishing is a high-risk action. Confirm your password before promoting this version."
                              disabled={version.lifecycleState !== "validated"}
                              label="Publish"
                              open={stepUpAction === "publish" && stepUpVersionId === version.id}
                              redirectTo={redirectTo}
                              versionId={version.id}
                            >
                              <input type="hidden" name="confirm" value="true" />
                            </ProtectedMappingActionForm>
                            <ProtectedMappingActionForm
                              action={archiveConnectorMappingVersionAction}
                              actorRole={actorRole}
                              connectorSlug={connectorSlug}
                              description="Archiving changes the active mapping history. Confirm your password before continuing."
                              disabled={version.lifecycleState === "archived"}
                              label="Archive"
                              open={stepUpAction === "archive" && stepUpVersionId === version.id}
                              redirectTo={redirectTo}
                              versionId={version.id}
                            >
                              <div className="space-y-1">
                                <label
                                  className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                                  htmlFor={`archive-reason-${version.id}`}
                                >
                                  Archive reason
                                </label>
                                <Input
                                  id={`archive-reason-${version.id}`}
                                  name="reason"
                                  defaultValue="archived_from_mapping_manager"
                                  required
                                />
                              </div>
                            </ProtectedMappingActionForm>
                            {(version.lifecycleState === "superseded" || version.lifecycleState === "archived") && (
                              <ProtectedMappingActionForm
                                action={rollbackConnectorMappingVersionAction}
                                actorRole={actorRole}
                                connectorSlug={connectorSlug}
                                description="Rollback restores this prior published mapping as a new published version."
                                disabled={false}
                                label="Rollback"
                                open={stepUpAction === "rollback" && stepUpVersionId === version.id}
                                redirectTo={redirectTo}
                                versionId={version.id}
                              >
                                <input type="hidden" name="confirm" value="true" />
                                <div className="space-y-1">
                                  <label
                                    className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                                    htmlFor={`rollback-reason-${version.id}`}
                                  >
                                    Rollback reason
                                  </label>
                                  <Input
                                    id={`rollback-reason-${version.id}`}
                                    name="reason"
                                    defaultValue="restore_prior_known_good_mapping"
                                    required
                                  />
                                </div>
                              </ProtectedMappingActionForm>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">Read-only</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr className="border-t border-slate-200">
                    <td className="px-3 py-6 text-sm text-slate-500" colSpan={6}>
                      No mapping versions found for this connector/category scope.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardTitle>Taxonomy Alignment</CardTitle>
            <div className="mt-2 space-y-2 text-sm text-slate-700">
              <p>Search result categories: {taxonomyMatches.length}</p>
              <p>Unmapped categories for {connectorSlug}: {unmappedCategories.length}</p>
            </div>
            <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-800">Show taxonomy search results</summary>
              <ul className="mt-2 space-y-2 text-sm text-slate-700">
                {taxonomyMatches.map((item) => (
                  <li key={item.id} className="rounded border border-slate-200 p-2">
                    <p className="font-medium">{item.path}</p>
                    <p className="text-xs text-slate-500">Required attrs: {item.requiredAttributes.join(", ") || "-"}</p>
                  </li>
                ))}
              </ul>
            </details>
            <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-800">Show unmapped categories</summary>
              <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-sm text-slate-700">
                {unmappedCategories.map((item) => (
                  <li key={item.id} className="rounded border border-slate-200 p-2">
                    <p className="font-medium">{item.path}</p>
                    <p className="text-xs text-slate-500">Required attrs: {item.requiredAttributes.join(", ") || "-"}</p>
                  </li>
                ))}
              </ul>
            </details>
          </Card>

          <Card>
            <CardTitle>Publish Readiness (Hard Gate)</CardTitle>
            <div className="mt-2 grid gap-3 text-sm text-slate-700">
              <div>
                <p className="font-medium">Mapping preflight</p>
                <StatusChip label={preflight?.ok ? "ok" : "blocked"} tone={preflight?.ok ? "success" : "danger"} />
                <p className="mt-1 text-xs text-slate-500">Blockers: {preflight?.blockers.length ?? 0}</p>
              </div>
              <div>
                <p className="font-medium">Publish readiness</p>
                <StatusChip label={readiness?.ok ? "ok" : "blocked"} tone={readiness?.ok ? "success" : "danger"} />
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
              <p className="text-xs text-slate-500">
                Export jobs now hard-block on readiness; fallback mapping requires explicit acknowledgement.
              </p>
            </div>
          </Card>
        </section>

        <Card>
          <CardTitle>Legacy Template Compatibility (Transition Only)</CardTitle>
          <div className="mt-2 space-y-3 text-sm text-slate-700">
            <p>
              Existing template APIs remain active only for transition support. New seller-facing mapping work should use lifecycle mapping versions on this page and the lifecycle manager from product detail.
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
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/channels/mappings", error.status));
    }
    throw error;
  }
}
