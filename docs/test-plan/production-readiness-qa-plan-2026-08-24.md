# Production-Readiness QA Test Plan — Shopify + WooCommerce Customer Journey

## 0. Front matter

**Claim under test:** "Shopify and WooCommerce are production-ready for **Paid Controlled Pilot**." This is explicitly **not** a GA, broad-commercial, or enterprise-readiness claim — see [§8 Claim framing](#8-claim-framing) for exactly how results should be worded.

**Environment:** `app.vexapim.com` (production), plus real connected Shopify and WooCommerce pilot stores where a case requires confirming state on the provider side (not just inside Vexa).

**Method:** Every case executes through the real UI (or a documented API call standing in for a UI action already covered by other tests, per existing repo convention — e.g. `journey-admin-product-to-publish.spec.js` creates fixtures via API to isolate what each test actually verifies). No API/DB shortcut substitutes for the customer-facing outcome itself.

**Source documents this plan builds on (read, not duplicated):**
- `docs/test-plan/shopify-e2e-browser-journey-qa.md` — existing manual, page-by-page, all-tier Shopify plan.
- `docs/test-plan/full-e2e-sweep-results.md`, `journey-1-execution-results.md`, `csv-import-validation-results.md` — prior executed-results precedent this plan's results file follows.
- `docs/test-plan/rbac-matrix.json` — canonical 8-role RBAC source of truth, generated from `@Roles()` decorators.
- `apps/web/test/e2e/*.spec.js` — 70 Playwright specs; the specific ones reused are cited per case below with exact `path:line`.

**Case types:**
| Tag | Meaning |
|---|---|
| `REUSE` | Existing automated/manual coverage directly satisfies this case. Cited with exact current `path:line`. |
| `NEW` | No adequate current test exists; must be authored/executed for this plan. |
| `NEG` | Behavior that is **currently known broken** and deliberately expected to reproduce. A NEG case **passes** when the documented negative behavior is reproduced exactly as described — it does **not** mean the underlying capability is healthy. |
| `OOS` | Explicitly out of scope for this pilot claim. Logged so the omission is visible, never silently dropped. |

This is the authoritative, locked four-type taxonomy — no fifth type. **Regression intent for a fixed historical bug is encoded within `REUSE`/`NEW`, not as its own type**: the case's `Known-Issue Ref` column carries the historical issue number, and its purpose/notes explicitly say `Regression target: #<issue>` — e.g. a case proving the fixed #600 Shopify variant-edit crash stays fixed is `Type: REUSE` (or `NEW` if no existing test covers it), `Known-Issue Ref: #600`, purpose `Regression target: #600`. A case tagged this way failing is a real incident (a fixed bug came back), exactly as significant as it would have been under a separate type — the taxonomy stays four-wide, the signal isn't lost.

**Priorities:**
| Tag | Meaning |
|---|---|
| `P0` | Claim-blocking. The literal day-one journey for both connectors, plus any known-risk behavior sitting directly on that journey. |
| `P1` | Important; a failure ships under a documented pilot limitation, doesn't retract the claim. |
| `P2` | Hardening/backlog; doesn't affect this pilot claim either way. |

## 1. Scope and non-goals

**In scope:** Shopify direct-token/custom-app connection; WooCommerce REST credential connection; onboarding; connector setup; connector health; catalog creation/import; quality/readiness; approval; fresh publish; bulk publish; multi-variant publish; edit + republish; error/recovery; plan/billing; account/session/RBAC; controlled connector disable/offboarding.

**Out of scope, with reasons:**
- **Shopify managed OAuth install** — the pilot commercially offers direct-token/custom-app only; managed OAuth was never verified against a real store in any prior audit pass and remains outside this claim regardless.
- **Connectors other than Shopify/WooCommerce** (Amazon, Flipkart, Meesho, Myntra) — not part of this claim.
- **Broad GA/enterprise readiness** — this plan certifies the pilot tier only.
- **Provider webhook subscription creation** — still unverified whether Shopify webhook subscriptions are actually created at install time. One P2 smoke case is kept (§6.9) so this gap stays visible rather than silently dropped.
- **External pricing website, Sales collateral, contracts/order-form, onboarding-doc alignment for #593** — #593's product-definition decision ("One SKU means one sellable product variant. Parent product records are not counted separately.") is **complete and in-app copy has already been browser-verified** across the Plan & Usage meter, Compare Plans card, and limit-reached modal. Only the external commercial surfaces remain outside this repo's scope, tracked on #593 (still open for that reason alone, not a product-definition ambiguity). §6.10 includes one `OOS` pointer case, not a pass/fail test.
- **#475 / #476 fabricated runtime scenarios** — both require a genuine external trigger (a real Flipkart LIVE_API failure state; a real STATUS_SYNC-capable async connector result) that doesn't currently exist in this environment. Do not manufacture one merely to close a checkbox — both stay `OOS`, deferred.
- **Fake provider failures / fake external account state** — no case in this plan simulates a provider outage by fabricating data; #653/#655 (below) are tested by observing real behavior, not staged failures.

## 2. Test-case ID scheme

`PRQ-<STAGE>-<CONNECTOR>-<SEQ>`

**Stages:** `ONB` `CON` `CAT` `APR` `PUBF` `PUBB` `PUBV` `EDT` `ERR` `BIL` `ACC` `OFF`
**Connector:** `SHF` (Shopify) / `WOO` (WooCommerce) / `X` (connector-agnostic — authored once, executed for both where applicable)

Example: `PRQ-PUBB-WOO-003`

Every case record includes: **ID, Priority, Type, Connector, Preconditions, Fixture, Steps, Expected result, Evidence required, Source / Known-issue ref, Cleanup/restoration** (where applicable).

## 3. Priority tiering

- **P0** — the actual day-one customer journey for **both** connectors: connect → build catalog → get approved → publish (fresh, bulk, multi-variant) → edit and republish. A known-risk behavior sitting on this path is never silently omitted — it becomes an explicit `NEG` case (currently broken) or a `REUSE`/`NEW` case carrying a `Regression target:` note (previously broken, now fixed) at P0, not a skipped row.
- **P1** — secondary paths a real pilot customer hits within the first weeks: reconnect/credential rotation, RBAC boundaries, plan-limit edges, offboarding, error-message quality.
- **P2** — hardening/backlog: edge-case input data, cross-tier repeats of connector-agnostic behavior, the webhook-subscription smoke case.

## 4. Fixture strategy

**Tenant:** shared production tenant (per user decision — no clean-tenant provisioning blocker). Every QA-created fixture uses the prefix `QAPILOT-<YYYYMMDD>-<SEQ>` in its title, SKU (where the field supports one), and any other searchable identifier, so results stay greppable/auditable without touching the tenant's other 21,000+ existing rows (per issue #586's own finding on catalog composition — #586 itself stays untouched by this plan; it's a Delivery/demo-cleanliness concern, not a pilot-readiness blocker).

**Connector installations:** created once per connector per this test pass, then reused across every case in that connector's suite — not reinstalled per case (avoids burning live-API calls and rate limits against real Shopify/WooCommerce stores).

**Catalog fixtures:** fresh per test for publish/edit/bulk cases specifically, to avoid state bleed between fresh-publish, republish, and bulk scenarios. Bulk-test fixtures are dedicated (their own `QAPILOT-` batch), never reused from single-item publish tests.

**Offboarding (§6.12):** dedicated, isolated connector installation — never the shared install used by every other stage. Run last. Requires an explicit **HUMAN GO/NO-GO** logged inline in the results file before any disable/uninstall/credential-revoke action executes. Never run against the shared/bulk-test tenant fixtures.

## 5. Results tracking

See the companion file `docs/test-plan/production-readiness-qa-results-2026-08-24.md`. Columns (exact):

`ID | Priority | Type | Step | Expected | Actual | Result | Evidence | Known-Issue Ref | Fixture/Tenant | Date | Tester`

**Result values:** `PASS` / `FAIL` / `BLOCKED` / `SKIPPED (OOS)`.

**Evidence is mandatory** for: every `P0` result (including `PASS`), every non-`PASS` result, every `NEG` result, and every case carrying a `Regression target:` note. Acceptable evidence: screenshot, visible Vexa confirmation, Shopify/WooCommerce store-side confirmation, submission ID, job ID, error digest, or a safe (non-secret) server log line.

**Never record:** API keys, access tokens, consumer secrets, passwords, OTP/MFA codes, or full sensitive payloads — matching this project's standing credential-handling discipline throughout every prior audit pass.

**Executive rollup:** independent Shopify vs. WooCommerce columns, split by P0/P1/P2 — the two connectors' maturity is never averaged into one number (see §8).

---

## 6. Customer journey test cases

### 6.1 Onboarding

Connector-agnostic. Covers: tenant access, correct plan surfaced, operator navigation, Products/Connectors area reachability, and the expected (non-empty, shared-tenant) catalog-list behavior.

| ID | Pri | Type | Steps (summary) | Expected | Source |
|---|---|---|---|---|---|
| PRQ-ONB-X-001 | P1 | REUSE | Log in, open dashboard, open Products list | Dashboard loads; Products list renders without error | `apps/web/test/e2e/journey-admin-product-to-publish.spec.js:53` (admin can open product list) |
| PRQ-ONB-X-002 | P1 | NEW | Search catalog for a non-existent SKU/query | UI shows the exact string "No products match your search" (confirmed current copy: `apps/web/src/components/product/products-tab.tsx:1188`, rendered when `searchQuery.trim().length > 0`), not the zero-products onboarding state ("No products match this view") | No existing e2e test covers this — searched the full `apps/web/test/e2e/` suite for zero-match/no-results search assertions, none found. Was previously mis-cited to `journey-day1-tenant.spec.js`, whose actual tests (dashboard/products-onboarding-checklist/categories/channels/operations/quality/settings page loads) don't cover search-result messaging at all |
| PRQ-ONB-X-003 | P1 | NEW | Search catalog for a non-existent SKU on the shared 21,000+-row tenant specifically (distinct from `PRQ-ONB-X-002`'s general case: this confirms the fix holds against the large real dataset, not just a small/empty catalog) | Correct "No products match your search" copy renders (not the pre-fix onboarding-empty state). Regression target: #613 | No existing test — same gap as `PRQ-ONB-X-002`, this is the large-tenant variant. Known-Issue Ref: #613 (closed 2026-08-18) |
| PRQ-ONB-X-004 | P2 | NEW | Confirm current plan tier badge matches actual tenant tier | Plan badge is accurate | `docs/test-plan/shopify-e2e-browser-journey-qa.md` Journey 1 (tier reference) |
| PRQ-ONB-X-005 | P1 | NEW | Create one `QAPILOT-<date>-001` fixture product via the real UI (not API) | Product created, visible in catalog, fixture-prefix greppable | New — establishes the fixture-isolation convention this plan depends on |

### 6.2 Connector setup and health

**Shopify:** direct-token/custom-app path is REUSE. **WooCommerce:** no dedicated automated spec exists on current `main` (verified fresh — only one incidental WooCommerce mention across all 70 e2e specs, in `bulk-publish-confirm-dialog.spec.js`) — author `apps/web/test/e2e/woocommerce-connector-setup.spec.js` as part of this plan's NEW cases.

| ID | Pri | Type | Steps (summary) | Expected | Source |
|---|---|---|---|---|---|
| PRQ-CON-SHF-001 | P0 | REUSE | Install with an invalid `*.myshopify.com` domain | Rejected with a domain-validation error | `apps/web/test/e2e/shopify-connector-managed-install.spec.js:52` |
| PRQ-CON-SHF-002 | P0 | REUSE | Complete Shopify direct-token install, save publication targets | Connector reads `ACTIVE`; targets persist | `apps/web/test/e2e/shopify-connector-managed-install.spec.js:131` |
| PRQ-CON-WOO-001 | P0 | NEW | Install WooCommerce with valid Site URL + Consumer Key/Secret | Connector reaches `ACTIVE`; Site URL persists after reload | New spec, mirrors `shopify-connector-managed-install.spec.js:131`'s structure |
| PRQ-CON-WOO-002 | P0 | NEW | Reconnect WooCommerce with invalid credentials | Rejected with a specific, actionable error; existing stored credentials unchanged | New — mirrors the credential-replace valid/invalid/unavailable pattern already verified manually in the sellability audit |
| PRQ-CON-WOO-003 | P0 | NEW | Reconnect WooCommerce with an unreachable Site URL | Distinct "verification unavailable" state, not conflated with "invalid credentials"; existing credentials unchanged | New |
| PRQ-CON-X-004 | P0 | NEG | During install/reconnect on either connector, trigger a real transient validation hiccup (do not fabricate — observe naturally if/when it occurs during this pass; do not force it) | **Currently**: any exception during `validateCredentials()` is swallowed into a generic 400 "invalid credentials," indistinguishable from a real bad password | #653 (open) — record as NEG if reproduced naturally during this pass; do not manufacture the underlying network failure |
| PRQ-CON-X-005 | P1 | NEW | Reload connector detail page after successful install | Connection status persists correctly across reload | No existing test covers reload-persistence specifically. Was previously mis-cited to `channels-connector-detail-drilldown.spec.js:30`, whose only test (`admin can drill from connector portfolio into connector detail and linked product`) covers navigation/drilldown, not reload persistence — no "reload"/"persist" assertion found anywhere in that file |

### 6.3 Catalog build

Connector-agnostic. REUSE-heavy — this stage doesn't know which channel a product will publish to.

| ID | Pri | Type | Steps (summary) | Expected | Source |
|---|---|---|---|---|---|
| PRQ-CAT-X-001 | P1 | REUSE | Create product via API, verify in catalog | Product appears with correct fields | `apps/web/test/e2e/journey-admin-product-to-publish.spec.js:63` |
| PRQ-CAT-X-002 | P1 | REUSE | Edit product fields, confirm persistence | Fields persist after reload | `apps/web/test/e2e/journey-admin-product-to-publish.spec.js:104` |
| PRQ-CAT-X-003 | P1 | REUSE | Edit product via the real browser form (not API) | Form save succeeds, fields persist | `apps/web/test/e2e/journey-admin-product-to-publish.spec.js:133` |
| PRQ-CAT-X-004 | P1 | REUSE | Add a variant via API | Variant created, correctly associated | `apps/web/test/e2e/journey-admin-product-to-publish.spec.js:172` |
| PRQ-CAT-X-005 | P1 | REUSE | Confirm variant appears on the product detail page | Variant visible with correct attributes | `apps/web/test/e2e/journey-admin-product-to-publish.spec.js:197` |
| PRQ-CAT-X-006 | P1 | NEW | Create a `QAPILOT-`-prefixed product with full required metadata (category, required attributes, media, pricing) via the real UI | Product created, 100% completeness, no dependence on any pre-existing tenant row | New — the base fixture most later-stage cases build on |

### 6.4 Quality and approval

Connector-agnostic. REUSE-heavy, plus one regression check on a recently-landed guard.

| ID | Pri | Type | Steps (summary) | Expected | Source |
|---|---|---|---|---|---|
| PRQ-APR-X-001 | P1 | REUSE | Open Quality pages for a product | Pages load with correct readiness data | `apps/web/test/e2e/journey-admin-product-to-publish.spec.js:215` |
| PRQ-APR-X-002 | P1 | REUSE | Open Approval Queue | Queue accessible, shows pending items | `apps/web/test/e2e/journey-admin-product-to-publish.spec.js:233` |
| PRQ-APR-X-003 | P1 | NEW | Remove a required attribute from a `QAPILOT-` fixture, confirm a readiness blocker appears; fill it back in, confirm it clears | Blocker correctly appears/clears | New |
| PRQ-APR-X-004 | P0 | NEW | Move a fixture through `draft → in_review → approved` via the real UI status controls | Each transition succeeds; approved product is publish-eligible | New — this is the literal gate every publish case in §6.5–6.7 depends on |
| PRQ-APR-X-005 | P1 | REUSE | On an `in_review` product, submit a status-only approval decision (no content field touched) via the Content tab's status selector | Approval succeeds — must **not** trip `APPROVAL_CONTENT_CHANGE_CONFLICT` for a genuinely status-only submission. Regression target: #619-class guard fix (commit `b1d5810c`) | `apps/api/test/integration/product-workflow-transitions.test.cjs:301-312` (`toApproved`, asserts `200` for an `in_review→approved` PATCH carrying only the unchanged content fields + `status: "approved"`) — API-level coverage; this case additionally confirms the same holds through the actual Content-tab UI control, not just the raw endpoint |

### 6.5 Publish — fresh single item

Both connectors, P0. Shopify is REUSE; WooCommerce was verified manually earlier this program but has no repeatable automated spec — author one.

| ID | Pri | Type | Steps (summary) | Expected | Source |
|---|---|---|---|---|---|
| PRQ-PUBF-SHF-001 | P0 | REUSE | Publish an approved `QAPILOT-` product with image to Shopify | Job succeeds; Shopify GID persisted in Vexa | `apps/web/test/e2e/shopify-product-publish-journey.spec.js:83` |
| PRQ-PUBF-SHF-002 | P0 | REUSE | Republish the same product immediately after | Idempotent — no duplicate Shopify product created | `apps/web/test/e2e/shopify-product-publish-journey.spec.js:83` (same test covers idempotent republish per its title) |
| PRQ-PUBF-SHF-003 | P1 | REUSE | Attempt publish as `editor` role | 403, correctly denied | `apps/web/test/e2e/shopify-product-publish-journey.spec.js:168` |
| PRQ-PUBF-SHF-004 | P1 | REUSE | Attempt publish as `publisher` / `channel_manager` roles | Both succeed | `apps/web/test/e2e/shopify-product-publish-journey.spec.js:188,209` |
| PRQ-PUBF-SHF-005 | P1 | REUSE | Confirm submission appears on the Submissions page with the correct Shopify GID | Visible, correct reference | `apps/web/test/e2e/shopify-product-publish-journey.spec.js:230` |
| PRQ-PUBF-WOO-001 | P0 | NEW | Publish an approved `QAPILOT-` product to WooCommerce | Job succeeds; real WooCommerce product ID persisted in Vexa **and** confirmed directly in the store's own wp-admin (not just Vexa's submission log) | New — mirrors the rigor already applied manually earlier this program |
| PRQ-PUBF-WOO-002 | P0 | NEW | Republish the same WooCommerce product immediately after | Idempotent — creates/updates the correct product, does **not** silently overwrite an unrelated product. Regression target: #642/#640 | #642/#640 (WooCommerce `findExistingProductId()` idempotency bug, fixed 2026-08-22) — this exact scenario is what originally surfaced that bug live |
| PRQ-PUBF-WOO-003 | P1 | NEW | Attempt publish as `editor` role against WooCommerce target | 403, correctly denied | New, mirrors `shopify-product-publish-journey.spec.js:168` for the WooCommerce target |
| PRQ-PUBF-WOO-004 | P1 | NEW | Confirm submission appears on Submissions page with correct WooCommerce external reference | Visible, correct reference | New |

### 6.6 Publish — bulk

**Full parity required (user decision):** WooCommerce gets the same 5×50-consecutive-run + 51-rejection rigor already proven for Shopify, not a lighter check.

| ID | Pri | Type | Steps (summary) | Expected | Source |
|---|---|---|---|---|---|
| PRQ-PUBB-SHF-001 | P0 | REUSE | Bulk-select 5 / 20 / 46 eligible `QAPILOT-` products, submit | All queued, `queuedCount` matches selection, zero exclusions | `apps/web/test/e2e/bulk-publish-confirm-dialog.spec.js:62`, `apps/web/test/e2e/products-workbench-bulk-publish-return-to.spec.js` |
| PRQ-PUBB-SHF-002 | P0 | REUSE | Bulk-select exactly 50, submit — repeat 5 consecutive times | All 5 runs: `queuedCount=50, excludedCount=0`, consistent. Same full-reconciliation standard as `PRQ-PUBB-WOO-002`: across all 5 runs, **250 submitted = 250 accounted for** (all 250 real Shopify SUCCESS submissions with GIDs, per the prior sellability-audit run this REUSE citation is built on) | `apps/web/test/e2e/products-workbench-bulk-publish-return-to.spec.js` |
| PRQ-PUBB-SHF-003 | P0 | REUSE | Bulk-select 51, submit | Rejected before the expensive eligibility path: `400 batch_too_large`, body includes `ceiling=50, submittedCount=51`; client-side soft-warning also fires pre-submit; **zero** unintended provider-side mutation from the rejected batch | `apps/web/test/e2e/bulk-publish-confirm-dialog.spec.js` |
| PRQ-PUBB-WOO-001 | P0 | NEW | Bulk-select 5 / 20 `QAPILOT-` products targeting WooCommerce, submit | All queued, zero exclusions | New |
| PRQ-PUBB-WOO-002 | P0 | NEW | Bulk-select exactly 50 targeting WooCommerce, submit — repeat 5 consecutive times. For **each** of the 5 runs, prove: submitted=50, accepted/queued=50, exclusions=0, every one of the 50 items' terminal Vexa outcome reconciles (submission/job ID per item), and every one of the 50 items' provider-side WooCommerce outcome reconciles (WooCommerce product ID per item, via a structured run log or a deterministic store-side listing query — not manual per-item screenshots). No unintended duplicates, no silent drops. Any failure maps to exact item/job/submission evidence | All 5 runs: `queuedCount=50, excludedCount=0`, consistent. Across all 5 runs: **250 submitted = 250 accounted for** — full reconciliation, not a sample. Full parity with `PRQ-PUBB-SHF-002` | New — reconciliation evidence may be a structured log/export/store-side query, not 250 individual screenshots; representative screenshots are for visual confirmation only, not the reconciliation proof itself |
| PRQ-PUBB-WOO-003 | P0 | NEW | Bulk-select 51 targeting WooCommerce, submit | Rejected identically to Shopify: `ceiling=50, submittedCount=51`; zero unintended provider-side mutation | New — confirms the ceiling is genuinely connector-agnostic shared code, not accidentally Shopify-only |
| PRQ-PUBB-X-004 | P2 | REUSE | Note in results: `NON_BULK_PUBLISH_BATCH_CEILING = 50` is Vexa's own **controlled operational admission ceiling** for the current non-native queued-export fallback path — not a Shopify or WooCommerce platform limit. Confirm this framing is still accurate against current `marketplace.service.ts` before writing it into the results claim. | Framing confirmed accurate, or updated if the implementation has changed | Source-check against `apps/api/src/marketplace/marketplace.service.ts` at execution time |

### 6.7 Publish — multi-variant

Both connectors, P0.

| ID | Pri | Type | Steps (summary) | Expected | Source |
|---|---|---|---|---|---|
| PRQ-PUBV-SHF-001 | P0 | REUSE | Publish a `QAPILOT-` product with ≥2 real variants (distinct SKU/price/attributes) to Shopify | Real Shopify SUCCESS; all variants present with correct attributes | Prior sellability-audit evidence (submission `e313303e`, external ref `shopify:8071110066266`) — re-execute fresh for this plan, don't just cite historical evidence |
| PRQ-PUBV-SHF-002 | P0 | NEW | On the published multi-variant product, edit one variant's field (price or SKU), save, republish | **Must succeed** — no 500. Regression target: #600. A failure here is a real regression, not an expected/known gap | #600 (closed 2026-08-18) — see also §6.8 for the dedicated edit-and-republish stage; this is the fresh-publish-adjacent smoke version |
| PRQ-PUBV-WOO-001 | P0 | NEW | Publish a `QAPILOT-` product with ≥2 real variants to WooCommerce | Real WooCommerce SUCCESS; product confirmed in store admin as a genuine **Variable product** with the correct variation count and attributes (not a flattened simple product) | New — mirrors the manual verification already performed once this program (external ref confirmed as product #209, 2 real variations) |
| PRQ-PUBV-WOO-002 | P1 | NEW | Edit one variant's price/stock pre-publish (before first publish), then publish | Edited value carries through correctly to the WooCommerce side | New |

### 6.8 Edit and republish live content

P0. This is the stage most affected by the #600 status correction — it is now regression-target coverage (within `NEW`/`REUSE`) on both the general edit path and the specific variant-edit path, not a documented known-broken exception.

| ID | Pri | Type | Steps (summary) | Expected | Source |
|---|---|---|---|---|---|
| PRQ-EDT-SHF-001 | P0 | NEW | On an already-published, approved-workflow-history multi-variant Shopify product: edit an existing variant's field, save, go through `approved → draft → edit → save → in_review → approve → republish` | No 500 at any step; success visible in Vexa; changed variant correct on the Shopify side; unaffected sibling variant remains unchanged; submission/job history coherent. Regression target: #600 | #600 (closed 2026-08-18) — this is the primary regression proof for the historical crash; capture full evidence (screenshots at each transition, final submission ID) given this was previously a confirmed live defect |
| PRQ-EDT-SHF-002 | P1 | NEW | Edit non-variant fields (title/description) on an already-published product, save, republish | Full lifecycle succeeds, real diff preview, genuine new Shopify SUCCESS submission | No current repo-committed automated test found for this exact lifecycle. Historical evidence only: sellability-audit live verification (2026-08-17, approved→draft→edit→save→in_review→approve→republish, real diff preview, real Shopify SUCCESS) — real prior evidence the behavior existed, but not a re-runnable test, so this is `NEW` (fresh execution), not `REUSE` |
| PRQ-EDT-WOO-001 | P0 | NEW | Edit + republish an already-published simple WooCommerce product (title/description correction) | Republish succeeds; changes visible in WooCommerce store admin | New — WooCommerce republish was verified manually earlier this program; this makes it a repeatable case |
| PRQ-EDT-WOO-002 | P0 | NEW | Edit a variant specifically on an already-published WooCommerce Variable product (mirrors the Shopify scenario in `PRQ-EDT-SHF-001`) | No crash; edited variant correct in store admin; sibling variant unaffected | New — worth authoring precisely because the equivalent Shopify path was once broken; confirms WooCommerce doesn't share that defect class (or documents it as a new NEG if it does) |
| PRQ-EDT-WOO-003 | P1 | NEW | Price correction on an already-published WooCommerce product, republish | New price reflected correctly in store | New |

### 6.9 Error and recovery

| ID | Pri | Type | Steps (summary) | Expected | Source |
|---|---|---|---|---|---|
| PRQ-ERR-X-001 | P1 | REUSE | Force a failed publish, follow the Jobs page into recovery guidance | Clear, actionable recovery path shown | `apps/web/test/e2e/publish-failure-recovery.spec.js:16` |
| PRQ-ERR-X-002 | P1 | NEG | Observe a pre-flight validation failure ahead of export-job queuing (do not fabricate; check current `marketplace.service.ts` behavior directly) | **Currently**: logged only ("pre-flight connector validation skipped"), job still created, real validation runs later in the async worker — document this precisely as the current, lower-severity behavior | #655 (open) — verify current status before writing; if since fixed, reclassify as REGRESSION |
| PRQ-ERR-WOO-003 | P1 | NEW | Let a WooCommerce credential genuinely expire (or simulate via a real revoked key on the pilot store, not a fabricated error), attempt a publish, reconnect, retry | Clear error on expiry; reconnect flow works; retry succeeds without creating a duplicate product | New |
| PRQ-ERR-X-004 | P1 | NEW | Access a page after a stale/invalidated session, attempt a mutating action | Clean redirect to login with correct `?next=` / `reason=session_expired`, no crash | No current repo-committed automated test found for this exact scenario. Historical evidence only: PR #603 fixed and live-verified this (2026-08-17) — real prior evidence, not a re-runnable test, so `NEW` (fresh execution), not `REUSE`. Known-Issue Ref: PR #603 |
| PRQ-ERR-X-005 | P2 | NEW | Smoke-check whether a Shopify webhook subscription was actually created at install time (inspect via Shopify admin's webhook settings, if reachable, or via Vexa's own install metadata) | Document current state honestly — this is an `OOS`-adjacent smoke case, not a pass/fail gate | Keeps the webhook-subscription gap visible per §1's OOS reasoning |

### 6.10 Plan and billing — commercial-truth gate

Production readiness is **not** established merely because Shopify/WooCommerce publishing works. This stage exists to prove a separate chain end-to-end:

```
CUSTOMER PLAN CLAIM = BACKEND ENTITLEMENT = USAGE METER = FEATURE GATING = LIMIT ENFORCEMENT
```

**Backend authority (current source, not memorized numbers):** `apps/api/src/billing/plan-limits.seed.ts` (numeric limits per tier: `maxSkus`, `maxSubmissionsPerMonth`, `maxUsers`, `maxStorageGb`, `maxConnectorInstallations`, `maxAccountsPerConnector`, `maxApiKeys`, `maxOutboundWebhooks`, `maxImportRowsPerJob`) and `apps/api/src/billing/plan-metadata.ts` (tier labels/features). Confirmed current tiers: `TRIAL`, `STARTER`, `GROWTH`, `BUSINESS`, `ENTERPRISE` (re-check at execution time in case tiers have changed). Pull live values from these files when building the matrix below — do not hardcode a stale copy into results.

**Evidence model for `PRQ-BIL-X-001`, `003`, `009` (and any other case comparing backend authority to a customer-facing claim):** two independent sides are both required — reading React/component source is **not** sufficient evidence of what a customer actually sees.
```
backend source/config  →  authoritative expected value   (e.g. plan-limits.seed.ts)
live rendered Vexa UI   →  observed customer-facing claim  (loaded in the running app, not inferred from JSX/TSX)
comparison of the two   →  PASS/FAIL
```
For feature-gating (`PRQ-BIL-X-009`) specifically: where an action can be safely exercised (not merely rendered), do so — observe the control's state in the live UI, then attempt the allowed/blocked action, then record the actual enforcement outcome. Do not conclude a feature is gated correctly solely from conditional-rendering source code.

| ID | Pri | Type | Steps (summary) | Expected | Source |
|---|---|---|---|---|---|
| PRQ-BIL-X-001 | P0 | NEW | For every current tier, derive all numeric limits from `plan-limits.seed.ts` (backend authority) and compare against Compare Plans + Plan & Usage display. Build the matrix: `Plan \| Entitlement \| Backend authority \| Compare Plans \| Plan & Usage \| Result` | Every customer-visible number means exactly what backend enforcement implements (e.g. `2500` → `"2.5K"`/exact is acceptable; `2500` → `"3K"` is **not**). Regression target: #610 | `apps/api/src/billing/plan-limits.seed.ts` (authority); Compare Plans UI + Plan & Usage UI (live check) |
| PRQ-BIL-X-002 | P0 | NEW | Verify the QA tenant's actual current plan (query backend authority directly, not just the UI badge), correct current-plan badge, exact usage, exact limit, no stale/trial state | Plan & Usage matches backend authority exactly | New — no existing automated spec found for current-plan-identity display |
| PRQ-BIL-X-003 | P0 | NEW | For the current plan, compare: (1) backend plan entitlement, (2) Compare Plans, (3) Plan & Usage, (4) internal/admin tenant-plan view if one exists | All four semantically match | New |
| PRQ-BIL-X-004 | P0 | NEW | Verify the current approved SKU definition ("One SKU means one sellable product variant. Parent product records are not counted separately.") is consistent across Compare Plans, Plan & Usage, the plan-limit modal, and any admin usage surface | Consistent everywhere checked. Regression target: #593 (in-app portion — #593 itself stays open for the *external* commercial-copy question only, per §1; this case is about the in-app copy specifically) | Prior sellability-audit evidence (PR #608, browser-verified 2026-08-18) — re-execute fresh, don't just cite history |
| PRQ-BIL-X-005 | P0 | NEW | Create controlled lifecycle fixtures covering: draft, in_review, approved, active, rejected, archived, a variant under a soft-deleted parent, a variant under a non-sellable parent. Confirm the expected billable count (derived from current policy/source, not historical assumption) reaches backend usage authority, Plan & Usage, limit enforcement, and any admin billable-SKU surface consistently | All surfaces agree on the same billable count. Regression target: #614 | #614 (closed 2026-08-19) — direct regression proof this specific counting bug stays fixed |
| PRQ-BIL-X-006 | P0 | NEW | Fixture: 1 parent product with 3 billable variants | Commercial SKU usage reads exactly 3, not 4 (parent not double-counted) | New — isolates the specific double-count failure mode #614/#593's policy is meant to prevent |
| PRQ-BIL-X-007 | P0 | REUSE | Exceed the tenant's SKU limit via bulk create/import (limit−1 allowed, limit behaves per defined semantics, limit+1 blocked cleanly) | Structured `PLAN_LIMIT_EXCEEDED` error at the correct boundary; no generic crash; no unintended partial mutation. Do not alter a real paid customer's billing/plan state to manufacture this — use the isolated QA tenant only | `apps/web/test/e2e/plan-limit-enforcement.spec.js:35` (SKU limit), `:60` (submission limit) |
| PRQ-BIL-X-008 | P0 | REUSE | Trigger the plan-limit modal; confirm exact limit, exact usage, correct SKU/product/variant terminology, correct plan, useful recovery/upgrade guidance, no rounding distortion, no stale value | Modal is commercially exact. A UI-only trigger proves rendering, not backend enforcement — note this distinction in results. Regression target: #610 | `apps/web/test/e2e/plan-limit-enforcement.spec.js:105` |
| PRQ-BIL-X-009 | P0 | NEW | For every feature advertised in the plan-comparison UI (connectors, approvals, API keys, users, webhooks, exports/imports, bulk operations, and any other plan-gated capability — check current tiers/features in `plan-metadata.ts` rather than assuming a fixed list), build: `Feature \| Starter \| Growth \| Business \| Enterprise \| Backend gate \| UI claim \| Result` | Advertised-available + backend-blocked = FAIL. Advertised-unavailable + backend-permits = FAIL. Every cell agrees | New |
| PRQ-BIL-X-010 | P0 | NEW | On a paid QA tenant: verify correct paid plan, no incorrect trial banner, paid entitlements active, correct current-plan state. Test trial behavior only with a separate, safe trial fixture | Paid identity is unambiguous; trial-only behavior never leaks onto a paid tenant or vice versa | New |
| PRQ-BIL-X-011 | P0 | NEW | Confirm activity in one tenant (billable SKU usage, submission usage, users, other commercial meters) does not change a second tenant's meters. Requires a second safe tenant fixture — if none is available, this case is `Result: BLOCKED`, not skipped | Isolation holds. If blocked, the reason is recorded, not silently omitted | New |
| PRQ-BIL-X-012 | P1 | OOS | N/A — tracked as a pointer, not executed against external surfaces this pass | Public pricing website, Sales collateral, proposal/order-form, contract language, and help/onboarding content must eventually match the verified backend/application entitlement contract above — but are not markable `PASS` merely because in-app copy is correct | #593 (external-alignment portion, still open) |

**§6.10 sub-gate:** `PLAN COMMERCIAL CLAIM = PASS` only when every `P0` case above (`PRQ-BIL-X-001` through `011`) passes — see [§8 Claim framing](#8-claim-framing) for exactly how a failure here changes the overall claim wording.

### 6.11 Account/session/RBAC

Canonical source: `docs/test-plan/rbac-matrix.json` (8-role model, generated from `@Roles()` decorators — treat as ground truth, don't re-derive role behavior by hand).

| ID | Pri | Type | Steps (summary) | Expected | Source |
|---|---|---|---|---|---|
| PRQ-ACC-X-001 | P1 | REUSE | Confirm `admin` role: full access to all surfaces | Full access confirmed | `apps/web/test/e2e/rbac-role-enforcement.spec.js:61` |
| PRQ-ACC-X-002 | P1 | REUSE | Confirm `editor` role: catalog + ops access, limited admin | Correct boundary | `apps/web/test/e2e/rbac-role-enforcement.spec.js:65` |
| PRQ-ACC-X-003 | P1 | REUSE | Confirm `publisher`, `approver`, `channel_manager`, `connector_admin`, `reviewer`, `viewer` roles | Each matches its documented boundary | `apps/web/test/e2e/rbac-role-enforcement.spec.js:77,85,93,101,113,121` |
| PRQ-ACC-CON-004 | P1 | NEW | Confirm `connector_admin` role's Shopify vs. WooCommerce credential-view/edit permissions | Either explicitly connector-agnostic by design, or correctly scoped per connector — check against `rbac-matrix.json`'s connector-related surfaces and document which it is | New — the existing matrix doesn't obviously break this out per-connector; worth confirming rather than assuming |
| PRQ-ACC-X-005 | P1 | NEW | Trigger a stale-session mutation attempt (Server Action after full logout) | Clean redirect, no crash | No current repo-committed automated test found for this exact scenario. Historical evidence only: PR #603, live-verified 2026-08-17 — real prior evidence, not a re-runnable test, so `NEW`, not `REUSE`. Known-Issue Ref: PR #603 (same underlying fix as `PRQ-ERR-X-004`; kept as a separate case since it's exercised from the account/session surface, not the export/publish surface) |
| PRQ-ACC-X-006 | P2 | REUSE | Confirm each role is correctly redirected from every `system_admin_gated` page | Correctly gated for every role in the test's role loop | `apps/web/test/e2e/rbac-admin-boundary-roles.spec.js:30` (`${role}: redirected from all system_admin_gated pages`) |

### 6.12 Offboarding

**Isolated fixture only. Run last. Requires explicit HUMAN GO/NO-GO logged in the results file before executing any destructive step.**

| ID | Pri | Type | Steps (summary) | Expected | Source |
|---|---|---|---|---|---|
| PRQ-OFF-SHF-001 | P1 | REUSE | Disable a Shopify connector via the real UI | Real `POST → 303 → raw HTML GET` flow, no silent JS fallback | `apps/web/test/e2e/connector-disable-native-post.spec.js:46` |
| PRQ-OFF-SHF-002 | P1 | NEW | After disable, confirm connector is no longer publish-eligible; historical jobs remain inspectable | Both hold true | No existing test covers either assertion. Was previously mis-cited to `connector-access-effect.spec.js`, whose only test (`admin connector grant unlocks reconnect for editor in the browser`) proves the opposite direction — granting access for reconnect, not post-disable ineligibility or job-history retention. `connector-disable-native-post.spec.js` (cited for `PRQ-OFF-SHF-001`) also stops at the POST→303→raw-HTML-GET mechanism and doesn't assert either claim here |
| PRQ-OFF-WOO-001 | P1 | NEW | Disable/uninstall a WooCommerce connector via the real UI, on an **isolated** WooCommerce install (not the shared one used by every other WooCommerce case in this plan) | UI confirms disable; connector no longer publish-eligible | New — **HUMAN GO/NO-GO required before executing** |
| PRQ-OFF-WOO-002 | P1 | NEW | After disable, confirm credentials are actually invalidated server-side (not just hidden in UI) | Stored credentials no longer usable — verify via a reconnect attempt correctly requiring fresh input, not silently reusing old ones | New |
| PRQ-OFF-WOO-003 | P1 | NEW | Confirm historical WooCommerce submission/job history remains inspectable after disable | History intact, no data loss | New |
| PRQ-OFF-X-004 | P2 | NEW | If reconnect/re-enable is supported post-disable, confirm it works cleanly | Reconnect succeeds or is confirmed genuinely unsupported (document which) | New |

---

## 7. Cross-cutting regression sweep

Before sign-off, run the relevant Playwright suite restricted to: all Shopify journey specs (`shopify-*.spec.js`, `journey-admin-product-to-publish.spec.js`, `bulk-publish-confirm-dialog.spec.js`, `products-workbench-bulk-publish-return-to.spec.js`, `plan-limit-enforcement.spec.js`, `rbac-role-enforcement.spec.js`, `connector-disable-native-post.spec.js`, `publish-failure-recovery.spec.js`) plus every newly-authored WooCommerce spec from this plan.

Confirm the exact current Playwright invocation (project/test naming may have changed — check `playwright.config.cjs` and `package.json`'s test scripts at execution time rather than assuming a command) before running. Do not claim this sweep passed until it has actually been executed.

Capture in the results file: total tests, passed, failed, skipped, which failures are pre-existing baseline (compare against the most recent CI run on `main` before this branch), and which (if any) are newly attributable to this work.

## 8. Claim framing

Production readiness is not a single connector-capability question — it is **four independent gates**, sign off separately, never averaged into one number:

```
Shopify P0             PASS / FAIL
WooCommerce P0         PASS / FAIL
Plan commercial truth  PASS / FAIL
Cross-cutting suite    PASS / FAIL
-----------------------------------
Paid Pilot Readiness   PASS / FAIL
```

**Gate membership is explicit, not inferred from the ID scheme.** A connector's P0 gate is every P0 case tagged with that connector's code, **plus every connector-agnostic (`X`) P0 case whose applicability includes it** — a connector cannot PASS by silently ignoring an applicable `X` case.

| Gate | Case IDs |
|---|---|
| **Shopify P0 gate** (12 cases) | Shared `X`: `PRQ-CON-X-004`, `PRQ-APR-X-004`. Shopify-specific: `PRQ-CON-SHF-001`, `002`; `PRQ-PUBF-SHF-001`, `002`; `PRQ-PUBB-SHF-001`, `002`, `003`; `PRQ-PUBV-SHF-001`, `002`; `PRQ-EDT-SHF-001` |
| **WooCommerce P0 gate** (13 cases) | Shared `X`: `PRQ-CON-X-004`, `PRQ-APR-X-004`. WooCommerce-specific: `PRQ-CON-WOO-001`, `002`, `003`; `PRQ-PUBF-WOO-001`, `002`; `PRQ-PUBB-WOO-001`, `002`, `003`; `PRQ-PUBV-WOO-001`; `PRQ-EDT-WOO-001`, `002` |
| **Plan commercial P0 gate** (11 cases) | `PRQ-BIL-X-001` through `011` — separately defined in §6.10, **not** double-counted into either connector gate above |

**Plan commercial claim gate** (§6.10) is `PASS` only when:
- all P0 numeric entitlements match backend authority (`PRQ-BIL-X-001`);
- the SKU definition matches billing enforcement everywhere checked (`PRQ-BIL-X-004`, `006`);
- Plan & Usage matches enforcement (`PRQ-BIL-X-002`, `003`);
- Compare Plans is commercially exact (`PRQ-BIL-X-001`, `008`);
- feature gating matches advertised plan capabilities (`PRQ-BIL-X-009`);
- plan-limit messages use the same quantity/unit the customer bought (`PRQ-BIL-X-007`, `008`);
- paid/trial identity is correct (`PRQ-BIL-X-010`);
- no current #614-class billing-correctness defect remains (`PRQ-BIL-X-005`);
- tenant usage is isolated where testable (`PRQ-BIL-X-011`).

If this gate fails, the final report must **not** say "Vexa plans are production ready." Use instead:
> "Commercial-plan production readiness is not established because <case IDs> show a mismatch between advertised entitlement and actual application behavior."

**Per-connector claims** (Shopify / WooCommerce P0 gates) follow the same discipline as before, stated **separately per connector**, never averaged:

> "Shopify [/ WooCommerce] is production-ready for Paid Controlled Pilot within the tested scope documented in this plan."

**If any P0 case fails for a connector:**
> "Paid Controlled Pilot production-readiness is NOT established for <connector> because <case ID> failed."

**If all P0 pass but P1 gaps remain:**
> "Production-ready for Paid Controlled Pilot with documented limitations: <list>."

**Overall `Paid Pilot Readiness` is `PASS` only when all four gates above are individually `PASS`.** A pass on connector publishing with a fail on the commercial-truth gate is not a "production ready" claim — it means Vexa can move products through a channel but may not be delivering the plan entitlement the customer was actually sold, which is just as claim-blocking.

Given the corrections applied while authoring this plan (#600, #610, #613, #614 all now closed/fixed, and #653/#655 the only two currently-open customer-facing defects), the expected shape of a successful pass is a **stronger** claim than the last sellability-audit snapshot — but every gate above, including the commercial-truth gate, must be earned by actually running its P0 cases, not assumed from this plan's existence.
