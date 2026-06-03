# Connector Authoring Guide

How to add a new marketplace connector to Vexa PIM. Read this before writing any code.

---

## What the framework provides (don't reimplement these)

Before writing a connector, understand what you get for free from `ConnectorContext`:

```typescript
interface ConnectorContext {
  tenantId: string;
  installationId: string;
  connectorId: string;
  sellerId?: string;
  marketplaceId?: string;

  // Returns a valid, unexpired access token. Handles decrypt + refresh transparently.
  // Never returns a stale token. Call this at the start of every authenticated request.
  getAccessToken(): Promise<string>;

  // Rate-limited, retrying fetch. Handles 429/503 backoff automatically.
  // Use this instead of raw fetch() for all marketplace API calls.
  fetch(url: string, init?: ConnectorFetchInit): Promise<Response>;
}
```

**You do not need to:**
- Manage token storage or decryption
- Implement retry logic or rate limiting
- Write request queuing

**The framework also provides:**
- 6-hour credential heartbeat (calls `validateCredentials` on all active installations)
- Automatic key rotation for encrypted credentials on deploy
- Structured log events on publish/validate/webhook paths (`connector.*`)
- Submission payload snapshot upload to R2 for large payloads

---

## The interface your connector must implement

```typescript
interface ConnectorInterface {
  // Required
  readonly slug: string;           // e.g. "myntra" — must match ConnectorDefinition.slug in DB
  readonly displayName: string;    // e.g. "Myntra"
  readonly capabilities: ConnectorCap[];
  readonly implementationStatus: ConnectorImplementationStatus;

  validateCredentials(ctx: ConnectorContext): Promise<boolean>;
  validateProduct(ctx: ConnectorContext, product: ProductPayload): Promise<ValidationResult>;
  normaliseError(code: string, message: string): ConnectorIssue;

  // Required if capabilities includes 'PUBLISH'
  publishProduct?(ctx: ConnectorContext, product: ProductPayload): Promise<SubmissionRef>;
  updateProduct?(ctx: ConnectorContext, product: ProductPayload, externalRef: string): Promise<SubmissionRef>;

  // Required if capabilities includes 'STATUS_SYNC'
  syncSubmissionStatus?(ctx: ConnectorContext, externalRef: string): Promise<SubmissionStatusUpdate>;

  // Required if capabilities includes 'WEBHOOK_RECEIVE'
  parseWebhookEvent?(rawBody: Buffer, headers: Record<string, string>): Promise<ParsedWebhookEvent | null>;

  // Required if capabilities includes 'EXCEL_EXPORT'
  generateExportFile?(ctx: ConnectorContext, products: ProductPayload[]): Promise<ExportFile>;

  // Required if the connector uses OAuth2 (access token + refresh token).
  // Called by the framework when getAccessToken() finds a stale token.
  // MUST persist the new token(s) before returning.
  refreshAccessToken?(ctx: ConnectorContext): Promise<string>;
}
```

---

## Step-by-step: adding a new connector

### 1. Create the connector file

```
apps/api/src/connectors/<slug>/<slug>.connector.ts
```

Minimal skeleton:

```typescript
import { Injectable } from "@nestjs/common";
import { PrismaDirectService } from "../../prisma/prisma-direct.service";
import { LoggerService } from "../../common/logging/logger.service";
import {
  ConnectorCap, ConnectorContext, ConnectorInterface, ConnectorIssue,
  ProductPayload, SubmissionRef, ValidationResult,
} from "../../connector-framework/connector.interface";
import {
  buildEncryptedCredential, decryptCredentialValue, formatCredentialKeyVersion,
  loadCredentialEncryptionKeys, parseCredentialKeyVersion, resolveCurrentCredentialKeyVersion,
} from "../../connector-installer/credential-encryption.util";
import { tenantRaw, tenantExecRaw } from "../../common/tenant/tenant-raw";

const CONNECTOR_SLUG = "myntra"; // must match DB slug

type CredentialRow = {
  encryptedValue: string;
  keyVersion: string;
  status: string;
  expiresAt: Date | null;
  failureReason: string | null;
};

@Injectable()
export class MyntraConnector implements ConnectorInterface {
  readonly slug = CONNECTOR_SLUG;
  readonly displayName = "Myntra";
  readonly implementationStatus = "full" as const;
  readonly capabilities: ConnectorCap[] = ["PUBLISH", "VALIDATE", "STATUS_SYNC"];

  private readonly keys = loadCredentialEncryptionKeys(process.env);
  private readonly currentKeyVersion = resolveCurrentCredentialKeyVersion(process.env);

  constructor(
    private readonly prismaDirect: PrismaDirectService,
    private readonly logger: LoggerService,
  ) {}

  // ─── implement the interface methods below ─────────────────────────────────
}
```

### 2. Credential management

Credentials are stored encrypted in `ConnectorCredential`. Use these helpers — do not access the table directly.

**Retrieve a credential:**
```typescript
private async requireCredential(ctx: ConnectorContext, credentialType: string): Promise<string> {
  const db = this.prismaDirect.getClient();
  const rows = await tenantRaw<CredentialRow[]>(db, `
    SELECT encrypted_value AS "encryptedValue", key_version AS "keyVersion",
           status, expires_at AS "expiresAt", failure_reason AS "failureReason"
    FROM connector_credentials
    WHERE tenant_key = $1 AND installation_id = $2 AND credential_type = $3
    LIMIT 1
  `, [ctx.tenantId, ctx.installationId, credentialType]);

  const row = rows[0];
  if (!row) throw new Error(`Missing credential '${credentialType}'.`);
  if (row.status?.toUpperCase() === "DISABLED") {
    throw new Error(`Credential '${credentialType}' is disabled.`);
  }
  return this.decrypt(row);
}
```

**Store a credential (upsert):**
```typescript
private async storeCredential(
  ctx: ConnectorContext,
  credentialType: string,
  value: string,
  opts: { expiresAt?: Date | null } = {},
): Promise<void> {
  const encrypted = buildEncryptedCredential(value, this.currentKeyVersion, this.keys);
  const keyVersion = formatCredentialKeyVersion(encrypted.keyVersion);
  const db = this.prismaDirect.getClient();
  const id = `${ctx.installationId}:${credentialType}`;

  await tenantExecRaw(db, `
    INSERT INTO connector_credentials (id, tenant_key, installation_id, credential_type,
      encrypted_value, key_version, status, expires_at, last_refresh_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7,NOW(),NOW())
    ON CONFLICT (id) DO UPDATE SET
      encrypted_value = EXCLUDED.encrypted_value,
      key_version = EXCLUDED.key_version,
      status = 'ACTIVE',
      expires_at = EXCLUDED.expires_at,
      failure_reason = NULL,
      last_refresh_at = NOW(),
      updated_at = NOW()
  `, [id, ctx.tenantId, ctx.installationId, credentialType,
      encrypted.cipher, keyVersion, opts.expiresAt ?? null]);
}

private decrypt(row: CredentialRow): string {
  const version = parseCredentialKeyVersion(row.keyVersion);
  const key = this.keys.get(version);
  if (!key) throw new Error(`Missing encryption key for version ${version}.`);
  return decryptCredentialValue(row.encryptedValue, key);
}
```

### 3. Token refresh (OAuth connectors only)

If your connector uses OAuth2 (access token + refresh token), implement `refreshAccessToken`. The framework calls this when `ctx.getAccessToken()` finds the stored token is expired.

```typescript
async refreshAccessToken(ctx: ConnectorContext): Promise<string> {
  const clientId = await this.requireCredential(ctx, "client_id");
  const clientSecret = await this.requireCredential(ctx, "client_secret");
  const refreshToken = await this.requireCredential(ctx, "refresh_token");

  // Call your marketplace's token endpoint
  const response = await fetch(`https://api.myntra.com/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  const data = await response.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Token response did not include access_token.");

  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000)
    : null;

  await this.storeCredential(ctx, "access_token", data.access_token, { expiresAt });
  return data.access_token;
}
```

### 4. Making authenticated API calls

Always use `ctx.fetch()` for marketplace API calls. It handles rate limiting and backoff for you.

```typescript
async publishProduct(ctx: ConnectorContext, product: ProductPayload): Promise<SubmissionRef> {
  const token = await ctx.getAccessToken(); // framework handles refresh

  const response = await ctx.fetch("https://api.myntra.com/listings/v1/create", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(this.buildListingPayload(product)),
  });

  if (!response.ok) {
    throw new Error(`Myntra publish failed with status ${response.status}`);
  }
  const data = await response.json() as { listingId?: string };
  return {
    externalRef: data.listingId ?? product.sku,
    status: "PENDING",
    isAsync: true,
  };
}
```

**Do not** call raw `fetch()` for authenticated API calls. It bypasses the framework's rate limiter.

### 5. validateCredentials — the heartbeat method

The framework calls this every 6 hours for all active installations. Return `true` if credentials are valid, `false` if expired or invalid.

```typescript
async validateCredentials(ctx: ConnectorContext): Promise<boolean> {
  try {
    const token = await ctx.getAccessToken();
    // Call a lightweight endpoint to verify the token is accepted
    const response = await ctx.fetch("https://api.myntra.com/seller/v1/profile", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}
```

### 6. normaliseError — translating channel errors for sellers

Map marketplace-specific error codes to seller-readable messages:

```typescript
normaliseError(code: string, message: string): ConnectorIssue {
  const known: Record<string, { fieldPath: string; sellerMessage: string }> = {
    "INVALID_HSN": {
      fieldPath: "hsnCode",
      sellerMessage: "HSN code is not recognized by Myntra. Verify the code is valid for this product category.",
    },
    "MISSING_BRAND": {
      fieldPath: "brand",
      sellerMessage: "Brand name is required. Ensure the brand is registered on your Myntra seller account.",
    },
  };
  const match = known[code];
  return {
    code: code || "MYNTRA_ERROR",
    fieldPath: match?.fieldPath ?? "unknown",
    severity: "error",
    sellerMessage: match?.sellerMessage ?? message || "Myntra rejected the listing. Review the product data and retry.",
  };
}
```

### 7. Register the connector

**In `connector-framework.module.ts`:**
```typescript
import { MyntraConnector } from "../connectors/myntra/myntra.connector";

@Module({
  providers: [
    // ... existing connectors ...
    MyntraConnector,
  ],
})
```

**In `connector.registry.ts`** — add to the registry's connector map.

**In `connector-launch-policy.ts`** — add the launch policy entry:
```typescript
"myntra": {
  stage: "manual",          // "live" once API access confirmed
  launchNote: "Seller install pending API credentials",
  surfacedCapabilities: ["PUBLISH", "VALIDATE", "STATUS_SYNC"],
},
```

**In the database** — insert a `ConnectorDefinition` row:
```sql
INSERT INTO connector_definitions (id, slug, display_name, auth_type, capabilities, is_active)
VALUES (gen_random_uuid(), 'myntra', 'Myntra', 'oauth2_authcode',
        ARRAY['PUBLISH','VALIDATE','STATUS_SYNC'], true);
```

---

## Rate limit defaults

`ConnectorHttpClient` uses per-connector token buckets. Add your connector's limits in `connector-http-client.service.ts`:

```typescript
const RATE_LIMIT_DEFAULTS: Record<string, { capacity: number; refillMs: number }> = {
  "amazon-in": { capacity: 5,  refillMs: 200  },
  "shopify":   { capacity: 10, refillMs: 500  },
  "flipkart":  { capacity: 3,  refillMs: 1000 },
  "myntra":    { capacity: 5,  refillMs: 400  }, // 2.5 req/sec sustained — adjust from docs
};
```

Check the marketplace's API documentation for rate limits before setting these.

---

## Connector capability matrix

| Capability | Method to implement | Notes |
|---|---|---|
| `PUBLISH` | `publishProduct`, `updateProduct` | Both required together |
| `VALIDATE` | `validateProduct` | Always implement; use `LOCAL_RULES` or `LIVE_API` source |
| `STATUS_SYNC` | `syncSubmissionStatus` | Required for async submissions |
| `WEBHOOK_RECEIVE` | `parseWebhookEvent` | Must verify HMAC signature before parsing |
| `EXCEL_EXPORT` | `generateExportFile` | For export-only connectors (like Meesho) |
| `BULK_PUBLISH` | `publishBulkProducts` | Optional; for feed-API marketplaces (like Amazon) |

---

## What not to do

| Do not | Why |
|---|---|
| Call `fetch()` directly for marketplace API calls | Bypasses rate limiter; will cause 429 cascades at scale |
| Store tokens in class properties | Not thread-safe; tokens must come from `ctx.getAccessToken()` |
| Import `PrismaService` (pooled) into a connector | Use `PrismaDirectService` for direct credential operations |
| Use `this.prisma.tenant()` without a tenantKey in background jobs | Falls back to AsyncLocalStorage which is undefined outside request context |
| Skip implementing `refreshAccessToken` for OAuth connectors | `ctx.getAccessToken()` will throw on token expiry |
| Return hardcoded `isValid: true` from `validateProduct` | Sellers will see no errors at validation time, then failures at publish |

---

## Testing checklist

Before marking a connector ready for staging:

- [ ] `validateCredentials` returns `false` on bad credentials (not throwing)
- [ ] `validateProduct` catches all required fields for your category
- [ ] `publishProduct` returns an `externalRef` that `syncSubmissionStatus` can look up
- [ ] Webhook signature verification rejects tampered payloads (if applicable)
- [ ] `normaliseError` covers the top 5 most common channel error codes
- [ ] `refreshAccessToken` persists the new token before returning
- [ ] Unit tests for validation rules and error mapping
- [ ] Rate limit defaults set in `ConnectorHttpClient`
- [ ] Launch policy entry in `connector-launch-policy.ts` with correct stage

---

## Reference implementations

| Pattern | Where to look |
|---|---|
| OAuth2 LWA (Amazon-style) | `connectors/amazon/amazon.connector.ts` |
| OAuth2 AuthCode + token refresh | `connectors/flipkart/flipkart.connector.ts` |
| Managed install (Shopify-style) | `connectors/shopify/shopify.connector.ts` + `shopify-api-client.service.ts` |
| Export-only (no direct publish) | `connectors/meesho/meesho.connector.ts` |
| Category-specific validation rules | `connectors/flipkart/flipkart-category-rules.ts` |
| GraphQL transport with throttle/retry | `connectors/shopify/shopify-api-client.service.ts` |
