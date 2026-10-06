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

## What is recorded

`verifiedBy` is the role the source names (`QA`); it is not a person. Sources are in the manifest `evidenceRef`.

| Connector | Stage (policy) | PUBLISH `direct_adapter` | PUBLISH `product_pipeline` | VALIDATE / STATUS_SYNC `direct_adapter` | Source and reading |
|---|---|---|---|---|---|
| shopify | live | untested | **production_verified** (2026-08-24, expired 2026-09-23) | untested / untested | Real pilot store, UI "Queue channel export", submission ids recorded (`PRQ-PUBF-SHF-001/002`, `PRQ-PUBV-SHF-001`, `PRQ-EDT-SHF-001`). Webhooks, managed OAuth and multi-image sync are recorded as not production-verified |
| woocommerce | p1_blocker_hold | untested | **production_verified** (2026-08-24, expired 2026-09-23) | untested / untested | Real pilot store, external ref 212; the record says wp-admin confirmation was not completed. The 2026-10-03 battery claims (#1059) are not used as the basis: see the governance record |
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

`capability_verified`, with the real launch policy, evaluated at 2026-10-06 (asserted by the manifest spec):

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
- **Shopify's pipeline evidence has expired under the 30-day default** (2026-08-24 + 30 days). At `early_access` it would
  evaluate `RECERTIFICATION_REQUIRED`; at `live` the missing `certified` level is what blocks it. Re-running the
  pipeline battery would restore a current `production_verified` record; reaching `certified` needs the full QA,
  security and CTO/PO sign-off cycle.

## Commercial support

`COMMERCIAL_SUPPORT_RECORDS` is empty. The repository holds no Product Owner commercial-support approval for any
connector. The launch-stage approvals found (`po_review`, `early_access`, the 2026-09-03 controlled-pilot approval) are
release decisions, not commercial-support decisions, and are not converted into records. Every connector therefore
evaluates `NOT_COMMERCIALLY_SUPPORTED`, including Shopify and Flipkart.

A record is `{ connector, commerciallySupported, approvedBy: "PO", approvalRef, approvedAt, validUntil?, revokedAt?, reason }`.
It is appended by PR with the Product Owner's approval reference. Ending support means revoking or expiring the record,
not editing history.

## For owner review

1. **The conservative readings** (eBay and Dynamics 365 publish and status-sync, BigCommerce at `unit_tested`, Etsy at
   `sandbox_verified` with no real shop). Confirm or correct each level.
2. **Whether the 2026-08-24 WooCommerce pipeline evidence may stand** while the connector is on `p1_blocker_hold`. It is a
   factual record, but the same QA report scored the WooCommerce technical gate FAIL on the defects it recorded (#660 to #663).
3. **Whether to re-run a pipeline battery for Shopify** so its `production_verified` evidence is current again.
4. **Product Owner commercial-support records** for any connector the PO wants to count as supported.
5. **`verifiedBy`**: the sources name `QA` and "required-team authorization" without naming a person. The manifest keeps
   the role. If named verifiers are required, that is a process change, not an inventory fix.

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
