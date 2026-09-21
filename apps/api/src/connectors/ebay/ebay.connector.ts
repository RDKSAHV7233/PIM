// apps/api/src/connectors/ebay/ebay.connector.ts
//
// Capabilities: PUBLISH + VALIDATE + STATUS_SYNC
// implementationStatus: full (code-complete); launch stage: under_development
// (see connector-launch-policy.ts — this is the least-verified connector
// ported this sprint: no live credentials exist in this environment at all,
// so nothing here has been exercised against a real eBay account, sandbox or
// otherwise).
//
// Auth: eBay Sell API OAuth2 — authorization_code (3-legged, user consent)
// for the initial grant, then refresh_token for subsequent access tokens.
// client_credentials (application tokens) does NOT work for the Sell
// Inventory/Offer APIs used here — only for eBay's Buy/Browse read APIs.
//
// SANDBOX-ONLY BY DESIGN, NOT CONFIGURABLE: a real publishProduct() call
// creates a genuine, public listing when pointed at production eBay. The
// pre-port Python prototype accepted a `configuration.environment` value
// that could be flipped to "production", opt-out rather than opt-in. This
// port deliberately removes that option entirely — there is no environment
// credential, no production host, and no code path that can reach anything
// but api.sandbox.ebay.com. Adding real production support is a distinct,
// separate change that needs its own explicit safeguards and sign-off, not
// something to fall out of a generic "environment" string. This connector
// is also `under_development` (not installable) regardless, but the hosts
// being sandbox-only means even a bypassed launch-policy gate can't create
// a real listing.
//
// Credential storage (ConnectorCredential rows per installationId):
//   credentialType: 'client_id'              — eBay application Client ID
//   credentialType: 'client_secret'          — eBay application Client Secret
//   credentialType: 'refresh_token'          — obtained via the 3-legged OAuth
//                                              consent flow before install
// The marketplace id (e.g. "EBAY_US") is NOT a ConnectorCredential — it uses
// the same installation.metadata.marketplaceId -> ctx.marketplaceId path
// Amazon already established, so it's read as ctx.marketplaceId directly.
//   credentialType: 'fulfillment_policy_id'  — from eBay Seller Hub > Business
//   credentialType: 'payment_policy_id'        Policies. Required only for
//   credentialType: 'return_policy_id'         publishProduct/updateProduct,
//                                              not for credential validation —
//                                              a merchant may not have set
//                                              these up yet at install time.
//
// Real bug found and fixed during the port (by API-semantics review, NOT
// live-verified — no credentials exist to prove this live):
//   The prototype's update_product() just called publish_product() again,
//   which re-runs create-offer + publish-offer against an offer that already
//   exists. eBay's inventory-item PUT is itself an idempotent upsert — the
//   correct "update" is to upsert the inventory item alone, never touch the
//   offer/publish steps again once the listing is live. Re-running those
//   would at best be redundant, at worst error or leave the listing in an
//   inconsistent state. Fixed: updateProduct() now only upserts the
//   inventory item.

import { Injectable } from "@nestjs/common";
import { LoggerService } from "../../common/logging/logger.service";
import {
  buildEncryptedCredential,
  decryptCredentialValue,
  formatCredentialKeyVersion,
  loadCredentialEncryptionKeys,
  parseCredentialKeyVersion,
  resolveCurrentCredentialKeyVersion,
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

type CredentialRow = {
  encryptedValue: string;
  keyVersion: string;
  status?: string;
};

type EbayTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

class EbayTokenExchangeError extends Error {
  readonly status: number;
  readonly body: EbayTokenResponse | Record<string, unknown>;
  constructor(status: number, body: EbayTokenResponse | Record<string, unknown>) {
    super(`eBay token exchange failed with status ${status}.`);
    this.name = "EbayTokenExchangeError";
    this.status = status;
    this.body = body;
  }
}

export class EbayPublishError extends Error {
  constructor(
    public readonly issues: ConnectorIssue[],
    message: string,
  ) {
    super(message);
    this.name = "EbayPublishError";
  }
}

const CONNECTOR_HTTP_TIMEOUT_MS = 30_000;
// Sandbox-only — see file header. There is deliberately no production entry
// here and no configuration value that could select one.
const TOKEN_URL = "https://api.sandbox.ebay.com/identity/v1/oauth2/token";
const API_BASE = "https://api.sandbox.ebay.com/sell/inventory/v1";
const SELL_INVENTORY_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.inventory";

const ERROR_MESSAGES: Record<string, string> = {
  "25002": "eBay rejected the offer. Check listing policies (payment, fulfillment, return).",
  "25003": "The eBay category id is invalid for this marketplace.",
  "25701": "The item condition is not valid for this category.",
  "25715": "Image URL is unreachable. eBay requires public HTTPS image URLs.",
  "25007": "Price is invalid or below the minimum for this currency.",
};

function computeTokenExpiry(expiresIn: number | undefined, now: number): Date | null {
  return Number.isFinite(expiresIn) ? new Date(now + Math.max(1, Number(expiresIn)) * 1000) : null;
}

@Injectable()
export class EbayConnector implements ConnectorInterface {
  readonly slug = "ebay";
  readonly displayName = "eBay";
  readonly implementationStatus: ConnectorImplementationStatus = "full";
  readonly capabilities: ConnectorCap[] = ["PUBLISH", "VALIDATE", "STATUS_SYNC"];

  private readonly keys = loadCredentialEncryptionKeys(process.env);
  private readonly currentKeyVersion = resolveCurrentCredentialKeyVersion(process.env);

  constructor(
    private readonly prismaDirect: PrismaDirectService,
    private readonly logger: LoggerService,
  ) {
    if (!this.keys.has(this.currentKeyVersion)) {
      throw new Error(`Missing credential encryption key for current version ${this.currentKeyVersion}.`);
    }
  }

  // ─── required: validateCredentials ───────────────────────────────────────

  async validateCredentials(ctx: ConnectorContext): Promise<boolean> {
    const result = await this.validateStoredCredentialsDetailed(ctx);
    return result.outcome === "valid";
  }

  async validateStoredCredentialsDetailed(ctx: ConnectorContext): Promise<CredentialVerificationResult> {
    try {
      const token = await ctx.getAccessToken();
      const response = await this.fetchWithTimeout(`${API_BASE}/inventory_item_group?limit=1`, {
        headers: this.buildApiHeaders(token),
      });
      if (response.status === 401 || response.status === 403) {
        return { outcome: "invalid", reasonCode: `HTTP_${response.status}` };
      }
      if (!response.ok) {
        return { outcome: "unavailable", reasonCode: `HTTP_${response.status}` };
      }
      return { outcome: "valid" };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn("eBay credential validation failed", { installationId: ctx.installationId, reason });
      if (error instanceof EbayTokenExchangeError) {
        const bodyError = String((error.body as Record<string, unknown>)?.error ?? "").trim().toLowerCase();
        if (error.status === 401 || bodyError === "invalid_client" || bodyError === "invalid_grant") {
          return { outcome: "invalid", reasonCode: bodyError || `HTTP_${error.status}` };
        }
        return { outcome: "unavailable", reasonCode: `HTTP_${error.status}` };
      }
      return { outcome: "unavailable", reasonCode: "UNKNOWN_ERROR" };
    }
  }

  // ─── optional: verifyCandidateCredentials ───────────────────────────────
  //
  // Side-effect-free: exchanges the candidate refresh_token directly, never
  // touches stored rows.

  async verifyCandidateCredentials(candidate: Record<string, string>): Promise<CredentialVerificationResult> {
    const clientId = String(candidate.client_id ?? "").trim();
    const clientSecret = String(candidate.client_secret ?? "").trim();
    const refreshToken = String(candidate.refresh_token ?? "").trim();

    try {
      const token = await this.exchangeToken(clientId, clientSecret, {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: SELL_INVENTORY_SCOPE,
      });
      if (!token.access_token) {
        return { outcome: "unavailable", reasonCode: "EBAY_TOKEN_RESPONSE_INCOMPLETE" };
      }
      const check = await this.fetchWithTimeout(`${API_BASE}/inventory_item_group?limit=1`, {
        headers: this.buildApiHeaders(token.access_token),
      });
      if (check.status === 401 || check.status === 403) {
        return { outcome: "invalid", reasonCode: `HTTP_${check.status}` };
      }
      const now = Date.now();
      return {
        outcome: "valid",
        commitExtra: {
          accessToken: { value: token.access_token, expiresAt: computeTokenExpiry(token.expires_in, now) },
          ...(token.refresh_token ? { refreshToken: { value: token.refresh_token, expiresAt: null } } : {}),
        },
      };
    } catch (err) {
      if (err instanceof EbayTokenExchangeError) {
        const bodyError = String((err.body as Record<string, unknown>)?.error ?? "").trim().toLowerCase();
        if (err.status === 401 || bodyError === "invalid_client" || bodyError === "invalid_grant") {
          return { outcome: "invalid", reasonCode: bodyError || `HTTP_${err.status}` };
        }
        return { outcome: "unavailable", reasonCode: `HTTP_${err.status}` };
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
      errors.push({ code: "MISSING_TITLE", fieldPath: "title", sellerMessage: "eBay listing title is required.", severity: "error" });
    } else if (product.title.length > 80) {
      errors.push({ code: "TITLE_TOO_LONG", fieldPath: "title", sellerMessage: "eBay titles must be 80 characters or fewer.", severity: "error" });
    }
    if (product.sellingPrice == null || product.sellingPrice <= 0) {
      errors.push({ code: "MISSING_PRICE", fieldPath: "sellingPrice", sellerMessage: "A positive price is required for fixed-price offers.", severity: "error" });
    }
    if (!attrs["condition"]) {
      errors.push({
        code: "MISSING_CONDITION",
        fieldPath: "attributes.condition",
        sellerMessage: "Set attributes.condition (e.g. NEW, USED_EXCELLENT).",
        severity: "error",
      });
    }
    if (!product.mainImageUrl) {
      warnings.push({
        code: "NO_IMAGE",
        fieldPath: "mainImageUrl",
        sellerMessage: "eBay listings perform poorly without images; add at least one.",
        severity: "warning",
      });
    }

    return { isValid: errors.length === 0, errors, warnings, source: "LOCAL_RULES" };
  }

  normaliseError(errorCode: string, rawMessage: string): ConnectorIssue {
    const normalizedCode = String(errorCode ?? "").trim();
    const entry = ERROR_MESSAGES[normalizedCode];
    const sellerMessage = entry ?? (String(rawMessage ?? "").trim() || `eBay returned an error: ${normalizedCode || "UNKNOWN"}.`);
    const fieldPath = normalizedCode === "25003" ? "attributes.ebay_category_id"
      : normalizedCode === "25701" ? "attributes.condition"
      : normalizedCode === "25715" ? "mainImageUrl"
      : normalizedCode === "25007" ? "sellingPrice"
      : "";
    return { code: normalizedCode || "EBAY_ERROR", fieldPath, sellerMessage, severity: "error" };
  }

  // ─── payload building ───────────────────────────────────────────────────

  private buildInventoryItemPayload(product: ProductPayload): Record<string, unknown> {
    const attrs = product.attributes ?? {};
    const aspects: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "condition" || key === "ebay_category_id") continue;
      aspects[key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())] = [String(value)];
    }
    if (product.brand) {
      aspects["Brand"] = [product.brand];
    }
    const images = [product.mainImageUrl, ...(product.additionalImageUrls ?? [])].filter(
      (url): url is string => typeof url === "string" && url.trim().length > 0,
    );
    return {
      availability: { shipToLocationAvailability: { quantity: this.readPositiveInteger(attrs["stock"], 10) } },
      condition: this.readString(attrs["condition"], "NEW"),
      product: {
        title: product.title,
        description: product.description || product.title,
        aspects,
        imageUrls: images,
      },
    };
  }

  private buildOfferPayload(
    product: ProductPayload,
    marketplaceId: string,
    policyIds: { fulfillment: string; payment: string; return: string },
  ): Record<string, unknown> {
    const attrs = product.attributes ?? {};
    return {
      sku: product.sku,
      marketplaceId,
      format: "FIXED_PRICE",
      listingPolicies: {
        fulfillmentPolicyId: policyIds.fulfillment,
        paymentPolicyId: policyIds.payment,
        returnPolicyId: policyIds.return,
      },
      pricingSummary: { price: { currency: product.currencyCode ?? "USD", value: product.sellingPrice ?? 0 } },
      categoryId: this.readString(attrs["ebay_category_id"], ""),
      quantity: this.readPositiveInteger(attrs["stock"], 10),
    };
  }

  // ─── optional: publishProduct ────────────────────────────────────────────

  async publishProduct(ctx: ConnectorContext, product: ProductPayload): Promise<SubmissionRef> {
    const validation = await this.validateProduct(ctx, product);
    if (!validation.isValid) {
      throw new EbayPublishError(validation.errors, validation.errors.map((issue) => issue.sellerMessage).join(" | "));
    }
    const token = await ctx.getAccessToken();
    const headers = this.buildApiHeaders(token);
    const marketplaceId = String(ctx.marketplaceId ?? "").trim() || "EBAY_US";
    const policyIds = await this.requirePolicyIds(ctx);

    await this.upsertInventoryItem(ctx, product, headers);

    const offerResponse = await this.fetchWithTimeout(`${API_BASE}/offer`, {
      method: "POST",
      headers,
      body: JSON.stringify(this.buildOfferPayload(product, marketplaceId, policyIds)),
    });
    const offerBody = await this.parseJsonResponse<Record<string, unknown>>(offerResponse);
    if (offerResponse.status !== 200 && offerResponse.status !== 201) {
      throw this.toPublishError(offerBody, offerResponse.status);
    }
    const offerId = String(offerBody.offerId ?? "");
    if (!offerId) {
      throw new EbayPublishError(
        [this.normaliseError("EBAY_ERROR", "eBay did not return an offerId after creating the offer.")],
        "eBay publish failed: no offerId returned.",
      );
    }

    const publishResponse = await this.fetchWithTimeout(`${API_BASE}/offer/${offerId}/publish`, {
      method: "POST",
      headers,
    });
    const publishBody = await this.parseJsonResponse<Record<string, unknown>>(publishResponse);
    if (publishResponse.status !== 200 && publishResponse.status !== 201) {
      throw this.toPublishError(publishBody, publishResponse.status);
    }
    const listingId = String(publishBody.listingId ?? offerId);
    return { externalRef: listingId, status: "PENDING", isAsync: false };
  }

  // ─── optional: updateProduct ─────────────────────────────────────────────
  //
  // See the file-header note: this deliberately does NOT re-run
  // create-offer + publish-offer like the prototype did. Once a listing is
  // live, updating it is just re-upserting the inventory item — eBay's PUT
  // is an idempotent upsert keyed by SKU, and there is no supported "update
  // this specific offer's core listing content" call that publishProduct's
  // offer/publish steps could safely repeat.

  async updateProduct(ctx: ConnectorContext, product: ProductPayload, externalRef: string): Promise<SubmissionRef> {
    const validation = await this.validateProduct(ctx, product);
    if (!validation.isValid) {
      throw new EbayPublishError(validation.errors, validation.errors.map((issue) => issue.sellerMessage).join(" | "));
    }
    const token = await ctx.getAccessToken();
    const headers = this.buildApiHeaders(token);
    await this.upsertInventoryItem(ctx, product, headers);
    return { externalRef, status: "PENDING", isAsync: false };
  }

  private async upsertInventoryItem(ctx: ConnectorContext, product: ProductPayload, headers: Record<string, string>): Promise<void> {
    const response = await this.fetchWithTimeout(`${API_BASE}/inventory_item/${encodeURIComponent(product.sku)}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(this.buildInventoryItemPayload(product)),
    });
    if (response.status !== 200 && response.status !== 204) {
      const body = await this.parseJsonResponse<Record<string, unknown>>(response);
      throw this.toPublishError(body, response.status);
    }
  }

  // ─── optional: syncSubmissionStatus ──────────────────────────────────────

  async syncSubmissionStatus(ctx: ConnectorContext, externalRef: string): Promise<SubmissionStatusUpdate> {
    const token = await ctx.getAccessToken();
    const response = await this.fetchWithTimeout(`${API_BASE}/offer/${externalRef}`, {
      headers: this.buildApiHeaders(token),
    });
    if (response.status === 404) {
      return {
        externalRef,
        status: "ERROR",
        channelErrors: [{ code: "OFFER_NOT_FOUND", fieldPath: "", sellerMessage: "Offer not found on eBay.", severity: "error" }],
      };
    }
    const body = await this.parseJsonResponse<Record<string, unknown>>(response);
    if (!response.ok) {
      return { externalRef, status: "ERROR", channelErrors: [this.toPublishError(body, response.status).issues[0]] };
    }
    const state = String(body.status ?? "").toUpperCase();
    const status = state === "PUBLISHED" ? "SUCCESS" : state === "ENDED" ? "SUPPRESSED" : "PENDING";
    return { externalRef, status, channelErrors: [], ...(status === "PENDING" ? {} : { resolvedAt: new Date() }) };
  }

  // ─── OAuth ────────────────────────────────────────────────────────────────
  //
  // eBay's Sell APIs use authorization_code (3-legged, user consent) for the
  // initial grant, then refresh_token thereafter — never client_credentials
  // for these write endpoints. The authorize-URL is generated by the OAuth-
  // initiation flow elsewhere; this callback only needs the resulting code
  // back. eBay's redirect_uri is actually a "RuName" configured in the
  // developer account, not a raw URL, but is passed through the same way.

  async handleOAuthCallback(ctx: ConnectorContext, params: Record<string, string>): Promise<void> {
    const code = String(params.code ?? "").trim();
    if (!code) {
      throw new Error("Missing eBay OAuth authorization code.");
    }
    const clientId = await this.requireCredential(ctx, "client_id");
    const clientSecret = await this.requireCredential(ctx, "client_secret");
    const redirectUri = String(params.redirectUri ?? params.redirect_uri ?? "").trim();
    if (!redirectUri) {
      throw new Error("Missing eBay redirect_uri (RuName).");
    }

    const token = await this.exchangeToken(clientId, clientSecret, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });
    await this.persistTokenSet(ctx, token);
  }

  async refreshAccessToken(ctx: ConnectorContext): Promise<string> {
    const clientId = await this.requireCredential(ctx, "client_id");
    const clientSecret = await this.requireCredential(ctx, "client_secret");
    const refreshToken = await this.requireCredential(ctx, "refresh_token");
    const token = await this.exchangeToken(clientId, clientSecret, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: SELL_INVENTORY_SCOPE,
    });
    await this.persistTokenSet(ctx, token);
    if (!token.access_token) {
      throw new Error("eBay token response did not include access_token.");
    }
    return token.access_token;
  }

  private async exchangeToken(clientId: string, clientSecret: string, payload: Record<string, string>): Promise<EbayTokenResponse> {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await this.fetchWithTimeout(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basicAuth}` },
      body: new URLSearchParams(payload).toString(),
    });
    const text = await response.text();
    let parsed: EbayTokenResponse | Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as EbayTokenResponse) : {};
    } catch {
      parsed = {};
    }
    if (!response.ok) {
      throw new EbayTokenExchangeError(response.status, parsed);
    }
    return parsed as EbayTokenResponse;
  }

  private async persistTokenSet(ctx: ConnectorContext, token: EbayTokenResponse): Promise<void> {
    const now = Date.now();
    if (token.access_token) {
      await this.storeCredential(ctx, "access_token", token.access_token, computeTokenExpiry(token.expires_in, now));
    }
    // eBay's user refresh tokens are long-lived (~18 months) and are not
    // guaranteed to rotate on every use like Etsy's — but persist a new one
    // if the response includes it, rather than assuming it never changes.
    if (token.refresh_token) {
      await this.storeCredential(ctx, "refresh_token", token.refresh_token, null);
    }
  }

  // ─── credential + transport plumbing ────────────────────────────────────

  private buildApiHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
    };
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, { ...init, signal: AbortSignal.timeout(CONNECTOR_HTTP_TIMEOUT_MS) });
  }

  private async requireCredential(ctx: ConnectorContext, credentialType: string): Promise<string> {
    const value = await this.getPlainCredential(ctx, credentialType);
    if (!value) {
      throw new Error(`Missing eBay credential '${credentialType}'.`);
    }
    return value;
  }

  private async requirePolicyIds(ctx: ConnectorContext): Promise<{ fulfillment: string; payment: string; return: string }> {
    const [fulfillment, payment, ret] = await Promise.all([
      this.getPlainCredential(ctx, "fulfillment_policy_id"),
      this.getPlainCredential(ctx, "payment_policy_id"),
      this.getPlainCredential(ctx, "return_policy_id"),
    ]);
    if (!fulfillment || !payment || !ret) {
      const missing = [!fulfillment && "fulfillment", !payment && "payment", !ret && "return"].filter(Boolean).join(", ");
      throw new EbayPublishError(
        [
          {
            code: "EBAY_BUSINESS_POLICIES_MISSING",
            fieldPath: "",
            sellerMessage: `eBay Business Policies are not configured for this installation (missing: ${missing}). Set them up in eBay Seller Hub and add the policy IDs to this connector.`,
            severity: "error",
          },
        ],
        `eBay publish failed: missing Business Policy IDs (${missing}).`,
      );
    }
    return { fulfillment, payment, return: ret };
  }

  private async getPlainCredential(ctx: ConnectorContext, credentialType: string): Promise<string | null> {
    const db = this.prismaDirect.getClient();
    const row: CredentialRow | null = await db.connectorCredential.findFirst({
      where: { tenantKey: ctx.tenantId, installationId: ctx.installationId, credentialType },
      select: { encryptedValue: true, keyVersion: true, status: true },
    });
    if (!row) {
      return null;
    }
    if (row.status && row.status.toUpperCase() === "DISABLED") {
      return null;
    }
    const version = parseCredentialKeyVersion(row.keyVersion ?? "v1");
    const key = this.keys.get(version);
    if (!key) {
      return null;
    }
    return decryptCredentialValue(row.encryptedValue, key);
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

  private toPublishError(body: Record<string, unknown>, statusCode: number): EbayPublishError {
    const errors = Array.isArray(body?.errors) ? (body.errors as Array<Record<string, unknown>>) : [];
    if (errors.length > 0) {
      const first = errors[0];
      const code = String(first.errorId ?? "EBAY_ERROR");
      const message = String(first.message ?? "");
      const issue = this.normaliseError(code, message);
      return new EbayPublishError([issue], `eBay request failed with status ${statusCode}: ${issue.sellerMessage}`);
    }
    const issue = this.normaliseError("HTTP_ERROR", `eBay request failed with status ${statusCode}.`);
    return new EbayPublishError([issue], issue.sellerMessage);
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

  private readString(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
  }
}
