import { redirect } from "next/navigation";
import { ProductsTab } from "@/components/product/products-tab";
import { PageHeader } from "@/components/ui/page-header";
import { ApiHttpError, getCategoryTree, getInstalledConnectors, getProducts, getStats } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { filterTestData } from "@/lib/test-data-filter";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

interface CatalogProductsPageProps {
  searchParams: Promise<{
    hideTestData?: string;
    search?: string;
    view?: string;
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

function mapConnectorSlugToChannel(slugInput: string): "amazon" | "flipkart" | "meesho" | null {
  const slug = String(slugInput ?? "").trim().toLowerCase();
  if (slug === "amazon-in") {
    return "amazon";
  }
  if (slug === "flipkart" || slug === "meesho") {
    return slug;
  }
  return null;
}

export default async function CatalogProductsPage({ searchParams }: CatalogProductsPageProps) {
  const query = await searchParams;
  const hideTestData = resolveHideTestData(query.hideTestData);
  const initialView = resolveProductView(query.view);
  const initialSearch = resolveProductSearch(query.search);
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();

  try {
    const [stats, categories, products, installedConnectors] = await Promise.all([
      getStats({ role: actorRole, authHeader }),
      getCategoryTree({ all: true }, { role: actorRole, authHeader }),
      getProducts({ role: actorRole, authHeader }),
      getInstalledConnectors({ role: actorRole, authHeader }),
    ]);

    const filteredCategories = filterTestData(categories, hideTestData);
    const filteredProducts = filterTestData(products, hideTestData);
    const filteredStats = hideTestData
      ? {
          ...stats,
          categories: filteredCategories.length,
          products: filteredProducts.length,
          variants: filteredProducts.reduce((sum, product) => sum + (product.variants?.length ?? 0), 0),
        }
      : stats;
    const installedConnectorCount = installedConnectors.length;
    const firstProduct = filteredProducts[0];
    const firstActiveConnector = installedConnectors.find(
      (item) => item.status === "ACTIVE" && mapConnectorSlugToChannel(item.slug),
    );
    const firstActiveChannel = firstActiveConnector
      ? mapConnectorSlugToChannel(firstActiveConnector.slug)
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
          products={products}
          categories={categories}
          stats={filteredStats}
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
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/catalog/products", error));
    }
    throw error;
  }
}
