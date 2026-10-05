// apps/api/src/connectors/bigcommerce/bigcommerce.connector.ts
//
// Capabilities: PUBLISH + VALIDATE + STATUS_SYNC
// implementationStatus: full (code-complete); launch stage: under_development
// (see connector-launch-policy.ts).
//
// Auth: BigCommerce V3 Catalog API — a static store API account token sent
// as the X-Auth-Token header. No OAuth, no token refresh.
//
// Credential storage (ConnectorCredential rows per installationId):
//   credentialType: 'store_hash'  — e.g. "abc123", the store identifier from
//                                   the store's Store API Accounts URL
//                                   (https://api.bigcommerce.com/stores/{store_hash}/v3)
//   credentialType: 'api_key'     — the Store API account's Access Token
//
// Ported from the Vexa Connector Hub prototype (2026-09-22), which was
// sandbox-verified against a real BigCommerce trial store with no bugs
// found — but no live credentials exist in this environment to re-verify
// this TypeScript port, so treat it the same as the other ported connectors
// that haven't been re-proven from within PIM1 itself.

import { Injectable } from "@nestjs/common";
import { LoggerService } from "../../common/logging/logger.service";
import {
  decryptCredentialValue,
  parseCredentialKeyVersion,
  loadCredentialEncryptionKeys,
} from "../../connector-installer/credential-encryption.util";
import {
  ConnectorCap,
  ConnectorContext,
  ConnectorImplementationStatus,
  ConnectorInterface,
  ConnectorIssue,
  CredentialVerificationResult,
  ProductPayload,
  SubmissionRef,
  SubmissionStatusUpdate,
  ValidationResult,
} from "../../connector-framework/connector.interface";
import { ConnectorNetworkError } from "../../connector-framework/connector.errors";
import { PrismaDirectService } from "../../prisma/prisma-direct.service";

const CONNECTOR_HTTP_TIMEOUT_MS = 30_000;

// Shared by validateProduct() and buildProductPayload() so a malformed
// bigcommerce_category_id is always treated the same way in both places —
// buildProductPayload silently omits anything that doesn't match this, so
// validateProduct must reject the same shapes rather than let the product
// publish with its intended category quietly dropped.
const CATEGORY_ID_PATTERN = /^\d+$/;

// ─── network-failure classification (mirrors odoo.connector.ts / woocommerce.connector.ts) ─────
//
// Every BigCommerce call goes through fetchWithTimeout(), so classifying here
// covers credential validation, publish, update and status sync alike. api.
// bigcommerce.com is a fixed host (store_hash is a path segment, not a URL),
// so DNS/TLS failures here point at network middleboxes or a BigCommerce-side
// outage rather than a bad tenant-supplied hostname — but the category still
// matters for telling a transient blip apart from something durable.
function classifyFetchFailure(
  err: unknown,
): { category: "TIMEOUT" | "DNS" | "TLS" | "NETWORK"; retryable: boolean; detail: string } {
  if (err instanceof Error && err.name === "AbortError") {
    return { category: "TIMEOUT", retryable: true, detail: `request exceeded ${CONNECTOR_HTTP_TIMEOUT_MS}ms timeout` };
  }
  const cause = err instanceof Error ? (err.cause as { code?: string; message?: string } | undefined) : undefined;
  const causeCode = cause?.code ?? "";
  if (causeCode === "ENOTFOUND" || causeCode === "EAI_AGAIN") {
    return { category: "DNS", retryable: false, detail: `DNS resolution failed (${causeCode})` };
  }
  if (causeCode.startsWith("ERR_TLS") || causeCode.startsWith("CERT_")) {
    return { category: "TLS", retryable: false, detail: `TLS/certificate error (${causeCode})` };
  }
  if (causeCode === "ECONNREFUSED" || causeCode === "ECONNRESET" || causeCode === "EHOSTUNREACH" || causeCode === "ETIMEDOUT") {
    return { category: "NETWORK", retryable: true, detail: `connection failed (${causeCode})` };
  }
  const detail = cause?.message || (err instanceof Error ? err.message : String(err));
  return { category: "NETWORK", retryable: true, detail: detail || "unknown network failure" };
}

type ResolvedCredentials = { storeHash: string; apiKey: string };

const ERROR_MESSAGES: Record<string, string> = {
  DuplicateSKUError: "This SKU already exists in BigCommerce. Update the existing product instead.",
  ProductValidationError: "BigCommerce validation failed. Check name, price and weight.",
  InvalidCategoryIdError: "The mapped BigCommerce category id does not exist.",
  TooManyOptionsError: "BigCommerce allows at most 600 variants / 5 options per product.",
};

export class BigCommercePublishError extends Error {
  constructor(
    public readonly issues: ConnectorIssue[],
    message: string,
  ) {
    super(message);
    this.name = "BigCommercePublishError";
  }
}

@Injectable()
export class BigCommerceConnector implements ConnectorInterface {
  readonly slug = "bigcommerce";
  readonly displayName = "BigCommerce";
  readonly capabilities: ConnectorCap[] = ["PUBLISH", "VALIDATE", "STATUS_SYNC"];
  readonly implementationStatus: ConnectorImplementationStatus = "full";

  private readonly keys = loadCredentialEncryptionKeys(process.env);

  constructor(
    private readonly prismaDirect: PrismaDirectService,
    private readonly logger: LoggerService,
  ) {}

  // ─── credential helpers ─────────────────────────────────────────────────

  private async getPlainCredential(ctx: ConnectorContext, credentialType: string): Promise<string | null> {
    const db = this.prismaDirect.getClient();
    const row = await db.connectorCredential.findFirst({
      where: { tenantKey: ctx.tenantId, installationId: ctx.installationId, credentialType },
      select: { encryptedValue: true, keyVersion: true },
    });
    if (!row) {
      return null;
    }
    const version = parseCredentialKeyVersion(row.keyVersion ?? "v1");
    const key = this.keys.get(version);
    if (!key) {
      return null;
    }
    return decryptCredentialValue(row.encryptedValue, key);
  }

  private async resolveCredentials(ctx: ConnectorContext): Promise<ResolvedCredentials> {
    const [storeHash, apiKey] = await Promise.all([
      this.getPlainCredential(ctx, "store_hash"),
      this.getPlainCredential(ctx, "api_key"),
    ]);
    if (!storeHash || !apiKey) {
      throw new Error("BigCommerce credentials incomplete. Verify store_hash and api_key are stored.");
    }
    return { storeHash, apiKey };
  }

  private apiBase(storeHash: string): string {
    return `https://api.bigcommerce.com/stores/${storeHash}/v3`;
  }

  private buildHeaders(apiKey: string): Record<string, string> {
    return { "X-Auth-Token": apiKey, "Content-Type": "application/json", Accept: "application/json" };
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(CONNECTOR_HTTP_TIMEOUT_MS) });
    } catch (err) {
      const { category, retryable, detail } = classifyFetchFailure(err);
      this.logger.warn("BigCommerce fetchWithTimeout network failure", {
        url,
        category,
        retryable,
        detail,
        cause: err instanceof Error && err.cause ? String(err.cause) : undefined,
      });
      throw new ConnectorNetworkError("bigcommerce", category, retryable, detail);
    }
  }

  // ─── required: validateCredentials ───────────────────────────────────────

  async validateCredentials(ctx: ConnectorContext): Promise<boolean> {
    const result = await this.validateStoredCredentialsDetailed(ctx);
    return result.outcome === "valid";
  }

  async validateStoredCredentialsDetailed(ctx: ConnectorContext): Promise<CredentialVerificationResult> {
    try {
      const { storeHash, apiKey } = await this.resolveCredentials(ctx);
      const response = await this.fetchWithTimeout(`${this.apiBase(storeHash)}/catalog/summary`, {
        headers: this.buildHeaders(apiKey),
      });
      if (response.status === 401 || response.status === 403) {
        return { outcome: "invalid", reasonCode: `HTTP_${response.status}` };
      }
      if (!response.ok) {
        return { outcome: "unavailable", reasonCode: `HTTP_${response.status}` };
      }
      return { outcome: "valid" };
    } catch (error) {
      if (error instanceof ConnectorNetworkError) {
        // fetchWithTimeout already logged the classified failure — no need
        // to duplicate that warning here.
        return { outcome: "unavailable", reasonCode: error.category };
      }
      this.logger.warn("BigCommerce credential validation failed", {
        installationId: ctx.installationId,
        reason: error instanceof Error ? error.message : String(error),
      });
      return { outcome: "unavailable", reasonCode: "UNKNOWN_NETWORK_ERROR" };
    }
  }

  // ─── optional: verifyCandidateCredentials ───────────────────────────────

  async verifyCandidateCredentials(candidate: Record<string, string>): Promise<CredentialVerificationResult> {
    const storeHash = String(candidate.store_hash ?? "").trim();
    const apiKey = String(candidate.api_key ?? "").trim();
    try {
      const response = await this.fetchWithTimeout(`${this.apiBase(storeHash)}/catalog/summary`, {
        headers: this.buildHeaders(apiKey),
      });
      if (response.status === 401 || response.status === 403) {
        return { outcome: "invalid", reasonCode: `HTTP_${response.status}` };
      }
      if (!response.ok) {
        return { outcome: "unavailable", reasonCode: `HTTP_${response.status}` };
      }
      return { outcome: "valid" };
    } catch (error) {
      if (error instanceof ConnectorNetworkError) {
        return { outcome: "unavailable", reasonCode: error.category };
      }
      return { outcome: "unavailable", reasonCode: "UNKNOWN_NETWORK_ERROR" };
    }
  }

  // ─── required: validateProduct ───────────────────────────────────────────

  async validateProduct(_ctx: ConnectorContext, product: ProductPayload): Promise<ValidationResult> {
    const errors: ConnectorIssue[] = [];
    const warnings: ConnectorIssue[] = [];
    const attrs = product.attributes ?? {};

    if (!product.title || String(product.title).trim().length === 0) {
      errors.push({ code: "MISSING_NAME", fieldPath: "title", sellerMessage: "name is required for BigCommerce.", severity: "error" });
    } else if (product.title.length > 250) {
      errors.push({ code: "NAME_TOO_LONG", fieldPath: "title", sellerMessage: "BigCommerce product names must be 250 characters or fewer.", severity: "error" });
    }
    if (product.sellingPrice == null || product.sellingPrice < 0) {
      errors.push({ code: "MISSING_PRICE", fieldPath: "sellingPrice", sellerMessage: "price must be a non-negative number.", severity: "error" });
    }
    if (attrs["weight_kg"] == null) {
      errors.push({
        code: "MISSING_WEIGHT",
        fieldPath: "attributes.weight_kg",
        sellerMessage: "Physical products on BigCommerce require a weight (in the store's weight unit).",
        severity: "error",
      });
    }
    const categoryId = attrs["bigcommerce_category_id"];
    if (categoryId != null && String(categoryId).trim().length > 0 && !CATEGORY_ID_PATTERN.test(String(categoryId))) {
      // buildProductPayload() drops anything that fails this same pattern
      // test rather than sending it to BigCommerce, so without this check a
      // typo'd category id would silently publish with no category at all —
      // not an error the tenant would ever see.
      errors.push({
        code: "INVALID_CATEGORY_ID_FORMAT",
        fieldPath: "attributes.bigcommerce_category_id",
        sellerMessage: "attributes.bigcommerce_category_id must be a whole number matching a BigCommerce category id.",
        severity: "error",
      });
    }

    return { isValid: errors.length === 0, errors, warnings, source: "LOCAL_RULES" };
  }

  normaliseError(errorCode: string, rawMessage: string): ConnectorIssue {
    const normalizedCode = String(errorCode ?? "").trim();
    const entry = ERROR_MESSAGES[normalizedCode];
    const fieldPath =
      normalizedCode === "DuplicateSKUError" ? "sku"
      : normalizedCode === "InvalidCategoryIdError" ? "attributes.bigcommerce_category_id"
      : normalizedCode === "TooManyOptionsError" ? "attributes"
      : "";
    const sellerMessage = entry ?? (String(rawMessage ?? "").trim() || `BigCommerce returned an error: ${normalizedCode || "UNKNOWN"}.`);
    return { code: normalizedCode || "BIGCOMMERCE_ERROR", fieldPath, sellerMessage, severity: "error" };
  }

  // ─── payload building ───────────────────────────────────────────────────

  private buildProductPayload(product: ProductPayload): Record<string, unknown> {
    const attrs = product.attributes ?? {};
    const categoryId = attrs["bigcommerce_category_id"];
    const images = [product.mainImageUrl, ...(product.additionalImageUrls ?? [])]
      .filter((url): url is string => typeof url === "string" && url.trim().length > 0)
      .map((url, index) => ({ image_url: url, is_thumbnail: index === 0 }));
    // weight_kg is already sent as the structured `weight` field below, so
    // (like the "_id" attrs, which map to structured fields such as
    // categories) it's excluded here to avoid showing a duplicate
    // "Weight Kg" custom field on every physical product.
    const customFields = Object.entries(attrs)
      .filter(([key]) => !key.endsWith("_id") && key !== "weight_kg")
      .map(([key, value]) => ({ name: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), value: String(value) }));

    return {
      name: product.title,
      type: "physical",
      weight: typeof attrs["weight_kg"] === "number" ? attrs["weight_kg"] : Number(attrs["weight_kg"] ?? 0.5) || 0.5,
      price: product.sellingPrice ?? 0,
      sku: product.sku,
      description: product.description || product.title,
      is_visible: true,
      availability: "available",
      brand_name: product.brand || "",
      categories: CATEGORY_ID_PATTERN.test(String(categoryId ?? "")) ? [Number(categoryId)] : [],
      images,
      custom_fields: customFields,
    };
  }

  // ─── optional: publishProduct ────────────────────────────────────────────

  // A failed export job is replayed from the top, and BigCommerce has no idempotency key. The
  // provider does enforce unique SKUs and names (409), so a replayed create cannot duplicate the
  // product, but it would report a failure for a product that exists. So: look the SKU up first and,
  // when the product that is there is the one this create would have made (same SKU and name),
  // return it as the result; if the create itself answers 409, look again (an earlier attempt may
  // have finished in between). A product with the same SKU but a different name is somebody else's:
  // that stays the conflict it always was and is never reported as published.
  async publishProduct(ctx: ConnectorContext, product: ProductPayload): Promise<SubmissionRef> {
    const { storeHash, apiKey } = await this.resolveCredentials(ctx);
    const payload = this.buildProductPayload(product);

    const existing = await this.findProductBySku(storeHash, apiKey, product.sku);
    if (existing) {
      const reconciled = this.reconcileExistingProduct(ctx, product, payload, existing, "lookup_before_create");
      if (reconciled) return reconciled;
      throw new BigCommercePublishError(
        [this.normaliseError("DuplicateSKUError", "")],
        `BigCommerce already has a different product with SKU ${product.sku}; nothing was created.`,
      );
    }

    const response = await this.fetchWithTimeout(`${this.apiBase(storeHash)}/catalog/products`, {
      method: "POST",
      headers: this.buildHeaders(apiKey),
      body: JSON.stringify(payload),
    });
    const body = await this.parseJsonResponse<Record<string, unknown>>(response);
    if (response.status === 409) {
      // A conflict can mean the previous attempt completed after the lookup above. Check, don't guess.
      const afterConflict = await this.findProductBySku(storeHash, apiKey, product.sku);
      const reconciled = afterConflict
        ? this.reconcileExistingProduct(ctx, product, payload, afterConflict, "conflict_after_create")
        : null;
      if (reconciled) return reconciled;
    }
    if (response.status !== 200 && response.status !== 201) {
      throw this.toPublishError(body, response.status);
    }
    const data = (body.data ?? {}) as Record<string, unknown>;
    return { externalRef: String(data.id ?? ""), status: "SUCCESS", isAsync: false };
  }

  // The product BigCommerce already holds for this SKU, or null. Exact SKU match on the returned
  // item (the `sku` filter is trusted only as far as the response confirms it). A lookup that
  // fails is thrown before anything is created, so it is always safe to repeat.
  private async findProductBySku(
    storeHash: string,
    apiKey: string,
    sku: string,
  ): Promise<{ id: number; name: string } | null> {
    if (!String(sku ?? "").trim()) return null; // BigCommerce does not enforce uniqueness on an empty SKU
    const query = `sku=${encodeURIComponent(sku)}&include_fields=id,name,sku&limit=5`;
    const response = await this.fetchWithTimeout(`${this.apiBase(storeHash)}/catalog/products?${query}`, {
      headers: this.buildHeaders(apiKey),
    });
    const body = await this.parseJsonResponse<Record<string, unknown>>(response);
    if (!response.ok) {
      throw this.toPublishError(body, response.status);
    }
    const rows = Array.isArray(body.data) ? (body.data as Array<Record<string, unknown>>) : [];
    const match = rows.find((row) => row.sku === sku && Number.isInteger(row.id) && (row.id as number) > 0);
    return match ? { id: match.id as number, name: String(match.name ?? "") } : null;
  }

  private reconcileExistingProduct(
    ctx: ConnectorContext,
    product: ProductPayload,
    payload: Record<string, unknown>,
    existing: { id: number; name: string },
    via: "lookup_before_create" | "conflict_after_create",
  ): SubmissionRef | null {
    if (existing.name.trim() !== String(payload.name ?? "").trim()) {
      this.logger.warn("bigcommerce.create.sku_conflict_not_reconciled", {
        installationId: ctx.installationId,
        sku: product.sku,
        existingId: existing.id,
        via,
      });
      return null;
    }
    this.logger.info("bigcommerce.create.reconciled_existing", {
      installationId: ctx.installationId,
      sku: product.sku,
      externalRef: String(existing.id),
      via,
    });
    return { externalRef: String(existing.id), status: "SUCCESS", isAsync: false };
  }

  // ─── optional: updateProduct ─────────────────────────────────────────────

  async updateProduct(ctx: ConnectorContext, product: ProductPayload, externalRef: string): Promise<SubmissionRef> {
    const { storeHash, apiKey } = await this.resolveCredentials(ctx);
    const response = await this.fetchWithTimeout(`${this.apiBase(storeHash)}/catalog/products/${externalRef}`, {
      method: "PUT",
      headers: this.buildHeaders(apiKey),
      body: JSON.stringify(this.buildProductPayload(product)),
    });
    const body = await this.parseJsonResponse<Record<string, unknown>>(response);
    if (response.status !== 200 && response.status !== 201) {
      throw this.toPublishError(body, response.status);
    }
    return { externalRef, status: "SUCCESS", isAsync: false };
  }

  // ─── optional: syncSubmissionStatus ──────────────────────────────────────

  async syncSubmissionStatus(ctx: ConnectorContext, externalRef: string): Promise<SubmissionStatusUpdate> {
    const { storeHash, apiKey } = await this.resolveCredentials(ctx);
    const response = await this.fetchWithTimeout(`${this.apiBase(storeHash)}/catalog/products/${externalRef}`, {
      headers: this.buildHeaders(apiKey),
    });
    if (response.status === 404) {
      return {
        externalRef,
        status: "ERROR",
        channelErrors: [{ code: "PRODUCT_NOT_FOUND", fieldPath: "", sellerMessage: "Product not found in BigCommerce.", severity: "error" }],
      };
    }
    const body = await this.parseJsonResponse<Record<string, unknown>>(response);
    if (!response.ok) {
      return { externalRef, status: "ERROR", channelErrors: [this.toPublishError(body, response.status).issues[0]] };
    }
    const data = (body.data ?? {}) as Record<string, unknown>;
    const status = data.is_visible ? "SUCCESS" : "SUPPRESSED";
    return { externalRef, status, channelErrors: [], resolvedAt: new Date() };
  }

  // ─── error envelope parsing ───────────────────────────────────────────────

  private toPublishError(body: Record<string, unknown>, statusCode: number): BigCommercePublishError {
    const errors = (body?.errors ?? {}) as Record<string, unknown>;
    const title = String(body?.title ?? "API_ERROR");
    const detail = Object.values(errors)[0];
    const message = detail != null ? String(detail) : title;
    const issue = this.normaliseError(title, message.slice(0, 300));
    return new BigCommercePublishError([issue], `BigCommerce request failed with status ${statusCode}: ${issue.sellerMessage}`);
  }

  private async parseJsonResponse<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (!text.trim()) {
      return {} as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return {} as T;
    }
  }
}
