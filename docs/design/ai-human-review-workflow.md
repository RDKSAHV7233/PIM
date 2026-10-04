# AI-GOV-001 Human Review Workflow

Status: Sprint 2 candidate design artifact. Blocked from runtime implementation until Gate A passes.

Owner: PO / UX / QA

Related issue: #1128

## Boundary

AI-GOV-001 defines the human review contract for governed product intelligence suggestions. It is intentionally non-runtime in this first PR:

- no application code changes
- no schema migration
- no provider integration
- no production configuration
- no Product Service mutation path

The invariant remains:

```text
AI proposes. Vexa validates. People approve. Product Service mutates.
```

## Reviewer Model

The reviewer must be able to evaluate a suggestion without confusing model output, reviewer judgment, and applied catalog state.

The workflow keeps these values distinct:

| Field | Meaning |
|---|---|
| `suggestedValue` | Immutable model-generated value. |
| `reviewDecision` | Reviewer decision: accept, edit, or reject. |
| `reviewedValue` | Reviewer-entered replacement when the decision is edit. |
| `appliedValue` | Value actually sent through the controlled Product Service apply path after approval. |

The original `suggestedValue` must not be overwritten when a reviewer edits it. This preserves acceptance, correction, and factual-quality measurement.

## Required Reviewer Surface

The review surface must show:

- original product/source context
- immutable suggested value
- evidence/provenance for each factual suggestion
- deterministic validation result
- confidence, when available
- freshness state
- reviewer decision history
- audit/event trail

The UI may group suggestions, but it must not hide evidence for factual suggestions behind a bulk-only action.

## Decision Semantics

Required review states:

- `pending_review`
- `accepted`
- `edited`
- `rejected`
- `blocked_stale`
- `blocked_tampered`
- `blocked_unauthorized`

`accept`

- allowed only when the suggestion is current, untampered, authorized for the tenant, and has required evidence
- preserves `suggestedValue`
- records `reviewedValue` equal to `suggestedValue`
- sets `reviewDecision = accept`
- does not directly mutate canonical Product data

`edit`

- requires `reviewedValue`
- requires an edit reason
- preserves `suggestedValue`
- records the correction as reviewer-authored data
- requires validation before controlled apply

`reject`

- records reviewer reason
- preserves `suggestedValue`
- must not write canonical Product data

## Stale And Tampered Protection

Acceptance or edit must be blocked when any of these are true:

- source product version has changed since generation
- prompt version or schema version does not match the reviewed suggestion
- evidence hash no longer matches the cited input
- tenant/capability does not match the current reviewer context
- suggestion payload was modified after generation outside allowed lifecycle metadata

## RBAC Expectations

The existing catalog approval surfaces are the starting evidence:

- `catalog_approve`: `admin`, `approver`, `reviewer`
- `catalog_comments`: `admin`, `editor`, `reviewer`, `approver`
- canonical catalog writes: `admin`, `editor`

AI-GOV must not broaden canonical write access. Reviewers can decide suggestions only through the governed review workflow. Approved suggestion application is a separate controlled Product Service action.

## Audit Expectations

Every decision must produce an audit/event record containing:

- tenant
- actor
- suggestion id
- capability
- decision
- previous lifecycle state
- new lifecycle state
- source version
- prompt version
- schema version
- evidence hash

## Bulk Review Constraint

Bulk review remains a later capability. Before bulk processing is enabled, Vexa must prove:

- every selected suggestion has required evidence
- stale/tampered checks run per suggestion
- reviewer burden and error risk are assessed
- bulk accept cannot bypass Product Service validation
- partial failure behavior is defined

## Verification

Run:

```powershell
node --check scripts/validate-ai-gov-review-workflow.cjs
node --check scripts/validate-ai-gov-review-workflow.test.cjs
node scripts/validate-ai-gov-review-workflow.test.cjs
node scripts/validate-ai-gov-review-workflow.cjs
git status --short -- apps packages prisma .github docs/openapi.yaml docs/openapi.json docs/vexa-pim.postman_collection.json package.json
```
