# SEC-DB-RLS-001 I-2: tenant provisioning seeds default pricing through the tenant client

Date: 2026-10-07
Baseline: `origin/main` at `ef144449` (`CI` green on attempt 2; attempt 1 had an unexplained one-off, see PR #1205)
Issue: #1189. Increment I-2 of the approved sequence.
Type: **application change, no production behaviour change today** (the production runtime role is still a superuser). No production access, no credential or role change, no AI provider path.

## 1. The failure this closes

`TenantDirectoryService.provisionWorkspace` seeds a new tenant's default pricing (India market, INR currency, default price list). It did so through the context-free direct client and wrapped the call in `.catch(warn)`. `Market`, `Currency` and `PriceList` are row-level-security tables, so under a restricted runtime role every insert is rejected, the rejection is swallowed as a "non-fatal" warning, and **every new tenant is created without pricing while provisioning reports success**. Every earlier test passed because none of them asserted the pricing existed; this was the last tracked expected failure in the restricted-role lane (`tenant-provisioning-default-pricing.test.cjs`, reproduced and recorded in #1195).

## 2. Change

- `seedDefaultPricing(tenantKey)` now runs on `this.prisma.tenant(tenantKey)`, the client of the tenant being provisioned, for both the "already seeded?" check and the creating transaction. The old comment's worry, that the tenant client "restamps tenantKey = default", applies only to `tenant()` with no argument; with an explicit tenant the extension stamps the tenant being provisioned (and the code already passed that same key).
- **A failed seed is no longer a quiet warning.** Provisioning still succeeds (a seed problem must not block sign-up), but the failure is logged at **ERROR** with a stable, matchable code: `TENANT_DEFAULT_PRICING_SEED_FAILED tenant="<key>": the tenant was provisioned WITHOUT default pricing: ...`.
- The remaining direct-client use in this file is `WorkspaceDirectory` and `AuthIdentity`. **Neither has row level security** (confirmed in the lane database: `AuthIdentity rls=false`, `WorkspaceDirectory rls=false`; also the production probe), so they stay on the direct client, and the file stays `open` in the inventory with its plan updated.
- The lane baseline is now **empty**: the last tracked expected failure is removed (the ratchet requires it, since the test now passes).
- `validate-sec-restricted-lane.test.cjs` assumed the baseline always had an entry; its negative tests now create their own, so they no longer depend on the live baseline being non-empty.

## 3. Evidence

- **Unit (7 tests):** a non-default tenant gets a market, a currency and a price list, each created for that tenant (positive, with the data asserted: IN/INR/default); two tenants get two different tenant clients; a tenant that already has a market is not seeded again (idempotent); the direct client's pricing models throw if touched and are not; a failing seed does not block provisioning **and is logged once as an ERROR with the code, the tenant and "WITHOUT default pricing"**. **Mutation check:** reverting the seed to the direct client fails 3 of them.
- **Real PostgreSQL, restricted role (NOSUPERUSER, NOBYPASSRLS, non-owner):** `tenant-provisioning-default-pricing.test.cjs` now **passes** (it was the tracked failure). **Mutation on the built code:** with the seed put back on the direct client it fails with `markets=0 currencies=0 priceLists=0`, the silent failure itself.
- **Full lane with an empty expected-failure baseline: 28 pass, 0 expected failures, 0 unexpected failures, 0 unexpected passes.** This is the first time the baseline is empty. Neighbouring unit suites (`common/tenant`, `auth`): 189 pass; ratchet and lane validators pass.

## 4. Limits

- The integration test's *diagnostic text* still looks for the old warning wording (its assertion, non-empty pricing, is unchanged and is what fails on a regression, as the mutation run showed). Updating the text is a one-line change deferred to a later PR to keep this one within three risk domains.

- A seed that fails is now loud, but it is still non-fatal, so a tenant can still end up without pricing; the ERROR is the signal, and an alert on that code is an operational follow-up, not part of this change.
- Provisioning performs its directory and identity writes and the pricing seed as separate steps, as before; making them one transaction is a separate design change.

## 5. Next

I-3 billing jobs (grace-period, commercial-reminders, outbound-webhooks, then plan-usage as its own PR), each with the discover-and-act assertion. Pending human steps unchanged: labels on #1204 (and #1205 if the guard asks), then merges one at a time.
