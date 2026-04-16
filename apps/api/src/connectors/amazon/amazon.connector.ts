// apps/api/src/connectors/amazon/amazon.connector.ts
// Phase 5-S2: validation and credential foundations.
// Phase 5-S3: implement OAuth callback and schema fetch.
// Phase 5-S4: implement publish/update/status sync.
// Phase 5-S5: implement webhook verification and parsing.

import { Injectable } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
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
  ExportFile,
  ParsedWebhookEvent,
  ProductPayload,
  ProductTypeSchema,
  SubmissionRef,
  SubmissionStatusUpdate,
  ValidationResult,
} from "../../connector-framework/connector.interface";
import { PrismaDirectService } from "../../prisma/prisma-direct.service";
import {
  AMAZON_DEFAULT_REQUIRED_FIELDS,
  buildAmazonFallbackIssues,
  buildAmazonMappedPayload,
  collectAmazonMissingFields,
  runAmazonAuthoritativeValidation,
} from "./amazon-validation";

type CredentialRow = {
  id: string;
  encryptedValue: string;
  keyVersion: string;
  status: string;
  expiresAt: Date | null;
  failureReason: string | null;
};

type AmazonTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

type AmazonListingSubmitResponse = {
  submissionId?: string;
  status?: string;
  issues?: Array<{
    code?: string;
    message?: string;
    fieldPath?: string;
    severity?: string;
  }>;
};

type AmazonListingStatusResponse = {
  status?: string;
  issues?: Array<{
    code?: string;
    message?: string;
    fieldPath?: string;
    severity?: string;
  }>;
};

type AmazonProductTypeDefinitionsResponse = {
  productType?: string;
  displayName?: string;
  schemaVersion?: string;
  productTypeVersion?: {
    version?: string;
  };
  schema?: Record<string, unknown> & {
    link?: {
      resource?: string;
    };
  };
};

type AmazonNotificationPayload = {
  SellerId?: string;
  SellerID?: string;
  MarketplaceId?: string;
  Asin?: string;
  Sku?: string;
  Status?: string[];
  Severities?: string[];
  EnforcementActions?: string[];
};

type AmazonNotificationEnvelope = {
  NotificationType?: string;
  PayloadVersion?: string;
  EventTime?: string;
  Payload?: AmazonNotificationPayload;
  NotificationMetadata?: {
    NotificationId?: string;
  };
};

const ACCESS_TOKEN_BUFFER_MS = 60_000;
const DEFAULT_REFRESH_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_OAUTH_BASE_URL = "https://api.amazon.com";
const DEFAULT_SP_API_BASE_URL = "https://sellingpartnerapi-eu.amazon.com";
const DEFAULT_MARKETPLACE_ID = "A21TJRUUN4KGV";
const DEFAULT_ISSUE_LOCALE = "en_IN";
const DEFAULT_CURRENCY_CODE = "INR";
const DEFAULT_USER_AGENT = "VexaPIMAmazonConnector/0.1 (Language=TypeScript/Node.js)";
const AMAZON_RELAY_SIGNATURE_HEADER = "x-pim1-webhook-signature";
const AMAZON_RELAY_TIMESTAMP_HEADER = "x-pim1-webhook-timestamp";
const AMAZON_RELAY_SECRET_ENV = "PIM_AMAZON_WEBHOOK_SECRET";
const SUPPRESSION_ACTIONS = new Set([
  "SEARCH_SUPPRESSED",
  "LISTING_SUPPRESSED",
  "ATTRIBUTE_SUPPRESSED",
  "CATALOG_ITEM_REMOVED",
]);

@Injectable()
export class AmazonConnector implements ConnectorInterface {
  readonly slug = "amazon-in";
  readonly displayName = "Amazon India";
  readonly implementationStatus = "full" as const;
  readonly capabilities: ConnectorCap[] = [
    "PUBLISH",
    "VALIDATE",
    "STATUS_SYNC",
    "WEBHOOK_RECEIVE",
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
      this.logger.info("Amazon credentials validated", {
        installationId: ctx.installationId,
      });
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.noteCredentialHealth(ctx, reason);
      this.logger.warn("Amazon credential validation failed", {
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
    const fallbackMissingFields = collectAmazonMissingFields(product, AMAZON_DEFAULT_REQUIRED_FIELDS);
    const fallbackIssues = buildAmazonFallbackIssues(this.displayName, fallbackMissingFields);
    const validation = await runAmazonAuthoritativeValidation({
      productId: product.sku,
      displayName: this.displayName,
      requiredFields: AMAZON_DEFAULT_REQUIRED_FIELDS,
      mappedPayload: buildAmazonMappedPayload(product),
      fallbackMissingFields,
      fallbackIssues,
    });
    if (validation) {
      return {
        isValid: !validation.issues.some((issue) => issue.severity === "error"),
        errors: validation.issues.filter((issue) => issue.severity === "error"),
        warnings: validation.issues.filter((issue) => issue.severity === "warning"),
        source: validation.source,
      };
    }
    return {
      isValid: fallbackIssues.length === 0,
      errors: fallbackIssues,
      warnings: [],
      source: "LOCAL_RULES",
    };
  }

  normaliseError(errorCode: string, rawMessage: string): ConnectorIssue {
    const normalizedCode = String(errorCode ?? "").trim().toUpperCase() || "AMAZON_ERROR";
    const normalizedMessage = String(rawMessage ?? "").trim();
    const sellerMessage =
      normalizedMessage ||
      (normalizedCode === "AMAZON_STATUS_SYNC_FAILED"
        ? "Amazon status sync could not be completed right now. Please try again."
        : "Amazon reported an issue while processing this listing.");
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
      throw new Error("Missing Amazon OAuth authorization code.");
    }

    const clientId = await this.requireCredential(ctx, "client_id");
    const clientSecret = await this.requireCredential(ctx, "client_secret");
    const redirectUri = String(params.redirectUri ?? params.redirect_uri ?? "").trim();

    const token = await this.exchangeToken(clientId, clientSecret, {
      grant_type: "authorization_code",
      code,
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    });

    await this.persistTokenSet(ctx, token);
    this.logger.info("Amazon OAuth callback completed", {
      installationId: ctx.installationId,
    });
  }

  async fetchProductTypeSchema(
    ctx: ConnectorContext,
    productType: string,
  ): Promise<ProductTypeSchema> {
    const normalizedProductType = String(productType ?? "").trim();
    if (!normalizedProductType) {
      throw new Error("Amazon productType is required to fetch schema.");
    }

    const endpoint = `${this.resolveDefinitionsBaseUrl()}/definitions/2020-09-01/productTypes/${encodeURIComponent(normalizedProductType)}?marketplaceIds=${encodeURIComponent(this.resolveMarketplaceId(ctx))}&requirements=LISTING&requirementsEnforced=ENFORCED&locale=${encodeURIComponent(this.resolveIssueLocale())}`;
    const response = await this.fetchWithTokenRetry(ctx, endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    const payload = await this.parseJsonResponse<AmazonProductTypeDefinitionsResponse>(response);

    if (!response.ok) {
      throw new Error(`Amazon product type schema fetch failed with status ${response.status}.`);
    }

    const rawSchema = await this.resolveProductTypeSchemaDocument(ctx, payload);
    const properties = this.readSchemaProperties(rawSchema);
    const requiredAttributes = this.readSchemaRequired(rawSchema);
    const optionalAttributes = Object.keys(properties).filter(
      (property) => !requiredAttributes.includes(property),
    );

    return {
      productType: normalizedProductType,
      requiredAttributes,
      optionalAttributes,
      validValues: this.buildSchemaValidValues(properties),
      schemaVersion:
        String(payload.schemaVersion ?? payload.productTypeVersion?.version ?? "LATEST").trim() || "LATEST",
    };
  }

  async publishProduct(
    ctx: ConnectorContext,
    product: ProductPayload,
  ): Promise<SubmissionRef> {
    const validation = await this.validateProduct(ctx, product);
    if (!validation.isValid) {
      throw new Error(validation.errors.map((issue) => issue.sellerMessage).join(" | "));
    }

    return this.submitListing(ctx, product);
  }

  async updateProduct(
    ctx: ConnectorContext,
    product: ProductPayload,
    externalRef: string,
  ): Promise<SubmissionRef> {
    const validation = await this.validateProduct(ctx, product);
    if (!validation.isValid) {
      throw new Error(validation.errors.map((issue) => issue.sellerMessage).join(" | "));
    }

    return this.submitListing(ctx, product, externalRef);
  }

  async parseWebhookEvent(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<ParsedWebhookEvent | null> {
    if (!this.verifyRelaySignature(rawBody, headers)) {
      return null;
    }

    const envelope = this.parseNotificationEnvelope(rawBody);
    if (!envelope) {
      return null;
    }

    const notificationType = String(envelope.NotificationType ?? "").trim().toUpperCase();
    const payload = envelope.Payload ?? {};
    const rawEventId = String(envelope.NotificationMetadata?.NotificationId ?? "").trim();
    const productSku = String(payload.Sku ?? "").trim();

    if (!notificationType || !rawEventId) {
      return null;
    }

    if (notificationType === "LISTINGS_ITEM_STATUS_CHANGE") {
      return {
        eventType: notificationType,
        rawEventId,
        productSku: productSku || undefined,
        status: this.mapWebhookStatus(payload.Status),
        channelErrors: [],
      };
    }

    if (notificationType === "LISTINGS_ITEM_ISSUES_CHANGE") {
      const channelErrors = this.buildIssueChangeIssues(payload);
      return {
        eventType: notificationType,
        rawEventId,
        productSku: productSku || undefined,
        status: this.mapIssueChangeStatus(payload),
        channelErrors,
      };
    }

    return {
      eventType: notificationType,
      rawEventId,
      productSku: productSku || undefined,
      channelErrors: [],
    };
  }

  async syncSubmissionStatus(
    ctx: ConnectorContext,
    externalRef: string,
  ): Promise<SubmissionStatusUpdate> {
    const lookup = this.parseStatusLookupRef(externalRef);
    const sellerId = this.requireSellerId(ctx);
    const endpoint = `${this.resolveSpApiBaseUrl()}/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(lookup.sku)}?marketplaceIds=${encodeURIComponent(this.resolveMarketplaceId(ctx))}&issueLocale=${encodeURIComponent(this.resolveIssueLocale())}`;
    this.logger.info("Amazon status sync started", {
      installationId: ctx.installationId,
      endpoint,
      externalRef: lookup.externalRef,
      sku: lookup.sku,
    });

    const response = await this.fetchWithTokenRetry(ctx, endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    const responseBody = await this.parseJsonResponse<AmazonListingStatusResponse>(response);
    this.logger.info("Amazon status sync completed", {
      installationId: ctx.installationId,
      statusCode: response.status,
      externalRef: lookup.externalRef,
      sku: lookup.sku,
    });
    return this.buildStatusUpdate(lookup.externalRef, response, responseBody);
  }

  private async resolveAccessToken(ctx: ConnectorContext): Promise<string> {
    try {
      const provided = await ctx.getAccessToken();
      if (typeof provided === "string" && provided.trim().length > 0) {
        return provided.trim();
      }
    } catch {
      // Current framework still returns an empty token for managed connectors.
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
    const token = await this.exchangeToken(clientId, clientSecret, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    await this.persistTokenSet(ctx, token);
    if (!token.access_token) {
      throw new Error("Amazon token response did not include access_token.");
    }
    return token.access_token;
  }

  private async exchangeToken(
    clientId: string,
    clientSecret: string,
    payload: Record<string, string>,
  ): Promise<AmazonTokenResponse> {
    const endpoint = `${this.resolveOauthBaseUrl()}/auth/o2/token`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        ...payload,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    const text = await response.text();
    let parsed: AmazonTokenResponse | Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as AmazonTokenResponse) : {};
    } catch {
      parsed = {};
    }

    if (!response.ok) {
      throw new Error(`Amazon token exchange failed with status ${response.status}.`);
    }

    return parsed as AmazonTokenResponse;
  }

  private async submitListing(
    ctx: ConnectorContext,
    product: ProductPayload,
    externalRef?: string,
  ): Promise<SubmissionRef> {
    const sellerId = this.requireSellerId(ctx);
    const marketplaceId = this.resolveMarketplaceId(ctx);
    const endpoint = `${this.resolveSpApiBaseUrl()}/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(product.sku)}?marketplaceIds=${encodeURIComponent(marketplaceId)}&issueLocale=${encodeURIComponent(this.resolveIssueLocale())}`;
    this.logger.info("Amazon listing submission started", {
      installationId: ctx.installationId,
      endpoint,
      sku: product.sku,
      externalRef,
    });

    const response = await this.fetchWithTokenRetry(ctx, endpoint, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(this.buildListingPayload(ctx, product)),
    });
    const responseBody = await this.parseJsonResponse<AmazonListingSubmitResponse>(response);
    this.logger.info("Amazon listing submission completed", {
      installationId: ctx.installationId,
      statusCode: response.status,
      sku: product.sku,
      externalRef,
    });

    if (!response.ok) {
      throw new Error(this.describeSubmissionFailure(responseBody, response.status));
    }

    return {
      externalRef: String(responseBody.submissionId ?? externalRef ?? `amazon-${product.sku}`),
      status: this.mapPublishStatus(String(responseBody.status ?? "")),
      isAsync: true,
    };
  }

  private async persistTokenSet(
    ctx: ConnectorContext,
    token: AmazonTokenResponse,
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
      await this.storeCredential(ctx, "refresh_token", token.refresh_token, {
        expiresAt: new Date(now + DEFAULT_REFRESH_TOKEN_TTL_MS),
      });
    }
  }

  private async noteCredentialHealth(ctx: ConnectorContext, failureReason: string | null): Promise<void> {
    const db = this.prismaDirect.getClient();
    // RLS-BYPASS: manual tenant filter
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
      throw new Error(`Missing Amazon credential '${credentialType}'.`);
    }
    if (row.status && row.status.toUpperCase() === "DISABLED") {
      throw new Error(`Amazon credential '${credentialType}' is disabled.`);
    }
    return this.decryptCredential(row);
  }

  private async getCredentialRow(
    ctx: ConnectorContext,
    credentialType: string,
  ): Promise<CredentialRow | null> {
    const db = this.prismaDirect.getClient();
    // RLS-BYPASS: manual tenant filter
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

  private isCredentialFresh(row: CredentialRow): boolean {
    if (!row.expiresAt) {
      return true;
    }
    return row.expiresAt.getTime() - ACCESS_TOKEN_BUFFER_MS > Date.now();
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

    // RLS-BYPASS: manual tenant filter
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
      ON CONFLICT (id)
      DO UPDATE SET
        tenant_key = EXCLUDED.tenant_key,
        installation_id = EXCLUDED.installation_id,
        credential_type = EXCLUDED.credential_type,
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
      process.env.PIM_AMAZON_LWA_BASE_URL ??
        process.env.AMAZON_LWA_BASE_URL ??
        DEFAULT_OAUTH_BASE_URL,
    )
      .trim()
      .replace(/\/+$/, "");
  }

  private resolveSpApiBaseUrl(): string {
    return String(
      process.env.PIM_AMAZON_LISTINGS_BASE_URL ??
        process.env.AMAZON_SP_API_BASE_URL ??
        DEFAULT_SP_API_BASE_URL,
    )
      .trim()
      .replace(/\/+$/, "");
  }

  private resolveDefinitionsBaseUrl(): string {
    return String(
      process.env.PIM_AMAZON_DEFINITIONS_BASE_URL ??
        process.env.AMAZON_DEFINITIONS_BASE_URL ??
        this.resolveSpApiBaseUrl(),
    )
      .trim()
      .replace(/\/+$/, "");
  }

  private resolveIssueLocale(): string {
    return String(process.env.PIM_AMAZON_ISSUE_LOCALE ?? DEFAULT_ISSUE_LOCALE).trim() || DEFAULT_ISSUE_LOCALE;
  }

  private resolveCurrencyCode(): string {
    return String(process.env.PIM_AMAZON_CURRENCY_CODE ?? DEFAULT_CURRENCY_CODE).trim() || DEFAULT_CURRENCY_CODE;
  }

  private resolveUserAgent(): string {
    return String(process.env.PIM_AMAZON_USER_AGENT ?? DEFAULT_USER_AGENT).trim() || DEFAULT_USER_AGENT;
  }

  private buildAmzDateHeader(): string {
    return new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  }

  private async resolveProductTypeSchemaDocument(
    ctx: ConnectorContext,
    payload: AmazonProductTypeDefinitionsResponse,
  ): Promise<Record<string, unknown>> {
    const inlineSchema = payload.schema;
    if (inlineSchema && typeof inlineSchema === "object" && !Array.isArray(inlineSchema) && inlineSchema.properties) {
      return inlineSchema;
    }

    const resource = String(payload.schema?.link?.resource ?? "").trim();
    if (!resource) {
      return {};
    }

    const response = await this.fetchWithTokenRetry(ctx, resource, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`Amazon schema document fetch failed with status ${response.status}.`);
    }
    return await this.parseJsonResponse<Record<string, unknown>>(response);
  }

  private readSchemaProperties(schema: Record<string, unknown>): Record<string, Record<string, unknown>> {
    const properties = schema.properties;
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
      return {};
    }
    return Object.entries(properties).reduce<Record<string, Record<string, unknown>>>((accumulator, [key, value]) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        accumulator[key] = value as Record<string, unknown>;
      }
      return accumulator;
    }, {});
  }

  private readSchemaRequired(schema: Record<string, unknown>): string[] {
    const required = schema.required;
    if (!Array.isArray(required)) {
      return [];
    }
    return required
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private buildSchemaValidValues(
    properties: Record<string, Record<string, unknown>>,
  ): Record<string, string[]> {
    return Object.entries(properties).reduce<Record<string, string[]>>((accumulator, [key, value]) => {
      const values = this.extractEnumValues(value);
      if (values.length > 0) {
        accumulator[key] = values;
      }
      return accumulator;
    }, {});
  }

  private extractEnumValues(schemaNode: Record<string, unknown>): string[] {
    const direct = this.readStringArray(schemaNode.enum);
    if (direct.length > 0) {
      return direct;
    }

    const itemEnums =
      schemaNode.items && typeof schemaNode.items === "object" && !Array.isArray(schemaNode.items)
        ? this.readStringArray((schemaNode.items as Record<string, unknown>).enum)
        : [];
    if (itemEnums.length > 0) {
      return itemEnums;
    }

    const oneOf = Array.isArray(schemaNode.oneOf) ? schemaNode.oneOf : [];
    const values = oneOf
      .flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return [];
        }
        const record = entry as Record<string, unknown>;
        const constValue =
          typeof record.const === "string" && record.const.trim().length > 0 ? [record.const.trim()] : [];
        if (constValue.length > 0) {
          return constValue;
        }
        return this.readStringArray(record.enum);
      })
      .filter((value) => value.length > 0);
    return Array.from(new Set(values));
  }

  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private requireSellerId(ctx: ConnectorContext): string {
    const sellerId = String(ctx.sellerId ?? "").trim();
    if (!sellerId) {
      throw new Error("Amazon publish requires a seller account reference on the installation.");
    }
    return sellerId;
  }

  private resolveMarketplaceId(ctx: ConnectorContext): string {
    return String(ctx.marketplaceId ?? DEFAULT_MARKETPLACE_ID).trim() || DEFAULT_MARKETPLACE_ID;
  }

  private buildListingPayload(ctx: ConnectorContext, product: ProductPayload): Record<string, unknown> {
    const marketplaceId = this.resolveMarketplaceId(ctx);
    const locale = this.resolveIssueLocale();
    const currency = this.resolveCurrencyCode();
    const color = String(product.attributes?.color ?? "").trim();
    const material = String(product.attributes?.material ?? "").trim();
    const size = String(product.attributes?.size ?? "").trim();
    return {
      requirements: "LISTING",
      productType: product.productType,
      attributes: {
        condition_type: [
          {
            value: "new_new",
            marketplace_id: marketplaceId,
          },
        ],
        item_name: [
          {
            value: product.title,
            language_tag: locale,
            marketplace_id: marketplaceId,
          },
        ],
        brand: [
          {
            value: product.brand,
            language_tag: locale,
            marketplace_id: marketplaceId,
          },
        ],
        ...(product.description.trim().length > 0
          ? {
              product_description: [
                {
                  value: product.description,
                  language_tag: locale,
                  marketplace_id: marketplaceId,
                },
              ],
            }
          : {}),
        ...(color
          ? {
              color: [
                {
                  value: color,
                  marketplace_id: marketplaceId,
                },
              ],
            }
          : {}),
        ...(material
          ? {
              material_type: [
                {
                  value: material,
                  marketplace_id: marketplaceId,
                },
              ],
            }
          : {}),
        ...(size
          ? {
              size: [
                {
                  value: size,
                  marketplace_id: marketplaceId,
                },
              ],
            }
          : {}),
        main_product_image_locator: [
          {
            media_location: product.mainImageUrl,
            marketplace_id: marketplaceId,
          },
        ],
        purchasable_offer: [
          {
            audience: "ALL",
            currency,
            our_price: [
              {
                schedule: [
                  {
                    value_with_tax: product.sellingPrice,
                  },
                ],
              },
            ],
          },
        ],
        list_price: [
          {
            currency,
            value_with_tax: product.mrp,
          },
        ],
      },
      marketplaceIds: [marketplaceId],
    };
  }

  private async fetchWithTokenRetry(
    ctx: ConnectorContext,
    url: string,
    init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> },
  ): Promise<Response> {
    let token = await this.resolveAccessToken(ctx);
    let response = await fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        "x-amz-access-token": token,
        "x-amz-date": this.buildAmzDateHeader(),
        "user-agent": this.resolveUserAgent(),
      },
    });
    if (response.status !== 401) {
      return response;
    }

    await this.invalidateAccessToken(ctx);
    token = await this.resolveAccessToken(ctx);
    response = await fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        "x-amz-access-token": token,
        "x-amz-date": this.buildAmzDateHeader(),
        "user-agent": this.resolveUserAgent(),
      },
    });
    return response;
  }

  private async invalidateAccessToken(ctx: ConnectorContext): Promise<void> {
    const db = this.prismaDirect.getClient();
    // RLS-BYPASS: manual tenant filter
    await db.$executeRawUnsafe(
      `
      UPDATE connector_credentials
      SET expires_at = NOW(), updated_at = NOW()
      WHERE tenant_key = $1
        AND installation_id = $2
        AND credential_type = 'access_token'
      `,
      ctx.tenantId,
      ctx.installationId,
    );
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

  private describeSubmissionFailure(responseBody: AmazonListingSubmitResponse, statusCode: number): string {
    const issues = this.normalizeProviderIssues(responseBody.issues);
    if (issues.length > 0) {
      return issues.map((issue) => issue.sellerMessage).join(" | ");
    }
    return `Amazon listing submission failed with status ${statusCode}.`;
  }

  private normalizeProviderIssues(
    issues: Array<{
      code?: string;
      message?: string;
      fieldPath?: string;
      severity?: string;
    }> | undefined,
  ): ConnectorIssue[] {
    return Array.isArray(issues)
      ? issues.map((issue) => {
          const baseIssue = this.normaliseError(
            String(issue.code ?? "AMAZON_ERROR").trim() || "AMAZON_ERROR",
            String(issue.message ?? "").trim(),
          );
          return {
            ...baseIssue,
            fieldPath: String(issue.fieldPath ?? "").trim(),
            severity:
              String(issue.severity ?? "").trim().toLowerCase() === "warning" ? "warning" : "error",
          };
        })
      : [];
  }

  private buildStatusUpdate(
    externalRef: string,
    response: Response,
    responseBody: AmazonListingStatusResponse,
  ): SubmissionStatusUpdate {
    const issues = this.normalizeProviderIssues(responseBody.issues);
    const hasBlockingIssues = issues.some((issue) => issue.severity === "error");
    let status = this.mapProviderStatus(String(responseBody.status ?? ""));

    if (!response.ok) {
      status = status === "PENDING" ? "ERROR" : status;
      return {
        externalRef,
        status,
        channelErrors:
          issues.length > 0
            ? issues
            : [
                this.normaliseError(
                  "AMAZON_STATUS_SYNC_FAILED",
                  `Amazon status sync failed with status ${response.status}.`,
                ),
              ],
        resolvedAt: new Date(),
      };
    }

    if (status === "PENDING" && hasBlockingIssues) {
      status = "ERROR";
    }

    return {
      externalRef,
      status,
      channelErrors: issues,
      ...(status === "PENDING" ? {} : { resolvedAt: new Date() }),
    };
  }

  private mapPublishStatus(status: string): SubmissionRef["status"] {
    const normalized = status.trim().toUpperCase();
    if (normalized === "SUCCESS" || normalized === "BUYABLE" || normalized === "ACTIVE") {
      return "SUCCESS";
    }
    if (normalized === "REJECTED" || normalized === "INVALID") {
      return "REJECTED";
    }
    if (normalized === "SUPPRESSED") {
      return "SUPPRESSED";
    }
    if (normalized === "ERROR" || normalized === "FAILED") {
      return "ERROR";
    }
    return "PENDING";
  }

  private mapProviderStatus(status: string): SubmissionStatusUpdate["status"] {
    return this.mapPublishStatus(status);
  }

  private parseStatusLookupRef(externalRef: string): { externalRef: string; sku: string } {
    const value = String(externalRef ?? "").trim();
    const parts = value.split("::");
    if (parts.length >= 2) {
      return {
        externalRef: parts[0],
        sku: parts[parts.length - 1],
      };
    }
    return {
      externalRef: value,
      sku: value,
    };
  }

  private verifyRelaySignature(rawBody: Buffer, headers: Record<string, string>): boolean {
    const secret = String(process.env[AMAZON_RELAY_SECRET_ENV] ?? "").trim();
    if (!secret) {
      return false;
    }

    const timestamp = this.readHeader(headers, AMAZON_RELAY_TIMESTAMP_HEADER);
    const signature = this.readHeader(headers, AMAZON_RELAY_SIGNATURE_HEADER);
    if (!timestamp || !signature.startsWith("sha256=")) {
      return false;
    }

    const expected = createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody.toString("utf8")}`)
      .digest("hex");
    const provided = signature.slice("sha256=".length).trim();
    if (!provided || provided.length !== expected.length) {
      return false;
    }

    try {
      return timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"));
    } catch {
      return false;
    }
  }

  private parseNotificationEnvelope(rawBody: Buffer): AmazonNotificationEnvelope | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const root = parsed as Record<string, unknown>;
    if (this.looksLikeNotificationEnvelope(root)) {
      return root as AmazonNotificationEnvelope;
    }

    const detail = root.detail;
    if (detail && typeof detail === "object" && !Array.isArray(detail) && this.looksLikeNotificationEnvelope(detail as Record<string, unknown>)) {
      return detail as AmazonNotificationEnvelope;
    }

    return null;
  }

  private looksLikeNotificationEnvelope(value: Record<string, unknown>): boolean {
    return (
      typeof value.NotificationType === "string" &&
      !!value.Payload &&
      typeof value.NotificationMetadata === "object" &&
      value.NotificationMetadata !== null
    );
  }

  private mapWebhookStatus(statuses: string[] | undefined): ParsedWebhookEvent["status"] {
    const normalized = new Set(
      Array.isArray(statuses)
        ? statuses
            .map((status) => String(status ?? "").trim().toUpperCase())
            .filter((status) => status.length > 0)
        : [],
    );
    if (normalized.has("BUYABLE") || normalized.has("ACTIVE")) {
      return "SUCCESS";
    }
    if (normalized.has("DELETED")) {
      return "SUPPRESSED";
    }
    return "SUPPRESSED";
  }

  private mapIssueChangeStatus(payload: AmazonNotificationPayload): ParsedWebhookEvent["status"] | undefined {
    const severities = new Set(
      Array.isArray(payload.Severities)
        ? payload.Severities
            .map((severity) => String(severity ?? "").trim().toUpperCase())
            .filter((severity) => severity.length > 0)
        : [],
    );
    const actions = new Set(
      Array.isArray(payload.EnforcementActions)
        ? payload.EnforcementActions
            .map((action) => String(action ?? "").trim().toUpperCase())
            .filter((action) => action.length > 0)
        : [],
    );

    if (Array.from(actions).some((action) => SUPPRESSION_ACTIONS.has(action))) {
      return "SUPPRESSED";
    }
    if (severities.has("ERROR")) {
      return "REJECTED";
    }
    if (severities.has("NONE")) {
      return "SUCCESS";
    }
    return undefined;
  }

  private buildIssueChangeIssues(payload: AmazonNotificationPayload): ConnectorIssue[] {
    const severities = Array.isArray(payload.Severities)
      ? payload.Severities
          .map((severity) => String(severity ?? "").trim().toUpperCase())
          .filter((severity) => severity.length > 0)
      : [];
    const actions = Array.isArray(payload.EnforcementActions)
      ? payload.EnforcementActions
          .map((action) => String(action ?? "").trim().toUpperCase())
          .filter((action) => action.length > 0)
      : [];

    const issueSeverity = severities.includes("WARNING") && !severities.includes("ERROR") ? "warning" : "error";
    const issues = actions.map((action) => {
      const baseIssue = this.normaliseError(action, this.describeEnforcementAction(action));
      return {
        ...baseIssue,
        severity: issueSeverity,
      } satisfies ConnectorIssue;
    });

    if (issues.length > 0) {
      return issues;
    }

    return severities
      .filter((severity) => severity !== "NONE")
      .map((severity) => ({
        ...this.normaliseError(
          `LISTINGS_ITEM_${severity}`,
          severity === "WARNING"
            ? "Amazon flagged a listing warning that should be reviewed."
            : "Amazon reported a blocking listing issue.",
        ),
        severity: severity === "WARNING" ? "warning" : "error",
      }));
  }

  private describeEnforcementAction(action: string): string {
    switch (action) {
      case "SEARCH_SUPPRESSED":
        return "Amazon suppressed this listing from search results.";
      case "LISTING_SUPPRESSED":
        return "Amazon suppressed this listing from purchase.";
      case "ATTRIBUTE_SUPPRESSED":
        return "Amazon suppressed one or more listing attributes and blocked purchase.";
      case "CATALOG_ITEM_REMOVED":
        return "Amazon removed the catalog item associated with this listing.";
      default:
        return "Amazon reported a listing issue that needs attention.";
    }
  }

  private readHeader(headers: Record<string, string>, name: string): string {
    const target = name.trim().toLowerCase();
    for (const [key, value] of Object.entries(headers ?? {})) {
      if (String(key).trim().toLowerCase() === target) {
        return String(value ?? "").trim();
      }
    }
    return "";
  }
}
