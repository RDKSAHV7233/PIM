"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { deleteProductAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { ProductChannelReadinessCell } from "@/components/channel/product-channel-readiness-cell";
import { CreateProductForm } from "@/components/product/CreateProductForm";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusChip } from "@/components/ui/status-chip";
import { usePlanUsage } from "@/hooks/use-plan-usage";
import type { AppRole, CatalogStats, Category, MarketplaceChannel, Product } from "@/lib/api";
import {
  aggregateReadinessStatus,
  buildLoadingReadiness,
  buildUnknownReadiness,
  READINESS_CHANNELS,
  type ChannelReadinessResult,
  type ProductReadinessBatchResponse,
  type ReadinessStatus,
} from "@/lib/channel-readiness";
import { canEditWorkspace } from "@/lib/role-capabilities";
import { filterTestData } from "@/lib/test-data-filter";

type ProductFilter = "all" | "needs_attention" | "ready";
type TriageBucket = "needs_attention" | "at_risk" | "ready";

interface ProductWithCompliance extends Product {
  complianceErrorCount: number;
  complianceWarningCount: number;
}

type ProductReadinessState = Record<string, Partial<Record<MarketplaceChannel, ChannelReadinessResult>>>;

interface ProductsTabProps {
  role: AppRole;
  products: Product[];
  categories: Category[];
  stats: CatalogStats;
  hideTestData: boolean;
  installedConnectorCount: number;
  mappingManagerHref: string | null;
  connectorManagementHref: string;
  initialView?: ProductFilter;
  initialSearch?: string;
}

function formatUpdatedAt(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "-";
  }
  return timestamp.toLocaleString();
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

function productStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "active") {
    return "success";
  }
  if (normalized === "draft") {
    return "warning";
  }
  if (normalized === "archived") {
    return "neutral";
  }
  return "info";
}

function complianceLabel(product: ProductWithCompliance): string {
  if (product.complianceErrorCount > 0) {
    return `${product.complianceErrorCount} error(s)`;
  }
  if (product.complianceWarningCount > 0) {
    return `${product.complianceWarningCount} warning(s)`;
  }
  return "No issues";
}

function complianceTone(product: ProductWithCompliance): "neutral" | "success" | "warning" | "danger" | "info" {
  if (product.complianceErrorCount > 0) {
    return "danger";
  }
  if (product.complianceWarningCount > 0) {
    return "warning";
  }
  return "success";
}

function matchesProductSearch(product: ProductWithCompliance, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (product.title.toLowerCase().includes(normalized)) {
    return true;
  }

  return (product.variants ?? []).some((variant) => variant.skuCode.toLowerCase().includes(normalized));
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
  initialView = "all",
  initialSearch = "",
}: ProductsTabProps) {
  const canWrite = canEditWorkspace(role);
  const { skuUsagePercent } = usePlanUsage(role);
  const [selectedFilter, setSelectedFilter] = useState<ProductFilter>(initialView);
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [showCreateProduct, setShowCreateProduct] = useState(false);
  const [readinessState, setReadinessState] = useState<ProductReadinessState>({});
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = useMemo(() => {
    const params =
      typeof window === "undefined"
        ? new URLSearchParams(searchParams.toString())
        : new URLSearchParams(window.location.search);
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  useEffect(() => {
    setSelectedFilter(initialView);
  }, [initialView]);

  useEffect(() => {
    setSearchQuery(initialSearch);
  }, [initialSearch]);

  const filteredCategories = useMemo(() => filterTestData(categories, hideTestData), [categories, hideTestData]);

  const filteredProducts = useMemo(() => {
    const cleaned = filterTestData(products, hideTestData);
    return cleaned.map((product) => ({
      ...product,
      complianceErrorCount: (product.validationIssues ?? []).filter((issue) => issue.severity === "error").length,
      complianceWarningCount: (product.validationIssues ?? []).filter((issue) => issue.severity === "warning").length,
    }));
  }, [hideTestData, products]);

  const searchedProducts = useMemo(() => {
    return filteredProducts.filter((product) => matchesProductSearch(product, searchQuery));
  }, [filteredProducts, searchQuery]);

  useEffect(() => {
    const productIds = searchedProducts.map((product) => product.id);
    if (productIds.length === 0) {
      setReadinessState({});
      return;
    }

    const controller = new AbortController();
    const loadingState = Object.fromEntries(
      productIds.map((productId) => [
        productId,
        Object.fromEntries(
          READINESS_CHANNELS.map((channel) => [channel, buildLoadingReadiness(channel)]),
        ),
      ]),
    ) as ProductReadinessState;

    setReadinessState(loadingState);

    async function loadReadinessBatch() {
      try {
        const response = await fetch("/api/marketplace/readiness/batch", {
          method: "POST",
          cache: "no-store",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            productIds,
            channels: READINESS_CHANNELS,
          }),
        });
        if (!response.ok) {
          throw new Error("readiness batch request failed");
        }

        const payload = (await response.json()) as ProductReadinessBatchResponse;
        if (controller.signal.aborted) {
          return;
        }

        const nextState = Object.fromEntries(
          productIds.map((productId) => [
            productId,
            Object.fromEntries(
              READINESS_CHANNELS.map((channel) => [channel, buildUnknownReadiness(channel)]),
            ),
          ]),
        ) as ProductReadinessState;

        for (const item of payload.items ?? []) {
          nextState[item.productId] = Object.fromEntries(
            READINESS_CHANNELS.map((channel) => {
              const result =
                item.readiness.find((candidate) => candidate.channel === channel) ??
                buildUnknownReadiness(channel);
              return [channel, result];
            }),
          ) as Partial<Record<MarketplaceChannel, ChannelReadinessResult>>;
        }

        setReadinessState(nextState);
      } catch {
        if (controller.signal.aborted) {
          return;
        }
        const fallbackState = Object.fromEntries(
          productIds.map((productId) => [
            productId,
            Object.fromEntries(
              READINESS_CHANNELS.map((channel) => [channel, buildUnknownReadiness(channel)]),
            ),
          ]),
        ) as ProductReadinessState;
        setReadinessState(fallbackState);
      }
    }

    void loadReadinessBatch();
    return () => controller.abort();
  }, [role, searchedProducts]);

  const readinessMap = useMemo(() => {
    return Object.fromEntries(
      searchedProducts.map((product) => [
        product.id,
        aggregateReadinessStatus(READINESS_CHANNELS.map((channel) => readinessState[product.id]?.[channel])),
      ]),
    ) as Record<string, ReadinessStatus>;
  }, [readinessState, searchedProducts]);

  const statusesLoaded = useMemo(
    () =>
      searchedProducts.every((product) => {
        const status = readinessMap[product.id];
        return status !== undefined && status !== "loading";
      }),
    [readinessMap, searchedProducts],
  );

  const triageCounts = useMemo(() => {
    if (!statusesLoaded) {
      return { needsAttention: 0, atRisk: 0, ready: 0 };
    }
    return searchedProducts.reduce(
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
  }, [readinessMap, searchedProducts, statusesLoaded]);

  const sortedProducts = useMemo(() => {
    return searchedProducts.slice().sort((left, right) => sortProducts(left, right, readinessMap));
  }, [readinessMap, searchedProducts]);

  const visibleProducts = useMemo(() => {
    if (selectedFilter === "all") {
      return sortedProducts;
    }
    if (selectedFilter === "needs_attention") {
      return sortedProducts.filter(
        (product) => classifyProduct(product, readinessMap[product.id] ?? "loading") === "needs_attention",
      );
    }
    return sortedProducts.filter(
      (product) => classifyProduct(product, readinessMap[product.id] ?? "loading") === "ready",
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
  const showOnboarding = filteredProducts.length === 0 || completedSteps < onboardingSteps.length;
  const nextOnboardingStep = onboardingSteps.find((step) => !step.done)?.label ?? "Keep products moving to ready";

  function onHideTestDataChange(nextValue: boolean) {
    const params =
      typeof window === "undefined"
        ? new URLSearchParams(searchParams.toString())
        : new URLSearchParams(window.location.search);
    if (nextValue) {
      params.delete("hideTestData");
    } else {
      params.set("hideTestData", "false");
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  function setSavedView(view: ProductFilter) {
    const params =
      typeof window === "undefined"
        ? new URLSearchParams(searchParams.toString())
        : new URLSearchParams(window.location.search);
    if (view === "all") {
      params.delete("view");
    } else {
      params.set("view", view);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  function handleDeleteSubmit(event: React.FormEvent<HTMLFormElement>, productTitle: string) {
    if (!canWrite) {
      event.preventDefault();
      return;
    }
    const confirmed = window.confirm(
      `Archive product "${productTitle}"? It will be hidden from the catalog but can be restored later.`,
    );
    if (!confirmed) {
      event.preventDefault();
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const normalizedSearch = searchQuery.trim();
    if (normalizedSearch) {
      params.set("search", normalizedSearch);
    } else {
      params.delete("search");
    }

    const query = params.toString();
    const nextHref = query ? `${pathname}?${query}` : pathname;
    const currentHref = `${window.location.pathname}${window.location.search}`;
    if (currentHref !== nextHref) {
      window.history.replaceState(window.history.state, "", nextHref);
    }
  }, [pathname, searchQuery]);

  const emptyCatalogDescription =
    role === "viewer"
      ? "No products are available yet. Ask an editor or admin to import or create catalog data."
      : "Import your existing catalog from Excel, or create your first product manually.";

  return (
    <div className="space-y-4">
      <section className="sticky top-16 z-20 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSavedView("all")}
              className={`rounded-full px-2.5 py-1 text-xs ${
                selectedFilter === "all"
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-700"
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setSavedView("needs_attention")}
              className={`rounded-full px-2.5 py-1 text-xs ${
                selectedFilter === "needs_attention"
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-700"
              }`}
            >
              Needs Attention
            </button>
            <button
              type="button"
              onClick={() => setSavedView("ready")}
              className={`rounded-full px-2.5 py-1 text-xs ${
                selectedFilter === "ready"
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-700"
              }`}
            >
              Ready
            </button>
            {statusesLoaded ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span className="rounded-full bg-red-50 px-2 py-1 font-semibold text-red-700">
                  Needs Attention {triageCounts.needsAttention}
                </span>
                <span className="rounded-full bg-amber-50 px-2 py-1 font-semibold text-amber-700">
                  At Risk {triageCounts.atRisk}
                </span>
                <span className="rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">
                  Ready {triageCounts.ready}
                </span>
                {triageCounts.needsAttention > 0 ? (
                  <button
                    type="button"
                    className="rounded-full border border-red-200 px-2 py-1 font-semibold text-red-700 hover:bg-red-50"
                    onClick={() =>
                      setSavedView(selectedFilter === "needs_attention" ? "all" : "needs_attention")
                    }
                  >
                    {selectedFilter === "needs_attention" ? "Show all products" : "Focus blockers"}
                  </button>
                ) : null}
              </div>
            ) : (
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-24 animate-pulse rounded bg-slate-200" />
                <span className="h-4 w-20 animate-pulse rounded bg-slate-200" />
                <span className="h-4 w-16 animate-pulse rounded bg-slate-200" />
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search products by title or SKU"
                aria-label="Search products by title or SKU"
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 sm:w-72"
              />
              {searchQuery.trim().length > 0 ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <Link
              href={`/quality/issues${hideTestData ? "" : "?hideTestData=false"}`}
              className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Open Issue Inbox
            </Link>
            <Link
              href={mappingManagerHref ?? connectorManagementHref}
              className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {mappingManagerHref ? "Open channel mappings" : "Connect a channel"}
            </Link>
            {canWrite ? (
              <Button type="button" onClick={() => setShowCreateProduct((value) => !value)}>
                {showCreateProduct ? "Close new product form" : "+ New Product"}
              </Button>
            ) : null}
            {canWrite && skuUsagePercent !== null && skuUsagePercent >= 80 ? (
              <a
                href="/admin/plan"
                className={`rounded-full px-2 py-1 text-xs font-semibold ${
                  skuUsagePercent >= 100
                    ? "border border-red-200 bg-red-50 text-red-700"
                    : "border border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                {skuUsagePercent >= 100 ? "Limit reached" : "Nearing limit"} ({skuUsagePercent}%)
              </a>
            ) : null}
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
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            Categories: {stats.categories} | Products: {stats.products} | Variants: {stats.variants}
            {searchQuery.trim().length > 0 ? ` | Matches: ${searchedProducts.length}` : ""}
          </span>
          <span>
            {showOnboarding
              ? `Getting started: ${completedSteps}/${onboardingSteps.length} complete. Next: ${nextOnboardingStep}.`
              : "Stay in triage order: blockers first, then at risk, then ready."}
          </span>
        </div>
      </section>

      <section className="space-y-3">

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
            description={emptyCatalogDescription}
            action={{ label: "Import from Excel", href: "/operations/imports" }}
            secondaryAction={{
              label: "Create product manually",
              onClick: () => setShowCreateProduct(true),
            }}
          />
        ) : visibleProducts.length === 0 ? (
          <EmptyState
            icon="SEARCH"
            title={searchQuery.trim().length > 0 ? "No products match your search" : "No products match this view"}
            description={
              searchQuery.trim().length > 0
                ? "Try a different product title or variant SKU, or clear the current search."
                : "Try switching back to All products or review whether hidden test data is affecting the list."
            }
            action={
              searchQuery.trim().length > 0
                ? { label: "Clear search", onClick: () => setSearchQuery("") }
                : { label: "Show all products", onClick: () => setSavedView("all") }
            }
            secondaryAction={
              searchQuery.trim().length > 0 && selectedFilter !== "all"
                ? { label: "Show all products", onClick: () => setSavedView("all") }
                : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[940px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Complete %</th>
                  <th
                    className="px-3 py-2"
                    title="Checks for GST/HSN format and required compliance fields. Does not include channel-specific requirements - see Channel Readiness."
                  >
                    Compliance Issues <span aria-hidden="true">ⓘ</span>
                  </th>
                  <th className="px-3 py-2">Channel Readiness</th>
                  <th className="px-3 py-2">Last Updated</th>
                  <th className="px-3 py-2">Variants</th>
                  {canWrite ? <th className="px-3 py-2 text-right">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {visibleProducts.map((product) => (
                  <tr key={product.id} className="border-t border-border hover:bg-slate-50/50">
                    <td className="px-3 py-2.5">
                      <div className="space-y-1">
                        <Link href={`/products/${product.id}`}>{product.title}</Link>
                        <p className="text-xs text-slate-500">{product.brand || "No brand set"}</p>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">{product.category?.path ?? product.categoryId}</td>
                    <td className="px-3 py-2.5">
                      <StatusChip label={product.status} tone={productStatusTone(product.status)} />
                    </td>
                    <td className="px-3 py-2.5">{product.completenessScore ?? 0}%</td>
                    <td className="px-3 py-2.5">
                      <StatusChip label={complianceLabel(product)} tone={complianceTone(product)} />
                    </td>
                    <td className="px-3 py-2.5">
                      <ProductChannelReadinessCell
                        readiness={readinessState[product.id]}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{formatUpdatedAt(product.updatedAt)}</td>
                    <td className="px-3 py-2.5">{product.variants?.length ?? 0}</td>
                    {canWrite ? (
                      <td className="px-3 py-2.5 text-right">
                        <form action={deleteProductAction} onSubmit={(event) => handleDeleteSubmit(event, product.title)}>
                          <input type="hidden" name="productId" value={product.id} />
                          <input type="hidden" name="confirmDelete" value="yes" />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <button
                            type="submit"
                            className="rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </form>
                      </td>
                    ) : null}
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



