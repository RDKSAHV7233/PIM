import { Injectable } from "@nestjs/common";
import { Buffer } from "node:buffer";
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

type FlipkartTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  token_type?: string;
};

const ACCESS_TOKEN_BUFFER_MS = 60_000;
const DEFAULT_REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_OAUTH_BASE_URL = "https://api.flipkart.net";
const REQUIRED_FIELDS = [
  { fieldPath: "sku", message: "Add a seller SKU before publishing to Flipkart." },
  { fieldPath: "title", message: "Product title is required for Flipkart publish." },
  { fieldPath: "brand", message: "Brand is required for Flipkart publish." },
  { fieldPath: "description", message: "Description is required for Flipkart publish." },
  { fieldPath: "hsnCode", message: "HSN code is required for Flipkart publish." },
  { fieldPath: "gstRate", message: "GST rate is required for Flipkart publish." },
  { fieldPath: "mainImageUrl", message: "Add a primary HTTPS image before publishing to Flipkart." },
  { fieldPath: "attributes.size", message: "Size is required for Flipkart listings." },
  { fieldPath: "attributes.color", message: "Color is required for Flipkart listings." },
] as const;

const ERROR_MESSAGES: Record<string, string> = {
  CATEGORY_MISMATCH: "Product category does not match Flipkart's category tree. Re-map the category.",
  ATTRIBUTE_MISSING: "A required Flipkart attribute is missing. Update the mapping and try again.",
  INVALID_GSTIN: "GST or HSN data is invalid or missing. Check tax details before publishing.",
  PRICE_BELOW_FLOOR: "Selling price is below Flipkart's minimum floor price for this category.",
  SKU_ALREADY_EXISTS: "This SKU is already listed on Flipkart. Update the existing listing instead of creating a new one.",
  SELLER_NOT_AUTHORISED: "Your Flipkart seller account is not authorised for this category.",
  IMAGE_COUNT_INSUFFICIENT: "Flipkart requires more product images for this category.",
  TOKEN_EXPIRED: "Flipkart connection expired. Reconnect the account and try again.",
};

@Injectable()
export class FlipkartConnector implements ConnectorInterface {
  readonly slug = "flipkart";
  readonly displayName = "Flipkart";
  readonly capabilities: ConnectorCap[] = [
    "PUBLISH",
    "VALIDATE",
    "STATUS_SYNC",
  ];

  private readonly keys = loadCredentialEncryptionKeys(process.env);
  private readonly currentKeyVersion = resolveCurrentCredentialKeyVersion(process.env);

  constructor(
    private readonly prismaDirect: PrismaDirectService,
    private readonly logger: LoggerService,
  ) {
    if (!this.keys.has(this.currentKeyVersion)) {
      throw new Error(
        `Missing credential encryption key for current version ${this.currentKeyVersion}.`,
      );
    }
  }

  async validateCredentials(ctx: ConnectorContext): Promise<boolean> {
    try {
      await this.resolveAccessToken(ctx);
      await this.noteCredentialHealth(ctx, null);
      this.logger.info("Flipkart credentials validated", {
        installationId: ctx.installationId,
      });
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.noteCredentialHealth(ctx, reason);
      this.logger.warn("Flipkart credential validation failed", {
        installationId: ctx.installationId,
        reason,
      });
      return false;
    }
  }

  async validateProduct(
    ctx: ConnectorContext,
    product: ProductPayload,
  ): Promise<ValidationResult> {
    const errors: ConnectorIssue[] = [];
    const warnings: ConnectorIssue[] = [];

    for (const field of REQUIRED_FIELDS) {
      const value = this.getFieldValue(product, field.fieldPath);
      if (this.isEmpty(value)) {
        errors.push({
          code: "REQUIRED_FIELD_MISSING",
          fieldPath: field.fieldPath,
          sellerMessage: field.message,
          severity: "error",
        });
      }
    }

    if (typeof product.mainImageUrl === "string" && product.mainImageUrl.trim().length > 0) {
      if (!/^https:\/\//i.test(product.mainImageUrl.trim())) {
        errors.push({
          code: "IMAGE_URL_NOT_HTTPS",
          fieldPath: "mainImageUrl",
          sellerMessage: "Flipkart images must use a permanent HTTPS URL.",
          severity: "error",
        });
      }
    }

    if (this.isNumber(product.mrp) && this.isNumber(product.sellingPrice) && product.sellingPrice > product.mrp) {
      warnings.push({
        code: "SELLING_PRICE_GT_MRP",
        fieldPath: "sellingPrice",
        sellerMessage: "Selling price is higher than MRP. Review Flipkart pricing before publishing.",
        severity: "warning",
      });
    }

    if (this.isEmpty(this.getFieldValue(product, "attributes.material"))) {
      warnings.push({
        code: "ATTRIBUTE_RECOMMENDED",
        fieldPath: "attributes.material",
        sellerMessage: "Material is recommended for stronger Flipkart category compliance.",
        severity: "warning",
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      source: "LOCAL_RULES",
    };
  }

  normaliseError(errorCode: string, rawMessage: string): ConnectorIssue {
    const normalizedCode = String(errorCode ?? "").trim().toUpperCase() || "UNKNOWN_ERROR";
    const sellerMessage =
      ERROR_MESSAGES[normalizedCode] ??
      (String(rawMessage ?? "").trim() || `Flipkart returned an error: ${normalizedCode}. Contact support.`);

    return {
      code: normalizedCode,
      fieldPath: "",
      sellerMessage,
      severity: "error",
    };
  }

  async handleOAuthCallback(
    ctx: ConnectorContext,
    params: Record<string, string>,
  ): Promise<void> {
    const code = String(params.code ?? "").trim();
    if (!code) {
      throw new Error("Missing Flipkart OAuth authorization code.");
    }

    const clientId = await this.requireCredential(ctx, "client_id");
    const clientSecret = await this.requireCredential(ctx, "client_secret");
    const redirectUri = String(params.redirectUri ?? params.redirect_uri ?? "").trim();

    const token = await this.exchangeToken(ctx, clientId, clientSecret, {
      grant_type: "authorization_code",
      code,
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    });

    await this.persistTokenSet(ctx, token);
  }

  async publishProduct(
    ctx: ConnectorContext,
    product: ProductPayload,
  ): Promise<SubmissionRef> {
    throw new Error("Not implemented (P5-S4)");
  }

  async updateProduct(
    ctx: ConnectorContext,
    product: ProductPayload,
    externalRef: string,
  ): Promise<SubmissionRef> {
    throw new Error("Not implemented (P5-S4)");
  }

  async syncSubmissionStatus(
    ctx: ConnectorContext,
    externalRef: string,
  ): Promise<SubmissionStatusUpdate> {
    throw new Error("Not implemented (P5-S4)");
  }

  private async resolveAccessToken(ctx: ConnectorContext): Promise<string> {
    try {
      const provided = await ctx.getAccessToken();
      if (typeof provided === "string" && provided.trim().length > 0) {
        return provided.trim();
      }
    } catch {
      // Current framework still returns an empty token for Flipkart; fall back to connector-managed resolution.
    }

    const existing = await this.getCredentialRow(ctx, "access_token");
    if (existing) {
      const accessToken = this.decryptCredential(existing);
      if (this.isCredentialFresh(existing)) {
        return accessToken;
      }
    }

    const clientId = await this.requireCredential(ctx, "client_id");
    const clientSecret = await this.requireCredential(ctx, "client_secret");
    const refreshToken = await this.requireCredential(ctx, "refresh_token");
    const token = await this.exchangeToken(ctx, clientId, clientSecret, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    await this.persistTokenSet(ctx, token);
    if (!token.access_token) {
      throw new Error("Flipkart token response did not include access_token.");
    }
    return token.access_token;
  }

  private async exchangeToken(
    ctx: ConnectorContext,
    clientId: string,
    clientSecret: string,
    payload: Record<string, string>,
  ): Promise<FlipkartTokenResponse> {
    const endpoint = `${this.resolveOauthBaseUrl()}/oauth-service/oauth/token`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(payload),
    });

    const text = await response.text();
    let parsed: FlipkartTokenResponse | Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as FlipkartTokenResponse) : {};
    } catch {
      parsed = {};
    }

    if (!response.ok) {
      throw new Error(`Flipkart token exchange failed with status ${response.status}.`);
    }

    this.logger.info("Flipkart token exchange completed", {
      installationId: ctx.installationId,
      grantType: payload.grant_type ?? "unknown",
      statusCode: response.status,
    });

    return parsed as FlipkartTokenResponse;
  }

  private async persistTokenSet(
    ctx: ConnectorContext,
    token: FlipkartTokenResponse,
  ): Promise<void> {
    const now = Date.now();
    if (token.access_token) {
      const expiresAt = Number.isFinite(token.expires_in)
        ? new Date(now + Math.max(1, Number(token.expires_in)) * 1000)
        : null;
      await this.storeCredential(ctx, "access_token", token.access_token, {
        expiresAt,
      });
    }

    if (token.refresh_token) {
      const refreshExpiresAt = Number.isFinite(token.refresh_token_expires_in)
        ? new Date(now + Math.max(1, Number(token.refresh_token_expires_in)) * 1000)
        : new Date(now + DEFAULT_REFRESH_TOKEN_TTL_MS);
      await this.storeCredential(ctx, "refresh_token", token.refresh_token, {
        expiresAt: refreshExpiresAt,
      });
    }
  }

  private async noteCredentialHealth(ctx: ConnectorContext, failureReason: string | null): Promise<void> {
    const db = this.prismaDirect.getClient();
    await db.$executeRawUnsafe(
      `
      UPDATE connector_credentials
      SET
        last_validated_at = NOW(),
        failure_reason = $3,
        updated_at = NOW()
      WHERE tenant_key = $1
        AND installation_id = $2
        AND credential_type IN ('access_token', 'refresh_token', 'client_id', 'client_secret')
      `,
      ctx.tenantId,
      ctx.installationId,
      failureReason,
    );
  }

  private async requireCredential(ctx: ConnectorContext, credentialType: string): Promise<string> {
    const row = await this.getCredentialRow(ctx, credentialType);
    if (!row) {
      throw new Error(`Missing Flipkart credential '${credentialType}'.`);
    }
    if (row.status && row.status.toUpperCase() === "DISABLED") {
      throw new Error(`Flipkart credential '${credentialType}' is disabled.`);
    }
    return this.decryptCredential(row);
  }

  private async getCredentialRow(
    ctx: ConnectorContext,
    credentialType: string,
  ): Promise<CredentialRow | null> {
    const db = this.prismaDirect.getClient();
    const rows = await db.$queryRawUnsafe<CredentialRow[]>(
      `
      SELECT
        id,
        encrypted_value AS "encryptedValue",
        key_version AS "keyVersion",
        status,
        expires_at AS "expiresAt",
        failure_reason AS "failureReason"
      FROM connector_credentials
      WHERE tenant_key = $1
        AND installation_id = $2
        AND credential_type = $3
      LIMIT 1
      `,
      ctx.tenantId,
      ctx.installationId,
      credentialType,
    );
    return rows[0] ?? null;
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

    await db.$executeRawUnsafe(
      `
      INSERT INTO connector_credentials (
        id,
        tenant_key,
        installation_id,
        credential_type,
        encrypted_value,
        key_version,
        status,
        expires_at,
        failure_reason,
        last_refresh_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 'ACTIVE', $7, NULL, NOW(), NOW()
      )
      ON CONFLICT (installation_id, credential_type)
      DO UPDATE SET
        tenant_key = EXCLUDED.tenant_key,
        encrypted_value = EXCLUDED.encrypted_value,
        key_version = EXCLUDED.key_version,
        status = 'ACTIVE',
        expires_at = EXCLUDED.expires_at,
        failure_reason = NULL,
        last_refresh_at = NOW(),
        updated_at = NOW()
      `,
      id,
      ctx.tenantId,
      ctx.installationId,
      credentialType,
      encrypted.cipher,
      keyVersion,
      options.expiresAt ?? null,
    );
  }

  private resolveOauthBaseUrl(): string {
    return String(
      process.env.PIM_FLIPKART_OAUTH_BASE_URL ??
        process.env.FLIPKART_OAUTH_BASE_URL ??
        DEFAULT_OAUTH_BASE_URL,
    )
      .trim()
      .replace(/\/+$/, "");
  }

  private isCredentialFresh(row: CredentialRow): boolean {
    if (!row.expiresAt) {
      return true;
    }
    return row.expiresAt.getTime() - ACCESS_TOKEN_BUFFER_MS > Date.now();
  }

  private getFieldValue(product: ProductPayload, fieldPath: string): unknown {
    if (!fieldPath.startsWith("attributes.")) {
      return product[fieldPath as keyof ProductPayload];
    }
    const key = fieldPath.replace("attributes.", "");
    return product.attributes?.[key];
  }

  private isEmpty(value: unknown): boolean {
    if (value === null || value === undefined) {
      return true;
    }
    if (typeof value === "string") {
      return value.trim().length === 0;
    }
    if (typeof value === "number") {
      return !Number.isFinite(value);
    }
    if (Array.isArray(value)) {
      return value.length === 0;
    }
    return false;
  }

  private isNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
  }
}
