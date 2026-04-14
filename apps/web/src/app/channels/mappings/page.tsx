import Link from "next/link";
import { redirect } from "next/navigation";
import { LegacyTemplateCompatibilityCard, MappingEditorCard, MappingStepUpAlert, PublishReadinessCard, ResolvedMappingSnapshotCard } from "@/components/channel/mapping-editor";
import { MappingContextSummaryCard, MappingWorkflowHeader } from "@/components/channel/mapping-workflow";
import { MappingsFilterCard, TaxonomyAlignmentCard } from "@/components/channel/taxonomy-search";
import { VersionManagerCard } from "@/components/channel/version-manager";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  ApiHttpError,
  getProduct,
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
import { buildLoginRedirect } from "@/lib/auth-redirect";
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
    productId?: string;
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
    Record<"showContext" | "showTaxonomy" | "showResolved" | "showHistory" | "taxonomyQ" | "categoryId" | "channel" | "productId", string | undefined>
  >,
): string {
  const params = new URLSearchParams();
  const nextQuery = {
    categoryId: String(query.categoryId ?? "").trim(),
    channel: String(query.channel ?? "").trim(),
    productId: String(query.productId ?? "").trim(),
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

  try {
    const [channels, categoriesRaw, connectorDefinitions] = await Promise.all([
      getMarketplaceChannels({ role: actorRole, authHeader }),
      getCategoryTree({ all: true }, { role: actorRole, authHeader }),
      getConnectorDefinitions({ role: actorRole, authHeader }),
    ]);
    const categories = filterTestData(categoriesRaw, true);
    const selectedCategoryId = String(query.categoryId ?? "").trim() || categories[0]?.id || "";
    const selectedChannel = normalizeChannel(query.channel, channels);
    const connectorSlug = mapChannelToConnectorSlug(selectedChannel);
    const definition = definitionForConnector(connectorDefinitions, connectorSlug);
    const taxonomyQ = String(query.taxonomyQ ?? "").trim();
    const [mapping, preflight, readiness, categoryAttributes] = await Promise.all([
      getMarketplaceChannelMapping(selectedChannel, selectedCategoryId || undefined, undefined, { role: actorRole, authHeader }),
      selectedCategoryId ? evaluateConnectorMappingPreflight(connectorSlug, { categoryScope: selectedCategoryId, fallbackAcknowledged: false }, { role: actorRole, authHeader }) : Promise.resolve(null),
      selectedCategoryId ? evaluateConnectorPublishReadiness(connectorSlug, { categoryScope: selectedCategoryId, productId: selectedProductId || undefined, fallbackAcknowledged: false }, { role: actorRole, authHeader }) : Promise.resolve(null),
      selectedCategoryId ? getCategoryAttributes(selectedCategoryId, { role: actorRole, authHeader }) : Promise.resolve([]),
    ]);
    const [versions, resolved, taxonomyMatches, unmappedCategories, selectedProduct] = await Promise.all([
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
      showContext && selectedProductId
        ? getProduct(selectedProductId, { role: actorRole, authHeader }).catch((error: unknown) => {
            if (error instanceof ApiHttpError && error.status === 404) {
              return null;
            }
            throw error;
          })
        : Promise.resolve(null),
    ]);
    const viewModel = buildMappingsViewModel({ mapping, resolved, taxonomyMatches, unmappedCategories, categoryAttributes, selectedCategoryId, selectedChannel, selectedProductId, taxonomyQ });
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

    return (
      <div className="space-y-5">
        <PageHeader title="Mapping Workbench" description="Choose scope, build the draft, then validate and publish with clear readiness gates for each channel." breadcrumb={<>Dashboard / Channels / <span className="font-semibold text-slate-700">Mappings</span></>} actions={<Link href="/channels/connectors" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Open connector portfolio</Link>} />
        <MappingStepUpAlert message={stepUpMessage} />
        <section id="mapping-scope" className="grid gap-3 lg:grid-cols-3">
          <Card className="border-slate-200 bg-slate-50/80">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Step 1</p>
            <div className="mt-3">
              <CardTitle>Choose scope</CardTitle>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              Anchor the workbench to the right channel, category, and optional product before editing the draft.
            </p>
          </Card>
          <Card className="border-slate-200 bg-slate-50/80">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Step 2</p>
            <div className="mt-3">
              <CardTitle>Build the draft</CardTitle>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              Map required fields first, then add optional coverage and fallback behavior only where it helps.
            </p>
          </Card>
          <Card className="border-slate-200 bg-slate-50/80">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Step 3</p>
            <div className="mt-3">
              <CardTitle>Validate and publish</CardTitle>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              Use version history and readiness gates to promote only validated mappings into live channel operations.
            </p>
          </Card>
        </section>
        <MappingsFilterCard
          categories={categories}
          channels={channels}
          selectedCategoryId={selectedCategoryId}
          selectedChannel={selectedChannel}
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
          requiredCount={viewModel.requiredTargetFields.length}
          mappedRequiredCount={mappedRequiredCount}
          missingRequiredCount={missingRequiredCount}
        />
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_380px]">
          <div className="space-y-4">
            {/* mapTarget:: */}
            {/* placeholder={mappingDraftRulesDefault} */}
            <MappingEditorCard actorRole={actorRole} canWrite={canWrite} connectorSlug={connectorSlug} definitionId={definition?.id ?? connectorSlug} definitionVersion={definition?.connectorVersion ?? "1.0.0"} redirectTo={viewModel.redirectTo} selectedCategoryId={selectedCategoryId} selectedTargetCategory={viewModel.selectedTargetCategory} targetCategoryOptions={viewModel.targetCategoryOptions} taxonomyMatches={taxonomyMatches} unmappedCategories={unmappedCategories} requiredTargetFields={viewModel.requiredTargetFields} mappedTargetToSource={viewModel.mappedTargetToSource} targetFieldOptions={viewModel.targetFieldOptions} sourceFieldOptions={viewModel.sourceFieldOptions} taxonomyDefaults={viewModel.taxonomyDefaults} mappingDraftRulesDefault={viewModel.mappingDraftRulesDefault} fallbackPolicyDefault={viewModel.fallbackPolicyDefault} mappingTypeLabel="Mapping type" attributeMappingTitle="Attribute mapping" attributeMappingDescription="Map your PIM fields to the channel fields needed for publish." fieldInputPrefix="mapTarget::" fallbackTitle="Fallback behavior" advancedJsonTitle="Advanced JSON overrides" mappingRulesPlaceholder={viewModel.mappingDraftRulesDefault} />
            {showHistory ? (
              <VersionManagerCard actorRole={actorRole} canWrite={canWrite} connectorSlug={connectorSlug} versions={versions} redirectTo={viewModel.redirectTo} stepUpAction={stepUpAction} stepUpVersionId={stepUpVersionId} />
            ) : (
              <DeferredMappingPanelCard
                title="Version History"
                description="Draft history, validation, publish, archive, and rollback actions now load only when you need them."
                href={buildMappingHref(query, { showHistory: "1" })}
                actionLabel="Open version history"
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
                compatibilityLabel={definition ? (resolved?.compatibilityState ?? "compatible") : "compatible"}
                matchedVersions={resolved?.matched?.length ?? 0}
              />
            ) : (
              <DeferredMappingPanelCard
                title="Context"
                description="Product context and resolved compatibility load on demand when you need to inspect the blocked product or mapped category."
                href={buildMappingHref(query, { showContext: "1" })}
                actionLabel="Open product context"
              />
            )}
            <PublishReadinessCard preflight={preflight} readiness={readiness} />
            {showTaxonomy ? (
              <TaxonomyAlignmentCard connectorSlug={connectorSlug} taxonomyMatches={taxonomyMatches} unmappedCategories={unmappedCategories} />
            ) : (
              <DeferredMappingPanelCard
                title="Taxonomy Alignment"
                description="Taxonomy search results and unmapped category inventory stay deferred until you open alignment details or run a taxonomy query."
                href={buildMappingHref(query, { showTaxonomy: "1" })}
                actionLabel="Open taxonomy alignment"
              />
            )}
            {showResolved ? (
              <ResolvedMappingSnapshotCard mapping={mapping} connectorSlug={connectorSlug} resolved={resolved} resolvedMappingJson={viewModel.resolvedMappingJson} />
            ) : (
              <DeferredMappingPanelCard
                title="Resolved Mapping Snapshot"
                description="Resolved mapping JSON and matched-version diagnostics load only when you need advanced troubleshooting."
                href={buildMappingHref(query, { showResolved: "1" })}
                actionLabel="Review resolved snapshot"
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
