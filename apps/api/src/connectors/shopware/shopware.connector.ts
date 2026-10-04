// apps/api/src/connectors/shopware/shopware.connector.ts
//
// Capabilities: PUBLISH + VALIDATE + STATUS_SYNC
// implementationStatus: full (code-complete); launch stage: under_development
// (see connector-launch-policy.ts).
//
// Auth: Shopware 6 Admin API — OAuth2 client_credentials grant against
// {store_url}/api/oauth/token, using an Integration's Access ID/Secret Key
// (Settings > System > Integrations in the Shopware Administration). This is
// Shopware's own recommended server-to-server auth method, distinct from the
// password grant used for acting as a real Administration user.
//
// Credential storage (ConnectorCredential rows per installationId):
//   credentialType: 'store_url'      — e.g. https://shop.example.com (HTTPS required)
//   credentialType: 'client_id'      — Integration's Access ID
//   credentialType: 'client_secret'  — Integration's Secret Key
//
// Ported from the Vexa Connector Hub prototype (2026-09-22), which already
// carried one real, live-verified fix from its own sandbox-verification
// pass: validateCredentials() originally called the nonexistent
// /api/_info/shopware-version; the real endpoint is /api/_info/config. Kept
// fixed from the start of this port. No live Shopware credentials exist in
// this environment to re-verify the TypeScript port itself.
//
// Second real issue found during this port (by inspection, not live-tested):
// the prototype hardcoded a 19% German VAT rate when computing a product's
// net price from its gross price (`net = gross / 1.19`) — wrong for any
// non-German-VAT Shopware store. Fixed here to read the rate from
// attributes.tax_rate_percent (defaulting to 19 only as a last resort), so a
// non-German seller isn't silently given a wrong net price.

import { BadRequestException, Injectable } from "@nestjs/common";
import { LoggerService } from "../../common/logging/logger.service";
import { validateConnectorTargetUrl } from "../../common/security/url-safety";
import {
  ConnectorRedirectError,
  fetchWithValidatedRedirects,
} from "../../common/security/validated-redirect-fetch";
import {
  decryptCredentialValue,
  parseCredentialKeyVersion,
  loadCredentialEncryptionKeys,
  buildEncryptedCredential,
  formatCredentialKeyVersion,
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
import { PrismaDirectService } from "../../prisma/prisma-direct.service";

const CONNECTOR_HTTP_TIMEOUT_MS = 30_000;
// Shopware 6's well-known, universal default EUR currency id, present in
// every fresh install — used only when the installation hasn't mapped a
// currency id of its own via attributes.shopware_currency_id.
const DEFAULT_EUR_CURRENCY_ID = "b7d2554b0ce847cd82f3ac9bd1c0dfca";
const DEFAULT_TAX_RATE_PERCENT = 19;

type ResolvedCredentials = { storeUrl: string; clientId: string; clientSecret: string };

const ERROR_MESSAGES: Record<string, string> = {
  FRAMEWORK__DUPLICATE_KEY: "A product with this productNumber already exists. Update it instead.",
  PRODUCT__MISSING_PRICE: "Provide at least one price entry with gross/net values.",
  TAX_NOT_FOUND: "The tax rule id does not exist in this Shopware instance.",
  SALES_CHANNEL_NOT_FOUND: "The sales channel id is invalid.",
};

export class ShopwarePublishError extends Error {
  constructor(
    public readonly issues: ConnectorIssue[],
    message: string,
  ) {
    super(message);
    this.name = "ShopwarePublishError";
  }
}

function normalizeStoreUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

@Injectable()
export class ShopwareConnector implements ConnectorInterface {
  readonly slug = "shopware";
  readonly displayName = "Shopware 6";
  readonly capabilities: ConnectorCap[] = ["PUBLISH", "VALIDATE", "STATUS_SYNC"];
  readonly implementationStatus: ConnectorImplementationStatus = "full";

  private readonly keys = loadCredentialEncryptionKeys(process.env);
  private readonly currentKeyVersion = (() => {
    const raw = String(process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION ?? "1").trim();
    return parseCredentialKeyVersion(raw);
  })();

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
    const [storeUrl, clientId, clientSecret] = await Promise.all([
      this.getPlainCredential(ctx, "store_url"),
      this.getPlainCredential(ctx, "client_id"),
      this.getPlainCredential(ctx, "client_secret"),
    ]);
    if (!storeUrl || !clientId || !clientSecret) {
      throw new Error("Shopware credentials incomplete. Verify store_url, client_id, and client_secret are stored.");
    }
    const normalizedStoreUrl = normalizeStoreUrl(storeUrl);
    // store_url is tenant-supplied and every caller of this method goes on to
    // send the Integration's client_secret / bearer token to it. Block a URL
    // that is non-HTTPS or points at (or resolves to) a private, loopback,
    // link-local or metadata address before any credential-bearing request is
    // built — the same boundary Odoo, PrestaShop and WooCommerce use.
    await validateConnectorTargetUrl(normalizedStoreUrl, { requireResolvable: false });
    return { storeUrl: normalizedStoreUrl, clientId, clientSecret };
  }

  // Every request carries the Integration's client_secret (the OAuth token
  // exchange body) or its bearer token, so fetch must never follow a redirect on
  // its own: each hop is sent with redirect: "manual", re-validated, and a
  // cross-origin hop fails closed. Callers only ever pass plain-object headers
  // and string bodies.
  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    return fetchWithValidatedRedirects(
      (hopUrl, hopInit) => fetch(hopUrl, { ...hopInit, signal: AbortSignal.timeout(CONNECTOR_HTTP_TIMEOUT_MS) }),
      url,
      {
        method: init.method,
        headers: init.headers as Record<string, string> | undefined,
        body: init.body as string | undefined,
      },
    );
  }

  private async exchangeToken(storeUrl: string, clientId: string, clientSecret: string): Promise<{ access_token?: string; expires_in?: number }> {
    const response = await this.fetchWithTimeout(`${storeUrl}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
    });
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }
    if (!response.ok) {
      throw new ShopwareTokenExchangeError(response.status, parsed);
    }
    return parsed;
  }

  // ─── required: validateCredentials ───────────────────────────────────────

  async validateCredentials(ctx: ConnectorContext): Promise<boolean> {
    const result = await this.validateStoredCredentialsDetailed(ctx);
    return result.outcome === "valid";
  }

  async validateStoredCredentialsDetailed(ctx: ConnectorContext): Promise<CredentialVerificationResult> {
    try {
      const { storeUrl } = await this.resolveCredentials(ctx);
      if (!storeUrl.startsWith("https://")) {
        return { outcome: "invalid", reasonCode: "SHOPWARE_URL_NOT_HTTPS" };
      }
      const token = await ctx.getAccessToken();
      // Verified live in the pre-port prototype: /api/_info/shopware-version
      // does not exist; /api/_info/config is the real reachability check.
      const response = await this.fetchWithTimeout(`${storeUrl}/api/_info/config`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        return { outcome: "invalid", reasonCode: `HTTP_${response.status}` };
      }
      if (!response.ok) {
        return { outcome: "unavailable", reasonCode: `HTTP_${response.status}` };
      }
      return { outcome: "valid" };
    } catch (error) {
      if (error instanceof ConnectorRedirectError) {
        return { outcome: "invalid", reasonCode: `SHOPWARE_${error.reason}` };
      }
      // resolveCredentials() now throws for a non-HTTPS or unsafe store_url
      // before the explicit HTTPS check above is reachable — keep classifying
      // that as invalid (as before), not as a generic unavailable provider.
      if (error instanceof BadRequestException) {
        const reasonCode = error.message.includes("HTTPS") ? "SHOPWARE_URL_NOT_HTTPS" : "SHOPWARE_URL_UNSAFE";
        return { outcome: "invalid", reasonCode };
      }
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn("Shopware credential validation failed", { installationId: ctx.installationId, reason });
      if (error instanceof ShopwareTokenExchangeError) {
        return { outcome: error.status === 401 ? "invalid" : "unavailable", reasonCode: `HTTP_${error.status}` };
      }
      return { outcome: "unavailable", reasonCode: "UNKNOWN_ERROR" };
    }
  }

  // ─── optional: verifyCandidateCredentials ───────────────────────────────

  async verifyCandidateCredentials(candidate: Record<string, string>): Promise<CredentialVerificationResult> {
    const storeUrl = normalizeStoreUrl(String(candidate.store_url ?? "").trim());
    const clientId = String(candidate.client_id ?? "").trim();
    const clientSecret = String(candidate.client_secret ?? "").trim();
    if (!storeUrl.startsWith("https://")) {
      return { outcome: "invalid", reasonCode: "SHOPWARE_URL_NOT_HTTPS" };
    }
    // Reject an unsafe candidate store_url before the client_secret is ever
    // attached to a request, and before it can be saved as a credential.
    try {
      await validateConnectorTargetUrl(storeUrl, { requireResolvable: false });
    } catch {
      return { outcome: "invalid", reasonCode: "SHOPWARE_URL_UNSAFE" };
    }
    try {
      const token = await this.exchangeToken(storeUrl, clientId, clientSecret);
      if (!token.access_token) {
        return { outcome: "unavailable", reasonCode: "SHOPWARE_TOKEN_RESPONSE_INCOMPLETE" };
      }
      const check = await this.fetchWithTimeout(`${storeUrl}/api/_info/config`, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (check.status === 401 || check.status === 403) {
        return { outcome: "invalid", reasonCode: `HTTP_${check.status}` };
      }
      return {
        outcome: "valid",
        commitExtra: {
          accessToken: { value: token.access_token, expiresAt: this.computeTokenExpiry(token.expires_in) },
        },
      };
    } catch (err) {
      if (err instanceof ConnectorRedirectError) {
        return { outcome: "invalid", reasonCode: `SHOPWARE_${err.reason}` };
      }
      if (err instanceof ShopwareTokenExchangeError) {
        return { outcome: err.status === 401 ? "invalid" : "unavailable", reasonCode: `HTTP_${err.status}` };
      }
      return { outcome: "unavailable", reasonCode: "UNKNOWN_NETWORK_ERROR" };
    }
  }

  async refreshAccessToken(ctx: ConnectorContext): Promise<string> {
    const { storeUrl, clientId, clientSecret } = await this.resolveCredentials(ctx);
    const token = await this.exchangeToken(storeUrl, clientId, clientSecret);
    if (!token.access_token) {
      throw new Error("Shopware token response did not include access_token.");
    }
    await this.storeCredential(ctx, "access_token", token.access_token, this.computeTokenExpiry(token.expires_in));
    return token.access_token;
  }

  private computeTokenExpiry(expiresIn: number | undefined): Date | null {
    return Number.isFinite(expiresIn) ? new Date(Date.now() + Math.max(1, Number(expiresIn)) * 1000) : null;
  }

  // ─── required: validateProduct ───────────────────────────────────────────

  async validateProduct(_ctx: ConnectorContext, product: ProductPayload): Promise<ValidationResult> {
    const errors: ConnectorIssue[] = [];
    const warnings: ConnectorIssue[] = [];
    const attrs = product.attributes ?? {};

    if (!product.title || String(product.title).trim().length === 0) {
      errors.push({ code: "MISSING_NAME", fieldPath: "title", sellerMessage: "name is required for Shopware products.", severity: "error" });
    }
    if (!product.sku) {
      errors.push({ code: "MISSING_PRODUCT_NUMBER", fieldPath: "sku", sellerMessage: "productNumber (mapped from sku) is required and unique.", severity: "error" });
    }
    if (product.sellingPrice == null || product.sellingPrice < 0) {
      errors.push({ code: "MISSING_PRICE", fieldPath: "sellingPrice", sellerMessage: "price.gross must be a non-negative number.", severity: "error" });
    }
    if (!attrs["shopware_tax_id"]) {
      errors.push({
        code: "MISSING_TAX",
        fieldPath: "attributes.shopware_tax_id",
        sellerMessage: "Set attributes.shopware_tax_id (a Shopware tax rule id).",
        severity: "error",
      });
    }
    if (!attrs["shopware_sales_channel_id"]) {
      warnings.push({
        code: "MISSING_CHANNEL",
        fieldPath: "attributes.shopware_sales_channel_id",
        sellerMessage: "Set attributes.shopware_sales_channel_id so the product is visible in a sales channel.",
        severity: "warning",
      });
    }

    return { isValid: errors.length === 0, errors, warnings, source: "LOCAL_RULES" };
  }

  normaliseError(errorCode: string, rawMessage: string): ConnectorIssue {
    const normalizedCode = String(errorCode ?? "").trim();
    const entry = ERROR_MESSAGES[normalizedCode];
    const fieldPath =
      normalizedCode === "FRAMEWORK__DUPLICATE_KEY" ? "sku"
      : normalizedCode === "PRODUCT__MISSING_PRICE" ? "sellingPrice"
      : normalizedCode === "TAX_NOT_FOUND" ? "attributes.shopware_tax_id"
      : normalizedCode === "SALES_CHANNEL_NOT_FOUND" ? "attributes.shopware_sales_channel_id"
      : "";
    const sellerMessage = entry ?? (String(rawMessage ?? "").trim() || `Shopware returned an error: ${normalizedCode || "UNKNOWN"}.`);
    return { code: normalizedCode || "SHOPWARE_ERROR", fieldPath, sellerMessage, severity: "error" };
  }

  // ─── payload building ───────────────────────────────────────────────────

  private buildProductPayload(product: ProductPayload): Record<string, unknown> {
    const attrs = product.attributes ?? {};
    const gross = product.sellingPrice ?? 0;
    const taxRatePercent = Number(attrs["tax_rate_percent"] ?? DEFAULT_TAX_RATE_PERCENT) || DEFAULT_TAX_RATE_PERCENT;
    const net = gross ? Math.round((gross / (1 + taxRatePercent / 100)) * 1e6) / 1e6 : 0;
    const currencyId = typeof attrs["shopware_currency_id"] === "string" ? attrs["shopware_currency_id"] : DEFAULT_EUR_CURRENCY_ID;

    const customFields: Record<string, string> = {};
    for (const [key, value] of Object.entries(attrs)) {
      if (!key.startsWith("shopware_") && key !== "tax_rate_percent" && key !== "stock") {
        customFields[key] = String(value);
      }
    }

    return {
      name: product.title,
      productNumber: product.sku,
      stock: this.readPositiveInteger(attrs["stock"], 100),
      description: product.description || product.title,
      active: true,
      taxId: attrs["shopware_tax_id"],
      price: [{ currencyId, gross, net, linked: true }],
      ...(product.brand ? { manufacturer: { name: product.brand } } : {}),
      categories: attrs["shopware_category_id"] ? [{ id: attrs["shopware_category_id"] }] : [],
      visibilities: attrs["shopware_sales_channel_id"]
        ? [{ salesChannelId: attrs["shopware_sales_channel_id"], visibility: 30 }]
        : [],
      customFields,
    };
  }

  private readPositiveInteger(value: unknown, fallback: number): number {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.max(1, Math.round(value));
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.max(1, Math.round(parsed));
      }
    }
    return fallback;
  }

  // ─── optional: publishProduct ────────────────────────────────────────────

  async publishProduct(ctx: ConnectorContext, product: ProductPayload): Promise<SubmissionRef> {
    const { storeUrl } = await this.resolveCredentials(ctx);
    const token = await ctx.getAccessToken();
    const response = await this.fetchWithTimeout(`${storeUrl}/api/product`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(this.buildProductPayload(product)),
    });
    if (response.status !== 200 && response.status !== 201 && response.status !== 204) {
      throw this.toPublishError(await this.parseJsonResponse<Record<string, unknown>>(response), response.status);
    }
    // POST returns 204 with a Location header; productNumber is our own ref.
    return { externalRef: product.sku, status: "SUCCESS", isAsync: false };
  }

  // ─── optional: updateProduct ─────────────────────────────────────────────

  async updateProduct(ctx: ConnectorContext, product: ProductPayload, externalRef: string): Promise<SubmissionRef> {
    const { storeUrl } = await this.resolveCredentials(ctx);
    const token = await ctx.getAccessToken();
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    const lookupResponse = await this.fetchWithTimeout(`${storeUrl}/api/search/product`, {
      method: "POST",
      headers,
      body: JSON.stringify({ filter: [{ type: "equals", field: "productNumber", value: externalRef }], limit: 1 }),
    });
    const lookupBody = await this.parseJsonResponse<{ data?: Array<{ id: string }> }>(lookupResponse);
    const shopwareId = lookupBody.data?.[0]?.id;
    if (!shopwareId) {
      throw new ShopwarePublishError(
        [{ code: "PRODUCT_NOT_FOUND", fieldPath: "", sellerMessage: `No Shopware product with number ${externalRef}.`, severity: "error" }],
        `No Shopware product with number ${externalRef}.`,
      );
    }

    const response = await this.fetchWithTimeout(`${storeUrl}/api/product/${shopwareId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(this.buildProductPayload(product)),
    });
    if (response.status !== 200 && response.status !== 204) {
      throw this.toPublishError(await this.parseJsonResponse<Record<string, unknown>>(response), response.status);
    }
    return { externalRef, status: "SUCCESS", isAsync: false };
  }

  // ─── optional: syncSubmissionStatus ──────────────────────────────────────

  async syncSubmissionStatus(ctx: ConnectorContext, externalRef: string): Promise<SubmissionStatusUpdate> {
    const { storeUrl } = await this.resolveCredentials(ctx);
    const token = await ctx.getAccessToken();
    const response = await this.fetchWithTimeout(`${storeUrl}/api/search/product`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ filter: [{ type: "equals", field: "productNumber", value: externalRef }], limit: 1 }),
    });
    const body = await this.parseJsonResponse<{ data?: Array<Record<string, unknown>> }>(response);
    const record = body.data?.[0];
    if (!record) {
      return {
        externalRef,
        status: "ERROR",
        channelErrors: [{ code: "PRODUCT_NOT_FOUND", fieldPath: "", sellerMessage: "Product not found in Shopware.", severity: "error" }],
      };
    }
    const attrs = (record.attributes ?? record) as Record<string, unknown>;
    const status = attrs.active ? "SUCCESS" : "SUPPRESSED";
    return { externalRef, status, channelErrors: [], resolvedAt: new Date() };
  }

  // ─── error envelope parsing ───────────────────────────────────────────────

  private toPublishError(body: Record<string, unknown>, statusCode: number): ShopwarePublishError {
    const errors = Array.isArray(body?.errors) ? (body.errors as Array<Record<string, unknown>>) : [];
    if (errors.length > 0) {
      const first = errors[0];
      const code = String(first.code ?? "API_ERROR");
      const detail = String(first.detail ?? "");
      const issue = this.normaliseError(code, detail);
      return new ShopwarePublishError([issue], `Shopware request failed with status ${statusCode}: ${issue.sellerMessage}`);
    }
    const issue = this.normaliseError("HTTP_ERROR", `Shopware request failed with status ${statusCode}.`);
    return new ShopwarePublishError([issue], issue.sellerMessage);
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

  private async storeCredential(ctx: ConnectorContext, credentialType: string, plainValue: string, expiresAt: Date | null): Promise<void> {
    const encrypted = buildEncryptedCredential(plainValue, this.currentKeyVersion, this.keys);
    const keyVersion = formatCredentialKeyVersion(encrypted.keyVersion);
    const db = this.prismaDirect.getClient();
    const id = `${ctx.installationId}:${credentialType}`;
    await db.connectorCredential.upsert({
      where: { id },
      create: {
        id,
        tenantKey: ctx.tenantId,
        installationId: ctx.installationId,
        credentialType,
        encryptedValue: encrypted.cipher,
        keyVersion,
        status: "ACTIVE",
        expiresAt,
        failureReason: null,
        lastRefreshAt: new Date(),
      },
      update: {
        tenantKey: ctx.tenantId,
        encryptedValue: encrypted.cipher,
        keyVersion,
        status: "ACTIVE",
        expiresAt,
        failureReason: null,
        lastRefreshAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }
}

class ShopwareTokenExchangeError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(`Shopware token exchange failed with status ${status}.`);
    this.name = "ShopwareTokenExchangeError";
    this.status = status;
    this.body = body;
  }
}
