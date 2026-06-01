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
  ConnectorPublicationTarget,
  ParsedWebhookEvent,
  ProductPayload,
  SubmissionRef,
  SubmissionStatusUpdate,
  ValidationResult,
} from "../../connector-framework/connector.interface";
import { PrismaDirectService } from "../../prisma/prisma-direct.service";
import { tenantRaw, tenantExecRaw } from "../../common/tenant/tenant-raw";

type CredentialRow = {
  id: string;
  encryptedValue: string;
  keyVersion: string;
  status: string;
  expiresAt: Date | null;
  failureReason: string | null;
};

type InstallationMetadataRow = {
  metadata: unknown;
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
    extensions?: { code?: string };
  }>;
  extensions?: {
    cost?: {
      requestedQueryCost?: number;
      actualQueryCost?: number;
      throttleStatus?: {
        maximumAvailable?: number;
        currentlyAvailable?: number;
        restoreRate?: number;
      };
    };
  };
};

type ShopifyShopIdentity = {
  id?: string;
  name?: string;
  myshopifyDomain?: string;
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

type ShopifyProductSetResponse = {
  productSet?: {
    product?: {
      id?: string;
      handle?: string;
      status?: string;
    } | null;
    userErrors?: Array<{
      field?: string[];
      message?: string;
    }>;
  } | null;
};

type ShopifyPublishResponse = {
  publishablePublish?: {
    publishable?: {
      publishedOnPublication?: boolean;
    } | null;
    userErrors?: Array<{
      field?: string[];
      message?: string;
    }>;
  } | null;
};

type ShopifyProductStatusResponse = {
  node?: {
    id?: string;
    status?: string;
    resourcePublications?: {
      nodes?: Array<{
        isPublished?: boolean;
        publication?: {
          id?: string;
        } | null;
      }>;
    } | null;
  } | null;
};

type ShopifyWebhookProductPayload = {
  id?: number | string;
  admin_graphql_api_id?: string;
  status?: string;
  title?: string;
  variants?: Array<{
    sku?: string;
  }>;
};

type ShopifyMetafieldDefinitionNode = {
  id?: string;
  name?: string;
  namespace?: string;
  key?: string;
  type?: { name?: string } | null;
  description?: string | null;
  required?: boolean;
  validations?: Array<{ name?: string; value?: string | null }>;
  ownerType?: string;
};

type ShopifyCollectionNode = {
  id?: string;
  title?: string;
  handle?: string;
};

type ShopifyTaxonomyNode = {
  id?: string;
  name?: string;
  level?: number;
  isLeaf?: boolean;
  parentId?: string | null;
};

type ShopifyConfigQueryResponse = {
  metafieldDefinitions?: { nodes?: ShopifyMetafieldDefinitionNode[] } | null;
  collections?: { nodes?: ShopifyCollectionNode[] } | null;
  productTaxonomyNodes?: { nodes?: ShopifyTaxonomyNode[] } | null;
};

export type ShopifyConfigResult = {
  metafields: Array<{
    id: string;
    name: string;
    namespace: string;
    key: string;
    type: string;
    description: string | null;
    required: boolean;
    ownerType: string;
  }>;
  collections: Array<{
    id: string;
    title: string;
    handle: string;
  }>;
  taxonomy: Array<{
    id: string;
    name: string;
    level: number;
    isLeaf: boolean;
    parentId: string | null;
  }>;
  fetchedAt: string;
};

type ShopifyProductStateQueryResponse = {
  node?: {
    id?: string;
    title?: string;
    handle?: string;
    descriptionHtml?: string;
    status?: string;
    vendor?: string;
    productType?: string;
    tags?: string[];
    seo?: { title?: string; description?: string } | null;
    variants?: {
      nodes?: Array<{
        price?: string;
        compareAtPrice?: string | null;
        barcode?: string | null;
        sku?: string | null;
        inventoryPolicy?: string;
        taxable?: boolean;
      }>;
    } | null;
    images?: {
      nodes?: Array<{ src?: string; altText?: string | null }>;
    } | null;
  } | null;
};

export type ShopifyProductChangeItem = {
  field: string;
  currentValue: string | null;
  newValue: string | null;
  changeType: "add" | "update" | "remove";
  riskLevel: "low" | "medium" | "high";
};

export type ShopifyProductPreview = {
  hasExistingProduct: boolean;
  noChanges: boolean;
  changes: ShopifyProductChangeItem[];
};

export class ShopifyPublishError extends Error {
  constructor(
    public readonly issues: ConnectorIssue[],
    message: string,
  ) {
    super(message);
    this.name = "ShopifyPublishError";
  }
}

type ShopifyBulkUpdateVariantResponse = {
  productVariantsBulkUpdate?: {
    productVariants?: Array<{ id?: string; price?: string }>;
    userErrors?: Array<{ field?: string[]; message?: string }>;
  } | null;
};

const CONNECTOR_HTTP_TIMEOUT_MS = 30_000;
const ACCESS_TOKEN_BUFFER_MS = 60_000;
const DEFAULT_OFFLINE_REQUESTED_TOKEN_TYPE = "urn:shopify:params:oauth:token-type:offline-access-token";
const DEFAULT_SUBJECT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:id_token";
const DEFAULT_TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const DEFAULT_ADMIN_API_VERSION = "2026-04";
const DEFAULT_CUSTOM_ID_NAMESPACE = "pim_connector";
const DEFAULT_CUSTOM_ID_KEY = "sku";
const DEFAULT_PIM_METAFIELD_NAMESPACE = "pim_connector";
const SHOPIFY_WEBHOOK_HMAC_HEADER = "x-shopify-hmac-sha256";
const SHOPIFY_WEBHOOK_TOPIC_HEADER = "x-shopify-topic";
const SHOPIFY_WEBHOOK_ID_HEADER = "x-shopify-webhook-id";
const SHOPIFY_EVENT_ID_HEADER = "x-shopify-event-id";
const SHOPIFY_PUBLISH_TARGETS_METADATA_KEY = "publicationTargetIds";
const REQUIRED_FIELDS = [
  { fieldPath: "sku", message: "Add a stable SKU before syncing to Shopify." },
  { fieldPath: "title", message: "Product title is required for Shopify sync." },
  { fieldPath: "description", message: "Description is required for Shopify sync." },
  { fieldPath: "mainImageUrl", message: "A primary HTTPS image is required for Shopify sync." },
] as const;
const PENDING_PRODUCT_STATUSES = new Set(["DRAFT"]);
const SUPPRESSED_PRODUCT_STATUSES = new Set(["ARCHIVED"]);

@Injectable()
export class ShopifyConnector implements ConnectorInterface {
  readonly slug = "shopify";
  readonly displayName = "Shopify";
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
    if (!String(process.env.PIM_SHOPIFY_CLIENT_ID ?? "").trim()) {
      this.logger.warn(
        "PIM_SHOPIFY_CLIENT_ID is not set. Shopify OAuth flows will fail at runtime.",
        { connector: "shopify" },
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
    const requestedShopDomain = this.normalizeShopDomain(
      params.shop ?? params.shopDomain ?? params.shop_domain,
    );
    const sessionToken = String(
      params.sessionToken ?? params.session_token ?? params.subject_token ?? "",
    ).trim();
    const authCode = String(params.code ?? "").trim();

    if (!requestedShopDomain) {
      throw new Error("Missing Shopify shop domain.");
    }

    let token: ShopifyTokenResponse;
    let authMode: string;

    // Direct admin API token (custom app flow â€” token copied from Shopify Admin â†’ Apps â†’ API credentials)
    const directToken = String(params.accessToken ?? params.access_token ?? "").trim();

    if (directToken && !authCode) {
      token = { access_token: directToken };
      authMode = "custom_app_direct_token";
    } else if (authCode) {
      // Standard OAuth authorization code flow (for local dev / non-embedded installs)
      token = await this.exchangeToken(requestedShopDomain, {
        client_id: this.requireClientId(),
        client_secret: this.requireClientSecret(),
        code: authCode,
      });
      authMode = "authorization_code";
    } else {
      if (!sessionToken) {
        throw new Error("Missing Shopify session token for token exchange.");
      }
      token = await this.exchangeToken(requestedShopDomain, {
        client_id: this.requireClientId(),
        client_secret: this.requireClientSecret(),
        grant_type: DEFAULT_TOKEN_EXCHANGE_GRANT,
        subject_token: sessionToken,
        subject_token_type: DEFAULT_SUBJECT_TOKEN_TYPE,
        requested_token_type: DEFAULT_OFFLINE_REQUESTED_TOKEN_TYPE,
        expiring: "1",
      });
      authMode = "managed_install_token_exchange";
    }

    if (!token.access_token) {
      throw new Error("Shopify token response did not include access_token.");
    }

    const shopIdentity = await this.fetchShopIdentity(requestedShopDomain, token.access_token);
    const canonicalShopDomain = this.normalizeShopDomain(
      shopIdentity.myshopifyDomain ?? requestedShopDomain,
    );

    await this.persistTokenSet(ctx, token, {
      shopDomain: canonicalShopDomain,
      authMode,
      shopIdentity,
    });
    this.logger.info("Shopify OAuth callback completed", {
      installationId: ctx.installationId,
      shopDomain: canonicalShopDomain,
      shopId: shopIdentity.id ?? null,
      authMode,
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

    const numericSellingPrice = Number.isFinite(product.sellingPrice) ? Number(product.sellingPrice) : NaN;
    if (!Number.isFinite(numericSellingPrice) || numericSellingPrice <= 0) {
      warnings.push({
        code: "SELLING_PRICE_ZERO_OR_MISSING",
        fieldPath: "sellingPrice",
        sellerMessage: "Selling price is zero or missing. Set a positive price before syncing to Shopify.",
        severity: "warning",
      });
    }

    if (typeof product.description === "string" && product.description.trim().length === 0 && product.description.length > 0) {
      warnings.push({
        code: "DESCRIPTION_WHITESPACE_ONLY",
        fieldPath: "description",
        sellerMessage: "Description contains only whitespace. Add meaningful content before syncing to Shopify.",
        severity: "warning",
      });
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
    return this.parseShopifyUserError(undefined, rawMessage, errorCode);
  }

  /**
   * Convert a Shopify GraphQL userError into a structured ConnectorIssue.
   * `field` is the path array from userErrors[].field (e.g. ["variants","0","price"]).
   * `message` is userErrors[].message (the raw Shopify message).
   * `codeHint` is an optional override code (used when called from normaliseError).
   */
  private parseShopifyUserError(
    field: string[] | null | undefined,
    message: string,
    codeHint?: string,
  ): ConnectorIssue {
    const rawMessage = String(message ?? "").trim();
    const lower = rawMessage.toLowerCase();

    // Convert Shopify field path array → dot-notation with bracket indices
    const fieldPath = Array.isArray(field) && field.length > 0
      ? field
          .map((segment, i) => {
            const isIndex = /^\d+$/.test(segment);
            if (isIndex) {
              // replace previous segment's trailing dot with bracket notation
              return `[${segment}]`;
            }
            return i === 0 ? segment : `.${segment}`;
          })
          .join("")
      : "";

    // Map well-known Shopify error patterns → seller-friendly messages + codes
    if (/title.*too long|too long.*title/i.test(rawMessage) || /title.*255/i.test(rawMessage)) {
      return { code: "TITLE_TOO_LONG", fieldPath: fieldPath || "title", sellerMessage: "Product title must be 255 characters or fewer.", severity: "error" };
    }
    if (/title.*blank|title.*required|title.*can't be blank/i.test(rawMessage)) {
      return { code: "TITLE_REQUIRED", fieldPath: fieldPath || "title", sellerMessage: "Product title is required and cannot be blank.", severity: "error" };
    }
    if (/price.*invalid|invalid.*price|price.*format/i.test(rawMessage)) {
      return { code: "PRICE_INVALID", fieldPath: fieldPath || "variants[0].price", sellerMessage: "Selling price must be a valid number with up to 2 decimal places (e.g. 499.00).", severity: "error" };
    }
    if (/price.*must be greater|price.*negative|price.*zero/i.test(rawMessage)) {
      return { code: "PRICE_NEGATIVE", fieldPath: fieldPath || "variants[0].price", sellerMessage: "Selling price must be greater than zero.", severity: "error" };
    }
    if (/barcode.*invalid|invalid.*barcode/i.test(rawMessage)) {
      return { code: "BARCODE_INVALID", fieldPath: fieldPath || "variants[0].barcode", sellerMessage: "Barcode is not a valid EAN-13, UPC, or ISBN format. Check the barcode value and retry.", severity: "error" };
    }
    if (/barcode.*taken|barcode.*already exists|barcode.*duplicate/i.test(rawMessage)) {
      return { code: "BARCODE_DUPLICATE", fieldPath: fieldPath || "variants[0].barcode", sellerMessage: "This barcode is already used by another product in your Shopify store. Each product must have a unique barcode.", severity: "error" };
    }
    if (/sku.*taken|sku.*already exists|sku.*duplicate/i.test(rawMessage)) {
      return { code: "SKU_DUPLICATE", fieldPath: fieldPath || "variants[0].sku", sellerMessage: "This SKU already exists in your Shopify store. Each variant must have a unique SKU.", severity: "error" };
    }
    if (/sku.*blank|sku.*required/i.test(rawMessage)) {
      return { code: "SKU_REQUIRED", fieldPath: fieldPath || "variants[0].sku", sellerMessage: "Variant SKU is required. Set a unique SKU in the product editor.", severity: "error" };
    }
    if (/image.*invalid|invalid.*image|image.*url|src.*invalid/i.test(rawMessage)) {
      return { code: "IMAGE_URL_INVALID", fieldPath: fieldPath || "mainImageUrl", sellerMessage: "The main image URL is invalid or unreachable. Ensure the image is a public HTTPS URL (min 800×800 px).", severity: "error" };
    }
    if (/image.*size|image.*dimension|image.*too small/i.test(rawMessage)) {
      return { code: "IMAGE_TOO_SMALL", fieldPath: fieldPath || "mainImageUrl", sellerMessage: "The image does not meet Shopify's minimum size requirement (800×800 px).", severity: "error" };
    }
    if (/metafield.*type|metafield.*value|metafield.*invalid/i.test(rawMessage)) {
      return { code: "METAFIELD_TYPE_MISMATCH", fieldPath: fieldPath || "attributes", sellerMessage: "A metafield value does not match the expected type defined in your Shopify store. Check the mapped field value.", severity: "error" };
    }
    if (/metafield.*required|required.*metafield/i.test(rawMessage)) {
      return { code: "METAFIELD_REQUIRED", fieldPath, sellerMessage: "A required metafield is missing. Check the mapping editor and ensure all required Shopify fields are mapped.", severity: "error" };
    }
    if (/handle.*taken|handle.*already exists|handle.*duplicate/i.test(rawMessage)) {
      return { code: "HANDLE_DUPLICATE", fieldPath: fieldPath || "handle", sellerMessage: "This product handle (URL slug) is already in use in your Shopify store. Rename the product title to generate a unique handle.", severity: "error" };
    }
    if (/vendor.*too long/i.test(rawMessage)) {
      return { code: "VENDOR_TOO_LONG", fieldPath: fieldPath || "brand", sellerMessage: "Brand/vendor name exceeds Shopify's maximum length.", severity: "error" };
    }
    if (/product type.*too long/i.test(rawMessage)) {
      return { code: "PRODUCT_TYPE_TOO_LONG", fieldPath: fieldPath || "productType", sellerMessage: "Product type is too long for Shopify. Shorten it to 255 characters or fewer.", severity: "error" };
    }
    if (/weight.*invalid|invalid.*weight/i.test(rawMessage)) {
      return { code: "WEIGHT_INVALID", fieldPath: fieldPath || "variants[0].weight", sellerMessage: "Variant weight must be a positive number.", severity: "error" };
    }
    if (lower.includes("throttled") || lower.includes("rate limit")) {
      return { code: "RATE_LIMITED", fieldPath: "", sellerMessage: "Shopify rate limit reached. The publish will be retried automatically.", severity: "error" };
    }
    if (lower.includes("access denied") || lower.includes("unauthorized") || lower.includes("permission")) {
      return { code: "PERMISSION_DENIED", fieldPath: "", sellerMessage: "The Shopify app does not have permission to perform this action. Re-install the connector or check app scopes.", severity: "error" };
    }

    // Fallback — preserve code hint if provided, otherwise generic
    const code = codeHint ? String(codeHint).trim().toUpperCase() || "SHOPIFY_ERROR" : "SHOPIFY_ERROR";
    const sellerMessage = rawMessage || "Shopify rejected the sync request. Review the product data and mapping before retrying.";
    return { code, fieldPath, sellerMessage, severity: "error" };
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
        query GetPublications {
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

    const nodes = Array.isArray(response.publications?.nodes) ? response.publications?.nodes : [];
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

  async publishProduct(
    ctx: ConnectorContext,
    product: ProductPayload,
  ): Promise<SubmissionRef> {
    const validation = await this.validateProduct(ctx, product);
    if (!validation.isValid) {
      throw new Error(validation.errors.map((issue) => issue.sellerMessage).join(" | "));
    }

    const selectedPublicationIds = await this.requirePublicationTargetIds(ctx);
    const productRecord = await this.upsertProduct(ctx, product);
    for (const publicationId of selectedPublicationIds) {
      await this.publishToPublication(ctx, productRecord.id, publicationId);
    }

    this.logger.info("Shopify product sync completed", {
      installationId: ctx.installationId,
      shopifyProductId: productRecord.id,
      publicationTargets: selectedPublicationIds,
    });

    return {
      externalRef: productRecord.id,
      status: "SUCCESS",
      isAsync: false,
    };
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

    const selectedPublicationIds = await this.requirePublicationTargetIds(ctx);
    const productRecord = await this.upsertProduct(ctx, product, externalRef);
    for (const publicationId of selectedPublicationIds) {
      await this.publishToPublication(ctx, productRecord.id, publicationId);
    }

    return {
      externalRef: productRecord.id,
      status: "SUCCESS",
      isAsync: false,
    };
  }

  async syncSubmissionStatus(
    ctx: ConnectorContext,
    externalRef: string,
  ): Promise<SubmissionStatusUpdate> {
    const shopDomain = await this.requireCredential(ctx, "shop_domain");
    const accessToken = await this.resolveAccessToken(ctx);
    const selectedPublicationIds = await this.requirePublicationTargetIds(ctx);
    const response = await this.graphqlRequest<ShopifyProductStatusResponse>({
      shopDomain,
      accessToken,
      query: `
        query GetProductStatus($id: ID!) {
          node(id: $id) {
            ... on Product {
              id
              status
              resourcePublications(first: 50) {
                nodes {
                  isPublished
                  publication {
                    id
                  }
                }
              }
            }
          }
        }
      `,
      variables: {
        id: externalRef,
      },
    });

    const product = response.node;
    if (!product?.id) {
      return {
        externalRef,
        status: "ERROR",
        channelErrors: [
          this.normaliseError(
            "SHOPIFY_PRODUCT_MISSING",
            "Shopify product could not be found for this submission.",
          ),
        ],
        resolvedAt: new Date(),
      };
    }

    const productStatus = String(product.status ?? "").trim().toUpperCase();
    if (SUPPRESSED_PRODUCT_STATUSES.has(productStatus)) {
      return {
        externalRef,
        status: "SUPPRESSED",
        channelErrors: [
          this.normaliseError(
            "SHOPIFY_PRODUCT_ARCHIVED",
            "The Shopify product is archived and no longer publishable.",
          ),
        ],
        resolvedAt: new Date(),
      };
    }

    if (PENDING_PRODUCT_STATUSES.has(productStatus) || productStatus.length === 0) {
      return {
        externalRef,
        status: "PENDING",
        channelErrors: [
          this.normaliseError(
            "SHOPIFY_PRODUCT_NOT_ACTIVE",
            "The Shopify product is not active yet, so publication is still pending.",
          ),
        ],
      };
    }

    const publishedIds = new Set(
      (Array.isArray(product.resourcePublications?.nodes) ? product.resourcePublications?.nodes : [])
        .filter((node) => node?.isPublished && typeof node?.publication?.id === "string")
        .map((node) => String(node?.publication?.id ?? "").trim())
        .filter((value) => value.length > 0),
    );

    const unpublishedTargets = selectedPublicationIds.filter((id) => !publishedIds.has(id));
    if (unpublishedTargets.length > 0) {
      return {
        externalRef,
        status: "PENDING",
        channelErrors: [
          this.normaliseError(
            "SHOPIFY_PUBLICATION_PENDING",
            "The Shopify product is active, but one or more selected publication targets are still unpublished.",
          ),
        ],
      };
    }

    return {
      externalRef,
      status: "SUCCESS",
      channelErrors: [],
      resolvedAt: new Date(),
    };
  }

  async parseWebhookEvent(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<ParsedWebhookEvent | null> {
    if (!this.verifyWebhookSignature(rawBody, headers)) {
      return null;
    }

    const topic = String(headers[SHOPIFY_WEBHOOK_TOPIC_HEADER] ?? "").trim().toLowerCase();
    const rawEventId = String(
      headers[SHOPIFY_WEBHOOK_ID_HEADER] ?? headers[SHOPIFY_EVENT_ID_HEADER] ?? "",
    ).trim();
    if (!topic || !rawEventId) {
      return null;
    }

    let payload: ShopifyWebhookProductPayload = {};
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as ShopifyWebhookProductPayload;
    } catch {
      return null;
    }

    const { status, channelErrors } = this.mapWebhookOutcome(topic, payload);
    return {
      eventType: topic,
      rawEventId,
      externalRef: this.resolveWebhookExternalRef(payload),
      productSku: this.resolveWebhookSku(payload) ?? undefined,
      ...(status ? { status } : {}),
      channelErrors,
    };
  }

  private async resolveAccessToken(ctx: ConnectorContext): Promise<string> {
    try {
      const provided = await ctx.getAccessToken();
      if (typeof provided === "string" && provided.trim().length > 0) {
        return provided.trim();
      }
    } catch {
      // Current framework doesn't inject connector-managed tokens before the guided
      // managed-install handshake persists the Shopify token set.
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

    const existingMetadata = await this.getInstallationMetadata(ctx);
    const shopIdentity =
      token.access_token && !this.normalizeOptionalString(existingMetadata.shopId)
        ? await this.fetchShopIdentity(shopDomain, token.access_token)
        : null;

    await this.persistTokenSet(ctx, token, {
      shopDomain,
      authMode: "expiring_offline_refresh",
      shopIdentity,
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
      signal: AbortSignal.timeout(CONNECTOR_HTTP_TIMEOUT_MS),
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
    input: {
      shopDomain: string;
      authMode: string;
      shopIdentity?: ShopifyShopIdentity | null;
    },
  ): Promise<void> {
    const now = Date.now();
    const scope = this.normalizeOptionalString(token.scope);
    const canonicalShopDomain = this.normalizeShopDomain(
      input.shopIdentity?.myshopifyDomain ?? input.shopDomain,
    );
    const shopId = this.normalizeOptionalString(input.shopIdentity?.id);
    const shopName = this.normalizeOptionalString(input.shopIdentity?.name);

    await this.storeCredential(ctx, "shop_domain", canonicalShopDomain, {
      scope,
      metadata: {
        authMode: input.authMode,
      },
    });

    if (shopId) {
      await this.storeCredential(ctx, "shop_id", shopId, {
        scope,
        metadata: {
          authMode: input.authMode,
          shopDomain: canonicalShopDomain,
        },
      });
    }

    if (shopName) {
      await this.storeCredential(ctx, "shop_name", shopName, {
        scope,
        metadata: {
          authMode: input.authMode,
          shopDomain: canonicalShopDomain,
        },
      });
    }

    if (token.access_token) {
      const expiresAt = Number.isFinite(token.expires_in)
        ? new Date(now + Math.max(1, Number(token.expires_in)) * 1000)
        : null;
      await this.storeCredential(ctx, "access_token", token.access_token, {
        expiresAt,
        scope,
        metadata: {
          authMode: input.authMode,
          shopDomain: canonicalShopDomain,
          shopId,
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
          shopDomain: canonicalShopDomain,
          shopId,
        },
      });
    }

    await this.persistInstallationMetadata(ctx, {
      shopDomain: canonicalShopDomain,
      shopId,
      shopName,
      tokenMode: token.refresh_token ? "expiring_offline" : "offline",
      authMode: input.authMode,
      scope,
    });
  }

  private async persistInstallationMetadata(
    ctx: ConnectorContext,
    metadata: {
      shopDomain: string;
      shopId: string | null;
      shopName: string | null;
      tokenMode: string;
      authMode: string;
      scope: string | null;
    },
  ): Promise<void> {
    const db = this.prismaDirect.getClient();
    await tenantExecRaw(db, `
      UPDATE connector_installations
      SET
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'shopDomain', $3,
          'shopId', $4::text,
          'shopName', $5::text,
          'tokenMode', $6::text,
          'authMode', $7::text,
          'scope', $8::text,
          'connectionStage', 'connected',
          'managedInstallPending', false
        ),
        updated_at = NOW()
      WHERE tenant_key = $1 AND id = $2
      `,
      [ctx.tenantId, ctx.installationId, metadata.shopDomain, metadata.shopId,
       metadata.shopName, metadata.tokenMode, metadata.authMode, metadata.scope]);
  }

  private async noteCredentialHealth(ctx: ConnectorContext, failureReason: string | null): Promise<void> {
    const db = this.prismaDirect.getClient();
    await tenantExecRaw(db, `
      UPDATE connector_credentials
      SET
        last_validated_at = NOW(),
        failure_reason = $3,
        updated_at = NOW()
      WHERE tenant_key = $1
        AND installation_id = $2
        AND credential_type IN ('access_token', 'refresh_token', 'shop_domain', 'shop_id', 'shop_name')
      `,
      [ctx.tenantId, ctx.installationId, failureReason]);
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
    const rows = await tenantRaw<CredentialRow[]>(db, `
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
      [ctx.tenantId, ctx.installationId, credentialType]);
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

    await tenantExecRaw(db, `
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
      [id, ctx.tenantId, ctx.installationId, credentialType,
       encrypted.cipher, keyVersion, options.scope ?? null,
       options.expiresAt ?? null, metadata]);
  }

  private async fetchShopIdentity(shopDomain: string, accessToken: string): Promise<ShopifyShopIdentity> {
    const response = await this.graphqlRequest<{ shop?: ShopifyShopIdentity | null }>({
      shopDomain,
      accessToken,
      query: `
        query GetShopIdentity {
          shop {
            id
            name
            myshopifyDomain
          }
        }
      `,
    });

    const shop = response.shop;
    if (!shop?.id) {
      throw new Error("Shopify shop identity query did not return a shop id.");
    }
    return shop;
  }

  private async upsertProduct(
    ctx: ConnectorContext,
    product: ProductPayload,
    externalRef?: string,
  ): Promise<{ id: string; handle: string | null; status: string | null }> {
    const shopDomain = await this.requireCredential(ctx, "shop_domain");
    const accessToken = await this.resolveAccessToken(ctx);
    const response = await this.graphqlRequest<ShopifyProductSetResponse>({
      shopDomain,
      accessToken,
      query: `
        mutation UpsertProduct($input: ProductSetInput!, $identifier: ProductSetIdentifiers!) {
          productSet(synchronous: true, input: $input, identifier: $identifier) {
            product {
              id
              handle
              status
              variants(first: 1) { edges { node { id } } }
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      variables: {
        input: this.buildProductSetInput(product),
        identifier: this.buildProductIdentifier(product, externalRef),
      },
    });

    const mutation = response.productSet;
    const rawUserErrors = Array.isArray(mutation?.userErrors) ? mutation.userErrors : [];
    if (rawUserErrors.length > 0) {
      const issues = rawUserErrors.map((ue) =>
        this.parseShopifyUserError(ue.field, String(ue.message ?? "").trim()),
      );
      throw new ShopifyPublishError(
        issues,
        `Shopify product sync failed: ${issues.map((i) => i.sellerMessage).join(" | ")}`,
      );
    }

    if (!mutation?.product?.id) {
      throw new Error("Shopify product sync did not return a product id.");
    }

    const shopifyProductId = String(mutation.product.id);
    // Only run the secondary variant price update for single-variant products.
    // For multi-variant products the ProductSet mutation already set each variant's
    // price correctly via buildVariantInput. Applying the product-level scalar price
    // to whichever variant Shopify returns first (internal order, may differ from PIM
    // order on updates) would silently corrupt that variant's price.
    const isMultiVariantPayload = Array.isArray(product.variants) && product.variants.length > 0;
    if (!isMultiVariantPayload) {
      const variantId = (mutation.product as any).variants?.edges?.[0]?.node?.id;
      if (variantId) {
        await this.updateDefaultVariantPrice(ctx, shopifyProductId, variantId, product);
      }
    }

    return {
      id: shopifyProductId,
      handle: this.normalizeOptionalString(mutation.product.handle),
      status: this.normalizeOptionalString(mutation.product.status),
    };
  }

  private async updateDefaultVariantPrice(
    ctx: ConnectorContext,
    shopifyProductId: string,
    variantId: string,
    product: ProductPayload,
  ): Promise<void> {
    const shopDomain = await this.requireCredential(ctx, "shop_domain");
    const accessToken = await this.resolveAccessToken(ctx);
    const sellingPrice = this.formatMoney(product.sellingPrice);
    const compareAtPrice =
      Number.isFinite(product.mrp) && Number(product.mrp) > 0 ? this.formatMoney(product.mrp) : null;
    const sku = String(product.sku ?? "").trim();
    const variantInput = {
      id: variantId,
      price: sellingPrice,
      ...(compareAtPrice ? { compareAtPrice } : {}),
      inventoryPolicy: "CONTINUE",
      taxable: true,
      inventoryItem: { tracked: false, ...(sku ? { sku } : {}) },
    };
    const variantResponse = await this.graphqlRequest<ShopifyBulkUpdateVariantResponse>({
      shopDomain,
      accessToken,
      query: `
        mutation BulkUpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants { id price }
            userErrors { field message }
          }
        }
      `,
      variables: { productId: shopifyProductId, variants: [variantInput] },
    });
    const variantErrors = (
      Array.isArray(variantResponse.productVariantsBulkUpdate?.userErrors)
        ? variantResponse.productVariantsBulkUpdate?.userErrors
        : []
    )
      .map((issue) => String(issue?.message ?? "").trim())
      .filter((message) => message.length > 0);
    if (variantErrors.length > 0) {
      throw new Error(`Shopify variant update failed: ${variantErrors.join(" | ")}`);
    }
  }

  // ─── Sprint 2: Shopify config import ─────────────────────────────────────────

  async importShopifyConfig(ctx: ConnectorContext): Promise<ShopifyConfigResult> {
    const shopDomain = await this.requireCredential(ctx, "shop_domain");
    const accessToken = await this.resolveAccessToken(ctx);

    const [metafieldData, collectionsData, taxonomyData] = await Promise.all([
      this.graphqlRequest<ShopifyConfigQueryResponse>({
        shopDomain,
        accessToken,
        query: `
          query VexaFetchMetafieldDefs($ownerType: MetafieldOwnerType!) {
            metafieldDefinitions(first: 200, ownerType: $ownerType) {
              nodes {
                id name namespace key description required ownerType
                type { name }
                validations { name value }
              }
            }
          }
        `,
        variables: { ownerType: "PRODUCT" },
      }).catch(() => ({ metafieldDefinitions: null })),
      this.graphqlRequest<ShopifyConfigQueryResponse>({
        shopDomain,
        accessToken,
        query: `
          query VexaFetchCollections {
            collections(first: 250) {
              nodes { id title handle }
            }
          }
        `,
      }).catch(() => ({ collections: null })),
      this.graphqlRequest<ShopifyConfigQueryResponse>({
        shopDomain,
        accessToken,
        query: `
          query VexaFetchTaxonomy {
            productTaxonomyNodes(first: 250) {
              nodes { id name level isLeaf parentId }
            }
          }
        `,
      }).catch(() => ({ productTaxonomyNodes: null })),
    ]);

    const metafields = (metafieldData.metafieldDefinitions?.nodes ?? []).map((n) => ({
      id: String(n.id ?? ""),
      name: String(n.name ?? ""),
      namespace: String(n.namespace ?? ""),
      key: String(n.key ?? ""),
      type: String(n.type?.name ?? "single_line_text_field"),
      description: this.normalizeOptionalString(n.description),
      required: Boolean(n.required),
      ownerType: String(n.ownerType ?? "PRODUCT"),
    })).filter((m) => m.id && m.namespace && m.key);

    const collections = (collectionsData.collections?.nodes ?? []).map((n) => ({
      id: String(n.id ?? ""),
      title: String(n.title ?? ""),
      handle: String(n.handle ?? ""),
    })).filter((c) => c.id);

    const taxonomy = (taxonomyData.productTaxonomyNodes?.nodes ?? []).map((n) => ({
      id: String(n.id ?? ""),
      name: String(n.name ?? ""),
      level: Number(n.level ?? 0),
      isLeaf: Boolean(n.isLeaf),
      parentId: this.normalizeOptionalString(n.parentId),
    })).filter((t) => t.id);

    const result: ShopifyConfigResult = {
      metafields,
      collections,
      taxonomy,
      fetchedAt: new Date().toISOString(),
    };

    // Persist into installation metadata using JSONB merge (preserves existing keys)
    const db = this.prismaDirect.getClient();
    await tenantExecRaw(db, `
      UPDATE connector_installations
      SET
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('shopifyConfig', $3::jsonb),
        updated_at = NOW()
      WHERE tenant_key = $1 AND id = $2
      `,
      [ctx.tenantId, ctx.installationId, JSON.stringify(result)]);

    this.logger.info("Shopify config imported", {
      installationId: ctx.installationId,
      metafields: metafields.length,
      collections: collections.length,
      taxonomy: taxonomy.length,
    });

    return result;
  }

  async getShopifyConfig(ctx: ConnectorContext): Promise<ShopifyConfigResult | null> {
    const metadata = await this.getInstallationMetadata(ctx);
    const config = metadata.shopifyConfig;
    if (!config || typeof config !== "object") {
      return null;
    }
    return config as unknown as ShopifyConfigResult;
  }

  // ─── Sprint 14: Localized fields ─────────────────────────────────────────────

  /**
   * Register translations for a published product using Shopify translationsRegister.
   * Called after a successful productSet publish. Translation failures add warnings (not errors)
   * — the base publish is already committed and the submission stays SUCCESS.
   * Returns warning strings for any locale that failed.
   */
  async registerTranslations(
    ctx: ConnectorContext,
    productGid: string,
    localeTranslations: Array<{
      locale: string;
      fieldMappings: { title?: string; descriptionHtml?: string; seoTitle?: string; seoDescription?: string };
    }>,
    product: { title: string; description: string; seoTitle?: string; seoDescription?: string },
  ): Promise<string[]> {
    if (!localeTranslations.length) {
      return [];
    }

    const shopDomain = await this.requireCredential(ctx, "shop_domain");
    const accessToken = await this.resolveAccessToken(ctx);
    const warnings: string[] = [];

    for (const localeConfig of localeTranslations) {
      const { locale, fieldMappings } = localeConfig;
      if (!locale) continue;

      const translations: Array<{ key: string; value: string; translatableContentDigest: string; locale: string }> = [];

      if (fieldMappings.title && product.title) {
        translations.push({
          key: "title",
          value: String(fieldMappings.title),
          translatableContentDigest: Buffer.from(product.title).toString("base64"),
          locale,
        });
      }
      if (fieldMappings.descriptionHtml && product.description) {
        translations.push({
          key: "body_html",
          value: String(fieldMappings.descriptionHtml),
          translatableContentDigest: Buffer.from(product.description).toString("base64"),
          locale,
        });
      }
      if (fieldMappings.seoTitle && product.seoTitle) {
        translations.push({
          key: "meta_title",
          value: String(fieldMappings.seoTitle),
          translatableContentDigest: Buffer.from(product.seoTitle).toString("base64"),
          locale,
        });
      }
      if (fieldMappings.seoDescription && product.seoDescription) {
        translations.push({
          key: "meta_description",
          value: String(fieldMappings.seoDescription),
          translatableContentDigest: Buffer.from(product.seoDescription).toString("base64"),
          locale,
        });
      }

      if (translations.length === 0) continue;

      try {
        type TranslationsRegisterResponse = {
          translationsRegister?: {
            userErrors?: Array<{ field?: string[]; message?: string }>;
          } | null;
        };
        const response = await this.graphqlRequest<TranslationsRegisterResponse>({
          shopDomain,
          accessToken,
          query: `
            mutation VexaRegisterTranslations($resourceId: ID!, $translations: [TranslationInput!]!) {
              translationsRegister(resourceId: $resourceId, translations: $translations) {
                userErrors {
                  field
                  message
                }
              }
            }
          `,
          variables: {
            resourceId: productGid,
            translations,
          },
        });

        const userErrors = response.translationsRegister?.userErrors ?? [];
        if (userErrors.length > 0) {
          const msgs = userErrors.map((e) => String(e.message ?? "")).filter(Boolean).join("; ");
          warnings.push(`Locale '${locale}' translation failed: ${msgs}`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        warnings.push(`Locale '${locale}' translation call failed: ${reason}`);
      }
    }

    return warnings;
  }

  // ─── Sprint 14 end ───────────────────────────────────────────────────────────

  private async publishToPublication(
    ctx: ConnectorContext,
    productId: string,
    publicationId: string,
  ): Promise<void> {
    const shopDomain = await this.requireCredential(ctx, "shop_domain");
    const accessToken = await this.resolveAccessToken(ctx);
    const response = await this.graphqlRequest<ShopifyPublishResponse>({
      shopDomain,
      accessToken,
      query: `
        mutation PublishProduct($id: ID!, $publicationId: ID!) {
          publishablePublish(id: $id, input: { publicationId: $publicationId }) {
            publishable {
              publishedOnPublication(publicationId: $publicationId)
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      variables: {
        id: productId,
        publicationId,
      },
    });

    const mutation = response.publishablePublish;
    const errors = (Array.isArray(mutation?.userErrors) ? mutation?.userErrors : [])
      .map((issue) => String(issue?.message ?? "").trim())
      .filter((message) => message.length > 0);
    if (errors.length > 0) {
      throw new Error(`Shopify publication failed: ${errors.join(" | ")}`);
    }

    if (!mutation?.publishable?.publishedOnPublication) {
      throw new Error(`Shopify publication did not confirm success for target ${publicationId}.`);
    }
  }

  private buildProductIdentifier(product: ProductPayload, externalRef?: string): Record<string, unknown> {
    const normalizedExternalRef = this.normalizeOptionalString(externalRef);
    if (normalizedExternalRef && /^gid:\/\/shopify\/Product\//.test(normalizedExternalRef)) {
      return {
        id: normalizedExternalRef,
      };
    }
    return {
      handle: this.buildHandle(product),
    };
  }

  async previewChanges(
    ctx: ConnectorContext,
    product: ProductPayload,
    shopifyGid: string,
  ): Promise<ShopifyProductPreview> {
    const shopDomain = await this.requireCredential(ctx, "shop_domain");
    const accessToken = await this.resolveAccessToken(ctx);
    const response = await this.graphqlRequest<ShopifyProductStateQueryResponse>({
      shopDomain,
      accessToken,
      query: `
        query GetProductState($id: ID!) {
          node(id: $id) {
            ... on Product {
              id title handle descriptionHtml status vendor productType tags
              seo { title description }
              variants(first: 1) {
                nodes { price compareAtPrice barcode sku inventoryPolicy taxable }
              }
              images(first: 1) { nodes { src altText } }
            }
          }
        }
      `,
      variables: { id: shopifyGid },
    });

    const node = response.node;
    if (!node) {
      return { hasExistingProduct: false, noChanges: false, changes: [] };
    }

    const newInput = this.buildProductSetInput(product);
    const variant = (node.variants?.nodes ?? [])[0];
    const image = (node.images?.nodes ?? [])[0];

    const compareField = (
      field: string,
      current: string | null | undefined,
      next: string | null | undefined,
      riskLevel: ShopifyProductChangeItem["riskLevel"],
    ): ShopifyProductChangeItem | null => {
      const cur = current ?? null;
      const nxt = next ?? null;
      if (cur === nxt) return null;
      const changeType = cur === null ? "add" : nxt === null ? "remove" : "update";
      return { field, currentValue: cur, newValue: nxt, changeType, riskLevel };
    };

    const newVariant = (Array.isArray(newInput.variants) ? newInput.variants[0] : null) as Record<string, unknown> | null;

    const candidates = [
      compareField("title", node.title, String(newInput.title ?? ""), "low"),
      compareField("handle", node.handle, String(newInput.handle ?? ""), "medium"),
      compareField("status", node.status, String(newInput.status ?? ""), "high"),
      compareField("vendor", node.vendor ?? null, (newInput.vendor as string | undefined) ?? null, "low"),
      compareField("productType", node.productType ?? null, (newInput.productType as string | undefined) ?? null, "low"),
      compareField("price", variant?.price ?? null, newVariant ? String(newVariant.price ?? "") : null, "medium"),
      compareField("compareAtPrice", variant?.compareAtPrice ?? null, newVariant ? (String(newVariant.compareAtPrice ?? "") || null) : null, "medium"),
      compareField("image", image?.src ?? null, (Array.isArray(newInput.files) && newInput.files[0]) ? String((newInput.files[0] as Record<string, unknown>).originalSource ?? "") : null, "low"),
    ];

    const changes = candidates.filter((c): c is ShopifyProductChangeItem => c !== null);
    return { hasExistingProduct: true, noChanges: changes.length === 0, changes };
  }

  private buildVariantInput(
    sku: string,
    sellingPrice: number,
    mrp: number,
    opts?: {
      compareAtPrice?: number;
      barcode?: string;
      weight?: number;
      weightUnit?: string;
      taxable?: boolean;
      inventoryPolicy?: string;
      optionValues?: Array<{ optionName: string; name: string }>;
    },
  ): Record<string, unknown> {
    const price = this.formatMoney(sellingPrice);
    const effectiveCompareAt = opts?.compareAtPrice ?? (mrp > 0 ? mrp : null);
    const compareAtPrice = effectiveCompareAt && Number.isFinite(effectiveCompareAt) && effectiveCompareAt > 0
      ? this.formatMoney(effectiveCompareAt)
      : null;
    const optionValues = opts?.optionValues ?? [{ optionName: "Title", name: "Default Title" }];
    return {
      price,
      ...(compareAtPrice ? { compareAtPrice } : {}),
      inventoryPolicy: opts?.inventoryPolicy ?? "CONTINUE",
      taxable: opts?.taxable ?? true,
      inventoryItem: {
        tracked: false,
        sku: String(sku).trim(),
        ...(opts?.weight && opts.weight > 0
          ? { measurement: { weight: { value: opts.weight, unit: opts.weightUnit ?? "KILOGRAMS" } } }
          : {}),
      },
      ...(opts?.barcode ? { barcode: opts.barcode } : {}),
      optionValues,
    };
  }

  private buildProductSetInput(product: ProductPayload): Record<string, unknown> {
    const productType = this.normalizeOptionalString(product.productType);
    const brand = this.normalizeOptionalString(product.brand);
    const title = String(product.title ?? "").trim();
    const handle = this.buildHandle(product);
    const metafields = [
      {
        namespace: DEFAULT_CUSTOM_ID_NAMESPACE,
        key: DEFAULT_CUSTOM_ID_KEY,
        type: "single_line_text_field",
        value: String(product.sku ?? "").trim(),
      },
      {
        namespace: DEFAULT_PIM_METAFIELD_NAMESPACE,
        key: "source_sku",
        type: "single_line_text_field",
        value: String(product.sku ?? "").trim(),
      },
    ];

    const isMultiVariant = Array.isArray(product.variants) && product.variants.length > 0;

    const variants: Record<string, unknown>[] = isMultiVariant
      ? product.variants!.map((v) => ({
          ...this.buildVariantInput(v.sku, v.sellingPrice, v.mrp, {
            compareAtPrice: v.compareAtPrice,
            barcode: v.barcode,
            weight: v.weight,
            weightUnit: v.weightUnit,
            taxable: v.taxable,
            inventoryPolicy: v.inventoryPolicy,
          }),
          optionValues: Array.isArray(v.options) && v.options.length > 0
            ? v.options
            : [{ optionName: "Title", name: "Default Title" }],
        }))
      : [{
          ...this.buildVariantInput(
            String(product.sku ?? "").trim(),
            product.sellingPrice,
            product.mrp,
            { compareAtPrice: product.compareAtPrice },
          ),
          optionValues: [{ optionName: "Title", name: "Default Title" }],
        }];

    // Derive productOptions from the first variant's option names for multi-variant products.
    const productOptions: Record<string, unknown>[] = isMultiVariant && product.variants![0]?.options?.length
      ? product.variants![0].options.map((opt, i) => ({
          name: opt.optionName,
          position: i + 1,
          values: [...new Set(
            product.variants!.map((v) => v.options?.find((o) => o.optionName === opt.optionName)?.name ?? "Default")
          )].filter(Boolean).map((name) => ({ name })),
        }))
      : [{ name: "Title", position: 1, values: [{ name: "Default Title" }] }];

    const seoTitle = this.normalizeOptionalString(product.seoTitle);
    const seoDescription = this.normalizeOptionalString(product.seoDescription);
    const tags = Array.isArray(product.tags) && product.tags.length > 0
      ? product.tags.map((t) => String(t ?? "").trim()).filter(Boolean)
      : undefined;
    const status = product.status === "DRAFT" ? "DRAFT" : "ACTIVE";

    // Derive image filename extension from the URL to satisfy Shopify's validation.
    // If the URL path has no recognizable extension, omit filename entirely.
    const imageUrl = String(product.mainImageUrl ?? "").trim();
    const urlPath = (() => { try { return new URL(imageUrl).pathname; } catch { return imageUrl; } })();
    const extMatch = urlPath.split("/").pop()?.split(".").slice(1).pop()?.toLowerCase();
    const imageFilename = extMatch && /^[a-z0-9]{2,5}$/.test(extMatch)
      ? `product-image.${extMatch}`
      : undefined;

    return {
      title,
      handle,
      descriptionHtml: String(product.description ?? "").trim(),
      status,
      ...(brand ? { vendor: brand } : {}),
      ...(productType ? { productType } : {}),
      ...(seoTitle || seoDescription ? { seo: { ...(seoTitle ? { title: seoTitle } : {}), ...(seoDescription ? { description: seoDescription } : {}) } } : {}),
      ...(tags ? { tags } : {}),
      metafields,
      productOptions,
      files: [
        {
          originalSource: imageUrl,
          alt: title,
          contentType: "IMAGE",
          ...(imageFilename ? { filename: imageFilename } : {}),
        },
      ],
      variants,
    };
  }

  private async requirePublicationTargetIds(ctx: ConnectorContext): Promise<string[]> {
    const metadata = await this.getInstallationMetadata(ctx);
    const publicationTargetIds = this.readPublicationTargetIds(metadata);
    if (publicationTargetIds.length === 0) {
      throw new Error(
        "Shopify publication targets are not configured for this installation. Select publication targets before publishing.",
      );
    }
    return publicationTargetIds;
  }

  private async getInstallationMetadata(ctx: ConnectorContext): Promise<Record<string, unknown>> {
    const db = this.prismaDirect.getClient();
    const rows = await tenantRaw<InstallationMetadataRow[]>(db, `
      SELECT metadata
      FROM connector_installations
      WHERE tenant_key = $1
        AND id = $2
      LIMIT 1
      `,
      [ctx.tenantId, ctx.installationId]);
    return this.asRecord(rows[0]?.metadata);
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
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await fetch(endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(CONNECTOR_HTTP_TIMEOUT_MS),
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

      // HTTP 429 â€” Shopify REST-level rate limit
      if (response.status === 429) {
        const retryAfterRaw = response.headers.get("Retry-After");
        const retryAfterSec = retryAfterRaw ? parseFloat(retryAfterRaw) : 2;
        const waitMs = Math.min(Math.ceil(retryAfterSec * 1000), 60_000);
        this.logger.warn("Shopify rate limit hit (HTTP 429). Backing off before retry.", {
          shopDomain: input.shopDomain,
          attempt,
          retryAfterSec,
          waitMs,
        });
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
        throw new Error(
          `Shopify rate limit exceeded after ${MAX_RETRIES} retries. ` +
          `The store is receiving too many API requests. Try again in a few seconds.`,
        );
      }

      const text = await response.text();
      let parsed: ShopifyGraphQlEnvelope<T> = {};
      try {
        parsed = text ? (JSON.parse(text) as ShopifyGraphQlEnvelope<T>) : {};
      } catch {
        parsed = {};
      }

      // GraphQL THROTTLED error â€” query cost exceeded the leaky-bucket limit
      const isThrottled = Array.isArray(parsed.errors) &&
        parsed.errors.some((e) => e?.extensions?.code === "THROTTLED");
      if (isThrottled) {
        const bucket = parsed.extensions?.cost?.throttleStatus;
        const restoreRate = bucket?.restoreRate ?? 50;
        const needed = parsed.extensions?.cost?.requestedQueryCost ?? 0;
        const available = bucket?.currentlyAvailable ?? 0;
        // Wait long enough for the bucket to restore the needed cost
        const waitMs = Math.min(Math.ceil(((needed - available) / restoreRate) * 1000) + 200, 60_000);
        this.logger.warn("Shopify GraphQL query throttled. Waiting for bucket to restore.", {
          shopDomain: input.shopDomain,
          attempt,
          requestedQueryCost: needed,
          currentlyAvailable: available,
          restoreRate,
          waitMs,
        });
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
        throw new Error(
          `Shopify API query cost throttled after ${MAX_RETRIES} retries. ` +
          `Bucket available: ${available}/${bucket?.maximumAvailable ?? "?"}, requested: ${needed}. ` +
          `Reduce concurrent exports or wait before retrying.`,
        );
      }

      // Log a warning when the bucket is running low (below 20% capacity)
      const throttleStatus = parsed.extensions?.cost?.throttleStatus;
      if (throttleStatus) {
        const { currentlyAvailable = 0, maximumAvailable = 1 } = throttleStatus;
        if (currentlyAvailable / maximumAvailable < 0.2) {
          this.logger.warn("Shopify API rate limit bucket is running low.", {
            shopDomain: input.shopDomain,
            currentlyAvailable,
            maximumAvailable,
            restoreRate: throttleStatus.restoreRate,
          });
        }
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

    // Unreachable â€” loop always returns or throws
    throw new Error("Shopify GraphQL request failed: exhausted retry attempts.");
  }

  private verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string>): boolean {
    const signatureHeader = String(headers[SHOPIFY_WEBHOOK_HMAC_HEADER] ?? "").trim();
    if (!signatureHeader) {
      return false;
    }
    const digest = createHmac("sha256", this.requireClientSecret())
      .update(rawBody)
      .digest("base64");
    const provided = Buffer.from(signatureHeader, "utf8");
    const expected = Buffer.from(digest, "utf8");
    if (provided.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(provided, expected);
  }

  private mapWebhookOutcome(
    topic: string,
    payload: ShopifyWebhookProductPayload,
  ): {
    status?: "SUCCESS" | "REJECTED" | "SUPPRESSED";
    channelErrors: ConnectorIssue[];
  } {
    if (topic === "products/delete") {
      return {
        status: "SUPPRESSED",
        channelErrors: [
          this.normaliseError(
            "SHOPIFY_PRODUCT_DELETED",
            "The Shopify product was deleted.",
          ),
        ],
      };
    }

    if (topic === "products/create" || topic === "products/update") {
      const productStatus = String(payload.status ?? "").trim().toUpperCase();
      if (SUPPRESSED_PRODUCT_STATUSES.has(productStatus)) {
        return {
          status: "SUPPRESSED",
          channelErrors: [
            this.normaliseError(
              "SHOPIFY_PRODUCT_ARCHIVED",
              "The Shopify product is archived.",
            ),
          ],
        };
      }
      if (PENDING_PRODUCT_STATUSES.has(productStatus) || productStatus.length === 0) {
        return {
          channelErrors: [
            this.normaliseError(
              "SHOPIFY_PRODUCT_NOT_ACTIVE",
              "The Shopify product is not active yet.",
            ),
          ],
        };
      }
      return {
        status: "SUCCESS",
        channelErrors: [],
      };
    }

    return {
      channelErrors: [],
    };
  }

  private resolveWebhookExternalRef(payload: ShopifyWebhookProductPayload): string | undefined {
    const graphqlId = this.normalizeOptionalString(payload.admin_graphql_api_id);
    if (graphqlId) {
      return graphqlId;
    }
    const numericId = this.normalizeOptionalString(payload.id);
    return numericId ? `gid://shopify/Product/${numericId}` : undefined;
  }

  private resolveWebhookSku(payload: ShopifyWebhookProductPayload): string | null {
    const firstVariant = Array.isArray(payload.variants) ? payload.variants[0] : null;
    return this.normalizeOptionalString(firstVariant?.sku);
  }

  private asRecord(raw: unknown): Record<string, unknown> {
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

  private formatMoney(value: number): string {
    const numeric = Number.isFinite(value) ? value : 0;
    return numeric.toFixed(2);
  }

  private buildHandle(product: ProductPayload): string {
    const seed = `${String(product.title ?? "").trim()} ${String(product.sku ?? "").trim()}`;
    return seed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "product";
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
    return String(process.env.PIM_SHOPIFY_ADMIN_API_VERSION ?? DEFAULT_ADMIN_API_VERSION).trim() || DEFAULT_ADMIN_API_VERSION;
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

  private normalizeOptionalString(value: unknown): string | null {
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
