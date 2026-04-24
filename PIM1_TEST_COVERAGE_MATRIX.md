# PIM1 Critical Test Coverage Matrix

- Audit date: 2026-03-31
- Audit start HEAD: `78dd1c5`
- Continuation refresh HEAD: `8911dc5`
- Scope: business-critical launch areas only

| Area | Tests found | Executed in this audit | What is covered | What is not covered cleanly today | Confidence |
|---|---|---|---|---|---|
| Product workflow transitions | `apps/api/test/integration/product-workflow-transitions.test.cjs`, `apps/web/test/e2e/reviewer-approvals.spec.js` | PASS, PASS | allowed status transitions, review blocking on unresolved issues, reviewer browser flow | broader lifecycle around archive/reactivate not browser-verified in this audit | High |
| Mapping lifecycle | `apps/api/test/integration/connector-mapping-lifecycle.test.cjs`, `apps/web/test/e2e/channels-mapping-publish.spec.js` | PASS, PASS | draft -> validate -> publish, canonical UI publish path | connector-specific lifecycle outside current seller-ready path | High |
| Mapping precedence | `apps/api/test/integration/connector-mapping-precedence.test.cjs` | PASS | category mapping overrides tenant default, superseded versions stop participating, archived category mapping falls back | multi-connector precedence variance beyond tested path | High |
| Mapping rollback | `apps/api/test/integration/connector-mapping-rollback.test.cjs` | PASS | confirmation requirement, restore prior mapping as new published version, one-published-version invariant, tenant isolation | rollback behavior under partially implemented connectors | High |
| Step-up security | `apps/api/test/integration/connector-mapping-step-up.test.cjs`, `apps/web/test/integration/mapping-step-up-ui.test.cjs` | PASS, not executed | publish/rollback/archive require step-up, token binding, expiry handling | broader non-mapping step-up surface does not exist today | High |
| Tenant isolation | `apps/api/test/integration/rls-isolation.test.cjs`, `apps/api/test/integration/bulk-import-tenant-boundary.test.cjs`, `apps/api/test/integration/connector-mapping-rollback.test.cjs` | PASS, BLOCKED (`spawn EPERM`), PASS | RLS isolation under concurrent access, mapping rollback tenant isolation | bulk import tenant boundary did not complete in this environment; raw-SQL `RLS-BYPASS` services are not exhaustively covered; schema uniqueness still leaks tenant namespaces | Medium |
| Import validation and repair | `apps/api/test/integration/bulk-import-tenant-boundary.test.cjs`, `apps/web/test/e2e/operations-import-repair.spec.js`, `apps/web/test/integration/bulk-import-*.test.cjs` | BLOCKED (`spawn EPERM`), PASS, not executed | import UI path, process/repair loop, row repair UX | clean tenant-boundary proof and broader server-side validation breadth remain incomplete in the current run | Medium |
| Submission flow | `apps/api/test/integration/submission-lifecycle-api.test.cjs`, `apps/api/test/integration/marketplace-worker-failure-visibility.test.cjs`, `apps/api/test/integration/connector-idempotency-semantics.test.cjs`, `apps/web/test/e2e/channels-connector-detail-drilldown.spec.js` | PASS, PASS, FAIL/ENV-MIXED, PASS | create/list/detail/retry/dead-letter visibility, worker failure surfacing, connector detail drilldown | idempotency semantics are still not cleanly reproducible: root test path fails with `401 INVALID_CREDENTIALS`, standalone rerun hit `spawn EPERM` | Medium |
| Readiness gating | `apps/api/test/integration/marketplace-readiness-batch.test.cjs`, `apps/web/test/e2e/channels-mapping-publish.spec.js` | PASS, PASS | batch readiness calculation, mapping preflight/readiness UI path, export block wiring visible in code | cross-connector readiness quality where connector is partial | High |
| Connector capability gating | `apps/api/test/integration/connector-capability-orchestration.test.cjs`, `apps/api/test/integration/marketplace-capability-gating.test.cjs` | PASS, FAIL | capability orchestration rules, unsupported-capability error path | marketplace capability gating suite still fails current login bootstrap with `401 INVALID_CREDENTIALS` | Medium |
| Authorization / reviewer path | `apps/api/test/integration/quality-reviewer-role.test.cjs`, `apps/web/test/e2e/reviewer-approvals.spec.js`, `apps/api/test/integration/connector-access-entitlements.test.cjs` | PASS, PASS, PASS | reviewer role semantics, approval rights, connector access entitlements | no full matrix run across every admin/editor/reviewer/viewer route in this audit | High |
| Privacy / export / deletion | `apps/api/test/integration/auth-account-privacy.test.cjs`, `apps/web/test/e2e/admin-privacy-export.spec.js` | PASS, PASS | privacy status, export request/download path, delete-account controls | deletion completion remains scheduled/manual rather than fully lifecycle-tested here | Medium-High |
| Audit logging | `apps/api/test/integration/audit-actor-context.test.cjs`, `apps/api/test/integration/audit-explorer-api.test.cjs`, `apps/web/test/e2e/audit-explorer.spec.js` | PASS, PASS, PASS | actor capture, audit explorer API, browser audit surface | no stress/perf coverage for very large audit datasets in this audit | High |

## Summary

Strongly verified:
- mapping lifecycle
- precedence
- rollback
- step-up
- product workflow transitions
- readiness gating
- audit surfaces
- API build/lint/typecheck on current HEAD

Partially verified:
- tenant isolation as a launch property
- bulk import tenant boundaries
- full submission idempotency semantics
- connector capability gating bootstrap
- media security guard path

Main confidence reducers:
- root `cmd /c npm.cmd test` still fails at `connector-idempotency-semantics`
- several standalone integration suites hit `spawn EPERM` in the current environment
- some critical suites still fail login/workspace bootstrap with `INVALID_CREDENTIALS` or `WORKSPACE_NOT_FOUND`
- six browser flows still require `PLAYWRIGHT_SIGNUP_OUTBOX_DIR`
