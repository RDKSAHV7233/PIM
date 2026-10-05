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
  ConnectorInterface,
  ConnectorIssue,
  CredentialVerificationResult,
  ProductPayload,
  SubmissionRef,
  SubmissionStatusUpdate,
  ValidationResult,
} from "../../connector-framework/connector.interface";
import { noAutomaticRetry } from "../../connector-framework/connector-retry-policy";
import { PrismaDirectService } from "../../prisma/prisma-direct.service";

// Business Central Online API v2.0 (OData). Auth: Azure AD client_credentials
// grant, scope https://api.businesscentral.dynamics.com/.default.
//
// VERIFICATION STATUS (2026-09-20) — deliberately less proven than the
// Etsy/Odoo ports: only the Azure AD token exchange itself was confirmed live
// (real 200, real access_token, against a real vexapim.com Entra app
// registration). The actual Business Central data-API call
// (validateCredentials' GET /items) was NOT successfully re-verified after
// the Automation.ReadWrite.All permission fix — the verification script was
// blocked by this environment's own credential-handling safety controls
// before a second live attempt could complete. Do not treat this connector
// as having the same live-proof standard as Etsy/Odoo until that gap closes.
//
// Credential storage (repurposing InstallConnectorDto's generic fields, same
// convention as odoo.connector.ts / etsy.connector.ts):
//   externalAccountRef -> aad_tenant        (Azure AD tenant ID or domain)
//   clientId           -> client_id         (Azure AD app registration's Application ID)
//   clientSecret       -> client_secret     (Azure AD app registration's client secret)
//   refreshToken       -> environment_company (pipe-separated "{environment}|{companyName}",
//                                              e.g. "Production|CRONUS IN" — BC's v2.0 API
//                                              needs the company's GUID, not its display name,
//                                              so this is resolved to an id via a live lookup
//                                              rather than asking the operator for an opaque GUID)

type CredentialRow = {
  id: string;
  encryptedValue: string;
  keyVersion: string;
  status: string;
  expiresAt: Date | null;
  failureReason: string | null;
};

type AadTokenResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
};

class AadTokenExchangeError extends Error {
  readonly status: number;
  readonly body: AadTokenResponse | Record<string, unknown>;
  constructor(status: number, body: AadTokenResponse | Record<string, unknown>) {
    super(`Azure AD token exchange failed with status ${status}.`);
    this.name = "AadTokenExchangeError";
    this.status = status;
    this.body = body;
  }
}

const CONNECTOR_HTTP_TIMEOUT_MS = 30_000;
const SCOPE = "https://api.businesscentral.dynamics.com/.default";

const ERROR_MESSAGES: Record<string, string> = {
  INTERNAL_ITEMWITHSAMENUMBEREXISTS: "An item with this number already exists. Update it instead.",
  BADREQUEST_INVALIDITEMCATEGORY: "The item category code does not exist in this company.",
  INTERNAL_INVALIDUNITOFMEASURE: "The base unit of measure code is not configured.",
  UNAUTHORIZED: "Azure AD token is missing the required Business Central API permission.",
};

function computeTokenExpiry(expiresIn: number | undefined, now: number): Date | null {
  return Number.isFinite(expiresIn) ? new Date(now + Math.max(1, Number(expiresIn)) * 1000) : null;
}

@Injectable()
export class Dynamics365Connector implements ConnectorInterface {
  readonly slug = "dynamics-365";
  readonly displayName = "Microsoft Dynamics 365 Business Central";
  readonly implementationStatus = "full" as const;
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

  async validateCredentials(ctx: ConnectorContext): Promise<boolean> {
    const result = await this.validateStoredCredentialsDetailed(ctx);
    return result.outcome === "valid";
  }

  async validateStoredCredentialsDetailed(ctx: ConnectorContext): Promise<CredentialVerificationResult> {
    try {
      const token = await ctx.getAccessToken();
      const base = await this.resolveApiBase(ctx);
      const resp = await this.fetchWithTimeout(`${base}/items?$top=1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await this.noteCredentialHealth(ctx, resp.ok ? null : `Business Central API returned status ${resp.status}.`);
      if (resp.status === 401 || resp.status === 403) {
        return { outcome: "invalid", reasonCode: `HTTP_${resp.status}` };
      }
      if (!resp.ok) {
        return { outcome: "unavailable", reasonCode: `HTTP_${resp.status}` };
      }
      this.logger.info("Dynamics 365 credentials validated", { installationId: ctx.installationId });
      return { outcome: "valid" };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.noteCredentialHealth(ctx, reason);
      this.logger.warn("Dynamics 365 credential validation failed", { installationId: ctx.installationId, reason });
      if (error instanceof AadTokenExchangeError) {
        const bodyError = String((error.body as Record<string, unknown>)?.error ?? "").trim().toLowerCase();
        if (error.status === 401 || bodyError === "invalid_client" || bodyError === "unauthorized_client") {
          return { outcome: "invalid", reasonCode: bodyError || `HTTP_${error.status}` };
        }
        return { outcome: "unavailable", reasonCode: `HTTP_${error.status}` };
      }
      return { outcome: "unavailable", reasonCode: "UNKNOWN_ERROR" };
    }
  }

  // ─── optional: verifyCandidateCredentials ───────────────────────────────────
  // Side-effect-free: exchanges the candidate triplet directly, never touches
  // stored rows. No refresh_token to rotate — client_credentials always mints
  // a fresh access_token, so commitExtra only ever carries accessToken.
  async verifyCandidateCredentials(candidate: Record<string, string>): Promise<CredentialVerificationResult> {
    const tenant = String(candidate.aad_tenant ?? "").trim();
    const clientId = String(candidate.client_id ?? "").trim();
    const clientSecret = String(candidate.client_secret ?? "").trim();
    const envCompany = String(candidate.environment_company ?? "").trim();
    const [environment] = this.parseEnvironmentCompany(envCompany);

    try {
      const token = await this.exchangeToken(tenant, clientId, clientSecret);
      if (!token.access_token) {
        return { outcome: "unavailable", reasonCode: "AAD_TOKEN_RESPONSE_INCOMPLETE" };
      }
      const now = Date.now();
      // Confirm the token is actually accepted by Business Central, not just
      // by Azure AD — a valid AAD token and a BC-accepted token are two
      // different claims (see file-header verification-status note).
      const companiesResp = await this.fetchWithTimeout(
        `https://api.businesscentral.dynamics.com/v2.0/${encodeURIComponent(environment)}/api/v2.0/companies`,
        { headers: { Authorization: `Bearer ${token.access_token}` } },
      );
      if (companiesResp.status === 401 || companiesResp.status === 403) {
        return { outcome: "invalid", reasonCode: `HTTP_${companiesResp.status}` };
      }
      if (!companiesResp.ok) {
        return { outcome: "unavailable", reasonCode: `HTTP_${companiesResp.status}` };
      }
      return {
        outcome: "valid",
        commitExtra: { accessToken: { value: token.access_token, expiresAt: computeTokenExpiry(token.expires_in, now) } },
      };
    } catch (err) {
      if (err instanceof AadTokenExchangeError) {
        const bodyError = String((err.body as Record<string, unknown>)?.error ?? "").trim().toLowerCase();
        if (err.status === 401 || bodyError === "invalid_client" || bodyError === "unauthorized_client") {
          return { outcome: "invalid", reasonCode: bodyError || `HTTP_${err.status}` };
        }
        return { outcome: "unavailable", reasonCode: `HTTP_${err.status}` };
      }
      return { outcome: "unavailable", reasonCode: "UNKNOWN_NETWORK_ERROR" };
    }
  }

  async validateProduct(_ctx: ConnectorContext, product: ProductPayload): Promise<ValidationResult> {
    const errors: ConnectorIssue[] = [];
    const warnings: ConnectorIssue[] = [];

    if (!product.title || String(product.title).trim().length === 0) {
      errors.push({ code: "MISSING_DISPLAY_NAME", fieldPath: "title", sellerMessage: "displayName is required for BC items.", severity: "error" });
    } else if (product.title.length > 100) {
      errors.push({ code: "NAME_TOO_LONG", fieldPath: "title", sellerMessage: "Business Central item displayName is limited to 100 characters.", severity: "error" });
    }
    if (product.sellingPrice == null || product.sellingPrice < 0) {
      errors.push({ code: "MISSING_UNIT_PRICE", fieldPath: "sellingPrice", sellerMessage: "unitPrice must be a non-negative number.", severity: "error" });
    }
    if (!product.attributes?.["item_category_code"]) {
      warnings.push({
        code: "MISSING_ITEM_CATEGORY",
        fieldPath: "attributes.item_category_code",
        sellerMessage: "Set attributes.item_category_code so the item lands in the right posting group.",
        severity: "warning",
      });
    }

    return { isValid: errors.length === 0, errors, warnings, source: "LOCAL_RULES" };
  }

  normaliseError(errorCode: string, rawMessage: string): ConnectorIssue {
    const normalizedCode = String(errorCode ?? "").trim().toUpperCase() || "UNKNOWN_ERROR";
    const sellerMessage =
      ERROR_MESSAGES[normalizedCode] ?? (String(rawMessage ?? "").trim() || `Business Central returned an error: ${normalizedCode}. Contact support.`);
    return { code: normalizedCode, fieldPath: "", sellerMessage, severity: "error" };
  }

  async publishProduct(ctx: ConnectorContext, product: ProductPayload): Promise<SubmissionRef> {
    const validation = await this.validateProduct(ctx, product);
    if (!validation.isValid) {
      throw new Error(validation.errors.map((issue) => issue.sellerMessage).join(" | "));
    }
    const base = await this.resolveApiBase(ctx);
    const token = await ctx.getAccessToken();

    // Microsoft documents no idempotency or duplicate behavior for POST /items, so a repeated
    // create after a lost response is not provably safe. One attempt only.
    const response = await (ctx.fetch ? ctx.fetch(`${base}/items`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(this.buildItemPayload(product)),
      ...noAutomaticRetry("dynamics365_create_item"),
    }) : this.fetchWithTimeout(`${base}/items`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(this.buildItemPayload(product)),
    }));

    const body = await this.parseJsonResponse<Record<string, unknown>>(response);
    if (!response.ok) {
      throw new Error(this.describeFailure(body, response.status));
    }
    return { externalRef: String(body.id ?? product.sku), status: "SUCCESS", isAsync: false };
  }

  async updateProduct(ctx: ConnectorContext, product: ProductPayload, externalRef: string): Promise<SubmissionRef> {
    const validation = await this.validateProduct(ctx, product);
    if (!validation.isValid) {
      throw new Error(validation.errors.map((issue) => issue.sellerMessage).join(" | "));
    }
    const base = await this.resolveApiBase(ctx);
    const token = await ctx.getAccessToken();
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "If-Match": "*" };

    const response = await (ctx.fetch
      ? ctx.fetch(`${base}/items(${externalRef})`, { method: "PATCH", headers, body: JSON.stringify(this.buildItemPayload(product)) })
      : this.fetchWithTimeout(`${base}/items(${externalRef})`, { method: "PATCH", headers, body: JSON.stringify(this.buildItemPayload(product)) }));

    const body = await this.parseJsonResponse<Record<string, unknown>>(response);
    if (!response.ok) {
      throw new Error(this.describeFailure(body, response.status));
    }
    return { externalRef, status: "SUCCESS", isAsync: false };
  }

  async syncSubmissionStatus(ctx: ConnectorContext, externalRef: string): Promise<SubmissionStatusUpdate> {
    const base = await this.resolveApiBase(ctx);
    const token = await ctx.getAccessToken();
    const response = await this.fetchWithTimeout(`${base}/items(${externalRef})`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 404) {
      return {
        externalRef,
        status: "ERROR",
        channelErrors: [{ code: "ITEM_NOT_FOUND", fieldPath: "", sellerMessage: "Item not found in Business Central.", severity: "error" }],
      };
    }
    const body = await this.parseJsonResponse<Record<string, unknown>>(response);
    if (!response.ok) {
      return { externalRef, status: "ERROR", channelErrors: [this.normaliseError("UNKNOWN_ERROR", this.describeFailure(body, response.status))] };
    }
    const status = body.blocked ? "REJECTED" : "SUCCESS";
    return { externalRef, status, channelErrors: [], resolvedAt: new Date() };
  }

  async refreshAccessToken(ctx: ConnectorContext): Promise<string> {
    const tenant = await this.requireCredential(ctx, "aad_tenant");
    const clientId = await this.requireCredential(ctx, "client_id");
    const clientSecret = await this.requireCredential(ctx, "client_secret");
    const token = await this.exchangeToken(tenant, clientId, clientSecret);
    if (!token.access_token) {
      throw new Error("Azure AD token response did not include access_token.");
    }
    await this.storeCredential(ctx, "access_token", token.access_token, { expiresAt: computeTokenExpiry(token.expires_in, Date.now()) });
    return token.access_token;
  }

  // ─── payload building ───────────────────────────────────────────────────────

  private buildItemPayload(product: ProductPayload): Record<string, unknown> {
    const attrs = product.attributes ?? {};
    return {
      number: product.sku.slice(0, 20),
      displayName: product.title.slice(0, 100),
      type: "Inventory",
      itemCategoryCode: attrs["item_category_code"] ?? "",
      unitPrice: product.sellingPrice ?? 0,
      baseUnitOfMeasureCode: this.readString(attrs["base_unit"], "PCS"),
      gtin: attrs["gtin"] ?? "",
      inventory: this.readPositiveInteger(attrs["stock"], 0),
      taxGroupCode: this.readString(attrs["tax_group"], "TAXABLE"),
      blocked: false,
    };
  }

  // ─── credential + transport plumbing ────────────────────────────────────────

  private parseEnvironmentCompany(raw: string): [environment: string, companyName: string] {
    const [environment, companyName] = raw.split("|").map((s) => s.trim());
    return [environment || "Production", companyName || ""];
  }

  // Business Central's v2.0 API addresses a company by its GUID, not its
  // display name — the operator only knows the name (e.g. "CRONUS IN"), so
  // this resolves it via a live lookup rather than asking for an opaque id.
  // No persistent cache: call volume here is low (once per publish/validate),
  // matching the same "re-resolve every call" simplicity as odoo.connector.ts's
  // per-call authenticate().
  private async resolveApiBase(ctx: ConnectorContext): Promise<string> {
    const envCompanyRaw = await this.requireCredential(ctx, "environment_company");
    const [environment, companyName] = this.parseEnvironmentCompany(envCompanyRaw);
    const token = await ctx.getAccessToken();
    const listUrl = `https://api.businesscentral.dynamics.com/v2.0/${encodeURIComponent(environment)}/api/v2.0/companies`;
    const resp = await this.fetchWithTimeout(listUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) {
      throw new Error(`Failed to resolve Business Central company (status ${resp.status}).`);
    }
    const body = await this.parseJsonResponse<{ value?: Array<{ id: string; name: string; displayName?: string }> }>(resp);
    const companies = body.value ?? [];
    const match = companyName
      ? companies.find((c) => c.name === companyName || c.displayName === companyName)
      : companies[0];
    if (!match) {
      throw new Error(`Business Central company '${companyName || "(default)"}' not found in environment '${environment}'.`);
    }
    return `https://api.businesscentral.dynamics.com/v2.0/${encodeURIComponent(environment)}/api/v2.0/companies(${match.id})`;
  }

  private async exchangeToken(tenant: string, clientId: string, clientSecret: string): Promise<AadTokenResponse> {
    const response = await this.fetchWithTimeout(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope: SCOPE }).toString(),
    });
    const text = await response.text();
    let parsed: AadTokenResponse | Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as AadTokenResponse) : {};
    } catch {
      parsed = {};
    }
    if (!response.ok) {
      throw new AadTokenExchangeError(response.status, parsed);
    }
    return parsed as AadTokenResponse;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, { ...init, signal: AbortSignal.timeout(CONNECTOR_HTTP_TIMEOUT_MS) });
  }

  private async noteCredentialHealth(ctx: ConnectorContext, failureReason: string | null): Promise<void> {
    const db = this.prismaDirect.getClient();
    await db.connectorCredential.updateMany({
      where: {
        tenantKey: ctx.tenantId,
        installationId: ctx.installationId,
        credentialType: { in: ["access_token", "client_id", "client_secret", "aad_tenant"] },
      },
      data: { lastValidatedAt: new Date(), failureReason, updatedAt: new Date() },
    });
  }

  private async requireCredential(ctx: ConnectorContext, credentialType: string): Promise<string> {
    const row = await this.getCredentialRow(ctx, credentialType);
    if (!row) {
      throw new Error(`Missing Dynamics 365 credential '${credentialType}'.`);
    }
    if (row.status && row.status.toUpperCase() === "DISABLED") {
      throw new Error(`Dynamics 365 credential '${credentialType}' is disabled.`);
    }
    return this.decryptCredential(row);
  }

  private async getCredentialRow(ctx: ConnectorContext, credentialType: string): Promise<CredentialRow | null> {
    const db = this.prismaDirect.getClient();
    const row = await db.connectorCredential.findFirst({
      where: { tenantKey: ctx.tenantId, installationId: ctx.installationId, credentialType },
      select: { id: true, encryptedValue: true, keyVersion: true, status: true, expiresAt: true, failureReason: true },
    });
    return row ?? null;
  }

  private decryptCredential(row: CredentialRow): string {
    const version = parseCredentialKeyVersion(row.keyVersion);
    const key = this.keys.get(version);
    if (!key) {
      throw new Error(`Missing credential encryption key for version ${version}.`);
    }
    return decryptCredentialValue(row.encryptedValue, key);
  }

  private async storeCredential(
    ctx: ConnectorContext,
    credentialType: string,
    plainValue: string,
    options: { expiresAt?: Date | null } = {},
  ): Promise<void> {
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
        expiresAt: options.expiresAt ?? null,
        failureReason: null,
        lastRefreshAt: new Date(),
      },
      update: {
        tenantKey: ctx.tenantId,
        encryptedValue: encrypted.cipher,
        keyVersion,
        status: "ACTIVE",
        expiresAt: options.expiresAt ?? null,
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

  private describeFailure(body: Record<string, unknown>, statusCode: number): string {
    const err = body.error as { code?: string; message?: string } | undefined;
    if (err?.code) {
      return this.normaliseError(err.code, err.message ?? "").sellerMessage;
    }
    return `Business Central request failed with status ${statusCode}.`;
  }

  private readPositiveInteger(value: unknown, fallback: number): number {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.round(value);
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.round(parsed);
      }
    }
    return fallback;
  }

  private readString(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
  }
}
