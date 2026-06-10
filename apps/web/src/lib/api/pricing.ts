// apps/web/src/lib/api/pricing.ts
// Client functions for the /pricing/* endpoints.
// All functions accept an optional ApiRequestOptions so they can be called
// from both server components (passing authHeader) and client components
// (where the session cookie is forwarded automatically).

import type { ApiRequestOptions } from "./core";
import { deleteJson, fetchJson, patchJson, postJson, postFormData } from "./core";

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

export async function getMarkets(options?: ApiRequestOptions): Promise<Market[]> {
  return fetchJson<Market[]>("/pricing/markets", undefined, options);
}

export async function createMarket(dto: CreateMarketDto, options?: ApiRequestOptions): Promise<Market> {
  return postJson<Market>("/pricing/markets", dto, options);
}

export async function updateMarket(id: string, dto: UpdateMarketDto, options?: ApiRequestOptions): Promise<Market> {
  return patchJson<Market>(`/pricing/markets/${id}`, dto, options);
}

export async function deleteMarket(id: string, options?: ApiRequestOptions): Promise<void> {
  return deleteJson(`/pricing/markets/${id}`, options);
}

// ── Currency endpoints ─────────────────────────────────────────────────────

export async function getCurrencies(options?: ApiRequestOptions): Promise<Currency[]> {
  return fetchJson<Currency[]>("/pricing/currencies", undefined, options);
}

export async function createCurrency(dto: CreateCurrencyDto, options?: ApiRequestOptions): Promise<Currency> {
  return postJson<Currency>("/pricing/currencies", dto, options);
}

export async function updateCurrency(id: string, dto: UpdateCurrencyDto, options?: ApiRequestOptions): Promise<Currency> {
  return patchJson<Currency>(`/pricing/currencies/${id}`, dto, options);
}

export async function deleteCurrency(id: string, options?: ApiRequestOptions): Promise<void> {
  return deleteJson(`/pricing/currencies/${id}`, options);
}

// ── Price List endpoints ───────────────────────────────────────────────────

export async function getPriceLists(options?: ApiRequestOptions): Promise<PriceList[]> {
  return fetchJson<PriceList[]>("/pricing/price-lists", undefined, options);
}

export async function createPriceList(dto: CreatePriceListDto, options?: ApiRequestOptions): Promise<PriceList> {
  return postJson<PriceList>("/pricing/price-lists", dto, options);
}

export async function updatePriceList(id: string, dto: UpdatePriceListDto, options?: ApiRequestOptions): Promise<PriceList> {
  return patchJson<PriceList>(`/pricing/price-lists/${id}`, dto, options);
}

export async function deletePriceList(id: string, options?: ApiRequestOptions): Promise<void> {
  return deleteJson(`/pricing/price-lists/${id}`, options);
}

// ── Product Price endpoints ────────────────────────────────────────────────

export async function getPriceListPrices(priceListId: string, options?: ApiRequestOptions): Promise<ProductPrice[]> {
  return fetchJson<ProductPrice[]>(`/pricing/price-lists/${priceListId}/prices`, undefined, options);
}

export async function upsertPriceListPrices(
  priceListId: string,
  prices: Array<{ variantId: string; mrp?: number | null; sellingPrice?: number | null }>,
  options?: ApiRequestOptions,
): Promise<{ upserted: number }> {
  return postJson<{ upserted: number }>(`/pricing/price-lists/${priceListId}/prices`, { prices }, options);
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
