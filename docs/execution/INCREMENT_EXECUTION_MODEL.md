# PIM1 Increment-First Delivery Model

Date: 2026-03-05  
Scope: Replace legacy stage-driven execution language with functional increments.

## Execution Rule
- Delivery is tracked by `Increment -> Story -> Acceptance Tests`.
- Legacy stage labels are not used for planning, status, or release communication.
- Every `continue` step must reference an `Increment ID` and `Story ID`.

## Functional Increments

## INC-01 Seller Workflow Core
- Goal: Seller-facing daily workflow is usable and predictable.
- Includes:
  - Product landing/navigation
  - Triage and readiness correctness
  - Create product UX and validation
  - Internal tools isolation from seller flows
- Primary stories:
  - `ST-UI-*`, `ST-CAT-*`

## INC-02 Catalog Throughput
- Goal: High-volume catalog operations are safe and fast.
- Includes:
  - Bulk import + row repair
  - Bulk edit + operation history
- Primary stories:
  - `ST-IMP-*`, `ST-BE-*`

## INC-03 Connector Reliability
- Goal: Connector orchestration is deterministic and capability-safe.
- Includes:
  - Capability guards
  - Stable idempotency
  - Webhook dedupe scope
  - Structured connector errors
  - Submission payload policy
- Primary stories:
  - `ST-CON-*`

## INC-04 Security and Isolation
- Goal: Tenant safety and trust boundaries are enforced by default.
- Includes:
  - Tenant scoping controls
  - JWT revocation and session safety
  - Audit and secret hygiene
- Primary stories:
  - `ST-SEC-*`

## INC-05 Ops and Observability
- Goal: Runtime behavior is stable, measurable, and supportable.
- Includes:
  - Encryption/versioning operations
  - Worker concurrency/backpressure
  - Pagination standards
  - Startup env validation
  - Staging gate sign-off discipline
- Primary stories:
  - `ST-OPS-*`

## INC-06 Decision Dashboards
- Goal: Readiness and health signals are actionable.
- Includes:
  - Readiness summary
  - Catalog health
  - Billing usage
- Primary stories:
  - `ST-DASH-*`

## INC-07 Governance and Compliance
- Goal: Data governance controls are explicit and enforceable.
- Includes:
  - Retention/redaction policy
  - Production test-data governance
  - Consent/export/erasure APIs
- Primary stories:
  - `ST-DG-*`

## INC-08 Release Readiness
- Goal: Ship gates are objective, repeatable, and evidence-backed.
- Includes:
  - Increment gate automation
  - Metrics instrumentation
  - Controlled release checklist
- Primary stories:
  - `ST-QA-*`

## Tracking Files
- Active state file: `docs/execution/INCREMENT_STATE.json`
- Legacy alias: `docs/execution/PHASE_STATE.json` (redirect only)
- Task checklist: `docs/execution/TASK_EXECUTION_CHECKLIST.md`

## Mandatory Step Format
Use this format in execution logs and updates:
`Increment: INC-XX | Story: ST-XXX-YYY | Action: <what changed> | Validation: <commands + result>`
