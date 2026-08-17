import Link from "next/link";
import { redirect } from "next/navigation";
import { ProductsTab } from "@/components/product/products-tab";
import { PageHeader } from "@/components/ui/page-header";
import {
  ApiHttpError,
  getCategoryTree,
  getInstalledConnectors,
  getStats,
  type MarketplaceChannel,
  type ProductListItem,
} from "@/lib/api";
import { getAdvancedSearchProducts } from "@/lib/api/catalog";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { resolveBulkPublishStatusMessage } from "@/lib/bulk-publish-status";
import { loadSharedRead } from "@/lib/catalog-shared-read";
import {
  isChannelInDevelopment,
  mapConnectorSlugToMarketplaceChannel,
} from "@/lib/marketplace-channels";
import { filterTestData } from "@/lib/test-data-filter";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

interface CatalogProductsPageProps {
  searchParams: Promise<{
    hideTestData?: string;
    search?: string;
    view?: string;
    limit?: string;
    create?: string;
    page?: string;
    // Sprint 1: faceted search params
    categoryId?: string;
    brand?: string;
    status?: string;
    // PIM#596: bulk-publish redirect outcome. triggerBulkPublishAction (actions.ts) writes
    // this under its own dedicated query key — not `status` — specifically so it can never
    // collide with the product-status facet filter above. Both keys can be read as plain,
    // independent values with no special-casing needed.
    bulkPublishStatus?: string;
    queuedCount?: string;
    excludedCount?: string;
    ceiling?: string;
    submittedCount?: string;
  }>;
}

function resolveHideTestData(value: string | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "off") {
    return false;
  }
  return true;
}

function resolveProductView(value: string | undefined): "all" | "needs_attention" | "ready" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "needs_attention" || normalized === "ready") {
    return normalized;
  }
  return "all";
}

function resolveProductSearch(value: string | undefined): string {
  return String(value ?? "").trim().slice(0, 80);
}

function resolvePositiveInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(max, parsed);
}

export default async function CatalogProductsPage({ searchParams }: CatalogProductsPageProps) {
  const query = await searchParams;
  const hideTestData = resolveHideTestData(query.hideTestData);
  const initialView = resolveProductView(query.view);
  const initialSearch = resolveProductSearch(query.search);
  const initialCreate = query.create === "1";
  const limit = resolvePositiveInteger(query.limit, 50, 200);
  const currentPage = Math.max(1, resolvePositiveInteger(query.page, 1, 10000));
  const offset = (currentPage - 1) * limit;
  // Sprint 1: faceted search
  const categoryId = query.categoryId?.trim() || undefined;
  const brand = query.brand?.trim() || undefined;
  const facetStatus = query.status?.trim() || undefined;
  // PIM#596: bulk-publish redirect outcome now lives under its own query key (see the
  // searchParams comment above), so it's read independently of the facet filter above —
  // no more prefix-matching special-case needed.
  const bulkPublishStatusMessage = resolveBulkPublishStatusMessage(query.bulkPublishStatus, {
    queuedCount: query.queuedCount,
    excludedCount: query.excludedCount,
    ceiling: query.ceiling,
    submittedCount: query.submittedCount,
  });
  const { authHeader, actorRole } = await getServerSession();

  try {
    const [statsResult, categoriesResult, productWindowResult, installedConnectorsResult] = await Promise.all([
      loadSharedRead(getStats({ role: actorRole, authHeader })),
      loadSharedRead(getCategoryTree({ all: true }, { role: actorRole, authHeader, revalidateSeconds: 60 })),
      loadSharedRead(
        getAdvancedSearchProducts(
          { q: initialSearch || undefined, categoryId, brand, status: facetStatus, offset, limit },
          { role: actorRole, authHeader },
        ).then((res) => ({
          items: res.items as ProductListItem[],
          firstProduct: (res.items[0] as ProductListItem) ?? null,
          totalCount: res.totalCount,
        })),
      ),
      loadSharedRead(getInstalledConnectors({ role: actorRole, authHeader })),
    ]);

    const categories = categoriesResult.state === "available" ? categoriesResult.value : [];
    const productWindow =
      productWindowResult.state === "available"
        ? productWindowResult.value
        : {
            items: [],
            firstProduct: null,
            totalCount: null as number | null,
          };
    const filteredCategories = filterTestData(categories, hideTestData);
    const filteredStats =
      statsResult.state === "available"
        ? hideTestData
          ? {
              ...statsResult.value,
              categories:
                categoriesResult.state === "available"
                  ? filteredCategories.length
                  : statsResult.value.categories,
            }
          : statsResult.value
        : null;
    const installedConnectors =
      installedConnectorsResult.state === "available" ? installedConnectorsResult.value : [];
    const installedConnectorCount =
      installedConnectorsResult.state === "available" ? installedConnectors.length : null;
    const firstProduct = productWindow.firstProduct;
    const firstActiveConnector = installedConnectors.find(
      (item) => item.status === "ACTIVE" && mapConnectorSlugToMarketplaceChannel(item.slug),
    );
    const firstActiveChannel = firstActiveConnector
      ? mapConnectorSlugToMarketplaceChannel(firstActiveConnector.slug)
      : null;
    const mappingManagerHref =
      firstProduct && firstActiveChannel
        ? `/channels/mappings?channel=${encodeURIComponent(firstActiveChannel)}&categoryId=${encodeURIComponent(firstProduct.categoryId)}&productId=${encodeURIComponent(firstProduct.id)}`
        : null;
    // PIM#595: connectors the Products workbench's manual bulk-publish selector can target —
    // active installations with the PUBLISH capability, mapped to a supported marketplace
    // channel, and not gated as still-in-development. Mirrors the eligibility a bulk-publish
    // batch would need anyway; the backend independently re-validates every product regardless.
    const publishConnectors = installedConnectors
      .filter((item) => item.status === "ACTIVE" && item.capabilities.includes("PUBLISH"))
      .map((item) => ({
        id: item.id,
        slug: item.slug,
        displayName: item.displayName,
        channel: mapConnectorSlugToMarketplaceChannel(item.slug),
        // Mirrors installation.capabilities.includes("BULK_PUBLISH") on the connector Sync tab —
        // used client-side only to pick which soft-warning ceiling to show (see
        // BULK_PUBLISH_SOFT_WARNING_CEILING in products-tab.tsx), never to gate submission.
        hasNativeBulkPublish: item.capabilities.includes("BULK_PUBLISH"),
      }))
      .filter(
        (
          item,
        ): item is {
          id: string;
          slug: string;
          displayName: string;
          channel: MarketplaceChannel;
          hasNativeBulkPublish: boolean;
        } => item.channel !== null && !isChannelInDevelopment(item.channel),
      );

    return (
      <div className="space-y-5">
        <PageHeader
          title="Products"
          description="Daily catalog workspace for triage, fixes, and publish readiness."
          breadcrumb={
            <>
              <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}<Link href="/catalog/products" className="hover:underline">Catalog</Link>{" / "}<span className="font-semibold text-slate-700">Products</span>
            </>
          }
        />
        <ProductsTab
          role={actorRole}
          products={productWindow.items}
          categories={categories}
          stats={filteredStats}
          productFeedState={productWindowResult.state}
          categoryFeedState={categoriesResult.state}
          statsFeedState={statsResult.state}
          connectorFeedState={installedConnectorsResult.state}
          hideTestData={hideTestData}
          installedConnectorCount={installedConnectorCount}
          mappingManagerHref={mappingManagerHref}
          connectorManagementHref="/channels/connectors"
          publishConnectors={publishConnectors}
          bulkPublishStatusMessage={bulkPublishStatusMessage}
          initialView={initialView}
          initialSearch={initialSearch}
          initialCreate={initialCreate}
          totalCount={productWindow.totalCount}
          currentPage={currentPage}
          pageSize={limit}
        />
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && error.status === 401) {
      redirect(buildLoginRedirect("/catalog/products", error));
    }
    throw error;
  }
}
