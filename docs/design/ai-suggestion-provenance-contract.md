# AI-CORE-003 Suggestion Provenance Contract

Status: Sprint 2 candidate design artifact. Blocked from runtime implementation until Gate A passes.

Owner: Backend / QA / PIM SME

Related issue: #1123

## Boundary

This document defines the minimum `AiSuggestion` contract before persistence or runtime implementation begins.

This first artifact is non-runtime:

- no application code changes
- no schema migration
- no provider dependency
- no production configuration
- no Product Service mutation path

## Invariant

The generated suggestion is immutable after generation. Reviewer corrections, review decisions, and applied values are stored separately.

```text
suggestedValue != reviewedValue != appliedValue
```

The fields may be equal by value for an accepted suggestion, but they must remain separate concepts with separate authorship and audit meaning.

## Required Identity Fields

- `suggestionId`
- `executionId`
- `tenantKey`
- `entityType`
- `entityId`
- `capability`
- `fieldPath`
- `sourceRecordId`
- `sourceVersion`
- `sourceHash`
- `promptVersion`
- `schemaVersion`
- `generationFingerprint`
- `idempotencyFingerprint`

## Fingerprint Fields

The generation fingerprint must include:

- tenant
- capability
- entity type and id
- field path
- source version/hash
- prompt version
- schema version
- generated payload hash

The idempotency fingerprint must include the same identity boundary plus `generationFingerprint`.

## Immutable Generated Fields

- `suggestedValue`
- `suggestedValueHash`
- `generatedPayload`
- `generatedPayloadHash`
- `confidence`
- `evidence`
- `sourceVersion`
- `sourceHash`
- `promptVersion`
- `schemaVersion`
- `generationFingerprint`

Only lifecycle/review metadata may change after generation.

## Review And Apply Fields

- `reviewDecision`
- `reviewedValue`
- `reviewedValueHash`
- `reviewedBy`
- `reviewedAt`
- `reviewReason`
- `appliedValue`
- `appliedValueHash`
- `appliedAt`
- `productServiceApplyTransactionId`

AI itself must not set `appliedValue`, `appliedAt`, or `productServiceApplyTransactionId`.

## Forbidden Runtime Effects

The suggestion contract must not include:

- direct Product patches
- canonical Product updates
- Product Service mutations
- provider calls
- schema migrations

## Provenance Requirements

Every factual suggestion must include evidence:

- `sourceField`
- `sourceRecordId`
- `sourceVersion`
- `sourceHash`
- `citation`
- `evidenceHash`

Non-factual workflow suggestions may omit citation, but must explicitly mark `requiresEvidence = false`.

## Stale And Tampered Guards

Accept/edit/apply must be blocked when:

- current source version differs from generation source version
- current source hash differs from generation source hash
- generated payload hash differs from server-stored hash
- evidence hash differs from server-stored evidence hash
- tenant or capability context differs
- reviewer lacks the required review permission
- a direct Product patch/write field appears in a suggestion artifact

## Evaluation Fields

Evaluation must be able to measure:

- accepted without edit
- edited/corrected
- rejected
- stale/tampered blocked
- evidence coverage
- correction delta
- attribute-family precision

## Verification

Run:

```powershell
node --check scripts/validate-ai-core-suggestion-provenance.cjs
node --check scripts/validate-ai-core-suggestion-provenance.test.cjs
node scripts/validate-ai-core-suggestion-provenance.test.cjs
node scripts/validate-ai-core-suggestion-provenance.cjs
git status --short -- apps packages prisma .github docs/openapi.yaml docs/openapi.json docs/vexa-pim.postman_collection.json package.json
```
