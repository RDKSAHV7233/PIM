# ADR-0012: Connector Error Taxonomy and Run Tracking

**Status**: Accepted
**Date**: 2026-09-27
**Author**: ADR sprint 2 — architecture sprint
**Gate**: Gate 1 — ADR-008
**Depends on**: ADR-0005 (Platform Boundaries), ADR-0011 (ConnectorContext)

---

## Context

The connector framework handles errors at three layers — adapter, framework, and queue — with no unified taxonomy. Each layer has evolved its own error types, classification logic, and retry semantics. As the connector count grows, the lack of a shared error model creates inconsistent error reporting, duplicated classification logic, and difficulty correlating failures across layers.

### Current error landscape

#### Layer 1: Adapter errors (per-connector)

Each connector defines its own error classes, none inheriting from a shared base:

- **Token exchange errors** (private, not exported): `FlipkartTokenExchangeError`, `AmazonTokenExchangeError`, `EtsyTokenExchangeError`, `EbayTokenExchangeError`, `ShopwareTokenExchangeError`, `AadTokenExchangeError`, `ZohoTokenExchangeError` — each carries `status: number` and `body`.
- **Publish errors** (exported): `OdooPublishError`, `WooCommercePublishError`, `ShopifyPublishError`, `ShopwarePublishError`, `PrestaShopPublishError`, `BigCommercePublishError`, `EbayPublishError`, `ZohoInventoryPublishError`.
- **Raw throws**: Some connectors throw plain `Error` with descriptive messages from publish/validate paths.

#### Layer 2: Framework errors (`connector.errors.ts`)

Five exported error classes: `ConnectorNotFoundError`, `InstallationNotFoundError`, `CredentialExpiredError`, `CapabilityNotSupportedError`, `ConnectorNetworkError`. Only `ConnectorNetworkError` carries classification metadata (`category: NetworkErrorCategory`, `retryable: boolean`).

#### Layer 3: Queue/worker errors

`QueueRateLimitError` in the queue service. `worker-error-classifier.ts` classifies errors post-hoc — suppressing expected domain failures (validation rejection, rate limits, credential expiry) and capturing unexpected failures (timeout, database, redis, internal). This classifier duplicates knowledge about which errors are retryable.

### Run tracking fragmentation

There is no unified `ConnectorRun` entity. Run-level state is split across four models:

| Model | Tracks | Status Values |
|-------|--------|---------------|
| `ConnectorSubmission` | Per-product publish attempts | PENDING, SUCCESS, REJECTED, SUPPRESSED, ERROR |
| `MarketplaceExportJob` | Export/publish queue jobs | queued, processing, retrying, completed, failed, dead_letter |
| `MarketplaceBulkPublishRun` | Bulk publish batches | (lifecycle states) |
| `ConnectorWebhookEvent` | Inbound webhook processing | processingStatus, processingAttemptCount |

A single "publish product X to Flipkart" operation touches `MarketplaceExportJob` (queue state), `ConnectorSubmission` (attempt state), and potentially `ConnectorWebhookEvent` (async result). Correlating these requires joining on product ID + connector slug + time window — there is no shared run identifier.

### Retry semantics

Retry decisions are made at three independent levels:

1. **HTTP client** (`ConnectorHttpClient`): Retries 429/5xx with exponential backoff+jitter, Retry-After support. Per-connector token bucket rate limiting.
2. **Token refresh**: `fetchWithTokenRetry` in Flipkart/Amazon — one automatic retry on 401.
3. **Job queue**: BullMQ with `maxRetries` on `MarketplaceExportJob`. `ConnectorNetworkError.retryable` is checked to decide whether to retry or dead-letter.

These levels operate independently. An HTTP retry inside a job retry inside a bulk run retry can produce multiplicative retry counts with no shared budget.

---

## Decision

### 1. ConnectorError base class

All connector-originated errors extend `ConnectorError`:

```typescript
abstract class ConnectorError extends Error {
  abstract readonly errorKind: ConnectorErrorKind;
  abstract readonly retryable: boolean;
  readonly connectorSlug?: string;
  readonly correlationId?: string;
}
```

`ConnectorErrorKind` is a closed enum:

| Kind | Meaning | Default retryable |
|------|---------|-------------------|
| `AUTHENTICATION` | Credential invalid, expired, or revoked | No |
| `AUTHORIZATION` | Valid credentials but insufficient permissions | No |
| `RATE_LIMIT` | Provider rate limit exceeded | Yes |
| `PROVIDER_VALIDATION` | Provider rejected the payload (field errors, missing data) | No |
| `PROVIDER_SERVER` | Provider returned 5xx or equivalent | Yes |
| `NETWORK` | DNS, TLS, timeout, connection reset | Yes |
| `SCHEMA_MISMATCH` | Payload does not match expected provider schema | No |
| `INTERNAL` | Bug in connector code | No |

Existing per-connector error classes become subclasses of `ConnectorError` with the appropriate `errorKind`. Token exchange errors map to `AUTHENTICATION`. Publish errors map to `PROVIDER_VALIDATION` or `PROVIDER_SERVER` depending on the HTTP status.

### 2. Structured error normalization

The existing `normaliseError()` method on each connector remains the translation point from provider-native errors to `ConnectorIssue` arrays. `ConnectorError` carries an optional `issues: ConnectorIssue[]` field populated by `normaliseError()`. This preserves the per-field error detail (code, fieldPath, sellerMessage, severity) while adding the classification envelope.

### 3. Error Authority integration

`ConnectorError` instances carry `correlationId` from `ConnectorContext` (ADR-0011). The Error Authority's `worker-error-classifier.ts` switches on `errorKind` instead of pattern-matching error messages. The classification enum replaces the ad-hoc string matching.

### 4. ConnectorRun as a logical concept (not a new table)

`ConnectorRun` is a named logical boundary, not a new database entity. A "run" is any single invocation of a connector method through `ConnectorFrameworkService`. It is identified by the `correlationId` from `ConnectorContext`.

The existing models retain their responsibilities:
- `ConnectorSubmission` tracks per-product attempt outcomes
- `MarketplaceExportJob` tracks queue lifecycle
- `MarketplaceBulkPublishRun` tracks batch orchestration

The `correlationId` is stored on `ConnectorSubmission` (new column) and included in `MarketplaceExportJob` metadata, enabling joins across models without a new table.

### 5. Retry budget

A connector method invocation has a single retry budget defined at the job level (`MarketplaceExportJob.maxRetries`). HTTP-level retries (handled by `ConnectorHttpClient`) count against this budget. Token refresh retries are exempt (they are auth recovery, not payload retry). The queue does not retry when `ConnectorError.retryable === false`.

---

## Machine-Checkable Invariants

| ID | Description | Severity | Check |
|----|-------------|----------|-------|
| `connector-error-base` | All exported connector error classes extend `ConnectorError` | WARNING | AST check: every class in `connectors/*/` extending `Error` should extend `ConnectorError` instead |
| `error-kind-coverage` | Every `ConnectorError` subclass sets `errorKind` | ERROR | Type enforcement: `errorKind` is abstract and required |
| `submission-correlation` | Every `ConnectorSubmission` write includes `correlationId` | WARNING | Grep for `ConnectorSubmission.create` calls missing `correlationId` |

---

## Consequences

### Positive

- **Unified classification:** `errorKind` replaces ad-hoc message matching in the worker classifier, Sentry integration, and operator-facing error displays.
- **Retry clarity:** `retryable` is authoritative at the error source, not re-derived at each layer.
- **Cross-model correlation:** `correlationId` ties together submissions, job state, and logs for a single operation.

### Negative

- **Migration scope:** 8 publish error classes and 7 token exchange error classes need refactoring to extend `ConnectorError`. This is mechanical but touches every connector.
- **Retry budget enforcement:** Counting HTTP retries against the job budget requires plumbing between `ConnectorHttpClient` and the job context.

### Neutral

- No new database table. The `correlationId` column on `ConnectorSubmission` is the only schema change.
- `ConnectorNetworkError` becomes a subclass of `ConnectorError` with `errorKind: 'NETWORK'`, preserving its existing `category` and `retryable` fields.
