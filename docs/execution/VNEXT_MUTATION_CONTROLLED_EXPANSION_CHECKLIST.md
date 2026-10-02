# Shopify vNext Controlled Expansion Checklist

Status: superseded by verified closeout on 2026-10-02. Production mutation
authority remains frozen. See
`docs/execution/SHOPIFY_VNEXT_CONTROLLED_MUTATION_CLOSEOUT_2026-10-02.md`.

This checklist governs any mutation after the first controlled Shopify vNext write recorded in `VNEXT_MUTATION_PAUSE_POINT_1_AUTHORIZATION.md`.

## Non-Write Remediation Gate

- Deploy only inert code while `VNEXT_MUTATION_ENABLED=false`.
- Do not execute mutation #2 until the deployed API emits structured controlled-mutation evidence.
- Required structured events:
  - `shopify_vnext_mutation_authorization_checked`
  - `shopify_vnext_mutation_started`
  - `shopify_vnext_controlled_mutation_executed`
  - `shopify_vnext_mutation_readback_verified`
  - `shopify_vnext_mutation_blocked`
  - `shopify_vnext_mutation_failed`
  - `shopify_vnext_mutation_readback_mismatch`
- Required gate tuple:
  - `VNEXT_MUTATION_ENABLED=true`
  - exact `VNEXT_MUTATION_ALLOWLIST_JSON`
  - exact `VNEXT_MUTATION_APPROVED_RELEASE_SHA`
  - `VNEXT_MUTATION_ALLOWED_FIELD_CLASS=image`
- Authorized vNext attempts are update-only and image-only. Missing existing Shopify product GID, missing image payload, provider failure, or readback mismatch must fail closed and must not fall back to legacy publish/update.
- Rollback model for mutation #2 is strict one-write authorization:
  - Maximum primary provider writes: `1`.
  - Automatic rollback: `NO`.
  - Rollback after mismatch or operator concern requires a separate explicit authorization.
  - Retry after ambiguous provider state or HTTP timeout: `NO`.
- The persisted `ConnectorSubmission.payloadSnapshot.__vnextMutationAudit` and the audit-log action `SHOPIFY_VNEXT_CONTROLLED_MUTATION_AUDIT` must contain enough redacted metadata to reconstruct execution after application logs expire.

## Image-Only Scope And Readback Rules

- The service must build the full vNext projection, compare its non-image product fields against the live pre-snapshot, and block the whole controlled mutation if any non-image field differs.
- The provider write may send only `files` with the existing product GID identifier.
- Payload checksum is SHA-256 over the actual narrowed provider input. The authorization packet must include this checksum, and execution evidence must match it.
- Image readback must not depend on raw Shopify CDN URL equality. Shopify may rewrite filenames, versions, URLs, or processing details.
- Readback verification requires:
  - Shopify product GID unchanged.
  - Stable non-image product state unchanged.
  - Expected image count present.
  - Expected alt text present when supplied.
  - Normalized image identity changed using Shopify image IDs and alt text, not raw image URLs.

## Read-Only Fixture Matrix

Run read-only preview/diff/snapshot evidence before preparing mutation #2. No ProductSet mutation is allowed during this matrix.

| Case | Required evidence |
| --- | --- |
| one image | preview diff, rollback snapshot, expected image-only scope |
| multiple images | preview diff, rollback snapshot, expected image count |
| variant-heavy | rollback snapshot proves variants remain stable |
| no image | blocked as missing authorized image payload |
| existing CDN image | before/after expected hash inputs are recorded without raw signed URLs |
| alt text | image alt expectations recorded |
| duplicate URL | expected dedupe or replacement behavior recorded |
| deleted or invalid external product | snapshot capture fails closed |
| product changed after preview | final snapshot refresh required |
| concurrent submission | only one authorized job may be active |
| large media payload | expected image count and provider limits recorded |
| cross-tenant reference | exact tuple miss blocks controlled mutation |

## Staging Configuration Matrix

Run this matrix before preparing the production packet. Only the final row may write, and only against a staging fixture.

| Enable gate | Field class | Request | Expected |
| --- | --- | --- | --- |
| unset | unset | image | BLOCK |
| false | image | image | BLOCK |
| true | unset | image | BLOCK |
| true | wrong value | image | BLOCK |
| true | image | non-image mutation | BLOCK |
| true | image | image plus another field | BLOCK |
| true | image | unauthorized product | BLOCK |
| true | image | create or nonexistent external product | BLOCK |
| true | image | exact authorized update | ALLOW only in controlled staging fixture |

## Mutation #2 Authorization Packet

Prepare a new packet and stop for explicit authorization. The packet must contain:

- One tenant, connector, installation, product, and Shopify product GID.
- One field class: `image`.
- One release SHA matching deployed `RAILWAY_GIT_COMMIT_SHA`.
- Max writes: `1`.
- Automatic rollback: `NO`.
- Legacy fallback after vNext starts: `NO`.
- Retry after ambiguous provider result: `NO`.
- Payload checksum for the exact narrowed `files` mutation input.
- Gate state before execution: `VNEXT_MUTATION_ENABLED=false`.
- Expiration time for the authorization window.
- Fresh live `captureRollbackSnapshot` output from the deployed code.
- Expected image-only diff and rollback payload.
- Evidence that the focused vNext gate suite, env-validation integration test, type check, and API build passed.

## Stop Rule

After preparing the mutation #2 packet, stop. The next production write requires a new explicit binary decision:

`AUTHORIZE SECOND CONTROLLED MUTATION`

or

`DO NOT AUTHORIZE`
