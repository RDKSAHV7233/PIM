import Link from "next/link";
import { redirect } from "next/navigation";
import { LegacyTemplateCompatibilityCard, MappingEditorCard, MappingStepUpAlert, PublishReadinessCard, ResolvedMappingSnapshotCard } from "@/components/channel/mapping-editor";
import { MappingContextSummaryCard, MappingWorkflowHeader } from "@/components/channel/mapping-workflow";
import { MappingsFilterCard, TaxonomyAlignmentCard } from "@/components/channel/taxonomy-search";
import { VersionManagerCard } from "@/components/channel/version-manager";
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
  getCategories,
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
  searchParams: Promise<{ categoryId?: string; channel?: MarketplaceChannel; productId?: string; stepUpAction?: "publish" | "archive" | "rollback"; stepUpError?: string; stepUpVersionId?: string; taxonomyQ?: string }>;
}

export default async function ChannelsMappingsPage({ searchParams }: ChannelsMappingsPageProps) {
  const query = await searchParams;
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const canWrite = canEditWorkspace(actorRole);
  const stepUpAction = (String(query.stepUpAction ?? "").trim() as ProtectedMappingActionKind | "") || "";
  const stepUpVersionId = String(query.stepUpVersionId ?? "").trim();
  const stepUpMessage = resolveStepUpErrorMessage(String(query.stepUpError ?? "").trim(), stepUpAction);

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
    const selectedProductPromise = selectedProductId
      ? getProduct(selectedProductId, { role: actorRole, authHeader }).catch((error: unknown) => {
          if (error instanceof ApiHttpError && error.status === 404) {
            return null;
          }
          throw error;
        })
      : Promise.resolve(null);
    const [mapping, versions, resolved, preflight, readiness, taxonomyMatches, unmappedCategories, categoryAttributes, selectedProduct] = await Promise.all([
      getMarketplaceChannelMapping(selectedChannel, selectedCategoryId || undefined, undefined, { role: actorRole, authHeader }),
      getConnectorMappingVersions(connectorSlug, { categoryScope: selectedCategoryId || undefined, includeArchived: true }, { role: actorRole, authHeader }),
      selectedCategoryId ? resolveConnectorMapping(connectorSlug, selectedCategoryId, { role: actorRole, authHeader }) : Promise.resolve(null),
      selectedCategoryId ? evaluateConnectorMappingPreflight(connectorSlug, { categoryScope: selectedCategoryId, fallbackAcknowledged: false }, { role: actorRole, authHeader }) : Promise.resolve(null),
      selectedCategoryId ? evaluateConnectorPublishReadiness(connectorSlug, { categoryScope: selectedCategoryId, productId: selectedProductId || undefined, fallbackAcknowledged: false }, { role: actorRole, authHeader }) : Promise.resolve(null),
      searchConnectorTaxonomy(connectorSlug, { q: taxonomyQ || undefined, limit: 25 }, { role: actorRole, authHeader }),
      getUnmappedConnectorTaxonomy(connectorSlug, { role: actorRole, authHeader }),
      selectedCategoryId ? getCategoryAttributes(selectedCategoryId, { role: actorRole, authHeader }) : Promise.resolve([]),
      selectedProductPromise,
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
        <PageHeader title="Mappings" description="Manage mapping lifecycle, taxonomy linkage, preflight gates, and fallback policy for channel publishing." breadcrumb={<>Dashboard / Channels / <span className="font-semibold text-slate-700">Mappings</span></>} actions={<Link href="/channels/connectors" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Open Connector Detail</Link>} />
        <MappingStepUpAlert message={stepUpMessage} />
        <MappingsFilterCard categories={categories} channels={channels} selectedCategoryId={selectedCategoryId} selectedChannel={selectedChannel} taxonomyQ={taxonomyQ} />
        <MappingWorkflowHeader
          product={selectedProduct}
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
            <VersionManagerCard actorRole={actorRole} canWrite={canWrite} connectorSlug={connectorSlug} versions={versions} redirectTo={viewModel.redirectTo} stepUpAction={stepUpAction} stepUpVersionId={stepUpVersionId} />
          </div>
          <div className="space-y-4">
            <MappingContextSummaryCard
              product={selectedProduct}
              channel={selectedChannel}
              categoryPath={selectedCategoryPath}
              publishCategory={selectedTargetCategoryLabel}
              compatibilityLabel={definition ? (resolved?.compatibilityState ?? "compatible") : "compatible"}
              matchedVersions={resolved?.matched?.length ?? 0}
            />
            <PublishReadinessCard preflight={preflight} readiness={readiness} />
            <TaxonomyAlignmentCard connectorSlug={connectorSlug} taxonomyMatches={taxonomyMatches} unmappedCategories={unmappedCategories} />
            <ResolvedMappingSnapshotCard mapping={mapping} connectorSlug={connectorSlug} resolved={resolved} resolvedMappingJson={viewModel.resolvedMappingJson} />
          </div>
        </section>
        {/* Legacy Template Compatibility (Transition Only) */}
        <LegacyTemplateCompatibilityCard />
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/channels/mappings", error.status));
    }
    throw error;
  }
}
