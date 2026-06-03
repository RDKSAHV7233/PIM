import { Injectable } from "@nestjs/common";
import { Buffer } from "node:buffer";
import ExcelJS from "exceljs";
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
  ProductPayload,
  ProductTypeSchema,
  SubmissionRef,
  SubmissionStatusUpdate,
  ValidationResult,
} from "../../connector-framework/connector.interface";
import { PrismaDirectService } from "../../prisma/prisma-direct.service";
import {
  getCategoryRule,
  ruleToProductTypeSchema,
  FieldRule,
} from "./flipkart-category-rules";

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

type FlipkartListingPayload = {
  skuId: string;
  productId?: string;
  mrp: number;
  sellingPrice: number;
  listingStatus: "ACTIVE" | "INACTIVE";
  quantity: number;
  fulfillmentBy: "seller" | "flipkart";
  procurementType: "REGULAR" | "LIMITED";
  procurementSla: number;
  shippingProvider: string;
  packageWeight: number;
  packageLength: number;
  packageBreadth: number;
  packageHeight: number;
  hsn?: string;
  taxCode?: string;
  images?: Array<{ url: string; sequence: number }>;
  attributes?: Record<string, string | number | boolean>;
};

type FlipkartPublishResponse = {
  requestId?: string;
  status?: "SUCCESS" | "PARTIAL" | "FAILURE";
  skuErrors?: Array<{
    skuId?: string;
    errorCode?: string;
    errorMessage?: string;
  }>;
};

const CONNECTOR_HTTP_TIMEOUT_MS = 30_000;
const ACCESS_TOKEN_BUFFER_MS = 60_000;
const DEFAULT_REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_WARNING_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_OAUTH_BASE_URL = "https://api.flipkart.net";
const DEFAULT_REQUEST_DELAY_MS = 100;

// Static REQUIRED_FIELDS removed — validation is now driven by the category rule
// registry in flipkart-category-rules.ts. See getCategoryRule() + validateProduct().

const ERROR_MESSAGES: Record<string, string> = {
  CATEGORY_MISMATCH: "Product category does not match Flipkart's category tree. Re-map the category.",
  ATTRIBUTE_MISSING: "A required Flipkart attribute is missing. Update the mapping and try again.",
  INVALID_GSTIN: "GST or HSN data is invalid or missing. Check tax details before publishing.",
  PRICE_BELOW_FLOOR: "Selling price is below Flipkart's minimum floor price for this category.",
  SKU_ALREADY_EXISTS: "This SKU is already listed on Flipkart. Update the existing listing instead of creating a new one.",
  SELLER_NOT_AUTHORISED: "Your Flipkart seller account is not authorised for this category.",
  IMAGE_COUNT_INSUFFICIENT: "Flipkart requires more product images for this category.",
  TOKEN_EXPIRED: "Flipkart connection expired. Reconnect the account and try again.",
  REFRESH_TOKEN_EXPIRED: "Your Flipkart connection has expired. Go to Connectors and reconnect your Flipkart account.",
};

@Injectable()
export class FlipkartConnector implements ConnectorInterface {
  readonly slug = "flipkart";
  readonly displayName = "Flipkart";
  readonly implementationStatus = "full" as const;
  readonly capabilities: ConnectorCap[] = [
    "PUBLISH",
    "VALIDATE",
    "STATUS_SYNC",
    "EXCEL_EXPORT",
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
      const refreshStatus = await this.checkRefreshTokenHealth(ctx);
      if (refreshStatus === "expired") {
        const reason = "Flipkart refresh token has expired. Reconnect the account from the Connectors page.";
        await this.noteCredentialHealth(ctx, reason);
        this.logger.error("Flipkart refresh token expired", {
          installationId: ctx.installationId,
        });
        return false;
      }
      if (refreshStatus === "expiring_soon") {
        const refreshRow = await this.getCredentialRow(ctx, "refresh_token");
        this.logger.warn("Flipkart refresh token expiring soon", {
          installationId: ctx.installationId,
          expiresAt: refreshRow?.expiresAt ?? null,
          warningWindowDays: 7,
        });
        await this.noteCredentialWarning(
          ctx,
          "Flipkart refresh token expires within 7 days. Reconnect soon to avoid publish failures.",
        );
      }
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

    // Resolve category-specific rule set — falls back to 'default' for unknown categories.
    const categorySlug = String(product.productType ?? "").trim().toLowerCase();
    const rule = getCategoryRule(categorySlug);

    // ── Category field rules ──────────────────────────────────────────────────
    for (const field of rule.fields) {
      const value = this.getFieldValue(product, field.fieldPath);
      if (this.isEmpty(value)) {
        if (field.required) {
          errors.push({
            code: "REQUIRED_FIELD_MISSING",
            fieldPath: field.fieldPath,
            sellerMessage: field.sellerMessage,
            severity: "error",
          });
        } else {
          warnings.push({
            code: "RECOMMENDED_FIELD_MISSING",
            fieldPath: field.fieldPath,
            sellerMessage: field.sellerMessage,
            severity: "warning",
          });
        }
      }
    }

    // ── Image HTTPS check ─────────────────────────────────────────────────────
    const mainUrl = typeof product.mainImageUrl === "string" ? product.mainImageUrl.trim() : "";
    if (mainUrl.length > 0 && !/^https:\/\//i.test(mainUrl)) {
      errors.push({
        code: "IMAGE_URL_NOT_HTTPS",
        fieldPath: "mainImageUrl",
        sellerMessage: "Flipkart images must use a permanent HTTPS URL.",
        severity: "error",
      });
    }
    if (Array.isArray(product.additionalImageUrls)) {
      product.additionalImageUrls.forEach((url, index) => {
        const trimmed = typeof url === "string" ? url.trim() : "";
        if (trimmed.length > 0 && !/^https:\/\//i.test(trimmed)) {
          errors.push({
            code: "IMAGE_URL_NOT_HTTPS",
            fieldPath: `additionalImageUrls[${index}]`,
            sellerMessage: `Additional image ${index + 1} must use a permanent HTTPS URL.`,
            severity: "error",
          });
        }
      });
    }

    // ── Price logic ───────────────────────────────────────────────────────────
    if (this.isNumber(product.mrp) && this.isNumber(product.sellingPrice) && product.sellingPrice > product.mrp) {
      warnings.push({
        code: "SELLING_PRICE_GT_MRP",
        fieldPath: "sellingPrice",
        sellerMessage: "Selling price is higher than MRP. Review Flipkart pricing before publishing.",
        severity: "warning",
      });
    }

    // ── Overwrite safety guard ────────────────────────────────────────────────
    // Flipkart's update API overwrites listing data. Warn operator before submit.
    warnings.push({
      code: "FLIPKART_OVERWRITE_WARNING",
      fieldPath: "sku",
      sellerMessage:
        "Publishing to Flipkart will overwrite any existing listing for this SKU. Confirm before proceeding.",
      severity: "warning",
    });

    // ── Valid values check ────────────────────────────────────────────────────
    if (rule.validValues) {
      for (const [attrKey, allowed] of Object.entries(rule.validValues)) {
        const fieldPath = `attributes.${attrKey}`;
        const value = this.getFieldValue(product, fieldPath);
        if (typeof value === "string" && value.trim().length > 0) {
          const trimmed = value.trim();
          if (!allowed.includes(trimmed)) {
            warnings.push({
              code: "ATTRIBUTE_VALUE_NOT_IN_LIST",
              fieldPath,
              sellerMessage: `"${trimmed}" is not in Flipkart's accepted values for ${attrKey}. Accepted: ${allowed.join(", ")}.`,
              severity: "warning",
            });
          }
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      source: "LOCAL_RULES",
    };
  }

  async fetchProductTypeSchema(
    _ctx: ConnectorContext,
    productType: string,
  ): Promise<ProductTypeSchema> {
    const slug = String(productType ?? "").trim().toLowerCase();
    const rule = getCategoryRule(slug);
    return ruleToProductTypeSchema(slug || "default", rule);
  }

  async generateExportFile(
    _ctx: ConnectorContext,
    products: ProductPayload[],
  ): Promise<ExportFile> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Vexa PIM";
    workbook.created = new Date();

    // Determine the dominant category from the product set (first product wins).
    const categorySlug = String(products[0]?.productType ?? "").trim().toLowerCase();
    const rule = getCategoryRule(categorySlug);
    const schema = ruleToProductTypeSchema(categorySlug || "default", rule);

    const sheet = workbook.addWorksheet("Flipkart Listings", {
      views: [{ state: "frozen", ySplit: 2 }],
    });

    // ── Build column definitions from schema ────────────────────────────────
    const columnDefs = this.buildExcelColumns(schema);
    sheet.columns = columnDefs.map((col) => ({
      header: col.label,
      key: col.key,
      width: col.width,
    }));

    // ── Header row 1 — field labels ─────────────────────────────────────────
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1A73E8" },
    };
    headerRow.alignment = { vertical: "middle", wrapText: true };
    headerRow.height = 30;

    // ── Header row 2 — required/optional hints ──────────────────────────────
    const hintRow = sheet.getRow(2);
    columnDefs.forEach((col, idx) => {
      const cell = hintRow.getCell(idx + 1);
      cell.value = col.required ? "Required" : "Optional";
      cell.font = {
        italic: true,
        size: 9,
        color: { argb: col.required ? "FFCC0000" : "FF666666" },
      };
    });
    hintRow.height = 18;

    // ── Data rows ───────────────────────────────────────────────────────────
    for (const product of products) {
      const rowData = this.buildExcelRow(product, columnDefs);
      const dataRow = sheet.addRow(rowData);
      dataRow.height = 20;
    }

    // ── Add data-validation dropdowns for valid-value columns ───────────────
    // ExcelJS 4.x types don't expose dataValidations on the Worksheet type, but it
    // exists at runtime (confirmed: Object.getPrototypeOf(ws.dataValidations).add).
    const sheetAny = sheet as unknown as Record<string, { add(ref: string, rule: Record<string, unknown>): void }>;
    const dataValidations = sheetAny["dataValidations"];
    if (rule.validValues) {
      for (const [attrKey, allowed] of Object.entries(rule.validValues)) {
        const colKey = `attr_${attrKey}`;
        const colDef = columnDefs.find((c) => c.key === colKey);
        if (colDef) {
          const colIndex = columnDefs.indexOf(colDef) + 1;
          const colLetter = this.columnIndexToLetter(colIndex);
          dataValidations.add(`${colLetter}3:${colLetter}10000`, {
            type: "list",
            allowBlank: true,
            formulae: [`"${allowed.join(",")}"`],
            showDropDown: false,
          });
        }
      }
    }

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const filename = `flipkart_listing_${categorySlug || "general"}_${dateStr}.xlsx`;
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    return {
      buffer,
      filename,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
    const validation = await this.validateProduct(ctx, product);
    if (!validation.isValid) {
      throw new Error(validation.errors.map((issue) => issue.sellerMessage).join(" | "));
    }

    const requestId = this.buildRequestId(ctx, product.sku);
    const endpoint = `${this.resolveApiBaseUrl()}/listings/v3/skus/listings/update`;
    const payload = {
      skuData: [this.buildListingPayload(product)],
    };

    this.logger.info("Flipkart publish request started", {
      installationId: ctx.installationId,
      endpoint,
      sku: product.sku,
    });

    const response = await this.fetchWithTokenRetry(ctx, endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Flipkart-Request-Id": requestId,
      },
      body: JSON.stringify(payload),
    });

    const responseBody = await this.parseJsonResponse<FlipkartPublishResponse>(response);
    this.logger.info("Flipkart publish request completed", {
      installationId: ctx.installationId,
      statusCode: response.status,
      sku: product.sku,
    });

    if (!response.ok) {
      throw new Error(this.describePublishFailure(responseBody, response.status));
    }

    const providerStatus = String(responseBody.status ?? "").trim().toUpperCase();
    if (providerStatus === "FAILURE") {
      throw new Error(this.describePublishFailure(responseBody, response.status));
    }

    return {
      externalRef: String(responseBody.requestId ?? requestId),
      status: "PENDING",
      isAsync: true,
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

    const requestId = this.buildRequestId(ctx, product.sku);
    const endpoint = `${this.resolveApiBaseUrl()}/listings/v3/skus/listings/update`;
    const payload = {
      skuData: [this.buildListingPayload(product)],
    };

    this.logger.info("Flipkart update request started", {
      installationId: ctx.installationId,
      endpoint,
      externalRef,
      sku: product.sku,
    });

    const response = await this.fetchWithTokenRetry(ctx, endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Flipkart-Request-Id": requestId,
      },
      body: JSON.stringify(payload),
    });

    const responseBody = await this.parseJsonResponse<FlipkartPublishResponse>(response);
    this.logger.info("Flipkart update request completed", {
      installationId: ctx.installationId,
      statusCode: response.status,
      externalRef,
      sku: product.sku,
    });

    if (!response.ok) {
      throw new Error(this.describePublishFailure(responseBody, response.status));
    }

    const providerStatus = String(responseBody.status ?? "").trim().toUpperCase();
    if (providerStatus === "FAILURE") {
      throw new Error(this.describePublishFailure(responseBody, response.status));
    }

    return {
      externalRef: String(responseBody.requestId ?? externalRef ?? requestId),
      status: "PENDING",
      isAsync: true,
    };
  }

  async syncSubmissionStatus(
    ctx: ConnectorContext,
    externalRef: string,
  ): Promise<SubmissionStatusUpdate> {
    const lookup = this.parseStatusLookupRef(externalRef);
    if (!lookup.sku) {
      throw new Error("Flipkart status sync requires a SKU lookup reference.");
    }

    const endpoint = `${this.resolveApiBaseUrl()}/listings/v3/skus/${encodeURIComponent(lookup.sku)}/listings`;
    this.logger.info("Flipkart status sync started", {
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
    const responseBody = await this.parseJsonResponse<Record<string, unknown>>(response);
    this.logger.info("Flipkart status sync completed", {
      installationId: ctx.installationId,
      statusCode: response.status,
      externalRef: lookup.externalRef,
      sku: lookup.sku,
    });

    if (!response.ok) {
      throw new Error(`Flipkart status sync failed with status ${response.status}.`);
    }

    const providerStatus = this.extractListingStatus(responseBody);
    const mappedStatus = this.mapProviderStatus(providerStatus);
    return {
      externalRef: lookup.externalRef,
      status: mappedStatus,
      channelErrors:
        mappedStatus === "REJECTED"
          ? [
              this.normaliseError(
                this.extractErrorCode(responseBody),
                this.extractErrorMessage(responseBody, providerStatus),
              ),
            ]
          : [],
      ...(mappedStatus === "PENDING" ? {} : { resolvedAt: new Date() }),
    };
  }

  async refreshAccessToken(ctx: ConnectorContext): Promise<string> {
    const clientId = await this.requireCredential(ctx, "client_id");
    const clientSecret = await this.requireCredential(ctx, "client_secret");
    const refreshToken = await this.requireCredential(ctx, "refresh_token");
    let token: FlipkartTokenResponse;
    try {
      token = await this.exchangeToken(ctx, clientId, clientSecret, {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
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
    await this.persistTokenSet(ctx, token);
    if (!token.access_token) {
      throw new Error("Flipkart token response did not include access_token.");
    }
    return token.access_token;
  }

  private async resolveAccessToken(ctx: ConnectorContext): Promise<string> {
    return ctx.getAccessToken();
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
      signal: AbortSignal.timeout(CONNECTOR_HTTP_TIMEOUT_MS),
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
    await db.connectorCredential.updateMany({
      where: {
        tenantKey: ctx.tenantId,
        installationId: ctx.installationId,
        credentialType: {
          in: ["access_token", "refresh_token", "client_id", "client_secret"],
        },
      },
      data: {
        lastValidatedAt: new Date(),
        failureReason,
        updatedAt: new Date(),
      },
    });
  }

  private async noteCredentialWarning(ctx: ConnectorContext, warningReason: string): Promise<void> {
    const db = this.prismaDirect.getClient();
    await db.connectorCredential.updateMany({
      where: {
        tenantKey: ctx.tenantId,
        installationId: ctx.installationId,
        credentialType: "refresh_token",
      },
      data: {
        failureReason: warningReason,
        updatedAt: new Date(),
      },
    });
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
    const row = await db.connectorCredential.findFirst({
      where: {
        tenantKey: ctx.tenantId,
        installationId: ctx.installationId,
        credentialType,
      },
      select: {
        id: true,
        encryptedValue: true,
        keyVersion: true,
        status: true,
        expiresAt: true,
        failureReason: true,
      },
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

  private resolveOauthBaseUrl(): string {
    return String(
      process.env.PIM_FLIPKART_OAUTH_BASE_URL ??
        process.env.FLIPKART_OAUTH_BASE_URL ??
        DEFAULT_OAUTH_BASE_URL,
    )
      .trim()
      .replace(/\/+$/, "");
  }

  private resolveApiBaseUrl(): string {
    const explicit = String(
      process.env.PIM_FLIPKART_API_BASE_URL ?? process.env.FLIPKART_API_BASE_URL ?? "",
    )
      .trim()
      .replace(/\/+$/, "");
    if (explicit.length > 0) {
      return explicit;
    }
    return `${this.resolveOauthBaseUrl()}/sellers`;
  }

  private buildListingPayload(product: ProductPayload): FlipkartListingPayload {
    const attributes = this.asScalarAttributes(product.attributes);
    const quantity = this.readPositiveInteger(
      attributes.quantity ??
        attributes.inventoryQty ??
        attributes.stockQuantity,
      1,
    );
    const packageWeight = this.readPositiveInteger(
      attributes.packageWeight ?? attributes.weight,
      500,
    );
    const packageLength = this.readPositiveInteger(attributes.packageLength ?? attributes.length, 100);
    const packageBreadth = this.readPositiveInteger(attributes.packageBreadth ?? attributes.width, 80);
    const packageHeight = this.readPositiveInteger(attributes.packageHeight ?? attributes.height, 30);
    const procurementSla = this.readPositiveInteger(attributes.procurementSla, 3);
    const fulfillmentBy = this.readEnumValue(
      attributes.fulfillmentBy,
      ["seller", "flipkart"] as const,
      "seller",
    );
    const procurementType = this.readEnumValue(
      attributes.procurementType,
      ["REGULAR", "LIMITED"] as const,
      "REGULAR",
    );
    const listingStatus = this.readEnumValue(
      attributes.listingStatus,
      ["ACTIVE", "INACTIVE"] as const,
      "ACTIVE",
    );
    const shippingProvider = this.readString(attributes.shippingProvider, "seller-standard");
    const productId = this.readOptionalString(attributes.flipkartProductId ?? attributes.productId);
    const taxCode = this.readOptionalString(attributes.taxCode);

    const images = this.buildImageList(product.mainImageUrl, product.additionalImageUrls);

    return {
      skuId: product.sku,
      ...(productId ? { productId } : {}),
      mrp: Math.round(product.mrp * 100),
      sellingPrice: Math.round(product.sellingPrice * 100),
      listingStatus,
      quantity,
      fulfillmentBy,
      procurementType,
      procurementSla,
      shippingProvider,
      packageWeight,
      packageLength,
      packageBreadth,
      packageHeight,
      ...(product.hsnCode ? { hsn: product.hsnCode } : {}),
      ...(taxCode ? { taxCode } : {}),
      ...(images.length > 0 ? { images } : {}),
      attributes,
    };
  }

  private async fetchWithTokenRetry(
    ctx: ConnectorContext,
    url: string,
    init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> },
  ): Promise<Response> {
    let token = await this.resolveAccessToken(ctx);
    let response = await ctx.fetch!(url, {
      method: init.method as string | undefined,
      body: init.body as string | undefined,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    });
    if (response.status !== 401) {
      return response;
    }

    // 401 means the token was invalidated server-side — expire locally and retry once
    await this.invalidateAccessToken(ctx);
    token = await this.resolveAccessToken(ctx);
    response = await ctx.fetch!(url, {
      method: init.method as string | undefined,
      body: init.body as string | undefined,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    });
    return response;
  }

  private async invalidateAccessToken(ctx: ConnectorContext): Promise<void> {
    const db = this.prismaDirect.getClient();
    await db.connectorCredential.updateMany({
      where: {
        tenantKey: ctx.tenantId,
        installationId: ctx.installationId,
        credentialType: "access_token",
      },
      data: {
        expiresAt: new Date(),
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

  private describePublishFailure(responseBody: FlipkartPublishResponse, statusCode: number): string {
    const firstError = Array.isArray(responseBody.skuErrors) ? responseBody.skuErrors[0] : undefined;
    if (firstError) {
      const issue = this.normaliseError(
        String(firstError.errorCode ?? "UNKNOWN_ERROR"),
        String(firstError.errorMessage ?? "").trim(),
      );
      return issue.sellerMessage;
    }
    return `Flipkart publish failed with status ${statusCode}.`;
  }

  private parseStatusLookupRef(externalRef: string): { externalRef: string; sku: string } {
    const value = String(externalRef ?? "").trim();
    const parts = value.split("::");
    if (parts.length >= 2) {
      return {
        externalRef: parts[0],
        sku: parts[1],
      };
    }
    return {
      externalRef: value,
      sku: "",
    };
  }

  private extractListingStatus(responseBody: Record<string, unknown>): string {
    const directStatus = this.readOptionalString(responseBody.status ?? responseBody.listingStatus);
    if (directStatus) {
      return directStatus.toUpperCase();
    }

    const listings = responseBody.listings;
    if (Array.isArray(listings) && listings.length > 0) {
      const first = listings[0];
      if (first && typeof first === "object" && !Array.isArray(first)) {
        const nestedStatus = this.readOptionalString(
          (first as Record<string, unknown>).status ??
            (first as Record<string, unknown>).listingStatus,
        );
        if (nestedStatus) {
          return nestedStatus.toUpperCase();
        }
      }
    }

    return "PENDING";
  }

  private mapProviderStatus(status: string): SubmissionStatusUpdate["status"] {
    if (status === "ACTIVE") {
      return "SUCCESS";
    }
    if (status === "INACTIVE") {
      return "SUPPRESSED";
    }
    if (status === "BLOCKED") {
      return "REJECTED";
    }
    return "PENDING";
  }

  private extractErrorCode(responseBody: Record<string, unknown>): string {
    const directCode = this.readOptionalString(responseBody.errorCode);
    if (directCode) {
      return directCode.toUpperCase();
    }
    const errors = responseBody.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0];
      if (first && typeof first === "object" && !Array.isArray(first)) {
        const nestedCode = this.readOptionalString((first as Record<string, unknown>).errorCode);
        if (nestedCode) {
          return nestedCode.toUpperCase();
        }
      }
    }
    return "BLOCKED";
  }

  private extractErrorMessage(responseBody: Record<string, unknown>, providerStatus: string): string {
    const directMessage = this.readOptionalString(responseBody.errorMessage ?? responseBody.message);
    if (directMessage) {
      return directMessage;
    }
    const errors = responseBody.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0];
      if (first && typeof first === "object" && !Array.isArray(first)) {
        const nestedMessage = this.readOptionalString(
          (first as Record<string, unknown>).errorMessage ??
            (first as Record<string, unknown>).message,
        );
        if (nestedMessage) {
          return nestedMessage;
        }
      }
    }
    return providerStatus === "BLOCKED"
      ? "Flipkart blocked the listing during status sync."
      : "Flipkart listing status could not be resolved.";
  }

  private buildRequestId(ctx: ConnectorContext, sku: string): string {
    return `${ctx.tenantId}-${ctx.installationId}-${sku}`
      .replace(/[^a-zA-Z0-9-]+/g, "-")
      .slice(0, 120);
  }

  private asScalarAttributes(
    attributes: Record<string, unknown>,
  ): Record<string, string | number | boolean> {
    const scalarAttributes: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(attributes ?? {})) {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        scalarAttributes[key] = value;
      }
    }
    return scalarAttributes;
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
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    return fallback;
  }

  private readOptionalString(value: unknown): string | undefined {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    return undefined;
  }

  private readEnumValue<T extends readonly string[]>(
    value: unknown,
    allowed: T,
    fallback: T[number],
  ): T[number] {
    if (typeof value === "string") {
      const normalized = value.trim();
      if (allowed.includes(normalized as T[number])) {
        return normalized as T[number];
      }
    }
    return fallback;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
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

  // ── Excel export helpers ────────────────────────────────────────────────────

  private buildExcelColumns(
    schema: ReturnType<typeof ruleToProductTypeSchema>,
  ): Array<{ key: string; label: string; required: boolean; width: number; attrKey?: string }> {
    const cols: Array<{ key: string; label: string; required: boolean; width: number; attrKey?: string }> = [
      { key: "sku",         label: "Seller SKU *",          required: true,  width: 22 },
      { key: "title",       label: "Product Title *",        required: true,  width: 40 },
      { key: "brand",       label: "Brand *",                required: true,  width: 18 },
      { key: "description", label: "Description *",          required: true,  width: 50 },
      { key: "mrp",         label: "MRP (paise) *",          required: true,  width: 14 },
      { key: "sellingPrice",label: "Selling Price (paise) *",required: true,  width: 20 },
      { key: "hsnCode",     label: "HSN Code *",             required: true,  width: 14 },
      { key: "mainImageUrl",label: "Main Image URL *",       required: true,  width: 50 },
    ];

    // Dynamically add attribute columns from schema, skip ones already in fixed cols.
    const fixedKeys = new Set(cols.map((c) => c.key));
    for (const fieldPath of [...schema.requiredAttributes, ...schema.optionalAttributes]) {
      if (!fieldPath.startsWith("attributes.")) continue;
      const attrKey = fieldPath.slice("attributes.".length);
      const colKey = `attr_${attrKey}`;
      if (fixedKeys.has(colKey)) continue;
      const isRequired = schema.requiredAttributes.includes(fieldPath);
      cols.push({
        key: colKey,
        label: `${attrKey.charAt(0).toUpperCase()}${attrKey.slice(1).replace(/([A-Z])/g, " $1")}${isRequired ? " *" : ""}`,
        required: isRequired,
        width: 20,
        attrKey,
      });
      fixedKeys.add(colKey);
    }

    cols.push({ key: "additionalImageUrls", label: "Additional Image URLs (comma-separated)", required: false, width: 60 });
    return cols;
  }

  private buildExcelRow(
    product: ProductPayload,
    columns: ReturnType<typeof this.buildExcelColumns>,
  ): Record<string, string | number> {
    const row: Record<string, string | number> = {};
    for (const col of columns) {
      if (col.attrKey !== undefined) {
        const val = product.attributes?.[col.attrKey];
        row[col.key] = val !== undefined && val !== null ? String(val) : "";
      } else {
        switch (col.key) {
          case "sku":         row[col.key] = product.sku; break;
          case "title":       row[col.key] = product.title; break;
          case "brand":       row[col.key] = product.brand; break;
          case "description": row[col.key] = product.description; break;
          case "mrp":         row[col.key] = Math.round(product.mrp * 100); break;
          case "sellingPrice":row[col.key] = Math.round(product.sellingPrice * 100); break;
          case "hsnCode":     row[col.key] = product.hsnCode ?? ""; break;
          case "mainImageUrl":row[col.key] = product.mainImageUrl; break;
          case "additionalImageUrls":
            row[col.key] = Array.isArray(product.additionalImageUrls)
              ? product.additionalImageUrls.join(", ")
              : "";
            break;
          default:            row[col.key] = ""; break;
        }
      }
    }
    return row;
  }

  private columnIndexToLetter(index: number): string {
    let result = "";
    while (index > 0) {
      const remainder = (index - 1) % 26;
      result = String.fromCharCode(65 + remainder) + result;
      index = Math.floor((index - 1) / 26);
    }
    return result;
  }

  private buildImageList(
    mainImageUrl: string,
    additionalImageUrls?: string[],
  ): Array<{ url: string; sequence: number }> {
    const images: Array<{ url: string; sequence: number }> = [];
    const mainTrimmed = typeof mainImageUrl === "string" ? mainImageUrl.trim() : "";
    if (mainTrimmed.length > 0) {
      images.push({ url: mainTrimmed, sequence: 1 });
    }
    if (Array.isArray(additionalImageUrls)) {
      for (const url of additionalImageUrls) {
        const trimmed = typeof url === "string" ? url.trim() : "";
        if (trimmed.length > 0 && images.length < 9) {
          images.push({ url: trimmed, sequence: images.length + 1 });
        }
      }
    }
    return images;
  }
}
