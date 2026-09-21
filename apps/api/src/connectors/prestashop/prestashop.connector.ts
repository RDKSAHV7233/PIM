// apps/api/src/connectors/prestashop/prestashop.connector.ts
//
// Capabilities: PUBLISH + VALIDATE + STATUS_SYNC
// implementationStatus: full
//
// Auth: PrestaShop's Webservice API (XML over REST) — HTTP Basic auth with
// the webservice key as the username and an empty password. That's
// PrestaShop's own convention, not a simplification here.
//
// Credential storage (ConnectorCredential rows per installationId):
//   credentialType: 'store_url'  — e.g. https://shop.example.com (HTTPS
//                                  required, matching the WooCommerce/Odoo
//                                  convention of never sending a webservice
//                                  key over plaintext HTTP)
//   credentialType: 'api_key'    — the PrestaShop Webservice key (Advanced
//                                  Parameters > Webservice)
//   credentialType: 'lang_id'    — PrestaShop language id used for
//                                  name/description/link_rewrite; defaults
//                                  to "1" if not stored
//
// Real bugs found porting the Python prototype (verified live 2026-09-19
// against a real PrestaShop 9.1.5 instance — see sandbox-credentials/prestashop.md):
//   - normaliseError()'s original code table (47/84/83) does not reproduce on
//     9.1.5 at all. The real codes are 41 (missing required field) and 85
//     (invalid field value); 3 and 127 are PrestaShop's own generic
//     PHP-warning/XML-parse-failure wrappers, not product-specific.
//   - publishProduct/updateProduct never actually parsed PrestaShop's XML
//     <errors><error><code>/<message> envelope in the prototype — every
//     failure fell through to a hardcoded placeholder code regardless of
//     what the table said. Fixed here via toPublishError() from the start.
//   - PrestaShop's webservice enforces neither reference (SKU) uniqueness
//     nor the id_category_default foreign key — both are silently accepted
//     with HTTP 201 (verified live). validateProduct() below adds proactive
//     live checks for both, since PrestaShop itself won't catch them.
//   - The webservice key needs `categories` (and ideally `languages`) View
//     permission in addition to `products` for the category-existence check
//     to work — a real seller's key will need the same scope added; worth
//     calling out during onboarding.

import { Injectable } from "@nestjs/common";
import { LoggerService } from "../../common/logging/logger.service";
import {
  decryptCredentialValue,
  parseCredentialKeyVersion,
  loadCredentialEncryptionKeys,
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
const DEFAULT_LANG_ID = "1";
const DEFAULT_CATEGORY_ID = "2";

type ResolvedCredentials = { storeUrl: string; apiKey: string; langId: string };

// Revalidated 2026-09-19 against a real PrestaShop 9.1.5 Webservice — see the
// file header for what each code actually reproduces.
const ERROR_MESSAGES: Record<string, string> = {
  "41": "A required field is missing. Check the XML payload against PrestaShop's product schema.",
  "85": "PrestaShop rejected a field value as invalid (see message for which property).",
  "127": "PrestaShop could not parse the request XML.",
  "3": "PrestaShop returned an internal error while processing the request. Check for missing required fields.",
};

export class PrestaShopPublishError extends Error {
  constructor(
    public readonly issues: ConnectorIssue[],
    message: string,
  ) {
    super(message);
    this.name = "PrestaShopPublishError";
  }
}

function slugify(value: string): string {
  return (
    String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "product"
  );
}

function escapeXml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeStoreUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

@Injectable()
export class PrestaShopConnector implements ConnectorInterface {
  readonly slug = "prestashop";
  readonly displayName = "PrestaShop";
  readonly capabilities: ConnectorCap[] = ["PUBLISH", "VALIDATE", "STATUS_SYNC"];
  readonly implementationStatus: ConnectorImplementationStatus = "full";

  private readonly keys = loadCredentialEncryptionKeys(process.env);

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
    const [storeUrl, apiKey, langId] = await Promise.all([
      this.getPlainCredential(ctx, "store_url"),
      this.getPlainCredential(ctx, "api_key"),
      this.getPlainCredential(ctx, "lang_id"),
    ]);
    if (!storeUrl || !apiKey) {
      throw new Error("PrestaShop credentials incomplete. Verify store_url and api_key are stored.");
    }
    return { storeUrl: normalizeStoreUrl(storeUrl), apiKey, langId: langId?.trim() || DEFAULT_LANG_ID };
  }

  private buildAuthHeader(apiKey: string): string {
    return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, { ...init, signal: AbortSignal.timeout(CONNECTOR_HTTP_TIMEOUT_MS) });
  }

  // ─── required: validateCredentials ───────────────────────────────────────

  async validateCredentials(ctx: ConnectorContext): Promise<boolean> {
    const result = await this.validateStoredCredentialsDetailed(ctx);
    return result.outcome === "valid";
  }

  async validateStoredCredentialsDetailed(ctx: ConnectorContext): Promise<CredentialVerificationResult> {
    try {
      const { storeUrl, apiKey } = await this.resolveCredentials(ctx);
      if (!storeUrl.startsWith("https://")) {
        return { outcome: "invalid", reasonCode: "PRESTASHOP_URL_NOT_HTTPS" };
      }
      const response = await this.fetchWithTimeout(`${storeUrl}/api/`, {
        headers: { Authorization: this.buildAuthHeader(apiKey) },
      });
      if (response.status === 401 || response.status === 403) {
        return { outcome: "invalid", reasonCode: `HTTP_${response.status}` };
      }
      if (!response.ok) {
        return { outcome: "unavailable", reasonCode: `HTTP_${response.status}` };
      }
      return { outcome: "valid" };
    } catch (error) {
      this.logger.warn("PrestaShop credential validation failed", {
        installationId: ctx.installationId,
        reason: error instanceof Error ? error.message : String(error),
      });
      return { outcome: "unavailable", reasonCode: "UNKNOWN_NETWORK_ERROR" };
    }
  }

  // ─── optional: verifyCandidateCredentials ───────────────────────────────

  async verifyCandidateCredentials(candidate: Record<string, string>): Promise<CredentialVerificationResult> {
    const storeUrl = normalizeStoreUrl(String(candidate.store_url ?? "").trim());
    const apiKey = String(candidate.api_key ?? "").trim();
    if (!storeUrl.startsWith("https://")) {
      return { outcome: "invalid", reasonCode: "PRESTASHOP_URL_NOT_HTTPS" };
    }
    try {
      const response = await this.fetchWithTimeout(`${storeUrl}/api/`, {
        headers: { Authorization: this.buildAuthHeader(apiKey) },
      });
      if (response.status === 401 || response.status === 403) {
        return { outcome: "invalid", reasonCode: `HTTP_${response.status}` };
      }
      if (!response.ok) {
        return { outcome: "unavailable", reasonCode: `HTTP_${response.status}` };
      }
      return { outcome: "valid" };
    } catch {
      return { outcome: "unavailable", reasonCode: "UNKNOWN_NETWORK_ERROR" };
    }
  }

  // ─── required: validateProduct ───────────────────────────────────────────
  //
  // PrestaShop's webservice enforces neither reference uniqueness nor the
  // id_category_default foreign key (verified live on 9.1.5 — both silently
  // accepted with HTTP 201). The two existence-checks below exist because
  // PrestaShop itself won't catch them — still LOCAL_RULES, not a dedicated
  // live-preview mode like Amazon's.

  async validateProduct(ctx: ConnectorContext, product: ProductPayload): Promise<ValidationResult> {
    const errors: ConnectorIssue[] = [];
    const warnings: ConnectorIssue[] = [];
    const attrs = product.attributes ?? {};

    if (!product.title || String(product.title).trim().length === 0) {
      errors.push({ code: "MISSING_NAME", fieldPath: "title", sellerMessage: "Product name is required for PrestaShop.", severity: "error" });
    } else if (product.title.length > 128) {
      errors.push({ code: "NAME_TOO_LONG", fieldPath: "title", sellerMessage: "PrestaShop product names must be 128 characters or fewer.", severity: "error" });
    }
    if (product.sellingPrice == null || product.sellingPrice < 0) {
      errors.push({ code: "MISSING_PRICE", fieldPath: "sellingPrice", sellerMessage: "price (tax excl.) must be a non-negative number.", severity: "error" });
    }

    const categoryId = attrs["prestashop_category_id"];
    if (!categoryId) {
      errors.push({
        code: "MISSING_CATEGORY",
        fieldPath: "attributes.prestashop_category_id",
        sellerMessage: "Set attributes.prestashop_category_id so the product lands in the right category.",
        severity: "error",
      });
    } else if (!(await this.categoryExists(ctx, categoryId))) {
      errors.push({
        code: "CATEGORY_NOT_FOUND",
        fieldPath: "attributes.prestashop_category_id",
        sellerMessage: `Category id ${categoryId} does not exist in this PrestaShop shop.`,
        severity: "error",
      });
    }

    if (product.sku && (await this.referenceExists(ctx, product.sku))) {
      warnings.push({
        code: "DUPLICATE_REFERENCE_RISK",
        fieldPath: "sku",
        sellerMessage:
          "A product with this reference already exists in PrestaShop. Publishing will create a duplicate rather than fail, since PrestaShop's webservice does not enforce reference uniqueness. If this is meant to update the existing product, use update instead.",
        severity: "warning",
      });
    }

    return { isValid: errors.length === 0, errors, warnings, source: "LOCAL_RULES" };
  }

  private async categoryExists(ctx: ConnectorContext, categoryId: unknown): Promise<boolean> {
    try {
      const { storeUrl, apiKey } = await this.resolveCredentials(ctx);
      const response = await this.fetchWithTimeout(`${storeUrl}/api/categories/${categoryId}`, {
        headers: { Authorization: this.buildAuthHeader(apiKey) },
      });
      return response.ok;
    } catch {
      // Can't reach the API right now — don't block validation on a network
      // blip; the live publish call surfaces a real error if it still matters.
      return true;
    }
  }

  private async referenceExists(ctx: ConnectorContext, reference: string): Promise<boolean> {
    try {
      const { storeUrl, apiKey } = await this.resolveCredentials(ctx);
      const url = `${storeUrl}/api/products?filter[reference]=${encodeURIComponent(`[${reference}]`)}&output_format=JSON`;
      const response = await this.fetchWithTimeout(url, { headers: { Authorization: this.buildAuthHeader(apiKey) } });
      if (!response.ok) {
        return false;
      }
      const data = await this.parseJsonResponse<unknown>(response);
      // A match returns {"products": [...]}; no match returns a bare [] — not
      // {"products": []} — so this must check for a truthy products array,
      // not just presence of the key.
      const products = data && typeof data === "object" ? (data as Record<string, unknown>)["products"] : undefined;
      return Array.isArray(products) && products.length > 0;
    } catch {
      return false;
    }
  }

  // ─── build_payload equivalent ─────────────────────────────────────────────

  // externalRef is required for PUT (update) — verified live against a real
  // PrestaShop 9.1.5 instance 2026-09-21: omitting <id> from the body (only
  // having it in the URL) fails with "id is required when modifying a
  // resource". Create (POST) must NOT send an id — PrestaShop assigns one.
  private buildProductXml(product: ProductPayload, langId: string, externalRef?: string): string {
    const categoryId = (product.attributes ?? {})["prestashop_category_id"] ?? DEFAULT_CATEGORY_ID;
    const name = escapeXml(product.title);
    const description = escapeXml(product.description || product.title);
    const reference = escapeXml(product.sku);
    return (
      "<prestashop>" +
      "<product>" +
      (externalRef ? `<id>${escapeXml(externalRef)}</id>` : "") +
      `<id_category_default>${categoryId}</id_category_default>` +
      "<active>1</active>" +
      "<show_price>1</show_price>" +
      `<price>${product.sellingPrice ?? 0}</price>` +
      `<reference>${reference}</reference>` +
      `<name><language id="${langId}">${name}</language></name>` +
      `<link_rewrite><language id="${langId}">${slugify(product.title)}</language></link_rewrite>` +
      `<description><language id="${langId}">${description}</language></description>` +
      `<associations><categories><category><id>${categoryId}</id></category></categories></associations>` +
      "</product>" +
      "</prestashop>"
    );
  }

  // ─── optional: publishProduct ────────────────────────────────────────────

  async publishProduct(ctx: ConnectorContext, product: ProductPayload): Promise<SubmissionRef> {
    const { storeUrl, apiKey, langId } = await this.resolveCredentials(ctx);
    const response = await this.fetchWithTimeout(`${storeUrl}/api/products`, {
      method: "POST",
      headers: { Authorization: this.buildAuthHeader(apiKey), "Content-Type": "application/xml" },
      body: this.buildProductXml(product, langId),
    });
    const text = await response.text();
    if (response.status !== 200 && response.status !== 201) {
      throw this.toPublishError(text, response.status);
    }
    const match = text.match(/<id><!\[CDATA\[(\d+)\]\]><\/id>|<id>(\d+)<\/id>/);
    const externalRef = match ? match[1] ?? match[2] : product.sku;
    return { externalRef: String(externalRef), status: "SUCCESS", isAsync: false };
  }

  // ─── optional: updateProduct ─────────────────────────────────────────────

  async updateProduct(ctx: ConnectorContext, product: ProductPayload, externalRef: string): Promise<SubmissionRef> {
    const { storeUrl, apiKey, langId } = await this.resolveCredentials(ctx);
    const response = await this.fetchWithTimeout(`${storeUrl}/api/products/${externalRef}`, {
      method: "PUT",
      headers: { Authorization: this.buildAuthHeader(apiKey), "Content-Type": "application/xml" },
      body: this.buildProductXml(product, langId, externalRef),
    });
    const text = await response.text();
    if (response.status !== 200) {
      throw this.toPublishError(text, response.status);
    }
    return { externalRef, status: "SUCCESS", isAsync: false };
  }

  // ─── optional: syncSubmissionStatus ──────────────────────────────────────

  async syncSubmissionStatus(ctx: ConnectorContext, externalRef: string): Promise<SubmissionStatusUpdate> {
    const { storeUrl, apiKey } = await this.resolveCredentials(ctx);
    const response = await this.fetchWithTimeout(`${storeUrl}/api/products/${externalRef}`, {
      headers: { Authorization: this.buildAuthHeader(apiKey) },
    });
    if (response.status === 404) {
      return {
        externalRef,
        status: "ERROR",
        channelErrors: [{ code: "PRODUCT_NOT_FOUND", fieldPath: "", sellerMessage: "Product not found in PrestaShop.", severity: "error" }],
      };
    }
    const text = await response.text();
    if (!response.ok) {
      return { externalRef, status: "ERROR", channelErrors: [this.normaliseError("UNKNOWN_ERROR", text.slice(0, 300))] };
    }
    const active = text.includes("<active><![CDATA[1]]></active>") || text.includes("<active>1</active>");
    return { externalRef, status: active ? "SUCCESS" : "SUPPRESSED", channelErrors: [], resolvedAt: new Date() };
  }

  // ─── required: normaliseError ────────────────────────────────────────────

  normaliseError(errorCode: string, rawMessage: string): ConnectorIssue {
    const normalizedCode = String(errorCode ?? "").trim();
    const sellerMessage =
      ERROR_MESSAGES[normalizedCode] ?? (String(rawMessage ?? "").trim() || `PrestaShop returned an error: ${normalizedCode || "UNKNOWN"}.`);
    return { code: normalizedCode || "PRESTASHOP_ERROR", fieldPath: "", sellerMessage, severity: "error" };
  }

  // ─── error envelope parsing ───────────────────────────────────────────────
  //
  // PrestaShop's webservice always wraps failures as
  // <errors><error><code>N</code><message>...</message></error></errors>.
  // A fully malformed XML body returns several stacked <error> blocks (PHP
  // warnings followed by an XML-parse failure); taking the first match means
  // that specific scenario surfaces as the PHP-warning code, not the
  // XML-parse one — both map to a reasonable message either way.

  private toPublishError(responseText: string, statusCode: number): PrestaShopPublishError {
    const codeMatch = responseText.match(/<code><!\[CDATA\[(\d+)\]\]><\/code>|<code>(\d+)<\/code>/);
    const code = codeMatch ? codeMatch[1] ?? codeMatch[2] : "PRESTASHOP_ERROR";
    const messageMatch = responseText.match(/<message><!\[CDATA\[([\s\S]*?)\]\]><\/message>|<message>([\s\S]*?)<\/message>/);
    const message = messageMatch ? messageMatch[1] ?? messageMatch[2] : responseText;
    const issue = this.normaliseError(code, (message ?? "").slice(0, 300));
    return new PrestaShopPublishError([issue], `PrestaShop request failed with status ${statusCode}: ${issue.sellerMessage}`);
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
}
