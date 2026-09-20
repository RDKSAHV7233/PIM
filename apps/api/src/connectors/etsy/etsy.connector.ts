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
import { PrismaDirectService } from "../../prisma/prisma-direct.service";

type CredentialRow = {
  id: string;
  encryptedValue: string;
  keyVersion: string;
  status: string;
  expiresAt: Date | null;
  failureReason: string | null;
};

type EtsyTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
};

// Carries HTTP status + parsed body so callers can distinguish "credentials
// rejected" from "couldn't check right now" without re-parsing a message
// string — mirrors FlipkartTokenExchangeError.
class EtsyTokenExchangeError extends Error {
  readonly status: number;
  readonly body: EtsyTokenResponse | Record<string, unknown>;
  constructor(status: number, body: EtsyTokenResponse | Record<string, unknown>) {
    super(`Etsy token exchange failed with status ${status}.`);
    this.name = "EtsyTokenExchangeError";
    this.status = status;
    this.body = body;
  }
}

const CONNECTOR_HTTP_TIMEOUT_MS = 30_000;
const ACCESS_TOKEN_BUFFER_MS = 60_000;
// Etsy does not return a refresh-token TTL in the token response; its OAuth
// docs state refresh tokens are valid 90 days from issuance.
const DEFAULT_REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_WARNING_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
const API_BASE = "https://openapi.etsy.com/v3/application";

const ERROR_MESSAGES: Record<string, string> = {
  MISSING_FIELD: "A required Etsy field is missing. Check who_made, when_made and taxonomy_id.",
  INVALID_TAXONOMY: "The taxonomy id does not exist. Search the Etsy taxonomy and remap.",
  TITLE_TOO_LONG: "Etsy titles must be 140 characters or fewer.",
  LISTING_LIMIT: "You've hit Etsy's listing limit for this shop. Contact Etsy support.",
  REFRESH_TOKEN_EXPIRED: "Your Etsy connection has expired. Go to Connectors and reconnect your Etsy account.",
};

function computeTokenExpiry(expiresIn: number | undefined, now: number): Date | null {
  return Number.isFinite(expiresIn) ? new Date(now + Math.max(1, Number(expiresIn)) * 1000) : null;
}

@Injectable()
export class EtsyConnector implements ConnectorInterface {
  readonly slug = "etsy";
  readonly displayName = "Etsy";
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

  // ─── PIM#653 ──────────────────────────────────────────────────────────────
  // Richer sibling of validateCredentials() — see flipkart.connector.ts for
  // the full rationale. Same shape: resolve a live access token (refreshing
  // if needed), record health, and separately flag an expiring/expired
  // refresh token so a real outage is never conflated with "wrong secret".
  async validateStoredCredentialsDetailed(ctx: ConnectorContext): Promise<CredentialVerificationResult> {
    try {
      await ctx.getAccessToken();
      await this.noteCredentialHealth(ctx, null);
      const refreshStatus = await this.checkRefreshTokenHealth(ctx);
      if (refreshStatus === "expired") {
        const reason = "Etsy refresh token has expired. Reconnect the account from the Connectors page.";
        await this.noteCredentialHealth(ctx, reason);
        this.logger.error("Etsy refresh token expired", { installationId: ctx.installationId });
        return { outcome: "invalid", reasonCode: "REFRESH_TOKEN_EXPIRED" };
      }
      if (refreshStatus === "expiring_soon") {
        this.logger.warn("Etsy refresh token expiring soon", { installationId: ctx.installationId });
        await this.noteCredentialWarning(
          ctx,
          "Etsy refresh token expires within 7 days. Reconnect soon to avoid publish failures.",
        );
      }

      // A live token alone isn't proof the credentials are actually accepted —
      // the x-api-key header (client_id:shared_secret) is a second, independent
      // failure mode Etsy 403s on separately from the OAuth token itself
      // (verified live 2026-09-20: a bare client_id 403s even with a valid
      // bearer token). Confirm both by hitting a real read endpoint.
      const headers = await this.buildApiHeaders(ctx);
      const resp = await this.fetchWithTimeout(`${API_BASE}/seller-taxonomy/nodes`, { headers });
      if (resp.status === 401 || resp.status === 403) {
        const reason = `Etsy API rejected the request with status ${resp.status}.`;
        await this.noteCredentialHealth(ctx, reason);
        return { outcome: "invalid", reasonCode: `HTTP_${resp.status}` };
      }
      if (!resp.ok) {
        return { outcome: "unavailable", reasonCode: `HTTP_${resp.status}` };
      }

      this.logger.info("Etsy credentials validated", { installationId: ctx.installationId });
      return { outcome: "valid" };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.noteCredentialHealth(ctx, reason);
      this.logger.warn("Etsy credential validation failed", { installationId: ctx.installationId, reason });
      if (reason === "REFRESH_TOKEN_EXPIRED") {
        return { outcome: "invalid", reasonCode: "REFRESH_TOKEN_EXPIRED" };
      }
      if (error instanceof EtsyTokenExchangeError) {
        const bodyError = String((error.body as Record<string, unknown>)?.error ?? "").trim().toLowerCase();
        if (error.status === 401 || bodyError === "invalid_client" || bodyError === "invalid_grant") {
          return { outcome: "invalid", reasonCode: bodyError || `HTTP_${error.status}` };
        }
        return { outcome: "unavailable", reasonCode: `HTTP_${error.status}` };
      }
      return { outcome: "unavailable", reasonCode: "UNKNOWN_ERROR" };
    }
  }

  // ─── optional: verifyCandidateCredentials ───────────────────────────────────
  // Side-effect-free: exchanges the candidate refresh_token directly, never
  // touches stored rows. commitExtra sources tokens from the real exchange
  // response (Etsy rotates refresh_token on every use), not operator input.
  async verifyCandidateCredentials(candidate: Record<string, string>): Promise<CredentialVerificationResult> {
    const clientId = String(candidate.client_id ?? "").trim();
    const refreshToken = String(candidate.refresh_token ?? "").trim();
    const sharedSecret = String(candidate.shared_secret ?? "").trim();

    try {
      const token = await this.exchangeToken(undefined, clientId, {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
      if (!token.access_token) {
        return { outcome: "unavailable", reasonCode: "ETSY_TOKEN_RESPONSE_INCOMPLETE" };
      }
      // Confirm the shared_secret half of x-api-key independently — a valid
      // token exchange says nothing about whether the api-key header is
      // correct, since they're two separate Etsy auth checks.
      const apiKeyCheck = await this.fetchWithTimeout(`${API_BASE}/seller-taxonomy/nodes`, {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          "x-api-key": `${clientId}:${sharedSecret}`,
        },
      });
      if (apiKeyCheck.status === 401 || apiKeyCheck.status === 403) {
        return { outcome: "invalid", reasonCode: `HTTP_${apiKeyCheck.status}` };
      }
      const now = Date.now();
      return {
        outcome: "valid",
        commitExtra: {
          accessToken: { value: token.access_token, expiresAt: computeTokenExpiry(token.expires_in, now) },
          ...(token.refresh_token
            ? { refreshToken: { value: token.refresh_token, expiresAt: new Date(now + DEFAULT_REFRESH_TOKEN_TTL_MS) } }
            : {}),
        },
      };
    } catch (err) {
      if (err instanceof EtsyTokenExchangeError) {
        const bodyError = String((err.body as Record<string, unknown>)?.error ?? "").trim().toLowerCase();
        if (err.status === 401 || bodyError === "invalid_client" || bodyError === "invalid_grant") {
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
      errors.push({ code: "MISSING_TITLE", fieldPath: "title", sellerMessage: "Etsy listing title is required.", severity: "error" });
    } else if (product.title.length > 140) {
      errors.push({ code: "TITLE_TOO_LONG", fieldPath: "title", sellerMessage: "Etsy titles must be 140 characters or fewer.", severity: "error" });
    }
    if (product.sellingPrice == null || product.sellingPrice < 0.2) {
      errors.push({ code: "PRICE_TOO_LOW", fieldPath: "sellingPrice", sellerMessage: "Etsy requires a minimum listing price of 0.20.", severity: "error" });
    }
    if (!product.attributes?.["who_made"]) {
      errors.push({
        code: "MISSING_WHO_MADE",
        fieldPath: "attributes.who_made",
        sellerMessage: "Set attributes.who_made (i_did, someone_else, collective).",
        severity: "error",
      });
    }
    if (!product.attributes?.["taxonomy_id"]) {
      errors.push({
        code: "MISSING_TAXONOMY",
        fieldPath: "attributes.taxonomy_id",
        sellerMessage: "Map the product to an Etsy taxonomy id before listing.",
        severity: "error",
      });
    }
    if (!product.mainImageUrl) {
      errors.push({ code: "NO_IMAGE", fieldPath: "mainImageUrl", sellerMessage: "Etsy listings require at least one image to go live.", severity: "error" });
    }

    return { isValid: errors.length === 0, errors, warnings, source: "LOCAL_RULES" };
  }

  normaliseError(errorCode: string, rawMessage: string): ConnectorIssue {
    const normalizedCode = String(errorCode ?? "").trim().toUpperCase() || "UNKNOWN_ERROR";
    const sellerMessage =
      ERROR_MESSAGES[normalizedCode] ?? (String(rawMessage ?? "").trim() || `Etsy returned an error: ${normalizedCode}. Contact support.`);
    return { code: normalizedCode, fieldPath: "", sellerMessage, severity: "error" };
  }

  async publishProduct(ctx: ConnectorContext, product: ProductPayload): Promise<SubmissionRef> {
    const validation = await this.validateProduct(ctx, product);
    if (!validation.isValid) {
      throw new Error(validation.errors.map((issue) => issue.sellerMessage).join(" | "));
    }
    const shopId = await this.requireCredential(ctx, "shop_id");
    const headers = await this.buildApiHeaders(ctx);

    this.logger.info("Etsy publish request started", { installationId: ctx.installationId, sku: product.sku });
    const response = await this.fetchWithTokenRetry(ctx, `${API_BASE}/shops/${shopId}/listings`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(this.buildListingPayload(product)),
    });
    const body = await this.parseJsonResponse<Record<string, unknown>>(response);
    this.logger.info("Etsy publish request completed", {
      installationId: ctx.installationId,
      statusCode: response.status,
      sku: product.sku,
    });
    if (!response.ok) {
      throw new Error(this.describeFailure(body, response.status));
    }
    return { externalRef: String(body.listing_id ?? ""), status: "PENDING", isAsync: false };
  }

  async updateProduct(ctx: ConnectorContext, product: ProductPayload, externalRef: string): Promise<SubmissionRef> {
    const validation = await this.validateProduct(ctx, product);
    if (!validation.isValid) {
      throw new Error(validation.errors.map((issue) => issue.sellerMessage).join(" | "));
    }
    const shopId = await this.requireCredential(ctx, "shop_id");
    const headers = await this.buildApiHeaders(ctx);

    const response = await this.fetchWithTokenRetry(ctx, `${API_BASE}/shops/${shopId}/listings/${externalRef}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(this.buildListingPayload(product)),
    });
    const body = await this.parseJsonResponse<Record<string, unknown>>(response);
    if (!response.ok) {
      throw new Error(this.describeFailure(body, response.status));
    }
    return { externalRef, status: "PENDING", isAsync: false };
  }

  async syncSubmissionStatus(ctx: ConnectorContext, externalRef: string): Promise<SubmissionStatusUpdate> {
    const headers = await this.buildApiHeaders(ctx);
    const response = await this.fetchWithTokenRetry(ctx, `${API_BASE}/listings/${externalRef}`, { headers });
    if (response.status === 404) {
      return {
        externalRef,
        status: "ERROR",
        channelErrors: [{ code: "LISTING_NOT_FOUND", fieldPath: "", sellerMessage: "Listing not found on Etsy.", severity: "error" }],
      };
    }
    const body = await this.parseJsonResponse<Record<string, unknown>>(response);
    if (!response.ok) {
      return { externalRef, status: "ERROR", channelErrors: [this.normaliseError("UNKNOWN_ERROR", this.describeFailure(body, response.status))] };
    }
    const state = String(body.state ?? "").toLowerCase();
    const status = state === "active" ? "SUCCESS" : state === "sold_out" || state === "expired" ? "SUPPRESSED" : "PENDING";
    return { externalRef, status, channelErrors: [], ...(status === "PENDING" ? {} : { resolvedAt: new Date() }) };
  }

  // Etsy's grant type is authorization_code + PKCE (code_verifier), not a
  // client_secret — see sandbox-credentials/etsy.md. The authorize-URL/PKCE
  // pair is generated by the OAuth-initiation flow elsewhere; this callback
  // only needs the resulting code + the same code_verifier back.
  async handleOAuthCallback(ctx: ConnectorContext, params: Record<string, string>): Promise<void> {
    const code = String(params.code ?? "").trim();
    const codeVerifier = String(params.code_verifier ?? params.codeVerifier ?? "").trim();
    if (!code || !codeVerifier) {
      throw new Error("Missing Etsy OAuth authorization code or code_verifier.");
    }
    const clientId = await this.requireCredential(ctx, "client_id");
    const redirectUri = String(params.redirectUri ?? params.redirect_uri ?? "").trim();

    const token = await this.exchangeToken(ctx, clientId, {
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    });
    await this.persistTokenSet(ctx, token);
  }

  async refreshAccessToken(ctx: ConnectorContext): Promise<string> {
    const clientId = await this.requireCredential(ctx, "client_id");
    const refreshToken = await this.requireCredential(ctx, "refresh_token");
    let token: EtsyTokenResponse;
    try {
      token = await this.exchangeToken(ctx, clientId, { grant_type: "refresh_token", refresh_token: refreshToken });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (reason.includes("status 400") || reason.includes("status 401")) {
        const refreshRow = await this.getCredentialRow(ctx, "refresh_token");
        if (refreshRow?.expiresAt && refreshRow.expiresAt <= new Date()) {
          throw new Error("REFRESH_TOKEN_EXPIRED");
        }
      }
      throw error;
    }
    // Etsy rotates the refresh_token on every use — the old one is invalid
    // the moment this response comes back, so persisting it is not optional.
    await this.persistTokenSet(ctx, token);
    if (!token.access_token) {
      throw new Error("Etsy token response did not include access_token.");
    }
    return token.access_token;
  }

  // ─── payload building ───────────────────────────────────────────────────────

  private buildListingPayload(product: ProductPayload): Record<string, unknown> {
    const attrs = product.attributes ?? {};
    const images = [product.mainImageUrl, ...(product.additionalImageUrls ?? [])].filter(
      (url): url is string => typeof url === "string" && url.trim().length > 0,
    );
    return {
      title: product.title,
      description: product.description || product.title,
      price: product.sellingPrice ?? 0,
      quantity: this.readPositiveInteger(attrs["stock"], 5),
      who_made: this.readString(attrs["who_made"], "i_did"),
      when_made: this.readString(attrs["when_made"], "made_to_order"),
      taxonomy_id: Number(attrs["taxonomy_id"] ?? 0),
      is_supply: Boolean(attrs["is_supply"] ?? false),
      type: this.readString(attrs["listing_type"], "physical"),
      tags: (product.tags ?? [product.productType, product.brand].filter(Boolean)).slice(0, 13),
      materials: attrs["material"] ? [String(attrs["material"])] : [],
      sku: [product.sku],
      image_ids: images,
    };
  }

  // ─── credential + transport plumbing ────────────────────────────────────────

  private async buildApiHeaders(ctx: ConnectorContext): Promise<Record<string, string>> {
    const token = await ctx.getAccessToken();
    const clientId = await this.requireCredential(ctx, "client_id");
    const sharedSecret = await this.requireCredential(ctx, "shared_secret");
    return {
      Authorization: `Bearer ${token}`,
      // Etsy's v3 API rejects a bare client_id in x-api-key — it requires
      // "<client_id>:<shared_secret>" (verified live 2026-09-20; a bare
      // client_id 403s "Shared secret is required in x-api-key header").
      "x-api-key": `${clientId}:${sharedSecret}`,
    };
  }

  private async exchangeToken(
    ctx: ConnectorContext | undefined,
    clientId: string,
    payload: Record<string, string>,
  ): Promise<EtsyTokenResponse> {
    const response = await this.fetchWithTimeout(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, ...payload }).toString(),
    });
    const text = await response.text();
    let parsed: EtsyTokenResponse | Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as EtsyTokenResponse) : {};
    } catch {
      parsed = {};
    }
    if (!response.ok) {
      throw new EtsyTokenExchangeError(response.status, parsed);
    }
    this.logger.info("Etsy token exchange completed", {
      installationId: ctx?.installationId ?? "candidate-verification",
      grantType: payload.grant_type ?? "unknown",
      statusCode: response.status,
    });
    return parsed as EtsyTokenResponse;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, { ...init, signal: AbortSignal.timeout(CONNECTOR_HTTP_TIMEOUT_MS) });
  }

  private async fetchWithTokenRetry(
    ctx: ConnectorContext,
    url: string,
    init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> },
  ): Promise<Response> {
    const doFetch = async () => {
      const headers = await this.buildApiHeaders(ctx);
      return ctx.fetch
        ? ctx.fetch(url, { method: init.method, body: init.body as string | undefined, headers: { ...init.headers, ...headers } })
        : this.fetchWithTimeout(url, { ...init, headers: { ...init.headers, ...headers } });
    };
    let response = await doFetch();
    if (response.status !== 401) {
      return response;
    }
    // 401 means the token was invalidated server-side — expire locally and retry once.
    await this.invalidateAccessToken(ctx);
    response = await doFetch();
    return response;
  }

  private async persistTokenSet(ctx: ConnectorContext, token: EtsyTokenResponse): Promise<void> {
    const now = Date.now();
    if (token.access_token) {
      await this.storeCredential(ctx, "access_token", token.access_token, { expiresAt: computeTokenExpiry(token.expires_in, now) });
    }
    if (token.refresh_token) {
      await this.storeCredential(ctx, "refresh_token", token.refresh_token, { expiresAt: new Date(now + DEFAULT_REFRESH_TOKEN_TTL_MS) });
    }
  }

  private async noteCredentialHealth(ctx: ConnectorContext, failureReason: string | null): Promise<void> {
    const db = this.prismaDirect.getClient();
    await db.connectorCredential.updateMany({
      where: {
        tenantKey: ctx.tenantId,
        installationId: ctx.installationId,
        credentialType: { in: ["access_token", "refresh_token", "client_id", "shared_secret"] },
      },
      data: { lastValidatedAt: new Date(), failureReason, updatedAt: new Date() },
    });
  }

  private async noteCredentialWarning(ctx: ConnectorContext, warningReason: string): Promise<void> {
    const db = this.prismaDirect.getClient();
    await db.connectorCredential.updateMany({
      where: { tenantKey: ctx.tenantId, installationId: ctx.installationId, credentialType: "refresh_token" },
      data: { failureReason: warningReason, updatedAt: new Date() },
    });
  }

  private async requireCredential(ctx: ConnectorContext, credentialType: string): Promise<string> {
    const row = await this.getCredentialRow(ctx, credentialType);
    if (!row) {
      throw new Error(`Missing Etsy credential '${credentialType}'.`);
    }
    if (row.status && row.status.toUpperCase() === "DISABLED") {
      throw new Error(`Etsy credential '${credentialType}' is disabled.`);
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

  private async checkRefreshTokenHealth(ctx: ConnectorContext): Promise<"ok" | "expiring_soon" | "expired"> {
    const row = await this.getCredentialRow(ctx, "refresh_token");
    if (!row || !row.expiresAt) {
      return "ok";
    }
    const now = new Date();
    if (row.expiresAt <= now) {
      return "expired";
    }
    if (row.expiresAt <= new Date(Date.now() + REFRESH_TOKEN_WARNING_MS)) {
      return "expiring_soon";
    }
    return "ok";
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

  private async invalidateAccessToken(ctx: ConnectorContext): Promise<void> {
    const db = this.prismaDirect.getClient();
    await db.connectorCredential.updateMany({
      where: { tenantKey: ctx.tenantId, installationId: ctx.installationId, credentialType: "access_token" },
      data: { expiresAt: new Date(), updatedAt: new Date() },
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
    const code = this.readOptionalString(body.error);
    const message = this.readOptionalString(body.error_description) ?? this.readOptionalString(body.message);
    if (code) {
      return this.normaliseError(code, message ?? "").sellerMessage;
    }
    return message ?? `Etsy request failed with status ${statusCode}.`;
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

  private readOptionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
  }

  private isCredentialFresh(row: CredentialRow): boolean {
    if (!row.expiresAt) {
      return true;
    }
    return row.expiresAt.getTime() - ACCESS_TOKEN_BUFFER_MS > Date.now();
  }
}
