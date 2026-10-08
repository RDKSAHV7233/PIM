# SEC-DB-RLS-001 P2.8a: the Stripe webhook finds a non-default tenant's customer under the restricted role

Date: 2026-10-09
Baseline: `origin/main` at `d812665d` (#1267)
Type: **source + test change.** No production effect until merged and deployed; no credential, flag, role, policy or configuration is changed. **No generic bypass and no cross-tenant policy is added; no schema change.**

State: **IMPLEMENTED and TESTED locally.** Not MERGED, DEPLOYED or RUNTIME_VERIFIED at the time of writing.

First slice of the "class C" items. This one did not need a product or security decision: the inventory's "decision-needed" label covered a choice between iterating tenants and adding a new lookup structure, and iterating the tenants through the existing `forEachTenant` needs neither a new table nor a new abstraction.

## 1. The defect

`StripeService.resolveTenantKeyFromCustomerId` answers "which tenant owns this Stripe customer id" for the webhook controller, before any tenant context exists. It was one query on `TenantPlanProfile` (tenant-keyed, row-level-secured) through `PrismaService.tenant()` with no tenant argument, which means the default tenant's context.

Under a restricted role that query sees **only the default tenant's profile**. For every other tenant the lookup returned `null`; the controller then logged "no tenant found for customer" and **acknowledged the event**. An `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated` or `customer.subscription.deleted` for a non-default tenant would therefore never change that tenant's billing state: no activation after payment, no grace period after a failed payment, no cancellation. Nothing would alert, because the path looked like a normal "unknown customer".

(The other eight raw statements in the file target `stripe_webhook_events`, a non-RLS global ledger keyed on Stripe's globally unique event id, and are unchanged.)

## 2. Change (`apps/api/src/billing/stripe.service.ts`)

- The lookup runs **per tenant** through the existing `forEachTenant` (one short transaction per tenant, tenant context set inside it, 3 second per-tenant timeout), the query also filtered by the tenant it is given. `StripeService` gains the direct client as a required constructor dependency, only as the carrier of those transactions.
- **Exactly one match:** that tenant. **More than one:** throws `STRIPE_CUSTOMER_TENANT_AMBIGUOUS` (a data fault, never pick one).
- **No match while every tenant was readable:** `null`, as before (an unknown customer).
- **No match while any tenant could not be read:** throws `STRIPE_CUSTOMER_TENANT_READ_FAILED n/m [tenant:code]` (stable codes, never a database message). The webhook controller's existing handler marks the event failed and rethrows, so Stripe sees HTTP 500 and **retries**; an unreadable tenant can never turn into "no tenant found" and a dropped event.
- A match in a readable tenant is returned even when another tenant is unreadable.
- **Orphan limit (stated):** a tenant with a profile but no directory row is not reached by the iteration. The previous context-free lookup is kept as a **last, best-effort step** (its failure is swallowed), so today's deployment, whose role bypasses row level security, still finds such a tenant exactly as before. Under a restricted role that step adds nothing.
- Webhook controller, signature check, event reservation and the ledger statements are unchanged.

## 3. Evidence

| Check | Result |
|---|---|
| `stripe.service.spec.ts` (12 tests; the 5 earlier unchanged apart from the constructor argument, 7 new): RLS-faithful fake whose every transaction has its own tenant context | pass: a non-default tenant's customer resolves; unknown customer returns null; blank id returns null without querying; unreadable tenant with no match throws and does not leak the message; a match in a readable tenant survives another tenant's failure; two tenants with one customer id throws; the orphan step still finds a no-directory tenant |
| Mutation: iterate the default tenant only | 4 of 12 fail |
| Real-database test `stripe-customer-tenant-resolution-restricted-role.test.cjs`: isolated migrated DB, the real service in a child process whose database environment is `vexa_runtime_ci` (NOSUPERUSER NOBYPASSRLS non-owner); one Stripe customer on each of two non-default directory tenants and the default tenant | pass: each customer resolves to its own tenant, an unknown customer to none; **the former context-free lookup, run in the same child, resolves the default tenant only (null for both others)**, so the fixture is shown to be sensitive to the bug |
| Mutation: iterate the default tenant only, in the built service | the real-database test **fails** (`tenant A's customer resolves to tenant A`); dist restored byte-identical |
| Lane | `scripts/restricted-role-lane.v1.json` 42 → 43 tests; config test passes |
| `validate-sec-db-call-sites.cjs` | pass: the file now references the direct client (29 files, all open), 10 raw SQL sites; entry reclassified C → A (tenant iteration), stays `open` under the ratchet's definition |
| `tsc -p tsconfig.build.json --noEmit`; `jest src/billing` | clean; 14 suites / 223 tests pass |

## 4. What this does not do

It does not change `vexa_app_v2`, `DATABASE_URL`, any credential, flag, tenant, role, policy or Stripe configuration, and does not claim cutover readiness. It does not touch the other class C items (auth lookups, commercial requests, tenant directory, media unsigned branch), which still need decisions. The restricted-runtime cutover remains `CUTOVER_BLOCKED`.

Cost note: a webhook now does one short query per directory tenant (bounded concurrency, 4 by default) instead of one. At pilot scale this is milliseconds; if the tenant count grows by orders of magnitude, a customer-to-tenant lookup keyed on the Stripe id (or the `tenantKey` already placed in the Stripe customer metadata at creation) would be the next step, and that is a design decision for later, not needed now.

## 5. Rollback

Revert the PR. The single context-free lookup returns, which is correct only for the current superuser runtime.
