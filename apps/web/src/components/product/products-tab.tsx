"use client";

// Sprint 1: faceted search
import { FacetedFilterToggle, FacetedFilterPanel } from "@/components/ui/faceted-filter-panel";
import type { AdvancedSearchQuery } from "@/lib/api/catalog";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { triggerBulkPublishAction, updateProductStatusAction } from "@/app/actions";
import { BulkPublishConfirmForm } from "@/app/channels/connectors/[installationId]/bulk-publish-confirm-form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ProductChannelReadinessCell } from "@/components/channel/product-channel-readiness-cell";
import { CreateProductForm } from "@/components/product/CreateProductForm";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { DataGridPagination } from "@/components/ui/data-grid-pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonBlock } from "@/components/ui/skeleton";
import { StatusChip } from "@/components/ui/status-chip";
import { usePlanUsage } from "@/hooks/use-plan-usage";
import type { AppRole, CatalogStats, Category, MarketplaceChannel, ProductListItem } from "@/lib/api";
import {
  bulkPublishStatusBannerToneClass,
  type BulkPublishStatusMessage,
} from "@/lib/bulk-publish-status";
import { formatDateTime } from "@/lib/format";
import {
  bestChannelReadinessStatus,
  buildLoadingReadiness,
  buildUnknownReadiness,
  readyChannelCount,
  READINESS_CHANNELS,
  type ChannelReadinessResult,
  type ProductReadinessBatchResponse,
  type ReadinessStatus,
} from "@/lib/channel-readiness";
import { formatMarketplaceChannelLabel } from "@/lib/marketplace-channels";
import { canEditWorkspace, canPublishToChannels } from "@/lib/role-capabilities";
import { filterTestData } from "@/lib/test-data-filter";

type ProductFilter = "all" | "needs_attention" | "ready";
type TriageBucket = "needs_attention" | "at_risk" | "ready";

interface ProductWorkbenchItem extends ProductListItem {
  category?: Category | null;
}

interface ProductWithCompliance extends ProductWorkbenchItem {
  complianceErrorCount: number;
  complianceWarningCount: number;
}

type ProductReadinessState = Record<string, Partial<Record<MarketplaceChannel, ChannelReadinessResult>>>;

// PIM#595: a connector the Products workbench's manual bulk-publish selector can target.
// `hasNativeBulkPublish` mirrors installation.capabilities.includes("BULK_PUBLISH") on the
// connector Sync tab — used only to pick which soft-warning ceiling to show (see
// BULK_PUBLISH_SOFT_WARNING_CEILING below), never to gate submission itself.
export interface PublishConnectorOption {
  id: string;
  slug: string;
  displayName: string;
  channel: MarketplaceChannel;
  hasNativeBulkPublish: boolean;
}

/**
 * Build a ProductReadinessState where every product × channel slot is set to
 * the "unknown" sentinel. Used as both the loading placeholder and the fallback
 * when the batch request fails.
 */
function buildEmptyReadinessState(productIds: string[]): ProductReadinessState {
  return Object.fromEntries(
    productIds.map((productId) => [
      productId,
      Object.fromEntries(
        READINESS_CHANNELS.map((channel) => [channel, buildUnknownReadiness(channel)]),
      ),
    ]),
  );
}

/**
 * Build a ProductReadinessState where every product × channel slot is set to
 * the "loading" sentinel. Shown immediately while the batch request is in-flight
 * so the UI can display skeleton/spinner indicators during data fetch.
 */
function buildLoadingReadinessState(productIds: string[]): ProductReadinessState {
  return Object.fromEntries(
    productIds.map((productId) => [
      productId,
      Object.fromEntries(
        READINESS_CHANNELS.map((channel) => [channel, buildLoadingReadiness(channel)]),
      ),
    ]),
  );
}

/**
 * Merge the batch API response into a full ProductReadinessState, filling any
 * missing product × channel combinations with the "unknown" sentinel.
 */
function mergeReadinessBatchResponse(
  productIds: string[],
  payload: ProductReadinessBatchResponse,
): ProductReadinessState {
  const state = buildEmptyReadinessState(productIds);
  for (const item of payload.items ?? []) {
    state[item.productId] = Object.fromEntries(
      READINESS_CHANNELS.map((channel) => {
        const result =
          item.readiness.find((candidate) => candidate.channel === channel) ??
          buildUnknownReadiness(channel);
        return [channel, result];
      }),
    ) as Partial<Record<MarketplaceChannel, ChannelReadinessResult>>;
  }
  return state;
}

interface ProductsTabProps {
  role: AppRole;
  products: ProductWorkbenchItem[];
  categories: Category[];
  stats: CatalogStats | null;
  productFeedState: "available" | "restricted" | "unavailable";
  categoryFeedState: "available" | "restricted" | "unavailable";
  statsFeedState: "available" | "restricted" | "unavailable";
  connectorFeedState: "available" | "restricted" | "unavailable";
  hideTestData: boolean;
  installedConnectorCount: number | null;
  mappingManagerHref: string | null;
  connectorManagementHref: string;
  publishConnectors: PublishConnectorOption[];
  bulkPublishStatusMessage: BulkPublishStatusMessage | null;
  initialView?: ProductFilter;
  initialSearch?: string;
  initialCreate?: boolean;
  totalCount?: number | null;
  currentPage?: number;
  pageSize?: number;
}

function formatUpdatedAt(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "-";
  }
  return formatDateTime(timestamp);
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

  return (product.skuCodes ?? []).some((skuCode) => skuCode.toLowerCase().includes(normalized));
}

function nextActionLabel(
  product: ProductWithCompliance,
  bestStatus: ReadinessStatus,
  readyCount: number,
  totalChannels: number,
): string {
  if (product.complianceErrorCount > 0) {
    return `Fix ${product.complianceErrorCount} blocking issue${product.complianceErrorCount === 1 ? "" : "s"}`;
  }
  if (bestStatus === "errors") {
    return "Fix all channel blockers";
  }
  if (product.complianceWarningCount > 0 || bestStatus === "warnings") {
    return "Review warnings";
  }
  if ((product.completenessScore ?? 0) < 100) {
    return "Complete content";
  }
  if (bestStatus === "ready") {
    if (readyCount >= totalChannels) {
      return "Ready to publish";
    }
    return `${readyCount} of ${totalChannels} channels ready`;
  }
  return "Review product";
}

export function ProductsTab({
  role,
  products,
  categories,
  stats,
  productFeedState,
  categoryFeedState,
  statsFeedState,
  connectorFeedState,
  hideTestData,
  installedConnectorCount,
  mappingManagerHref,
  connectorManagementHref,
  publishConnectors,
  bulkPublishStatusMessage,
  initialView = "all",
  initialSearch = "",
  initialCreate = false,
  totalCount,
  currentPage = 1,
  pageSize = 50,
}: ProductsTabProps) {
  const canWrite = canEditWorkspace(role);
  const canPublish = canPublishToChannels(role);
  const { skuUsagePercent } = usePlanUsage(role);
  const [selectedFilter, setSelectedFilter] = useState<ProductFilter>(initialView);
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [showCreateProduct, setShowCreateProduct] = useState(initialCreate);
  const [readinessState, setReadinessState] = useState<ProductReadinessState>({});
  const [pendingArchive, setPendingArchive] = useState<{ productId: string; title: string } | null>(null);
  // PIM#595: manual bulk-publish selection state. Scoped to the currently visible page only —
  // reset (below) whenever the visible product set or the target connector changes, so there is
  // no cross-page persisted selection to accidentally carry into a different batch.
  const [selectedPublishConnectorId, setSelectedPublishConnectorId] = useState<string>(
    () => publishConnectors[0]?.id ?? "",
  );
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(() => new Set());
  // Sprint 1: faceted search
  const [facetOpen, setFacetOpen] = useState(false);
  const [facets, setFacets] = useState<AdvancedSearchQuery>({});
  const activeFacetCount = Object.entries(facets).filter(([k, v]) => k !== "q" && v).length;
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

  // Sprint 1: push facet params to URL for server re-fetch via getAdvancedSearchProducts
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (facets.categoryId) params.set("categoryId", facets.categoryId); else params.delete("categoryId");
    if (facets.brand) params.set("brand", facets.brand); else params.delete("brand");
    if (facets.status) params.set("status", facets.status); else params.delete("status");
    params.delete("page");
    const query = params.toString();
    const next = query ? `${pathname}?${query}` : pathname;
    if (`${window.location.pathname}${window.location.search}` !== next) {
      router.push(next);
    }
  }, [facets, pathname, router]);

  const filteredCategories = useMemo(() => filterTestData(categories, hideTestData), [categories, hideTestData]);

  const filteredProducts = useMemo(() => {
    const cleaned = filterTestData(products, hideTestData);
    return cleaned.map((product) => ({
      ...product,
      complianceErrorCount: product.openValidationErrorCount ?? 0,
      complianceWarningCount: product.openValidationWarningCount ?? 0,
    }));
  }, [hideTestData, products]);

  const searchedProducts = useMemo(() => {
    return filteredProducts.filter((product) => matchesProductSearch(product, searchQuery));
  }, [filteredProducts, searchQuery]);

  const productIdKey = useMemo(
    () => searchedProducts.map((p) => p.id).join(","),
    [searchedProducts],
  );

  useEffect(() => {
    const productIds = productIdKey ? productIdKey.split(",") : [];
    if (productIds.length === 0) {
      setReadinessState({});
      return;
    }

    const controller = new AbortController();
    setReadinessState(buildLoadingReadinessState(productIds));

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

        setReadinessState(mergeReadinessBatchResponse(productIds, payload));
      } catch {
        if (controller.signal.aborted) {
          return;
        }
        setReadinessState(buildEmptyReadinessState(productIds));
      }
    }

    void loadReadinessBatch();
    return () => controller.abort();
  }, [role, productIdKey]);

  const readinessMap = useMemo(() => {
    return Object.fromEntries(
      searchedProducts.map((product) => [
        product.id,
        bestChannelReadinessStatus(READINESS_CHANNELS.map((channel) => readinessState[product.id]?.[channel])),
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

  const visibleProductIdKey = useMemo(() => visibleProducts.map((p) => p.id).join(","), [visibleProducts]);

  // PIM#595: manual bulk-publish selection. Reuses the same per-channel readiness data the
  // "Channel Readiness" column already renders (readinessState) rather than re-deriving
  // eligibility — a product is selectable only when it's approved/active AND the batch API's
  // own evaluatePublishReadiness check for the selected channel already reports "ready"
  // (apps/api/src/marketplace/marketplace.service.ts, triggerBulkPublish). The server
  // independently re-validates every product on submit regardless of this client-side gate.
  const selectedPublishConnector = useMemo(
    () => publishConnectors.find((connector) => connector.id === selectedPublishConnectorId) ?? null,
    [publishConnectors, selectedPublishConnectorId],
  );
  const selectedPublishChannel = selectedPublishConnector?.channel ?? null;

  const isEligibleForBulkPublish = useCallback(
    (product: ProductWithCompliance): boolean => {
      if (!selectedPublishChannel) {
        return false;
      }
      const approved = product.status === "approved" || product.status === "active";
      const channelReady = readinessState[product.id]?.[selectedPublishChannel]?.status === "ready";
      return approved && channelReady;
    },
    [readinessState, selectedPublishChannel],
  );

  const eligiblePublishProductIds = useMemo(
    () => visibleProducts.filter((product) => isEligibleForBulkPublish(product)).map((product) => product.id),
    [visibleProducts, isEligibleForBulkPublish],
  );

  // Selection is scoped to the current page only — clear it whenever the visible product set
  // (new page, search, filter, or facet) or the target connector changes, instead of trying to
  // persist a selection across a different batch of rows.
  useEffect(() => {
    setSelectedProductIds(new Set());
  }, [visibleProductIdKey, selectedPublishConnectorId]);

  const allEligibleSelected =
    eligiblePublishProductIds.length > 0 &&
    eligiblePublishProductIds.every((id) => selectedProductIds.has(id));

  function toggleSelectAllEligibleVisible() {
    setSelectedProductIds(allEligibleSelected ? new Set() : new Set(eligiblePublishProductIds));
  }

  function toggleProductSelected(productId: string) {
    setSelectedProductIds((previous) => {
      const next = new Set(previous);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  }

  const selectedPublishCount = selectedProductIds.size;
  // UX-only soft-warning ceiling — NOT authoritative. The server enforces the real ceiling
  // per connector: 50 for connectors without native BULK_PUBLISH (NON_BULK_PUBLISH_BATCH_CEILING
  // in apps/api/src/marketplace/marketplace.service.ts) and a 200-product DTO hard cap
  // (@ArrayMaxSize(200) in trigger-bulk-publish.dto.ts) for native BULK_PUBLISH connectors like
  // Amazon. This constant only decides when to show an early warning before submit; changing it
  // does not change what the backend accepts or rejects.
  const bulkPublishSoftWarningCeiling = selectedPublishConnector?.hasNativeBulkPublish ? 200 : 50;
  const isNearBulkPublishCeiling =
    selectedPublishCount >= Math.ceil(bulkPublishSoftWarningCeiling * 0.8) &&
    selectedPublishCount <= bulkPublishSoftWarningCeiling;
  const isOverBulkPublishCeiling = selectedPublishCount > bulkPublishSoftWarningCeiling;

  const onboardingSteps = useMemo(() => {
    const hasProducts = productFeedState === "available" && filteredProducts.length > 0;
    const hasCompleteness =
      productFeedState === "available" &&
      filteredProducts.some((product) => typeof product.completenessScore === "number");
    const hasIssueResolved =
      productFeedState === "available" &&
      filteredProducts.some((product) => product.complianceErrorCount === 0);
    const hasConnector = connectorFeedState === "available" && (installedConnectorCount ?? 0) > 0;
    return [
      { key: "import", label: "Import your first catalog", done: hasProducts },
      { key: "completeness", label: "Review completeness score", done: hasCompleteness },
      { key: "issue", label: "Fix your first issue", done: hasIssueResolved },
      { key: "connector", label: "Connect a channel", done: hasConnector },
    ];
  }, [connectorFeedState, filteredProducts, installedConnectorCount, productFeedState]);
  const completedSteps = onboardingSteps.filter((step) => step.done).length;
  const showOnboarding =
    productFeedState === "available" &&
    (filteredProducts.length === 0 || completedSteps < onboardingSteps.length);
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
    params.delete("page");
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

  function navigatePage(page: number) {
    const params =
      typeof window === "undefined"
        ? new URLSearchParams(searchParams.toString())
        : new URLSearchParams(window.location.search);
    if (page > 1) {
      params.set("page", String(page));
    } else {
      params.delete("page");
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function handleDeleteClick(event: React.MouseEvent<HTMLButtonElement>, productId: string, productTitle: string) {
    if (!canWrite) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    setPendingArchive({ productId, title: productTitle });
  }

  function handleConfirmedArchive() {
    if (pendingArchive) {
      const { productId } = pendingArchive;
      const formData = new FormData();
      formData.set("productId", productId);
      formData.set("status", "archived");
      formData.set("returnTo", returnTo);
      formData.set("__viaTransition", "1");
      startTransition(async () => {
        const result = await updateProductStatusAction(formData);
        if (result?.sessionExpired) {
          window.location.assign(result.loginPath);
        }
      });
    }
    setPendingArchive(null);
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
    !canEditWorkspace(role)
      ? "No products are available yet. Ask an editor or admin to import or create catalog data."
      : "Import your existing catalog from a CSV or JSON file, or create your first product manually.";
  const hasUnavailableSharedRead =
    productFeedState === "unavailable" ||
    categoryFeedState === "unavailable" ||
    statsFeedState === "unavailable" ||
    connectorFeedState === "unavailable";
  const hasRestrictedSharedRead =
    productFeedState === "restricted" ||
    categoryFeedState === "restricted" ||
    statsFeedState === "restricted" ||
    connectorFeedState === "restricted";

  const showBulkPublishColumn = canPublish && publishConnectors.length > 0;

  const productColumns = useMemo<Column<ProductWithCompliance>[]>(
    () => [
      ...(showBulkPublishColumn
        ? [
            {
              key: "bulkPublishSelect",
              header: "Publish",
              mobileHide: true,
              render: (product: ProductWithCompliance) => {
                const eligible = isEligibleForBulkPublish(product);
                return (
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                    checked={selectedProductIds.has(product.id)}
                    disabled={!eligible}
                    onChange={() => toggleProductSelected(product.id)}
                    aria-label={`Select ${product.title} for bulk publish`}
                    title={
                      eligible
                        ? "Selected for bulk publish"
                        : selectedPublishChannel
                          ? "Not approved, or not publish-ready for the selected channel yet."
                          : "Choose a channel above to enable selection."
                    }
                  />
                );
              },
            } satisfies Column<ProductWithCompliance>,
          ]
        : []),
      {
        key: "title",
        header: "Title",
        render: (product) => (
          <div className="space-y-1">
            <Link href={`/products/${product.id}`}>{product.title}</Link>
            <p className="text-xs text-slate-500">{product.brand || "No brand set"}</p>
          </div>
        ),
      },
      {
        key: "category",
        header: "Category",
        render: (product) => product.categoryPath ?? product.categoryName ?? product.categoryId,
        mobileHide: true,
      },
      {
        key: "status",
        header: "Status",
        render: (product) => (
          <StatusChip label={product.status} tone={productStatusTone(product.status)} />
        ),
      },
      {
        key: "completeness",
        header: "Complete %",
        render: (product) => `${product.completenessScore ?? 0}%`,
      },
      {
        key: "compliance",
        header: "Compliance Issues",
        render: (product) => (
          <StatusChip label={complianceLabel(product)} tone={complianceTone(product)} />
        ),
        mobileHide: true,
      },
      {
        key: "readiness",
        header: "Channel Readiness",
        render: (product) => <ProductChannelReadinessCell readiness={readinessState[product.id]} />,
      },
      {
        key: "nextAction",
        header: "Next Action",
        render: (product) => {
          const channelResults = READINESS_CHANNELS.map((ch) => readinessState[product.id]?.[ch]);
          const ready = channelResults.filter((r) => r?.status === "ready").length;
          return (
            <span className="text-sm text-slate-700">
              {nextActionLabel(product, readinessMap[product.id] ?? "loading", ready, READINESS_CHANNELS.length)}
            </span>
          );
        },
      },
      {
        key: "updatedAt",
        header: "Last Updated",
        render: (product) => <span className="text-slate-600">{formatUpdatedAt(product.updatedAt)}</span>,
        mobileHide: true,
      },
      {
        key: "variants",
        header: "Variants",
        render: (product) => String(product.variantCount ?? 0),
        mobileHide: true,
      },
      ...(canWrite
        ? [
            {
              key: "actions",
              header: "Actions",
              headerClassName: "text-right",
              cellClassName: "text-right",
              render: (product: ProductWithCompliance) => (
                <div className="flex flex-wrap justify-end gap-2">
                  <Link
                    href={`/products/${product.id}`}
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Open
                  </Link>
                  <button
                    type="button"
                    className="rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                    onClick={(event) => handleDeleteClick(event, product.id, product.title)}
                  >
                    Archive
                  </button>
                </div>
              ),
            } satisfies Column<ProductWithCompliance>,
          ]
        : []),
    ],
    [
      canWrite,
      readinessMap,
      readinessState,
      returnTo,
      showBulkPublishColumn,
      isEligibleForBulkPublish,
      selectedProductIds,
      selectedPublishChannel,
    ],
  );

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4 xl:sticky xl:top-16 xl:z-20">
        {hasUnavailableSharedRead || hasRestrictedSharedRead ? (
          <div
            aria-live="polite"
            aria-atomic="true"
            role="status"
            className={`mb-4 rounded-lg border px-3 py-3 text-sm ${
              hasUnavailableSharedRead ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700"
            }`}
          >
            <p className="font-semibold">
              {hasUnavailableSharedRead
                ? "Some catalog workbench data is temporarily unavailable"
                : "Some catalog workbench data is restricted"}
            </p>
            <p className="mt-1">
              {hasUnavailableSharedRead
                ? "Unavailable catalog feeds are held back instead of defaulting to empty products, zero counts, or missing channel context."
                : "Your role can still open the product workbench, but some catalog, category, or connector details are intentionally redacted."}
            </p>
          </div>
        ) : null}
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
                <SkeletonBlock className="h-4 w-24" />
                <SkeletonBlock className="h-4 w-20" />
                <SkeletonBlock className="h-4 w-16" />
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
            {/* Sprint 1: Faceted search toggle */}
            <FacetedFilterToggle
              open={facetOpen}
              onToggle={() => setFacetOpen((v) => !v)}
              activeCount={activeFacetCount}
            />
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
              {connectorFeedState === "restricted"
                ? "Connector context restricted"
                : connectorFeedState === "unavailable"
                  ? "Connector context unavailable"
                  : mappingManagerHref
                    ? "Open channel mappings"
                    : "Connect a channel"}
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
            {stats
              ? `Categories: ${stats.categories} | Products: ${stats.products} | Variants: ${stats.variants}`
              : statsFeedState === "restricted"
                ? "Catalog totals are limited for your role."
                : "Catalog totals are temporarily unavailable."}
            {stats && searchQuery.trim().length > 0 ? ` | Matches: ${searchedProducts.length}` : ""}
          </span>
          <span>
            {showOnboarding
              ? `Getting started: ${completedSteps}/${onboardingSteps.length} complete. Next: ${nextOnboardingStep}.`
              : productFeedState === "restricted"
                ? "Product list visibility is limited for your role."
                : productFeedState === "unavailable"
                  ? "Product list is temporarily unavailable."
                  : "Stay in triage order: blockers first, then at risk, then ready."}
          </span>
        </div>
      </section>

      {/* Sprint 1: Faceted filter panel — renders below the sticky filter bar */}
      {facetOpen && (
        <FacetedFilterPanel
          categories={filteredCategories}
          value={facets}
          onChange={(next) => setFacets(next)}
          open={facetOpen}
        />
      )}

      {/* PIM#595: bulk-publish redirect outcome — mirrors the connector Sync tab's own banner. */}
      {bulkPublishStatusMessage ? (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-lg border px-4 py-3 text-sm ${bulkPublishStatusBannerToneClass(bulkPublishStatusMessage.tone)}`}
        >
          {bulkPublishStatusMessage.message}
        </div>
      ) : null}

      {/* PIM#595: manual per-connector bulk-publish selection. Replaces the connector Sync
          tab's auto-computed "every approved product in this workspace" batch with an explicit
          operator-chosen subset, submitted through the same unchanged backend endpoint. */}
      {showBulkPublishColumn ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-amber-900">Bulk publish to a channel</h2>
              <p className="mt-1 max-w-2xl text-xs text-amber-700">
                Choose a connector, then check exactly the products on this page you want to
                publish to it. Only products approved and publish-ready for the selected channel
                can be checked — this reuses the same Channel Readiness data shown in the table.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs font-medium text-amber-900">
                Channel
                <select
                  value={selectedPublishConnectorId}
                  onChange={(event) => setSelectedPublishConnectorId(event.target.value)}
                  className="rounded-md border border-amber-300 bg-white px-2 py-1.5 text-sm text-slate-900"
                >
                  {publishConnectors.map((connector) => (
                    <option key={connector.id} value={connector.id}>
                      {connector.displayName} ({formatMarketplaceChannelLabel(connector.channel)})
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={toggleSelectAllEligibleVisible}
                disabled={eligiblePublishProductIds.length === 0}
                className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {allEligibleSelected
                  ? "Clear selection"
                  : `Select all ${eligiblePublishProductIds.length} eligible on this page`}
              </button>
            </div>
          </div>
          <p
            className={`mt-2 text-xs font-semibold ${
              isOverBulkPublishCeiling
                ? "text-red-700"
                : isNearBulkPublishCeiling
                  ? "text-amber-900"
                  : "text-amber-700"
            }`}
          >
            {selectedPublishCount} selected
            {isOverBulkPublishCeiling
              ? ` — over this connector's ${bulkPublishSoftWarningCeiling}-product batch limit. The connector will reject this batch; deselect some products or submit a smaller batch.`
              : isNearBulkPublishCeiling
                ? ` — approaching this connector's ${bulkPublishSoftWarningCeiling}-product batch limit.`
                : "."}
          </p>
          {selectedPublishConnector ? (
            <BulkPublishConfirmForm
              installationId={selectedPublishConnector.id}
              channel={selectedPublishConnector.channel}
              productIds={Array.from(selectedProductIds)}
              returnTo={returnTo}
              action={triggerBulkPublishAction}
              idleLabelWhenEmpty="No products selected"
              hintWhenEmpty="Check at least one eligible product above before bulk publish."
              summaryLabel={(count) =>
                `${count} product${count === 1 ? "" : "s"} selected for ${formatMarketplaceChannelLabel(selectedPublishConnector.channel)}.`
              }
              confirmDescription={(count) =>
                `This will submit ${count} selected product${count === 1 ? "" : "s"} to ${selectedPublishConnector.displayName}. Native feed connectors send one batch; other publish connectors queue one export job per product. Track results in the Jobs workspace.`
              }
            />
          ) : (
            <p className="mt-3 text-xs text-amber-700">
              No active, publish-capable connector is installed yet.
            </p>
          )}
        </section>
      ) : null}

      <section className="space-y-3">

        {showCreateProduct && canWrite ? (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <CreateProductForm
              categories={filteredCategories}
              actorRole={role}
              onCreated={() => setShowCreateProduct(false)}
            />
          </section>
        ) : null}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Products</h2>
        {productFeedState === "restricted" ? (
          <EmptyState
            icon="LOCK"
            title="Product workbench access is restricted"
            description="Your role can open the catalog workspace, but the product list is intentionally redacted."
            action={{ label: "Open dashboard", href: "/dashboard" }}
            secondaryAction={{ label: "Open connectors", href: connectorManagementHref }}
          />
        ) : productFeedState === "unavailable" ? (
          <EmptyState
            icon="WARNING"
            title="Product workbench is temporarily unavailable"
            description="We could not load the product list right now. The page is held in an unavailable state instead of showing a false empty catalog."
            action={{ label: "Retry later", href: "/catalog/products" }}
            secondaryAction={{ label: "Open imports", href: "/operations/imports" }}
          />
        ) : filteredProducts.length === 0 ? (
          <EmptyState
            icon="BOX"
            title="Your catalog is empty"
            description={emptyCatalogDescription}
            action={{ label: "Import CSV or JSON", href: "/operations/imports" }}
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
          <DataGrid
            columns={productColumns}
            rows={visibleProducts}
            getRowKey={(product) => product.id}
            caption="Products workbench"
          />
        )}
      </section>
      <DataGridPagination
        totalCount={totalCount ?? stats?.products ?? 0}
        currentPage={currentPage}
        pageSize={pageSize}
        onNavigate={navigatePage}
      />
      <ConfirmDialog
        open={pendingArchive !== null}
        title="Archive product"
        description={`Archive "${pendingArchive?.title}"? It will be hidden from the catalog but can be restored later.`}
        confirmLabel="Archive"
        destructive
        onConfirm={handleConfirmedArchive}
        onCancel={() => setPendingArchive(null)}
      />
    </div>
  );
}

