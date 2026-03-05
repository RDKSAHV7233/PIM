"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ProductChannelReadinessCell } from "@/components/channel/product-channel-readiness-cell";
import { CreateProductForm } from "@/components/product/CreateProductForm";
import { EmptyState } from "@/components/ui/empty-state";
import { usePlanUsage } from "@/hooks/use-plan-usage";
import type { AppRole, CatalogStats, Category, Product } from "@/lib/api";
import type { ReadinessStatus } from "@/lib/channel-readiness";
import { filterTestData } from "@/lib/test-data-filter";

type ProductFilter = "all" | "errors";
type TriageBucket = "needs_attention" | "at_risk" | "ready";

interface ProductWithCompliance extends Product {
  complianceErrorCount: number;
  complianceWarningCount: number;
}

interface ProductsTabProps {
  role: AppRole;
  products: Product[];
  categories: Category[];
  stats: CatalogStats;
  hideTestData: boolean;
  installedConnectorCount: number;
  mappingManagerHref: string | null;
  connectorManagementHref: string;
}

function classifyProduct(product: ProductWithCompliance, channelStatus: ReadinessStatus): TriageBucket {
  if (product.complianceErrorCount > 0 || channelStatus === "errors") {
    return "needs_attention";
  }
  if (
    product.complianceWarningCount > 0 ||
    channelStatus === "warnings" ||
    channelStatus === "unknown" ||
    channelStatus === "loading"
  ) {
    return "at_risk";
  }
  return "ready";
}

function sortProducts(
  left: ProductWithCompliance,
  right: ProductWithCompliance,
  readinessMap: Record<string, ReadinessStatus>,
) {
  const leftBucket = classifyProduct(left, readinessMap[left.id] ?? "loading");
  const rightBucket = classifyProduct(right, readinessMap[right.id] ?? "loading");
  const bucketWeight: Record<TriageBucket, number> = {
    needs_attention: 0,
    at_risk: 1,
    ready: 2,
  };

  if (bucketWeight[leftBucket] !== bucketWeight[rightBucket]) {
    return bucketWeight[leftBucket] - bucketWeight[rightBucket];
  }
  if (left.complianceErrorCount !== right.complianceErrorCount) {
    return right.complianceErrorCount - left.complianceErrorCount;
  }
  if (left.complianceWarningCount !== right.complianceWarningCount) {
    return right.complianceWarningCount - left.complianceWarningCount;
  }
  const leftCompleteness = left.completenessScore ?? 0;
  const rightCompleteness = right.completenessScore ?? 0;
  if (leftCompleteness !== rightCompleteness) {
    return rightCompleteness - leftCompleteness;
  }
  return left.title.localeCompare(right.title);
}

export function ProductsTab({
  role,
  products,
  categories,
  stats,
  hideTestData,
  installedConnectorCount,
  mappingManagerHref,
  connectorManagementHref,
}: ProductsTabProps) {
  const canWrite = role !== "viewer";
  const { skuUsagePercent } = usePlanUsage(role);
  const [selectedFilter, setSelectedFilter] = useState<ProductFilter>("all");
  const [showCreateProduct, setShowCreateProduct] = useState(false);
  const [readinessMap, setReadinessMap] = useState<Record<string, ReadinessStatus>>({});
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const filteredCategories = useMemo(() => filterTestData(categories, hideTestData), [categories, hideTestData]);

  const filteredProducts = useMemo(() => {
    const cleaned = filterTestData(products, hideTestData);
    return cleaned.map((product) => ({
      ...product,
      complianceErrorCount: (product.validationIssues ?? []).filter((issue) => issue.severity === "error").length,
      complianceWarningCount: (product.validationIssues ?? []).filter((issue) => issue.severity === "warning").length,
    }));
  }, [hideTestData, products]);

  const statusesLoaded = useMemo(
    () =>
      filteredProducts.every((product) => {
        const status = readinessMap[product.id];
        return status !== undefined && status !== "loading";
      }),
    [filteredProducts, readinessMap],
  );

  const triageCounts = useMemo(() => {
    if (!statusesLoaded) {
      return { needsAttention: 0, atRisk: 0, ready: 0 };
    }
    return filteredProducts.reduce(
      (accumulator, product) => {
        const bucket = classifyProduct(product, readinessMap[product.id] ?? "unknown");
        if (bucket === "needs_attention") {
          accumulator.needsAttention += 1;
        } else if (bucket === "at_risk") {
          accumulator.atRisk += 1;
        } else {
          accumulator.ready += 1;
        }
        return accumulator;
      },
      { needsAttention: 0, atRisk: 0, ready: 0 },
    );
  }, [filteredProducts, readinessMap, statusesLoaded]);

  const sortedProducts = useMemo(() => {
    return filteredProducts.slice().sort((left, right) => sortProducts(left, right, readinessMap));
  }, [filteredProducts, readinessMap]);

  const visibleProducts = useMemo(() => {
    if (selectedFilter !== "errors") {
      return sortedProducts;
    }
    return sortedProducts.filter(
      (product) => classifyProduct(product, readinessMap[product.id] ?? "loading") === "needs_attention",
    );
  }, [readinessMap, selectedFilter, sortedProducts]);

  const onboardingSteps = useMemo(() => {
    const hasProducts = filteredProducts.length > 0;
    const hasCompleteness = filteredProducts.some((product) => typeof product.completenessScore === "number");
    const hasIssueResolved = filteredProducts.some((product) => product.complianceErrorCount === 0);
    const hasConnector = installedConnectorCount > 0;
    return [
      { key: "import", label: "Import your first catalog", done: hasProducts },
      { key: "completeness", label: "Review completeness score", done: hasCompleteness },
      { key: "issue", label: "Fix your first issue", done: hasIssueResolved },
      { key: "connector", label: "Connect a channel", done: hasConnector },
    ];
  }, [filteredProducts, installedConnectorCount]);
  const completedSteps = onboardingSteps.filter((step) => step.done).length;

  function onHideTestDataChange(nextValue: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextValue) {
      params.delete("hideTestData");
    } else {
      params.set("hideTestData", "false");
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="space-y-4">
      <section className="sticky top-16 z-20 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-700">
            {statusesLoaded ? (
              <>
                Needs Attention: <strong>{triageCounts.needsAttention}</strong> | At Risk:{" "}
                <strong>{triageCounts.atRisk}</strong> | Ready: <strong>{triageCounts.ready}</strong>
              </>
            ) : (
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-20 animate-pulse rounded bg-slate-200" />
                <span className="h-4 w-16 animate-pulse rounded bg-slate-200" />
                <span className="h-4 w-16 animate-pulse rounded bg-slate-200" />
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={`/quality/issues${hideTestData ? "" : "?hideTestData=false"}`}
              className="text-xs font-semibold text-slate-600 underline"
            >
              Open Issue Inbox
            </Link>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={hideTestData}
                onChange={(event) => onHideTestDataChange(event.target.checked)}
                className="rounded border-slate-300"
              />
              Hide test data
            </label>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Categories: {stats.categories} | Products: {stats.products} | Variants: {stats.variants}
        </p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Getting Started</h2>
          <div className="flex items-center gap-3">
            <Link href={connectorManagementHref} className="text-xs font-semibold text-slate-600 underline">
              Manage Connectors
            </Link>
            {mappingManagerHref ? (
              <Link href={mappingManagerHref} className="text-xs font-semibold text-slate-600 underline">
                Open Mapping Manager
              </Link>
            ) : null}
            <span className="text-xs text-slate-500">
              {completedSteps}/{onboardingSteps.length} completed
            </span>
          </div>
        </div>
        <ul className="mt-3 grid gap-2 text-sm">
          {onboardingSteps.map((step) => (
            <li key={step.key} className="flex items-center gap-2">
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold ${
                  step.done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                }`}
              >
                {step.done ? "OK" : "..."}
              </span>
              <span className={step.done ? "text-slate-700" : "text-slate-500"}>{step.label}</span>
            </li>
          ))}
        </ul>
      </section>

      {statusesLoaded && triageCounts.needsAttention > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <span className="text-sm font-semibold text-red-700">
            {triageCounts.needsAttention} products need fixing before they can be published
          </span>
          {selectedFilter === "errors" ? (
            <button
              type="button"
              className="text-sm font-medium text-red-700 underline"
              onClick={() => setSelectedFilter("all")}
            >
              Show all products
            </button>
          ) : (
            <button
              type="button"
              className="text-sm font-medium text-red-700 underline"
              onClick={() => setSelectedFilter("errors")}
            >
              Show only these
            </button>
          )}
        </div>
      )}

      <section className="space-y-3">
        {canWrite ? (
          <div className="flex items-center gap-2">
            <Button type="button" onClick={() => setShowCreateProduct((value) => !value)}>
              {showCreateProduct ? "Close new product form" : "+ New Product"}
            </Button>
            {skuUsagePercent !== null && skuUsagePercent >= 80 && (
              <a
                href="/settings/plan"
                className={`rounded-full px-2 py-1 text-xs font-semibold ${
                  skuUsagePercent >= 100
                    ? "border border-red-200 bg-red-50 text-red-700"
                    : "border border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                {skuUsagePercent >= 100 ? "Limit reached" : "Nearing limit"} ({skuUsagePercent}%)
              </a>
            )}
          </div>
        ) : null}

        {showCreateProduct && canWrite ? (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <CreateProductForm
              role={role}
              categories={filteredCategories}
              onCreated={() => setShowCreateProduct(false)}
            />
          </section>
        ) : null}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Products</h2>
        {filteredProducts.length === 0 ? (
          <EmptyState
            icon="BOX"
            title="Your catalog is empty"
            description="Import your existing catalog from Excel, or create your first product manually."
            action={{ label: "Import from Excel", href: "?tab=import" }}
            secondaryAction={{
              label: "Create product manually",
              onClick: () => setShowCreateProduct(true),
            }}
          />
        ) : visibleProducts.length === 0 ? (
          <EmptyState
            icon="SEARCH"
            title="No products match your search"
            description="Try clearing some filters, or check if the SKU code is correct."
            action={{ label: "Clear all filters", onClick: () => setSelectedFilter("all") }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">Title</th>
                  <th className="py-2">Brand</th>
                  <th className="py-2">HSN</th>
                  <th className="py-2">GST %</th>
                  <th className="py-2">Category</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Complete %</th>
                  <th className="py-2">Variants</th>
                  <th
                    className="py-2"
                    title="Checks for GST/HSN format and required compliance fields. Does not include channel-specific requirements - see Channel Readiness."
                  >
                    Compliance Issues <span aria-hidden="true">ⓘ</span>
                  </th>
                  <th className="py-2">Channel Readiness</th>
                </tr>
              </thead>
              <tbody>
                {visibleProducts.map((product) => (
                  <tr key={product.id} className="border-t border-border">
                    <td className="py-2">
                      <Link href={`/products/${product.id}`}>{product.title}</Link>
                    </td>
                    <td className="py-2">{product.brand || "-"}</td>
                    <td className="py-2">{product.hsnCode || "-"}</td>
                    <td className="py-2">{product.gstRate ?? "-"}</td>
                    <td className="py-2">{product.category?.path ?? product.categoryId}</td>
                    <td className="py-2">{product.status}</td>
                    <td className="py-2">{product.completenessScore ?? 0}%</td>
                    <td className="py-2">{product.variants?.length ?? 0}</td>
                    <td className="py-2">
                      {product.complianceErrorCount > 0
                        ? `${product.complianceErrorCount} error(s)`
                        : product.complianceWarningCount > 0
                          ? `${product.complianceWarningCount} warning(s)`
                          : "No issues"}
                    </td>
                    <td className="py-2">
                      <ProductChannelReadinessCell
                        productId={product.id}
                        role={role}
                        onResolvedStatus={(status) =>
                          setReadinessMap((previous) => {
                            if (previous[product.id] === status) {
                              return previous;
                            }
                            return { ...previous, [product.id]: status };
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}



