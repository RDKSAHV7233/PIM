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
  ConnectorPublicationTarget,
  ProductPayload,
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

type ShopifyTokenResponse = {
  access_token?: string;
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
};

type ShopifyGraphQlEnvelope<T> = {
  data?: T;
  errors?: Array<{
    message?: string;
  }>;
};

type ShopifyPublicationNode = {
  id?: string;
  name?: string;
  catalog?: {
    __typename?: string;
    id?: string;
    title?: string;
    status?: string;
  } | null;
};

type ShopifyPublicationQueryResponse = {
  publications?: {
    nodes?: ShopifyPublicationNode[];
  } | null;
};

const ACCESS_TOKEN_BUFFER_MS = 60_000;
const DEFAULT_OFFLINE_REQUESTED_TOKEN_TYPE = "urn:shopify:params:oauth:token-type:offline-access-token";
const DEFAULT_SUBJECT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:id_token";
const DEFAULT_TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const DEFAULT_ADMIN_API_VERSION = "2026-04";
const SHOPIFY_PUBLISH_TARGETS_METADATA_KEY = "publicationTargetIds";
const REQUIRED_FIELDS = [
  { fieldPath: "sku", message: "Add a stable SKU before syncing to Shopify." },
  { fieldPath: "title", message: "Product title is required for Shopify sync." },
  { fieldPath: "description", message: "Description is required for Shopify sync." },
  { fieldPath: "mainImageUrl", message: "A primary HTTPS image is required for Shopify sync." },
] as const;

@Injectable()
export class ShopifyConnector implements ConnectorInterface {
  readonly slug = "shopify";
  readonly displayName = "Shopify";
  readonly implementationStatus = "partial" as const;
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
      this.logger.info("Shopify credentials validated", {
        installationId: ctx.installationId,
      });
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.noteCredentialHealth(ctx, reason);
      this.logger.warn("Shopify credential validation failed", {
        installationId: ctx.installationId,
        reason,
      });
      return false;
    }
  }

  async handleOAuthCallback(
    ctx: ConnectorContext,
    params: Record<string, string>,
  ): Promise<void> {
    const shopDomain = this.normalizeShopDomain(
      params.shop ?? params.shopDomain ?? params.shop_domain,
    );
    const sessionToken = String(
      params.sessionToken ?? params.session_token ?? params.subject_token ?? "",
    ).trim();

    if (!shopDomain) {
      throw new Error("Missing Shopify shop domain.");
    }
    if (!sessionToken) {
      throw new Error("Missing Shopify session token for token exchange.");
    }

    const token = await this.exchangeToken(shopDomain, {
      client_id: this.requireClientId(),
      client_secret: this.requireClientSecret(),
      grant_type: DEFAULT_TOKEN_EXCHANGE_GRANT,
      subject_token: sessionToken,
      subject_token_type: DEFAULT_SUBJECT_TOKEN_TYPE,
      requested_token_type: DEFAULT_OFFLINE_REQUESTED_TOKEN_TYPE,
      expiring: "1",
    });

    await this.persistTokenSet(ctx, token, {
      shopDomain,
      authMode: "managed_install_token_exchange",
    });
    this.logger.info("Shopify managed-install token exchange completed", {
      installationId: ctx.installationId,
      shopDomain,
    });
  }

  async validateProduct(
    _ctx: ConnectorContext,
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
          sellerMessage: "Shopify images must use a permanent HTTPS URL.",
          severity: "error",
        });
      }
    }

    if (this.isEmpty(this.getFieldValue(product, "brand"))) {
      warnings.push({
        code: "BRAND_RECOMMENDED",
        fieldPath: "brand",
        sellerMessage: "Brand is recommended for cleaner Shopify merchandising and search.",
        severity: "warning",
      });
    }

    if (this.isEmpty(this.getFieldValue(product, "productType"))) {
      warnings.push({
        code: "PRODUCT_TYPE_RECOMMENDED",
        fieldPath: "productType",
        sellerMessage: "Product type is recommended so Shopify collections and filters stay structured.",
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
    const normalizedCode = String(errorCode ?? "").trim().toUpperCase() || "SHOPIFY_ERROR";
    const sellerMessage =
      String(rawMessage ?? "").trim() ||
      "Shopify rejected the sync request. Review connector setup and product mapping before retrying.";

    return {
      code: normalizedCode,
      fieldPath: "",
      sellerMessage,
      severity: "error",
    };
  }

  async listPublications(ctx: ConnectorContext): Promise<ConnectorPublicationTarget[]> {
    const shopDomain = await this.requireCredential(ctx, "shop_domain");
    const accessToken = await this.resolveAccessToken(ctx);
    const metadata = await this.getInstallationMetadata(ctx);
    const selectedIds = new Set(this.readPublicationTargetIds(metadata));
    const response = await this.graphqlRequest<ShopifyPublicationQueryResponse>({
      shopDomain,
      accessToken,
      query: `
        query VexaShopifyPublications {
          publications(first: 50) {
            nodes {
              id
              name
              catalog {
                __typename
                ... on AppCatalog {
                  id
                  title
                  status
                }
                ... on MarketCatalog {
                  id
                  title
                  status
                }
                ... on CompanyLocationCatalog {
                  id
                  title
                  status
                }
              }
            }
          }
        }
      `,
    });

    const nodes = Array.isArray(response.publications?.nodes) ? response.publications.nodes : [];
    const publications: ConnectorPublicationTarget[] = [];
    for (const node of nodes) {
      const id = String(node?.id ?? "").trim();
      if (!id) {
        continue;
      }
      const catalog = node?.catalog ?? null;
      const name =
        this.normalizeOptionalString(node?.name) ??
        this.normalizeOptionalString(catalog?.title) ??
        "Untitled publication";
      publications.push({
        id,
        name,
        catalogId: this.normalizeOptionalString(catalog?.id),
        catalogTitle: this.normalizeOptionalString(catalog?.title),
        catalogType: this.normalizeOptionalString(catalog?.__typename),
        selected: selectedIds.has(id),
      });
    }
    return publications;
  }

  private async resolveAccessToken(ctx: ConnectorContext): Promise<string> {
    try {
      const provided = await ctx.getAccessToken();
      if (typeof provided === "string" && provided.trim().length > 0) {
        return provided.trim();
      }
    } catch {
      // Current framework doesn't inject connector-managed tokens for planned connectors.
    }

    const existing = await this.getCredentialRow(ctx, "access_token");
    if (existing) {
      const accessToken = this.decryptCredential(existing);
      if (this.isCredentialFresh(existing)) {
        return accessToken;
      }
    }

    const refreshToken = await this.requireCredential(ctx, "refresh_token");
    const shopDomain = await this.requireCredential(ctx, "shop_domain");
    const token = await this.exchangeToken(shopDomain, {
      client_id: this.requireClientId(),
      client_secret: this.requireClientSecret(),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    await this.persistTokenSet(ctx, token, {
      shopDomain,
      authMode: "expiring_offline_refresh",
    });
    if (!token.access_token) {
      throw new Error("Shopify token response did not include access_token.");
    }
    return token.access_token;
  }

  private async exchangeToken(
    shopDomain: string,
    payload: Record<string, string>,
  ): Promise<ShopifyTokenResponse> {
    const endpoint = `${this.resolveTokenBaseUrl(shopDomain)}/admin/oauth/access_token`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(payload),
    });

    const text = await response.text();
    let parsed: ShopifyTokenResponse | Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as ShopifyTokenResponse) : {};
    } catch {
      parsed = {};
    }

    if (!response.ok) {
      throw new Error(
        `Shopify token exchange failed with status ${response.status}.`,
      );
    }

    this.logger.info("Shopify token request completed", {
      shopDomain,
      grantType: payload.grant_type ?? "unknown",
      statusCode: response.status,
    });
    return parsed as ShopifyTokenResponse;
  }

  private async persistTokenSet(
    ctx: ConnectorContext,
    token: ShopifyTokenResponse,
    input: { shopDomain: string; authMode: string },
  ): Promise<void> {
    const now = Date.now();
    const scope = this.normalizeOptionalString(token.scope);

    await this.storeCredential(ctx, "shop_domain", input.shopDomain, {
      scope,
      metadata: {
        authMode: input.authMode,
      },
    });

    if (token.access_token) {
      const expiresAt = Number.isFinite(token.expires_in)
        ? new Date(now + Math.max(1, Number(token.expires_in)) * 1000)
        : null;
      await this.storeCredential(ctx, "access_token", token.access_token, {
        expiresAt,
        scope,
        metadata: {
          authMode: input.authMode,
          shopDomain: input.shopDomain,
        },
      });
    }

    if (token.refresh_token) {
      const refreshExpiresAt = Number.isFinite(token.refresh_token_expires_in)
        ? new Date(now + Math.max(1, Number(token.refresh_token_expires_in)) * 1000)
        : null;
      await this.storeCredential(ctx, "refresh_token", token.refresh_token, {
        expiresAt: refreshExpiresAt,
        scope,
        metadata: {
          authMode: input.authMode,
          shopDomain: input.shopDomain,
        },
      });
    }

    await this.persistInstallationMetadata(ctx, {
      shopDomain: input.shopDomain,
      tokenMode: token.refresh_token ? "expiring_offline" : "offline",
      authMode: input.authMode,
      scope,
    });
  }

  private async persistInstallationMetadata(
    ctx: ConnectorContext,
    metadata: {
      shopDomain: string;
      tokenMode: string;
      authMode: string;
      scope: string | null;
    },
  ): Promise<void> {
    const db = this.prismaDirect.getClient();
    await db.$executeRawUnsafe(
      `
      UPDATE connector_installations
      SET
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'shopDomain', $3,
          'tokenMode', $4,
          'authMode', $5,
          'scope', $6
        ),
        updated_at = NOW()
      WHERE tenant_key = $1 AND id = $2
      `,
      ctx.tenantId,
      ctx.installationId,
      metadata.shopDomain,
      metadata.tokenMode,
      metadata.authMode,
      metadata.scope,
    );
  }

  private async getInstallationMetadata(ctx: ConnectorContext): Promise<Record<string, unknown>> {
    const db = this.prismaDirect.getClient();
    const rows = await db.$queryRawUnsafe<Array<{ metadata: unknown }>>(
      `
      SELECT metadata
      FROM connector_installations
      WHERE tenant_key = $1
        AND id = $2
      LIMIT 1
      `,
      ctx.tenantId,
      ctx.installationId,
    );
    const raw = rows[0]?.metadata;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return {};
      }
    }
    return {};
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
        AND credential_type IN ('access_token', 'refresh_token', 'shop_domain')
      `,
      ctx.tenantId,
      ctx.installationId,
      failureReason,
    );
  }

  private async requireCredential(ctx: ConnectorContext, credentialType: string): Promise<string> {
    const row = await this.getCredentialRow(ctx, credentialType);
    if (!row) {
      throw new Error(`Missing Shopify credential '${credentialType}'.`);
    }
    if (row.status && row.status.toUpperCase() === "DISABLED") {
      throw new Error(`Shopify credential '${credentialType}' is disabled.`);
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
    options: {
      expiresAt?: Date | null;
      scope?: string | null;
      metadata?: Record<string, unknown> | null;
    } = {},
  ): Promise<void> {
    const encrypted = buildEncryptedCredential(plainValue, this.currentKeyVersion, this.keys);
    const keyVersion = formatCredentialKeyVersion(encrypted.keyVersion);
    const db = this.prismaDirect.getClient();
    const id = `${ctx.installationId}:${credentialType}`;
    const metadata = options.metadata ? JSON.stringify(options.metadata) : null;

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
        scope,
        expires_at,
        metadata,
        last_refresh_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 'ACTIVE', $7, $8,
        CASE WHEN $9::jsonb IS NULL THEN NULL ELSE $9::jsonb END,
        NOW(),
        NOW()
      )
      ON CONFLICT (id)
      DO UPDATE SET
        tenant_key = EXCLUDED.tenant_key,
        installation_id = EXCLUDED.installation_id,
        credential_type = EXCLUDED.credential_type,
        encrypted_value = EXCLUDED.encrypted_value,
        key_version = EXCLUDED.key_version,
        status = 'ACTIVE',
        scope = EXCLUDED.scope,
        expires_at = EXCLUDED.expires_at,
        metadata = EXCLUDED.metadata,
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
      options.scope ?? null,
      options.expiresAt ?? null,
      metadata,
    );
  }

  private readPublicationTargetIds(metadata: Record<string, unknown>): string[] {
    const raw = metadata[SHOPIFY_PUBLISH_TARGETS_METADATA_KEY];
    if (!Array.isArray(raw)) {
      return [];
    }
    return Array.from(
      new Set(
        raw
          .map((value) => String(value ?? "").trim())
          .filter((value) => value.length > 0),
      ),
    );
  }

  private async graphqlRequest<T>(input: {
    shopDomain: string;
    accessToken: string;
    query: string;
    variables?: Record<string, unknown>;
  }): Promise<T> {
    const endpoint = `${this.resolveAdminApiBaseUrl(input.shopDomain)}/admin/api/${this.resolveAdminApiVersion()}/graphql.json`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": input.accessToken,
      },
      body: JSON.stringify({
        query: input.query,
        variables: input.variables ?? {},
      }),
    });

    const text = await response.text();
    let parsed: ShopifyGraphQlEnvelope<T> = {};
    try {
      parsed = text ? (JSON.parse(text) as ShopifyGraphQlEnvelope<T>) : {};
    } catch {
      parsed = {};
    }

    if (!response.ok) {
      throw new Error(`Shopify GraphQL request failed with status ${response.status}.`);
    }
    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      const message = parsed.errors
        .map((issue) => String(issue?.message ?? "").trim())
        .filter((value) => value.length > 0)
        .join(" | ");
      throw new Error(message || "Shopify GraphQL request returned errors.");
    }
    if (!parsed.data) {
      throw new Error("Shopify GraphQL response did not include data.");
    }

    return parsed.data;
  }

  private requireClientId(): string {
    const value = String(process.env.PIM_SHOPIFY_CLIENT_ID ?? "").trim();
    if (!value) {
      throw new Error("PIM_SHOPIFY_CLIENT_ID is not configured.");
    }
    return value;
  }

  private requireClientSecret(): string {
    const value = String(process.env.PIM_SHOPIFY_CLIENT_SECRET ?? "").trim();
    if (!value) {
      throw new Error("PIM_SHOPIFY_CLIENT_SECRET is not configured.");
    }
    return value;
  }

  private resolveTokenBaseUrl(shopDomain: string): string {
    const explicit = String(process.env.PIM_SHOPIFY_TOKEN_BASE_URL ?? "").trim().replace(/\/+$/, "");
    if (explicit.length > 0) {
      return explicit;
    }
    return `https://${shopDomain}`;
  }

  private resolveAdminApiBaseUrl(shopDomain: string): string {
    const explicit = String(process.env.PIM_SHOPIFY_ADMIN_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
    if (explicit.length > 0) {
      return explicit;
    }
    return `https://${shopDomain}`;
  }

  private resolveAdminApiVersion(): string {
    const explicit = String(process.env.PIM_SHOPIFY_ADMIN_API_VERSION ?? "").trim();
    return explicit.length > 0 ? explicit : DEFAULT_ADMIN_API_VERSION;
  }

  private normalizeShopDomain(raw: string | undefined): string {
    const trimmed = String(raw ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!trimmed) {
      return "";
    }
    const normalized = trimmed.includes(".") ? trimmed : `${trimmed}.myshopify.com`;
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)) {
      throw new Error("Shopify shop domain must be a valid *.myshopify.com hostname.");
    }
    return normalized;
  }

  private normalizeOptionalString(value: string | undefined): string | null {
    const normalized = String(value ?? "").trim();
    return normalized.length > 0 ? normalized : null;
  }

  private isCredentialFresh(row: CredentialRow): boolean {
    if (!row.expiresAt) {
      return true;
    }
    return row.expiresAt.getTime() - Date.now() > ACCESS_TOKEN_BUFFER_MS;
  }

  private getFieldValue(product: ProductPayload, fieldPath: string): unknown {
    return fieldPath.split(".").reduce<unknown>((current, segment) => {
      if (current && typeof current === "object" && segment in (current as Record<string, unknown>)) {
        return (current as Record<string, unknown>)[segment];
      }
      return undefined;
    }, product);
  }

  private isEmpty(value: unknown): boolean {
    if (value === null || value === undefined) {
      return true;
    }
    if (typeof value === "string") {
      return value.trim().length === 0;
    }
    return false;
  }
}
