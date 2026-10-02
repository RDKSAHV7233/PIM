# Shopify vNext Controlled Mutation Closeout

Status: `VERIFIED`

Date: 2026-10-02 UTC

## Decision

The Shopify vNext controlled-mutation capability is verified and closed. The
production mutation gate remains off. No follow-up canary is required because
the single authorized provider write was semantically correct and the only
failure was the original verifier observing Shopify's transient media-settlement
state too early. The repaired verifier and a durable, idempotent read-only
reconciliation establish the final provider state without another write.

Future work must use the connector-onboarding standard; it must not reopen this
Shopify remediation without new regression evidence.

## Immutable Evidence

| Item | Evidence |
| --- | --- |
| Authorized provider-write release | `eaec811514a2ec84a89104a64e885d5c55b9a525` |
| Authorized submission | `1a8abe41-b879-4004-aa79-802ca4e7b601` |
| Product | PIM `cmt9mc8xe0010pf01pkieafm5`; Shopify `gid://shopify/Product/8087828889690` |
| Scope | tenant `admin`; connector `shopify`; installation `5b07df00-5b47-48f0-991b-2bc2f3fe8a95`; field class `image` |
| Before-state checksum | `e1e2fbcae8d1e86f264dbf2fd42ddb0a65fa77aaed6f7537aca3fcd1a576c407` |
| Authorized/runtime payload checksum | `d289fdc760f8ef07d6e9c08a46a27f60670980e31772499cc2e3cf84332e4ac6` |
| Original result | one provider write; zero legacy writes; zero retries; terminal `ERROR` with `SHOPIFY_VNEXT_READBACK_MISMATCH` |
| Verifier repair release | `a5885f3be025900d7621dd63cd672efe3f068183` |
| Reconciliation workflow release | `04ca33a99801a04332276026d018b04a8a891354` |
| First durable reconciliation | GitHub Actions run `37052138745`, successful |
| Idempotency confirmation | GitHub Actions run `37052626964`, successful; `alreadyReconciled: true` |

## Reconciled Provider State

The final read-only Shopify capture confirmed all required semantic invariants:

- Product GID remained `gid://shopify/Product/8087828889690`.
- Stable non-image state remained unchanged.
- Exactly one image exists, with Shopify image GID
  `gid://shopify/ProductImage/42709541617754`.
- The expected alt text is present: `RES-02 Approved Candidate 1787720001100-77`.
- The normalized image state changed from the captured pre-write state.
- Shopify-generated CDN identifiers and URLs were treated as provider-owned
  settlement details, not as a payload mismatch.

The reconciliation persisted `verified_after_provider_settlement` beneath the
existing `payloadSnapshot.__vnextMutationAudit` record and recorded that the
provider mutation occurred. The historical submission status and original
failure were intentionally retained, preserving an auditable account of the
initial verifier failure.

## Safety State

- `VNEXT_MUTATION_ENABLED` remains off.
- No new authorization exists for a controlled Shopify write.
- No retry, automatic rollback, or legacy fallback occurred.
- The idempotency confirmation performed no Shopify provider write and created
  no second reconciliation audit event.

## Ledger And Handoff

`INC-78` through `INC-83`, including `ST-CON-VMUT-001` through
`ST-CON-VMUT-005`, are already `completed` and `locked` in
`docs/execution/INCREMENT_STATE.json`. No locked implementation story was
modified for this evidence-only closeout.

The next workstream is connector onboarding: select the next connector and
apply the established target-schema, mapping, projection, exact-authorization,
provider-readback, durable-audit, and kill-switch pattern.
