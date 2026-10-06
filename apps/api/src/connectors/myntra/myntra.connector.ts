// apps/api/src/connectors/myntra/myntra.connector.ts
//
// Capabilities: PUBLISH + VALIDATE + STATUS_SYNC
// implementationStatus: partial
//
// Auth scheme is [NEEDS_PARTNER_CONFIRMATION] — the header names below
// (X-Myntra-Merchant-Id + Authorization Bearer) are derived from third-party
// integration guides (Vinculum, Base PPMP) and must be verified against the
// actual Myntra API spec obtained during account-manager kickoff (gate ST-MYNTRA-001).
//
// Base URLs are env-var configurable:
//   PIM_MYNTRA_API_BASE_URL  (e.g. https://api.myntrainfo.com)
//
// Credential storage (ConnectorCredential rows per installationId):
//   credentialType: 'merchant_id'  — plain merchantId
//   credentialType: 'secret_key'   — AES-256-GCM encrypted
//   credentialType: 'warehouse_id' — plain warehouseId

import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../common/logging/logger.service';
import { PrismaDirectService } from '../../prisma/prisma-direct.service';
import { PrismaService } from '../../prisma/prisma.service';
import { tenantDb } from '../../connector-framework/tenant-db';
import {
  decryptCredentialValue,
  loadCredentialEncryptionKeys,
  parseCredentialKeyVersion,
  resolveCurrentCredentialKeyVersion,
} from '../../connector-installer/credential-encryption.util';
import {
  ConnectorCap,
  ConnectorContext,
  ConnectorInterface,
  ConnectorIssue,
  ProductPayload,
  ProductTypeSchema,
  SubmissionRef,
  SubmissionStatusUpdate,
  ValidationResult,
} from '../../connector-framework/connector.interface';
import { getMyntraCategoryRule, ruleToProductTypeSchema } from './myntra-category-rules';

const CONNECTOR_HTTP_TIMEOUT_MS = 30_000;

// [NEEDS_PARTNER_CONFIRMATION] — verify base URL against Myntra developer documentation
// received during account-manager kickoff.
const DEFAULT_API_BASE_URL = 'https://api.myntrainfo.com';

// ─── Listing Management API shapes ────────────────────────────────────────────
// [NEEDS_PARTNER_CONFIRMATION] — payload and response shapes below are indicative;
// replace with exact field names from the Myntra Listing Management Postman collection.

type MyntraListingPayload = {
  styleId: string;
  merchantId: string;
  productName: string;
  brand: string;
  mrp: number;
  sellingPrice: number;
  hsnCode: string;
  description: string;
  warehouseId: string;
  countryOfOrigin: string;
  gender?: string;
  colour?: string;
  size?: string;
  fabric?: string;
  images: Array<{ url: string; position: number }>;
  attributes?: Record<string, string | number | boolean>;
};

type MyntraListingResponse = {
  styleId?: string;
  status?: string;
  message?: string;
  errors?: Array<{ code: string; message: string; field?: string }>;
};

type MyntraStatusResponse = {
  styles?: Array<{
    styleId: string;
    status?: string;
    listingStatus?: 'ACTIVE' | 'INACTIVE' | 'REJECTED' | 'PENDING' | 'BLOCKED';
    rejectionReasons?: Array<{ code: string; message: string }>;
  }>;
  message?: string;
};

// ─── error map ────────────────────────────────────────────────────────────────
// Error codes are indicative — update from real Myntra API responses after onboarding.

const MYNTRA_ERROR_MAP: Record<string, { fieldPath: string; sellerMessage: string; severity: 'error' | 'warning' }> = {
  INVALID_MERCHANT:       { fieldPath: '',              severity: 'error',   sellerMessage: 'Merchant ID is invalid or not authorised. Contact your Myntra account manager.' },
  INVALID_SECRET:         { fieldPath: '',              severity: 'error',   sellerMessage: 'API secret key is invalid. Re-enter the credentials from your Myntra seller panel.' },
  INVALID_WAREHOUSE:      { fieldPath: '',              severity: 'error',   sellerMessage: 'Warehouse ID is invalid or not associated with this merchant account.' },
  STYLE_ALREADY_EXISTS:   { fieldPath: 'sku',           severity: 'warning', sellerMessage: 'A listing with this Style ID already exists on Myntra. The existing listing will be updated.' },
  BRAND_NOT_APPROVED:     { fieldPath: 'brand',         severity: 'error',   sellerMessage: 'Brand is not approved for this Myntra seller account. Contact your account manager to approve the brand.' },
  INVALID_CATEGORY:       { fieldPath: 'productType',   severity: 'error',   sellerMessage: 'Product category is not valid for Myntra. Remap to a supported Myntra category.' },
  IMAGE_QUALITY_FAILED:   { fieldPath: 'mainImageUrl',  severity: 'error',   sellerMessage: 'Image quality does not meet Myntra standards. Use a white background, 1:1 aspect ratio, min 1000×1000px.' },
  PRICE_BELOW_FLOOR:      { fieldPath: 'sellingPrice',  severity: 'error',   sellerMessage: 'Selling price is below Myntra\'s category floor price.' },
  MISSING_REQUIRED_ATTR:  { fieldPath: 'attributes',    severity: 'error',   sellerMessage: 'A required attribute is missing. Check the Myntra category attribute guide.' },
  RATE_LIMIT_EXCEEDED:    { fieldPath: '',              severity: 'error',   sellerMessage: 'Myntra API rate limit exceeded (100 requests/minute). Please retry after a short wait.' },
};

// ─── helper: read attribute string ────────────────────────────────────────────

function strAttr(attrs: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = attrs[key];
    if (v != null && String(v).trim().length > 0) return String(v).trim();
  }
  return '';
}

// ─── connector ────────────────────────────────────────────────────────────────

@Injectable()
export class MyntraConnector implements ConnectorInterface {
  readonly slug = 'myntra';
  readonly displayName = 'Myntra';
  // partial until auth scheme confirmed and integration tested against real sandbox
  readonly implementationStatus = 'partial' as const;
  readonly capabilities: ConnectorCap[] = ['PUBLISH', 'VALIDATE', 'STATUS_SYNC'];

  private readonly keys = loadCredentialEncryptionKeys(process.env);

  constructor(
    private readonly prismaDirect: PrismaDirectService,
    private readonly logger: LoggerService,
    // SEC-DB-RLS-001 M1b: the tenant client for known-tenant reads and writes; optional only so tests that build this by hand are unchanged.
    private readonly prisma?: PrismaService,
  ) {}

  private get apiBaseUrl(): string {
    return (process.env['PIM_MYNTRA_API_BASE_URL'] ?? DEFAULT_API_BASE_URL).replace(/\/$/, '');
  }

  // ─── credential helpers ─────────────────────────────────────────────────────

  private async getPlainCredential(ctx: ConnectorContext, type: string): Promise<string | null> {
    const db = tenantDb(this.prisma, this.prismaDirect, ctx.tenantId);
    const row = await db.connectorCredential.findFirst({
      where: { installationId: ctx.installationId, credentialType: type },
      select: { encryptedValue: true, keyVersion: true },
    });
    if (!row) return null;
    const version = parseCredentialKeyVersion(row.keyVersion ?? 'v1');
    const key = this.keys.get(version);
    if (!key) return null;
    return decryptCredentialValue(row.encryptedValue, key);
  }

  private async resolveCredentials(ctx: ConnectorContext): Promise<{
    merchantId: string;
    secretKey: string;
    warehouseId: string;
  }> {
    const [merchantId, secretKey, warehouseId] = await Promise.all([
      this.getPlainCredential(ctx, 'merchant_id'),
      this.getPlainCredential(ctx, 'secret_key'),
      this.getPlainCredential(ctx, 'warehouse_id'),
    ]);
    if (!merchantId || !secretKey || !warehouseId) {
      throw new Error('Myntra credentials incomplete. Verify merchant_id, secret_key, and warehouse_id are stored.');
    }
    return { merchantId, secretKey, warehouseId };
  }

  // ─── HTTP helper ────────────────────────────────────────────────────────────
  // [NEEDS_PARTNER_CONFIRMATION] — auth header names and token format below are
  // based on third-party integration docs (Vinculum, Base). Confirm with the
  // official Postman collection received during account-manager kickoff.

  private async callApi(
    method: string,
    path: string,
    merchantId: string,
    secretKey: string,
    body?: unknown,
  ): Promise<Response> {
    const url = `${this.apiBaseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONNECTOR_HTTP_TIMEOUT_MS);
    try {
      return await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          // [NEEDS_PARTNER_CONFIRMATION] header names
          'X-Myntra-Merchant-Id': merchantId,
          'Authorization': `Bearer ${secretKey}`,
        },
        body: body != null ? JSON.stringify(body) : undefined,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ─── required: validateCredentials ──────────────────────────────────────────

  async validateCredentials(ctx: ConnectorContext): Promise<boolean> {
    try {
      const { merchantId, secretKey } = await this.resolveCredentials(ctx);
      // [NEEDS_PARTNER_CONFIRMATION] — replace with the confirmed safe read endpoint
      // (e.g. listing-status with a known-invalid styleId returns 404, not 401/403).
      const res = await this.callApi('GET', '/listing-api/v2/health', merchantId, secretKey);
      if (res.status === 401 || res.status === 403) {
        this.logger.warn('Myntra credential validation failed: auth rejected', {
          installationId: ctx.installationId,
          status: res.status,
        });
        return false;
      }
      this.logger.info('Myntra credentials validated', { installationId: ctx.installationId });
      return true;
    } catch (err) {
      this.logger.warn('Myntra credential validation error', {
        installationId: ctx.installationId,
        reason: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  // ─── optional: verifyCandidateCredentials ───────────────────────────────────
  //
  // Pure — takes the candidate merchantId/secretKey directly, never reads or
  // writes stored credentials. Same health-endpoint shape as validateCredentials.
  // Classification: 401/403 → invalid; any network/timeout failure → unavailable
  // (Myntra's endpoint isn't operator-supplied, so no network failure there is
  // deterministic evidence against the candidate).
  //
  // warehouse_id is not exercised by this call (see storeCredential's `health`
  // param at the call site) — it's not part of the auth header.

  async verifyCandidateCredentials(
    candidate: Record<string, string>,
  ): Promise<import('../../connector-framework/connector.interface').CredentialVerificationResult> {
    const merchantId = String(candidate.merchant_id ?? '').trim();
    const secretKey = String(candidate.secret_key ?? '').trim();

    try {
      const res = await this.callApi('GET', '/listing-api/v2/health', merchantId, secretKey);
      if (res.status === 401 || res.status === 403) {
        return { outcome: 'invalid', reasonCode: 'MYNTRA_CREDENTIALS_REJECTED' };
      }
      if (!res.ok) {
        return { outcome: 'unavailable', reasonCode: `HTTP_${res.status}` };
      }
      return { outcome: 'valid' };
    } catch {
      return { outcome: 'unavailable', reasonCode: 'UNKNOWN_NETWORK_ERROR' };
    }
  }

  // ─── ADR-0008 §1 bridge ───────────────────────────────────────────────────────

  async fetchProductTypeSchema(
    _ctx: ConnectorContext,
    productType: string,
  ): Promise<ProductTypeSchema> {
    return ruleToProductTypeSchema(getMyntraCategoryRule(productType));
  }

  // ─── required: validateProduct ───────────────────────────────────────────────

  async validateProduct(
    _ctx: ConnectorContext,
    product: ProductPayload,
  ): Promise<ValidationResult> {
    const errors: ConnectorIssue[] = [];
    const warnings: ConnectorIssue[] = [];

    const categorySlug = String(product.productType ?? '').trim().toLowerCase();
    const rule = getMyntraCategoryRule(categorySlug);
    const attrs: Record<string, unknown> = product.attributes ?? {};
    const productRoot = product as unknown as Record<string, unknown>;

    // ── Category field rules ──────────────────────────────────────────────────
    for (const field of rule.fields) {
      let value: string;
      if (field.fieldPath.startsWith('attributes.')) {
        const attrKey = field.fieldPath.replace(/^attributes\./, '');
        value = strAttr(attrs, attrKey);
      } else {
        const v = productRoot[field.fieldPath];
        value = v != null ? String(v).trim() : '';
      }

      if (!value) {
        if (field.required) {
          errors.push({
            code: `REQUIRED_FIELD_${field.fieldPath.replace(/\./g, '_').toUpperCase()}`,
            fieldPath: field.fieldPath,
            sellerMessage: field.sellerMessage,
            severity: 'error',
          });
        } else {
          warnings.push({
            code: `RECOMMENDED_FIELD_${field.fieldPath.replace(/\./g, '_').toUpperCase()}`,
            fieldPath: field.fieldPath,
            sellerMessage: field.sellerMessage,
            severity: 'warning',
          });
        }
        continue;
      }

      if (field.maxLength != null && value.length > field.maxLength) {
        errors.push({
          code: 'FIELD_TOO_LONG',
          fieldPath: field.fieldPath,
          sellerMessage: `${field.label} exceeds ${field.maxLength} characters.`,
          severity: 'error',
        });
      }

      if (field.allowedValues != null && !field.allowedValues.includes(value)) {
        warnings.push({
          code: 'ATTRIBUTE_VALUE_NOT_ALLOWED',
          fieldPath: field.fieldPath,
          sellerMessage: `"${value}" is not in Myntra's accepted values for ${field.label}. Accepted: ${field.allowedValues.slice(0, 6).join(', ')}…`,
          severity: 'warning',
        });
      }
    }

    // ── HSN code format ────────────────────────────────────────────────────────
    if (product.hsnCode && !/^\d{6,8}$/.test(product.hsnCode.trim())) {
      errors.push({
        code: 'HSN_INVALID',
        fieldPath: 'hsnCode',
        sellerMessage: 'HSN code must be 6–8 digits.',
        severity: 'error',
      });
    }

    // ── MRP > selling price ────────────────────────────────────────────────────
    if (
      typeof product.mrp === 'number' &&
      typeof product.sellingPrice === 'number' &&
      product.sellingPrice > product.mrp
    ) {
      errors.push({
        code: 'SELLING_PRICE_EXCEEDS_MRP',
        fieldPath: 'sellingPrice',
        sellerMessage: 'Selling price cannot exceed MRP.',
        severity: 'error',
      });
    }

    // ── Image HTTPS ────────────────────────────────────────────────────────────
    const imgUrl = typeof product.mainImageUrl === 'string' ? product.mainImageUrl.trim() : '';
    if (imgUrl.length > 0 && !imgUrl.startsWith('https://')) {
      errors.push({
        code: 'IMAGE_URL_NOT_HTTPS',
        fieldPath: 'mainImageUrl',
        sellerMessage: 'Myntra requires a permanent HTTPS URL for the primary product image.',
        severity: 'error',
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      source: 'LOCAL_RULES',
    };
  }

  // ─── required: normaliseError ────────────────────────────────────────────────

  normaliseError(errorCode: string, rawMessage: string): ConnectorIssue {
    const mapped = MYNTRA_ERROR_MAP[errorCode];
    if (mapped) {
      return {
        code: errorCode,
        fieldPath: mapped.fieldPath,
        sellerMessage: mapped.sellerMessage,
        severity: mapped.severity,
      };
    }
    return {
      code: errorCode,
      fieldPath: '',
      sellerMessage: rawMessage || `Myntra returned error: ${errorCode}`,
      severity: 'error',
    };
  }

  // ─── optional: publishProduct ────────────────────────────────────────────────
  // [NEEDS_PARTNER_CONFIRMATION] — endpoint path, payload field names, and response
  // shape must be confirmed from the Listing Management Postman collection.

  async publishProduct(ctx: ConnectorContext, product: ProductPayload): Promise<SubmissionRef> {
    const { merchantId, secretKey, warehouseId } = await this.resolveCredentials(ctx);
    const attrs: Record<string, unknown> = product.attributes ?? {};

    const images = [product.mainImageUrl, ...(product.additionalImageUrls ?? [])]
      .filter((u) => typeof u === 'string' && u.trim().length > 0)
      .map((url, idx) => ({ url: url as string, position: idx + 1 }));

    const payload: MyntraListingPayload = {
      styleId: product.sku,
      merchantId,
      productName: product.title,
      brand: product.brand,
      mrp: product.mrp,
      sellingPrice: product.sellingPrice,
      hsnCode: product.hsnCode,
      description: product.description,
      warehouseId,
      countryOfOrigin: product.countryOfOrigin ?? 'India',
      gender: strAttr(attrs, 'gender') || undefined,
      colour: strAttr(attrs, 'colour', 'color') || undefined,
      size: strAttr(attrs, 'size') || undefined,
      fabric: strAttr(attrs, 'fabric', 'material') || undefined,
      images,
      attributes: Object.fromEntries(
        Object.entries(attrs)
          .filter(([, v]) => v != null)
          .map(([k, v]) => [k, String(v)]),
      ),
    };

    // [NEEDS_PARTNER_CONFIRMATION] — endpoint path
    const res = await this.callApi('POST', '/listing-api/v2/listing', merchantId, secretKey, payload);
    const body = await res.json().catch(() => ({})) as MyntraListingResponse;

    if (!res.ok) {
      const firstError = (body.errors ?? [])[0];
      const code = firstError?.code ?? `HTTP_${res.status}`;
      throw new Error(this.normaliseError(code, firstError?.message ?? body.message ?? '').sellerMessage);
    }

    this.logger.info('Myntra listing created', {
      installationId: ctx.installationId,
      sku: product.sku,
      externalRef: body.styleId ?? product.sku,
    });

    return {
      externalRef: body.styleId ?? product.sku,
      status: body.status === 'ACTIVE' ? 'SUCCESS' : 'PENDING',
      isAsync: true,
    };
  }

  // ─── optional: syncSubmissionStatus ─────────────────────────────────────────
  // [NEEDS_PARTNER_CONFIRMATION] — endpoint path and status field names.

  async syncSubmissionStatus(
    ctx: ConnectorContext,
    externalRef: string,
  ): Promise<SubmissionStatusUpdate> {
    const { merchantId, secretKey } = await this.resolveCredentials(ctx);
    // [NEEDS_PARTNER_CONFIRMATION] — endpoint path
    const res = await this.callApi(
      'GET',
      `/listing-api/v2/listing-status?styleIds=${encodeURIComponent(externalRef)}`,
      merchantId,
      secretKey,
    );
    const body = await res.json().catch(() => ({})) as MyntraStatusResponse;

    const style = (body.styles ?? [])[0];
    const channelErrors: ConnectorIssue[] = (style?.rejectionReasons ?? []).map((r) =>
      this.normaliseError(r.code, r.message),
    );

    const statusMap: Record<string, SubmissionStatusUpdate['status']> = {
      ACTIVE: 'SUCCESS',
      INACTIVE: 'SUPPRESSED',
      REJECTED: 'REJECTED',
      BLOCKED: 'REJECTED',
      PENDING: 'PENDING',
    };
    const status = statusMap[style?.listingStatus ?? ''] ?? 'PENDING';

    return {
      externalRef,
      status,
      channelErrors,
      resolvedAt: status !== 'PENDING' ? new Date() : undefined,
    };
  }
}
