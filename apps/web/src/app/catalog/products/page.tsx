import { redirect } from "next/navigation";
import { ProductsTab } from "@/components/product/products-tab";
import { PageHeader } from "@/components/ui/page-header";
import {
  ApiHttpError,
  getCategoryTree,
  getInstalledConnectors,
  getProductListPage,
  getStats,
  type ApiRequestOptions,
  type CatalogStats,
  type ProductListItem,
} from "@/lib/api";
import { getAdvancedSearchProducts } from "@/lib/api/catalog";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { mapConnectorSlugToMarketplaceChannel } from "@/lib/marketplace-channels";
import { filterTestData } from "@/lib/test-data-filter";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

type SharedReadState = "available" | "restricted" | "unavailable";
type SharedReadResult<T> =
  | { state: "available"; value: T }
  | { state: "restricted" }
  | { state: "unavailable" };

interface CatalogProductsPageProps {
  searchParams: Promise<{
    hideTestData?: string;
    search?: string;
    view?: string;
    page?: string;
    limit?: string;
    // Sprint 1: faceted search params
    categoryId?: string;
    brand?: string;
    status?: string;
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

type FilteredProductWindow = {
  items: ProductListItem[];
  firstProduct: ProductListItem | null;
  totals: {
    products: number;
    variants: number;
  } | null;
};

async function loadVisibleProducts(
  page: number,
  limit: number,
  hideTestData: boolean,
  options: ApiRequestOptions,
): Promise<FilteredProductWindow> {
  const visibleProducts: ProductListItem[] = [];
  const requestedOffset = (page - 1) * limit;
  const requestLimit = Math.min(Math.max(limit, 50), 200);
  let filteredOffset = 0;
  let firstProduct: ProductListItem | null = null;
  let cursor: string | undefined;
  const totals = hideTestData
    ? {
        products: 0,
        variants: 0,
      }
    : null;

  while (true) {
    const response = await getProductListPage(
      {
        slim: true,
        limit: requestLimit,
        ...(cursor ? { cursor } : {}),
      },
      options,
    );
    const filteredBatch = filterTestData(response.items, hideTestData);

    if (!firstProduct && filteredBatch.length > 0) {
      firstProduct = filteredBatch[0];
    }

    if (totals) {
      totals.products += filteredBatch.length;
      totals.variants += filteredBatch.reduce((sum, product) => sum + (product.variantCount ?? 0), 0);
    }

    if (visibleProducts.length < limit && filteredOffset + filteredBatch.length > requestedOffset) {
      const startIndex = Math.max(0, requestedOffset - filteredOffset);
      const remaining = limit - visibleProducts.length;
      visibleProducts.push(...filteredBatch.slice(startIndex, startIndex + remaining));
    }

    filteredOffset += filteredBatch.length;

    if (!response.nextCursor) {
      break;
    }

    if (!hideTestData && visibleProducts.length >= limit && filteredOffset >= requestedOffset + limit) {
      break;
    }

    cursor = response.nextCursor;
  }

  return {
    items: visibleProducts,
    firstProduct,
    totals,
  };
}

function isCatalogProductsApiUnavailable(error: unknown): boolean {
  if (error instanceof ApiHttpError) {
    return error.status === 429 || error.status === 500 || error.status === 502 || error.status === 503 || error.status === 504;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  const cause = "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  const causeDetails =
    cause && typeof cause === "object"
      ? `${String((cause as { code?: unknown }).code ?? "")} ${String((cause as { message?: unknown }).message ?? "")}`.toLowerCase()
      : String(cause ?? "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    causeDetails.includes("econnrefused") ||
    causeDetails.includes("enotfound") ||
    causeDetails.includes("socket hang up")
  );
}

async function loadSharedRead<T>(promise: Promise<T>): Promise<SharedReadResult<T>> {
  try {
    return {
      state: "available",
      value: await promise,
    };
  } catch (error) {
    if (error instanceof ApiHttpError) {
      if (error.status === 401) {
        throw error;
      }
      if (error.status === 403) {
        return { state: "restricted" };
      }
    }
    if (isCatalogProductsApiUnavailable(error)) {
      return { state: "unavailable" };
    }
    throw error;
  }
}

export default async function CatalogProductsPage({ searchParams }: CatalogProductsPageProps) {
  const query = await searchParams;
  const hideTestData = resolveHideTestData(query.hideTestData);
  const initialView = resolveProductView(query.view);
  const initialSearch = resolveProductSearch(query.search);
  const page = resolvePositiveInteger(query.page, 1, 10_000);
  const limit = resolvePositiveInteger(query.limit, 50, 200);
  // Sprint 1: faceted search
  const categoryId = query.categoryId?.trim() || undefined;
  const brand = query.brand?.trim() || undefined;
  const facetStatus = query.status?.trim() || undefined;
  const hasFacets = Boolean(categoryId || brand || facetStatus);
  const { authHeader, actorRole } = await getServerSession();

  try {
    const [statsResult, categoriesResult, productWindowResult, installedConnectorsResult] = await Promise.all([
      loadSharedRead(getStats({ role: actorRole, authHeader })),
      loadSharedRead(getCategoryTree({ all: true }, { role: actorRole, authHeader, revalidateSeconds: 60 })),
      // Sprint 1: use advanced-search endpoint when any facet is active
      loadSharedRead(
        hasFacets
          ? getAdvancedSearchProducts(
              { q: initialSearch || undefined, categoryId, brand, status: facetStatus, limit },
              { role: actorRole, authHeader },
            ).then((res) => ({
              items: res.items as ProductListItem[],
              firstProduct: res.items[0] as ProductListItem | null,
              totals: null,
            }))
          : loadVisibleProducts(page, limit, hideTestData, { role: actorRole, authHeader }),
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
            totals: null,
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
              products: productWindow.totals?.products ?? statsResult.value.products,
              variants: productWindow.totals?.variants ?? statsResult.value.variants,
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

    return (
      <div className="space-y-5">
        <PageHeader
          title="Products"
          description="Daily catalog workspace for triage, fixes, and publish readiness."
          breadcrumb={
            <>
              Dashboard / Catalog / <span className="font-semibold text-slate-700">Products</span>
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
          initialView={initialView}
          initialSearch={initialSearch}
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
