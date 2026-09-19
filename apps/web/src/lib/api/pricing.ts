// apps/web/src/lib/api/pricing.ts
// Client functions for the /pricing/* endpoints.
// All functions accept an optional ApiRequestOptions so they can be called
// from both server components (passing authHeader) and client components
// (where the session cookie is forwarded automatically).

import type { ApiRequestOptions } from "./core";
import { deleteJson, fetchJson, patchJson, postJson, postFormData } from "./core";
import { csrfHeaders } from "../csrf";

// ── Types ──────────────────────────────────────────────────────────────────

export type MarketStatus = "active" | "inactive";

export interface Market {
  id: string;
  tenantKey: string;
  code: string;
  locale: string;
  displayName: string;
  isDefault: boolean;
  status: MarketStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Currency {
  id: string;
  tenantKey: string;
  code: string;
  symbol: string;
  displayName: string;
  decimalPlaces: number;
  createdAt: string;
  updatedAt: string;
}

export interface PriceListMarket {
  id: string;
  code: string;
  displayName: string;
}

export interface PriceListCurrency {
  id: string;
  code: string;
  symbol: string;
}

export interface PriceList {
  id: string;
  tenantKey: string;
  name: string;
  marketId: string;
  currencyId: string;
  market: PriceListMarket;
  currency: PriceListCurrency;
  isDefault: boolean;
  status: MarketStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProductPrice {
  id: string;
  priceListId: string;
  variantId: string;
  mrp: number | null;
  sellingPrice: number | null;
  variant: {
    id: string;
    skuCode: string;
    product: { id: string; title: string };
  };
  createdAt: string;
  updatedAt: string;
}

// ── Create / update DTOs ───────────────────────────────────────────────────

export interface CreateMarketDto {
  code: string;
  locale: string;
  displayName: string;
  isDefault?: boolean;
  status?: MarketStatus;
}

export interface UpdateMarketDto {
  locale?: string;
  displayName?: string;
  isDefault?: boolean;
  status?: MarketStatus;
}

export interface CreateCurrencyDto {
  code: string;
  symbol: string;
  displayName: string;
  decimalPlaces?: number;
}

export interface UpdateCurrencyDto {
  symbol?: string;
  displayName?: string;
  decimalPlaces?: number;
}

export interface CreatePriceListDto {
  name: string;
  marketId: string;
  currencyId: string;
  isDefault?: boolean;
  status?: MarketStatus;
}

export interface UpdatePriceListDto {
  name?: string;
  isDefault?: boolean;
  status?: MarketStatus;
}

// ── Market endpoints ───────────────────────────────────────────────────────

function shouldUseBrowserPricingProxy(options?: ApiRequestOptions): boolean {
  return typeof window !== "undefined" && !options?.authHeader;
}

async function fetchBrowserPricingJson<T>(path: string, init?: RequestInit): Promise<T> {
  const method = String(init?.method ?? "GET").toUpperCase();
  const hasBody = init?.body !== undefined && init?.body !== null;
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(method === "GET" || method === "HEAD" ? {} : csrfHeaders()),
      ...(init?.headers ?? {}),
    },
    cache: init?.cache ?? "no-store",
  });

  const rawBody = await response.text();
  if (!response.ok) {
    let message = `Pricing request failed with status ${response.status}.`;
    if (rawBody.trim()) {
      try {
        const body = JSON.parse(rawBody) as { message?: unknown };
        message = typeof body.message === "string" && body.message.trim() ? body.message : message;
      } catch {
        // Keep the sanitized status message when the proxy returns non-JSON.
      }
    }
    throw new Error(message);
  }
  if (!rawBody.trim()) {
    return undefined as T;
  }
  return JSON.parse(rawBody) as T;
}

export async function getMarkets(options?: ApiRequestOptions): Promise<Market[]> {
  return fetchJson<Market[]>("/pricing/markets", undefined, options);
}

export async function createMarket(dto: CreateMarketDto, options?: ApiRequestOptions): Promise<Market> {
  if (shouldUseBrowserPricingProxy(options)) {
    return fetchBrowserPricingJson<Market>("/pricing/markets", {
      method: "POST",
      body: JSON.stringify(dto),
    });
  }
  return postJson<Market>("/pricing/markets", dto, options);
}

export async function updateMarket(id: string, dto: UpdateMarketDto, options?: ApiRequestOptions): Promise<Market> {
  if (shouldUseBrowserPricingProxy(options)) {
    return fetchBrowserPricingJson<Market>(`/pricing/markets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(dto),
    });
  }
  return patchJson<Market>(`/pricing/markets/${id}`, dto, options);
}

export async function deleteMarket(id: string, options?: ApiRequestOptions): Promise<void> {
  if (shouldUseBrowserPricingProxy(options)) {
    await fetchBrowserPricingJson<void>(`/pricing/markets/${id}`, { method: "DELETE" });
    return;
  }
  return deleteJson(`/pricing/markets/${id}`, options);
}

// ── Currency endpoints ─────────────────────────────────────────────────────

export async function getCurrencies(options?: ApiRequestOptions): Promise<Currency[]> {
  return fetchJson<Currency[]>("/pricing/currencies", undefined, options);
}

export async function createCurrency(dto: CreateCurrencyDto, options?: ApiRequestOptions): Promise<Currency> {
  if (shouldUseBrowserPricingProxy(options)) {
    return fetchBrowserPricingJson<Currency>("/pricing/currencies", {
      method: "POST",
      body: JSON.stringify(dto),
    });
  }
  return postJson<Currency>("/pricing/currencies", dto, options);
}

export async function updateCurrency(id: string, dto: UpdateCurrencyDto, options?: ApiRequestOptions): Promise<Currency> {
  if (shouldUseBrowserPricingProxy(options)) {
    return fetchBrowserPricingJson<Currency>(`/pricing/currencies/${id}`, {
      method: "PATCH",
      body: JSON.stringify(dto),
    });
  }
  return patchJson<Currency>(`/pricing/currencies/${id}`, dto, options);
}

export async function deleteCurrency(id: string, options?: ApiRequestOptions): Promise<void> {
  if (shouldUseBrowserPricingProxy(options)) {
    await fetchBrowserPricingJson<void>(`/pricing/currencies/${id}`, { method: "DELETE" });
    return;
  }
  return deleteJson(`/pricing/currencies/${id}`, options);
}

// ── Price List endpoints ───────────────────────────────────────────────────

export async function getPriceLists(options?: ApiRequestOptions): Promise<PriceList[]> {
  if (shouldUseBrowserPricingProxy(options)) {
    return fetchBrowserPricingJson<PriceList[]>("/pricing/price-lists");
  }
  return fetchJson<PriceList[]>("/pricing/price-lists", undefined, options);
}

export async function createPriceList(dto: CreatePriceListDto, options?: ApiRequestOptions): Promise<PriceList> {
  if (shouldUseBrowserPricingProxy(options)) {
    return fetchBrowserPricingJson<PriceList>("/pricing/price-lists", {
      method: "POST",
      body: JSON.stringify(dto),
    });
  }
  return postJson<PriceList>("/pricing/price-lists", dto, options);
}

export async function updatePriceList(id: string, dto: UpdatePriceListDto, options?: ApiRequestOptions): Promise<PriceList> {
  if (shouldUseBrowserPricingProxy(options)) {
    return fetchBrowserPricingJson<PriceList>(`/pricing/price-lists/${id}`, {
      method: "PATCH",
      body: JSON.stringify(dto),
    });
  }
  return patchJson<PriceList>(`/pricing/price-lists/${id}`, dto, options);
}

export async function deletePriceList(id: string, options?: ApiRequestOptions): Promise<void> {
  if (shouldUseBrowserPricingProxy(options)) {
    await fetchBrowserPricingJson<void>(`/pricing/price-lists/${id}`, { method: "DELETE" });
    return;
  }
  return deleteJson(`/pricing/price-lists/${id}`, options);
}

// ── Product Price endpoints ────────────────────────────────────────────────

export async function getPriceListPrices(priceListId: string, options?: ApiRequestOptions): Promise<ProductPrice[]> {
  if (shouldUseBrowserPricingProxy(options)) {
    return fetchBrowserPricingJson<ProductPrice[]>(`/pricing/price-lists/${priceListId}/prices`);
  }
  return fetchJson<ProductPrice[]>(`/pricing/price-lists/${priceListId}/prices`, undefined, options);
}

export async function upsertPriceListPrices(
  priceListId: string,
  prices: Array<{ variantId: string; mrp?: number | null; sellingPrice?: number | null }>,
  options?: ApiRequestOptions,
): Promise<{ upserted: number }> {
  if (shouldUseBrowserPricingProxy(options)) {
    return fetchBrowserPricingJson<{ upserted: number }>(`/pricing/price-lists/${priceListId}/prices`, {
      method: "PUT",
      body: JSON.stringify({ prices }),
    });
  }
  return fetchJson<{ upserted: number }>(
    `/pricing/price-lists/${priceListId}/prices`,
    { method: "PUT", body: JSON.stringify({ prices }) },
    options,
  );
}

export interface PriceImportError {
  row: number;
  skuCode: string | null;
  message: string;
}

export interface PriceImportResult {
  imported: number;
  skipped: number;
  errors: PriceImportError[];
}

// ── CSV Template Download ──────────────────────────────────────────────────

/**
 * Fetches the price list CSV template and triggers a browser file download.
 * The template contains all variant SKUs with current prices pre-filled.
 * Browser-only — uses fetch + URL.createObjectURL.
 */
export async function downloadPriceListTemplate(priceListId: string): Promise<void> {
  const { getApiBaseUrl } = await import("../api-base-url");
  const url = `${getApiBaseUrl()}/pricing/price-lists/${priceListId}/prices/template`;
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Template download failed: HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? `pricelist-${priceListId}-template.csv`;
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

// ── Pricing Coverage ──────────────────────────────────────────────────────

export interface PricingCoveragePerList {
  id: string;
  name: string;
  isDefault: boolean;
  status: string;
  market: { code: string; displayName: string };
  currency: { code: string; symbol: string };
  totalVariants: number;
  pricedVariants: number;
  unpricedVariants: number;
  coveragePercent: number;
}

export interface PricingCoverage {
  totalVariants: number;
  defaultPriceList: { id: string; name: string } | null;
  pricedInDefaultList: number;
  unpricedInDefaultList: number;
  defaultListCoverage: number;
  totalActivePriceLists: number;
  perPriceList: PricingCoveragePerList[];
}

/**
 * Returns a coverage snapshot: how many variants have prices set in each
 * active price list, plus a summary for the default list.
 */
export async function getPricingCoverage(options?: ApiRequestOptions): Promise<PricingCoverage> {
  return fetchJson<PricingCoverage>("/pricing/coverage", undefined, options);
}

/**
 * Upload a CSV file to bulk-import prices for a price list.
 * The CSV must have a `sku_code` column and at least one of `mrp` / `selling_price`.
 * Returns a summary with row-level errors for any SKUs that failed.
 */
export async function importPriceListPricesCsv(
  priceListId: string,
  file: File,
  options?: ApiRequestOptions,
): Promise<PriceImportResult> {
  const form = new FormData();
  form.append("file", file);
  return postFormData<PriceImportResult>(
    `/pricing/price-lists/${priceListId}/prices/import`,
    form,
    options,
  );
}
