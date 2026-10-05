# Connector write retries and the per-call retry policy

A transport failure does not prove the provider did not execute the request. A timeout or a
reset after the request left can mean the write happened and only the response was lost.
Repeating such a create can make a second record. This document records where Vexa repeats
provider calls today, how a call states what repeating it means, and what is still open.

## Where a provider call is repeated

| Layer | Trigger | Repeats |
|---|---|---|
| Shared HTTP client (`ConnectorHttpClient.fetch`, reached through `ctx.fetch` or `httpClient`) | any network error or timeout; HTTP 429, 500, 502, 503, 504 | the single request, up to 3 more times, for every method including POST |
| Export-job retry (`marketplace.service.ts`) | `publishProduct` throws a `ConnectorNetworkError` with `retryable` | the whole job, from the top, up to `maxRetries`; no check for whether the create already happened |

A connector is exposed to the first layer only if it sends the call through the shared client.
Several send creates with their own `fetch` and make a single attempt. A manual resubmit also
re-runs the create.

## The per-call retry policy (this change)

`ConnectorFetchInit` takes `retryPolicy`, `idempotency` and `operation`. Omitting the policy
keeps today's behavior exactly; no connector selects a policy yet.

| Policy | Retries | Requires |
|---|---|---|
| `CURRENT_BEHAVIOR` (default) | as before | nothing |
| `SAFE_TO_RETRY` | as before | the caller asserts the operation is safe to repeat |
| `RETRY_WITH_IDEMPOTENCY` | as before | `idempotency: { header, key }`; the client attaches the header to every attempt |
| `NO_AUTOMATIC_RETRY` | never: a network error or timeout is thrown, a 429 or 5xx response is returned | nothing |

`RETRY_WITH_IDEMPOTENCY` is not a label. The client throws `ConnectorRetryPolicyError` before the
first attempt if the key is missing, malformed (8-255 printable characters, no whitespace), the
header name is not a valid token, the request already carries that header with a different value,
or an idempotency key is supplied under any other policy. An unknown policy also throws. Whether
a provider actually honors the header is a separate fact that each connector must prove before
selecting this policy (see the classification below).

### Retry log

Every retry, and every retry the policy suppressed, logs one structured line carrying
`connector`, `installation`, `operation`, `method`, `attempt`, `reason`, `policy` (plus the
existing `url`, `status` and `backoffMs`):

- `connector.http.network_error` and `connector.http.retrying`: a retry is about to happen.
- `connector.http.retry_suppressed`: `NO_AUTOMATIC_RETRY` declined to retry.

`reason` is `network_error`, `timeout` or `http_<status>`. The idempotency key and request
headers are never logged, and an `operation` label that is not a short code is replaced.

## Exposure by connector (read from `main`, 2026-10-05)

Whether a duplicate is actually created, or rejected by the provider, depends on provider
uniqueness rules that have not been verified. None is assumed here.

| Connector | Create path | HTTP-layer retry | Job-level retry | Classification |
|---|---|---|---|---|
| Odoo `product.template create` | `httpClient` | yes | no (network errors are wrapped as `OdooPublishError`) | needs evidence |
| Etsy create-draft listing | `ctx.fetch` | yes | no | needs evidence |
| Dynamics 365 `POST /items` | `ctx.fetch` | yes | no | needs provider semantics: stable client key, alternate key, idempotency mechanism or reliable reconciliation lookup |
| WooCommerce create | `callApi` through `httpClient` | yes | after a lookup by SKU | needs evidence; the lookup does not protect a retry inside one call, and a timeout after the POST succeeds is not covered by it |
| BigCommerce create | raw `fetch` | no | **yes** (retryable `ConnectorNetworkError`) | needs evidence; a separate job-level story, the shared policy does not reach it |
| Shopware, PrestaShop, Zoho Inventory, eBay offer | raw `fetch` or pinned transport | no | no | single attempt; a manual resubmit re-creates |
| Amazon (PUT by SKU), Flipkart | `ctx.fetch` | yes | no | SKU-keyed; unverified |

### Classification required before any connector changes

Each create operation is classified from evidence, never from memory or comments:

- `PROVEN_IDEMPOTENT`: a retry cannot create a second record (a client-supplied key the provider
  honors, or a keyed upsert). Retry is permitted under an explicit policy.
- `PROVEN_RECONCILABLE`: a lookup can tell whether the write happened. No blind retry; reconcile
  first, re-issue only if absence is proven.
- `AMBIGUOUS`: neither is proven. No automatic retry.

## Sequence

1. This change: the policy framework, tests and log. No connector behavior changes.
2. Read-only provider-semantics check: classify every create above.
3. Shared-client unsafe creates (Odoo, Etsy, Dynamics 365, WooCommerce) per their classification.
4. Job-level unsafe create re-run (BigCommerce): a retried job must not blindly create again.
5. Pre-call intent: record a PENDING submission before the provider call so an ambiguous timeout
   reads as "outcome unknown", not "failed".
