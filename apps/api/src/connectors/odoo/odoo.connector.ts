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

import { BadRequestException, Injectable } from '@nestjs/common';
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
import { validateConnectorTargetUrl } from '../../common/security/url-safety';
import {
  isConnectorTargetSecurityError,
  targetSecurityVerificationReason,
  type ConnectorTargetSecurityError,
} from '../../common/security/connector-target-errors';
import { configurationInvalid } from '../../connector-framework/credential-validation';
import { getConnectorTransport } from '../../common/security/connector-transport';
import {
  fetchWithValidatedRedirects,
  type RedirectHopInit,
} from '../../common/security/validated-redirect-fetch';

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
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
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
    const normalizedOdooUrl = normalizeOdooUrl(odooUrl);
    // PIM#890: block a stored odoo_url that resolves to a private/internal/
    // metadata-endpoint address before every dispatch call reaches it.
    await validateConnectorTargetUrl(normalizedOdooUrl, { requireResolvable: false });
    return { odooUrl: normalizedOdooUrl, database, username, password };
  }

  // ─── JSON-RPC transport ─────────────────────────────────────────────────────
  //
  // Odoo's /jsonrpc always returns HTTP 200; failures live in the parsed
  // body's `error` key. `rpc()` throws OdooPublishError-free plain Errors for
  // transport-level problems and returns the raw RPC error object to callers
  // that need to classify it (auth vs validation vs unknown).

  private async httpFetch(odooUrl: string, body: unknown): Promise<Response> {
    const url = `${odooUrl}/jsonrpc`;
    // The request body carries the database password/API key, so a redirect must
    // never be followed by fetch itself: every hop is sent with redirect:
    // "manual" and re-validated, and a cross-origin hop fails closed.
    const hop = async (hopUrl: string, hopInit: RedirectHopInit): Promise<Response> => {
      // Pinned transport: the validated DNS result for this attempt is the only
      // set of addresses the socket may connect to.
      const transport = getConnectorTransport();
      const init = { ...hopInit, timeoutMs: CONNECTOR_HTTP_TIMEOUT_MS };
      if (this.httpClient) {
        return this.httpClient.fetch('odoo', odooUrl, hopUrl, { ...init, transport });
      }
      return transport.fetch(hopUrl, init);
    };
    try {
      return await fetchWithValidatedRedirects(hop, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // A redirect refusal is a configuration problem, not a transient network
      // failure: surface it as-is so it is neither retried nor mislabelled.
      if (isConnectorTargetSecurityError(err)) {
        this.logger.warn('Odoo httpFetch target refused', { odooUrl, code: err.code, reason: err.reason });
        throw err;
      }
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
        return configurationInvalid('ODOO_URL_NOT_HTTPS');
      }
      const uid = await this.authenticate(odooUrl, database, username, password);
      if (uid == null) {
        return { outcome: 'invalid', reasonCode: 'ODOO_CREDENTIALS_REJECTED' };
      }
      return { outcome: 'valid' };
    } catch (err) {
      if (isConnectorTargetSecurityError(err)) {
        return configurationInvalid(targetSecurityVerificationReason('ODOO', err));
      }
      if (err instanceof ConnectorNetworkError) {
        return { outcome: 'unavailable', reasonCode: err.category };
      }
      // PIM#890: resolveCredentials() above now throws before returning an
      // odoo_url that's non-HTTPS or resolves to a private/blocked address —
      // classify that as invalid, not an unavailable/transient failure.
      if (err instanceof BadRequestException) {
        const reasonCode = err.message.includes('HTTPS') ? 'ODOO_URL_NOT_HTTPS' : 'ODOO_URL_UNSAFE';
        return configurationInvalid(reasonCode);
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
      return configurationInvalid('ODOO_URL_NOT_HTTPS');
    }
    // PIM#890: reject a candidate odoo_url that points at a private/internal/
    // metadata-endpoint address before this ever gets saved as a credential.
    try {
      await validateConnectorTargetUrl(odooUrl, { requireResolvable: false });
    } catch {
      return configurationInvalid('ODOO_URL_UNSAFE');
    }
    try {
      const uid = await this.authenticate(odooUrl, database, username, password);
      if (uid == null) {
        return { outcome: 'invalid', reasonCode: 'ODOO_CREDENTIALS_REJECTED' };
      }
      return { outcome: 'valid' };
    } catch (err) {
      if (isConnectorTargetSecurityError(err)) {
        return configurationInvalid(targetSecurityVerificationReason('ODOO', err));
      }
      if (err instanceof ConnectorNetworkError) {
        return { outcome: 'unavailable', reasonCode: err.category };
      }
      return { outcome: 'unavailable', reasonCode: 'UNKNOWN_NETWORK_ERROR' };
    }
  }

  // ─── required: validateProduct ───────────────────────────────────────────────
  //
  // Local rules — Odoo has no dry-run validation endpoint for product.template.

  async validateProduct(ctx: ConnectorContext, product: ProductPayload): Promise<ValidationResult> {
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
    } else if (await this.referenceExists(ctx, product.sku)) {
      // publishProduct() below always calls product.template.create — there is
      // no upsert-by-default_code lookup, and Odoo does not enforce
      // default_code uniqueness itself. Mirrors PrestaShop's identical
      // referenceExists() warning (same underlying risk: create-only,
      // platform doesn't enforce uniqueness) so an operator gets the same
      // heads-up here that PrestaShop's connector already gives.
      warnings.push({
        code: 'ODOO_DUPLICATE_REFERENCE_RISK',
        fieldPath: 'sku',
        severity: 'warning',
        sellerMessage:
          'A product with this default_code (internal reference) already exists in Odoo. Publishing will create a duplicate rather than update it, since Odoo does not enforce default_code uniqueness and this connector always creates a new record on publish. If this is meant to update the existing product, use update instead.',
      });
    }

    return { isValid: errors.length === 0, errors, warnings, source: 'LOCAL_RULES' };
  }

  private async referenceExists(ctx: ConnectorContext, sku: string): Promise<boolean> {
    try {
      const { odooUrl, database, username, password } = await this.resolveCredentials(ctx);
      const uid = await this.authenticate(odooUrl, database, username, password);
      if (uid == null) {
        return false;
      }
      const rows = await this.executeKw<Array<{ id: number }>>(
        odooUrl, database, uid, password,
        'product.template', 'search_read',
        [[['default_code', '=', sku]]],
        { fields: ['id'], limit: 1 },
      );
      return Array.isArray(rows) && rows.length > 0;
    } catch {
      // Can't reach Odoo right now — don't block validation on a network
      // blip; the live publish call surfaces a real error if it still matters.
      return false;
    }
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

  private toPublishError(err: unknown, operation: 'publish' | 'update'): OdooPublishError | ConnectorTargetSecurityError {
    if (err instanceof OdooPublishError) return err;
    if (err instanceof OdooRpcCallError) {
      const name = err.rpcError.data?.name ?? String(err.rpcError.code ?? 'ODOO_ERROR');
      const message = err.rpcError.data?.message ?? err.rpcError.message ?? 'Unknown Odoo error';
      const issue = this.normaliseError(name, message);
      return new OdooPublishError([issue], `Odoo product ${operation} failed: ${issue.sellerMessage}`);
    }
    // Target-URL security refusals keep their provider-neutral code
    // (CONNECTOR_TARGET_UNSAFE / CONNECTOR_REDIRECT_BLOCKED); the marketplace
    // layer reports them as such instead of a generic Odoo failure.
    if (isConnectorTargetSecurityError(err)) return err;
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
