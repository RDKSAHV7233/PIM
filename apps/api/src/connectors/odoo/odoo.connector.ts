// apps/api/src/connectors/odoo/odoo.connector.ts
//
// Capabilities: PUBLISH + VALIDATE + STATUS_SYNC
// implementationStatus: full
//
// Auth: Odoo's JSON-RPC EXTERNAL API — the "common"/"object" services at
// POST {odoo_url}/jsonrpc — NOT /web/session/authenticate or
// /web/dataset/call_kw (the interactive web-login family). This distinction
// is load-bearing: /web/session/authenticate only ever accepts a real user
// password. Odoo's own source (res_users.py _check_credentials) defaults
// `interactive` to True on that path, and only the non-interactive branch
// checks res.users.apikeys — so an Odoo API key (the credential type Odoo
// itself recommends for integrations) is silently rejected by the
// interactive endpoint with AccessDenied, even though the key is valid.
// Verified directly against a real Odoo 17 instance: the same API key that
// /web/session/authenticate rejects is accepted by /jsonrpc's
// common.authenticate.
//
// Odoo's /jsonrpc always answers HTTP 200 — failures come back as a
// `{jsonrpc, id, error: {...}}` body, never as an HTTP error status. Every
// call here must inspect the parsed body's `error` key, not `res.status`.
//
// Credential storage (ConnectorCredential rows per installationId):
//   credentialType: 'odoo_url'   — e.g. https://odoo.example.com (HTTPS required)
//   credentialType: 'database'   — the Odoo database name (e.g. "odoo")
//   credentialType: 'username'   — the Odoo login (e.g. "admin")
//   credentialType: 'password'   — a real user password OR an Odoo API key;
//                                  both authenticate via common.authenticate.
//
// build_payload() field notes (each verified live against a real Odoo 17,
// Sales app installed, no Inventory app):
//   detailed_type — "consu" (Consumable) is the only stock product.template
//     type available without the Inventory app. "product" (storable) was
//     removed as a value in Odoo 17 — sending it is rejected with
//     `Wrong value for product.template.detailed_type: 'product'`.
//   brand — no generic brand field exists on stock product.template. A
//     brand attribute (e.g. "x_brand") is a Studio/custom field that must be
//     created per Odoo instance before it can be sent; omitted here rather
//     than guessing a field name that won't exist on a fresh install.

import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../common/logging/logger.service';
import { PrismaDirectService } from '../../prisma/prisma-direct.service';
import {
  decryptCredentialValue,
  parseCredentialKeyVersion,
  loadCredentialEncryptionKeys,
} from '../../connector-installer/credential-encryption.util';
import {
  ConnectorCap,
  ConnectorContext,
  ConnectorInterface,
  ConnectorIssue,
  ConnectorImplementationStatus,
  CredentialVerificationResult,
  ProductPayload,
  SubmissionRef,
  SubmissionStatusUpdate,
  ValidationResult,
} from '../../connector-framework/connector.interface';
import { ConnectorHttpClient } from '../../connector-framework/connector-http-client.service';
import { ConnectorNetworkError } from '../../connector-framework/connector.errors';

const CONNECTOR_HTTP_TIMEOUT_MS = 30_000;

export class MissingTenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingTenantContextError';
  }
}

// Mirrors WooCommercePublishError — carries the structured ConnectorIssue[]
// built from normaliseError() through the throw/catch boundary into
// marketplace.service.ts's recordSubmissionAttempt, instead of degrading to
// a generic CONNECTOR_PUBLISH_FAILED with a raw message.
export class OdooPublishError extends Error {
  constructor(
    public readonly issues: ConnectorIssue[],
    message: string,
  ) {
    super(message);
    this.name = 'OdooPublishError';
  }
}

type OdooRpcError = {
  code?: number;
  message?: string;
  data?: { name?: string; message?: string; debug?: string };
};

type OdooRpcResponse<T> = {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: OdooRpcError;
};

// ─── seller-facing error mapping ────────────────────────────────────────────
//
// Keyed by the Odoo exception's Python class name (error.data.name), which is
// far more stable across Odoo versions than the free-text message.
const ODOO_ERROR_MAP: Record<string, { fieldPath: string; sellerMessage: string; severity: 'error' | 'warning' }> = {
  'odoo.exceptions.ValidationError': {
    fieldPath: '',
    sellerMessage: 'Odoo rejected the record. Check required fields and constraints.',
    severity: 'error',
  },
  'odoo.exceptions.AccessError': {
    fieldPath: 'credentials',
    sellerMessage: "The connected Odoo account lacks write access to product.template. Ask your Odoo admin to grant it.",
    severity: 'error',
  },
  'odoo.exceptions.AccessDenied': {
    fieldPath: 'credentials',
    sellerMessage: 'Odoo rejected the stored database, username, or password/API key.',
    severity: 'error',
  },
  'builtins.ValueError': {
    fieldPath: '',
    sellerMessage: 'Odoo rejected a field value on this record (invalid option or unsupported field for this Odoo instance).',
    severity: 'error',
  },
};

// ─── network-failure classification (mirrors woocommerce.connector.ts) ─────

function classifyFetchFailure(err: unknown): { category: 'TIMEOUT' | 'DNS' | 'TLS' | 'NETWORK'; retryable: boolean; detail: string } {
  if (err instanceof Error && err.name === 'AbortError') {
    return { category: 'TIMEOUT', retryable: true, detail: `request exceeded ${CONNECTOR_HTTP_TIMEOUT_MS}ms timeout` };
  }
  const cause = err instanceof Error ? (err.cause as { code?: string; message?: string } | undefined) : undefined;
  const causeCode = cause?.code ?? '';
  if (causeCode === 'ENOTFOUND' || causeCode === 'EAI_AGAIN') {
    return { category: 'DNS', retryable: false, detail: `DNS resolution failed (${causeCode})` };
  }
  if (causeCode.startsWith('ERR_TLS') || causeCode.startsWith('CERT_')) {
    return { category: 'TLS', retryable: false, detail: `TLS/certificate error (${causeCode})` };
  }
  if (causeCode === 'ECONNREFUSED' || causeCode === 'ECONNRESET' || causeCode === 'EHOSTUNREACH' || causeCode === 'ETIMEDOUT') {
    return { category: 'NETWORK', retryable: true, detail: `connection failed (${causeCode})` };
  }
  const detail = cause?.message || (err instanceof Error ? err.message : String(err));
  return { category: 'NETWORK', retryable: true, detail: detail || 'unknown network failure' };
}

@Injectable()
export class OdooConnector implements ConnectorInterface {
  readonly slug = 'odoo';
  readonly displayName = 'Odoo';
  readonly capabilities: ConnectorCap[] = ['PUBLISH', 'VALIDATE', 'STATUS_SYNC'];
  readonly implementationStatus: ConnectorImplementationStatus = 'full';

  private readonly keys = loadCredentialEncryptionKeys(process.env);

  constructor(
    private readonly prismaDirect: PrismaDirectService,
    private readonly logger: LoggerService,
    private readonly httpClient?: ConnectorHttpClient,
  ) {}

  // ─── credential helpers ─────────────────────────────────────────────────────

  private requireTenantKey(ctx: Pick<ConnectorContext, 'tenantId'>, action: string): string {
    const tenantKey = String(ctx.tenantId ?? '').trim();
    if (!tenantKey) {
      throw new MissingTenantContextError(`Odoo ${action} missing tenant context.`);
    }
    return tenantKey;
  }

  private async fetchCredentialPlaintext(tenantKey: string, installationId: string, type: string): Promise<string | null> {
    const db = this.prismaDirect.getClient();
    const row = await db.connectorCredential.findFirst({
      where: { tenantKey, installationId, credentialType: type },
      select: { encryptedValue: true, keyVersion: true },
    });
    if (!row) return null;
    const version = parseCredentialKeyVersion(row.keyVersion ?? 'v1');
    const key = this.keys.get(version);
    if (!key) return null;
    return decryptCredentialValue(row.encryptedValue, key);
  }

  private async getPlainCredential(ctx: ConnectorContext, type: string): Promise<string | null> {
    return this.fetchCredentialPlaintext(this.requireTenantKey(ctx, 'credential lookup'), ctx.installationId, type);
  }

  private async resolveCredentials(ctx: ConnectorContext): Promise<{
    odooUrl: string;
    database: string;
    username: string;
    password: string;
  }> {
    const [odooUrl, database, username, password] = await Promise.all([
      this.getPlainCredential(ctx, 'odoo_url'),
      this.getPlainCredential(ctx, 'database'),
      this.getPlainCredential(ctx, 'username'),
      this.getPlainCredential(ctx, 'password'),
    ]);
    if (!odooUrl || !database || !username || !password) {
      throw new Error('Odoo credentials incomplete. Verify odoo_url, database, username, and password are stored.');
    }
    return { odooUrl: normalizeOdooUrl(odooUrl), database, username, password };
  }

  // ─── JSON-RPC transport ─────────────────────────────────────────────────────
  //
  // Odoo's /jsonrpc always returns HTTP 200; failures live in the parsed
  // body's `error` key. `rpc()` throws OdooPublishError-free plain Errors for
  // transport-level problems and returns the raw RPC error object to callers
  // that need to classify it (auth vs validation vs unknown).

  private async httpFetch(odooUrl: string, body: unknown): Promise<Response> {
    const url = `${odooUrl}/jsonrpc`;
    const init = {
      method: 'POST',
      timeoutMs: CONNECTOR_HTTP_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
    try {
      if (this.httpClient) {
        return await this.httpClient.fetch('odoo', odooUrl, url, init);
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONNECTOR_HTTP_TIMEOUT_MS);
      try {
        return await fetch(url, { ...init, signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      const { category, retryable, detail } = classifyFetchFailure(err);
      this.logger.warn('Odoo httpFetch network failure', {
        odooUrl, category, retryable, detail,
        cause: err instanceof Error && err.cause ? String(err.cause) : undefined,
      });
      throw new ConnectorNetworkError('odoo', category, retryable, detail);
    }
  }

  private async rpc<T>(odooUrl: string, service: string, method: string, args: unknown[]): Promise<{ result?: T; error?: OdooRpcError }> {
    const res = await this.httpFetch(odooUrl, {
      jsonrpc: '2.0',
      method: 'call',
      params: { service, method, args },
      id: 1,
    });
    const body = (await res.json()) as OdooRpcResponse<T>;
    return { result: body.result, error: body.error };
  }

  private async authenticate(odooUrl: string, database: string, username: string, password: string): Promise<number | null> {
    const { result, error } = await this.rpc<number | false>(odooUrl, 'common', 'authenticate', [
      database,
      username,
      password,
      {},
    ]);
    if (error) {
      throw new OdooRpcCallError(error);
    }
    return result ? Number(result) : null;
  }

  private async executeKw<T>(
    odooUrl: string,
    database: string,
    uid: number,
    password: string,
    model: string,
    method: string,
    args: unknown[],
    kwargs?: Record<string, unknown>,
  ): Promise<T> {
    const callArgs: unknown[] = [database, uid, password, model, method, args];
    if (kwargs) callArgs.push(kwargs);
    const { result, error } = await this.rpc<T>(odooUrl, 'object', 'execute_kw', callArgs);
    if (error) {
      throw new OdooRpcCallError(error);
    }
    return result as T;
  }

  // ─── required: validateCredentials ───────────────────────────────────────────

  async validateCredentials(ctx: ConnectorContext): Promise<boolean> {
    try {
      const { odooUrl, database, username, password } = await this.resolveCredentials(ctx);
      const uid = await this.authenticate(odooUrl, database, username, password);
      return uid != null;
    } catch (err) {
      this.logger.warn('Odoo credential validation failed', {
        installationId: ctx.installationId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  // Classification mirrors verifyCandidateCredentials' own reasoning: a
  // successful authenticate() call returning null (Odoo's common.authenticate
  // returns `false`, never an exception, on a bad db/username/password) is
  // positive evidence of invalid credentials; a network/timeout/DNS failure
  // is unavailable — it isn't evidence the credentials are wrong.
  async validateStoredCredentialsDetailed(ctx: ConnectorContext): Promise<CredentialVerificationResult> {
    try {
      const { odooUrl, database, username, password } = await this.resolveCredentials(ctx);
      if (!odooUrl.startsWith('https://')) {
        return { outcome: 'invalid', reasonCode: 'ODOO_URL_NOT_HTTPS' };
      }
      const uid = await this.authenticate(odooUrl, database, username, password);
      if (uid == null) {
        return { outcome: 'invalid', reasonCode: 'ODOO_CREDENTIALS_REJECTED' };
      }
      return { outcome: 'valid' };
    } catch (err) {
      if (err instanceof ConnectorNetworkError) {
        return { outcome: 'unavailable', reasonCode: err.category };
      }
      return { outcome: 'unavailable', reasonCode: 'UNKNOWN_NETWORK_ERROR' };
    }
  }

  // ─── optional: verifyCandidateCredentials ───────────────────────────────────
  //
  // Pure — takes the candidate quadruplet directly (never reads stored
  // credentials, never writes anything).

  async verifyCandidateCredentials(candidate: Record<string, string>): Promise<CredentialVerificationResult> {
    const odooUrl = normalizeOdooUrl(String(candidate.odoo_url ?? '').trim());
    const database = String(candidate.database ?? '').trim();
    const username = String(candidate.username ?? '').trim();
    const password = String(candidate.password ?? '').trim();

    if (!odooUrl.startsWith('https://')) {
      return { outcome: 'invalid', reasonCode: 'ODOO_URL_NOT_HTTPS' };
    }
    try {
      const uid = await this.authenticate(odooUrl, database, username, password);
      if (uid == null) {
        return { outcome: 'invalid', reasonCode: 'ODOO_CREDENTIALS_REJECTED' };
      }
      return { outcome: 'valid' };
    } catch (err) {
      if (err instanceof ConnectorNetworkError) {
        return { outcome: 'unavailable', reasonCode: err.category };
      }
      return { outcome: 'unavailable', reasonCode: 'UNKNOWN_NETWORK_ERROR' };
    }
  }

  // ─── required: validateProduct ───────────────────────────────────────────────
  //
  // Local rules — Odoo has no dry-run validation endpoint for product.template.

  async validateProduct(_ctx: ConnectorContext, product: ProductPayload): Promise<ValidationResult> {
    const errors: ConnectorIssue[] = [];
    const warnings: ConnectorIssue[] = [];

    if (!product.title || String(product.title).trim().length === 0) {
      errors.push({
        code: 'ODOO_NAME_REQUIRED',
        fieldPath: 'title',
        severity: 'error',
        sellerMessage: 'name is required for product.template records.',
      });
    }

    if (product.sellingPrice == null || product.sellingPrice < 0) {
      errors.push({
        code: 'ODOO_LIST_PRICE_REQUIRED',
        fieldPath: 'sellingPrice',
        severity: 'error',
        sellerMessage: 'list_price must be a non-negative number.',
      });
    }

    if (!product.sku) {
      warnings.push({
        code: 'ODOO_REFERENCE_RECOMMENDED',
        fieldPath: 'sku',
        severity: 'warning',
        sellerMessage: 'default_code (internal reference, mapped from sku) is recommended.',
      });
    }

    return { isValid: errors.length === 0, errors, warnings, source: 'LOCAL_RULES' };
  }

  // ─── build_payload equivalent ────────────────────────────────────────────────

  private buildPayload(product: ProductPayload): Record<string, unknown> {
    const categId = product.attributes?.['odoo_category_id'];
    const weightKg = product.attributes?.['weight_kg'];
    return {
      name: product.title,
      default_code: product.sku,
      list_price: product.sellingPrice ?? 0,
      sale_ok: true,
      purchase_ok: true,
      // "consu" is the only stock type available without the Inventory app —
      // see the file-header note; "product" (storable) does not exist on
      // Odoo 17's detailed_type selection.
      detailed_type: 'consu',
      description_sale: product.description || product.title,
      categ_id: typeof categId === 'number' ? categId : Number(categId ?? 1) || 1,
      weight: typeof weightKg === 'number' ? weightKg : Number(weightKg ?? 0) || 0,
      barcode: product.attributes?.['gtin'] ?? '',
    };
  }

  // ─── optional: publishProduct ────────────────────────────────────────────────

  async publishProduct(ctx: ConnectorContext, product: ProductPayload): Promise<SubmissionRef> {
    const { odooUrl, database, username, password } = await this.resolveCredentials(ctx);
    try {
      const uid = await this.authenticate(odooUrl, database, username, password);
      if (uid == null) {
        throw new OdooPublishError(
          [this.normaliseError('odoo.exceptions.AccessDenied', 'Authentication failed')],
          'Odoo publish failed: authentication rejected.',
        );
      }
      const recordId = await this.executeKw<number>(
        odooUrl, database, uid, password,
        'product.template', 'create', [[this.buildPayload(product)]],
      );
      return { externalRef: String(recordId), status: 'SUCCESS', isAsync: false };
    } catch (err) {
      throw this.toPublishError(err, 'publish');
    }
  }

  // ─── optional: updateProduct ─────────────────────────────────────────────────

  async updateProduct(ctx: ConnectorContext, product: ProductPayload, externalRef: string): Promise<SubmissionRef> {
    const { odooUrl, database, username, password } = await this.resolveCredentials(ctx);
    try {
      const uid = await this.authenticate(odooUrl, database, username, password);
      if (uid == null) {
        throw new OdooPublishError(
          [this.normaliseError('odoo.exceptions.AccessDenied', 'Authentication failed')],
          'Odoo update failed: authentication rejected.',
        );
      }
      await this.executeKw<boolean>(
        odooUrl, database, uid, password,
        'product.template', 'write', [[Number(externalRef)], this.buildPayload(product)],
      );
      return { externalRef, status: 'SUCCESS', isAsync: false };
    } catch (err) {
      throw this.toPublishError(err, 'update');
    }
  }

  // ─── optional: syncSubmissionStatus ──────────────────────────────────────────

  async syncSubmissionStatus(ctx: ConnectorContext, externalRef: string): Promise<SubmissionStatusUpdate> {
    const { odooUrl, database, username, password } = await this.resolveCredentials(ctx);
    const uid = await this.authenticate(odooUrl, database, username, password);
    if (uid == null) {
      return {
        externalRef,
        status: 'ERROR',
        channelErrors: [this.normaliseError('odoo.exceptions.AccessDenied', 'Authentication failed')],
      };
    }
    const rows = await this.executeKw<Array<{ id: number; name: string; active: boolean }>>(
      odooUrl, database, uid, password,
      'product.template', 'search_read',
      [[['id', '=', Number(externalRef)]]],
      { fields: ['name', 'active'], limit: 1 },
    );
    if (!rows || rows.length === 0) {
      return {
        externalRef,
        status: 'ERROR',
        channelErrors: [{ code: 'ODOO_PRODUCT_NOT_FOUND', fieldPath: '', severity: 'error', sellerMessage: 'Product not found in Odoo.' }],
      };
    }
    const row = rows[0];
    return {
      externalRef,
      status: row.active ? 'SUCCESS' : 'SUPPRESSED',
      channelErrors: [],
      resolvedAt: new Date(),
    };
  }

  // ─── required: normaliseError ────────────────────────────────────────────────

  normaliseError(errorCode: string, rawMessage: string): ConnectorIssue {
    const entry = ODOO_ERROR_MAP[errorCode];
    if (entry) {
      return { code: errorCode, fieldPath: entry.fieldPath, severity: entry.severity, sellerMessage: entry.sellerMessage };
    }
    return {
      code: errorCode || 'ODOO_UNKNOWN_ERROR',
      fieldPath: '',
      severity: 'error',
      sellerMessage: `An unexpected Odoo error occurred. Detail: ${rawMessage}`.trim(),
    };
  }

  private toPublishError(err: unknown, operation: 'publish' | 'update'): OdooPublishError {
    if (err instanceof OdooPublishError) return err;
    if (err instanceof OdooRpcCallError) {
      const name = err.rpcError.data?.name ?? String(err.rpcError.code ?? 'ODOO_ERROR');
      const message = err.rpcError.data?.message ?? err.rpcError.message ?? 'Unknown Odoo error';
      const issue = this.normaliseError(name, message);
      return new OdooPublishError([issue], `Odoo product ${operation} failed: ${issue.sellerMessage}`);
    }
    const issue = this.normaliseError('ODOO_UNKNOWN_ERROR', err instanceof Error ? err.message : String(err));
    return new OdooPublishError([issue], `Odoo product ${operation} failed: ${issue.sellerMessage}`);
  }
}

// Carries the raw Odoo RPC error object through the throw/catch boundary so
// toPublishError() can run it through normaliseError() with the real
// error.data.name — never surfaced directly to sellers.
class OdooRpcCallError extends Error {
  constructor(public readonly rpcError: OdooRpcError) {
    super(rpcError.data?.message ?? rpcError.message ?? 'Odoo RPC error');
    this.name = 'OdooRpcCallError';
  }
}

function normalizeOdooUrl(url: string): string {
  return url.replace(/\/+$/, '');
}
