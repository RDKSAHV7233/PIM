# PIM1 PRD to Engineering Backlog

- Source: `docs/product/PRD.md`
- Purpose: Convert PRD requirements into execution-ready engineering backlog.
- Format: `Epic -> Story -> Acceptance Criteria`
- Date: 2026-03-03

## 1. Epic Overview

| Epic ID | Epic | PRD Mapping | Current Status |
|---|---|---|---|
| E1 | Seller-first Products UX | FR-001, FR-002, FR-003, FR-004, FR-008 | Complete (2026-03-03) |
| E2 | Catalog and Compliance Core | FR-002, FR-003, FR-007 | Complete (2026-03-03) |
| E3 | Bulk Import and Row Repair | FR-005 | Complete (2026-03-03) |
| E4 | Bulk Edit and History | FR-006 | Complete (2026-03-03) |
| E5 | Connector Framework and Submission | FR-009, FR-010, CR-001..CR-010 | Complete baseline + mapping lifecycle/readiness verified |
| E6 | Tenant Safety and Auth Hardening | NFR-001, NFR-002, DG-002 | Complete (2026-03-03) |
| E7 | Runtime Reliability and Ops Gates | NFR-003..NFR-007, DG-001 | Complete (2026-03-03) |
| E8 | Dashboard Aggregations | FR-011 | Complete (2026-03-03) |
| E9 | Data Governance and Compliance | DG-001..DG-004 | Complete (2026-03-03) |
| E10 | Quality Gates and Release Readiness | PRD section 12, 13, 15 | Complete (2026-03-03) |

## 2. Backlog

### E1. Seller-first Products UX

#### ST-UI-001: Products tab is default landing and bookmarkable
- PRD: FR-001
- Acceptance:
1. `/` loads with `tab=products` behavior by default.
2. `?tab=products|import|bulk-edit|categories|developer` opens the correct tab.
3. Refresh preserves tab state from URL.

#### ST-UI-002: Triage summary correctness and loading state
- PRD: FR-002
- Acceptance:
1. Triage counts are derived from compliance + channel readiness.
2. While readiness is unresolved, skeleton/loading placeholders are shown.
3. Ready count excludes products with any channel block.

#### ST-UI-003: Create Product as structured form component
- PRD: FR-003, FR-004
- Acceptance:
1. Form is extracted into reusable component.
2. All fields have visible labels above controls.
3. Category selection loads typed attributes (string/number/boolean/enum).
4. Seller-facing raw JSON textarea is not shown.

#### ST-UI-004: Internal links isolated from seller workflow
- PRD: FR-008
- Acceptance:
1. Internal developer links are visible only in Developer tab.
2. Products tab contains no developer scaffold sections.

### E2. Catalog and Compliance Core

#### ST-CAT-001: Product compliance labeling clarity
- PRD: FR-002
- Acceptance:
1. Product list uses `Compliance Issues` label.
2. Tooltip clarifies compliance vs channel readiness scope.

#### ST-CAT-002: Category role behavior
- PRD: FR-007
- Acceptance:
1. Admin sees category create form.
2. Editor/viewer see category list only.
3. No disabled/empty create card for non-admin roles.

### E3. Bulk Import and Row Repair

#### ST-IMP-001: Import templates management
- PRD: FR-005
- Acceptance:
1. Template create/update/list supports tenant and category scope.
2. Template selection pre-fills import form defaults.

#### ST-IMP-002: Import job processing with retry/DLQ
- PRD: FR-005
- Acceptance:
1. Job states include queued/processing/retrying/completed/failed/dead-letter.
2. Failed rows can be retried from DLQ path.
3. Error report export is available for failed/dead-letter jobs.

#### ST-IMP-003: Row repair console
- PRD: FR-005
- Acceptance:
1. Failed rows show translated error message and editable repair inputs.
2. Save-and-retry updates row and requeues processing.

### E4. Bulk Edit and History

#### ST-BE-001: Bulk edit preview and apply
- PRD: FR-006
- Acceptance:
1. Scope filters (category/status/brand/productIds) apply correctly.
2. Preview shows impacted count and before/after diff.
3. Apply persists updates only to matched records.

#### ST-BE-002: Immutable operation history
- PRD: FR-006
- Acceptance:
1. History records requested/applied/failed counts and update payload.
2. Completed operations are not mutable.

### E5. Connector Framework and Submission

#### ST-CON-001: Capability-guarded orchestration paths
- PRD: FR-009, CR-004, CR-005
- Acceptance:
1. Publish flow checks `installation.capabilities.includes("PUBLISH")`.
2. Export-only connectors use explicit export completion path.
3. Unsupported capability calls return deterministic error type.

#### ST-CON-002: Stable idempotency key semantics
- PRD: CR-001
- Acceptance:
1. Submission idempotency key is stable per logical operation (`{jobId}:PUBLISH` equivalent).
2. Retry attempt number is tracked separately from idempotency key.
3. Duplicate retries do not create duplicate external submissions.

#### ST-CON-003: Webhook dedupe scope
- PRD: CR-002
- Acceptance:
1. Webhook uniqueness is installation/account scoped.
2. Same external event id from different installations is accepted independently.

#### ST-CON-004: Structured connector errors end-to-end
- PRD: CR-003
- Acceptance:
1. `normaliseError` returns `ConnectorIssue`.
2. `code`, `fieldPath`, `severity`, `sellerMessage` survive to API response and storage.

#### ST-CON-005: Payload snapshot policy for submissions
- PRD: FR-010
- Acceptance:
1. Snapshot size cap enforced at application layer.
2. Oversize payloads are stored out-of-row with URL pointer and truncation marker.

#### ST-CON-006: Public mapping lifecycle contract alignment
- PRD: CR-006, CR-007
- Acceptance:
1. Public mapping version APIs create only `tenant_connector_default` and `tenant_connector_category_mapping`.
2. Only `published` mapping versions participate in effective resolution and export readiness.
3. Connector default templates remain internal/system defaults until a separate authoring surface is introduced.

#### ST-CON-007: Category-scoped taxonomy alignment and readiness gate
- PRD: CR-008, CR-009
- Acceptance:
1. Category alignment is expressed through `categoryScope` plus taxonomy search/unmapped flows.
2. Export job creation blocks on missing installation/capability, expired credentials, required attribute mapping gaps, product/category mismatch, and fallback acknowledgement requirements.
3. Legacy template flow is treated as transitional and not the canonical lifecycle mapping path.

#### ST-CON-008: Hybrid connector discovery is explicit
- PRD: CR-010
- Acceptance:
1. Connector registry activates runtime connectors from database definitions only when a compiled implementation exists.
2. Missing runtime implementation is reported deterministically and skipped.
3. Manifest/plugin discovery is explicitly tracked as future scope, not assumed by current connector sprints.

### E6. Tenant Safety and Auth Hardening

#### ST-SEC-001: Tenant scoping enforcement
- PRD: NFR-001
- Acceptance:
1. Tenant-scoped models use tenant filters on reads/writes.
2. Isolation test proves no cross-tenant leakage under concurrent access.

#### ST-SEC-002: JWT `jti` revocation and guard checks
- PRD: NFR-002
- Acceptance:
1. JWT includes `jti`.
2. Logout/revocation blocklists token id with TTL.
3. Revoked token access returns 401.

#### ST-SEC-003: Audit and secret hygiene
- PRD: DG-002
- Acceptance:
1. Audit metadata excludes raw secrets/tokens/credential values.
2. Secret rotation events are auditable without exposing secret material.

### E7. Runtime Reliability and Ops Gates

#### ST-OPS-001: Encryption versioning and key rotation
- PRD: NFR-003
- Acceptance:
1. Encrypt writes current key version.
2. Decrypt supports historical key version from row metadata.
3. Rotation supports dry-run and execute modes.

#### ST-OPS-002: Worker backpressure and limits
- PRD: NFR-004
- Acceptance:
1. Connector workers enforce per-connector concurrency and rate limits.
2. Rate-limit storm triggers circuit breaker/pause behavior.

#### ST-OPS-003: API pagination standards
- PRD: NFR-005
- Acceptance:
1. List endpoints support cursor pagination.
2. Default and max limits are enforced.

#### ST-OPS-004: Startup env validation
- PRD: NFR-006
- Acceptance:
1. Missing/invalid required env causes startup failure with readable errors.
2. Valid env starts app normally.

#### ST-OPS-005: Staging-only gate sign-off
- PRD: NFR-007
- Acceptance:
1. Increment gate evidence records environment=`staging` and tenant id.
2. Gate check artifacts include run URL and git tag.

### E8. Dashboard Aggregations

#### ST-DASH-001: Readiness summary endpoint
- PRD: FR-011
- Acceptance:
1. Returns per-connector ready/blocked/pending counts.
2. Uses cached aggregate with bounded TTL.

#### ST-DASH-002: Catalog health endpoint
- PRD: FR-011
- Acceptance:
1. Returns completeness distribution and missing-field counts.
2. Supports large catalogs within target p95.

#### ST-DASH-003: Billing usage endpoint
- PRD: FR-011
- Acceptance:
1. Returns current usage vs plan limits for month.
2. Values match recomputed usage source of truth.

### E9. Data Governance and Compliance

#### ST-DG-001: Payload retention and redaction policy
- PRD: DG-001
- Acceptance:
1. Retention windows and purge actions are defined and implemented.
2. Raw payload logging is restricted per policy.

#### ST-DG-002: Test data governance in production views
- PRD: DG-003
- Acceptance:
1. Test data hidden by default across seller workflows.
2. Test artifacts are isolated and purge process documented.

#### ST-DG-003: Pre-growth compliance APIs
- PRD: DG-004
- Acceptance:
1. Consent version tracking is enforced.
2. Account export and erasure flows exist with audit trail.

### E10. Quality Gates and Release Readiness

#### ST-QA-001: Increment gate automation
- PRD: section 12
- Acceptance:
1. Lint/build/test gates run per increment slice.
2. Named suites for idempotency, webhook dedupe, isolation, notification pass.

#### ST-QA-002: Metrics instrumentation
- PRD: section 13
- Acceptance:
1. Readiness accuracy, throughput, rejection, and reliability metrics are emitted.
2. Dashboards can report trend by tenant and connector.

#### ST-QA-003: Controlled-release checklist
- PRD: section 15
- Acceptance:
1. Security/ops/compliance blockers list is explicit.
2. Controlled rollout and broad rollout criteria are separately defined.

## 3. Definition of Done (Backlog Item)
Each story is complete only when:
1. Code implementation is merged with tests.
2. Acceptance criteria above are demonstrably met.
3. Lint/build pass for impacted workspaces.
4. Evidence note is recorded under `docs/execution`.

## 4. Prioritization Order
1. E1, E2, E3, E4 (seller-visible correctness and throughput)
2. E6, E7 (safety, reliability, operability)
3. E5 (connector hardening and external integration correctness)
4. E8, E9, E10 (analytics, governance, and release controls)

## 5. Execution Evidence
- E1 completion evidence: `docs/execution/E1_STORIES_EXECUTION_2026-03-03.md`
- E2-E4 completion evidence: `docs/execution/E2_E4_STORIES_EXECUTION_2026-03-03.md`
- E5 partial evidence (ST-CON-001, ST-CON-002): `docs/execution/E5_PARTIAL_ST-CON-001_ST-CON-002_EXECUTION_2026-03-03.md`
- E5 partial evidence (ST-CON-003): `docs/execution/E5_PARTIAL_ST-CON-003_EXECUTION_2026-03-03.md`
- E5 partial evidence (ST-CON-004): `docs/execution/E5_PARTIAL_ST-CON-004_EXECUTION_2026-03-03.md`
- E5 partial evidence (ST-CON-005): `docs/execution/E5_PARTIAL_ST-CON-005_EXECUTION_2026-03-03.md`
- E5/INC-09 connector mapping lifecycle + publish-readiness evidence: `docs/execution/INCREMENT_STATE.json` (`INC-09`, `ST-CON-MAP-CTOPO-001`)
- E6 completion evidence: `docs/execution/E6_STORIES_EXECUTION_2026-03-03.md`
- E7 partial evidence (ST-OPS-004): `docs/execution/E7_PARTIAL_ST-OPS-004_EXECUTION_2026-03-03.md`
- E7 partial evidence (ST-OPS-003): `docs/execution/E7_PARTIAL_ST-OPS-003_EXECUTION_2026-03-03.md`
- E7 partial evidence (ST-OPS-001): `docs/execution/E7_PARTIAL_ST-OPS-001_EXECUTION_2026-03-03.md`
- E7 partial evidence (ST-OPS-002): `docs/execution/E7_PARTIAL_ST-OPS-002_EXECUTION_2026-03-03.md`
- E7 partial evidence (ST-OPS-005): `docs/execution/E7_PARTIAL_ST-OPS-005_EXECUTION_2026-03-03.md`
- E8 completion evidence: `docs/execution/E8_STORIES_EXECUTION_2026-03-03.md`
- E9 completion evidence: `docs/execution/E9_STORIES_EXECUTION_2026-03-03.md`
- E10 completion evidence: `docs/execution/E10_STORIES_EXECUTION_2026-03-03.md`

## 6. Increment Mapping (Current Source of Truth)
- `INC-01 Seller Workflow Core` -> `E1`, `E2`
- `INC-02 Catalog Throughput` -> `E3`, `E4`
- `INC-03 Connector Reliability` -> `E5`
- `INC-04 Security and Isolation` -> `E6`
- `INC-05 Ops and Observability` -> `E7`
- `INC-06 Decision Dashboards` -> `E8`
- `INC-07 Governance and Compliance` -> `E9`
- `INC-08 Release Readiness` -> `E10`

Execution and status tracking must reference increment IDs, not phases.
