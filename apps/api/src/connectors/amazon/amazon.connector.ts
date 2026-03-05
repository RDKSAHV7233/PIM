// apps/api/src/connectors/amazon/amazon.connector.ts
// Phase 5-S2: stub only — validateCredentials, validateProduct, normaliseError safe defaults
// Phase 5-S3: implement OAuth + live validation (requires Amazon Developer App approval)
// Phase 5-S4: implement publishProduct (requires sandbox credentials + R&D — see RD_CONNECTORS.md)
// Phase 5-S5: implement parseWebhookEvent (requires webhook subscription R&D)

import { Injectable } from '@nestjs/common';
import {
  ConnectorInterface,
  ConnectorCap,
  ConnectorContext,
  ConnectorIssue,
  ExportFile,
  ParsedWebhookEvent,
  ProductPayload,
  ProductTypeSchema,
  SubmissionRef,
  SubmissionStatusUpdate,
  ValidationResult,
} from '../../connector-framework/connector.interface';

@Injectable()
export class AmazonConnector implements ConnectorInterface {
  readonly slug = 'amazon-in';
  readonly displayName = 'Amazon India';
  readonly capabilities: ConnectorCap[] = [
    'PUBLISH',
    'VALIDATE',
    'STATUS_SYNC',
    'WEBHOOK_RECEIVE',
  ];

  // ── P5-S2: required stubs (safe defaults) ───────────────────────────

  async validateCredentials(ctx: ConnectorContext): Promise<boolean> {
    // TODO P5-S3: call LWA token validate endpoint
    // See RD_CONNECTORS.md §Amazon.1 — requires Developer App credentials
    return true;
  }

  async validateProduct(
    ctx: ConnectorContext,
    product: ProductPayload,
  ): Promise<ValidationResult> {
    // TODO P5-S3: call SP-API VALIDATION_PREVIEW
    // PUT /listings/2021-08-01/items/{sellerId}/{sku}?mode=VALIDATION_PREVIEW&marketplaceIds=A21TJRUUN4KGV
    // See RD_CONNECTORS.md §Amazon.2
    return {
      isValid: true,
      errors: [],
      warnings: [],
      source: 'LOCAL_RULES',
    };
  }

  normaliseError(errorCode: string, rawMessage: string): ConnectorIssue {
    // TODO P5-S3: map Amazon SP-API error codes to seller-readable messages
    // See RD_CONNECTORS.md §Amazon.3 for known error code catalogue
    return {
      code: errorCode,
      fieldPath: '',
      sellerMessage: rawMessage,
      severity: 'error',
    };
  }

  // ── P5-S3: OAuth ────────────────────────────────────────────────────

  async handleOAuthCallback(
    ctx: ConnectorContext,
    params: Record<string, string>,
  ): Promise<void> {
    // TODO P5-S3: implement LWA code exchange
    // CSRF: verify state param is signed token tied to tenantId
    // Endpoint: https://api.amazon.com/auth/o2/token
    // Scopes: sellingpartnerapi::catalog_items_2022-04-01 sellingpartnerapi::listings_items_2021-08-01
    // Store encrypted refreshToken in ConnectorCredential — NEVER store accessToken in DB
    throw new Error('Not implemented — requires Amazon Developer App credentials (P5-S3)');
  }

  // ── P5-S3: Live validation ───────────────────────────────────────────

  async fetchProductTypeSchema(
    ctx: ConnectorContext,
    productType: string,
  ): Promise<ProductTypeSchema> {
    // TODO P5-S3: GET /definitions/productTypes/2022-04-01/productTypes/{productType}
    // See RD_CONNECTORS.md §Amazon.4
    throw new Error('Not implemented (P5-S3)');
  }

  // ── P5-S4: Live publish ──────────────────────────────────────────────

  async publishProduct(
    ctx: ConnectorContext,
    product: ProductPayload,
  ): Promise<SubmissionRef> {
    // TODO P5-S4: PUT /listings/2021-08-01/items/{sellerId}/{sku}
    // CRITICAL: Amazon 202 = PENDING (async). Do NOT mark SUCCESS on 202.
    // isAsync: true — wait for webhook for final status
    // See RD_CONNECTORS.md §Amazon.5 for payload shape and attribute mapping
    throw new Error('Not implemented — requires sandbox credentials (P5-S4)');
  }

  async updateProduct(
    ctx: ConnectorContext,
    product: ProductPayload,
    externalRef: string,
  ): Promise<SubmissionRef> {
    // TODO P5-S4: same endpoint as publish — idempotent PUT
    throw new Error('Not implemented (P5-S4)');
  }

  // ── P5-S5: Webhooks ─────────────────────────────────────────────────

  async parseWebhookEvent(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<ParsedWebhookEvent | null> {
    // TODO P5-S5: verify HMAC-SHA256 signature using Amazon Developer Console client secret
    // Header: x-amz-sns-message-type, x-amzn-RequestId
    // Return null if signature invalid (caller returns 403)
    // See RD_CONNECTORS.md §Amazon.6 for notification payload structure
    throw new Error('Not implemented (P5-S5)');
  }

  async syncSubmissionStatus(
    ctx: ConnectorContext,
    externalRef: string,
  ): Promise<SubmissionStatusUpdate> {
    // TODO P5-S4: GET /listings/2021-08-01/items/{sellerId}/{sku}/issues
    // Amazon prefers webhooks — this is a fallback polling path
    throw new Error('Not implemented (P5-S4)');
  }
}
