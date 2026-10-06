# SEC-DB-RLS-001 M1b: connectors use the tenant client for their own tenant

Date: 2026-10-06
Baseline: `origin/main` at `9454c30d`
Issue: #1189. Plan: #1193 (M1 to M6). Previous step: M1a (#1200). Lane: #1195.
Type: **application change, no production behaviour change today** (the production runtime role is still a superuser, so row level security is bypassed either way). It makes the connector read and write path correct for the day the runtime role is restricted.

## 1. What changed

- New `connector-framework/tenant-db.ts`: `tenantDb(prisma, fallback, tenantKey)` returns `prisma.tenant(tenantKey)`. **A blank tenant is refused** (`MissingConnectorTenantError`): `PrismaService.tenant("")` quietly means the default tenant, which is exactly the silent failure this programme exists to remove.
- 15 files swap `this.prismaDirect.getClient()` for `tenantDb(this.prisma, this.prismaDirect, <tenant>)` at **40 call sites**: the Amazon, BigCommerce, Dynamics 365, eBay, Etsy, Flipkart, Myntra, Odoo, PrestaShop, Shopify, Shopware, WooCommerce and Zoho connectors, and the WooCommerce brownfield-import and bulk-publish services. The tenant is the one each function already uses for its own data (`ctx.tenantId`, or the explicit `tenantKey` parameter where there is one).
- Two WooCommerce helpers (`checkWebhookHealth`, `loadRecentSubmissionSummary`) took only an `installationId`; they now also take the tenant, and their three callers pass `ctx.tenantId`.
- Each class gains an **optional last constructor argument** `prisma?: PrismaService`. Nest always injects it. It is optional only so that the many tests that build a connector by hand (and run as the admin identity) are unchanged; without it the old direct client is used. Removing that fallback is M1c.

## 2. Tests that prove it, not just "no error"

- `connector-framework/tenant-db.spec.ts` (9 cases): tenant client of the right tenant, two tenants get two clients, blank/whitespace/undefined/null refused, fallback only when no tenant client is injected.
- `connectors/connector-tenant-client.spec.ts` (14 cases): for **each of the 13 connector classes**, injects a tenant client and a direct client that throws if touched, calls the connector's own credential and metadata helpers for a non-default tenant, and asserts the direct client was never used, every tenant client requested was that tenant's, and at least one helper really ran. Mutation check: putting one direct-client call back in the Flipkart connector fails the Flipkart case.
- Unit suites for all connectors: 755 pass.
- Restricted-role lane: see section 4.

## 3. Findings

1. **`media.service.getAssetFile` is not a mechanical swap.** It is a public, unauthenticated route that serves an asset by id for external systems (for example Shopify fetching product images). No tenant is known there. Under RLS the lookup sees only the default tenant, so **every other tenant's images would 404** after the role cutover. The inventory classed it B with a mechanical fix; it is reclassified to class C, decision needed (tenant in the public path, a signed token, or a narrow lookup function). Not changed here.
2. **`woocommerce-reconciliation.service` stays out of M1b.** It is already class A (a cross-tenant sweep) and belongs with M3.
3. **Blank tenants previously read nothing; they now throw.** `where tenantKey: ""` used to match no row. Through the tenant client it would have meant the default tenant, so the helper refuses it. Two WooCommerce health helpers swallow errors by design (`.catch(() => null)`), so a missing tenant there degrades to "unknown", as before.

## 4. Restricted-role lane

Local run: PostgreSQL 16, API built from this branch, preload pointing the API at `vexa_runtime_ci` (NOSUPERUSER, NOBYPASSRLS, non-owner). **27 pass, 1 tracked expected failure (M2, tenant provisioning), 0 unexpected failures, 0 unexpected passes.**

- `connector-idempotency-semantics` (the M1 baseline entry) now **passes as the restricted role**: a Flipkart publish for a non-default tenant refreshes and stores its credentials and completes. Its entry is removed from `expectedFailing` (the ratchet requires it).
- Five more connector tests, run as candidates, pass as the restricted role and are added to the lane: `flipkart-install-credentials`, `flipkart-token-expiry-alerting`, `shopify-publication-webhook`, `shopify-runtime-foundation`, `woocommerce-credential-verification-endpoint`. The lane grows from 23 to 28 tests.
- Ten other connector tests (Amazon x4, Flipkart auto-status-sync, publish-job, runtime-foundation, status-sync, update-retry, and Myntra runtime-foundation) failed as the restricted role **and also fail as the admin identity on this machine** (for example the Myntra one hits a missing connector-definition foreign key). Their failure is therefore not caused by row level security and says nothing about it; they are **not** added to the lane and **not** given a baseline reason I have not verified. They look unwired or stale locally and are worth a separate look.

## 5. Not in M1b

- The optional direct-client constructor fallback (M1c).
- `media.service.getAssetFile` (decision), `woocommerce-reconciliation.service` (M3), `media-integrity.service` (M3), the two credential-rotation sweeps (decided: tenant iteration, next piece of work).
- No production access, no credential change, no role change.
