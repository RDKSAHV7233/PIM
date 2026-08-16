// apps/api/src/connector-framework/connector.interface.ts
// Connector Contract — DO NOT change method signatures without updating all connector stubs
// Review findings applied: normaliseError returns ConnectorIssue (not string)

export type ConnectorCap =
  | 'PUBLISH'
  | 'VALIDATE'
  | 'STATUS_SYNC'
  | 'WEBHOOK_RECEIVE'
  | 'EXCEL_EXPORT'
  | 'BULK_PUBLISH'; // Amazon Feeds API batch path — opt-in via PIM_AMAZON_FEEDS_API_ENABLED

export type ConnectorImplementationStatus = 'full' | 'partial' | 'stub';

// ─────────────────────────────────────────────
// CONTEXT — injected into every connector call
// ─────────────────────────────────────────────

export interface ConnectorFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams | Buffer;
  /** Request timeout in ms. Defaults to 30s. */
  timeoutMs?: number;
}

export interface ConnectorContext {
  tenantId: string;
  installationId: string;
  connectorId: string;
  sellerId?: string;       // Amazon sellerId, Flipkart sellerId
  marketplaceId?: string;  // "A21TJRUUN4KGV" for Amazon India
  /**
   * ISO 3166-1 alpha-2 market code derived from the installation's marketplace context.
   * For Amazon: resolved from the marketplace registry via marketplaceId.
   * For Shopify: fetched from the shop's countryCode at OAuth time and stored in metadata.
   * Undefined when the installation predates market-context support or the market is unknown.
   */
  marketCode?: string;
  /**
   * ISO 4217 currency code for this installation's primary market.
   * For Amazon: resolved from the marketplace registry via marketplaceId.
   * For Shopify: fetched from the shop's currencyCode at OAuth time and stored in metadata.
   * Undefined when not yet populated — connectors should fall back to their own defaults.
   */
  currencyCode?: string;
  /** Handles token refresh transparently. Never returns a stored DB value. */
  getAccessToken(): Promise<string>;
  /**
   * Rate-limited, retrying fetch for outbound marketplace API calls.
   * Handles 429/503 backoff automatically. Use instead of raw fetch() in connectors.
   */
  fetch?(url: string, init?: ConnectorFetchInit): Promise<Response>;
}

// ─────────────────────────────────────────────
// PAYLOAD TYPES
// ─────────────────────────────────────────────

export type ProductVariantPayload = {
  sku: string;
  sellingPrice: number;
  mrp: number;
  compareAtPrice?: number;
  barcode?: string;
  weight?: number;
  weightUnit?: "KILOGRAMS" | "GRAMS" | "POUNDS" | "OUNCES";
  taxable?: boolean;
  inventoryPolicy?: "CONTINUE" | "DENY";
  imageUrl?: string;
  attributes?: Record<string, unknown>;
  // Shopify option dimensions derived from differing variant attributes, e.g. [{optionName:"color",name:"Red"}]
  options?: { optionName: string; name: string }[];
};

/**
 * Structured tax code entry for a single tax regime.
 * Additive alongside the legacy hsnCode/gstRate fields — India connectors ignore this.
 * Connector-specific key translation (e.g. "HSN_CODE" → "hsn_code" for Amazon SP-API)
 * is deferred to a later PR; canonical enum values are exposed here.
 */
export type TaxCodeEntry = {
  regimeKey: string;   // matches TaxRegime.marketCode: "IN" | "GB" | "US" | "AE" | "AU"
  key: string;         // TaxCodeKey enum string: "HSN_CODE" | "HS_CODE" | "COMMODITY_CODE" | "TAX_CATEGORY"
  value: string;       // e.g. "62044200", "6204420000", "CLOTHING"
  rate?: number;       // tax rate %: 5, 12, 18, 20, 28
};

/**
 * Market-specific price resolved from an active PriceList for a single variant.
 * Populated from ProductPrice → PriceList → Market + Currency.
 * Connectors that do not support multi-currency may ignore this and use the top-level mrp/sellingPrice.
 */
export type MarketPrice = {
  marketCode: string;    // matches Market.code: "IN", "GB", "US", "AE", "AU"
  currencyCode: string;  // ISO 4217: "INR", "GBP", "USD", "AED", "AUD"
  mrp?: number;
  sellingPrice?: number;
  isDefault: boolean;    // true if this is the tenant's default PriceList for this market
};

export type ProductMetafieldPayload = {
  namespace: string;
  key: string;
  type: string;
  value: unknown;
};

export type ProductCustomMetaPayload = {
  key: string;
  value: unknown;
};

export type ProductPayload = {
  sku: string;
  title: string;
  description: string;
  brand: string;
  hsnCode: string;
  gstRate: number;
  mrp: number;
  sellingPrice: number;
  compareAtPrice?: number;
  mainImageUrl: string;    // MediaAsset.cdnUrl — must be permanent public HTTPS URL
  additionalImageUrls?: string[];  // secondary images (up to 8 for Amazon, varies for Flipkart)
  bulletPoints?: string[];         // Amazon: up to 5 bullet_point attributes
  asin?: string;                   // Amazon: existing catalog ASIN for offer-mode updates
  condition?: 'new' | 'used' | 'refurbished';
  countryOfOrigin?: string;        // Amazon India + other marketplace compliance
  parentSku?: string;              // variation family parent SKU
  variationTheme?: string;         // e.g. "SIZE", "COLOR", "SIZE_COLOR"
  attributes: Record<string, unknown>;
  productType: string;     // channel-specific product type string
  variants?: ProductVariantPayload[];  // when present, overrides scalar price/sku fields
  // SEO fields — mapped from product attributes or a dedicated SEO group
  seoTitle?: string;
  seoDescription?: string;
  tags?: string[];
  status?: 'ACTIVE' | 'DRAFT';
  /** Structured multi-regime tax codes. India connectors use hsnCode/gstRate instead. */
  taxCodes?: TaxCodeEntry[];
  /**
   * ISO 4217 currency code of the resolved default market price.
   * Falls back to "INR" when no PriceList is configured for the tenant.
   */
  currencyCode?: string;
  /**
   * Per-market prices for the primary variant, resolved from active PriceLists.
   * Undefined when no PriceLists exist. Connectors targeting a single market
   * should look for the entry where isDefault === true or marketCode matches their target.
   */
  marketPrices?: MarketPrice[];
  /** Connector-ready product metafields compiled from tenant field mappings. */
  metafields?: ProductMetafieldPayload[];
  /** Connector-ready product metadata compiled from tenant field mappings. */
  customMeta?: ProductCustomMetaPayload[];
};

export type ValidationResult = {
  isValid: boolean;
  errors: ConnectorIssue[];
  warnings: ConnectorIssue[];
  source: 'LIVE_API' | 'LOCAL_RULES'; // shown in UI — never fake "live" on fallback
};

export type ConnectorIssue = {
  code: string;           // channel-native error code e.g. "MISSING_REQUIRED_ATTRIBUTE"
  fieldPath: string;      // e.g. "attributes.color"
  sellerMessage: string;  // plain-language, seller-readable — output of normaliseError()
  severity: 'error' | 'warning';
};

export type SubmissionRef = {
  externalRef: string;
  status: 'PENDING' | 'SUCCESS' | 'REJECTED' | 'SUPPRESSED' | 'ERROR';
  isAsync: boolean;        // true = result arrives via webhook (Amazon); false = sync (some Flipkart categories)
};

export type SubmissionStatusUpdate = {
  externalRef: string;
  status: 'PENDING' | 'SUCCESS' | 'REJECTED' | 'SUPPRESSED' | 'ERROR';
  channelErrors: ConnectorIssue[];
  resolvedAt?: Date;
};

export type ParsedWebhookEvent = {
  eventType: string;
  externalRef?: string;   // links back to ConnectorSubmission
  productSku?: string;
  status?: 'SUCCESS' | 'REJECTED' | 'SUPPRESSED';
  channelErrors: ConnectorIssue[];
  rawEventId: string;     // externalEventId for deduplication
};

export type ProductTypeSchema = {
  productType: string;
  requiredAttributes: string[];
  optionalAttributes: string[];
  validValues: Record<string, string[]>;
  schemaVersion: string;
};

export type ConnectorPublicationTarget = {
  id: string;
  name: string;
  catalogId?: string | null;
  catalogTitle?: string | null;
  catalogType?: string | null;
  selected?: boolean;
};

export type ExportFile = {
  buffer: Buffer;
  filename: string;  // "meesho_upload_apparel_20260301.xlsx"
  mimeType: string;
};

/**
 * Commit material derived from a live token exchange during candidate credential
 * verification — sourced from the provider's actual response, never the operator's
 * typed input. Only Flipkart/Amazon's `valid` outcome populates this (their
 * candidate check is a real token exchange, which may itself rotate the refresh
 * token — see FlipkartTokenResponse/AmazonTokenResponse `refresh_token`).
 */
export type TokenCommitMaterial = { value: string; expiresAt: Date | null };

/**
 * Outcome of a candidate-credential verification call. Distinguishes "the
 * credentials are wrong" (invalid — positive evidence, e.g. 401/403) from
 * "couldn't check right now" (unavailable — network/infra failure, no evidence
 * either way) so a transient blip never gets reported as bad credentials.
 */
export type CredentialVerificationResult =
  | { outcome: "valid"; commitExtra?: { accessToken?: TokenCommitMaterial; refreshToken?: TokenCommitMaterial } }
  | { outcome: "invalid"; reasonCode?: string }
  | { outcome: "unavailable"; reasonCode?: string }
  | { outcome: "not_supported" };

// Returned by publishBulkProducts — one ref per bulk feed submission.
// Each product gets its own ConnectorSubmission row with externalRef:
// "feed::{feedId}::{1-based messageId}::{sku}"
// syncSubmissionStatus decodes this format to look up per-product feed result.
export type BulkSubmissionRef = {
  feedId: string;
  feedDocumentId: string;
  productCount: number;
  // Ordered list of SKUs — index+1 maps to the messageId in the feed document.
  skus: string[];
};

// ─────────────────────────────────────────────
// MAIN INTERFACE — every connector implements this
// ─────────────────────────────────────────────

export interface ConnectorInterface {

  // ── Identity (required) ─────────────────────────────────────────────
  readonly slug: string;
  readonly displayName: string;
  readonly capabilities: ConnectorCap[];
  /**
   * Describes the current implementation completeness of this connector.
   * - 'full'    - credential validation and publish are implemented and tested
   * - 'partial' - some capabilities are implemented (for example export-only)
   * - 'stub'    - capabilities are declared but not implemented; returns safe defaults
   */
  readonly implementationStatus?: ConnectorImplementationStatus;

  // ── Required methods ────────────────────────────────────────────────

  /**
   * Validate stored credentials are still active.
   * Called on installation and by the 6-hour credential heartbeat.
   * Must NOT throw — return false on any failure.
   */
  validateCredentials(ctx: ConnectorContext): Promise<boolean>;

  /**
   * Validate a product payload WITHOUT submitting it.
   * Amazon: VALIDATION_PREVIEW mode (live API, authoritative).
   * Others: local rules until channel supports dry-run.
   * source field in result must be "LIVE_API" or "LOCAL_RULES" — never invent a label.
   */
  validateProduct(
    ctx: ConnectorContext,
    product: ProductPayload
  ): Promise<ValidationResult>;

  /**
   * Translate a channel-native error code + raw message into a structured ConnectorIssue.
   * Returns ConnectorIssue — NOT a plain string.
   * Sellers must never see raw channel error codes in the UI.
   */
  normaliseError(errorCode: string, rawMessage: string): ConnectorIssue;

  // ── Optional methods (add as connector matures) ──────────────────────

  /**
   * Exchange an OAuth callback code for tokens and store encrypted.
   * Only implemented by connectors with OAUTH2_LWA or OAUTH2_AUTHCODE authType.
   */
  handleOAuthCallback?(
    ctx: ConnectorContext,
    params: Record<string, string>
  ): Promise<void>;

  /**
   * Fetch the channel-authoritative field schema for a product type.
   * Keeps validation rules fresh as marketplaces update their schemas.
   */
  fetchProductTypeSchema?(
    ctx: ConnectorContext,
    productType: string
  ): Promise<ProductTypeSchema>;

  /**
   * List publication targets available for an installed account.
   * Used by channels that require explicit publication selection (for example Shopify).
   */
  listPublications?(
    ctx: ConnectorContext
  ): Promise<ConnectorPublicationTarget[]>;

  /**
   * Submit a product listing to the channel.
   * CAPABILITY GUARD: only call if capabilities.includes(ConnectorCap.PUBLISH).
   * Meesho does NOT implement this method.
   */
  publishProduct?(
    ctx: ConnectorContext,
    product: ProductPayload
  ): Promise<SubmissionRef>;

  /**
   * Update an existing listing after initial publish.
   */
  updateProduct?(
    ctx: ConnectorContext,
    product: ProductPayload,
    externalRef: string
  ): Promise<SubmissionRef>;

  /**
   * Poll for submission status.
   * Used when webhooks are unavailable (e.g. Flipkart polling fallback).
   */
  syncSubmissionStatus?(
    ctx: ConnectorContext,
    externalRef: string
  ): Promise<SubmissionStatusUpdate>;

  /**
   * Verify webhook signature and parse to internal event.
   * MUST verify HMAC signature before parsing body. Return null on invalid signature.
   * Never return a non-null result from an unverified payload.
   *
   * ctx.installationId is passed by the ingestion service from the inbound request context.
   * Connectors that support per-installation HMAC secrets (e.g. WooCommerce W5+) use it
   * to look up the stored webhook_secret for this installation. Connectors using a
   * shared app-level secret (e.g. Shopify, WooCommerce W1) may ignore ctx.
   */
  parseWebhookEvent?(
    rawBody: Buffer,
    headers: Record<string, string>,
    ctx?: { installationId: string }
  ): Promise<ParsedWebhookEvent | null>;

  /**
   * Whether this connector verifies HMAC signatures in parseWebhookEvent.
   * Defaults to true for all connectors with WEBHOOK_RECEIVE capability.
   * The ingestion service emits a security warning if this is false but the
   * connector still has WEBHOOK_RECEIVE — that combination requires a written
   * explanation (e.g. IP allowlisting used instead).
   * Set explicitly to false only when you have documented the alternative control.
   */
  readonly requiresWebhookSignatureVerification?: boolean;

  /**
   * Generate export file (Meesho Excel, future: ERP CSV).
   * CAPABILITY GUARD: only call if capabilities.includes(ConnectorCap.EXCEL_EXPORT).
   */
  generateExportFile?(
    ctx: ConnectorContext,
    products: ProductPayload[]
  ): Promise<ExportFile>;

  /**
   * Submit multiple products as a single Amazon JSON_LISTINGS_FEED document.
   * CAPABILITY GUARD: only call if capabilities.includes('BULK_PUBLISH').
   * Returns a BulkSubmissionRef — the caller creates one ConnectorSubmission per
   * product with externalRef "feed::{feedId}::{messageId}::{sku}".
   * syncSubmissionStatus handles polling and per-product result extraction.
   */
  publishBulkProducts?(
    ctx: ConnectorContext,
    products: ProductPayload[]
  ): Promise<BulkSubmissionRef>;

  /**
   * Exchange a stale access token for a fresh one.
   * Called by ConnectorCredentialService when the stored token is absent or expired.
   * Implementation MUST persist the new token(s) to ConnectorCredential before returning.
   * Returns the new plain-text access token.
   *
   * Only required for connectors with OAuth2 auth flows (Amazon LWA, Shopify, Flipkart).
   * Export-only connectors (Meesho) and connectors with static API keys do not need this.
   */
  refreshAccessToken?(ctx: ConnectorContext): Promise<string>;

  /**
   * Verify a CANDIDATE credential set live, without touching any stored state.
   *
   * Distinct from validateCredentials(): that method reads and health-checks the
   * STORED credentials (and for Flipkart/Amazon, refreshes + persists a token as a
   * side effect). This method checks credentials the operator just typed, before
   * they're committed — it must never read stored credentials, never write to
   * ConnectorCredential, and never call noteCredentialHealth or persistTokenSet.
   *
   * `candidate` is ephemeral request-scoped plaintext: never log it, never include
   * it in a thrown error or audit metadata.
   *
   * Absent (undefined) for connectors with no live-checkable credentials (Meesho —
   * validateCredentials is a permanent stub) and for OAuth-managed-install connectors
   * (Shopify) where this feature isn't offered.
   */
  verifyCandidateCredentials?(candidate: Record<string, string>): Promise<CredentialVerificationResult>;
}

// ─────────────────────────────────────────────
// CAPABILITY MATRIX (reference — enforce in ConnectorFrameworkService)
// ─────────────────────────────────────────────
//
//  Method                  Amazon           Flipkart   Meesho   ONDC
//  validateCredentials      ✓                ✓          ✓        TBD
//  validateProduct          LIVE_API         LOCAL      LOCAL    TBD
//  normaliseError           ✓                ✓          ✓        TBD
//  handleOAuthCallback      ✓ LWA            ✓ AuthCode  -        -
//  fetchProductTypeSchema   ✓                partial     -        -
//  publishProduct           ✓                ✓          ✗ NONE   TBD
//  updateProduct            ✓                ✓           -        TBD
//  syncSubmissionStatus     webhook+feeds    ✓ poll      -        TBD
//  parseWebhookEvent        ✓                -           -        TBD
//  generateExportFile       -                -          ✓ Excel   -
//  publishBulkProducts      ✓ flag-gated     -           -        -
