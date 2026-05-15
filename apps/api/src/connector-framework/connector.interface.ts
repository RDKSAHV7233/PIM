// apps/api/src/connector-framework/connector.interface.ts
// Connector Contract — DO NOT change method signatures without updating all connector stubs
// Review findings applied: normaliseError returns ConnectorIssue (not string)

export type ConnectorCap =
  | 'PUBLISH'
  | 'VALIDATE'
  | 'STATUS_SYNC'
  | 'WEBHOOK_RECEIVE'
  | 'EXCEL_EXPORT';

export type ConnectorImplementationStatus = 'full' | 'partial' | 'stub';

// ─────────────────────────────────────────────
// CONTEXT — injected into every connector call
// ─────────────────────────────────────────────

export interface ConnectorContext {
  tenantId: string;
  installationId: string;
  connectorId: string;
  sellerId?: string;       // Amazon sellerId, Flipkart sellerId
  marketplaceId?: string;  // "A21TJRUUN4KGV" for Amazon India
  /** Handles token refresh transparently. Never returns a stored DB value. */
  getAccessToken(): Promise<string>;
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
  attributes: Record<string, unknown>;
  productType: string;     // channel-specific product type string
  variants?: ProductVariantPayload[];  // when present, overrides scalar price/sku fields
  // SEO fields — mapped from product attributes or a dedicated SEO group
  seoTitle?: string;
  seoDescription?: string;
  tags?: string[];
  status?: 'ACTIVE' | 'DRAFT';
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
   * MUST verify signature before parsing body. Return null on invalid signature.
   */
  parseWebhookEvent?(
    rawBody: Buffer,
    headers: Record<string, string>
  ): Promise<ParsedWebhookEvent | null>;

  /**
   * Generate export file (Meesho Excel, future: ERP CSV).
   * CAPABILITY GUARD: only call if capabilities.includes(ConnectorCap.EXCEL_EXPORT).
   */
  generateExportFile?(
    ctx: ConnectorContext,
    products: ProductPayload[]
  ): Promise<ExportFile>;
}

// ─────────────────────────────────────────────
// CAPABILITY MATRIX (reference — enforce in ConnectorFrameworkService)
// ─────────────────────────────────────────────
//
//  Method                  Amazon   Flipkart   Meesho   ONDC
//  validateCredentials      ✓        ✓          ✓        TBD
//  validateProduct          LIVE_API LOCAL      LOCAL    TBD
//  normaliseError           ✓        ✓          ✓        TBD
//  handleOAuthCallback      ✓ LWA    ✓ AuthCode  -        -
//  fetchProductTypeSchema   ✓        partial     -        -
//  publishProduct           ✓        ✓          ✗ NONE   TBD
//  updateProduct            ✓        ✓           -        TBD
//  syncSubmissionStatus     webhook  ✓ poll      -        TBD
//  parseWebhookEvent        ✓        -           -        TBD
//  generateExportFile       -        -          ✓ Excel   -
