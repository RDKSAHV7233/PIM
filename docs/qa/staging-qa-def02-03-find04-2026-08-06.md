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

**Result: PASS (live E2E-verified)**

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

### Earlier blocked attempt (superseded)

- WooCommerce connector on staging was initially `CREDENTIAL_EXPIRED` — no active store to publish against.
- Attempted to force a live DNS-failure trigger by reinstalling the connector (same `primary` alias) with a deliberately unreachable store URL. The connector install flow (`installConnectorAction` → `POST /connectors/{slug}/install`) performs **synchronous connectivity validation before persisting** — the attempt failed immediately with `installError=install_failed` and nothing was saved, confirming this path can't be used to reach the async retry logic.
- One pre-existing WooCommerce submission (`b6ab2839…`, dated before this fix shipped) showed the old raw `"fetch failed"` error — predates the fix.

### Live E2E verification (2026-08-06)

A real WooCommerce store (`web.vexapim.com`) was reconnected to the `primary` installation, bringing it to `ACTIVE`/healthy. The stale queued job on submission `b6ab2839…` was driven through its lifecycle via the "Process" action in the product's Channels tab, and a **genuine transient network failure** occurred against the real store on the first attempt:

| Attempt | Job status | Retry position | Message |
|---|---|---|---|
| 1 | `Retrying` | 1/3 | "Transient network issue contacting woocommerce store. The system will retry automatically." |
| 2 | `Retrying` | 2/3 | Same actionable message — never reverted to a raw error string |
| 3 | `Export blocked` (terminal) | 3/3 | Retries exhausted — dead-letter path confirmed |

- Submission `b6ab2839…` attempt count climbed from 1 → 4 across the retry cycle, correctly recorded.
- Submission detail `channelErrors` confirmed structured exactly as designed:
  ```json
  {"code": "CONNECTOR_NETWORK_NETWORK", "fieldPath": null, "severity": "error", "sellerMessage": "Transient network issue contacting woocommerce store. The system will retry automatically."}
  ```

**Decision:** Closed as fully pass, E2E-verified. Retry, dead-letter, and structured actionable messaging all confirmed live against a real store — matching the unit-level behavior exactly. GitHub issue [#455](https://github.com/Vexasaas/PIM/issues/455) closed with this evidence.

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
| DEF-02/03 | WooCommerce network error retry & messaging | **PASS** (live E2E) |
| FIND-04 | WooCommerce custom meta fields in mapping UI | **PASS** |
| ENV | Deploy pipeline health | **PASS** |

---

## Final Readiness Decision

```
Internal QA:            PASS (4 of 4 fully verified live)
Deploy pipeline:         GREEN
Production readiness:    No known blockers from this QA pass
```

All four tracked items are closed with a full pass, all verified live on staging. DEF-02/03 was upgraded from code-verified to fully E2E-verified after a real WooCommerce store was connected and a genuine transient network failure was observed through the complete retry → dead-letter lifecycle.

---

## Immediate Next Actions

None outstanding from this QA pass. All four items closed with live evidence.

Full test evidence captured via Claude Browser session; QA report artifact: [QA Test Results — Vexa PIM Deploy](https://claude.ai/code/artifact/f7066691-4eac-49bb-9dfc-fbbc453703c8). Follow-up ticket: [#455](https://github.com/Vexasaas/PIM/issues/455) (closed).
