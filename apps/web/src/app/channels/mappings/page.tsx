import Link from "next/link";
import { redirect } from "next/navigation";
import {
  LegacyTemplateCompatibilityCard,
  MappingEditorCard,
  MappingStepUpAlert,
  PublishReadinessCard,
  ResolvedMappingSnapshotCard,
} from "@/components/channel/mapping-editor";
import { MappingDirtyNavigationGuard } from "@/components/channel/mapping-dirty-navigation-guard";
import { MappingsFilterCard, TaxonomyAlignmentCard } from "@/components/channel/taxonomy-search";
import { VersionManagerCard } from "@/components/channel/version-manager";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { WorkflowStepper, type WorkflowStep } from "@/components/ui/workflow-stepper";
import {
  ApiHttpError,
  getProductListPage,
  getInstalledConnectors,
  getProduct,
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
import {
  buildMappingRoute,
  buildMappingsViewModel,
  definitionForConnector,
  describeMappingSource,
  mapChannelToConnectorSlug,
  parseMappingWizardState,
  resolveRequestedWizardStep,
  resolveStepUpErrorMessage,
  type ConnectorTaxonomyOption,
  type MappingAdvancedPanel,
  type MappingWizardQueryState,
  type MappingWizardState,
  type MappingWizardStep,
  type ProtectedMappingActionKind,
} from "@/lib/channel-mappings";
import { connectorHealthLabel, connectorHealthTone, resolveInstallationContextDetail, resolveInstallationLabel } from "@/lib/connector-utils";
import { canManageChannels } from "@/lib/role-capabilities";
import { filterTestData } from "@/lib/test-data-filter";
import { getServerSession } from "@/lib/server-session";
import { formatDate } from "@/lib/format";
import { isWorkingDraftValidated, selectWorkingDraft, workingDraftFieldMap } from "@/lib/mapping-working-draft";
import { buildSelectedPublishCategoryOption } from "@/lib/mapping-publish-category";
import { classifyMappingLoadFailure, describeMappingAccessDenied } from "@/lib/mapping-access";

export const dynamic = "force-dynamic";

export const metadata = { title: "Channel Mapping | Vexa PIM" };

interface ChannelsMappingsPageProps {
  searchParams: Promise<MappingWizardQueryState>;
}


function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stepTone(currentStep: MappingWizardStep, step: MappingWizardStep): WorkflowStep["tone"] {
  const order: MappingWizardStep[] = ["scope", "map", "review"];
  const currentIndex = order.indexOf(currentStep);
  const stepIndex = order.indexOf(step);
  if (stepIndex < currentIndex) {
    return "complete";
  }
  if (stepIndex === currentIndex) {
    return "current";
  }
  return "pending";
}

function ScopeSummaryCard({
  channel,
  categoryPath,
  publishCategoryLabel,
  connectorAccountLabel,
  productLabel,
  changeScopeHref,
  changeMappingHref,
  currentStep,
}: {
  channel: string;
  categoryPath: string;
  publishCategoryLabel: string;
  connectorAccountLabel: string;
  productLabel?: string | null;
  changeScopeHref: string;
  changeMappingHref?: string;
  currentStep: MappingWizardStep;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Current Scope</CardTitle>
          <p className="mt-2 text-sm text-slate-600">
            The wizard stays focused on one publish lane at a time. Change scope only when you want to restart the mapping flow for a different channel or category.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-700">Channel: {channel || "Not selected"}</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-700">Category: {categoryPath || "Not selected"}</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-700">Publish category: {publishCategoryLabel || "Not selected"}</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-700">Connector account: {connectorAccountLabel || "Not selected"}</span>
            {productLabel ? (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-700">Product context: {productLabel}</span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={changeScopeHref}
            data-mapping-nav={currentStep !== "scope" ? "true" : undefined}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Change scope
          </Link>
          {changeMappingHref ? (
            <Link
              href={changeMappingHref}
              data-mapping-nav={currentStep === "review" ? "true" : undefined}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Back to mapping
            </Link>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

const CHECKLIST_GUIDANCE: Record<string, string> = {
  "Channel selected": "Go back to Step 1 and select a channel.",
  "Connector account selected": "Go back to Step 1 and choose a connector account.",
  "Publish category selected": "Go back to Step 1 and select a publish category.",
  "Required fields mapped": "Go back to Step 2 and map all required fields in the draft, then save.",
  "Draft validated": "Validate your newest draft (the most recently saved version) using the version manager below.",
  "Readiness passed": "Validate and publish the mapping draft, then resolve any blockers shown below.",
  "Fallback acknowledged if needed": "Acknowledge fallback usage in the readiness section below.",
  "Active version impact shown": "No published version exists yet. Validate and publish your first draft.",
};

function PublishChecklistCard({
  channelSelected,
  connectorAccountSelected,
  publishCategorySelected,
  requiredMappingsReady,
  draftValidated,
  readinessPassed,
  fallbackSatisfied,
  activeVersionShown,
}: {
  channelSelected: boolean;
  connectorAccountSelected: boolean;
  publishCategorySelected: boolean;
  requiredMappingsReady: boolean;
  draftValidated: boolean;
  readinessPassed: boolean;
  fallbackSatisfied: boolean;
  activeVersionShown: boolean;
}) {
  const checks = [
    ["Channel selected", channelSelected],
    ["Connector account selected", connectorAccountSelected],
    ["Publish category selected", publishCategorySelected],
    ["Required fields mapped", requiredMappingsReady],
    ["Draft validated", draftValidated],
    ["Readiness passed", readinessPassed],
    ["Fallback acknowledged if needed", fallbackSatisfied],
    ["Active version impact shown", activeVersionShown],
  ] as const;

  return (
    <Card>
      <CardTitle>Step 3: Review, Validate & Publish</CardTitle>
      <p className="mt-2 text-sm text-slate-600">
        Use this final step to confirm that the draft is valid, the publish lane is clear, and the promoted version impact is visible before you make it live.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {checks.map(([label, ok]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-700">{label}</span>
              <StatusChip label={ok ? "Pass" : "Blocked"} tone={ok ? "success" : "warning"} />
            </div>
            {!ok && CHECKLIST_GUIDANCE[label] ? (
              <p className="mt-1.5 text-xs text-slate-500">{CHECKLIST_GUIDANCE[label]}</p>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

function AdvancedDrawer({
  open,
  advancedPanel,
  fallbackPolicyDefault,
  selectedTargetCategory,
  connectorSlug,
  mapping,
  resolved,
  resolvedMappingJson,
  connectorDetail,
  shopifyConfig,
  selectedInstallationId,
}: {
  open: boolean;
  advancedPanel: MappingAdvancedPanel | "";
  fallbackPolicyDefault: string;
  selectedTargetCategory: string;
  connectorSlug: string;
  mapping: import("@/lib/api").MarketplaceChannelMapping;
  resolved: import("@/lib/api").ConnectorMappingResolved | null;
  resolvedMappingJson: string;
  connectorDetail: string | null;
  shopifyConfig: ShopifyStoreConfig | null;
  selectedInstallationId: string;
}) {
  return (
    <details className="rounded-lg border border-slate-200 bg-white" open={open}>
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-900">
        Advanced tools
      </summary>
      <div className="space-y-4 border-t border-slate-200 p-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          Advanced controls are available for compatibility, fallback behavior, resolved mapping inspection, JSON overrides, and connector-specific diagnostics. These tools are intentionally outside the primary authoring flow.
        </div>
        <details open={advancedPanel === "resolved"} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <summary className="cursor-pointer py-1.5 text-sm font-medium text-slate-900">Resolved mapping snapshot</summary>
          <div className="mt-3">
            <ResolvedMappingSnapshotCard
              mapping={mapping}
              connectorSlug={connectorSlug}
              resolved={resolved}
              resolvedMappingJson={resolvedMappingJson}
            />
          </div>
        </details>
        <details open={advancedPanel === "fallback"} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <summary className="cursor-pointer py-1.5 text-sm font-medium text-slate-900">Fallback and compatibility defaults</summary>
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            <p>Selected publish category: {selectedTargetCategory || "Not selected"}</p>
            <pre className="overflow-x-auto rounded-md bg-slate-900 px-3 py-2 text-xs text-slate-100">{fallbackPolicyDefault}</pre>
          </div>
        </details>
        {shopifyConfig && selectedInstallationId ? (
          <details open={advancedPanel === "diagnostics"} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <summary className="cursor-pointer py-1.5 text-sm font-medium text-slate-900">Shopify diagnostics</summary>
            <div className="mt-3 space-y-4">
              {shopifyConfig.collections.length > 0 ? (
                <Card id="shopify-collections">
                  <CardTitle>Shopify Collection Mapping</CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    {shopifyConfig.collections.length} collection{shopifyConfig.collections.length === 1 ? "" : "s"} in your Shopify store.
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
                  </div>
                </Card>
              ) : null}
              <Card id="shopify-metafields">
                <CardTitle>Shopify Metafields</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  {shopifyConfig.metafields.length} product metafield definition{shopifyConfig.metafields.length === 1 ? "" : "s"} imported · last refreshed {formatDate(shopifyConfig.fetchedAt)}
                </p>
                {shopifyConfig.metafields.length > 0 ? (
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
                      ] as Column<(typeof shopifyConfig.metafields)[number]>[]}
                      rows={shopifyConfig.metafields}
                      getRowKey={(mf) => mf.id}
                    />
                  </div>
                ) : null}
              </Card>
            </div>
          </details>
        ) : null}
        <details open={advancedPanel === "json"} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <summary className="cursor-pointer py-1.5 text-sm font-medium text-slate-900">JSON and legacy diagnostics</summary>
          <div className="mt-3 space-y-4">
            <LegacyTemplateCompatibilityCard />
            {connectorDetail ? (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">
                Connector context: {connectorDetail}
              </div>
            ) : null}
          </div>
        </details>
      </div>
    </details>
  );
}

export default async function ChannelsMappingsPage({ searchParams }: ChannelsMappingsPageProps) {
  const query = await searchParams;
  const wizardQuery = parseMappingWizardState(query);
  const { authHeader, actorRole } = await getServerSession();
  const canWrite = canManageChannels(actorRole);
  const stepUpAction = (wizardQuery.stepUpAction as ProtectedMappingActionKind | "") || "";
  const stepUpVersionId = wizardQuery.stepUpVersionId;
  const stepUpMessage = resolveStepUpErrorMessage(wizardQuery.stepUpError, stepUpAction);

  try {
    const [channels, categoriesRaw, connectorDefinitions, installedConnectors] = await Promise.all([
      getMarketplaceChannels({ role: actorRole, authHeader }),
      getCategoryTree({ all: true }, { role: actorRole, authHeader, revalidateSeconds: 60 }),
      getConnectorDefinitions({ role: actorRole, authHeader, revalidateSeconds: 60 }),
      getInstalledConnectors({ role: actorRole, authHeader }),
    ]);

    const categories = filterTestData(categoriesRaw, true);
    const selectedChannelRecord = channels.find((item) => item.channel === wizardQuery.channel) ?? null;
    const selectedChannel = selectedChannelRecord?.channel ?? "";
    const invalidChannel =
      wizardQuery.channel && !selectedChannelRecord
        ? `Channel "${wizardQuery.channel}" is not available anymore. Choose a supported channel to continue.`
        : "";
    const selectedCategoryRecord = categories.find((item) => item.id === wizardQuery.categoryId) ?? null;
    const selectedCategoryId = selectedCategoryRecord?.id ?? "";
    const invalidCategory =
      wizardQuery.categoryId && !selectedCategoryRecord
        ? `Category "${wizardQuery.categoryId}" could not be found. Choose a source category to continue.`
        : "";

    const connectorSlug = selectedChannel ? mapChannelToConnectorSlug(selectedChannel as MarketplaceChannel) : "";
    const matchingInstallations = connectorSlug
      ? installedConnectors.filter((installation) => installation.slug === connectorSlug)
      : [];
    const requestedInstallationId = wizardQuery.installationId;
    const selectedInstallation =
      matchingInstallations.find((installation) => installation.id === requestedInstallationId) ??
      (!requestedInstallationId && matchingInstallations.length === 1 ? matchingInstallations[0] : null);
    const invalidInstallation =
      requestedInstallationId && !matchingInstallations.some((installation) => installation.id === requestedInstallationId)
        ? "The selected connector account is no longer valid for this channel. Choose the correct connector account to continue."
        : "";
    const selectedInstallationId = selectedInstallation?.id ?? "";

    let selectedProduct: import("@/lib/api").Product | null = null;
    let productWarning = "";
    if (wizardQuery.productId) {
      try {
        selectedProduct = await getProduct(wizardQuery.productId, { role: actorRole, authHeader });
      } catch (error: unknown) {
        if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
          throw error;
        }
        if (error instanceof ApiHttpError && error.status === 404) {
          productWarning = `Product context ${wizardQuery.productId} could not be loaded. The wizard will continue without product-specific sample values.`;
        } else {
          productWarning = `Product context ${wizardQuery.productId} could not be loaded. The wizard will continue without product-specific sample values.`;
        }
      }
    }
    const selectedProductId = selectedProduct?.id ?? "";

    const hasBaseScope = Boolean(selectedChannel && selectedCategoryId);
    const shouldFetchTaxonomy = Boolean(hasBaseScope && (wizardQuery.step === "scope" || wizardQuery.taxonomyQ || wizardQuery.publishCategoryId));
    const shouldFetchVersions = Boolean(hasBaseScope && (wizardQuery.step === "map" || wizardQuery.step === "review" || stepUpAction || stepUpVersionId || wizardQuery.fallbackAckVersionId));
    const shouldFetchReview = Boolean(hasBaseScope && (wizardQuery.step === "review" || stepUpAction || stepUpVersionId));
    const shouldFetchAdvancedShopify = Boolean(connectorSlug === "shopify" && selectedInstallationId && wizardQuery.showAdvanced);

    const [
      mapping,
      categoryAttributes,
      resolved,
      taxonomyMatchesRaw,
      unmappedCategoriesRaw,
      versions,
      preflight,
      readiness,
      shopifyConfig,
      sampleProductsRaw,
    ] = hasBaseScope
      ? await Promise.all([
          getMarketplaceChannelMapping(selectedChannel as MarketplaceChannel, selectedCategoryId, undefined, selectedInstallationId || undefined, { role: actorRole, authHeader }),
          getCategoryAttributes(selectedCategoryId, { role: actorRole, authHeader, revalidateSeconds: 60 }),
          resolveConnectorMapping(connectorSlug, selectedCategoryId, selectedInstallationId || undefined, { role: actorRole, authHeader }),
          shouldFetchTaxonomy
            ? searchConnectorTaxonomy(connectorSlug, { q: wizardQuery.taxonomyQ || undefined, limit: 25 }, { role: actorRole, authHeader })
            : Promise.resolve([]),
          shouldFetchTaxonomy
            ? getUnmappedConnectorTaxonomy(connectorSlug, { role: actorRole, authHeader })
            : Promise.resolve([]),
          shouldFetchVersions
            ? getConnectorMappingVersions(connectorSlug, { categoryScope: selectedCategoryId, installationId: selectedInstallationId || undefined, includeArchived: true }, { role: actorRole, authHeader })
            : Promise.resolve([]),
          shouldFetchReview
            ? evaluateConnectorMappingPreflight(
                connectorSlug,
                {
                  categoryScope: selectedCategoryId,
                  installationId: selectedInstallationId || undefined,
                  fallbackAcknowledged: wizardQuery.fallbackAcknowledged,
                },
                { role: actorRole, authHeader },
              )
            : Promise.resolve(null),
          shouldFetchReview
            ? evaluateConnectorPublishReadiness(
                connectorSlug,
                {
                  categoryScope: selectedCategoryId,
                  installationId: selectedInstallationId || undefined,
                  productId: selectedProductId || undefined,
                  fallbackAcknowledged: wizardQuery.fallbackAcknowledged,
                },
                { role: actorRole, authHeader },
              )
            : Promise.resolve(null),
          shouldFetchAdvancedShopify
            ? getShopifyConfig(selectedInstallationId, { role: actorRole, authHeader }).catch(() => null as ShopifyStoreConfig | null)
            : Promise.resolve(null as ShopifyStoreConfig | null),
          selectedProductId ? Promise.resolve([]) : getProductListPage({ slim: true, limit: 200 }, { role: actorRole, authHeader }).then((page) => page.items).catch(() => []),
        ])
      : [null, [], null, [], [], [], null, null, null, []];
    // The source-category picker already hides test fixtures; do the same for the publish-category lists.
    const taxonomyMatches = filterTestData(taxonomyMatchesRaw, true);
    const unmappedCategories = filterTestData(unmappedCategoriesRaw, true);
    const sampleProducts = filterTestData(sampleProductsRaw, true);
    const categorySampleProduct =
      hasBaseScope
        ? ((sampleProducts.find((product) => product.categoryId === selectedCategoryId) ?? null) as import("@/lib/api").Product | null)
        : null;
    const previewProduct = selectedProduct ?? categorySampleProduct;
    const sampleProductLabel = previewProduct
      ? `${previewProduct.title}${previewProduct.brand ? ` (${previewProduct.brand})` : ""}`
      : null;
    const sampleProductMode: "selected" | "category_sample" | "none" = selectedProduct
      ? "selected"
      : categorySampleProduct
        ? "category_sample"
        : "none";

    const resolvedCategoryTarget = resolved?.resolvedMapping && typeof resolved.resolvedMapping === "object"
      ? String(asRecord(asRecord(resolved.resolvedMapping).category).target ?? "").trim()
      : "";
    const selectedPublishCategoryId = wizardQuery.publishCategoryId || resolvedCategoryTarget;
    // The search results are capped and filtered, so the selected category (often the resolver's
    // default target) may not be in them; fall back to the category tree before printing a raw id.
    const selectedPublishCategoryFallback = buildSelectedPublishCategoryOption(
      selectedPublishCategoryId,
      taxonomyMatches,
      unmappedCategories,
      categories,
    );
    const selectedPublishCategoryLabel =
      taxonomyMatches.find((item) => item.id === selectedPublishCategoryId)?.path ??
      unmappedCategories.find((item) => item.id === selectedPublishCategoryId)?.path ??
      selectedPublishCategoryFallback?.path ??
      selectedPublishCategoryId;

    const hasPublishCategory = Boolean(selectedPublishCategoryId);
    const hasDraftContext = versions.length > 0 || Boolean(stepUpVersionId);
    const currentStep = resolveRequestedWizardStep(wizardQuery.step, {
      hasBaseScope,
      hasPublishCategory,
      hasDraftContext,
    });
    // MappingsFilterCard already surfaces invalidInstallation inline on the scope step,
    // so this alert only needs to carry it forward once the operator moves past scope.
    const invalidInstallationAlert =
      invalidInstallation && currentStep !== "scope"
        ? { title: "Connector account no longer valid", description: invalidInstallation }
        : null;
    // resolveRequestedWizardStep silently sends the operator to an earlier step when the
    // requested one isn't reachable yet (e.g. a bookmarked ?step=review link before a draft
    // exists). Without this, the URL says "review" while the page shows "Map Required
    // Fields" with no explanation of why.
    const stepDowngradeAlert =
      wizardQuery.step && wizardQuery.step !== currentStep
        ? !hasBaseScope
          ? { title: "Choose a channel and category first", description: "A channel and source category are required before this mapping can be opened." }
          : !hasPublishCategory
            ? { title: "Choose a publish category first", description: "Select a publish category on the Scope step before mapping or reviewing this connector." }
            : { title: "Save a draft before reviewing", description: "No draft or published mapping version exists yet for this scope. Map the required fields and save a draft first." }
        : null;

    const baseWizardState: Partial<MappingWizardState> = {
      step: currentStep,
      channel: selectedChannel,
      categoryId: selectedCategoryId,
      installationId: selectedInstallationId,
      productId: selectedProductId,
      publishCategoryId: selectedPublishCategoryId,
      taxonomyQ: wizardQuery.taxonomyQ,
      fallbackAcknowledged: wizardQuery.fallbackAcknowledged,
      fallbackAckVersionId: wizardQuery.fallbackAckVersionId,
      fallbackAckError: wizardQuery.fallbackAckError,
      showAdvanced: wizardQuery.showAdvanced,
      advancedPanel: wizardQuery.advancedPanel,
      showAllVersions: wizardQuery.showAllVersions,
      stepUpAction,
      stepUpError: wizardQuery.stepUpError,
      stepUpVersionId,
    };

    const selectedCategoryPath = selectedCategoryRecord?.path ?? "";
    const connectorAccountLabel = selectedInstallation
      ? resolveInstallationLabel(selectedInstallation)
      : matchingInstallations.length > 1
        ? "Choose connector account"
        : invalidInstallation
          ? "Connector account not selected"
          : matchingInstallations.length === 1
            ? resolveInstallationLabel(matchingInstallations[0]!)
            : "No installed connector account";
    const connectorAccountDetail = selectedInstallation
      ? resolveInstallationContextDetail(selectedInstallation)
      : matchingInstallations.length > 1
        ? `${matchingInstallations.length} installed accounts match this connector. Choose the exact account to keep mapping context aligned.`
        : invalidInstallation
          ? "The requested connector account is no longer valid for this channel. Choose a valid connector account to continue."
          : matchingInstallations.length === 0
            ? "No installed connector account is linked to this channel yet."
            : null;

    const scopeComplete = Boolean(
      selectedChannel &&
      selectedCategoryId &&
      selectedPublishCategoryId &&
      (matchingInstallations.length === 0 || selectedInstallationId),
    );
    const continueToMapHref = scopeComplete ? buildMappingRoute({ ...baseWizardState, step: "map" }) : "";
    const changeScopeHref = buildMappingRoute({ ...baseWizardState, step: "scope" });
    const changeMappingHref = buildMappingRoute({ ...baseWizardState, step: "map" });

    const mappingWorkflowSteps: WorkflowStep[] = [
      { label: "Choose Channel & Category", tone: stepTone(currentStep, "scope") },
      { label: "Map Required Fields", tone: stepTone(currentStep, "map") },
      { label: "Review, Validate & Publish", tone: stepTone(currentStep, "review") },
    ];

    const definition = connectorSlug ? definitionForConnector(connectorDefinitions, connectorSlug) : null;
    // Step 2 resumes the operator's latest saved, unpublished draft rather than
    // re-seeding from the live/default map (which made saved work show as "Missing").
    const workingDraft = selectWorkingDraft(versions);

    const viewModel =
      hasBaseScope && mapping
        ? buildMappingsViewModel({
            mapping,
            resolved,
            taxonomyMatches,
            unmappedCategories: unmappedCategories as ConnectorTaxonomyOption[],
            categoryAttributes,
            sampleProduct: previewProduct,
            selectedCategoryId,
            selectedChannel: selectedChannel as MarketplaceChannel,
            selectedProductId,
            selectedInstallationId,
            selectedPublishCategoryId,
            fallbackAcknowledged: wizardQuery.fallbackAcknowledged,
            fallbackAckVersionId: wizardQuery.fallbackAckVersionId,
            taxonomyQ: wizardQuery.taxonomyQ,
            step: "review",
            showAdvanced: wizardQuery.showAdvanced,
            advancedPanel: wizardQuery.advancedPanel,
            shopifyMetafields: connectorSlug === "shopify" ? (shopifyConfig?.metafields ?? []) : [],
            draftFieldMap: workingDraftFieldMap(workingDraft),
          })
        : null;

    const mappedRequiredCount = viewModel
      ? viewModel.requiredTargetFields.filter(
          (field) => Boolean(viewModel.mappedTargetToSource[field]) || Boolean(viewModel.requiredCoveredBySource[field]),
        ).length
      : 0;
    const requiredMappingsReady = viewModel ? mappedRequiredCount === viewModel.requiredTargetFields.length : false;
    const activeVersionShown = versions.some((version) => version.lifecycleState === "published");
    const draftValidated = isWorkingDraftValidated(versions);
    const readinessPassed = Boolean((preflight?.ok ?? false) && (readiness?.ok ?? false));
    const fallbackSatisfied = !preflight?.fallbackAckRequired && !readiness?.blockers.includes("fallback_ack_required")
      ? true
      : wizardQuery.fallbackAcknowledged;
    const connectorHealthHref = selectedInstallationId
      ? `/channels/connectors/${encodeURIComponent(selectedInstallationId)}?tab=overview`
      : "/channels/connectors";
    const payloadPreviewHref = selectedProductId
      ? `/products/${encodeURIComponent(selectedProductId)}?tab=channels&channel=${encodeURIComponent(selectedChannel)}`
      : selectedInstallationId
        ? `/channels/connectors/${encodeURIComponent(selectedInstallationId)}?tab=catalog#catalog-payload`
        : "/channels/connectors";

    return (
      <div className="space-y-5">
        <PageHeader
          title="Channel Mapping"
          description="Choose the publish lane, map the required fields, then validate and publish one live mapping version."
          breadcrumb={
            <>
              <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}<Link href="/channels" className="hover:underline">Channels</Link>{" / "}<span className="font-semibold text-slate-700">Mappings</span>
            </>
          }
          actions={
            <Link
              href="/channels/connectors"
              className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Open connector portfolio
            </Link>
          }
        />
        <MappingStepUpAlert message={stepUpMessage} />
        <MappingStepUpAlert message={invalidInstallationAlert} />
        <MappingStepUpAlert message={stepDowngradeAlert} />
        <MappingDirtyNavigationGuard />
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Operator flow</p>
          <WorkflowStepper steps={mappingWorkflowSteps} />
        </div>

        {currentStep === "scope" ? (
          <>
            <MappingsFilterCard
              categories={categories}
              channels={channels}
              selectedCategoryId={selectedCategoryId}
              selectedChannel={selectedChannel}
              installations={matchingInstallations}
              selectedInstallationId={selectedInstallationId || undefined}
              taxonomyQ={wizardQuery.taxonomyQ}
              selectedProductId={selectedProductId || undefined}
              selectedProductLabel={sampleProductLabel}
              selectedPublishCategoryId={selectedPublishCategoryId}
              selectedPublishCategoryLabel={selectedPublishCategoryLabel}
              selectedCategoryPath={selectedCategoryPath}
              baseState={baseWizardState}
              invalidChannel={invalidChannel}
              invalidCategory={invalidCategory}
              invalidInstallation={invalidInstallation}
              productWarning={productWarning}
              continueHref={continueToMapHref || undefined}
            />
            {selectedChannel ? (
              <TaxonomyAlignmentCard
                channelLabel={selectedChannelRecord?.displayName ?? selectedChannel}
                taxonomyMatches={taxonomyMatches as ConnectorTaxonomyOption[]}
                unmappedCategories={unmappedCategories as ConnectorTaxonomyOption[]}
                selectedPublishCategoryId={selectedPublishCategoryId}
                baseState={baseWizardState}
              />
            ) : null}
            {viewModel && selectedPublishCategoryId ? (
              <Card>
                <CardTitle>Required fields preview</CardTitle>
                <p className="mt-2 text-sm text-slate-600">
                  This publish category currently requires {viewModel.requiredTargetFields.length} mapped field{viewModel.requiredTargetFields.length === 1 ? "" : "s"} before the draft can move cleanly into review.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {viewModel.requiredTargetFields.slice(0, 12).map((field) => (
                    <span key={field} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
                      {field}
                    </span>
                  ))}
                </div>
              </Card>
            ) : null}
          </>
        ) : null}

        {currentStep === "map" && viewModel ? (
          <section className="space-y-4">
            <ScopeSummaryCard
              channel={selectedChannel}
              categoryPath={selectedCategoryPath}
              publishCategoryLabel={selectedPublishCategoryLabel}
              connectorAccountLabel={connectorAccountLabel}
              productLabel={sampleProductLabel}
              changeScopeHref={changeScopeHref}
              currentStep={currentStep}
            />
            {resolved ? (() => {
              const source = describeMappingSource(resolved);
              return (
                <Card>
                  <div className="flex items-center gap-2">
                    <StatusChip label={source.label} tone={source.tone} />
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{source.description}</p>
                </Card>
              );
            })() : null}
            {workingDraft ? (
              <Card>
                <div className="flex items-center gap-2">
                  <StatusChip label="Resuming draft" tone="info" />
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Showing the draft saved {formatDate(workingDraft.createdAt)}
                  {workingDraft.createdBy ? ` by ${workingDraft.createdBy}` : ""}. Saving again creates a new draft version from these values; the live mapping is unchanged until a version is published.
                </p>
              </Card>
            ) : null}
            <MappingEditorCard
              actorRole={actorRole}
              canWrite={canWrite}
              redirectTo={viewModel.redirectTo}
              selectedCategoryId={selectedCategoryId}
              selectedTargetCategory={viewModel.selectedTargetCategory}
              fallbackPolicyDefault={viewModel.fallbackPolicyDefault}
              connector={{
                slug: connectorSlug,
                definitionId: definition?.id ?? connectorSlug,
                definitionVersion: definition?.connectorVersion ?? "1.0.0",
              }}
              taxonomy={{
                matches: (selectedPublishCategoryFallback ? [selectedPublishCategoryFallback, ...taxonomyMatches] : taxonomyMatches) as ConnectorTaxonomyOption[],
                unmapped: unmappedCategories as ConnectorTaxonomyOption[],
                defaults: viewModel.taxonomyDefaults,
                categoryOptions: viewModel.targetCategoryOptions,
              }}
              fieldMapping={{
                required: viewModel.requiredTargetFields,
                mappedToSource: viewModel.mappedTargetToSource,
                coveredBySource: viewModel.requiredCoveredBySource,
                options: viewModel.targetFieldOptions,
              }}
              sampleProduct={{
                label: sampleProductLabel,
                mode: sampleProductMode,
                fieldOptions: viewModel.sourceFieldOptions,
              }}
              labels={{
                mappingType: "Mapping scope",
                attributeMapping: "Required mapping groups",
                attributeMappingDescription: "Map the required channel fields first. Work through the missing required channel fields by group while optional fields and advanced controls stay out of the way until you need them.",
                fieldInputPrefix: "mapTarget::",
                advancedJson: "Advanced JSON overrides",
                mappingRulesPlaceholder: viewModel.mappingDraftRulesDefault,
              }}
              installationId={selectedInstallationId || undefined}
            />
            <AdvancedDrawer
              open={wizardQuery.showAdvanced}
              advancedPanel={wizardQuery.advancedPanel}
              fallbackPolicyDefault={viewModel.fallbackPolicyDefault}
              selectedTargetCategory={viewModel.selectedTargetCategory}
              connectorSlug={connectorSlug}
              mapping={mapping!}
              resolved={resolved}
              resolvedMappingJson={viewModel.resolvedMappingJson}
              connectorDetail={connectorAccountDetail}
              shopifyConfig={shopifyConfig}
              selectedInstallationId={selectedInstallationId}
            />
          </section>
        ) : null}

        {currentStep === "review" && viewModel ? (
          <section className="space-y-4">
            <ScopeSummaryCard
              channel={selectedChannel}
              categoryPath={selectedCategoryPath}
              publishCategoryLabel={selectedPublishCategoryLabel}
              connectorAccountLabel={connectorAccountLabel}
              productLabel={sampleProductLabel}
              changeScopeHref={changeScopeHref}
              changeMappingHref={changeMappingHref}
              currentStep={currentStep}
            />
            <PublishChecklistCard
              channelSelected={Boolean(selectedChannel)}
              connectorAccountSelected={matchingInstallations.length === 0 || Boolean(selectedInstallationId)}
              publishCategorySelected={Boolean(selectedPublishCategoryId)}
              requiredMappingsReady={requiredMappingsReady}
              draftValidated={draftValidated}
              readinessPassed={readinessPassed}
              fallbackSatisfied={fallbackSatisfied}
              activeVersionShown={activeVersionShown}
            />
            <PublishReadinessCard
              preflight={preflight}
              readiness={readiness}
              fallbackAcknowledged={wizardQuery.fallbackAcknowledged}
              fallbackAckVersionId={wizardQuery.fallbackAckVersionId}
              fallbackAckError={wizardQuery.fallbackAckError}
              connectorAccountLabel={selectedInstallation ? resolveInstallationLabel(selectedInstallation) : null}
              connectorHealthLabel={selectedInstallation ? connectorHealthLabel(selectedInstallation.status) : null}
              connectorHealthTone={selectedInstallation ? connectorHealthTone(selectedInstallation.status) : "neutral"}
              connectorHealthHref={connectorHealthHref}
              payloadPreviewHref={payloadPreviewHref}
            />
            <VersionManagerCard
              actorRole={actorRole}
              canWrite={canWrite}
              connectorSlug={connectorSlug}
              installationId={selectedInstallationId || undefined}
              categoryScopeLabel={selectedCategoryPath ? { id: selectedCategoryId, label: selectedCategoryPath } : undefined}
              showAllVersions={wizardQuery.showAllVersions}
              allVersionsHref={buildMappingRoute({ ...baseWizardState, step: "review", showAllVersions: true })}
              versions={versions}
              redirectTo={viewModel.redirectTo}
              stepUpAction={stepUpAction}
              stepUpVersionId={stepUpVersionId}
              fallbackAcknowledged={wizardQuery.fallbackAcknowledged}
              fallbackAckVersionId={wizardQuery.fallbackAckVersionId}
              fallbackAckError={wizardQuery.fallbackAckError}
            />
            <AdvancedDrawer
              open={wizardQuery.showAdvanced}
              advancedPanel={wizardQuery.advancedPanel}
              fallbackPolicyDefault={viewModel.fallbackPolicyDefault}
              selectedTargetCategory={viewModel.selectedTargetCategory}
              connectorSlug={connectorSlug}
              mapping={mapping!}
              resolved={resolved}
              resolvedMappingJson={viewModel.resolvedMappingJson}
              connectorDetail={connectorAccountDetail}
              shopifyConfig={shopifyConfig}
              selectedInstallationId={selectedInstallationId}
            />
          </section>
        ) : null}
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError) {
      const failure = classifyMappingLoadFailure(error);
      if (failure === "sign_in") {
        redirect(buildLoginRedirect("/channels/mappings", error));
      }
      if (failure === "access_denied") {
        const denied = describeMappingAccessDenied(actorRole, error.body);
        return (
          <div className="space-y-4">
            <PageHeader
              title="Channel Mapping"
              breadcrumb={
                <>
                  <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}<Link href="/channels" className="hover:underline">Channels</Link>{" / "}<span className="font-semibold text-slate-700">Mappings</span>
                </>
              }
            />
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">{denied.title}</p>
              <p className="mt-1">{denied.body}</p>
              <Link href="/channels" className="mt-2 inline-block py-1 font-medium underline">Back to Channels</Link>
            </div>
          </div>
        );
      }
    }
    throw error;
  }
}
