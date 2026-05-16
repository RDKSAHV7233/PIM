import Link from "next/link";
import { redirect } from "next/navigation";
import { LegacyTemplateCompatibilityCard, MappingEditorCard, MappingStepUpAlert, PublishReadinessCard, ResolvedMappingSnapshotCard } from "@/components/channel/mapping-editor";
import { MappingContextSummaryCard, MappingWorkflowHeader } from "@/components/channel/mapping-workflow";
import { MappingsFilterCard, TaxonomyAlignmentCard } from "@/components/channel/taxonomy-search";
import { VersionManagerCard } from "@/components/channel/version-manager";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ApiHttpError,
  getInstalledConnectors,
  getProduct,
  getProducts,
  type ConnectorInstallation,
  type MarketplaceChannel,
  evaluateConnectorMappingPreflight,
  evaluateConnectorPublishReadiness,
  getCategoryAttributes,
  getConnectorDefinitions,
  getConnectorMappingVersions,
  getCategoryTree,
  getMarketplaceChannelMapping,
  getMarketplaceChannels,
  getUnmappedConnectorTaxonomy,
  resolveConnectorMapping,
  searchConnectorTaxonomy,
} from "@/lib/api";
import { getShopifyConfig } from "@/lib/api/connectors";
import type { ShopifyStoreConfig } from "@/lib/api/core";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { WorkflowStepper, type WorkflowStep } from "@/components/ui/workflow-stepper";
import { buildMappingsViewModel, definitionForConnector, mapChannelToConnectorSlug, normalizeChannel, resolveStepUpErrorMessage, type ProtectedMappingActionKind } from "@/lib/channel-mappings";
import { canEditWorkspace } from "@/lib/role-capabilities";
import { filterTestData } from "@/lib/test-data-filter";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

interface ChannelsMappingsPageProps {
  searchParams: Promise<{
    categoryId?: string;
    channel?: MarketplaceChannel;
    installationId?: string;
    productId?: string;
    fallbackAcknowledged?: string;
    fallbackAckVersionId?: string;
    fallbackAckError?: string;
    stepUpAction?: "publish" | "archive" | "rollback";
    stepUpError?: string;
    stepUpVersionId?: string;
    taxonomyQ?: string;
    showContext?: string;
    showTaxonomy?: string;
    showResolved?: string;
    showHistory?: string;
  }>;
}

function isEnabled(value: string | undefined): boolean {
  return String(value ?? "").trim() === "1";
}

function buildMappingHref(
  query: Awaited<ChannelsMappingsPageProps["searchParams"]>,
  overrides: Partial<
    Record<"showContext" | "showTaxonomy" | "showResolved" | "showHistory" | "taxonomyQ" | "categoryId" | "channel" | "installationId" | "productId" | "fallbackAcknowledged" | "fallbackAckVersionId" | "fallbackAckError", string | undefined>
  >,
): string {
  const params = new URLSearchParams();
  const nextQuery = {
    categoryId: String(query.categoryId ?? "").trim(),
    channel: String(query.channel ?? "").trim(),
    installationId: String(query.installationId ?? "").trim(),
    productId: String(query.productId ?? "").trim(),
    fallbackAcknowledged: String(query.fallbackAcknowledged ?? "").trim(),
    fallbackAckVersionId: String(query.fallbackAckVersionId ?? "").trim(),
    fallbackAckError: String(query.fallbackAckError ?? "").trim(),
    taxonomyQ: String(query.taxonomyQ ?? "").trim(),
    showContext: String(query.showContext ?? "").trim(),
    showTaxonomy: String(query.showTaxonomy ?? "").trim(),
    showResolved: String(query.showResolved ?? "").trim(),
    showHistory: String(query.showHistory ?? "").trim(),
    ...overrides,
  };

  for (const [key, raw] of Object.entries(nextQuery)) {
    const value = String(raw ?? "").trim();
    if (value.length > 0) {
      params.set(key, value);
    }
  }

  const encoded = params.toString();
  return encoded ? `/channels/mappings?${encoded}` : "/channels/mappings";
}

function DeferredMappingPanelCard({
  title,
  description,
  href,
  actionLabel,
}: {
  title: string;
  description: string;
  href: string;
  actionLabel: string;
}) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
      <Link
        href={href}
        className="mt-3 inline-flex rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        {actionLabel}
      </Link>
    </Card>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readMetadataValue(metadata: unknown, key: string): string | null {
  const value = asRecord(metadata)[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveInstallationLabel(installation: ConnectorInstallation): string {
  const shopName = readMetadataValue(installation.metadata, "shopName");
  const shopDomain = readMetadataValue(installation.metadata, "shopDomain");
  const accountContext = shopName || shopDomain || installation.externalAccountRef || installation.accountAlias;
  return `${installation.accountAlias} (${accountContext})`;
}

function resolveInstallationContextDetail(installation: ConnectorInstallation): string {
  const shopName = readMetadataValue(installation.metadata, "shopName");
  const shopDomain = readMetadataValue(installation.metadata, "shopDomain");
  const externalRef = installation.externalAccountRef;
  const context = [shopName, shopDomain, externalRef].filter(Boolean).join(" | ");
  const prefix = context.length > 0
    ? `${installation.displayName} | ${context} | status ${installation.status}`
    : `${installation.displayName} | status ${installation.status}`;
  return `${prefix}. Readiness and publish checks now follow the selected connector account in this workbench.`;
}

function resolveInstallationDetail(installation: ConnectorInstallation): string {
  const shopName = readMetadataValue(installation.metadata, "shopName");
  const shopDomain = readMetadataValue(installation.metadata, "shopDomain");
  const externalRef = installation.externalAccountRef;
  const context = [shopName, shopDomain, externalRef].filter(Boolean).join(" | ");
  const prefix = context.length > 0
    ? `${installation.displayName} | ${context} | status ${installation.status}`
    : `${installation.displayName} | status ${installation.status}`;
  return `${prefix}. Readiness and publish checks now follow the selected connector account in this workbench.`;
}

function connectorHealthTone(status: string): "neutral" | "success" | "warning" | "danger" {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (normalized === "ACTIVE") {
    return "success";
  }
  if (normalized === "CREDENTIAL_EXPIRED" || normalized === "FAILED" || normalized === "ERROR") {
    return "danger";
  }
  if (normalized === "PAUSED" || normalized === "DISABLED" || normalized === "INACTIVE") {
    return "warning";
  }
  return "neutral";
}

function connectorHealthLabel(status: string): string {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (normalized === "ACTIVE") {
    return "Healthy";
  }
  if (normalized === "CREDENTIAL_EXPIRED") {
    return "Credentials expired";
  }
  if (normalized === "PAUSED") {
    return "Paused";
  }
  if (normalized === "DISABLED") {
    return "Disabled";
  }
  if (normalized === "FAILED" || normalized === "ERROR") {
    return "Needs attention";
  }
  return status || "Unknown";
}

export default async function ChannelsMappingsPage({ searchParams }: ChannelsMappingsPageProps) {
  const query = await searchParams;
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const canWrite = canEditWorkspace(actorRole);
  const stepUpAction = (String(query.stepUpAction ?? "").trim() as ProtectedMappingActionKind | "") || "";
  const stepUpVersionId = String(query.stepUpVersionId ?? "").trim();
  const stepUpMessage = resolveStepUpErrorMessage(String(query.stepUpError ?? "").trim(), stepUpAction);
  const selectedProductId = String(query.productId ?? "").trim();
  const showContext = isEnabled(query.showContext);
  const showResolved = isEnabled(query.showResolved) || showContext;
  const showTaxonomy = isEnabled(query.showTaxonomy) || String(query.taxonomyQ ?? "").trim().length > 0;
  const showHistory = isEnabled(query.showHistory) || Boolean(stepUpAction) || Boolean(stepUpVersionId);
  const fallbackAcknowledged = String(query.fallbackAcknowledged ?? "").trim() === "true";
  const fallbackAckVersionId = String(query.fallbackAckVersionId ?? "").trim();
  const fallbackAckError = String(query.fallbackAckError ?? "").trim();

  try {
    const [channels, categoriesRaw, connectorDefinitions, installedConnectors] = await Promise.all([
      getMarketplaceChannels({ role: actorRole, authHeader }),
      getCategoryTree({ all: true }, { role: actorRole, authHeader }),
      getConnectorDefinitions({ role: actorRole, authHeader }),
      getInstalledConnectors({ role: actorRole, authHeader }),
    ]);
    const categories = filterTestData(categoriesRaw, true);
    const selectedCategoryId = String(query.categoryId ?? "").trim() || categories[0]?.id || "";
    const selectedChannel = normalizeChannel(query.channel, channels);
    const connectorSlug = mapChannelToConnectorSlug(selectedChannel);
    const matchingInstallations = installedConnectors.filter((installation) => installation.slug === connectorSlug);
    const requestedInstallationId = String(query.installationId ?? "").trim();
    const selectedInstallation =
      matchingInstallations.find((installation) => installation.id === requestedInstallationId) ??
      (matchingInstallations.length === 1 ? matchingInstallations[0] : null);
    const selectedInstallationId = selectedInstallation?.id ?? "";
    const definition = definitionForConnector(connectorDefinitions, connectorSlug);
    const taxonomyQ = String(query.taxonomyQ ?? "").trim();
    const [mapping, preflight, readiness, categoryAttributes, shopifyConfig] = await Promise.all([
      getMarketplaceChannelMapping(selectedChannel, selectedCategoryId || undefined, undefined, { role: actorRole, authHeader }),
      selectedCategoryId ? evaluateConnectorMappingPreflight(connectorSlug, { categoryScope: selectedCategoryId, installationId: selectedInstallationId || undefined, fallbackAcknowledged }, { role: actorRole, authHeader }) : Promise.resolve(null),
      selectedCategoryId ? evaluateConnectorPublishReadiness(connectorSlug, { categoryScope: selectedCategoryId, installationId: selectedInstallationId || undefined, productId: selectedProductId || undefined, fallbackAcknowledged }, { role: actorRole, authHeader }) : Promise.resolve(null),
      selectedCategoryId ? getCategoryAttributes(selectedCategoryId, { role: actorRole, authHeader }) : Promise.resolve([]),
      connectorSlug === "shopify" && selectedInstallationId
        ? getShopifyConfig(selectedInstallationId, { role: actorRole, authHeader }).catch(() => null as ShopifyStoreConfig | null)
        : Promise.resolve(null as ShopifyStoreConfig | null),
    ]);
    const [versions, resolved, taxonomyMatches, unmappedCategories, selectedProduct, sampleProductsRaw] = await Promise.all([
      showHistory
        ? getConnectorMappingVersions(connectorSlug, { categoryScope: selectedCategoryId || undefined, includeArchived: true }, { role: actorRole, authHeader })
        : Promise.resolve([]),
      showResolved && selectedCategoryId
        ? resolveConnectorMapping(connectorSlug, selectedCategoryId, { role: actorRole, authHeader })
        : Promise.resolve(null),
      showTaxonomy
        ? searchConnectorTaxonomy(connectorSlug, { q: taxonomyQ || undefined, limit: 25 }, { role: actorRole, authHeader })
        : Promise.resolve([]),
      showTaxonomy
        ? getUnmappedConnectorTaxonomy(connectorSlug, { role: actorRole, authHeader })
        : Promise.resolve([]),
      selectedProductId
        ? getProduct(selectedProductId, { role: actorRole, authHeader }).catch((error: unknown) => {
            if (error instanceof ApiHttpError && error.status === 404) {
              return null;
            }
            throw error;
          })
        : Promise.resolve(null),
      selectedProductId ? Promise.resolve([]) : getProducts({ role: actorRole, authHeader }).catch(() => []),
    ]);
    const sampleProducts = filterTestData(sampleProductsRaw, true);
    const categorySampleProduct =
      sampleProducts.find((product) => product.categoryId === selectedCategoryId) ?? null;
    const previewProduct = selectedProduct ?? categorySampleProduct;
    const sampleProductLabel = previewProduct
      ? `${previewProduct.title}${previewProduct.brand ? ` (${previewProduct.brand})` : ""}`
      : null;
    const sampleProductMode: "selected" | "category_sample" | "none" = selectedProduct
      ? "selected"
      : categorySampleProduct
        ? "category_sample"
        : "none";
    const viewModel = buildMappingsViewModel({
      mapping,
      resolved,
      taxonomyMatches,
      unmappedCategories,
      categoryAttributes,
      sampleProduct: previewProduct,
      selectedCategoryId,
      selectedChannel,
      selectedProductId,
      selectedInstallationId,
      fallbackAcknowledged,
      fallbackAckVersionId,
      taxonomyQ,
    });
    const selectedCategoryPath =
      categories.find((item) => item.id === selectedCategoryId)?.path ?? selectedCategoryId;
    const selectedTargetCategoryLabel =
      taxonomyMatches.find((item) => item.id === viewModel.selectedTargetCategory)?.path ??
      unmappedCategories.find((item) => item.id === viewModel.selectedTargetCategory)?.path ??
      viewModel.selectedTargetCategory;
    const mappedRequiredCount = viewModel.requiredTargetFields.filter(
      (field) => Boolean(viewModel.mappedTargetToSource[field]),
    ).length;
    const missingRequiredCount = viewModel.requiredTargetFields.length - mappedRequiredCount;
    const priorityBlockers = Array.from(
      new Set([...(preflight?.blockers ?? []), ...(readiness?.blockers ?? [])]),
    ).slice(0, 3);
    const readinessBlockers = Array.from(
      new Set([...(preflight?.blockers ?? []), ...(readiness?.blockers ?? [])]),
    );
    const readinessWarnings = Array.from(new Set(readiness?.warnings ?? []));
    const connectorAccountLabel = selectedInstallation
      ? resolveInstallationLabel(selectedInstallation)
      : matchingInstallations.length > 1
        ? "Choose connector account"
        : matchingInstallations.length === 1
          ? resolveInstallationLabel(matchingInstallations[0]!)
          : "No installed connector account";
    const connectorAccountDetail = selectedInstallation
      ? resolveInstallationContextDetail(selectedInstallation)
      : matchingInstallations.length > 1
        ? `${matchingInstallations.length} installed accounts match this connector. Choose the exact account to keep mapping context aligned.`
        : matchingInstallations.length === 0
          ? "No installed connector account is linked to this channel yet."
          : null;
    const readinessSummaryLabel = `${readinessBlockers.length} blockers | ${readinessWarnings.length} warnings`;
    const readyToPublishMessage = "Ready to publish. The current mapping path is clear for this connector account.";
    const connectorHealthHref = selectedInstallationId
      ? `/channels/connectors/${encodeURIComponent(selectedInstallationId)}?tab=overview`
      : "/channels/connectors";
    const payloadPreviewHref = selectedProductId
      ? `/products/${encodeURIComponent(selectedProductId)}?tab=channels&channel=${encodeURIComponent(selectedChannel)}`
      : selectedInstallationId
        ? `/channels/connectors/${encodeURIComponent(selectedInstallationId)}?tab=catalog#catalog-payload`
        : "/channels/connectors";

    const mappingWorkflowStep = !selectedCategoryId
      ? 0
      : (preflight?.blockers?.length ?? 0) > 0
        ? 1
        : 2;
    const mappingWorkflowSteps: WorkflowStep[] = [
      { label: "Choose scope", tone: mappingWorkflowStep > 0 ? "complete" : "current" },
      { label: "Build the draft", tone: mappingWorkflowStep > 1 ? "complete" : mappingWorkflowStep === 1 ? "current" : "pending" },
      { label: "Validate and publish", tone: mappingWorkflowStep === 2 ? "current" : "pending" },
    ];

    return (
      <div className="space-y-5">
        <PageHeader title="Mapping Workbench" description="Choose scope, build the draft, then validate and publish with clear readiness gates for each channel." breadcrumb={<>Dashboard / Channels / <span className="font-semibold text-slate-700">Mappings</span></>} actions={<Link href="/channels/connectors" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Open connector portfolio</Link>} />
        <MappingStepUpAlert message={stepUpMessage} />
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Operator flow</p>
          <WorkflowStepper steps={mappingWorkflowSteps} />
        </div>
        <MappingsFilterCard
          categories={categories}
          channels={channels}
          selectedCategoryId={selectedCategoryId}
          selectedChannel={selectedChannel}
          installations={matchingInstallations}
          selectedInstallationId={selectedInstallationId || undefined}
          taxonomyQ={taxonomyQ}
          selectedProductId={selectedProductId}
          preserveFlags={{ showContext, showTaxonomy, showResolved, showHistory }}
        />
        <MappingWorkflowHeader
          product={selectedProduct}
          productId={selectedProductId || undefined}
          channel={selectedChannel}
          categoryPath={selectedCategoryPath}
          publishCategory={selectedTargetCategoryLabel}
          connectorSlug={connectorSlug}
          connectorAccountLabel={connectorAccountLabel}
          connectorAccountDetail={connectorAccountDetail ?? undefined}
          priorityBlockers={priorityBlockers}
          requiredCount={viewModel.requiredTargetFields.length}
          mappedRequiredCount={mappedRequiredCount}
          missingRequiredCount={missingRequiredCount}
        />
        <Card className="border-slate-200 bg-white">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Publish Readiness</CardTitle>
              <p className="text-sm text-slate-600">
                {readinessSummaryLabel}
              </p>
            </div>
            <StatusChip
              label={readinessBlockers.length === 0 ? "Ready to publish" : "Attention required"}
              tone={readinessBlockers.length === 0 ? "success" : "warning"}
            />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Blocking</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{readinessBlockers.length}</p>
              <p className="mt-1 text-xs text-slate-500">
                Fix hard gates before validate and publish can clear.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Warnings</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{readinessWarnings.length}</p>
              <p className="mt-1 text-xs text-slate-500">
                Warnings do not always block publish, but they should be reviewed.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Connector account</p>
              <p className="mt-2 text-sm font-medium text-slate-900">{connectorAccountLabel}</p>
              <p className="mt-1 text-xs text-slate-500">
                {selectedInstallation
                  ? `${connectorHealthLabel(selectedInstallation.status)} account context is active for this workflow.`
                  : "Select the right connector account so readiness stays aligned with the publish lane."}
              </p>
            </div>
          </div>
          {readinessBlockers.length === 0 ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              {readyToPublishMessage}
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Resolve the blocking readiness items in the side rail before you validate and publish this mapping version.
            </div>
          )}
        </Card>
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_380px]">
          <div className="space-y-4">
            {/* mapTarget:: */}
            {/* placeholder={mappingDraftRulesDefault} */}
            <MappingEditorCard actorRole={actorRole} canWrite={canWrite} connectorSlug={connectorSlug} definitionId={definition?.id ?? connectorSlug} definitionVersion={definition?.connectorVersion ?? "1.0.0"} redirectTo={viewModel.redirectTo} selectedCategoryId={selectedCategoryId} selectedTargetCategory={viewModel.selectedTargetCategory} targetCategoryOptions={viewModel.targetCategoryOptions} taxonomyMatches={taxonomyMatches} unmappedCategories={unmappedCategories} requiredTargetFields={viewModel.requiredTargetFields} mappedTargetToSource={viewModel.mappedTargetToSource} targetFieldOptions={viewModel.targetFieldOptions} sourceFieldOptions={viewModel.sourceFieldOptions} sampleProductLabel={sampleProductLabel} sampleProductMode={sampleProductMode} taxonomyDefaults={viewModel.taxonomyDefaults} mappingDraftRulesDefault={viewModel.mappingDraftRulesDefault} fallbackPolicyDefault={viewModel.fallbackPolicyDefault} mappingTypeLabel="Mapping type" attributeMappingTitle="Attribute mapping" attributeMappingDescription="Map your PIM fields to the channel fields needed for publish." fieldInputPrefix="mapTarget::" fallbackTitle="Fallback behavior" advancedJsonTitle="Advanced JSON overrides" mappingRulesPlaceholder={viewModel.mappingDraftRulesDefault} />
            {connectorSlug === "shopify" && selectedInstallationId && shopifyConfig && shopifyConfig.collections.length > 0 ? (
              <Card id="shopify-collections">
                <CardTitle>Shopify Collection Mapping</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  {shopifyConfig.collections.length} collection{shopifyConfig.collections.length === 1 ? "" : "s"} in your Shopify store.
                  Map the current category to a collection using the Advanced JSON overrides above.
                </p>
                <div className="mt-3">
                  <DataGrid
                    columns={[
                      {
                        key: "title",
                        header: "Collection",
                        cellClassName: "font-medium text-slate-800",
                        render: (col) => col.title,
                      },
                      {
                        key: "handle",
                        header: "Handle",
                        cellClassName: "font-mono text-xs text-slate-600",
                        render: (col) => col.handle,
                      },
                      {
                        key: "id",
                        header: "Shopify GID",
                        cellClassName: "font-mono text-xs text-slate-600 max-w-[14rem] truncate",
                        mobileHide: true,
                        render: (col) => col.id,
                      },
                    ] as Column<(typeof shopifyConfig.collections)[number]>[]}
                    rows={shopifyConfig.collections.slice(0, 25)}
                    getRowKey={(col) => col.id}
                  />
                  {shopifyConfig.collections.length > 25 ? (
                    <p className="mt-2 text-xs text-slate-500">…and {shopifyConfig.collections.length - 25} more collections not shown.</p>
                  ) : null}
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  To assign a collection, add <code className="rounded bg-slate-100 px-1 font-mono">categoryCollectionMap</code> to the Advanced JSON overrides above.
                  Format: <code className="rounded bg-slate-100 px-1 font-mono">{`[{"vexaCategoryId": "...", "shopifyCollectionId": "gid://shopify/Collection/..."}]`}</code>
                </p>
              </Card>
            ) : null}
            {connectorSlug === "shopify" && selectedInstallationId ? (
              <Card id="shopify-metafields">
                <CardTitle>Shopify Metafields</CardTitle>
                {shopifyConfig ? (
                  <>
                    <p className="mt-1 text-xs text-slate-500">
                      {shopifyConfig.metafields.length} product metafield definition{shopifyConfig.metafields.length === 1 ? "" : "s"} imported ·{" "}
                      last refreshed {new Date(shopifyConfig.fetchedAt).toLocaleDateString()}
                    </p>
                    {shopifyConfig.metafields.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-600">No metafield definitions found in this Shopify store.</p>
                    ) : (
                      <div className="mt-3">
                        <DataGrid
                          columns={[
                            {
                              key: "name",
                              header: "Name",
                              cellClassName: "font-medium text-slate-800",
                              render: (mf) => mf.name,
                            },
                            {
                              key: "namespace",
                              header: "Namespace.key",
                              cellClassName: "font-mono text-xs text-slate-600",
                              render: (mf) => `${mf.namespace}.${mf.key}`,
                            },
                            {
                              key: "type",
                              header: "Type",
                              cellClassName: "text-xs text-slate-600",
                              mobileHide: true,
                              render: (mf) => mf.type,
                            },
                            {
                              key: "required",
                              header: "Required",
                              render: (mf) =>
                                mf.required ? (
                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Required</span>
                                ) : (
                                  <span className="text-xs text-slate-400">Optional</span>
                                ),
                            },
                          ] as Column<(typeof shopifyConfig.metafields)[number]>[]}
                          rows={shopifyConfig.metafields}
                          getRowKey={(mf) => mf.id}
                        />
                      </div>
                    )}
                    <p className="mt-3 text-xs text-slate-500">
                      To map metafields, add <code className="rounded bg-slate-100 px-1 font-mono">productMetafields</code> to the Advanced JSON overrides section above.
                      Format: <code className="rounded bg-slate-100 px-1 font-mono">{`{"productMetafields": [{"namespace": "custom", "key": "size", "sourceField": "attributes.size"}]}`}</code>
                    </p>
                  </>
                ) : (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Shopify config not yet imported. Import it to see metafield definitions here.{" "}
                    <Link
                      href={`/channels/connectors/${encodeURIComponent(selectedInstallationId)}/import-config`}
                      className="underline font-medium"
                    >
                      Import Shopify config →
                    </Link>
                  </div>
                )}
              </Card>
            ) : null}
            {connectorSlug === "shopify" && selectedInstallationId ? (
              <Card id="shopify-locales">
                <CardTitle>Shopify Locale Translations (Sprint 14)</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  After a successful product publish, Vexa can register translations for additional locales via Shopify's <code className="rounded bg-slate-100 px-1 font-mono">translationsRegister</code> mutation.
                  Translation failures add a warning to the submission record but do not change the submission status.
                </p>
                <p className="mt-3 text-xs text-slate-500">
                  To configure locales, add <code className="rounded bg-slate-100 px-1 font-mono">localeTranslations</code> to the Advanced JSON overrides above.
                  Format:
                </p>
                <pre className="mt-2 rounded-md bg-slate-100 px-3 py-2 text-xs font-mono text-slate-700 overflow-x-auto">{`{
  "localeTranslations": [
    {
      "locale": "fr",
      "fieldMappings": {
        "title": "Translated title in French",
        "descriptionHtml": "Translated description in French",
        "seoTitle": "French SEO title",
        "seoDescription": "French SEO description"
      }
    }
  ]
}`}</pre>
                <p className="mt-2 text-xs text-slate-500">
                  The <code className="rounded bg-slate-100 px-1 font-mono">fieldMappings</code> values are the literal translated strings.
                  Future versions will support PIM attribute field references.
                </p>
              </Card>
            ) : null}
            {showHistory ? (
              <VersionManagerCard actorRole={actorRole} canWrite={canWrite} connectorSlug={connectorSlug} versions={versions} redirectTo={viewModel.redirectTo} stepUpAction={stepUpAction} stepUpVersionId={stepUpVersionId} fallbackAcknowledged={fallbackAcknowledged} fallbackAckVersionId={fallbackAckVersionId} fallbackAckError={fallbackAckError} />
            ) : (
              <DeferredMappingPanelCard
                title="Version History"
                description="Open history only when you need version review, validation, publish, archive, or rollback."
                href={buildMappingHref(query, { showHistory: "1" })}
                actionLabel="Open history"
              />
            )}
          </div>
          <div className="space-y-4">
            {showContext ? (
              <MappingContextSummaryCard
                product={selectedProduct}
                productId={selectedProductId || undefined}
                channel={selectedChannel}
                categoryPath={selectedCategoryPath}
                publishCategory={selectedTargetCategoryLabel}
                connectorAccountLabel={connectorAccountLabel}
                connectorAccountDetail={connectorAccountDetail ?? undefined}
                compatibilityLabel={definition ? (resolved?.compatibilityState ?? "compatible") : "compatible"}
                matchedVersions={resolved?.matched?.length ?? 0}
              />
            ) : (
              <DeferredMappingPanelCard
                title="Context"
                description="Open product and scope context only when you need to inspect the blocked product or mapped category."
                href={buildMappingHref(query, { showContext: "1" })}
                actionLabel="Open context"
              />
            )}
            <PublishReadinessCard preflight={preflight} readiness={readiness} fallbackAcknowledged={fallbackAcknowledged} fallbackAckVersionId={fallbackAckVersionId} fallbackAckError={fallbackAckError} connectorAccountLabel={selectedInstallation ? resolveInstallationLabel(selectedInstallation) : null} connectorHealthLabel={selectedInstallation ? connectorHealthLabel(selectedInstallation.status) : null} connectorHealthTone={selectedInstallation ? connectorHealthTone(selectedInstallation.status) : "neutral"} connectorHealthHref={connectorHealthHref} payloadPreviewHref={payloadPreviewHref} />
            {showTaxonomy ? (
              <TaxonomyAlignmentCard connectorSlug={connectorSlug} taxonomyMatches={taxonomyMatches} unmappedCategories={unmappedCategories} />
            ) : (
              <DeferredMappingPanelCard
                title="Taxonomy Alignment"
                description="Open taxonomy alignment only when you need search results or unmapped category review."
                href={buildMappingHref(query, { showTaxonomy: "1" })}
                actionLabel="Open taxonomy"
              />
            )}
            {showResolved ? (
              <ResolvedMappingSnapshotCard mapping={mapping} connectorSlug={connectorSlug} resolved={resolved} resolvedMappingJson={viewModel.resolvedMappingJson} />
            ) : (
              <DeferredMappingPanelCard
                title="Resolved Mapping Snapshot"
                description="Open the resolved snapshot only for advanced troubleshooting and matched-version diagnostics."
                href={buildMappingHref(query, { showResolved: "1" })}
                actionLabel="Open snapshot"
              />
            )}
          </div>
        </section>
        {/* Legacy Template Compatibility (Transition Only) */}
        <LegacyTemplateCompatibilityCard />
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/channels/mappings", error));
    }
    throw error;
  }
}
