// apps/api/src/connectors/zoho-inventory/zoho-inventory.connector.ts
//
// Capabilities: PUBLISH + VALIDATE + STATUS_SYNC
// implementationStatus: full (code-complete); launch stage: under_development
// (see connector-launch-policy.ts).
//
// Auth: Zoho OAuth2 refresh_token grant against {accounts host}/oauth/v2/token,
// using a Zoho API Console "Server-based Application" client_id/client_secret
// plus a refresh_token obtained via a one-time authorization-code consent flow.
// Unlike Etsy, Zoho does NOT rotate the refresh_token on use — it stays valid
// until the user revokes it, so only the access_token needs persisting per
// exchange.
//
// Credential storage (ConnectorCredential rows per installationId):
//   credentialType: 'client_id'       — Zoho API Console client id
//   credentialType: 'client_secret'   — Zoho API Console client secret
//   credentialType: 'refresh_token'   — obtained via the OAuth consent flow
//   credentialType: 'organization_id' — Zoho Inventory organization id
//                                       (required on every API call)
//
// Real bug #1 (found by inspection, fixed before live-testing): the prototype
// hardcoded Zoho's US data center (accounts.zoho.com / www.zohoapis.com) for
// both the token exchange and the API base. Zoho enforces per-region hosts —
// an org registered in India, the EU, Australia, Japan, or China must use
// that region's host, and calling the US host for a non-US org fails
// outright. This platform is clearly India-focused (HSN/GST fields
// throughout the other connectors), so this would have silently broken for
// exactly the sellers most likely to use it. Fixed here to resolve the host
// pair from the installation's region, carried in ctx.marketplaceId (the
// same generic field eBay already reuses for its own per-installation
// region/marketplace value — no new plumbing needed), defaulting to the
// global "com" host when unset for backward compatibility.
//
// Real bug #2 (found live, 2026-09-24, against a real India-region Zoho
// Inventory trial org): the prototype also hardcoded taxability_type:
// "taxable" and is_taxable: true on every item payload. Both are rejected on
// this org — taxability_type: "Invalid value passed for taxability_type"
// (it's a GST-specific field whose allowed values depend on the
// organization's GST configuration; this trial org isn't GST-registered),
// and once that was removed, is_taxable itself came back "Invalid Element
// is_taxable" (the Items API's create endpoint doesn't accept it directly —
// an item's taxability is governed by its tax association, not this field).
// Fixed by dropping both entirely; tax/HSN classification still flows
// through hsn_or_sac. Verified live: publish/status-sync/update all succeed
// once both fields are removed.

import { Injectable } from "@nestjs/common";
import { LoggerService } from "../../common/logging/logger.service";
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

// Zoho's documented per-region data centers. Each one has its own accounts
// (OAuth) host and its own API host — a token minted against one data
// center's accounts host is not valid against another's API host.
const ZOHO_DATA_CENTERS: Record<string, { accounts: string; api: string }> = {
  com: { accounts: "https://accounts.zoho.com", api: "https://www.zohoapis.com" },
  eu: { accounts: "https://accounts.zoho.eu", api: "https://www.zohoapis.eu" },
  in: { accounts: "https://accounts.zoho.in", api: "https://www.zohoapis.in" },
  "com.au": { accounts: "https://accounts.zoho.com.au", api: "https://www.zohoapis.com.au" },
  jp: { accounts: "https://accounts.zoho.jp", api: "https://www.zohoapis.jp" },
  "com.cn": { accounts: "https://accounts.zoho.com.cn", api: "https://www.zohoapis.com.cn" },
};
const DEFAULT_DATA_CENTER = "com";

function resolveDataCenter(raw: string | undefined | null): { accounts: string; api: string } {
  const key = String(raw ?? "").trim().toLowerCase();
  return ZOHO_DATA_CENTERS[key] ?? ZOHO_DATA_CENTERS[DEFAULT_DATA_CENTER];
}

type ResolvedCredentials = { clientId: string; clientSecret: string; refreshToken: string; organizationId: string };

const ERROR_MESSAGES: Record<string, string> = {
  "1001": "An item with this SKU already exists. Update it instead.",
  "57": "The OAuth token lacks ZohoInventory.items write scope.",
  "2046": "The HSN/SAC code is invalid for the organisation's tax setup.",
  "21025": "Zoho rate limit hit for this organisation. Retry shortly.",
};
const ERROR_FIELD_PATHS: Record<string, string> = {
  "1001": "sku",
  "57": "credentials",
  "2046": "attributes.hsn",
  "21025": "",
};

export class ZohoInventoryPublishError extends Error {
  constructor(
    public readonly issues: ConnectorIssue[],
    message: string,
  ) {
    super(message);
    this.name = "ZohoInventoryPublishError";
  }
}

class ZohoTokenExchangeError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(`Zoho token exchange failed with status ${status}.`);
    this.name = "ZohoTokenExchangeError";
    this.status = status;
    this.body = body;
  }
}

@Injectable()
export class ZohoInventoryConnector implements ConnectorInterface {
  readonly slug = "zoho-inventory";
  readonly displayName = "Zoho Inventory";
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
    const [clientId, clientSecret, refreshToken, organizationId] = await Promise.all([
      this.getPlainCredential(ctx, "client_id"),
      this.getPlainCredential(ctx, "client_secret"),
      this.getPlainCredential(ctx, "refresh_token"),
      this.getPlainCredential(ctx, "organization_id"),
    ]);
    if (!clientId || !clientSecret || !refreshToken || !organizationId) {
      throw new Error("Zoho credentials incomplete. Verify client_id, client_secret, refresh_token, and organization_id are stored.");
    }
    return { clientId, clientSecret, refreshToken, organizationId };
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, { ...init, signal: AbortSignal.timeout(CONNECTOR_HTTP_TIMEOUT_MS) });
  }

  private async exchangeRefreshToken(
    accountsHost: string,
    clientId: string,
    clientSecret: string,
    refreshToken: string,
  ): Promise<{ access_token?: string; expires_in?: number }> {
    const url = new URL(`${accountsHost}/oauth/v2/token`);
    url.searchParams.set("grant_type", "refresh_token");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("client_secret", clientSecret);
    url.searchParams.set("refresh_token", refreshToken);
    const response = await this.fetchWithTimeout(url.toString(), { method: "POST" });
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }
    if (!response.ok || parsed.error) {
      throw new ZohoTokenExchangeError(response.ok ? 401 : response.status, parsed);
    }
    return parsed;
  }

  private computeTokenExpiry(expiresIn: number | undefined): Date | null {
    return Number.isFinite(expiresIn) ? new Date(Date.now() + Math.max(1, Number(expiresIn)) * 1000) : null;
  }

  async refreshAccessToken(ctx: ConnectorContext): Promise<string> {
    const { clientId, clientSecret, refreshToken } = await this.resolveCredentials(ctx);
    const { accounts } = resolveDataCenter(ctx.marketplaceId);
    const token = await this.exchangeRefreshToken(accounts, clientId, clientSecret, refreshToken);
    if (!token.access_token) {
      throw new Error("Zoho token response did not include access_token.");
    }
    await this.storeCredential(ctx, "access_token", token.access_token, this.computeTokenExpiry(token.expires_in));
    return token.access_token;
  }

  // ─── required: validateCredentials ───────────────────────────────────────

  async validateCredentials(ctx: ConnectorContext): Promise<boolean> {
    const result = await this.validateStoredCredentialsDetailed(ctx);
    return result.outcome === "valid";
  }

  async validateStoredCredentialsDetailed(ctx: ConnectorContext): Promise<CredentialVerificationResult> {
    try {
      const { organizationId } = await this.resolveCredentials(ctx);
      const { api } = resolveDataCenter(ctx.marketplaceId);
      const token = await ctx.getAccessToken();
      const url = new URL(`${api}/inventory/v1/items`);
      url.searchParams.set("organization_id", organizationId);
      url.searchParams.set("per_page", "1");
      const response = await this.fetchWithTimeout(url.toString(), {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
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
      this.logger.warn("Zoho Inventory credential validation failed", { installationId: ctx.installationId, reason });
      if (error instanceof ZohoTokenExchangeError) {
        return { outcome: error.status === 401 ? "invalid" : "unavailable", reasonCode: `HTTP_${error.status}` };
      }
      return { outcome: "unavailable", reasonCode: "UNKNOWN_ERROR" };
    }
  }

  // ─── optional: verifyCandidateCredentials ───────────────────────────────

  async verifyCandidateCredentials(candidate: Record<string, string>): Promise<CredentialVerificationResult> {
    const clientId = String(candidate.client_id ?? "").trim();
    const clientSecret = String(candidate.client_secret ?? "").trim();
    const refreshToken = String(candidate.refresh_token ?? "").trim();
    const organizationId = String(candidate.organization_id ?? "").trim();
    const { accounts, api } = resolveDataCenter(candidate.data_center);
    try {
      const token = await this.exchangeRefreshToken(accounts, clientId, clientSecret, refreshToken);
      if (!token.access_token) {
        return { outcome: "unavailable", reasonCode: "ZOHO_TOKEN_RESPONSE_INCOMPLETE" };
      }
      const url = new URL(`${api}/inventory/v1/items`);
      url.searchParams.set("organization_id", organizationId);
      url.searchParams.set("per_page", "1");
      const check = await this.fetchWithTimeout(url.toString(), {
        headers: { Authorization: `Zoho-oauthtoken ${token.access_token}` },
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
      if (err instanceof ZohoTokenExchangeError) {
        return { outcome: err.status === 401 ? "invalid" : "unavailable", reasonCode: `HTTP_${err.status}` };
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
      errors.push({ code: "MISSING_NAME", fieldPath: "title", sellerMessage: "name is required for Zoho items.", severity: "error" });
    } else if (String(product.title).length > 100) {
      errors.push({ code: "NAME_TOO_LONG", fieldPath: "title", sellerMessage: "Zoho item names are limited to 100 characters.", severity: "error" });
    }
    if (product.sellingPrice == null || product.sellingPrice < 0) {
      errors.push({ code: "MISSING_RATE", fieldPath: "sellingPrice", sellerMessage: "rate must be a non-negative number.", severity: "error" });
    }
    if (product.sku && product.sku.length > 100) {
      errors.push({ code: "SKU_TOO_LONG", fieldPath: "sku", sellerMessage: "Zoho SKUs are limited to 100 characters.", severity: "error" });
    }
    if (!attrs["hsn"] && !attrs["hsn_code"]) {
      warnings.push({
        code: "MISSING_HSN",
        fieldPath: "attributes.hsn",
        sellerMessage: "HSN code is mandatory for Indian organisations.",
        severity: "warning",
      });
    }

    return { isValid: errors.length === 0, errors, warnings, source: "LOCAL_RULES" };
  }

  normaliseError(errorCode: string, rawMessage: string): ConnectorIssue {
    const normalizedCode = String(errorCode ?? "").trim();
    const sellerMessage = ERROR_MESSAGES[normalizedCode] ?? (String(rawMessage ?? "").trim() || `Zoho returned an error: ${normalizedCode || "UNKNOWN"}.`);
    const fieldPath = ERROR_FIELD_PATHS[normalizedCode] ?? "";
    return { code: normalizedCode || "ZOHO_ERROR", fieldPath, sellerMessage, severity: "error" };
  }

  // ─── payload building ───────────────────────────────────────────────────

  private buildItemPayload(product: ProductPayload): Record<string, unknown> {
    const attrs = product.attributes ?? {};
    const customFields = Object.entries(attrs)
      .filter(([key]) => key !== "hsn" && key !== "hsn_code" && key !== "unit")
      .map(([key, value]) => ({ label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), value: String(value) }));

    return {
      name: String(product.title ?? "").slice(0, 100),
      sku: String(product.sku ?? "").slice(0, 100),
      rate: product.sellingPrice ?? 0,
      description: product.description || product.title,
      item_type: "inventory",
      unit: attrs["unit"] ?? "pcs",
      brand: product.brand ?? "",
      hsn_or_sac: attrs["hsn"] ?? attrs["hsn_code"] ?? "",
      product_type: "goods",
      custom_fields: customFields,
    };
  }

  // ─── optional: publishProduct ────────────────────────────────────────────

  async publishProduct(ctx: ConnectorContext, product: ProductPayload): Promise<SubmissionRef> {
    const { organizationId } = await this.resolveCredentials(ctx);
    const { api } = resolveDataCenter(ctx.marketplaceId);
    const token = await ctx.getAccessToken();
    const url = new URL(`${api}/inventory/v1/items`);
    url.searchParams.set("organization_id", organizationId);
    const response = await this.fetchWithTimeout(url.toString(), {
      method: "POST",
      headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(this.buildItemPayload(product)),
    });
    const body = await this.parseJsonResponse<{ item?: Record<string, unknown>; code?: number; message?: string }>(response);
    if (response.status !== 200 && response.status !== 201) {
      throw this.toPublishError(body, response.status);
    }
    const itemId = body.item?.item_id;
    if (!itemId) {
      throw this.toPublishError(body, response.status);
    }
    return { externalRef: String(itemId), status: "SUCCESS", isAsync: false };
  }

  // ─── optional: updateProduct ─────────────────────────────────────────────

  async updateProduct(ctx: ConnectorContext, product: ProductPayload, externalRef: string): Promise<SubmissionRef> {
    const { organizationId } = await this.resolveCredentials(ctx);
    const { api } = resolveDataCenter(ctx.marketplaceId);
    const token = await ctx.getAccessToken();
    const url = new URL(`${api}/inventory/v1/items/${encodeURIComponent(externalRef)}`);
    url.searchParams.set("organization_id", organizationId);
    const response = await this.fetchWithTimeout(url.toString(), {
      method: "PUT",
      headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(this.buildItemPayload(product)),
    });
    if (response.status !== 200) {
      throw this.toPublishError(await this.parseJsonResponse<Record<string, unknown>>(response), response.status);
    }
    return { externalRef, status: "SUCCESS", isAsync: false };
  }

  // ─── optional: syncSubmissionStatus ──────────────────────────────────────

  async syncSubmissionStatus(ctx: ConnectorContext, externalRef: string): Promise<SubmissionStatusUpdate> {
    const { organizationId } = await this.resolveCredentials(ctx);
    const { api } = resolveDataCenter(ctx.marketplaceId);
    const token = await ctx.getAccessToken();
    const url = new URL(`${api}/inventory/v1/items/${encodeURIComponent(externalRef)}`);
    url.searchParams.set("organization_id", organizationId);
    const response = await this.fetchWithTimeout(url.toString(), {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    if (response.status === 404) {
      return {
        externalRef,
        status: "ERROR",
        channelErrors: [{ code: "ITEM_NOT_FOUND", fieldPath: "", sellerMessage: "Item not found in Zoho Inventory.", severity: "error" }],
      };
    }
    const body = await this.parseJsonResponse<{ item?: Record<string, unknown> }>(response);
    const status = (body.item?.status ?? "active") === "active" ? "SUCCESS" : "SUPPRESSED";
    return { externalRef, status, channelErrors: [], resolvedAt: new Date() };
  }

  // ─── error envelope parsing ───────────────────────────────────────────────

  private toPublishError(body: { code?: number | string; message?: string }, statusCode: number): ZohoInventoryPublishError {
    const code = body?.code != null ? String(body.code) : "API_ERROR";
    const issue = this.normaliseError(code, body?.message ?? "");
    return new ZohoInventoryPublishError([issue], `Zoho request failed with status ${statusCode}: ${issue.sellerMessage}`);
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
