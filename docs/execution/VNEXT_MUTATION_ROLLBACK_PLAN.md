# vNext Mutation Rollback Plan

## Scope

This plan covers the manual rollback path for the Shopify controlled vNext ProductSet mutation. It applies only when the controlled mutation targets an existing Shopify product GID.

The rollback path is intentionally scaffolded, not automatic. The system can capture a pre-mutation snapshot and build a compensating ProductSet payload from that snapshot, but no code path should fire that payload without explicit operator action and release approval.

## Preconditions

- The candidate product already has a Shopify Product GID.
- The controlled mutation release gate and allowlist have been approved.
- The operator has a single correlation ID for the candidate mutation.
- `captureRollbackSnapshot` succeeds before any controlled ProductSet write is sent.
- The captured snapshot and generated compensating payload are stored with the pause-point evidence for the release.

If snapshot capture fails or Shopify does not return the product, the controlled mutation must fail closed and remain unexecuted.

## Capture

Before executing a controlled mutation against an existing product, capture the current Shopify state with `ShopifyConnector.captureRollbackSnapshot(ctx, productGid, { correlationId })`.

The snapshot captures:

- Product identity and content fields: ID, title, handle, HTML description, status, vendor, product type, tags, and SEO fields.
- Product option definitions and values.
- Variants with selected options, SKU, price, compare-at price, barcode, inventory policy, taxable flag, and inventory item tracking metadata.
- Image IDs, source URLs, and alt text.
- Snapshot metadata such as `capturedAt`, retained outside the Shopify write input.

Snapshot capture is read-only and must use the real Shopify credential and GraphQL transport path.

## Compensating Payload

Build the rollback payload with `buildCompensatingWritePayload(snapshot, rollbackCorrelationId)`.

The generated payload:

- Uses the rollback identifier `{ id: snapshot.product.id }`.
- Restores product fields from the snapshot.
- Reconstructs product options and variant option values, including multi-option variants.
- Reconstructs media files from captured image source URLs and alt text.
- Preserves inventory item SKU and tracking flags where captured.
- Excludes rollback metadata, correlation IDs, product image IDs, and variant IDs from `ProductSetInput`.

The compensating payload is an operator-reviewed artifact. It is not automatically submitted.

## Manual Execution Runbook

1. Confirm the candidate product, tenant, installation, Shopify product GID, and release approval.
2. Generate the controlled mutation correlation ID.
3. Capture the rollback snapshot before sending the controlled mutation.
4. Build and store the compensating payload from that snapshot.
5. Review the intended controlled mutation and the compensating payload side by side.
6. Execute the controlled mutation only after the snapshot and rollback payload are attached to the pause-point evidence.
7. If rollback is explicitly approved later, submit the compensating payload through the controlled ProductSet transport path and preserve the rollback correlation ID in logs.

## Limitations

This rollback plan does not automatically undo:

- Shopify webhook emissions.
- Search, analytics, cache, or downstream connector side effects.
- Publication visibility timing.
- Inventory quantities or location-level inventory state.
- Deleted media assets whose original URLs no longer resolve.
- New product creation. A create rollback would require a separate delete/archive policy and approval.

## Story 004 Completion Boundary

This document and the code scaffold are not enough to lock `ST-CON-VMUT-004`.

The story can be locked only after a real candidate product is selected and evidence shows that:

- The pre-mutation snapshot was captured successfully for that product.
- The compensating payload was generated from the captured snapshot.
- The payload was reviewed as the rollback artifact for the release pause point.
- The evidence is recorded in `docs/execution/INCREMENT_STATE.json`.
