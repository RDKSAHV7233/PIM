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

## The per-call retry policy

`ConnectorFetchInit` takes `retryPolicy`, `idempotency` and `operation`. Omitting the policy
keeps today's behavior exactly. Four provider creates select `NO_AUTOMATIC_RETRY` (see below); no connector selects another policy.

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

## Provider evidence and classification (2026-10-05)

Each create is classified from primary evidence (provider source or published specification),
never from memory or code comments. Whether a retried create produces a duplicate depends on
what the provider enforces.

- `PROVEN_IDEMPOTENT`: a retry cannot create a second record (a key the provider honors, or a
  keyed upsert). Retry is permitted under an explicit policy.
- `PROVEN_RECONCILABLE`: a lookup can tell whether the write happened. No blind retry;
  reconcile first.
- `AMBIGUOUS`: neither is proven. No automatic retry.

| Create | Evidence | Class | Policy today |
|---|---|---|---|
| Odoo `product.template` create | Odoo 17 `product_product.py` has no constraint on `default_code` (only an onchange warning) and the JSON-RPC call has no idempotency key. A lookup by `default_code` cannot tell a record from this attempt from an older one. | `AMBIGUOUS` (**`AMBIGUOUS_CREATE_OUTCOME`**) | `NO_AUTOMATIC_RETRY` |
| Etsy `createDraftListing` | The published OpenAPI spec mentions idempotency nowhere; the create body does not list `sku`; the listings read filters by `state` but not by any key. | `AMBIGUOUS` (**`AMBIGUOUS_CREATE_OUTCOME`**) | `NO_AUTOMATIC_RETRY` |
| Dynamics 365 `POST /items` | Microsoft documents nothing about duplicates or idempotency for the create. The connector sends `number: sku` (a client-supplied key); only third-party integrator documentation says a duplicate item number errors. | `AMBIGUOUS` until proven against a sandbox | `NO_AUTOMATIC_RETRY` |
| WooCommerce `POST /products` | `WC_Product::set_sku` rejects a duplicate SKU with `product_invalid_sku`, and a new product has `object_read` true, so it applies to REST creates. It is an application check (`is_existing_sku` SELECT, then insert), not a database constraint: not atomic, disabled by the `wc_product_has_unique_sku` filter, skipped for an empty SKU. `GET /products?sku=` reconciles. | `PROVEN_RECONCILABLE` (with the settle-time rule below) | `NO_AUTOMATIC_RETRY` on the create; the update (`PUT`) keeps the default |
| BigCommerce `POST /catalog/products` | The published spec returns 409 for "duplicate unique values, such as name or SKU" and describes `sku` as unique; no idempotency header. A retried create is rejected, not duplicated, but the job-level replay then reports a failure although the product exists. | `PROVEN_RECONCILABLE` | reconciled by lookup (3b-B, see below); the create itself is a single attempt already |

`RETRY_WITH_IDEMPOTENCY`: current users = 0. None of the five providers above offers an
idempotency key, so no connector selects it. It stays in the framework as a valid future
capability; no provider user is invented for it.

### Rules this establishes

1. **Absence from a lookup right after a lost response does not prove the create failed.** The
   provider may still be executing the original request. Reconcile-then-recreate is only allowed
   after the provider's maximum request time has passed, or with a unique marker the lookup can
   match. WooCommerce's existing SKU lookup is reconciliation evidence for the next attempt, not a
   reason to repeat a create immediately.
2. **A create is never reported as a success without a provider-confirmed id.** Odoo's create now
   fails with `AMBIGUOUS_CREATE_OUTCOME` if the response carries no record id (for example a proxy
   5xx with a JSON body), instead of recording SUCCESS.
3. **A 401 proves the request was refused**, so Etsy's refresh-token-and-resend inside
   `fetchWithTokenRetry` is kept: the resend is of a request the provider rejected before executing.

## Exposure by connector (read from `main`, 2026-10-05)

| Connector | Create path | HTTP-layer retry | Job-level retry | State |
|---|---|---|---|---|
| Odoo `product.template create` | `httpClient` | **removed** (3b-A) | no (network errors are wrapped as `OdooPublishError`) | one attempt |
| Etsy create-draft listing | `ctx.fetch` | **removed** (3b-A) | no | one attempt |
| Dynamics 365 `POST /items` | `ctx.fetch` | **removed** (3b-A) | no | one attempt |
| WooCommerce create | `callApi` through `httpClient` | **removed** (3b-A) | after a lookup by SKU | one attempt |
| BigCommerce create | raw `fetch` | no | **yes** (retryable `ConnectorNetworkError`) | reconciled (3b-B): a replay returns the product that already exists |
| Shopware, PrestaShop, Zoho Inventory, eBay offer | raw `fetch` or pinned transport | no | no | single attempt; a manual resubmit re-creates |
| Amazon (PUT by SKU), Flipkart | `ctx.fetch` | yes | no | SKU-keyed; unverified |

### Duplicate-prone writes not changed in 3b-A

Left on the default policy on purpose (they are not the four identified creates): WooCommerce
category/tag creation (`POST /products/categories|tags`) and variation creation, Etsy image upload,
every update, read and authentication call. They are candidates for a later classification pass.

## Sequence

1. Done (3a): the policy framework, tests and log. No connector behavior changes.
2. Done: read-only provider-semantics check (above).
3. This change (3b-A): `NO_AUTOMATIC_RETRY` on the four shared-client creates; reads, auth,
   updates and other writes unchanged. Consequence: a transient failure on one of these creates now
   surfaces instead of being silently retried.
4. Done (3b-B): BigCommerce. The job-level replay no longer reports a failure for a product that exists
   (see "BigCommerce create reconciliation").
5. 3c: record a PENDING submission before the provider call so an ambiguous timeout reads as
   "outcome unknown", not "failed", and give Odoo and Etsy a trustworthy reconciliation strategy.

## BigCommerce create reconciliation (3b-B)

This is a **reconciliation-safe create**, not an idempotent one. BigCommerce offers no idempotency key and
the create itself is not idempotent; the workflow is made safe by finding the already-created resource
before another create can be sent (pre-create lookup, and a second lookup after a 409). Classification:
`PROVEN_RECONCILABLE`, never `PROVEN_IDEMPOTENT`.

A failed export job is replayed from the top and BigCommerce has no idempotency key. It does enforce
unique SKUs and names (409), so a replayed create cannot duplicate the product; the defect was that
the replay reported a failure for a product that exists.

`publishProduct` now:

1. looks the SKU up (`GET /catalog/products?sku=`, exact match on the returned row; a lookup that
   fails is thrown before anything is created, so it is always safe to repeat);
2. if a product is there and **matches what this create would have made** (same SKU and same name),
   returns it as the result (`externalRef` = its id) and logs `bigcommerce.create.reconciled_existing`;
3. if a product is there with the same SKU but a different name, it is somebody else's: the create is
   not attempted and the existing `DuplicateSKUError` is raised (`bigcommerce.create.sku_conflict_not_reconciled`).
   A merchant's own product is never reported as published;
4. otherwise creates; if the create answers 409, looks the SKU up once more, because an earlier
   attempt may have finished between the first lookup and this create (the settle-time rule: an empty
   first lookup does not prove the earlier attempt failed). A match is reconciled; anything else
   surfaces the original conflict.

The provider's uniqueness rule is what makes step 4 safe: the worst outcome of the race is a 409,
never a second product. An empty SKU skips the lookup (uniqueness is not enforced on it).

Cost: one extra `GET` per first publish. A same-SKU product with a different name remains a conflict
even if it was in fact created by an earlier attempt that BigCommerce renamed; that is a deliberate
bias toward reporting a conflict over claiming someone else's product.
