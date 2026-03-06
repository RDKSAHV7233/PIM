# PIM1 Connector Developer Guide (CTO Validated, Single Source of Truth)

Date: 2026-03-06  
Canonical file: `docs/connectors/PIM1_CONNECTOR_DEVELOPER_GUIDE_CTO_VALIDATED.md`
SSOT index: `docs/PIM1_SINGLE_SOURCE_OF_TRUTH.md`

## 1) Scope and Governance

This is the only authoritative connector-development document for this repository.

If another document overlaps this scope, that document must only reference this file and not restate contracts.

## 2) CTO + PO Readiness Summary

- Architecture readiness: **pass (PIM1-scoped runtime binding by design)**
- Platform contracts: **pass with adapter contract** (connector-runtime contracts are strong; PIM-facing compatibility endpoints now exist via backend + adapter path)
- Developer workflow: **pass for internal teams, partial for external developer program**

Decision: proceed with controlled connector development.

Runtime binding note for PIM1:
- Current runtime binding is intentionally limited to connectors with implemented runtime classes (`flipkart`, `whatsapp`, `tally`) in `src/connectors/runtime/loader.ts`.
- For PIM1 product scope, this is a controlled-launch decision, not a product blocker.
- It becomes a blocker only for a fully externalized connector marketplace where arbitrary third-party connectors must load dynamically.

## 2.1) Platform Contract Closure (E2E Connector Flow)

Current state:
- Connector runtime and ingest remain production-shaped.
- Compatibility endpoints expected by the PIM1 UI package are now present in this backend route surface.
- Product/media fetch is handled through a strict adapter contract (`PIM1_ADAPTER_BASE_URL`) and fails closed when not configured.

CTO/PO decision for PIM1:
- Contract blocker is closed for current PIM1 release line.
- Externalized connector program still requires upstream PIM API availability in environments where product/media data is not hosted by this backend.

## 3) Capability Matrix (Product Checklist)

| Capability | Status | Evidence |
|---|---|---|
| Canonical product schema | PARTIAL | Product schema/types are in local PIM1 package: `pim1-local/codex-ui-package/src/types/api.ts:31`; not found in current backend route surface under `src/**`. |
| Product fetch API | EXISTS (adapter-backed) | Compatibility endpoint: `GET /products` in `src/auth/protected-routes.ts`; upstream adapter contract in `src/auth/pim1-adapter.ts`. |
| Media fetch API | EXISTS (adapter-backed) | Compatibility endpoint: `GET /media/:id` in `src/auth/protected-routes.ts`; upstream adapter contract in `src/auth/pim1-adapter.ts`. |
| Connector installation model | EXISTS | Compatibility endpoints: `GET /connectors/installed`, `POST /connectors/:slug/install`, `DELETE /connectors/:slug/install/:id` in `src/auth/protected-routes.ts`. |
| Credential storage | EXISTS | `connector_configs.encrypted_fields`: `db/01-schema.sql:860`, `db/01-schema.sql:868`; masking + encrypted handling: `src/auth/connector-security.ts:693`, `src/auth/connector-security.ts:1025`. |
| Job execution framework | EXISTS | `executions`, `execution_events`, queue, DLQ: `db/01-schema.sql:242`, `db/01-schema.sql:255`, `db/01-schema.sql:286`, `db/01-schema.sql:317`; worker runtime: `src/auth/execution-worker.ts:17`. |
| Submission logs | EXISTS | Compatibility endpoints: `GET /submissions`, `GET /submissions/stats` in `src/auth/protected-routes.ts` (execution-backed). |
| Retry/requeue system | EXISTS | Requeue/DLQ replay paths: `src/auth/execution-repository.ts:426`, `src/auth/execution-repository.ts:495`, `src/auth/protected-routes.ts:1308`, `src/auth/protected-routes.ts:1352`. |
| Attribute mapping UI | MISSING (mounted UI) / PLANNED | Planned in `pim1-local/codex-ui-package/ui-tasks.json:534`; not mounted in current `admin-ui` flow. |
| Category mapping UI | MISSING (mounted UI) / PLANNED | Planned in `pim1-local/codex-ui-package/ui-tasks.json:529` and `:534`; not mounted in current `admin-ui` flow. |
| Connector event ingestion | EXISTS | Canonical schema + handler: `src/auth/protected-routes.ts:114`, `src/auth/protected-routes.ts:1549`; normalization: `src/auth/protected-routes.ts:270`; idempotency uniqueness: `db/01-schema.sql:309`. |

## 4) Authoritative Current Backend Connector Contracts

- Event ingestion:
  - `POST /connectors/events` (`src/auth/protected-routes.ts:1549`)
- PIM1 compatibility:
  - `GET /products` (adapter-backed)
  - `GET /media/:id` (adapter-backed)
  - `GET /submissions`
  - `GET /submissions/stats`
  - `GET /connectors/installed`
  - `POST /connectors/:slug/install`
  - `DELETE /connectors/:slug/install/:id`
- Runtime catalog/definitions:
  - `GET /internal/connectors/catalog` (`src/auth/protected-routes.ts:752`)
  - `GET /internal/connectors/definitions` (`src/auth/protected-routes.ts:783`)
  - `POST /internal/connectors/definitions` (`src/auth/protected-routes.ts:800`)
  - `POST /internal/connectors/definitions/sync` (`src/auth/protected-routes.ts:843`)
- Marketplace:
  - `GET /internal/connectors/marketplace` (`src/auth/protected-routes.ts:856`)
  - `POST /internal/connectors/marketplace` (`src/auth/protected-routes.ts:873`)
- Tenant runtime config:
  - `GET /internal/connectors/config` (`src/auth/protected-routes.ts:910`)
  - `PUT /internal/connectors/config` (`src/auth/protected-routes.ts:933`)
- Admin controls:
  - `POST /admin/connectors/:id/test-connection` (`src/auth/protected-routes.ts:1731`)
  - `GET /admin/connectors/:id/config` (`src/auth/protected-routes.ts:1773`)
  - `/admin/connectors/:id/circuit-breaker*` (`src/auth/protected-routes.ts:1796`)

## 5) Target Profile Mapping (PIM1 Local Package -> Current Backend)

| PIM1 package reference | Current backend mapping | Status |
|---|---|---|
| `GET /api/v1/connectors/installed` | `GET /internal/connectors/health` + tenant config surfaces | mapped (semantic adapter) |
| `POST /api/v1/connectors/:slug/install` | `POST /connectors/:slug/install` | implemented |
| `DELETE /api/v1/connectors/:slug/install/:id` | `DELETE /connectors/:slug/install/:id` | implemented |
| `POST /api/v1/connectors/meesho/test-credentials` | `POST /admin/connectors/:id/test-connection` | mapped (guarded) |
| `POST /api/v1/marketplace/export-job` | workflow via `/connectors/events` + execution APIs | mapped at runtime layer |
| `GET /api/v1/submissions` | `GET /submissions` (+ `/submissions/stats`) | implemented |
| `GET /api/v1/products` | `GET /products` (adapter-backed) | implemented (adapter contract) |
| `GET /api/v1/media/:id` | `GET /media/:id` (adapter-backed) | implemented (adapter contract) |

## 6) Runtime and Security Validation

Implemented and validated:
- Runtime contract typing + definition validation in `src/connectors/runtime/types.ts`.
- DB-backed definition store/loader in `src/connectors/runtime/definition-store.ts`.
- Ingest hardening: connector scopes, binding checks, HMAC policy, idempotency, queue saturation in `src/auth/protected-routes.ts:1549`.
- SSRF/OAuth egress control in `src/auth/connector-security.ts:584`, `src/auth/connector-security.ts:632`, `src/auth/connector-security.ts:660`.
- API key connector binding enforcement in `src/auth/service.ts:1600` and `src/auth/service.ts:1669`.

## 7) Database Contracts

- `connector_event_queue`: `db/01-schema.sql:286`
- `connector_event_idempotency`: `db/01-schema.sql:302`
- `dlq_entries`: `db/01-schema.sql:317`
- `connector_instance_state`: `db/01-schema.sql:337`
- `connector_configs`: `db/01-schema.sql:860`
- `api_keys` with optional `connector_id`: `db/01-schema.sql:147`, `db/01-schema.sql:150`

## 8) Validation Evidence (Latest)

Commands:
- `npm run typecheck`
- `npx jest tests/t31.connector-ingest-contract.integration.test.js tests/t34.connector-runtime-db-registry.test.js tests/t34.flipkart-poller.integration.test.js tests/t12.connector-security.test.js tests/t19.connector-sdk.test.js tests/t33.p1-integrity-security.test.js --runInBand`

Results:
- Typecheck: pass
- Test suites: 6/6 pass
- Tests: 22/22 pass

## 9) Documentation Blocker Closure

- Architecture suite exists in repo: `docs/architecture/PIM1_ENTERPRISE_DOCUMENTATION_SUITE.md`.
- Local package has explicit pointer to this canonical guide via `pim1-local/codex-ui-package/API_CONTRACT_UNIFIED.md`.

## 10) Change Policy

When changing connector contracts:
1. Update this file first.
2. Update code/routes/schema/tests.
3. Re-run validation.
4. Keep all related docs as pointers only.

## 11) Execution Baseline (CTO + PO Locked)

Date locked: 2026-03-06

### 11.1 Core Design Decisions (must be explicit before build)

1. Mapping lifecycle
- draft -> validated -> published -> superseded -> archived
- Submission engine uses published versions only.
- One published version per (tenant, connector, category_scope).

2. Mapping precedence (deterministic)
- connector_default_template
- 	enant_connector_default (published)
- 	enant_connector_category_mapping (published)
- ttribute_override
- Highest specificity wins.

3. Compatibility/version rules
- Every mapping version stores connector_definition_id + connector_definition_version.
- Compatibility states: compatible | deprecated | remap_required | blocked.
- Submission preflight blocks when state is locked.

4. Fallback policy
- No silent fallback.
- Fallback category mappings must be explicit, warning-tagged, and auditable.
- Publish using fallback requires explicit acknowledgement.

### 11.2 Revised Delivery Phases

Phase A1 - Mapping Domain + Resolution Engine
- DB schema for mapping versions, lifecycle, and precedence metadata.
- Deterministic resolver with category context primitive.
- Validation engine and audit model for mapping lifecycle events.

DoD
- Resolver precedence tests pass.
- One-published-version invariant enforced.
- Cross-tenant access denied by tests.

Phase A2 - Attribute Mapping UX
- Field mapping UI with required/missing states.
- Draft vs published controls.
- Structured preview (not raw JSON dump).

Preview must include
- source PIM values used
- mapped target fields
- missing required fields
- final transformed payload
- category/taxonomy context
- media included/excluded
- warnings vs blockers

Phase B - Category Mapping UX + Taxonomy Validation
- External taxonomy search/select.
- Unmapped category dashboard.
- Fallback tooling with warning gates.
- Category-aware validation feeding attribute checks.

Phase C - Unified Publish Readiness Panel (hard gate)
- Single preflight panel checks:
  - connector installed
  - credential validity
  - product completeness
  - media rules
  - category mapping
  - required attribute mappings
  - connector degraded/circuit status
- No publish when blockers exist.

Phase D - Dynamic Connector Discovery (V2)
- Replace static runtime binding set with manifest/registry discovery.
- Keep sandbox/allowlist controls.

### 11.3 Security and Control Model

MFA required (high risk)
- delete active published mapping
- delete connector config
- credential rotation
- force-open/force-close runtime breaker

No MFA, but confirmation + audit (medium risk)
- publish mapping version
- revert to prior mapping version

### 11.4 QA Requirements

- resolver precedence tests
- lifecycle transition tests
- compatibility drift tests (definition vs mapping version)
- rollback/revert tests
- cross-tenant negative tests
- preflight blocker aggregation tests
- fallback acknowledgement enforcement tests

### 11.5 PO Metrics

- mapping completion rate per connector
- first publish success rate
- rejection reduction
- setup time to first successful publish
- median time to resolve preflight blocker
- preflight blocker resolution rate

### 11.6 Go/No-Go Gates

Go for controlled rollout only when:
1. lifecycle + precedence + compatibility rules are implemented
2. category-aware validation is active
3. unified preflight hard gate is active
4. typecheck, tests, and build are green

This baseline is the execution reference for moving from runtime-ready connectors to seller-reliable publishing.
