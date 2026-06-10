// apps/api/src/connectors/amazon/amazon-marketplace-registry.ts
// Static Amazon marketplace registry: marketplaceId → { marketCode, currencyCode, locale, endpoint }
//
// Source: https://developer-docs.amazon.com/amazon-shipping/docs/marketplace-ids
// Endpoint mapping: https://developer-docs.amazon.com/amazon-shipping/docs/selling-partner-api-endpoints
//
// This file has no external dependencies — safe to import anywhere without DI overhead.
// New marketplaces: add an entry here; no other code changes required unless the connector
// needs market-specific logic (which goes in amazon.connector.ts).

export type AmazonMarketplaceEntry = {
  /** ISO 3166-1 alpha-2 country code — matches Market.code in Vexa's schema. */
  marketCode: string;
  /** ISO 4217 currency code. */
  currencyCode: string;
  /** BCP-47 locale for SP-API's `locale` / `issueLocale` query parameter. */
  locale: string;
  /** SP-API regional endpoint base URL (without trailing slash). */
  endpoint: string;
};

export const AMAZON_MARKETPLACE_REGISTRY: Readonly<Record<string, AmazonMarketplaceEntry>> = {
  // ── North America ────────────────────────────────────────────────────────────
  ATVPDKIKX0DER:  { marketCode: "US", currencyCode: "USD", locale: "en_US", endpoint: "https://sellingpartnerapi-na.amazon.com" },
  A2EUQ1WTGCTBG2: { marketCode: "CA", currencyCode: "CAD", locale: "en_CA", endpoint: "https://sellingpartnerapi-na.amazon.com" },
  A1AM78C64UM0Y8: { marketCode: "MX", currencyCode: "MXN", locale: "es_MX", endpoint: "https://sellingpartnerapi-na.amazon.com" },
  A2Q3Y263D00KWC: { marketCode: "BR", currencyCode: "BRL", locale: "pt_BR", endpoint: "https://sellingpartnerapi-na.amazon.com" },

  // ── Europe ───────────────────────────────────────────────────────────────────
  A1F83G8C2ARO7P: { marketCode: "GB", currencyCode: "GBP", locale: "en_GB", endpoint: "https://sellingpartnerapi-eu.amazon.com" },
  A1PA6795UKMFR9: { marketCode: "DE", currencyCode: "EUR", locale: "de_DE", endpoint: "https://sellingpartnerapi-eu.amazon.com" },
  A13V1IB3VIYZZH: { marketCode: "FR", currencyCode: "EUR", locale: "fr_FR", endpoint: "https://sellingpartnerapi-eu.amazon.com" },
  APJ6JRA9NG5V4:  { marketCode: "IT", currencyCode: "EUR", locale: "it_IT", endpoint: "https://sellingpartnerapi-eu.amazon.com" },
  A1RKKUPIHCS9HS: { marketCode: "ES", currencyCode: "EUR", locale: "es_ES", endpoint: "https://sellingpartnerapi-eu.amazon.com" },
  A1805IZSGTT6HS: { marketCode: "NL", currencyCode: "EUR", locale: "nl_NL", endpoint: "https://sellingpartnerapi-eu.amazon.com" },
  A2NODRKZP88ZB9: { marketCode: "SE", currencyCode: "SEK", locale: "sv_SE", endpoint: "https://sellingpartnerapi-eu.amazon.com" },
  A2XZLSVIQ0F4JT: { marketCode: "PL", currencyCode: "PLN", locale: "pl_PL", endpoint: "https://sellingpartnerapi-eu.amazon.com" },
  AMEN7PMS3EDWL:  { marketCode: "BE", currencyCode: "EUR", locale: "fr_BE", endpoint: "https://sellingpartnerapi-eu.amazon.com" },

  // ── Middle East & Africa ─────────────────────────────────────────────────────
  A2VIGQ35RCS4UG: { marketCode: "AE", currencyCode: "AED", locale: "en_AE", endpoint: "https://sellingpartnerapi-eu.amazon.com" },
  A17E79C6D8DWNP: { marketCode: "SA", currencyCode: "SAR", locale: "ar_SA", endpoint: "https://sellingpartnerapi-eu.amazon.com" },
  A33AVAJ2PDY3EV: { marketCode: "TR", currencyCode: "TRY", locale: "tr_TR", endpoint: "https://sellingpartnerapi-eu.amazon.com" },
  ARBP9OOSHTCHU:  { marketCode: "EG", currencyCode: "EGP", locale: "ar_EG", endpoint: "https://sellingpartnerapi-eu.amazon.com" },

  // ── Asia Pacific ─────────────────────────────────────────────────────────────
  A21TJRUUN4KGV:  { marketCode: "IN", currencyCode: "INR", locale: "en_IN", endpoint: "https://sellingpartnerapi-eu.amazon.com" },
  A1VC38T7YXB528: { marketCode: "JP", currencyCode: "JPY", locale: "ja_JP", endpoint: "https://sellingpartnerapi-fe.amazon.com" },
  A39IBJ37TRP1C6: { marketCode: "AU", currencyCode: "AUD", locale: "en_AU", endpoint: "https://sellingpartnerapi-fe.amazon.com" },
  A19VAU5U5O7RUS: { marketCode: "SG", currencyCode: "SGD", locale: "en_SG", endpoint: "https://sellingpartnerapi-fe.amazon.com" },
};

/**
 * Look up an Amazon marketplace entry by marketplaceId.
 * Returns `undefined` for unknown marketplace IDs (new region not yet in the registry).
 */
export function lookupAmazonMarketplace(marketplaceId: string): AmazonMarketplaceEntry | undefined {
  return AMAZON_MARKETPLACE_REGISTRY[marketplaceId];
}

// ── Tax attribute translation ─────────────────────────────────────────────────
// Maps (marketCode → TaxCodeKey → Amazon SP-API attribute name).
// Used by buildTaxAttributes() in amazon.connector.ts to convert the canonical
// TaxCodeEntry.key strings into the correct SP-API attribute field names.
//
// India's gstRate flat field is handled separately (it's a number, not a TaxCodeKey).
// Only add entries here when Amazon's SP-API for that marketplace actually accepts the attribute.

export const AMAZON_TAX_ATTRIBUTE_MAP: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  IN: {
    HSN_CODE: "hsn_code",        // Required for Amazon India listings
  },
  GB: {
    COMMODITY_CODE: "commodity_code", // UK Trade Tariff 10-digit code
  },
  AE: {
    HS_CODE: "hs_code",          // UAE HS code (6-digit Harmonized System)
  },
  US: {
    TAX_CATEGORY: "tax_code",    // Avalara/Amazon tax code (e.g. "A_CLTH_SHIRT")
  },
  AU: {
    COMMODITY_CODE: "commodity_code",
  },
  SA: {
    HS_CODE: "hs_code",
  },
};

/**
 * Resolve the SP-API attribute name for a given (marketCode, taxCodeKey) pair.
 * Returns `undefined` when no mapping exists for that combination.
 */
export function resolveAmazonTaxAttributeName(
  marketCode: string,
  taxCodeKey: string,
): string | undefined {
  return AMAZON_TAX_ATTRIBUTE_MAP[marketCode]?.[taxCodeKey];
}
