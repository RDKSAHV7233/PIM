// apps/api/src/connectors/woocommerce/woocommerce.connector.ts
//
// Capabilities: PUBLISH + VALIDATE + STATUS_SYNC + WEBHOOK_RECEIVE
// implementationStatus: partial  (W1+W2 — scaffold + credentials + preflight + validateProduct + idempotent product push)
//
// Auth: WooCommerce REST API v3, HTTP Basic Auth (consumer_key:consumer_secret).
// Webhook HMAC: X-WC-Webhook-Signature = base64(HMAC-SHA256(rawBody, webhook_secret)).
//   W1 uses env var PIM_WOOCOMMERCE_WEBHOOK_SECRET (app-level, shared across installs).
//   W5 prefers tenant-owned per-installation secrets when webhook context is available.
//
// Install paths:
//   Manual-key: site_url + consumer_key + consumer_secret + webhook_secret entered in form.
//   App-auth  : handleOAuthCallback receives consumer_key + consumer_secret from WC app-auth
//               flow (/wc-auth/v1/authorize). site_url + webhook_secret captured at install start.
//
// Credential storage (ConnectorCredential rows per installationId):
//   credentialType: 'site_url'         — store URL (e.g. https://store.example.com)
//   credentialType: 'consumer_key'     — ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   credentialType: 'consumer_secret'  — AES-256-GCM encrypted
//   credentialType: 'webhook_secret'   — AES-256-GCM encrypted
//
// _vexa_* idempotency keys written to WC product meta_data:
//   _vexa_pim_product_id  — Vexa internal product SKU (idempotency anchor)
//   _vexa_pim_sync_ts     — ISO-8601 last sync timestamp
//   _vexa_hsn_code        — Indian HSN code
//   _vexa_gst_rate        — GST rate percentage (0, 5, 12, 18, 28)

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../common/logging/logger.service';
import { PrismaDirectService } from '../../prisma/prisma-direct.service';
import {
  buildEncryptedCredential,
  decryptCredentialValue,
  formatCredentialKeyVersion,
  loadCredentialEncryptionKeys,
  parseCredentialKeyVersion,
  resolveCurrentCredentialKeyVersion,
} from '../../connector-installer/credential-encryption.util';
import {
  ConnectorCap,
  ConnectorContext,
  ConnectorInterface,
  ConnectorIssue,
  ParsedWebhookEvent,
  ProductPayload,
  SubmissionRef,
  SubmissionStatusUpdate,
  ValidationResult,
} from '../../connector-framework/connector.interface';
import { ConnectorNetworkError } from '../../connector-framework/connector.errors';
import { tenantExecRaw } from '../../common/tenant/tenant-raw';

const CONNECTOR_HTTP_TIMEOUT_MS = 30_000;

// A `ConnectorContext` built without a tenantId is an internal caller bug, not
// evidence about the customer's actual WooCommerce credentials. Kept distinct
// from ConnectorNetworkError so validateCredentials() can tell "our own
// context-construction is broken" apart from "the stored creds are actually
// invalid" — conflating the two previously risked misdiagnosing an internal
// bug as CREDENTIAL_EXPIRED (the exact class of defect BUG-WOO-HEALTH-001/#472
// was created to prevent, just triggered by a missing tenant context instead
// of a network blip).
export class MissingTenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingTenantContextError';
  }
}

// ─── WooCommerce REST API shapes ───────────────────────────────────────────────

type WcProductPayload = {
  name: string;
  type?: 'simple' | 'variable' | 'grouped' | 'external';
  status?: 'publish' | 'draft' | 'pending' | 'private';
  description?: string;
  sku?: string;
  regular_price?: string;
  sale_price?: string;
  // W4: tax class resolved from gstRate; empty string = standard rate in WC
  tax_class?: string;
  images?: Array<{ src: string; name?: string; alt?: string }>;
  attributes?: Array<{ name: string; options: string[]; visible?: boolean }>;
  meta_data?: Array<{ key: string; value: string }>;
};

type WcProductResponse = {
  id?: number;
  sku?: string;
  status?: string;
  permalink?: string;
  code?: string;
  message?: string;
};

type WcWebhookProductPayload = {
  id?: number | string;
  sku?: string;
  status?: string;
  name?: string;
  meta_data?: Array<{ key: string; value: unknown }>;
};

type WcTermResponse = {
  id: number;
  name: string;
  slug?: string;
};

type WcProductListItem = {
  id?: number;
  sku?: string;
  meta_data?: Array<{ key: string; value: unknown }>;
};

// WC variation payload — attributes use singular `option` (not `options` array)
type WcVariationPayload = {
  sku?: string;
  status?: 'publish' | 'private';
  regular_price?: string;
  sale_price?: string;
  tax_class?: string;
  image?: { src: string };
  attributes?: Array<{ name: string; option: string }>;
  meta_data?: Array<{ key: string; value: string }>;
};

type WcVariationListItem = {
  id?: number;
  sku?: string;
};

// ─── error map ────────────────────────────────────────────────────────────────

const WC_ERROR_MAP: Record<string, { fieldPath: string; sellerMessage: string; severity: 'error' | 'warning' }> = {
  woocommerce_rest_authentication_error: {
    fieldPath: '',
    severity: 'error',
    sellerMessage: 'WooCommerce authentication failed. Check the Consumer Key and Consumer Secret, and ensure the REST API keys have Read/Write permission.',
  },
  woocommerce_rest_cannot_view: {
    fieldPath: '',
    severity: 'error',
    sellerMessage: 'WooCommerce REST API access denied. Ensure the API keys have sufficient permissions (Read/Write).',
  },
  woocommerce_rest_product_invalid_id: {
    fieldPath: 'sku',
    severity: 'error',
    sellerMessage: 'The WooCommerce product ID referenced is invalid or has been deleted.',
  },
  woocommerce_rest_product_sku_invalid: {
    fieldPath: 'sku',
    severity: 'error',
    sellerMessage: 'SKU is already in use by another product on this WooCommerce store.',
  },
  woocommerce_rest_term_exists: {
    fieldPath: 'attributes',
    severity: 'warning',
    sellerMessage: 'A product attribute or category with this name already exists. The existing term will be reused.',
  },
  woocommerce_rest_product_image_upload_error: {
    fieldPath: 'mainImageUrl',
    severity: 'error',
    sellerMessage: 'WooCommerce could not download or process the product image. Ensure the image URL is publicly accessible and returns a valid image format (JPG/PNG/WebP).',
  },
  rest_forbidden: {
    fieldPath: '',
    severity: 'error',
    sellerMessage: 'WooCommerce REST API is disabled or the route is not accessible. Ensure Pretty Permalinks are enabled and the WooCommerce plugin is active.',
  },
  rest_no_route: {
    fieldPath: '',
    severity: 'error',
    sellerMessage: 'WooCommerce REST API endpoint not found. Confirm WooCommerce is installed and the Site URL is correct.',
  },
  woocommerce_rest_invalid_param: {
    fieldPath: '',
    severity: 'error',
    sellerMessage: 'A required product field has an invalid value. Check product title, price, and category fields.',
  },
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function buildBasicAuthHeader(consumerKey: string, consumerSecret: string): string {
  const token = Buffer.from(`${consumerKey}:${consumerSecret}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

function normalizeSiteUrl(raw: string): string {
  return raw.replace(/\/+$/, '');
}

// DEF-02/DEF-03: Node's native fetch() throws a bare `TypeError: fetch failed` when the
// request can't complete at the network layer (DNS/TCP/TLS/connection-refused/abort), wrapping
// the real cause in `error.cause`. That raw string was surfacing verbatim as the submission's
// terminal error, unclassified and non-actionable. This maps it to a concrete, retryable-aware
// category before it ever reaches a ConnectorSubmission record.
type CallApiFailureCategory = 'TIMEOUT' | 'DNS' | 'TLS' | 'NETWORK';

function classifyCallApiFailure(err: unknown): { category: CallApiFailureCategory; retryable: boolean; detail: string } {
  if (err instanceof Error && err.name === 'AbortError') {
    return { category: 'TIMEOUT', retryable: true, detail: `request exceeded ${CONNECTOR_HTTP_TIMEOUT_MS}ms timeout` };
  }
  const cause = err instanceof Error ? (err.cause as { code?: string; message?: string } | undefined) : undefined;
  const causeCode = cause?.code ?? '';
  if (causeCode === 'ENOTFOUND' || causeCode === 'EAI_AGAIN') {
    return { category: 'DNS', retryable: false, detail: `DNS resolution failed (${causeCode})` };
  }
  if (causeCode.startsWith('ERR_TLS') || causeCode.startsWith('CERT_')) {
    return { category: 'TLS', retryable: false, detail: `TLS/certificate error (${causeCode})` };
  }
  if (causeCode === 'ECONNREFUSED' || causeCode === 'ECONNRESET' || causeCode === 'EHOSTUNREACH' || causeCode === 'ETIMEDOUT') {
    return { category: 'NETWORK', retryable: true, detail: `connection failed (${causeCode})` };
  }
  const detail = cause?.message || (err instanceof Error ? err.message : String(err));
  return { category: 'NETWORK', retryable: true, detail: detail || 'unknown network failure' };
}

// ─── connector ────────────────────────────────────────────────────────────────

@Injectable()
export class WooCommerceConnector implements ConnectorInterface {
  readonly slug = 'woocommerce';
  readonly displayName = 'WooCommerce';
  // partial: W1 provides credential preflight + local validate + HMAC webhook;
  // full publish (W2-W4), reconciliation (W6), and resumable jobs (W7) are follow-on PRs.
  readonly implementationStatus = 'partial' as const;
  readonly capabilities: ConnectorCap[] = ['PUBLISH', 'VALIDATE', 'STATUS_SYNC', 'WEBHOOK_RECEIVE'];
  // W5b: explicit declaration ensures ingestion service logs a warning if ever set to false.
  readonly requiresWebhookSignatureVerification = true;

  private readonly keys = loadCredentialEncryptionKeys(process.env);
  private readonly currentKeyVersion = resolveCurrentCredentialKeyVersion(process.env);

  constructor(
    private readonly prismaDirect: PrismaDirectService,
    private readonly logger: LoggerService,
  ) {}

  // ─── credential helpers ─────────────────────────────────────────────────────

  private requireTenantKey(ctx: Pick<ConnectorContext, 'tenantId'>, action: string): string {
    const tenantKey = String(ctx.tenantId ?? '').trim();
    if (!tenantKey) {
      throw new MissingTenantContextError(`WooCommerce ${action} missing tenant context.`);
    }
    return tenantKey;
  }

  private async fetchCredentialPlaintext(tenantKey: string, installationId: string, type: string): Promise<string | null> {
    const db = this.prismaDirect.getClient();
    const row = await db.connectorCredential.findFirst({
      where: { tenantKey, installationId, credentialType: type },
      select: { encryptedValue: true, keyVersion: true },
    });
    if (!row) return null;
    const version = parseCredentialKeyVersion(row.keyVersion ?? 'v1');
    const key = this.keys.get(version);
    if (!key) return null;
    return decryptCredentialValue(row.encryptedValue, key);
  }

  private async getPlainCredential(ctx: ConnectorContext, type: string): Promise<string | null> {
    return this.fetchCredentialPlaintext(this.requireTenantKey(ctx, 'credential lookup'), ctx.installationId, type);
  }

  private async resolveCredentials(ctx: ConnectorContext): Promise<{
    siteUrl: string;
    consumerKey: string;
    consumerSecret: string;
  }> {
    const [siteUrl, consumerKey, consumerSecret] = await Promise.all([
      this.getPlainCredential(ctx, 'site_url'),
      this.getPlainCredential(ctx, 'consumer_key'),
      this.getPlainCredential(ctx, 'consumer_secret'),
    ]);
    if (!siteUrl || !consumerKey || !consumerSecret) {
      throw new Error('WooCommerce credentials incomplete. Verify site_url, consumer_key, and consumer_secret are stored.');
    }
    return {
      siteUrl: normalizeSiteUrl(siteUrl),
      consumerKey,
      consumerSecret,
    };
  }

  // ─── W4: GST rate → WC tax class slug ────────────────────────────────────────
  //
  // WC built-in tax classes: '' (standard), 'reduced-rate', 'zero-rate'.
  // Indian GST schedule: 0% → zero-rate, 1-5% → reduced-rate, 12/18/28% → standard.
  // Merchants using a GST plugin with custom class slugs (e.g. 'gst-12', 'gst-28')
  // should configure those via a future per-installation tax-class-override attribute.

  private resolveTaxClass(gstRate: number | null | undefined): string {
    if (gstRate == null) return '';
    if (gstRate === 0)   return 'zero-rate';
    if (gstRate <= 5)    return 'reduced-rate';
    return '';    // 12%, 18%, 28% → standard (empty string = standard in WC REST API)
  }

  // ─── W4: price resolution — prefer IN market price over top-level fields ─────
  //
  // Uses product.marketPrices (from PriceList) when available.
  // Falls back to top-level mrp / sellingPrice when marketPrices is absent
  // (tenants without multi-currency PriceLists configured).

  private resolvePricing(
    mrp: number,
    sellingPrice: number,
    marketPrices?: Array<{ marketCode: string; mrp?: number; sellingPrice?: number; isDefault: boolean }>,
  ): { regularPrice: string; salePrice?: string } {
    const inMarket = marketPrices?.find((p) => p.marketCode === 'IN' && p.mrp != null);
    const resolvedMrp          = inMarket?.mrp          ?? mrp;
    const resolvedSellingPrice = inMarket?.sellingPrice ?? sellingPrice;
    const regularPrice = String(resolvedMrp ?? resolvedSellingPrice ?? 0);
    const salePrice    =
      resolvedSellingPrice != null &&
      resolvedMrp != null &&
      resolvedSellingPrice < resolvedMrp
        ? String(resolvedSellingPrice)
        : undefined;
    return { regularPrice, salePrice };
  }

  // ─── idempotency: find existing WC product by SKU ────────────────────────────
  //
  // `sku` is one of the natively-supported query parameters on GET /products
  // (unlike the generic WordPress meta_key/meta_value filter, which WooCommerce's
  // products collection endpoint does not implement — passing it is silently
  // ignored and the endpoint falls back to its default, unfiltered listing).
  // Live-verified against a real store: meta_key/meta_value returned the same
  // single existing product for every distinct SKU queried, causing every
  // publish to PUT-overwrite that one product instead of creating a new one.
  // buildWcProductPayload already sets the native `sku` field on every create,
  // so filtering by it here is the correct, supported match. The exact-match
  // check on the returned item's own sku is defense in depth — `sku=` is an
  // exact-match filter per WooCommerce's docs, but this repo just learned not
  // to trust an unverified filter parameter without confirming the response.
  //
  // Returns the numeric WC product ID if a matching product exists, or null.

  private async findExistingProductId(
    siteUrl: string,
    consumerKey: string,
    consumerSecret: string,
    vexaSku: string,
  ): Promise<number | null> {
    const query = `sku=${encodeURIComponent(vexaSku)}&per_page=1&status=any`;
    const res = await this.callApi('GET', `/products?${query}`, siteUrl, consumerKey, consumerSecret);
    if (!res.ok) return null;
    const data = await res.json() as WcProductListItem[];
    if (Array.isArray(data) && data.length > 0 && data[0].id != null && data[0].sku === vexaSku) {
      return data[0].id;
    }
    return null;
  }

  // ─── taxonomy: resolve or create WC categories / tags ───────────────────────
  //
  // For each name, search the given WC taxonomy endpoint. If found, return its id.
  // If not found, create it. If creation fails with 400 (woocommerce_rest_term_exists),
  // re-search — the term was created concurrently.

  private async resolveTermIds(
    siteUrl: string,
    consumerKey: string,
    consumerSecret: string,
    names: string[],
    endpoint: string,
  ): Promise<number[]> {
    const ids: number[] = [];
    for (const rawName of names) {
      const name = rawName.trim();
      if (!name) continue;

      const search = await this.callApi(
        'GET',
        `${endpoint}?search=${encodeURIComponent(name)}&per_page=10`,
        siteUrl,
        consumerKey,
        consumerSecret,
      );

      if (search.ok) {
        const terms = await search.json() as WcTermResponse[];
        const found = Array.isArray(terms)
          ? terms.find((t) => t.name.toLowerCase() === name.toLowerCase())
          : undefined;
        if (found) { ids.push(found.id); continue; }
      }

      // Not found — create it
      const create = await this.callApi('POST', endpoint, siteUrl, consumerKey, consumerSecret, { name });
      if (create.ok) {
        const term = await create.json() as WcTermResponse;
        if (term.id) ids.push(term.id);
      } else if (create.status === 400) {
        // woocommerce_rest_term_exists — another request created it first; re-search
        const retry = await this.callApi(
          'GET',
          `${endpoint}?search=${encodeURIComponent(name)}&per_page=10`,
          siteUrl,
          consumerKey,
          consumerSecret,
        );
        if (retry.ok) {
          const terms = await retry.json() as WcTermResponse[];
          const found = Array.isArray(terms)
            ? terms.find((t) => t.name.toLowerCase() === name.toLowerCase())
            : undefined;
          if (found) ids.push(found.id);
        }
      }
      // Other create failures silently skip — product will publish without the term
    }
    return ids;
  }

  // ─── W3: extract parent-product variation attributes from variant array ──────
  //
  // WC parent product attributes must list ALL possible option values per dimension
  // (e.g. Color: ["Red","Blue","Green"]) with variation:true so the storefront can
  // render a variant picker. The parent attribute uses `options` (array); the
  // per-variation attribute uses `option` (singular string — see WcVariationPayload).

  private buildVariationAttributes(
    variants: Array<{ options?: { optionName: string; name: string }[]; attributes?: Record<string, unknown> }>,
  ): Array<{ name: string; options: string[]; visible: boolean; variation: boolean }> {
    const dimensionMap = new Map<string, Set<string>>();

    for (const variant of variants) {
      if (variant.options && variant.options.length > 0) {
        for (const opt of variant.options) {
          const key = opt.optionName.trim();
          if (!dimensionMap.has(key)) dimensionMap.set(key, new Set());
          dimensionMap.get(key)!.add(opt.name.trim());
        }
      } else if (variant.attributes) {
        for (const [k, v] of Object.entries(variant.attributes)) {
          const key = k.trim();
          if (v == null || typeof v === 'object') continue;
          if (!dimensionMap.has(key)) dimensionMap.set(key, new Set());
          dimensionMap.get(key)!.add(String(v).trim());
        }
      }
    }

    const result: Array<{ name: string; options: string[]; visible: boolean; variation: boolean }> = [];
    for (const [name, valueSet] of dimensionMap.entries()) {
      result.push({ name, options: Array.from(valueSet), visible: true, variation: true });
    }
    return result;
  }

  // ─── W3: build a single WC variation payload from a ProductVariantPayload ────

  private buildWcVariationPayload(
    variant: {
      sku: string;
      sellingPrice: number;
      mrp: number;
      imageUrl?: string;
      options?: { optionName: string; name: string }[];
      attributes?: Record<string, unknown>;
    },
    parentGstRate?: number | null,
  ): WcVariationPayload {
    const attributes: Array<{ name: string; option: string }> = [];

    if (variant.options && variant.options.length > 0) {
      for (const opt of variant.options) {
        attributes.push({ name: opt.optionName.trim(), option: opt.name.trim() });
      }
    } else if (variant.attributes) {
      for (const [k, v] of Object.entries(variant.attributes)) {
        if (v == null || typeof v === 'object') continue;
        attributes.push({ name: k.trim(), option: String(v).trim() });
      }
    }

    // W4: resolve pricing and tax class
    const { regularPrice, salePrice } = this.resolvePricing(variant.mrp, variant.sellingPrice);
    const taxClass = this.resolveTaxClass(parentGstRate);

    const payload: WcVariationPayload = {
      sku: variant.sku,
      status: 'publish',
      regular_price: regularPrice,
      sale_price: salePrice,
      tax_class: taxClass,
      attributes,
      meta_data: [
        { key: '_vexa_pim_product_id', value: variant.sku },
        { key: '_vexa_pim_sync_ts',    value: new Date().toISOString() },
        // W9: GST-applicability flag on variations; mirrors the parent product flag.
        ...(parentGstRate != null ? [{ key: '_vexa_gst_applicable', value: 'yes' }] : []),
      ],
    };

    if (variant.imageUrl && variant.imageUrl.startsWith('https://')) {
      payload.image = { src: variant.imageUrl };
    }

    return payload;
  }

  // ─── W3: idempotent variation upsert — match by SKU, PUT if exists, POST new ─

  private async upsertVariations(
    siteUrl: string,
    consumerKey: string,
    consumerSecret: string,
    parentId: number,
    variants: Array<{
      sku: string;
      sellingPrice: number;
      mrp: number;
      imageUrl?: string;
      options?: { optionName: string; name: string }[];
      attributes?: Record<string, unknown>;
    }>,
    parentGstRate?: number | null,
  ): Promise<void> {
    // Fetch existing variations (up to 100 — covers typical product variant counts)
    const existingRes = await this.callApi(
      'GET',
      `/products/${parentId}/variations?per_page=100&status=any`,
      siteUrl,
      consumerKey,
      consumerSecret,
    );

    const existingById = new Map<string, number>();
    if (existingRes.ok) {
      const existing = await existingRes.json() as WcVariationListItem[];
      if (Array.isArray(existing)) {
        for (const v of existing) {
          if (v.sku && v.id != null) existingById.set(v.sku, v.id);
        }
      }
    }

    for (const variant of variants) {
      const variationPayload = this.buildWcVariationPayload(variant, parentGstRate);
      const existingId = existingById.get(variant.sku);

      if (existingId != null) {
        await this.callApi(
          'PUT',
          `/products/${parentId}/variations/${existingId}`,
          siteUrl,
          consumerKey,
          consumerSecret,
          variationPayload,
        );
      } else {
        await this.callApi(
          'POST',
          `/products/${parentId}/variations`,
          siteUrl,
          consumerKey,
          consumerSecret,
          variationPayload,
        );
      }
    }
  }

  // ─── W5b: webhook health guard ───────────────────────────────────────────────
  //
  // WooCommerce auto-disables webhook delivery after 5 consecutive failures and
  // sends no notification to the merchant. Without this check a silently-broken
  // webhook subscription causes submissions to stay PENDING indefinitely even
  // though the product is live on WC.
  //
  // Returns a warning ConnectorIssue when:
  //   1. At least one prior delivery was received (brand-new installs are excluded)
  //   2. The most recent delivery is older than WEBHOOK_HEALTH_THRESHOLD_MS
  // Called only when syncSubmissionStatus resolves to SUCCESS (WC says publish
  // but our side never received the confirming webhook).

  private static readonly WEBHOOK_HEALTH_THRESHOLD_MS = 12 * 60 * 60 * 1000; // 12 h

  private async checkWebhookHealth(installationId: string): Promise<ConnectorIssue | null> {
    try {
      const db = this.prismaDirect.getClient();
      const last = await db.connectorWebhookEvent.findFirst({
        where: { installationId },
        orderBy: { receivedAt: 'desc' },
        select: { receivedAt: true },
      });
      if (!last) return null; // no prior deliveries — new installation, normal
      const ageMs = Date.now() - new Date(last.receivedAt).getTime();
      if (ageMs < WooCommerceConnector.WEBHOOK_HEALTH_THRESHOLD_MS) return null;
      return {
        code: 'WOO_WEBHOOK_POSSIBLY_DISABLED',
        fieldPath: '',
        severity: 'warning',
        sellerMessage:
          'No WooCommerce webhook events received in the last 12 hours. WooCommerce may have ' +
          'automatically disabled webhook delivery after consecutive failures. Go to WooCommerce → ' +
          'Settings → Advanced → Webhooks and re-enable the Vexa webhook.',
      };
    } catch (err) {
      this.logger.warn('WooCommerce webhook health check failed', {
        installationId,
        reason: err instanceof Error ? err.message : String(err),
      });
      return null; // non-fatal: health check failure doesn't block status resolution
    }
  }

  // ─── W10: installation health summary ────────────────────────────────────────
  //
  // Aggregates credential status, webhook health, and recent submission counts
  // into a single object for surfacing in admin UI / diagnostics dashboards.
  // Checks the last 48h of submissions. Non-fatal — errors in any sub-check
  // are caught and reflected as unknown/null rather than thrown.

  async getInstallationHealth(ctx: ConnectorContext): Promise<{
    credentialsValid: boolean;
    webhookHealthIssue: ConnectorIssue | null;
    recentSubmissions: { success: number; error: number; pending: number; lastSyncAt: string | null };
    checkedAt: string;
  }> {
    const [credentialsValid, webhookHealthIssue, recentSubmissions] = await Promise.all([
      this.validateCredentials(ctx).catch(() => false),
      this.checkWebhookHealth(ctx.installationId).catch(() => null),
      this.loadRecentSubmissionSummary(ctx.installationId).catch(() => ({
        success: 0, error: 0, pending: 0, lastSyncAt: null,
      })),
    ]);
    return { credentialsValid, webhookHealthIssue, recentSubmissions, checkedAt: new Date().toISOString() };
  }

  private async loadRecentSubmissionSummary(
    installationId: string,
  ): Promise<{ success: number; error: number; pending: number; lastSyncAt: string | null }> {
    const db = this.prismaDirect.getClient();
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const rows = await db.connectorSubmission.findMany({
      where: { installationId, submittedAt: { gte: cutoff } },
      select: { status: true, resolvedAt: true },
      take: 500,
      orderBy: { submittedAt: 'desc' },
    });
    let success = 0, error = 0, pending = 0;
    let lastSyncAt: string | null = null;
    for (const row of rows as Array<{ status: string; resolvedAt: Date | null }>) {
      const s = (row.status ?? '').toUpperCase();
      if (s === 'SUCCESS')  success++;
      else if (s === 'ERROR' || s === 'REJECTED') error++;
      else if (s === 'PENDING') pending++;
      if (row.resolvedAt && !lastSyncAt) {
        lastSyncAt = new Date(row.resolvedAt).toISOString();
      }
    }
    return { success, error, pending, lastSyncAt };
  }

  // ─── HTTP helper ────────────────────────────────────────────────────────────

  private async callApi(
    method: string,
    path: string,
    siteUrl: string,
    consumerKey: string,
    consumerSecret: string,
    body?: unknown,
  ): Promise<Response> {
    const url = `${siteUrl}/wp-json/wc/v3${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONNECTOR_HTTP_TIMEOUT_MS);
    try {
      return await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': buildBasicAuthHeader(consumerKey, consumerSecret),
        },
        body: body != null ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      const { category, retryable, detail } = classifyCallApiFailure(err);
      this.logger.warn('WooCommerce callApi network failure', {
        method,
        path,
        category,
        retryable,
        detail,
        cause: err instanceof Error && err.cause ? String(err.cause) : undefined,
      });
      throw new ConnectorNetworkError('woocommerce', category, retryable, detail);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ─── required: validateCredentials ──────────────────────────────────────────
  //
  // Two-step preflight:
  //   1. HTTPS enforcement — reject plaintext HTTP site URLs.
  //   2. GET /wp-json/wc/v3/products?per_page=1 with Basic Auth — a 200 response
  //      confirms REST API is reachable AND the keys have real read permission.
  //      The bare /wp-json/wc/v3 root is WordPress's public route-discovery
  //      endpoint — it returns 200 with no Authorization header at all, so it
  //      can never distinguish valid credentials from wrong ones (live-verified
  //      against a real store: garbage consumer_key/consumer_secret still got
  //      200 from the bare root, but a correct 401 from /products). Hitting an
  //      actual protected resource is required for this check to mean anything.

  async validateCredentials(ctx: ConnectorContext): Promise<boolean> {
    try {
      const { siteUrl, consumerKey, consumerSecret } = await this.resolveCredentials(ctx);

      if (!siteUrl.startsWith('https://')) {
        this.logger.warn('WooCommerce preflight failed: site URL must use HTTPS', {
          installationId: ctx.installationId,
        });
        return false;
      }

      const res = await this.callApi('GET', '/products?per_page=1', siteUrl, consumerKey, consumerSecret);

      if (res.status === 401 || res.status === 403) {
        this.logger.warn('WooCommerce credential validation failed: auth rejected', {
          installationId: ctx.installationId,
          status: res.status,
        });
        return false;
      }
      if (!res.ok) {
        this.logger.warn('WooCommerce credential validation failed: unexpected status', {
          installationId: ctx.installationId,
          status: res.status,
        });
        return false;
      }
      this.logger.info('WooCommerce credentials validated', { installationId: ctx.installationId });
      return true;
    } catch (err) {
      if (err instanceof ConnectorNetworkError && err.retryable) {
        // A transient network blip (timeout, connection reset, etc.) isn't proof the
        // stored credentials are actually invalid — reporting it as CREDENTIAL_EXPIRED
        // sends the operator toward "reconnect your store," the wrong remediation for
        // something the next heartbeat will likely clear on its own (BUG-WOO-HEALTH-001 / #472).
        // Only a confirmed auth rejection (401/403, handled above) or a non-retryable
        // failure (DNS/TLS — usually a real config problem, e.g. wrong site URL) should
        // downgrade the installation.
        this.logger.warn('WooCommerce credential validation inconclusive: transient network failure, not marking expired', {
          installationId: ctx.installationId,
          category: err.category,
          detail: err.detail,
        });
        return true;
      }
      if (err instanceof MissingTenantContextError) {
        // Same #472 rationale as above, different trigger: a ConnectorContext
        // missing tenantId means our own caller built a bad context, not that
        // the customer's stored credentials are wrong. Reporting this as
        // "invalid" would send the operator toward reconnecting a store whose
        // real credentials are fine — log it loudly (this is an internal bug,
        // not a customer-facing signal) and treat as inconclusive, not expired.
        this.logger.error('WooCommerce credential validation inconclusive: caller built context without tenantId', {
          installationId: ctx.installationId,
          reason: err.message,
        });
        return true;
      }
      this.logger.warn('WooCommerce credential validation error', {
        installationId: ctx.installationId,
        reason: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  // ─── PIM#653 ──────────────────────────────────────────────────────────────
  //
  // validateCredentials() above is DELIBERATELY left untouched — #472/BUG-WOO-HEALTH-001
  // decided that for the periodic heartbeat, a transient network blip should return
  // `true` (assume still valid), because downgrading a healthy installation on a
  // one-off blip that the next heartbeat cycle will likely clear is worse than a brief
  // delay in catching a real problem. That reasoning is specific to a repeating
  // background check — it does NOT hold for install/reconnect, a one-shot,
  // user-initiated action where "we couldn't actually check" reported as success is
  // actively misleading, not a helpful default.
  //
  // This method exists ONLY for install/reconnect: same request, same stored
  // credentials, but honest about "couldn't verify right now" (unavailable, → 503,
  // captured by Error Authority, "try again") instead of quietly claiming success.
  // Classification mirrors verifyCandidateCredentials' own reasoning exactly — 401/403
  // and a non-HTTPS URL are positive evidence of invalid; any network/timeout/DNS
  // failure is unavailable.
  async validateStoredCredentialsDetailed(
    ctx: ConnectorContext,
  ): Promise<import('../../connector-framework/connector.interface').CredentialVerificationResult> {
    try {
      const { siteUrl, consumerKey, consumerSecret } = await this.resolveCredentials(ctx);

      if (!siteUrl.startsWith('https://')) {
        this.logger.warn('WooCommerce preflight failed: site URL must use HTTPS', {
          installationId: ctx.installationId,
        });
        return { outcome: 'invalid', reasonCode: 'WOOCOMMERCE_SITE_URL_NOT_HTTPS' };
      }

      const res = await this.callApi('GET', '/products?per_page=1', siteUrl, consumerKey, consumerSecret);

      if (res.status === 401 || res.status === 403) {
        this.logger.warn('WooCommerce credential validation failed: auth rejected', {
          installationId: ctx.installationId,
          status: res.status,
        });
        return { outcome: 'invalid', reasonCode: 'WOOCOMMERCE_CREDENTIALS_REJECTED' };
      }
      if (!res.ok) {
        this.logger.warn('WooCommerce credential validation failed: unexpected status', {
          installationId: ctx.installationId,
          status: res.status,
        });
        return { outcome: 'unavailable', reasonCode: `HTTP_${res.status}` };
      }
      this.logger.info('WooCommerce credentials validated', { installationId: ctx.installationId });
      return { outcome: 'valid' };
    } catch (err) {
      if (err instanceof ConnectorNetworkError) {
        this.logger.warn('WooCommerce credential validation inconclusive: transient network failure', {
          installationId: ctx.installationId,
          category: err.category,
          detail: err.detail,
        });
        return { outcome: 'unavailable', reasonCode: err.category };
      }
      this.logger.warn('WooCommerce credential validation error', {
        installationId: ctx.installationId,
        reason: err instanceof Error ? err.message : String(err),
      });
      return { outcome: 'unavailable', reasonCode: 'UNKNOWN_ERROR' };
    }
  }

  // ─── optional: verifyCandidateCredentials ───────────────────────────────────
  //
  // Pure — takes the candidate triplet directly (never reads stored credentials,
  // never writes anything). Reuses the same GET /wp-json/wc/v3/products?per_page=1
  // shape as validateCredentials — NOT the bare /wp-json/wc/v3 root, which is a
  // public route-discovery endpoint that returns 200 with no auth at all and so
  // can never actually reject wrong credentials (live-verified: garbage
  // consumer_key/consumer_secret against the bare root returned 200, "valid").
  // Classification: 401/403 → invalid (positive evidence); malformed/non-HTTPS
  // URL → invalid (the URL itself is operator input, so a deterministic
  // rejection is fair); any network/timeout/DNS failure → unavailable (an
  // unreachable endpoint isn't evidence the credentials are wrong).

  async verifyCandidateCredentials(
    candidate: Record<string, string>,
  ): Promise<import('../../connector-framework/connector.interface').CredentialVerificationResult> {
    const siteUrl = normalizeSiteUrl(String(candidate.site_url ?? '').trim());
    const consumerKey = String(candidate.consumer_key ?? '').trim();
    const consumerSecret = String(candidate.consumer_secret ?? '').trim();

    if (!siteUrl.startsWith('https://')) {
      return { outcome: 'invalid', reasonCode: 'WOOCOMMERCE_SITE_URL_NOT_HTTPS' };
    }

    try {
      const res = await this.callApi('GET', '/products?per_page=1', siteUrl, consumerKey, consumerSecret);
      if (res.status === 401 || res.status === 403) {
        return { outcome: 'invalid', reasonCode: 'WOOCOMMERCE_CREDENTIALS_REJECTED' };
      }
      if (!res.ok) {
        return { outcome: 'unavailable', reasonCode: `HTTP_${res.status}` };
      }
      return { outcome: 'valid' };
    } catch (err) {
      if (err instanceof ConnectorNetworkError) {
        return { outcome: 'unavailable', reasonCode: err.category };
      }
      return { outcome: 'unavailable', reasonCode: 'UNKNOWN_NETWORK_ERROR' };
    }
  }

  // ─── required: validateProduct ───────────────────────────────────────────────
  //
  // Local rules for W1. Live-API dry-run can be added in W2 once the
  // product-push endpoint is confirmed end-to-end.

  async validateProduct(
    _ctx: ConnectorContext,
    product: ProductPayload,
  ): Promise<ValidationResult> {
    const errors: ConnectorIssue[] = [];
    const warnings: ConnectorIssue[] = [];

    if (!product.title || String(product.title).trim().length === 0) {
      errors.push({
        code: 'WOO_TITLE_REQUIRED',
        fieldPath: 'title',
        severity: 'error',
        sellerMessage: 'Product title is required for WooCommerce.',
      });
    }

    if (product.sellingPrice != null && product.mrp != null && product.sellingPrice > product.mrp) {
      errors.push({
        code: 'WOO_PRICE_EXCEEDS_MRP',
        fieldPath: 'sellingPrice',
        severity: 'error',
        sellerMessage: 'Selling price cannot exceed MRP (regular price). Reduce the sale price or increase MRP.',
      });
    }

    if (product.sellingPrice == null || product.sellingPrice <= 0) {
      errors.push({
        code: 'WOO_PRICE_REQUIRED',
        fieldPath: 'sellingPrice',
        severity: 'error',
        sellerMessage: 'A positive selling price is required for WooCommerce listings.',
      });
    }

    if (product.hsnCode) {
      const hsn = String(product.hsnCode).replace(/\s/g, '');
      if (!/^\d{6,8}$/.test(hsn)) {
        errors.push({
          code: 'WOO_INVALID_HSN',
          fieldPath: 'hsnCode',
          severity: 'error',
          sellerMessage: 'HSN code must be 6–8 digits. Check your product classification.',
        });
      }
    }

    if (!product.brand || String(product.brand).trim().length === 0) {
      warnings.push({
        code: 'WOO_BRAND_MISSING',
        fieldPath: 'brand',
        severity: 'warning',
        sellerMessage: 'Brand is recommended for WooCommerce product attributes. Add a brand for better storefront filtering.',
      });
    }

    if (!product.mainImageUrl || String(product.mainImageUrl).trim().length === 0) {
      errors.push({
        code: 'WOO_IMAGE_REQUIRED',
        fieldPath: 'mainImageUrl',
        severity: 'error',
        sellerMessage: 'At least one product image URL is required for WooCommerce.',
      });
    } else if (!product.mainImageUrl.startsWith('https://')) {
      errors.push({
        code: 'WOO_IMAGE_NOT_HTTPS',
        fieldPath: 'mainImageUrl',
        severity: 'error',
        sellerMessage: 'Product image URL must use HTTPS. WooCommerce will refuse to serve mixed-content image URLs.',
      });
    }

    // W3: validate variants when present
    if (product.variants && product.variants.length > 0) {
      const seenSkus = new Set<string>();
      for (let i = 0; i < product.variants.length; i++) {
        const variant = product.variants[i];
        const loc = `variants[${i}]`;

        if (!variant.sku || String(variant.sku).trim().length === 0) {
          errors.push({
            code: 'WOO_VARIANT_SKU_REQUIRED',
            fieldPath: `${loc}.sku`,
            severity: 'error',
            sellerMessage: `Variant ${i + 1} is missing a SKU. Each variation must have a unique SKU.`,
          });
        } else if (seenSkus.has(variant.sku)) {
          errors.push({
            code: 'WOO_VARIANT_DUPLICATE_SKU',
            fieldPath: `${loc}.sku`,
            severity: 'error',
            sellerMessage: `Duplicate variant SKU "${variant.sku}". Each variation must have a unique SKU.`,
          });
        } else {
          seenSkus.add(variant.sku);
        }

        if (variant.sellingPrice == null || variant.sellingPrice <= 0) {
          errors.push({
            code: 'WOO_VARIANT_PRICE_REQUIRED',
            fieldPath: `${loc}.sellingPrice`,
            severity: 'error',
            sellerMessage: `Variant ${i + 1} (${variant.sku ?? 'unknown'}) must have a positive selling price.`,
          });
        } else if (variant.mrp != null && variant.sellingPrice > variant.mrp) {
          errors.push({
            code: 'WOO_VARIANT_PRICE_EXCEEDS_MRP',
            fieldPath: `${loc}.sellingPrice`,
            severity: 'error',
            sellerMessage: `Variant ${i + 1} (${variant.sku ?? 'unknown'}) selling price cannot exceed MRP.`,
          });
        }

        if (variant.imageUrl && !String(variant.imageUrl).startsWith('https://')) {
          errors.push({
            code: 'WOO_VARIANT_IMAGE_NOT_HTTPS',
            fieldPath: `${loc}.imageUrl`,
            severity: 'error',
            sellerMessage: `Variant ${i + 1} image URL must use HTTPS.`,
          });
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      source: 'LOCAL_RULES',
    };
  }

  // ─── required: normaliseError ────────────────────────────────────────────────

  normaliseError(errorCode: string, rawMessage: string): ConnectorIssue {
    const entry = WC_ERROR_MAP[errorCode];
    if (entry) {
      return {
        code: errorCode,
        fieldPath: entry.fieldPath,
        severity: entry.severity,
        sellerMessage: entry.sellerMessage,
      };
    }
    return {
      code: 'WOO_UNKNOWN_ERROR',
      fieldPath: '',
      severity: 'error',
      sellerMessage: `An unexpected WooCommerce error occurred. Contact support with code: ${errorCode}. Detail: ${rawMessage}`,
    };
  }

  // ─── optional: parseWebhookEvent ────────────────────────────────────────────
  //
  // WooCommerce webhooks deliver JSON with:
  //   X-WC-Webhook-Topic      : e.g. "product.updated"
  //   X-WC-Webhook-Signature  : base64(HMAC-SHA256(rawBody, webhook_secret))
  //   X-WC-Webhook-Source     : store URL
  //   X-WC-Webhook-ID         : numeric webhook definition ID
  //   X-WC-Webhook-Delivery-ID: unique delivery ID (for dedup / replay)
  //
  // W5a: When ctx.installationId is present (provided by ConnectorWebhookIngestionService),
  //      looks up the per-installation webhook_secret credential. Falls back to the app-level
  //      env var PIM_WOOCOMMERCE_WEBHOOK_SECRET when ctx is absent or credential not found.
  //      This makes each WooCommerce store independently secured with its own secret.

  async parseWebhookEvent(
    rawBody: Buffer,
    headers: Record<string, string>,
    ctx?: { tenantId?: string; installationId: string },
  ): Promise<ParsedWebhookEvent | null> {
    // W5a: prefer per-installation secret; fall back to shared env var
    let webhookSecret: string | null = null;
    const tenantKey = String(ctx?.tenantId ?? '').trim();
    if (tenantKey && ctx?.installationId) {
      webhookSecret = await this.fetchCredentialPlaintext(tenantKey, ctx.installationId, 'webhook_secret');
    }
    if (!webhookSecret) {
      webhookSecret = String(process.env['PIM_WOOCOMMERCE_WEBHOOK_SECRET'] ?? '').trim() || null;
    }

    if (!webhookSecret) {
      this.logger.warn(
        'WooCommerce webhook received but no webhook_secret found ' +
        '(neither per-installation credential nor PIM_WOOCOMMERCE_WEBHOOK_SECRET env var) — rejecting',
        ctx?.installationId ? { installationId: ctx.installationId } : {},
      );
      return null;
    }

    // HMAC-SHA256 verification
    const signature = String(headers['x-wc-webhook-signature'] ?? '').trim();
    if (!signature) {
      this.logger.warn('WooCommerce webhook missing X-WC-Webhook-Signature header');
      return null;
    }

    const expectedMac = createHmac('sha256', webhookSecret).update(rawBody).digest('base64');
    const expectedBuf = Buffer.from(expectedMac, 'utf8');
    const actualBuf   = Buffer.from(signature, 'utf8');

    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
      this.logger.warn('WooCommerce webhook HMAC mismatch — rejecting');
      return null;
    }

    const topic      = String(headers['x-wc-webhook-topic'] ?? '').toLowerCase().trim();
    const deliveryId = String(headers['x-wc-webhook-delivery-id'] ?? '').trim();

    if (!topic || !deliveryId) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      this.logger.warn('WooCommerce webhook body is not valid JSON', { topic });
      return null;
    }

    const payload = parsed as WcWebhookProductPayload;

    // Only handle product topics in W1 (order topics deferred — PII / DPDP scope)
    if (!topic.startsWith('product.')) {
      this.logger.info('WooCommerce webhook topic not handled in W1', { topic });
      return null;
    }

    const wcProductId = payload.id != null ? String(payload.id) : undefined;

    const vexaSku = payload.meta_data
      ?.find((m) => m.key === '_vexa_pim_product_id')
      ?.value != null
      ? String(payload.meta_data.find((m) => m.key === '_vexa_pim_product_id')!.value)
      : undefined;

    const eventType = topic === 'product.deleted' ? 'PRODUCT_DEACTIVATED' : 'PRODUCT_STATUS_CHANGED';

    let status: 'SUCCESS' | 'REJECTED' | 'SUPPRESSED' | undefined;
    if (topic === 'product.deleted') {
      status = 'SUPPRESSED';
    } else if (payload.status === 'trash') {
      status = 'SUPPRESSED';
    } else if (payload.status === 'publish') {
      status = 'SUCCESS';
    }

    return {
      eventType,
      externalRef: wcProductId,
      productSku: vexaSku ?? (payload.sku ? String(payload.sku) : undefined),
      ...(status ? { status } : {}),
      channelErrors: [],
      rawEventId: deliveryId,
    };
  }

  // ─── optional: handleOAuthCallback ──────────────────────────────────────────
  //
  // WooCommerce app-auth delivers credentials to our callback URL as query params:
  //   consumer_key, consumer_secret, user_id, key_permissions
  //
  // The site_url must already be stored (captured at install-start before the admin
  // is redirected to /wc-auth/v1/authorize). This callback stores consumer_key and
  // consumer_secret, completing the mandatory credential set.

  async handleOAuthCallback(
    ctx: ConnectorContext,
    params: Record<string, string>,
  ): Promise<void> {
    const consumerKey    = String(params['consumer_key']    ?? '').trim();
    const consumerSecret = String(params['consumer_secret'] ?? '').trim();
    const tenantKey = String(ctx.tenantId ?? '').trim();

    if (!consumerKey || !consumerSecret) {
      throw new Error('WooCommerce app-auth callback missing consumer_key or consumer_secret.');
    }
    if (!tenantKey) {
      throw new MissingTenantContextError('WooCommerce app-auth callback missing tenant context.');
    }

    const db = this.prismaDirect.getClient();
    const keyVersion = this.currentKeyVersion;
    const key = this.keys.get(keyVersion);
    if (!key) {
      throw new Error('WooCommerce OAuth callback: credential encryption key not loaded.');
    }

    const encKey    = buildEncryptedCredential(consumerKey, keyVersion, this.keys);
    const encSecret = buildEncryptedCredential(consumerSecret, keyVersion, this.keys);
    const versionLabel = formatCredentialKeyVersion(keyVersion);

    // The WHERE clause on ON CONFLICT is the actual tenant-ownership guard, not
    // just the tenant_key column being present in the INSERT list: if `id`
    // (installationId + credential type) ever collides with a row already
    // owned by a DIFFERENT tenant, the WHERE condition is false, so Postgres
    // treats it as no-op (0 rows affected) instead of silently overwriting
    // that other tenant's credential row. installationId is a crypto.randomUUID()
    // (see connector-installer.service.ts), so a genuine cross-tenant `id`
    // collision here would mean a UUID collision or a caller bug upstream —
    // either way, failing loudly beats silently succeeding into someone else's
    // tenant. affectedRows === 0 is checked below and turned into an explicit
    // error rather than treated as a successful write.
    await db.$transaction(async (tx) => {
      const keyRowsAffected = await tenantExecRaw(tx, `
        INSERT INTO connector_credentials (
          id, tenant_key, installation_id, credential_type, encrypted_value, key_version,
          status, metadata, last_refresh_at, updated_at
        ) VALUES (
          $1, $2, $3, 'consumer_key', $4, $5, 'ACTIVE',
          '{"source":"app_auth_callback"}'::jsonb, NOW(), NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          tenant_key       = EXCLUDED.tenant_key,
          installation_id  = EXCLUDED.installation_id,
          encrypted_value = EXCLUDED.encrypted_value,
          key_version     = EXCLUDED.key_version,
          status          = 'ACTIVE',
          metadata        = EXCLUDED.metadata,
          last_refresh_at = NOW(),
          updated_at      = NOW()
        WHERE connector_credentials.tenant_key = EXCLUDED.tenant_key
      `, [`${ctx.installationId}:consumer_key`, tenantKey, ctx.installationId, encKey.cipher, versionLabel]);

      if (keyRowsAffected === 0) {
        throw new Error(
          `WooCommerce app-auth callback: consumer_key credential id already owned by a different tenant (installationId=${ctx.installationId}).`,
        );
      }

      const secretRowsAffected = await tenantExecRaw(tx, `
        INSERT INTO connector_credentials (
          id, tenant_key, installation_id, credential_type, encrypted_value, key_version,
          status, metadata, last_refresh_at, updated_at
        ) VALUES (
          $1, $2, $3, 'consumer_secret', $4, $5, 'ACTIVE',
          '{"source":"app_auth_callback"}'::jsonb, NOW(), NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          tenant_key       = EXCLUDED.tenant_key,
          installation_id  = EXCLUDED.installation_id,
          encrypted_value = EXCLUDED.encrypted_value,
          key_version     = EXCLUDED.key_version,
          status          = 'ACTIVE',
          metadata        = EXCLUDED.metadata,
          last_refresh_at = NOW(),
          updated_at      = NOW()
        WHERE connector_credentials.tenant_key = EXCLUDED.tenant_key
      `, [`${ctx.installationId}:consumer_secret`, tenantKey, ctx.installationId, encSecret.cipher, versionLabel]);

      if (secretRowsAffected === 0) {
        throw new Error(
          `WooCommerce app-auth callback: consumer_secret credential id already owned by a different tenant (installationId=${ctx.installationId}).`,
        );
      }
    });

    this.logger.info('WooCommerce app-auth callback credentials stored', {
      installationId: ctx.installationId,
      keyPermissions: params['key_permissions'] ?? 'unknown',
    });
  }

  // ─── optional: publishProduct ───────────────────────────────────────────────
  //
  // W2: Idempotent upsert — look up existing WC product by _vexa_pim_product_id
  // before creating. If found, PUT /products/{id}; otherwise POST /products.
  // Resolves WC categories (from productType) and tags before pushing.

  async publishProduct(
    ctx: ConnectorContext,
    product: ProductPayload,
  ): Promise<SubmissionRef> {
    const { siteUrl, consumerKey, consumerSecret } = await this.resolveCredentials(ctx);

    const categoryNames = product.productType ? [product.productType] : [];
    const tagNames      = product.tags ?? [];

    const [categoryIds, tagIds, existingId] = await Promise.all([
      categoryNames.length > 0
        ? this.resolveTermIds(siteUrl, consumerKey, consumerSecret, categoryNames, '/products/categories')
        : Promise.resolve([] as number[]),
      tagNames.length > 0
        ? this.resolveTermIds(siteUrl, consumerKey, consumerSecret, tagNames, '/products/tags')
        : Promise.resolve([] as number[]),
      this.findExistingProductId(siteUrl, consumerKey, consumerSecret, product.sku),
    ]);

    const wcProduct = this.buildWcProductPayload(product, categoryIds, tagIds);

    const method = existingId != null ? 'PUT' : 'POST';
    const path   = existingId != null ? `/products/${existingId}` : '/products';

    const res = await this.callApi(method, path, siteUrl, consumerKey, consumerSecret, wcProduct);
    if (!res.ok) {
      const body = await res.text();
      let errorCode = `HTTP_${res.status}`;
      try {
        const parsed = JSON.parse(body) as WcProductResponse;
        if (parsed.code) errorCode = parsed.code;
      } catch { /* ignore */ }
      throw new Error(`WooCommerce product publish failed: ${errorCode} — ${body.slice(0, 200)}`);
    }
    const data = await res.json() as WcProductResponse;
    const parentId = data.id ?? existingId;

    // W3: upsert variations for variable products (W4: pass gstRate for tax class)
    if (product.variants && product.variants.length > 0 && parentId != null) {
      await this.upsertVariations(siteUrl, consumerKey, consumerSecret, parentId, product.variants, product.gstRate);
    }

    return {
      externalRef: String(parentId ?? ''),
      status: this.mapWcProductStatus(data.status),
      isAsync: false,
    };
  }

  // ─── optional: updateProduct ─────────────────────────────────────────────────
  //
  // PUT /products/{externalRef} — updates an already-published WC product.
  // Resolves categories and tags the same way as publishProduct.

  async updateProduct(
    ctx: ConnectorContext,
    product: ProductPayload,
    externalRef: string,
  ): Promise<SubmissionRef> {
    const { siteUrl, consumerKey, consumerSecret } = await this.resolveCredentials(ctx);

    const categoryNames = product.productType ? [product.productType] : [];
    const tagNames      = product.tags ?? [];

    const [categoryIds, tagIds] = await Promise.all([
      categoryNames.length > 0
        ? this.resolveTermIds(siteUrl, consumerKey, consumerSecret, categoryNames, '/products/categories')
        : Promise.resolve([] as number[]),
      tagNames.length > 0
        ? this.resolveTermIds(siteUrl, consumerKey, consumerSecret, tagNames, '/products/tags')
        : Promise.resolve([] as number[]),
    ]);

    const wcProduct = this.buildWcProductPayload(product, categoryIds, tagIds);

    const res = await this.callApi('PUT', `/products/${externalRef}`, siteUrl, consumerKey, consumerSecret, wcProduct);
    if (!res.ok) {
      const body = await res.text();
      let errorCode = `HTTP_${res.status}`;
      try {
        const parsed = JSON.parse(body) as WcProductResponse;
        if (parsed.code) errorCode = parsed.code;
      } catch { /* ignore */ }
      throw new Error(`WooCommerce product update failed: ${errorCode} — ${body.slice(0, 200)}`);
    }
    const data = await res.json() as WcProductResponse;
    const parsed = parseInt(externalRef, 10);
    const parentId = data.id ?? (isNaN(parsed) ? undefined : parsed);

    // W3: upsert variations for variable products (W4: pass gstRate for tax class)
    if (product.variants && product.variants.length > 0 && parentId != null) {
      await this.upsertVariations(siteUrl, consumerKey, consumerSecret, parentId, product.variants, product.gstRate);
    }

    return {
      externalRef: String(data.id ?? externalRef),
      status: this.mapWcProductStatus(data.status),
      isAsync: false,
    };
  }

  // ─── PIM#660 ──────────────────────────────────────────────────────────────
  //
  // Shared status mapping between publishProduct/updateProduct (which already have
  // the real WC product record in hand from their own REST response) and
  // syncSubmissionStatus (which fetches it separately for polling). Kept as one
  // function so the two paths can never drift into disagreeing about what a given
  // WooCommerce product status means.
  private mapWcProductStatus(wcStatusRaw: unknown): SubmissionRef['status'] {
    const wcStatus = String(wcStatusRaw ?? '').toLowerCase();
    return (
      wcStatus === 'publish'  ? 'SUCCESS'  :
      wcStatus === 'draft'    ? 'PENDING'  :
      wcStatus === 'pending'  ? 'PENDING'  :
      wcStatus === 'private'  ? 'SUPPRESSED' :
      wcStatus === 'trash'    ? 'REJECTED' : 'PENDING'
    );
  }

  // ─── optional: syncSubmissionStatus (W5+) ───────────────────────────────────

  async syncSubmissionStatus(
    ctx: ConnectorContext,
    externalRef: string,
  ): Promise<SubmissionStatusUpdate> {
    const { siteUrl, consumerKey, consumerSecret } = await this.resolveCredentials(ctx);
    const res = await this.callApi('GET', `/products/${externalRef}`, siteUrl, consumerKey, consumerSecret);
    if (res.status === 404) {
      return {
        externalRef,
        status: 'REJECTED',
        channelErrors: [{
          code: 'WOO_PRODUCT_NOT_FOUND',
          fieldPath: '',
          severity: 'error',
          sellerMessage: 'Product not found on WooCommerce store. It may have been deleted.',
        }],
      };
    }
    if (!res.ok) {
      return { externalRef, status: 'ERROR', channelErrors: [] };
    }
    const data = await res.json() as WcProductResponse;
    const status = this.mapWcProductStatus(data.status);

    // W5b: when WC says publish but no webhook confirmed it, check if webhooks are healthy.
    // Skipped for non-SUCCESS outcomes — those have their own error signals.
    const channelErrors: ConnectorIssue[] = [];
    if (status === 'SUCCESS') {
      const webhookHealthWarning = await this.checkWebhookHealth(ctx.installationId);
      if (webhookHealthWarning) channelErrors.push(webhookHealthWarning);
    }

    return { externalRef, status, channelErrors };
  }

  // ─── W6: pim_wins drift detection ────────────────────────────────────────────
  //
  // Called by WooCommerceReconciliationService. Fetches the live WC product and
  // compares key fields against the stored payload snapshot. Returns needsRepublish
  // when WC has drifted from PIM state.
  //
  // Checked fields (v1): title, status (publish vs expected), regular_price.
  // Additional fields (description, images, etc.) can be added in later increments.

  async reconcileSubmission(
    ctx: ConnectorContext,
    externalRef: string,
    payloadSnapshot: Record<string, unknown>,
  ): Promise<{ needsRepublish: boolean; driftedFields: string[] }> {
    try {
      const { siteUrl, consumerKey, consumerSecret } = await this.resolveCredentials(ctx);
      const res = await this.callApi('GET', `/products/${externalRef}`, siteUrl, consumerKey, consumerSecret);
      if (!res.ok) return { needsRepublish: false, driftedFields: [] }; // can't compare — skip

      const wc = await res.json() as WcProductResponse & { name?: string; regular_price?: string };
      const driftedFields: string[] = [];

      const title = typeof payloadSnapshot['title'] === 'string' ? payloadSnapshot['title'] : null;
      if (title && wc.name && wc.name !== title) driftedFields.push('title');

      const mrp = typeof payloadSnapshot['mrp'] === 'number' ? payloadSnapshot['mrp'] : null;
      if (mrp != null && wc.regular_price != null && wc.regular_price !== String(mrp)) driftedFields.push('regular_price');

      const snapshotStatus = typeof payloadSnapshot['status'] === 'string' ? payloadSnapshot['status'] : null;
      const expectedWcStatus = snapshotStatus === 'DRAFT' ? 'draft' : 'publish';
      if (wc.status && wc.status !== expectedWcStatus) driftedFields.push('status');

      return { needsRepublish: driftedFields.length > 0, driftedFields };
    } catch (err) {
      this.logger.warn('WooCommerce reconcileSubmission error', {
        installationId: ctx.installationId,
        externalRef,
        reason: err instanceof Error ? err.message : String(err),
      });
      return { needsRepublish: false, driftedFields: [] };
    }
  }

  // ─── W6: reconstruct a minimal ProductPayload from a stored snapshot ─────────
  //
  // The payload snapshot stored in connector_submissions is a Record<string,unknown>
  // typed by Prisma's Json column. This method casts it back to a ProductPayload
  // shape suitable for passing to updateProduct.

  snapshotToProductPayload(snapshot: Record<string, unknown>): import('./../../connector-framework/connector.interface').ProductPayload {
    return snapshot as unknown as import('./../../connector-framework/connector.interface').ProductPayload;
  }

  // ─── internal: WC product payload builder ───────────────────────────────────
  //
  // W2: accepts resolved categoryIds and tagIds; includes additionalImageUrls (up to 8).
  // W3: detects product.variants → type='variable'; injects variation attributes with
  //     variation:true alongside any fixed product attributes (brand, hsn).

  private buildWcProductPayload(
    product: ProductPayload,
    categoryIds: number[] = [],
    tagIds: number[] = [],
  ): WcProductPayload {
    const metaData: Array<{ key: string; value: string }> = [
      { key: '_vexa_pim_product_id', value: product.sku },
      { key: '_vexa_pim_sync_ts',    value: new Date().toISOString() },
    ];

    if (product.hsnCode) {
      metaData.push({ key: '_vexa_hsn_code', value: String(product.hsnCode) });
    }
    if (product.gstRate != null) {
      metaData.push({ key: '_vexa_gst_rate',       value: String(product.gstRate) });
      // W9: explicit GST-applicability flag for Indian GST plugins (Woo GST India, Webkul GST).
      // 'yes' for any product with a known gstRate (including 0% exempt); absent when rate unknown.
      metaData.push({ key: '_vexa_gst_applicable', value: 'yes' });
    }
    metaData.push(...this.normalizeCustomMeta(product.customMeta));

    const images: Array<{ src: string }> = [];
    if (product.mainImageUrl) {
      images.push({ src: product.mainImageUrl });
    }
    for (const url of (product.additionalImageUrls ?? []).slice(0, 8)) {
      if (url && url.startsWith('https://')) images.push({ src: url });
    }

    const isVariable = product.variants != null && product.variants.length > 0;

    // Fixed attributes (brand, hsn) are always included.
    // For variable products, variation-dimension attributes are appended with variation:true.
    const attrs: Array<{ name: string; options: string[]; visible: boolean; variation?: boolean }> = [];
    if (product.brand) {
      attrs.push({ name: 'Brand', options: [product.brand], visible: true });
    }
    if (product.hsnCode) {
      attrs.push({ name: 'HSN Code', options: [String(product.hsnCode)], visible: false });
    }
    if (isVariable && product.variants) {
      const variationAttrs = this.buildVariationAttributes(product.variants);
      attrs.push(...variationAttrs);
    }

    // W4: resolve pricing from marketPrices (IN market preferred) and tax class from gstRate
    const { regularPrice, salePrice } = this.resolvePricing(
      product.mrp,
      product.sellingPrice,
      product.marketPrices,
    );
    const taxClass = this.resolveTaxClass(product.gstRate);

    const payload: WcProductPayload & {
      categories?: Array<{ id: number }>;
      tags?: Array<{ id: number }>;
    } = {
      name: product.title,
      type: isVariable ? 'variable' : 'simple',
      status: product.status === 'DRAFT' ? 'draft' : 'publish',
      description: product.description ?? '',
      sku: product.sku,
      regular_price: regularPrice,
      sale_price: salePrice,
      tax_class: taxClass,
      images,
      attributes: attrs,
      meta_data: metaData,
    };

    if (categoryIds.length > 0) {
      payload.categories = categoryIds.map((id) => ({ id }));
    }
    if (tagIds.length > 0) {
      payload.tags = tagIds.map((id) => ({ id }));
    }

    return payload;
  }

  private normalizeCustomMeta(customMeta: ProductPayload['customMeta']): Array<{ key: string; value: string }> {
    if (!Array.isArray(customMeta)) {
      return [];
    }
    const reserved = new Set([
      '_vexa_pim_product_id',
      '_vexa_pim_sync_ts',
      '_vexa_hsn_code',
      '_vexa_gst_rate',
      '_vexa_gst_applicable',
    ]);
    const normalized: Array<{ key: string; value: string }> = [];
    const seen = new Set(reserved);
    for (const item of customMeta) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const key = String(item.key ?? '').trim();
      const value = this.stringifyMetaValue(item.value);
      if (!key || !value || seen.has(key)) {
        continue;
      }
      seen.add(key);
      normalized.push({ key, value });
    }
    return normalized;
  }

  private stringifyMetaValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'string') {
      return value.trim();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return JSON.stringify(value);
  }

  // ─── W8: brownfield import — paginated product list ──────────────────────────
  //
  // Called by WooCommerceBrownfieldImportService. Returns one page of WC products
  // with their meta_data so the import service can link them to PIM records.
  // totalPages is parsed from the X-WP-TotalPages response header.

  async listProductsPage(
    ctx: ConnectorContext,
    page: number,
    perPage: number,
  ): Promise<{ items: WcProductListItem[]; totalPages: number }> {
    const { siteUrl, consumerKey, consumerSecret } = await this.resolveCredentials(ctx);
    const res = await this.callApi(
      'GET',
      `/products?page=${page}&per_page=${perPage}&status=any`,
      siteUrl,
      consumerKey,
      consumerSecret,
    );
    if (!res.ok) {
      return { items: [], totalPages: 0 };
    }
    const raw = await res.json() as unknown;
    const items = Array.isArray(raw) ? (raw as WcProductListItem[]) : [];
    const totalPages = Math.max(1, parseInt(res.headers.get('X-WP-TotalPages') ?? '1', 10));
    return { items, totalPages };
  }
}
