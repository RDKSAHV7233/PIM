# vNext Mutation Pause Point 1 Authorization

Status: blocked-draft
Prepared: 2026-09-30
Prepared by: Codex
Story: ST-CON-VMUT-006

This document is a draft authorization packet for the first controlled Shopify vNext mutation. It does not authorize enabling `VNEXT_MUTATION_ENABLED`, changing environment variables, or running a real Shopify mutation.

The authorization cannot be completed until a real candidate product is named and its actual shadow, rollback, and safety evidence is attached.

## Blocking Status

Current state:

- `ST-CON-VMUT-004` has rollback scaffold code and a rollback plan, but the actual candidate-product snapshot and compensating payload are not captured yet.
- `ST-CON-VMUT-005` has a committed safety-test checkpoint, but the story is not locked because required approval and ledger evidence are still missing.
- No exact candidate tenant, installation, product, SKU, or Shopify Product GID has been provided in this worktree.
- No human sign-off has been recorded in chat for the first real mutation.

Do not treat this file as approval. It is a structured place to attach the required evidence when it exists.

## 1. Deployment SHA

Candidate release SHA:

```text
BLOCKED: no approved release SHA has been selected.
Current worktree HEAD at draft time: 42157754cb469894f3cafba41a5626985583ac5d
```

Required before authorization:

- Exact `VNEXT_MUTATION_APPROVED_RELEASE_SHA`.
- Confirmation that `RAILWAY_GIT_COMMIT_SHA` will match that SHA in the target environment.
- Confirmation that the release contains locked `ST-CON-VMUT-001`, `ST-CON-VMUT-002`, and `ST-CON-VMUT-003`, plus accepted evidence for `ST-CON-VMUT-004` and `ST-CON-VMUT-005`.

## 2. Tenant

```text
BLOCKED: tenantKey not selected.
```

Required evidence:

- Tenant key.
- Tenant owner or operator confirming this exact tenant is approved for the first controlled mutation.

## 3. Installation

```text
BLOCKED: Shopify installationId not selected.
```

Required evidence:

- Connector slug: `shopify`.
- Installation ID.
- Confirmation that this installation belongs to the tenant above.
- Confirmation that credentials are healthy before mutation.

## 4. Product

```text
BLOCKED: productId not selected.
```

Required evidence:

- Product ID.
- Product title.
- Product approval/workflow status.
- Existing Shopify Product GID, if this first mutation is an update-in-place.

## 5. SKU

```text
BLOCKED: SKU not selected.
```

Required evidence:

- Canonical SKU from the PIM product payload.
- Confirmation that the SKU matches the product selected above.

## 6. Current Shopify State

```text
BLOCKED: current Shopify state not captured.
```

Required evidence:

- Read-only Shopify product snapshot for the exact Shopify Product GID.
- Timestamp of capture.
- Correlation ID used for the capture evidence.
- Confirmation that no write was issued during capture.

Source to use:

- `ShopifyConnector.captureRollbackSnapshot(ctx, productGid, { correlationId })`
- Rollback plan: [VNEXT_MUTATION_ROLLBACK_PLAN.md](./VNEXT_MUTATION_ROLLBACK_PLAN.md)

## 7. vNext Channel Projection

```text
BLOCKED: real vNext ChannelProjection not captured for the candidate product.
```

Required evidence:

- Target Schema fetched for the candidate product type.
- MappingResolution used for the selected installation/category scope.
- ChannelProjection JSON for the exact product.
- Shadow comparator result, including `comparisonMatches` and any mismatches.

The projection must come from the shipped shadow pipeline for the selected product, not from a hand-written example.

## 8. Expected Shopify Diff

```text
BLOCKED: expected diff not captured.
```

Required evidence:

- Current Shopify state.
- vNext ProductSet input derived from the ChannelProjection.
- Field-by-field expected diff.
- Explicit list of fields intentionally not covered by the vNext projection.

Known caveat from `ST-CON-VMUT-002`:

- The vNext adapter does not invent legacy ProductPayload-only fields such as HS/taxCode harmonized system code unless they exist in the projection contract.

## 9. Rollback Payload

```text
BLOCKED: real rollback payload not generated for the candidate product.
```

Required evidence:

- Actual rollback snapshot output for the exact product.
- Actual `buildCompensatingWritePayload(snapshot, rollbackCorrelationId)` output.
- Operator review confirming the compensating payload is acceptable as the rollback artifact.

Rollback remains manual. The compensating payload must not be submitted automatically.

## 10. Automated Safety-Test Result

Current local checkpoint:

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

- Missing exact candidate product and Shopify Product GID.
- Missing real shadow projection and expected diff for that product.
- Missing real rollback snapshot and compensating payload for that product.
- Missing required team approval and ledger lock for `ST-CON-VMUT-005`.
- Missing human sign-off.

This draft closes no gate by itself.
