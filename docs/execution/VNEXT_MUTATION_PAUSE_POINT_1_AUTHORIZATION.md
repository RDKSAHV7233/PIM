# vNext Mutation Pause Point 1 Authorization

Status: first-controlled-mutation-executed / gate-disabled
Prepared: 2026-09-30
Prepared by: Codex; evidence-capture pass by Claude; final deploy/snapshot pass by Codex
Story: ST-CON-VMUT-006

This document was the authorization packet for the first controlled Shopify vNext mutation. The human authorization was later given in chat as `AUTHORIZE FIRST CONTROLLED MUTATION`, after which one allowlisted Shopify export job was executed and the mutation gate was returned to disabled state.

## Blocking Status

Current state (updated 2026-10-01 after first controlled mutation):

- Candidate tenant/installation/product/SKU/Shopify GID are now named (sections 2-5). The product was selected by the product owner in chat from among today's already shadow-verified fixtures, not invented here.
- Sections 6-9 now carry real evidence captured against the exact candidate product: a live read-only Shopify diff-preview via app.vexapim.com (section 6/8), the actual shipped `buildShopifyChannelProjection`/`buildShopifyVnextProductSetInput` functions run locally against this product's real field data (section 7/8), and the actual shipped `captureRollbackSnapshot`/`buildCompensatingWritePayload` functions run against live Shopify state after the final deploy (section 9). No write was issued capturing any of this; the diff-preview was cancelled, and the rollback snapshot path is read-only GraphQL.
- `ST-CON-VMUT-004` and `ST-CON-VMUT-005` are now formally locked in `INCREMENT_STATE.json` (`INC-81` / `INC-82` after merging `origin/main`).
- Final inert code was deployed successfully by GitHub Actions run `36812014752`.
- The exact deployed release SHA is now recorded in section 1.
- The real `captureRollbackSnapshot` GraphQL path was re-run after the final deploy against the exact candidate product. Section 9 now includes the live Shopify rollback snapshot with handle, variant id, inventory item id, image id, SEO, tags, and the computed compensating payload.
- The allowlist tuple to use is now exact and complete: `tenant=admin`, `connector=shopify`, `installation=5b07df00-5b47-48f0-991b-2bc2f3fe8a95`, `product=cmt9mc8xe0010pf01pkieafm5`, `release=7a461521fbbcd67dd3286ee8016e39b0ce4cc6bb`.
- Human sign-off was recorded in chat on 2026-10-01 as `AUTHORIZE FIRST CONTROLLED MUTATION`.
- One export job was created and completed for the exact allowlisted product during the controlled window: `cmup23mkv0001pk01rjwl3swn`.
- The latest post-mutation read-only Shopify snapshot shows the expected image changed and captured non-image product fields unchanged.
- The mutation gate was returned to safe state: `VNEXT_MUTATION_ENABLED=false`.
- Railway deployment logs did not retain a recoverable `shopify_vnext_controlled_mutation_executed` line after the enable/disable restarts. vNext execution is therefore recorded as an inference from exact gate state, exact allowlist, exact approved release, the shipped marketplace code path, the single completed export job, and the provider readback.

Do not re-enable `VNEXT_MUTATION_ENABLED` from this file. This record covers only the first authorized Shopify mutation for the exact tuple below.

## 1. Deployment SHA

Candidate release SHA:

```text
Exact deployed release SHA: 7a461521fbbcd67dd3286ee8016e39b0ce4cc6bb
Deploy run: https://github.com/Vexaap/PIM/actions/runs/36812014752
Deploy result: success
Rollback snapshot artifact: staging-gate-artifacts-36812014752 / .run-logs/shopify-vnext-rollback-snapshot-36812014752.json
```

Satisfied during authorization/execution:

- `VNEXT_MUTATION_APPROVED_RELEASE_SHA` must be exactly `7a461521fbbcd67dd3286ee8016e39b0ce4cc6bb`.
- Confirmation that `RAILWAY_GIT_COMMIT_SHA` matches `7a461521fbbcd67dd3286ee8016e39b0ce4cc6bb` in the target environment when the gate is enabled.
- The release contains locked `ST-CON-VMUT-001`, `ST-CON-VMUT-002`, `ST-CON-VMUT-003`, `ST-CON-VMUT-004`, and `ST-CON-VMUT-005` evidence.
- Human sign-off named this exact release SHA.

## 2. Tenant

```text
tenantKey: admin
```

Selected by the product owner in chat on 2026-09-30. This is the same tenant used for today's 4-fixture shadow verification run, including this exact candidate product.

Authorization record:

- Human sign-off in chat: `AUTHORIZE FIRST CONTROLLED MUTATION`
- Sign-off date: 2026-10-01
- Approved tenant: `admin`

## 3. Installation

```text
Connector slug: shopify
Installation ID: 5b07df00-5b47-48f0-991b-2bc2f3fe8a95
Store domain: vpim-6hzarsxc.myshopify.com
Install label in app: "Shopify / primary"
```

Confirmed real: this installation ID is the same one recorded on every `shopify_shadow_projection_computed` and `connector.update.*` log line for this candidate today, and the Connections page shows it `ACTIVE`.

Execution record:

- Installation used for the write: `5b07df00-5b47-48f0-991b-2bc2f3fe8a95`
- Connector: `shopify`

## 4. Product

```text
PIM Product ID: cmt9mc8xe0010pf01pkieafm5
Title: RES-02 Approved Candidate 1787720001100-77
Status: approved
Existing Shopify Product GID: gid://shopify/Product/8087828889690 (update-in-place, not a new product)
```

This is a "Vexa QA" brand fixture (description: "RES-02 controlled staging connector/export coverage product."), deliberately chosen over a real live-customer-facing product for the first mutation.

## 5. SKU

```text
SKU: RES02-1787720001100-77-2
```

Confirmed matching the product above via the Content/Attributes tabs and the live mapped-payload preview.

## 6. Current Shopify State

Captured 2026-09-30 via a live, read-only "Queue channel export" diff-preview in app.vexapim.com for this exact product (cancelled afterward; no write issued). This UI feature computes the diff against Shopify's actual current product state before any write.

```text
Product GID: gid://shopify/Product/8087828889690
Capture method: app.vexapim.com live diff-preview (Channels > Shopify > Queue channel export), cancelled without confirming
Capture time: 2026-09-30 (same session as this document)
Correlation ID: n/a (UI-level capture; final captureRollbackSnapshot evidence is in section 9)
Write issued during capture: No; dialog was cancelled, not confirmed
```

Real current-Shopify field values observed (everything not listed matched the PIM-derived value exactly, per the live diff-preview showing only 1 field changed):

```text
image (current, live on Shopify):
https://cdn.shopify.com/s/files/1/0738/8273/0586/files/product-image_ba64d666-d392-40c6-887c-f7a8d481aa4f.png?v=1790748226

title: RES-02 Approved Candidate 1787720001100-77 (matches PIM)
description: RES-02 controlled staging connector/export coverage product. (matches PIM)
vendor: Vexa QA (matches PIM)
size/color/material (as size_name/color_name/material_type): M / blue / cotton (all match PIM)
tax_rate / hsn_code: 18 / 6205 (both match PIM)
```

Not independently captured via this UI method: exact Shopify variant id, inventoryItem id, image id, product handle, SEO title/description, tags. The final live `captureRollbackSnapshot` evidence in section 9 fills those fields.

## 7. vNext Channel Projection

Two independent pieces of real evidence, both for this exact candidate:

**(a) Real production shadow-pipeline run, captured earlier today (2026-09-30) during the 4-fixture shadow verification, from the live Railway deploy logs; not recomputed, quoted verbatim:**

```text
shopify_shadow_projection_computed
timestamp: 2026-09-30T05:54:00.496Z
tenantId: admin
meta.installationId: 5b07df00-5b47-48f0-991b-2bc2f3fe8a95
meta.categoryId: cmqdn7l8g000ps801r13wquid
meta.sku: RES02-1787720001100-77-2
meta.schemaVersion: LOCAL-shopify-qa apparel-2026Q3
meta.mappingSource: saved_template
meta.comparisonMatches: true
meta.missingRequiredFields: []
```

This is the authoritative real-runtime result: the shipped shadow pipeline, run in production against this exact product, found zero mismatches between the vNext projection and source data.

**(b) Full ChannelProjection JSON, computed locally by calling the actual shipped `buildShopifyChannelProjection` function (from `apps/api/dist/connectors/shopify/shopify-channel-projection.js`) with this product's real field values (read from the PIM UI) and a reconstructed mapping/target-schema matching the real `mappingSource: saved_template` / `schemaVersion: LOCAL-shopify-qa apparel-2026Q3` seen in (a):**

```json
{
  "identity": { "sku": "RES02-1787720001100-77-2" },
  "content": {
    "title": "RES-02 Approved Candidate 1787720001100-77",
    "description": "RES-02 controlled staging connector/export coverage product.",
    "tags": [],
    "status": "ACTIVE"
  },
  "brand": { "vendor": "Vexa QA" },
  "productType": "QA Apparel",
  "attributes": [
    { "key": "size", "value": "M", "source": "mapped" },
    { "key": "color", "value": "blue", "source": "mapped" },
    { "key": "material", "value": "cotton", "source": "mapped" }
  ],
  "variants": [
    { "sku": "RES02-1787720001100-77-2", "sellingPrice": 499, "mrp": 499, "options": [] }
  ],
  "media": {
    "mainImageUrl": "https://dummyimage.com/600x600/0f172a/ffffff.png?text=Vexa+RES02",
    "additionalImageUrls": []
  },
  "taxonomy": { "categoryScope": "cmqdn7l8g000ps801r13wquid", "productType": "QA Apparel" },
  "readiness": {
    "schemaVersion": "LOCAL-shopify-qa apparel-2026Q3",
    "requiredFields": ["attributes.size", "attributes.color", "attributes.material"],
    "missingRequiredFields": [],
    "coveredRequiredFields": ["attributes.size", "attributes.color", "attributes.material"]
  }
}
```

`readiness.missingRequiredFields: []` here matches (a)'s real logged result exactly, which is the cross-check that this local reconstruction is faithful to the real production run, not a hand-wave.

Caveat: the exact `resolvedMapping.fieldMap`/`targetSchema.requiredAttributes` objects used in (b) were reconstructed from the live mapped-payload-preview's visible output field names (`size_name`/`color_name`/`material_type`) and the real schemaVersion string, since this worktree has no live DB connection to the production mapping-template tables. The *result* is cross-validated against (a)'s real run; the *inputs* to (b) are a faithful reconstruction, not a direct DB read.

## 8. Expected Shopify Diff

Computed by feeding projection (7b) into the actual shipped `buildShopifyVnextProductSetInput` function, then comparing field-by-field against the real current Shopify state (section 6):

```text
Field                          Current (Shopify)                                            vNext ProductSetInput                                        Changed?
title                          RES-02 Approved Candidate 1787720001100-77                    RES-02 Approved Candidate 1787720001100-77                   No
descriptionHtml                RES-02 controlled staging connector/export coverage product.  RES-02 controlled staging connector/export coverage product. No
vendor                         Vexa QA                                                       Vexa QA                                                      No
productType                    (not captured via UI diff; not flagged as changed)            QA Apparel                                                   No (implied by diff-preview showing 0 other changes)
metafields.pim_connector.size  (not directly visible; not flagged as changed)                M                                                             No (implied)
metafields.pim_connector.color (not directly visible; not flagged as changed)                blue                                                          No (implied)
metafields.pim_connector.material (not directly visible; not flagged as changed)             cotton                                                        No (implied)
variants[0].price              499.00 (implied; not flagged as changed)                      499.00                                                        No
files[0].originalSource        https://cdn.shopify.com/s/files/1/.../product-image_ba64d666...png?v=1790748226   https://dummyimage.com/600x600/0f172a/ffffff.png?text=Vexa+RES02   YES
```

Full raw ProductSetInput the vNext adapter would submit:

```json
{
  "title": "RES-02 Approved Candidate 1787720001100-77",
  "handle": "res-02-approved-candidate-1787720001100-77-res02-1787720001100-77-2",
  "descriptionHtml": "RES-02 controlled staging connector/export coverage product.",
  "status": "ACTIVE",
  "vendor": "Vexa QA",
  "productType": "QA Apparel",
  "metafields": [
    { "namespace": "pim_connector", "key": "sku", "type": "single_line_text_field", "value": "RES02-1787720001100-77-2" },
    { "namespace": "pim_connector", "key": "source_sku", "type": "single_line_text_field", "value": "RES02-1787720001100-77-2" },
    { "namespace": "pim_connector", "key": "size", "type": "single_line_text_field", "value": "M" },
    { "namespace": "pim_connector", "key": "color", "type": "single_line_text_field", "value": "blue" },
    { "namespace": "pim_connector", "key": "material", "type": "single_line_text_field", "value": "cotton" }
  ],
  "productOptions": [{ "name": "Title", "position": 1, "values": [{ "name": "Default Title" }] }],
  "files": [{ "originalSource": "https://dummyimage.com/600x600/0f172a/ffffff.png?text=Vexa+RES02", "alt": "RES-02 Approved Candidate 1787720001100-77", "contentType": "IMAGE", "filename": "product-image.png" }],
  "variants": [{ "price": "499.00", "compareAtPrice": "499.00", "inventoryPolicy": "CONTINUE", "taxable": true, "inventoryItem": { "tracked": false, "sku": "RES02-1787720001100-77-2" }, "optionValues": [{ "optionName": "Title", "name": "Default Title" }] }]
}
```

Identifier that would be submitted (update-in-place, not a new product): `{ "id": "gid://shopify/Product/8087828889690" }`

**Only one field is expected to change: the product image**, from the current live Shopify CDN URL to the PIM-configured `dummyimage.com` placeholder URL. This matches the same single-field diff the live legacy "Queue channel export" preview independently showed for this product; the vNext-derived values and the legacy-mapped values agree on every field except image, which is consistent with today's `comparisonMatches: true` shadow result.

Explicit fields intentionally not covered by the vNext projection for this product: SEO title/description (none set), tags (none set), `compareAtPrice` is emitted as equal to `price` (499.00 == 499.00) since `mrp === sellingPrice` here; this is a known minor difference from whatever the legacy mapper does with equal MRP/selling price, worth a human eyeballing at sign-off even though it wasn't flagged as a changed field by the live diff-preview.

Known caveat from `ST-CON-VMUT-002` (unchanged from draft):

- The vNext adapter does not invent legacy ProductPayload-only fields such as HS/taxCode harmonized system code unless they exist in the projection contract.

## 9. Rollback Payload

Final live rollback evidence was captured after the final inert deploy by the actual shipped `ShopifyConnector.captureRollbackSnapshot(ctx, shopifyGid, { correlationId })` path. This was a read-only Shopify Admin GraphQL query; no ProductSet mutation or rollback mutation was issued.

```text
Release SHA: 7a461521fbbcd67dd3286ee8016e39b0ce4cc6bb
Deploy/snapshot run: https://github.com/Vexaap/PIM/actions/runs/36812014752
Evidence artifact: staging-gate-artifacts-36812014752 / .run-logs/shopify-vnext-rollback-snapshot-36812014752.json
Captured at: 2026-10-01T03:50:31.528Z
Correlation ID: vnext_rollback_7a461521fbbc_1790826628769
Shopify Product GID: gid://shopify/Product/8087828889690
Allowlist tuple: tenant=admin; connector=shopify; installation=5b07df00-5b47-48f0-991b-2bc2f3fe8a95; product=cmt9mc8xe0010pf01pkieafm5; release=7a461521fbbcd67dd3286ee8016e39b0ce4cc6bb
```

**Final live rollback snapshot**, returned by `captureRollbackSnapshot` from Shopify:

```json
{
  "capturedAt": "2026-10-01T03:50:31.527Z",
  "product": {
    "id": "gid://shopify/Product/8087828889690",
    "title": "RES-02 Approved Candidate 1787720001100-77",
    "handle": "res-02-approved-candidate-1787720001100-77-res02-1787720001100-77-2",
    "descriptionHtml": "RES-02 controlled staging connector/export coverage product.",
    "status": "ACTIVE",
    "vendor": "Vexa QA",
    "productType": "QA Apparel",
    "tags": [],
    "seo": {
      "title": null,
      "description": null
    },
    "options": [
      {
        "name": "Title",
        "position": 1,
        "values": [
          "Default Title"
        ]
      }
    ],
    "variants": [
      {
        "id": "gid://shopify/ProductVariant/43915000021082",
        "sku": "RES02-1787720001100-77-2",
        "price": "499.00",
        "compareAtPrice": "499.00",
        "barcode": null,
        "inventoryPolicy": "CONTINUE",
        "taxable": true,
        "selectedOptions": [
          {
            "name": "Title",
            "value": "Default Title"
          }
        ],
        "inventoryItem": {
          "id": "gid://shopify/InventoryItem/46033990778970",
          "sku": "RES02-1787720001100-77-2",
          "tracked": false
        }
      }
    ],
    "images": [
      {
        "id": "gid://shopify/ProductImage/42656046022746",
        "src": "https://cdn.shopify.com/s/files/1/0738/8273/0586/files/product-image_ba64d666-d392-40c6-887c-f7a8d481aa4f.png?v=1790748226",
        "altText": "RES-02 Approved Candidate 1787720001100-77"
      }
    ]
  }
}
```

**Final compensating write payload**, computed from that live snapshot by the actual shipped `buildCompensatingWritePayload(snapshot, correlationId)` function:

```json
{
  "correlationId": "vnext_rollback_7a461521fbbc_1790826628769",
  "input": {
    "title": "RES-02 Approved Candidate 1787720001100-77",
    "handle": "res-02-approved-candidate-1787720001100-77-res02-1787720001100-77-2",
    "descriptionHtml": "RES-02 controlled staging connector/export coverage product.",
    "status": "ACTIVE",
    "vendor": "Vexa QA",
    "productType": "QA Apparel",
    "productOptions": [
      {
        "name": "Title",
        "position": 1,
        "values": [
          {
            "name": "Default Title"
          }
        ]
      }
    ],
    "variants": [
      {
        "price": "499.00",
        "compareAtPrice": "499.00",
        "inventoryPolicy": "CONTINUE",
        "taxable": true,
        "inventoryItem": {
          "tracked": false,
          "sku": "RES02-1787720001100-77-2"
        },
        "optionValues": [
          {
            "optionName": "Title",
            "name": "Default Title"
          }
        ]
      }
    ],
    "files": [
      {
        "originalSource": "https://cdn.shopify.com/s/files/1/0738/8273/0586/files/product-image_ba64d666-d392-40c6-887c-f7a8d481aa4f.png?v=1790748226",
        "alt": "RES-02 Approved Candidate 1787720001100-77",
        "contentType": "IMAGE",
        "filename": "product-image.png"
      }
    ]
  },
  "identifier": {
    "id": "gid://shopify/Product/8087828889690"
  }
}
```

This compensating payload would restore the product's current real image URL and current live product state if the controlled mutation's image change (section 8) needs to be reversed. It is real, computed, actionable, and includes the Shopify-internal identifiers that were previously missing from the UI-derived draft snapshot.

Rollback remains manual. The compensating payload must not be submitted automatically.

## 9a. First Controlled Mutation Result

Human authorization:

```text
Chat sign-off: AUTHORIZE FIRST CONTROLLED MUTATION
Date: 2026-10-01
Approved tuple: tenant=admin; connector=shopify; installation=5b07df00-5b47-48f0-991b-2bc2f3fe8a95; product=cmt9mc8xe0010pf01pkieafm5; release=7a461521fbbcd67dd3286ee8016e39b0ce4cc6bb
```

Execution evidence:

```text
Primary mutation run: https://github.com/Vexaap/PIM/actions/runs/36816834495
Evidence artifact: res-02-connector-export-coverage-482539cfcf7b62049211ad702417cf672ab95f47-36816834495 / shopify-vnext-first-controlled-mutation-36816834495.json
Read-only diagnostic run: https://github.com/Vexaap/PIM/actions/runs/36817252540
Final read-only diagnostic run: https://github.com/Vexaap/PIM/actions/runs/36817767026
Final diagnostic artifact: res-02-connector-export-coverage-321a1ee20f286cbf6fd3ce07e6cb2d443082b74c-36817767026 / shopify-vnext-first-controlled-mutation-36817767026.json
```

Gate state during the mutation run:

```text
Initial VNEXT_MUTATION_ENABLED: <unset>
Initial RAILWAY_GIT_COMMIT_SHA: 7a461521fbbcd67dd3286ee8016e39b0ce4cc6bb
Enabled window VNEXT_MUTATION_ENABLED: true
Enabled window VNEXT_MUTATION_APPROVED_RELEASE_SHA: 7a461521fbbcd67dd3286ee8016e39b0ce4cc6bb
Enabled window allowlist: exact approved tuple
Cleanup VNEXT_MUTATION_ENABLED: false
Cleanup completed at: 2026-10-01T04:51:46.722Z
```

API/job/submission evidence:

```text
Export job ID: cmup23mkv0001pk01rjwl3swn
Export job final status: completed
Export job completed at: 2026-10-01T04:51:12.479Z
ConnectorSubmission ID: 61ee426e-b221-46b7-a66b-9d3685370f45
ConnectorSubmission idempotencyKey: cmup23mkv0001pk01rjwl3swn:PUBLISH
ConnectorSubmission status: SUCCESS
ConnectorSubmission source: LIVE_API
ConnectorSubmission externalRef: gid://shopify/Product/8087828889690
ConnectorSubmission resolvedAt: 2026-10-01T04:51:11.783Z
```

Provider readback:

```text
Pre-mutation image:
https://cdn.shopify.com/s/files/1/0738/8273/0586/files/product-image_ba64d666-d392-40c6-887c-f7a8d481aa4f.png?v=1790748226

Post-mutation image:
https://cdn.shopify.com/s/files/1/0738/8273/0586/files/product-image_ec26a979-1763-417b-985c-335bc5a9fa7e.png?v=1790830271

Pre-mutation image ID: gid://shopify/ProductImage/42656046022746
Post-mutation image ID: gid://shopify/ProductImage/42677183873114
Shopify Product GID remained: gid://shopify/Product/8087828889690
```

Captured non-image fields in the post-mutation snapshot remained stable:

- `title`: `RES-02 Approved Candidate 1787720001100-77`
- `handle`: `res-02-approved-candidate-1787720001100-77-res02-1787720001100-77-2`
- `descriptionHtml`: `RES-02 controlled staging connector/export coverage product.`
- `status`: `ACTIVE`
- `vendor`: `Vexa QA`
- `productType`: `QA Apparel`
- `tags`: `[]`
- `seo`: `{ "title": null, "description": null }`
- variant ID/SKU/price/compareAtPrice/inventory policy/taxable/inventory item remained stable.

Evidence gap:

- The runner attempted to recover the expected `shopify_vnext_controlled_mutation_executed` / `Shopify controlled vNext product sync completed` log line from Railway deployment logs after cleanup, including a later widened historical-log probe. No matching log line was recoverable.
- Therefore, the vNext path is an inference, not a directly logged fact: exact release identity was set, exact allowlist was set, `VNEXT_MUTATION_ENABLED=true` was set during the job, there were no active authorized-product jobs before the gate opened, the only created job completed inside that window, and the shipped code at `MarketplaceService.recordConnectorSubmission()` selects `controlledMutation.result` instead of `connectorFramework.update/publish` when `attemptShopifyControlledMutation()` returns `executed`.
- No additional write was issued during the diagnostic runs; their status is `diagnostic_only` and `gateTransitions` is empty.

## 10. Automated Safety-Test Result

Current local checkpoint (unchanged from draft; the safety suite has not changed since this commit):

```text
Commit: 42157754
Command: npm run test:integration:shopify-vnext-mutation-safety
Result: passed
Suites: 4 passed
Tests: 136 passed
Output artifact: {"scenario":"shopify_vnext_mutation_safety_suite","status":"passed"}
```

Also passed in the same checkpoint:

```text
npm run test:integration:vnext-mutation-gating
npx tsc -p apps/api/tsconfig.build.json --noEmit
npm run build --workspace @pim1/api
git diff --check
```

Boundary:

- This is a focused Jest-backed safety suite exposed through a CI-visible integration command.
- It is not a live Shopify mutation test.
- It proves no controlled vNext mutation occurs without exact gates; when controlled vNext fails after gates pass, the existing legacy Shopify publish/update path remains available and is tested for exactly-one legacy write.

Satisfied before authorization:

- Required team approval for `ST-CON-VMUT-005`.
- Ledger entry recording accepted safety evidence.

## 11. Side Effects

Observed side effects:

- One Shopify ProductSet update for the exact allowlisted tenant, installation, and product.
- One connector submission through the existing marketplace submission path.
- Product image changed from the pre-mutation Shopify CDN asset to a new Shopify CDN asset.

Expected but not recoverable from retained logs:

- Operational logs with vNext correlation ID.

Potential unobserved side effects:

- Potential Shopify webhook emission.
- Potential Shopify search/index/cache timing effects.

Current safe-state checks:

- `VNEXT_MUTATION_ENABLED=false`.
- No rollback payload should be submitted.

## 12. Known Non-Reversible Effects

The following may not be fully undone by the compensating ProductSet payload:

- Shopify webhook emissions.
- Search, analytics, cache, or downstream connector side effects.
- Publication visibility timing.
- Inventory quantities or location-level inventory state.
- Deleted media assets whose original URLs no longer resolve.
- New product creation, if the candidate is not an update-in-place.

## Required Human Sign-Off

Recorded chat authorization:

```text
AUTHORIZE FIRST CONTROLLED MUTATION

Signer: Bhoiv / operator in chat
Role: product owner/operator
Date: 2026-10-01
Approved tenantKey: admin
Approved installationId: 5b07df00-5b47-48f0-991b-2bc2f3fe8a95
Approved productId: cmt9mc8xe0010pf01pkieafm5
Approved SKU: RES02-1787720001100-77-2
Approved release SHA: 7a461521fbbcd67dd3286ee8016e39b0ce4cc6bb
```

## Authorization Decision

```text
FIRST CONTROLLED MUTATION COMPLETED; GATE DISABLED.
```

Reason:

- Human sign-off was recorded in chat.
- The exact tuple was used.
- One export job completed and one matching connector submission succeeded.
- Read-only Shopify post-check shows the expected image change and no captured non-image drift.
- `VNEXT_MUTATION_ENABLED` is now `false`.

Further mutation expansion remains a separate hard gate.
