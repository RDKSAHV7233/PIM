# Vexa PIM — Shopify & WooCommerce Connector Claim Audit (Refreshed)

**Original audit date:** 30 August 2026
**Refreshed:** 3 September 2026
**Repository HEAD:** `main @ 3bfd3e10`
**Browser evidence:** three consecutive verification passes on app.vexapim.com
(Admin role, 2026-08-24, 2026-09-01, 2026-09-03 — no regressions)
**Marketing source reviewed:** "Vexa PIM — Sales Channel Connectors: Shopify &
WooCommerce Feature Reference"
**Authority:** this refresh supersedes the 2026-08-30 audit for commercial
decisions. The original audit methodology and status taxonomy are retained.

## Changes from the 2026-08-30 audit

Three P0 defects that drove the original WooCommerce "do not sell" verdict are
now closed:

| Defect | 2026-08-30 state | 2026-09-03 state |
| --- | --- | --- |
| #660 stuck-PENDING | Open P0 | **FIXED** — 0 PENDING across 100 submissions, stable across 3 verification passes |
| #662 edit/republish | Open P0 | **VERIFIED** — full edit-approve-republish cycle on VX0109897, SUCCESS 1/9/2026 |
| #663 SKU billing | Open P0 | **FIXED** — variant-based counting confirmed in live SKU meter (65/100K) |

CTO/PO controlled-pilot approval was recorded 2026-09-03: up to 2 ENTERPRISE
tenants, operator-supervised. WooCommerce upgraded from DO_NOT_SELL to
CONTROLLED_PILOT_ONLY.

## Status meanings

| Status | Meaning for marketing and sales |
| --- | --- |
| **Verified** | Supported by repository evidence and live customer journey within the stated scope. May be used with its qualifiers after PO approval. |
| **Conditional** | Implemented or partially evidenced, but bounded by scope, unresolved gaps, or missing live proof. Use only with the exact qualifier shown. |
| **Controlled pilot only** | Available for operator-supervised ENTERPRISE evaluation. Not GA, not self-service, not public-sellable. |
| **Not verified** | Source or design may exist, but customer-facing acceptance is absent. Do not publish as an available capability. |
| **Contradicted** | The reference conflicts with verified product reality. Remove or replace it. |

## Executive verdict

- **Shopify:** **Sell with conditions** for a controlled, direct-token/custom-app
  pilot. Verified scope: fresh single-variant publish, single-variant
  edit/republish, reconnect, Jobs/submission visibility, publication target
  selection exercised for Online Store/POS, a single main HTTPS image, and
  manual bulk publish of up to 50 products per batch.
- **WooCommerce:** **Controlled pilot only.** The three P0 defects that blocked
  the original "do not sell" verdict are now closed. Fresh publish reaches
  SUCCESS. 100% first-publish success rate (last 30 days). Not GA or
  public-sellable until store-admin evidence and full team signoff.
- **Combined "both connectors" positioning:** not approved. Shared framework
  code is not proof that both connectors deliver the same customer outcome.
- **Absolute wording:** remove "no duplicates, ever," "safe to retry anything,"
  "guarantees," "hundreds," "every connected store," and "automatic/out of the
  box" unless a bounded acceptance test directly proves the literal promise.

## Front matter and summary claims

| Claim in supplied reference | Verdict | Evidence-based correction |
| --- | --- | --- |
| "Shopify — Live" | **Conditional** | Shopify is live only for the bounded direct-token, single-variant pilot scope. This is not a managed-OAuth, webhook-enabled, multi-image, multi-variant GA claim. |
| "WooCommerce — Code Complete" | **Controlled pilot only** | Code-complete is an internal engineering stage, not availability. For pilot material: "WooCommerce is available for operator-supervised evaluation." Never customer-facing as "live" or "GA." |
| "2 connectors" | **Conditional** | Two connector implementations exist. Shopify has the broader verified scope; WooCommerce is controlled-pilot-only. Do not present them as equivalent. |
| "14 Shopify sprints shipped" | **Not verified / unsuitable** | Delivery-count metrics do not establish a buyer outcome. Remove from the feature reference. |
| "10 WooCommerce increments" | **Not verified / unsuitable** | Same issue; remove. |
| "4 declared capabilities each" | **Contradicted as a delivery claim** | Registry-declared capabilities are metadata. Shopify webhook subscription creation is absent, and WooCommerce capabilities are controlled-pilot-only. |
| Both provide Publish, Validate, Status Sync and Webhook Receive | **Contradicted** | Shopify publishing is bounded; status polling is implemented; webhook parsing exists but no Shopify subscription-creation lifecycle exists. WooCommerce publish/validate/status-sync are controlled-pilot-only. |
| Unified encrypted, rate-limited, idempotent, isolated framework | **Conditional** | These are code-level platform properties. They must not be used to imply every connector flow is production-verified. |

## Product sync and publishing

| Supplied claim | Shopify | WooCommerce | Approved correction |
| --- | --- | --- | --- |
| Idempotent create/update upsert; "no duplicates, ever" | **Verified only for bounded fresh publish and single-variant republish; absolute promise rejected** | **Controlled pilot only** — fresh publish SUCCESS confirmed 3x, edit-republish verified | "Create a new listing or update the linked listing through Vexa's governed publish flow." Do not promise zero duplicates under every failure mode. |
| Bulk publish hundreds; fault isolation; checkpoint resume | **Contradicted in scale; Verified at ≤50** | **Controlled pilot only at single-product level** — scale bulk untested | Shopify manual bulk is capped at 50 products per batch. WooCommerce single-product bulk verified. Do not claim hundreds or checkpoint resume. |
| Full multi-dimensional variants | **Conditional** — single-variant verified; no multi-variant products in catalog to test full sync | **Controlled pilot only** — #662 fixed but no multi-variant WooCommerce test data | Single-variant publish/republish works on both. Multi-variant cannot be claimed until multi-variant test data exists and is published successfully. |
| Main plus eight gallery images and per-variant images on both | **Contradicted** | **Code-only, not customer-verified** | Shopify supports a single main HTTPS image in the approved scope. WooCommerce image breadth is internal-only. |
| Category and tag mapping with automatic category creation and race handling | **Not verified** | **Not verified** | Keep as internal implementation detail until a live mapping/publish journey proves the final store result. |
| Status sync by polling | **Conditional** | **Controlled pilot only** — 0 PENDING / 87 accepted across 100 submissions confirms terminal status | Shopify polling code and tests exist; WooCommerce terminal-status reconciliation verified. Avoid an unqualified real-time synchronization promise. |
| Webhook receive with HMAC verification and delivery deduplication | **Not verified** | **Not verified** | Shopify receiver/parser code exists, but subscription creation is not implemented and no live webhook was accepted. WooCommerce webhook code exists but is not customer-verified. Remove from public copy. |
| Local pre-submit validation | **Conditional** | **Controlled pilot only** | Vexa has readiness/validation behavior. Do not claim "catches every listed error before API submission." |
| AES-256-GCM credential storage with versioned rotation | **Code-level only** | **Code-level only** | Use only in security-reviewed technical material. |
| Token-bucket limiting, Retry-After, exponential backoff and jitter | **Code-level only** | **Code-level only** | Safe internal architecture description; not a guarantee that a store API is never overwhelmed. |
| Multiple stores per platform | **Not verified as customer journey** | **Controlled pilot only** — 1 account per connector installed | Account-per-connector limits exist in plans (1/20 used), but multi-store onboarding was not accepted as a public claim. |
| Three-way health, reconnect, and installation dashboards | **Verified only for Shopify reconnect and Jobs visibility** | **Controlled pilot only** — connector health visible, 0 accounts needing attention | Limit public copy to Shopify reconnect validation and visible job/submission status. |

## Pricing and tax

| Supplied claim | Verdict | Correction |
| --- | --- | --- |
| Multi-market price resolution on both connectors | **Not verified** | Remove from public copy until provider-side results are live-tested. |
| MRP to regular price and lower selling price to sale price | **Not verified** | Treat as mapping behavior requiring provider reconciliation. |
| Shopify HS/commodity code resolution for AE, GB and AU | **Not verified** | Remove from the public Shopify page. |
| WooCommerce GST classes for 0%, 5%, 12%, 18%, 28% | **Code-only; controlled pilot only** | Do not market until WooCommerce tax results are reconciled on a real store. |

## Field mapping and configuration

| Supplied claim | Verdict | Correction |
| --- | --- | --- |
| Map any PIM field to any store field | **Contradicted by "any"** | Say "configure supported field mappings" only when the exact supported fields are documented. |
| Default mappings plus full override capability | **Not verified as end-to-end connector outcome** | The mapping lifecycle exists in Vexa, but the broad connector promise needs live store verification. |
| Arbitrary Shopify metafields and WooCommerce metadata | **Conditional** — metafield code exists in Shopify connector, WooCommerce meta schema documented; no live metafield publish verified | Remove "arbitrary." State "Vexa supports configuring Shopify metafield mappings" only when a live publish proves it. |
| Draft - validated - published - superseded - archived versioning | **Code-verified platform capability** | Safe for internal/product-workflow material. Do not use it to imply connector field coverage. |

## Error handling and recovery

| Supplied claim | Verdict | Correction |
| --- | --- | --- |
| 20+ Shopify and 8+ WooCommerce errors mapped | **Not verified at current cutoff** | Remove numeric counts until refreshed from current tests and fixtures. |
| Automatic network classification and smart retries | **Code-level only** | Describe as retry/error-handling logic, not guaranteed recovery. |
| Every submission has an idempotency key; retry anything with no duplicates or lost state | **Contradicted as an absolute guarantee** | "Vexa uses idempotency controls and tracked jobs to make supported retries safer." |

## Side-by-side comparison audit

| Comparison-row claim | Shopify verdict | WooCommerce verdict | Marketing action |
| --- | --- | --- | --- |
| Product create/update | **Verified, bounded single-variant scope** | **Controlled pilot only** — fresh publish SUCCESS, edit-republish verified | Shopify primary. WooCommerce only in internal pilot material with "operator-supervised evaluation" qualifier. |
| Variant support | **Conditional** — single-variant only, no multi-variant catalog data | **Controlled pilot only** — #662 fixed, single-variant only | State "single-variant" explicitly. Remove from public comparison until multi-variant tested. |
| Bulk publish | **Verified ≤50 per manual batch** | **Controlled pilot only** — single-product level verified | Shopify only in public copy, state ceiling. WooCommerce in pilot material only. |
| Delta sync | **Not verified** — no code found | — | Remove. |
| Scheduled sync | **Not verified** — no code found | — | Remove. |
| Brownfield catalog linking | **Not verified as customer journey** — code exists (11 files) | **Code exists** — brownfield import service implemented | Remove from active-feature copy. Code exists but no live customer journey verified. |
| Drift reconciliation | — | **Code exists** — reconciliation service implemented; not customer-verified | Remove from active-feature copy. |
| Preview changes | **Code exists** — export-with-preview-form in web | — | Do not publish until confirmed live. |
| Translations/localization | **Not verified** — translation code references exist in Shopify connector | — | Remove. |
| Publication targets | **Verified for exercised Online Store/POS targets** | — | Do not add B2B without proof. |
| Webhook receive | **Receiver code only; subscription creation absent** | **Code exists; not customer-verified** | Remove. |
| Webhook health monitoring | — | **Code-only** | Remove. |
| OAuth | **Managed OAuth not verified** | — | Direct-token/custom-app Shopify only. |
| Auto token refresh | **Not verified** | — | Remove. |
| Five mapping levels / default + custom | **Not verified as buyer outcome** | **Not verified** | Remove numeric level claims. |
| Weighted six-dimension readiness score | **Not verified as Shopify-specific public claim** | — | Prefer generic readiness language only after PO approval. |
| Custom metafields / metadata | **Conditional** — code exists, no live publish verified | **WooCommerce meta schema documented** | Remove broad checkmarks. |
| GST / HSN | — | **Code-only; controlled pilot only** | Remove. |
| SEO fields | **Not verified** | **Not verified** | Remove. |
| Multi-store | **Not customer-verified** | **Controlled pilot only** | Remove. |
| Error recovery groups | **Not verified as public feature** | **Controlled pilot only** | Replace with Jobs/submission visibility for Shopify. |
| Rate limiting | **Code-level** | **Code-level** | Keep only in technical/security material. |

## Marketing-angle audit

| Original angle | Verdict | Safe replacement |
| --- | --- | --- |
| "Update once and it flows to every connected store" | **Contradicted** | "Manage approved product content in Vexa and publish it through the supported Shopify workflow." |
| WooCommerce automatically corrects unauthorized storefront changes | **Code exists / controlled pilot only** | Drift reconciliation code exists. Do not claim as automatic or production-verified. Remove from public copy. |
| "Zero duplicates, zero hassle" | **Unsupported absolute** | "Update the linked listing through a tracked publish workflow." |
| Shopify/Woo brownfield linking prevents duplicates | **Code exists / not customer-verified** | Remove from public copy. |
| Bulk publish hundreds with checkpoint resume | **Contradicted** | "Select and queue up to 50 eligible Shopify products per batch." |
| Shopify delta sync republishes only changed products | **Not verified** — no delta sync code found | Remove. |
| WooCommerce GST/HSN is automatic and needs no configuration | **Code-only; controlled pilot only** | Remove. |
| Enterprise-grade security ensures tenant data never crosses boundaries | **Absolute guarantee rejected** | "Vexa uses encrypted credential storage and tenant-scoped controls." Publish only after security review. |
| Translate/localize, multi-market, B2B and Shopify Plus support | **Not verified** | Remove. |
| Validate, preview and weighted-score everything before publish | **Partially supported, overbroad** | "Use Vexa's readiness and approval workflow to identify issues before a supported publish." |

## Contradictions inside the supplied reference

1. The headline says WooCommerce is only "code complete," while most sections
   present it as a live, equal capability. Those positions are incompatible.
   **Still valid.** WooCommerce is now controlled-pilot-only, which is a third
   position — neither code-complete nor live-equal. The reference must be
   corrected.
2. "Bulk publish hundreds" conflicts with Vexa's verified operational ceiling of
   50 products per manual batch. **Still valid.**
3. "Multi-image sync" conflicts with the latest Shopify evidence: one main HTTPS
   image only. **Still valid.**
4. "Webhook receive" is presented as operational although Shopify subscription
   creation is not implemented and no live webhook acceptance exists. **Still
   valid.**
5. "Full variant support" was blocked by #662. **#662 is now FIXED.** However,
   "full variant support" remains contradicted because no multi-variant products
   exist in the catalog and multi-variant sync is therefore untested. Replace
   "full" with "single-variant verified."
6. "Automatic WooCommerce drift correction" is described as current, while the
   feature is code-only and not customer-verified. **Still valid** — drift
   reconciliation code exists but has not been exercised in a live customer
   journey.
7. "OAuth ✓" conflicts with the approved Shopify direct-token-only offer and
   the absence of live managed-OAuth proof. **Still valid.**
8. "Zero duplicates," "safe to retry anything," and "never overwhelmed" are
   guarantees that the evidence does not establish. **Still valid.**

## Publication decision

- **Approve for drafting:** bounded Shopify direct-token/single-variant
  controlled-pilot material, and bounded WooCommerce controlled-pilot internal
  material (not public).
- **Do not publish without PO approval:** any connector readiness page,
  comparison badge, logo implication, or feature matrix.
- **Remove now:** public WooCommerce GA claims, Shopify managed OAuth, webhook
  automation, multi-image, multi-variant production readiness, "hundreds,"
  multi-market/localization, brownfield linking, drift reconciliation, delta
  sync, scheduled sync, GST/HSN automation, and all absolute guarantees.
- **Governance note:** the source marketing reference document contains 8
  contradictions (7 still fully valid, 1 partially resolved). The source
  document must be corrected before any version of it is shown externally.

## CTO/PO sign-off on this refresh

**CTO decision:** ACCEPT. This refresh is adopted as the governing claim
authority, superseding the 2026-08-30 original. All "Not verified" items remain
not verified. No silent promotions. WooCommerce upgrades from DO_NOT_SELL to
CONTROLLED_PILOT_ONLY only where underlying evidence supports it.

**PO decision:** ACCEPT. No public connector page, comparison badge, logo grid,
or feature matrix may be published without explicit PO approval against this
audit. For the controlled pilot, internal material may reference WooCommerce as
"available for operator-supervised evaluation" — never as "live," "GA," or
"production-ready."

**Next refresh:** before first tenant onboarding, or after any material
connector code change, whichever comes first.
