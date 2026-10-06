# Publication evidence inventory (2026-10-06)

Sprint 5.1c-1. Companion to ADR-0015 and `docs/design/publication-targets-contract.md`. The data it describes is
`apps/api/src/publication-targets/publication-target.evidence-manifest.ts` (capability evidence) and
`publication-target.commercial-support.ts` (Product Owner records). Nothing reads either yet; 5.1c-3 turns them into
evaluator facts and 5.1d reports them in shadow. This document is for owner review: every level below is a reading of
repository evidence, and the owners confirm or correct it in review.

## Rules the inventory follows

1. **An entry above `untested` traces to a dated, referenced event in the repository.** ADR-0007's Gate 0 baseline
   (2026-09-27) is a classification written by an architecture sprint, not an event, and the ADR itself says it was not
   operationally enforced. Its levels are not carried over.
2. **`product_pipeline` is the product export job through `MarketplaceService`** (the UI "Queue channel export"
   action). Only that path can satisfy publication readiness. Calling the adapter with its own context is
   `direct_adapter`, however real the provider was.
3. **When a record is ambiguous the lower level is used**, and the reason is stated here.
4. **`reverifyBy` is authoritative**, set once from `verifiedAt`: `sandbox_verified` and `production_verified` +30
   days, `certified` +90 days. Levels below `sandbox_verified` carry none because they satisfy no release stage.
5. **Where evidence cannot be found the entry is `untested`.** Every declared capability on both paths has an
   explicit entry (86 in total across the 13 connectors that declare `PUBLISH`).
6. **Export-only connectors (meesho, nykaa) are not publication targets** and have no entries.
7. **Executing a test is not approving it.** Every entry above `untested` records who executed it
   (`executionType`: `AI_RUN`, `HUMAN_RUN` or `UNKNOWN`), where (`environment`), the role it counts for
   (`evidenceRole`) and an explicit `humanApproval`. `humanApproval` is true only when a named human approved the
   evidence against the governance gate, and only a human-run entry can carry it; `certified` requires it.
   `production_verified` requires a `PRODUCTION` environment, and a `product_pipeline` entry must trace to
   provider-submission ids. **No entry carries a human approval today.** AI-run QA is technical evidence; it does not
   satisfy the separate named QA sign-off.

## What is recorded

`verifiedBy` is the role the source names (`QA`); it is not a person. Sources are in the manifest `evidenceRef`. The two
product-pipeline entries are `AI_RUN` (the 2026-08-24 report names Claude as the tester; the 2026-10-06 run is described
below). The Tier-2 batteries are `SANDBOX` with an unrecorded executor (`UNKNOWN`). BigCommerce is `LOCAL`.

| Connector | Stage (policy) | PUBLISH `direct_adapter` | PUBLISH `product_pipeline` | VALIDATE / STATUS_SYNC `direct_adapter` | Source and reading |
|---|---|---|---|---|---|
| shopify | live | untested | **production_verified** (2026-10-06, `reverifyBy` 2026-11-05, AI-run QA) | untested / untested | Re-run on 2026-10-06 on the live app: UI "Queue channel export" publish and republish of `QAPILOT-20260824-001` to the real pilot store, both `SUCCESS`, same external reference, connector healthy before and after (see the run below). Supersedes the 2026-08-24 run (`PRQ-PUBF-SHF-001/002`). Webhooks, managed OAuth and multi-image sync are recorded as not production-verified |
| woocommerce | p1_blocker_hold | untested | **production_verified** (2026-08-24, expired 2026-09-23, AI-run QA) | untested / untested | Real pilot store, external ref 212; the record says wp-admin confirmation was not completed and the cited submission stayed `PENDING` in the history. The 2026-10-03 battery claims (#1059) are not used as the basis: see the governance record. Whether this evidence may stand under the hold is an open owner decision |
| odoo | early_access | sandbox_verified | untested | sandbox_verified / sandbox_verified | Battery 2026-10-03 (INC-89) against a real Odoo 17 instance. A real production tenant was not run |
| prestashop | early_access | sandbox_verified | untested | sandbox_verified / sandbox_verified | Battery 2026-10-03 (INC-89), real PrestaShop 9.1.5 sandbox |
| shopware | early_access | sandbox_verified | untested | sandbox_verified / sandbox_verified | Battery 2026-10-03 (INC-88), real dockware/dev sandbox. Multi-store, staged rollout and webhooks not verified |
| zoho-inventory | early_access | sandbox_verified | untested | sandbox_verified / sandbox_verified | Battery 2026-10-03 (INC-88), real trial org, India data center. GST-registered org not tested |
| etsy | early_access | sandbox_verified | untested | sandbox_verified / sandbox_verified | Battery 2026-10-03 (INC-90). Publish was exercised against the sandbox API with no real shop |
| ebay | early_access | **integration_tested** | untested | sandbox_verified / sandbox_verified | Battery 2026-10-03 (INC-90). Sandbox-only by design. The offer flow was validated but not completed (Business Policy IDs not configured), so PUBLISH is held below sandbox_verified |
| dynamics-365 | early_access | **integration_tested** | untested | sandbox_verified / **integration_tested** | Battery 2026-10-03 (INC-90). Token exchange and reachability were live; the Business Central data plane (`GET /items`) was not re-verified after the permission fix |
| bigcommerce | early_access | **unit_tested** | untested | unit_tested / unit_tested | Battery 2026-10-03 (INC-90). The live verification was of the prototype; the PIM1 TypeScript port is recorded as unit-tested only |
| flipkart | live | untested | untested | untested / untested | No dated event found (see below) |
| amazon-in | under_development | untested | untested | untested / untested | No event found; the launch note says publish and status sync are under active validation |
| myntra | under_development | untested | untested | untested / untested | No event found; the connector is not registered in the runtime (`runtimeRegistered: false` in the generated inventory) |

Nothing is `certified` anywhere. `WEBHOOK_RECEIVE` and `EXCEL_EXPORT` are `untested` on both paths for every connector.

## Shopify product-pipeline run, 2026-10-06 (AI-run QA)

Executed by an AI agent in the QA role on `app.vexapim.com` through the browser, signed in by the user, fixture
`QAPILOT-20260824-001` (the existing fixture, reused), real Shopify pilot store `vpim-6hzarsxc.myshopify.com`.

| Step | Result |
|---|---|
| Connector before | `ACTIVE`, Verified, last check 2026-10-06 09:37 |
| UI "Queue channel export" (publish) | submission `6ae9670d-b62e-41dc-bb34-d649c62898b6`, 09:59:06 to 09:59:08, `SUCCESS`, ref `shopify:8082735956058` |
| Republish, no content change | submission `0a103f48-b530-4639-b92e-5089adc38bf1`, 10:00:20 to 10:00:22, `SUCCESS`, the same ref |
| Connector after | `ACTIVE`, Verified |

One submission was created per confirmation, and the reference matches the August submissions: an update in place, not a
duplicate create, as far as Vexa's own record shows.

**Recorded as** `production_verified` on `PUBLISH` / `product_pipeline`, `reverifyBy` 2026-11-05 (the policy default),
`executionType: AI_RUN`, `humanApproval: false`. **Not `certified`**: no provider-admin inspection, no broader scenario
coverage and no named human certification.

**Limitations (also in the manifest entry):** Shopify admin / store-side inspection not performed; bulk publish not
exercised; multi-variant publish not exercised; the image-diff defect below; executed by an AI agent.

**What this changes in the evaluator:** the `early_access` evidence bar (`production_verified` on the pipeline path) is
satisfied while the entry is current, and it still does not satisfy `live`, which needs `certified`. It does not make
Shopify publication-ready: commercial support, cohort entitlement, installation and credential facts, schema, mapping and
product readiness all still decide, and commercial support has no Product Owner record.

### Defects observed during the run
1. **Image diff never converges (low, tracked).** Every publish previews "1 field will change" for the image
   (Vexa's source URL against Shopify's CDN URL), and the Shopify CDN image id changed between the two publishes. Raise the
   severity if store-side inspection shows duplicate media accumulating or measurable storage or API churn.
2. **Submission table header** reads "Shopify / External Ref" on WooCommerce rows (low).
3. **Export summary** said "Most recent channel: Woocommerce" next to "Shopify updated ..." before the run (low).
4. WooCommerce submissions from 2026-08-24 remain `PENDING` (known, not retested).

### Observations that are not certification evidence
The Zoho Inventory account reads "Credentials rejected" (HTTP 401), a real `INVALID` credential fact for the shadow
evaluator. WooCommerce is absent from the 10 catalog connector lanes but its installation is listed, it appears as an
installed publish lane, and it is selectable for bulk publish: a current-versus-shadow comparison case for 5.1d. Flipkart
is `live` with no accounts installed, a release-policy fact only.

## Where this differs from ADR-0007's Gate 0 baseline

| Connector / capability | ADR-0007 baseline | Recorded here | Why |
|---|---|---|---|
| flipkart PUBLISH, VALIDATE, STATUS_SYNC, EXCEL_EXPORT | production_verified | untested | The QA run of 2026-08-24 records **0 Flipkart accounts installed**. No publish, validation or export event was found. ADR-0015 already notes Flipkart's credential record can be `VALID` with reason `TOKEN_ONLY` without a provider call (#1144) |
| shopify VALIDATE, STATUS_SYNC, WEBHOOK_RECEIVE | production_verified | untested | Known limitations records webhook subscriptions as not production-verified; no dated event for validate or status-sync was found |
| woocommerce VALIDATE, STATUS_SYNC, WEBHOOK_RECEIVE, BULK_PUBLISH | integration_tested | untested | No dated event found |
| etsy STATUS_SYNC | untested | sandbox_verified | The 2026-10-03 battery (T4) |
| ebay, odoo, prestashop | unit_tested | raised or held per the table above | The 2026-10-03 batteries post-date the baseline |
| bigcommerce, dynamics-365, shopware, zoho-inventory | untested | raised per the table above | The 2026-09-24 and 2026-10-03 batteries post-date the baseline |
| myntra VALIDATE | integration_tested | untested | No dated event found |

## What the evaluator makes of this today

`capability_verified`, with the real launch policy, evaluated at 2026-10-06 (asserted by the manifest spec). Shopify's evidence is current until 2026-11-05 but is `production_verified`, below the `certified` bar `live` needs:

| Result | Connectors |
|---|---|
| not applicable (stage has no pipeline evidence minimum; `release_allowed` carries the reason) | amazon-in, myntra (`under_development`), woocommerce (`p1_blocker_hold`) |
| `CAPABILITY_NOT_VERIFIED`, `early_access` needs `production_verified` on the pipeline path | bigcommerce, dynamics-365, ebay, etsy, odoo, prestashop, shopware, zoho-inventory |
| `CAPABILITY_NOT_VERIFIED`, `live` needs `certified` on the pipeline path | flipkart, shopify |

No connector has evidence that would make it available. This is expected and is the point of shadow mode: it shows
where today's publishability is inherited rather than demonstrated.

Two facts the table does not show:

- **Tier-2 pipeline evidence cannot exist yet.** The export-job and mapping DTOs validate the channel against
  `MARKETPLACE_CHANNELS`, so the product pipeline cannot reach any Tier-2 connector. Their batteries can only be
  `direct_adapter`. Producing pipeline evidence is part of 5.3 (per-connector, Product Owner approved), not something
  this manifest can fix.
- **Shopify's pipeline evidence is current** (2026-10-06 + 30 days = 2026-11-05) and at `early_access` it would satisfy the
  evidence condition; at `live` the missing `certified` level is what blocks it. Reaching `certified` needs the full QA,
  security and CTO/PO sign-off cycle and a named human approval. WooCommerce's evidence (2026-08-24) has expired.

## Commercial support

`COMMERCIAL_SUPPORT_RECORDS` is empty. The repository holds no Product Owner commercial-support approval for any
connector. The launch-stage approvals found (`po_review`, `early_access`, the 2026-09-03 controlled-pilot approval) are
release decisions, not commercial-support decisions, and are not converted into records. Every connector therefore
evaluates `NOT_COMMERCIALLY_SUPPORTED`, including Shopify and Flipkart.

A record is `{ connector, commerciallySupported, approvedBy: "PO", approvalRef, approvedAt, validUntil?, revokedAt?, reason }`.
It is appended by PR with the Product Owner's approval reference. Ending support means revoking or expiring the record,
not editing history.

## For owner review

Decided on 2026-10-06 (Shopify run): Shopify `PUBLISH` on the pipeline is `production_verified`; the actor is recorded as
AI-run QA with `humanApproval: false`; `reverifyBy` is 2026-11-05. The image-diff behavior is a tracked defect.

Still open:

1. **The conservative readings** (eBay and Dynamics 365 publish and status-sync, BigCommerce at `unit_tested`, Etsy at
   `sandbox_verified` with no real shop). Confirm or correct each level.
2. **Whether the 2026-08-24 WooCommerce pipeline evidence may stand** while the connector is on `p1_blocker_hold`. The live
   submission history also shows later `SUCCESS` publishes (2026-08-26, 2026-09-05, 2026-09-10) that could replace it.
3. **Product Owner commercial-support records** for any connector the PO wants counted as supported. None exist.
4. **`verifiedBy`**: the sources name `QA` and "required-team authorization" without naming a person. The manifest keeps
   the role. Named human approvals are a separate act and are not recorded.

## Findings outside this change

- **`docs/connectors/CONNECTOR_INVENTORY.json` and `.md` are a 2026-09-27 snapshot.** Their launch-stage column no longer
  matches `connector-launch-policy.ts` for several connectors (odoo and prestashop show `po_review`; bigcommerce,
  dynamics-365, ebay, etsy, shopware and zoho-inventory show `under_development`; the policy says `early_access` for all
  eight). The generator's `--check` passes. The
  manifest spec uses the inventory only for declared capabilities, which have not changed. Regenerating it is a small,
  separate documentation change.
- `CURRENT_STATE.md` and `known-limitations.md` still describe Shopify as `live` with restricted claims; that is the
  recorded stage, and is not by itself evidence of certification.

## Not verified

No provider was contacted. Levels are readings of repository text; I did not re-run any battery. Whether evidence exists
outside the repository (for example in tickets or chat) is unknown.
