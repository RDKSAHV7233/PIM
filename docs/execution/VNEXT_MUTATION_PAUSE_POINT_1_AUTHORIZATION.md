# vNext Mutation Pause Point 1 Authorization

Status: ready-for-human-authorization / NO-GO until signed
Prepared: 2026-09-30
Prepared by: Codex; evidence-capture pass by Claude; final deploy/snapshot pass by Codex
Story: ST-CON-VMUT-006

This document is a draft authorization packet for the first controlled Shopify vNext mutation. It does not authorize enabling `VNEXT_MUTATION_ENABLED`, changing environment variables, or running a real Shopify mutation.

The authorization cannot be completed until a real person signs off in chat.

## Blocking Status

Current state (updated 2026-10-01, final deploy/snapshot pass):

- Candidate tenant/installation/product/SKU/Shopify GID are now named (sections 2-5). The product was selected by the product owner in chat from among today's already shadow-verified fixtures, not invented here.
- Sections 6-9 now carry real evidence captured against the exact candidate product: a live read-only Shopify diff-preview via app.vexapim.com (section 6/8), the actual shipped `buildShopifyChannelProjection`/`buildShopifyVnextProductSetInput` functions run locally against this product's real field data (section 7/8), and the actual shipped `captureRollbackSnapshot`/`buildCompensatingWritePayload` functions run against live Shopify state after the final deploy (section 9). No write was issued capturing any of this; the diff-preview was cancelled, and the rollback snapshot path is read-only GraphQL.
- `ST-CON-VMUT-004` and `ST-CON-VMUT-005` are now formally locked in `INCREMENT_STATE.json` (`INC-81` / `INC-82` after merging `origin/main`).
- Final inert code was deployed successfully by GitHub Actions run `36812014752`.
- The exact deployed release SHA is now recorded in section 1.
- The real `captureRollbackSnapshot` GraphQL path was re-run after the final deploy against the exact candidate product. Section 9 now includes the live Shopify rollback snapshot with handle, variant id, inventory item id, image id, SEO, tags, and the computed compensating payload.
- The allowlist tuple to use is now exact and complete: `tenant=admin`, `connector=shopify`, `installation=5b07df00-5b47-48f0-991b-2bc2f3fe8a95`, `product=cmt9mc8xe0010pf01pkieafm5`, `release=7a461521fbbcd67dd3286ee8016e39b0ce4cc6bb`.
- No human sign-off has been recorded in chat for the first real mutation.

Do not treat this file as approval. Evidence being attached is not the same as authorization; the sign-off block below must still be completed by a real person in chat.

## 1. Deployment SHA

Candidate release SHA:

```text
Exact deployed release SHA: 7a461521fbbcd67dd3286ee8016e39b0ce4cc6bb
Deploy run: https://github.com/Vexaap/PIM/actions/runs/36812014752
Deploy result: success
Rollback snapshot artifact: staging-gate-artifacts-36812014752 / .run-logs/shopify-vnext-rollback-snapshot-36812014752.json
```

Required before authorization:

- `VNEXT_MUTATION_APPROVED_RELEASE_SHA` must be exactly `7a461521fbbcd67dd3286ee8016e39b0ce4cc6bb`.
- Confirmation that `RAILWAY_GIT_COMMIT_SHA` matches `7a461521fbbcd67dd3286ee8016e39b0ce4cc6bb` in the target environment when the gate is enabled.
- The release contains locked `ST-CON-VMUT-001`, `ST-CON-VMUT-002`, `ST-CON-VMUT-003`, `ST-CON-VMUT-004`, and `ST-CON-VMUT-005` evidence.
- Human sign-off must still name this exact release SHA.

## 2. Tenant

```text
tenantKey: admin
```

Selected by the product owner in chat on 2026-09-30. This is the same tenant used for today's 4-fixture shadow verification run, including this exact candidate product.

Still required before authorization:

- Explicit tenant owner/operator confirmation that this exact tenant is approved for the first controlled mutation (distinct from it being the tenant used for shadow observation).

## 3. Installation

```text
Connector slug: shopify
Installation ID: 5b07df00-5b47-48f0-991b-2bc2f3fe8a95
Store domain: vpim-6hzarsxc.myshopify.com
Install label in app: "Shopify / primary"
```

Confirmed real: this installation ID is the same one recorded on every `shopify_shadow_projection_computed` and `connector.update.*` log line for this candidate today, and the Connections page shows it `ACTIVE`.

Still required before authorization:

- Fresh credential-health confirmation immediately before mutation (the existing "Shopify credentials validated (live check)" heartbeat already covers this installation on its normal interval; re-check timestamp should be within a few minutes of sign-off).

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

Still required before authorization:

- Operator review confirming this compensating payload is acceptable as the rollback artifact. This is a human judgment call, not something to self-approve.

Rollback remains manual. The compensating payload must not be submitted automatically.

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

Required before authorization:

- Required team approval for `ST-CON-VMUT-005`.
- Ledger entry recording accepted safety evidence.

## 11. Expected Side Effects

Expected side effects if a human later authorizes the first mutation:

- One controlled Shopify ProductSet mutation for the exact allowlisted tenant, installation, and product.
- Connector submission evidence through the existing marketplace submission path.
- Operational logs with vNext correlation ID.
- Potential Shopify webhook emission.
- Potential Shopify search/index/cache timing effects.

No expected side effects before sign-off:

- No environment flag should be enabled.
- No production/staging Shopify write should be attempted from this document.
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

This block must remain blank until a real person reviews the completed evidence and signs in their own words in chat.

```text
I have reviewed the expected diff, the real rollback payload, and the safety-test results, and authorize VNEXT_MUTATION_ENABLED=true for exactly this product on exactly this release.

Signer:
Role:
Date:
Approved tenantKey:
Approved installationId:
Approved productId:
Approved SKU:
Approved release SHA:
```

## Authorization Decision

```text
NO-GO.
```

Reason:

- Candidate product, expected diff, final deployed release SHA, formal VMUT-004/VMUT-005 locks, and final live rollback payload are now attached (sections 1-10).
- The allowlist tuple is exact and complete.
- Missing human sign-off.

This package closes no mutation gate by itself. Attaching real evidence is not the same as authorization.
