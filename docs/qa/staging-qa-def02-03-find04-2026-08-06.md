# WooCommerce Connector Publishing Defects — Staging QA Verification Report

**Date:** 2026-08-06
**Environment:** Railway staging (`app.vexapim.com`)
**Commits under test:** `81163f54` (DEF-02/03 + FIND-04 implementation), `2f8bf097` (BullMQ cleanup field names), `c23d4260` (smoke-workspace lookup tool), `ef12f842` (redis-server fix for lookup workflow), `06f94ef6` (post-deploy security-check re-auth fix), `c79be475` (CSRF check target/flags fix)

---

## QA Item 1: DEF-01 — Shopify Bulk Publish Dialog

**Result: PASS**

**Evidence:**
- Bulk publish button is enabled — label reads "Submit bulk publish".
- Approved count badge shows "2 approved products", matching underlying data.
- Confirmation dialog opens on click with correct summary text.
- Dialog component is connector-agnostic (not Shopify-specific) — works for all channels.
- No console errors on the Sync tab page.

**Decision:** Originally suspected code bug; confirmed data-only (no approved products at time of first pass). No code fix needed. Closed.

---

## QA Item 2: DEF-02/03 — WooCommerce Network Error Retry & Actionable Messaging

**Result: CODE-VERIFIED, NOT E2E-VERIFIED**

### What shipped

- `ConnectorNetworkError` (`apps/api/src/connector-framework/connector.errors.ts`) — typed error carrying `category` (`TIMEOUT | DNS | TLS | NETWORK`), `retryable`, and `detail`, with actionable messages:
  - Retryable: "Transient network issue contacting {slug} store. The system will retry automatically."
  - Non-retryable: "Check your {slug} store URL and credentials. {detail}"
- WooCommerce `callApi` (`apps/api/src/connectors/woocommerce/woocommerce.connector.ts`) throws `ConnectorNetworkError` instead of a generic `Error` on network-level failures, using the existing `classifyCallApiFailure` classifier.
- `processExportJob` (`apps/api/src/marketplace/marketplace.service.ts`) retry path: a retryable `ConnectorNetworkError` moves the job to `retrying` status (dead-lettered after `maxRetries`) instead of the terminal `failed` status.
- Structured `channelErrors` in submission recording: `ConnectorNetworkError` produces `CONNECTOR_NETWORK_{category}` codes with the actionable seller message, surfaced in the submission detail UI.

### Unit test coverage

`apps/api/src/connectors/woocommerce/woocommerce.connector.spec.ts` — 5/5 passing:
- Actionable retry message for retryable errors (TIMEOUT)
- Actionable retry message for NETWORK category
- Credential-check message for non-retryable DNS errors
- Credential-check message for non-retryable TLS errors
- `instanceof Error` and `instanceof ConnectorNetworkError` checks

### Live E2E attempt (blocked)

- WooCommerce connector on staging remains `CREDENTIAL_EXPIRED` — no active store to publish against.
- Attempted to force a live DNS-failure trigger by reinstalling the connector (same `primary` alias) with a deliberately unreachable store URL (`https://this-domain-does-not-exist-vexaqa-1786.example`) plus placeholder REST API credentials.
- The connector install flow (`installConnectorAction` → `POST /connectors/{slug}/install`) performs **synchronous connectivity validation before persisting** — the attempt failed immediately with `installError=install_failed` and nothing was saved. This is a different code path from the async export job's retry logic that DEF-02/03 touches, so it cannot be used to reach the retry path.
- Verified no state changed on the connector: External Ref (`https://web.vexapim.com`) and Installed At timestamp are identical before and after the attempt.
- One pre-existing WooCommerce submission (`b6ab2839…`, dated before this fix shipped) shows the old raw `"fetch failed"` error — expected, predates the fix, not usable as post-fix evidence.

**Decision:** Closed as code-verified. The fix is implemented correctly and covered at the unit level; live end-to-end confirmation requires a real (or intentionally flaky) WooCommerce store, which is not available in this environment. Re-open for E2E verification once such a store is connected on staging.

---

## QA Item 3: FIND-04 — WooCommerce Custom Meta Fields in Mapping UI

**Result: PASS**

**Evidence (live, staging):**
- `WooCommerceCustomMetaFields` component (`apps/web/src/components/channel/woocommerce-custom-meta-fields.tsx`) renders as a collapsible "WooCommerce custom meta fields" section between the optional fields group and Advanced tools in the mapping editor, Step 2.
- End-to-end interaction verified: expanded the section, typed `fabric_care`, clicked Add — row rendered as `meta_data.fabric_care →` with a PIM field selector and a remove control.
- PIM field selector correctly wired: `name="mapTarget::meta_data.fabric_care"`.
- Hidden `customMetaTarget` form input submits the target value correctly (`meta_data.fabric_care`).
- Backend support (`parseWooCommerceMetaTarget()`, `compileWooCommerceMetaFromMapping()`, `marketplace.service.ts`) was already deployed and is now fully wired to the UI.

**Decision:** Closed. Pass, verified live end-to-end.

---

## QA Item 4: Deploy Pipeline Health

**Result: PASS (after 3 fixes)**

Three real bugs were found and fixed in the staging deploy pipeline during this verification pass, unrelated to the DEF-02/03/FIND-04 code changes themselves:

1. **BullMQ cleanup step wrong field names** — the inline curl login used `workspace`/`email`; the login DTO expects `workspaceSlug`/`userId`. Fixed in `.github/workflows/deploy-staging.yml`.
2. **Post-deploy security checks reused a revoked JWT** — `staging-postdeploy-check.cjs` deliberately revokes its `token` variable via a logout probe (to verify logout works), then reused that same dead token ~90 lines later for `verifyCsrfToken`/`verifyDatabaseSeed`/`testBulkImportCsrfFlow`, causing spurious `TOKEN_REVOKED` failures. Fixed by minting a fresh token immediately before that section.
3. **CSRF cookie check targeted the wrong endpoint with backwards assertions** — `verifyCsrfToken` called the API's `privacy-status` endpoint with a Bearer token and expected an `httpOnly`, `SameSite=Strict` cookie. The API has no code path that sets `pim_csrf_token` at all; it's only set by the web app's own login route (`apps/web/src/app/api/auth/login/route.ts`), and is intentionally `httpOnly:false`/`SameSite=Lax` so `apps/web/src/lib/csrf.ts` can read it via `document.cookie` for the double-submit CSRF pattern. Fixed to check the web login response with the correct flags.

**Evidence:** Deploy pipeline is green end-to-end as of run `31040456247` (all 24 steps, including post-deploy verification, public signup smoke check, and E2E smoke).

**Decision:** Closed. Deploy pipeline fixed and green.

---

## Summary

| QA Item | Description | Result |
|---------|-------------|--------|
| DEF-01 | Shopify bulk publish dialog | **PASS** |
| DEF-02/03 | WooCommerce network error retry & messaging | **CODE-VERIFIED** (not E2E) |
| FIND-04 | WooCommerce custom meta fields in mapping UI | **PASS** |
| ENV | Deploy pipeline health | **PASS** |

---

## Final Readiness Decision

```
Internal QA:            PASS (3 of 4 fully verified; 1 code-verified pending real store)
Deploy pipeline:         GREEN
Production readiness:    Blocked only by DEF-02/03 E2E gap
```

All four tracked items are closed. DEF-01, FIND-04, and deploy pipeline health are fully pass and live-verified. DEF-02/03 is closed as code-verified — implementation and unit-test coverage are solid, but live E2E confirmation is blocked purely by the lack of a real WooCommerce store on staging, not by any known defect.

---

## Immediate Next Actions

1. Connect a real (or intentionally flaky) WooCommerce store to staging to close the DEF-02/03 E2E gap.
2. Once connected, trigger a genuine network failure (e.g. temporarily block the store's DNS/IP at the network level, or use a store with an expiring cert) and confirm: job moves to `retrying` status, dead-letters after `maxRetries`, and the submission detail UI shows the `CONNECTOR_NETWORK_{category}` actionable message.
3. No further action needed on FIND-04 or DEF-01.

Full test evidence and screenshots captured via Claude Browser session; QA report artifact: [QA Test Results — Vexa PIM Deploy](https://claude.ai/code/artifact/f7066691-4eac-49bb-9dfc-fbbc453703c8).
