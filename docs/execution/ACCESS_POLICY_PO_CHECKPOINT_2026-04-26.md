# Vexa PIM Access Policy PO Checkpoint - 2026-04-26

Baseline:
- [Access Policy PO Execution Plan - 2026-04-25](./ACCESS_POLICY_PO_EXECUTION_PLAN_2026-04-25.md)
- [Access Policy Execution Record - 2026-04-26](./ACCESS_POLICY_EXECUTION_RECORD_2026-04-26.md)
- [Enterprise Delegated-Access Report - 2026-04-25](./VEXA_PIM_ENTERPRISE_DELEGATED_ACCESS_REPORT_2026-04-25.md)

## PO Decision

Decision: **Continue approved as a controlled remediation milestone.**

This checkpoint confirms that the access-policy and delegated-access implementation is not only present in code, but also validated through the current repo test surface, exposed through standard repo commands, verified against the deployed staging app, and backed by GitHub deploy-run evidence for the bounded access-policy slice.

This is still **not** approval to position Vexa as fully enterprise-access-policy ready.

## What Changed Since The Prior PO Check

The prior PO execution plan and delegated-access report already documented:

- stale JWT rejection after later lock/deactivate
- workflow content locking
- restricted field and payload protection
- delegated access for currently supported scope dimensions
- denial auditing with sanitized metadata

This checkpoint adds confirmation that:

- the implemented access-policy behavior still builds and passes focused regression tests
- the delegated-access behavior still passes end-to-end supported-scope validation
- the access-policy suites are now callable through standard npm commands
- the governance product suite now includes the new access-policy and delegated-access validations
- the GitHub CI workflow now includes the critical access-policy hardening and delegated-access scope tests
- the formal increment and sprint gate runners now include these authz suites and pass successfully
- the branch now has a formal checked-in execution record for this access-policy gate slice
- the deployed staging app now passes real admin smoke validation for health, trust-boundary, auth revocation, and governance rendering
- the deployed staging app now also passes selected non-admin denial-path validation for viewer, reviewer, and editor behavior
- the staging smoke path is now stronger because the checked-in post-deploy checker can automate those non-admin validations instead of relying on one-off manual probes
- the staging deploy workflow now enables the enhanced non-admin smoke path for future deploy-backed staging signoff runs
- GitHub CI and Deploy Staging both passed on commit `6f4f7d4`, and the uploaded staging gate artifact bundle passed local evidence validation

## Evidence Executed In This Checkpoint

| Area | Command | Result | Notes |
|---|---|---|---|
| API build | `npm run build --workspace @pim1/api` | Passed | Backend compiles cleanly |
| Web build | `npm run build --workspace @pim1/web` | Passed | Frontend compiles cleanly |
| Access-policy remediation | `node apps/api/test/integration/access-policy-remediation.test.cjs` | Passed | Restricted writes, payload restrictions, denial auditing |
| Delegated-access scopes | `node apps/api/test/integration/delegated-access-scopes.test.cjs` | Passed | Category, brand, channel, connector-account scope enforcement |
| JWT revocation baseline | `node apps/api/test/integration/auth-revocation.test.cjs` | Passed | Logout/revocation behavior preserved |
| User lock/deactivate stale-token protection | `node apps/api/test/integration/workspace-user-crud.test.cjs` | Passed | Later lock/deactivate rejects stale JWT |
| Workflow locking | `node apps/api/test/integration/product-workflow-transitions.test.cjs` | Passed | Approved/archived content lock preserved |
| Admin users route contract | `node apps/web/test/integration/admin-users-route-contract.test.cjs` | Passed | Delegated-scope management UI remains aligned |
| Connector install form | `node apps/web/test/integration/connector-install-form.test.cjs` | Passed | Connector setup contract remains intact |
| Standard npm entrypoint | `npm run test:integration:access-policy-remediation` | Passed | Standardized script added |
| Standard npm entrypoint | `npm run test:integration:delegated-access-scopes` | Passed | Standardized script added |
| Formal increment gate | `npm run gate:run:increment` | Passed | Includes workflow, session, access-policy, and delegated-access authz checks |
| Formal sprint gate | `npm run gate:run:sprint` | Passed | Sprint gate path aligned to sprint runner and passes with authz checks |
| Staging deploy workflow guard | `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Confirms deploy workflow now enables `STAGING_VALIDATE_NON_ADMIN=true` |
| Local staging-format signoff | `$env:APP_ENV='staging'; npm run gate:signoff -- --suite ACCESS-POLICY-LOCAL-GATE-SIGNOFF --tenantId SMOKE_TENANT_LOCAL --runUrl local://pim1/access-policy-local-gate-signoff-2026-04-26` | Passed | Local artifact written for repo gate traceability; not a deploy-backed staging proof |
| Controlled rollout snapshot | `$env:APP_ENV='staging'; npm run rollout:snapshot -- --environment staging --tenantId SMOKE_TENANT_LOCAL` | Passed | Local rollout snapshot recorded current gate continuity; live staging health still unavailable in local-only context |
| Live staging API smoke | staging health, legacy-header rejection, login, billing usage, installed connectors, audit logs, logout, revoked-token replay | Passed | Executed against the deployed staging API with supplied smoke credentials and DNS override workaround |
| Live staging web smoke | staging web login, `/channels`, `/admin/connectors` | Passed | Admin governance CTA and policy form render correctly; read-only fallback strings absent |
| Staging smoke signoff | `$env:APP_ENV='staging'; npm run gate:signoff -- --suite ACCESS-POLICY-STAGING-SMOKE-LOCAL --tenantId default --runUrl local://pim1/access-policy-staging-smoke-2026-04-26` | Passed | Local signoff artifact now exists for the real deployed staging smoke pass |
| Staging smoke regression harness | `node scripts/staging-postdeploy-check.test.cjs` | Passed | The checked-in post-deploy checker now covers the opt-in non-admin path |
| Live staging non-admin access-policy smoke | enhanced staging smoke with `STAGING_VALIDATE_NON_ADMIN=true` | Passed | Viewer/reviewer/editor denied audit logs; viewer denied admin workspace-users; stale viewer JWT rejected after later lock and deactivation |
| Non-admin staging smoke signoff | `$env:APP_ENV='staging'; npm run gate:signoff -- --suite ACCESS-POLICY-STAGING-NONADMIN-SMOKE-LOCAL --tenantId default --runUrl local://pim1/access-policy-staging-nonadmin-smoke-2026-04-26` | Passed | Local signoff artifact now exists for the enhanced deployed staging smoke pass |
| Live rollout snapshot | `$env:APP_ENV='staging'; $env:STAGING_RESOLVE_IP='151.101.2.15'; node -r ./scripts/staging-fetch-via-curl.cjs scripts/capture-controlled-rollout-snapshot.cjs --environment staging --tenantId default --apiBase https://api-staging-490e.up.railway.app/api/v1` | Passed | Deployed staging snapshot reports `health.ok=true`, `controlledPending=[]`, `broadPending=[]` |
| GitHub CI | [Run 24964166068](https://github.com/RDKSAHV7233/PIM1/actions/runs/24964166068) | Passed | Commit `6f4f7d4`; repo CI accepted the access-policy staging-smoke changes |
| GitHub Deploy Staging | [Run 24964166066](https://github.com/RDKSAHV7233/PIM1/actions/runs/24964166066) | Passed | Deploy-backed staging verification ran the enhanced post-deploy checks |
| Deploy-backed evidence validation | `node scripts/validate-live-staging-evidence.cjs --artifactDir ".tmp/staging-artifacts/24964166066" --environment staging --tenantId default` | Passed | Validated the GitHub artifact bundle, including deploy postcheck and clean rollout snapshot |

## PO Acceptance Update

Accepted in current product scope:

- `P0` hardening remains verified for session invalidation, workflow locking, sensitive audit-read protection, and denial auditing
- `P1` supported delegated-access scope enforcement remains verified for category, brand, channel, and connector account
- governance validation is stronger because these checks are no longer hidden behind ad hoc file execution

Specifically accepted from a PO governance perspective:

- [package.json](../../package.json) now exposes:
  - `test:integration:access-policy-remediation`
  - `test:integration:delegated-access-scopes`
- [run-product-suite.cjs](../../scripts/run-product-suite.cjs) now includes both suites in the `governance` run path
- [.github/workflows/ci.yml](../../.github/workflows/ci.yml) now runs:
  - `test:integration:workspace-user-crud`
  - `test:integration:product-workflow-transitions`
  - `test:integration:access-policy-remediation`
  - `test:integration:delegated-access-scopes`
- [run-increment-gates.cjs](../../scripts/run-increment-gates.cjs) now includes:
  - `test:integration:workspace-user-crud`
  - `test:integration:product-workflow-transitions`
  - `test:integration:access-policy-remediation`
  - `test:integration:delegated-access-scopes`
- [run-sprint-gates.cjs](../../scripts/run-sprint-gates.cjs) now includes the same authz checks and `gate:run:sprint` points to the correct sprint runner
- [.github/workflows/deploy-staging.yml](../../.github/workflows/deploy-staging.yml) now runs the post-deploy checker with `STAGING_VALIDATE_NON_ADMIN=true`
- [validate-deploy-staging-workflow.cjs](../../scripts/validate-deploy-staging-workflow.cjs) now protects that deploy workflow setting
- [staging-postdeploy-check.cjs](../../scripts/staging-postdeploy-check.cjs) now supports repeatable non-admin deployed smoke validation for:
  - viewer/reviewer/editor audit-log denials
  - viewer denial on admin workspace-users
  - stale viewer JWT rejection after later lock
  - stale viewer JWT rejection and login denial after later deactivation
- [staging-fetch-via-curl.cjs](../../scripts/staging-fetch-via-curl.cjs) now preserves multi-cookie Railway responses so web-session staging smoke checks remain valid through the DNS override path

This matters because product sign-off should depend on repeatable commands, not tribal knowledge.

The rollout evidence is now materially stronger for this slice:

- gate continuity is recognized
- the deployed staging snapshot reports healthy app status
- controlled rollout has no pending blockers
- broad rollout has no pending blockers in the current evidence window
- GitHub deploy-backed artifact validation now confirms this evidence with an external run URL

The latest deployed staging smoke evidence improves the PO position further:

- deployed staging health is confirmed
- legacy-header trust-boundary rejection is confirmed in the deployed app
- smoke-user login and logout revocation are confirmed in the deployed app
- admin governance rendering is confirmed in the deployed web app
- viewer, reviewer, and editor denial of audit-log access is confirmed in the deployed app
- viewer denial of the admin workspace-users route is confirmed in the deployed app
- stale viewer JWT rejection after later lock and deactivation is confirmed in the deployed app
- the same staging evidence path is confirmed by Deploy Staging run [24964166066](https://github.com/RDKSAHV7233/PIM1/actions/runs/24964166066)

## PO Release Position

Current PO position:

- acceptable for merge and controlled rollout as the current access-policy remediation milestone
- acceptable to describe as improved access governance for supported and verified scope dimensions
- not acceptable to market as full enterprise delegated-access completion
- not acceptable to market as full enterprise field-level/read-redaction completion

## What Is Still Not Accepted As Complete

The following are still outside the accepted product claim:

- unsupported scope dimensions such as catalog, vendor/owner, supplier, locale/market, team, and assignee
- universal read-time field redaction across all sensitive read surfaces
- a full deny-by-default replacement for broad authenticated `GET` behavior across the entire platform
- full role-model maturity such as `super_admin`, `system_admin`, `product_admin`, `category_manager`, and `vendor`

## PO Follow-Up Actions

Required next PO backlog actions remain:

- `ACCESS-SCOPE-001` through `ACCESS-SCOPE-008` from the delegated-access report
- explicit release-note guardrails that only supported scopes are claimed
- future epics for read-redaction completion and broader sensitive-GET hardening
- final role-maturity work only after scope, policy, and migration prerequisites are complete
- continued backlog execution for unsupported scopes, read-time redaction, and broader sensitive-GET hardening before any broader enterprise claim

## PO Verdict

Verdict: **Conditionally accepted and ready to continue under controlled execution.**

This checkpoint confirms the current branch is in a materially stronger place than a documentation-only remediation promise:

- the backend behavior is implemented
- the focused policy tests are passing
- the delegated-access scope tests are passing
- the tests are now reachable through standard repo scripts
- the deployed staging app validates the key admin smoke path, auth trust-boundary behavior, selected non-admin denial paths, and stale-token rejection after later lock/deactivate
- GitHub deploy-backed staging evidence validates the same bounded smoke and rollout proof

The product claim must still stay narrow:

> Vexa PIM now has verified access-policy hardening and supported delegated-access enforcement for selected scope dimensions, with deploy-backed staging validation for health, auth trust-boundary, revoked-token handling, admin governance rendering, selected non-admin denial paths, and stale-token rejection after later lock/deactivate, but it does not yet have a complete enterprise authorization model across all scope, field-redaction, and role-maturity requirements.

## 2026-04-27 PO Follow-Up

Decision: **Conditionally accepted for the bounded sensitive-read and shadow-mode foundation follow-up.**

Accepted in this follow-up:

- sensitive submission read metadata now requires explicit `admin` or `editor` access
- `AccessPolicyService.can(...)` now exists as a deterministic shadow-mode foundation with stable reason codes
- RBAC remains authoritative while shadow-mode mismatches are audited with sanitized metadata
- increment and sprint gates now run the access-policy remediation suite, delegated-access scope suite, and sensitive-GET guard
- local validation passed for API build, web build, focused access-policy suites, formal increment gate, formal sprint gate, staging workflow validation, and staging postdeploy harness validation

Still not accepted as complete:

- universal read-time redaction
- unsupported scope dimensions such as vendor/owner, supplier, locale/market, catalog, team, and assignee
- API-client principal separation and UI-login exclusion
- multi-role migration foundation
- product-admin/system-admin/super-admin boundary maturity
- any `category_manager` or `vendor` role introduction

Updated claim wording:

> Vexa PIM now has verified access-policy hardening, selected sensitive-read protection, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

## 2026-04-27 PO Follow-Up: Catalog Read Redaction

Decision: **Conditionally accepted for the bounded catalog read-redaction follow-up.**

Accepted in this follow-up:

- viewer and reviewer catalog product reads now redact sensitive pricing and inventory fields on the covered product and variant paths
- admin and editor catalog behavior remains intact on the covered paths
- the legacy `/products/:id` API alias now uses authenticated actor context, so delegated scope intersection and redaction rules apply there too
- focused remediation tests and the increment gate both passed after this change

Still not accepted as complete:

- universal read-time redaction outside the covered catalog product and variant paths
- unsupported scope dimensions such as vendor/owner, supplier, locale/market, catalog, team, and assignee
- API-client principal separation and UI-login exclusion
- multi-role migration foundation
- product-admin/system-admin/super-admin boundary maturity
- any `category_manager` or `vendor` role introduction

Updated claim wording:

> Vexa PIM now has verified access-policy hardening, selected sensitive-read protection including covered catalog read redaction, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

## 2026-04-27 PO Follow-Up: AI Helper Sensitive Read Hardening

Decision: **Conditionally accepted for the bounded AI helper hardening follow-up.**

Accepted in this follow-up:

- `auto-suggestions` sensitive GET routes now require explicit `admin` or `editor` access
- `rejection-intelligence` score reads now require explicit `admin`, `editor`, or `reviewer` access
- direct object-ID scope enforcement now extends to AI helper read and repair routes for supported category and brand intersections
- the sensitive-GET guard, focused remediation suite, delegated-access scope suite, increment gate, sprint gate, staging workflow validator, and checked-in staging postdeploy harness all passed after the change
- a checked-in PO execution prompt now documents the remaining backlog order and the hard product rules for future continuous execution

Still not accepted as complete:

- broader sensitive `GET` hardening for remaining authenticated read surfaces such as dashboard, metrics, billing, and other low-annotation routes
- universal read-time redaction outside the covered catalog product and variant paths
- unsupported scope dimensions such as vendor/owner, supplier, locale/market, catalog, team, and assignee
- API-client principal separation and UI-login exclusion
- multi-role migration foundation
- product-admin/system-admin/super-admin boundary maturity
- any `category_manager` or `vendor` role introduction

Updated claim wording:

> Vexa PIM now has verified access-policy hardening, selected sensitive-read protection including covered catalog and AI helper routes, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

## 2026-04-27 PO Follow-Up: Billing Usage Sensitive Read Hardening

Decision: **Conditionally accepted for the bounded billing usage hardening follow-up.**

Accepted in this follow-up:

- `GET /billing/usage` now requires explicit `admin` or `editor` access instead of broad authenticated access
- viewer and reviewer denial is proven in the focused remediation suite
- editor and admin billing usage behavior remains intact
- reviewer and viewer dashboards no longer depend on billing usage and now show a role-aware fallback instead of breaking on a protected commercial read
- the sensitive-GET guard, billing cache integration coverage, web dashboard route contract, increment gate, sprint gate, staging workflow validator, and checked-in staging postdeploy harness all passed after the change

Still not accepted as complete:

- broader sensitive `GET` hardening for remaining authenticated read surfaces such as dashboard health, dashboard operations, metrics trends, and other still-broad reads
- universal read-time redaction outside the covered catalog product and variant paths
- unsupported scope dimensions such as vendor/owner, supplier, locale/market, catalog, team, and assignee
- API-client principal separation and UI-login exclusion
- multi-role migration foundation
- product-admin/system-admin/super-admin boundary maturity
- any `category_manager` or `vendor` role introduction

Updated claim wording:

> Vexa PIM now has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, and billing usage routes, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

## 2026-04-27 PO Follow-Up: Dashboard Operations And Metrics Sensitive Read Hardening

Decision: **Conditionally accepted for the bounded dashboard operations and metrics hardening follow-up.**

Accepted in this follow-up:

- `GET /dashboard/operations-summary` now requires explicit `admin` or `editor` access instead of broad authenticated access
- `GET /metrics/kpi-trends` now requires explicit `admin` access instead of broad authenticated access
- viewer and reviewer denial for dashboard operations summary is proven in the focused remediation suite
- viewer, reviewer, and editor denial for metrics KPI trends is proven in the focused remediation suite
- editor and admin operational summary behavior remains intact, and admin KPI trends behavior remains intact
- reviewer and viewer dashboard and navigation-summary callers now degrade gracefully with role-aware fallbacks instead of breaking on newly protected operational reads
- the sensitive-GET guard, focused dashboard proofs, delegated-access scope suite, increment gate, sprint gate, staging workflow validator, and checked-in staging postdeploy harness all passed after the change

Still not accepted as complete:

- broader sensitive `GET` hardening for remaining authenticated read surfaces such as `dashboard/readiness`, `dashboard/catalog-health`, `dashboard/health`, and other still-broad reads
- universal read-time redaction outside the covered catalog product and variant paths
- unsupported scope dimensions such as vendor/owner, supplier, locale/market, catalog, team, and assignee
- API-client principal separation and UI-login exclusion
- multi-role migration foundation
- product-admin/system-admin/super-admin boundary maturity
- any `category_manager` or `vendor` role introduction

Updated claim wording:

> Vexa PIM now has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, dashboard operations summary, and metrics KPI trend routes, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

## 2026-04-27 PO Follow-Up: Dashboard Readiness And Catalog-Health Sensitive Read Hardening

Decision: **Conditionally accepted for the bounded dashboard readiness and catalog-health hardening follow-up.**

Accepted in this follow-up:

- `GET /dashboard/readiness` now requires explicit `admin` or `editor` access instead of broad authenticated access
- `GET /dashboard/catalog-health` now requires explicit `admin` or `editor` access instead of broad authenticated access
- viewer and reviewer denial for both routes is proven in the focused remediation suite
- editor and admin behavior remains intact for both routes
- the sensitive-GET guard, focused remediation suite, delegated-access scope suite, increment gate, sprint gate, staging workflow validator, and checked-in staging postdeploy harness all passed after the change

Still not accepted as complete:

- broader sensitive `GET` hardening still remains for `dashboard/health` and any other broad authenticated aggregate reads
- universal read-time redaction outside the covered catalog product and variant paths
- unsupported scope dimensions such as vendor/owner, supplier, locale/market, catalog, team, and assignee
- API-client principal separation and UI-login exclusion
- multi-role migration foundation
- product-admin/system-admin/super-admin boundary maturity
- any `category_manager` or `vendor` role introduction

Updated claim wording:

> Vexa PIM now has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, dashboard readiness, dashboard catalog-health, dashboard operations summary, and metrics KPI trend routes, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

## 2026-04-27 PO Follow-Up: Dashboard Health Redaction And API-Client Human-Route Boundaries

Decision: **Conditionally accepted for the bounded dashboard-health and covered API-client-boundary follow-up.**

Accepted in this follow-up:

- `GET /dashboard/health` is no longer treated as a broad, unshaped authenticated read
- viewer and reviewer dashboard-health responses now use centralized redaction instead of inheriting the full connector-account breakdown
- viewer approval-queue visibility is removed from `dashboard/health`, while reviewer visibility remains intact for the covered route
- dashboard and channel web pages now use aggregate totals and explicit restricted copy instead of pretending redacted connector data is zero
- covered API-client principals are now denied human-only route families on `dashboard`, `billing`, `metrics`, and authenticated `auth` account endpoints, while explicit catalog API reads still remain available to the machine principal model already supported today
- the focused remediation suite, delegated-access scope suite, sensitive-GET guard, increment gate, sprint gate, workflow validator, and checked-in staging postdeploy harness all passed after the follow-up

Still not accepted as complete:

- broader authenticated read inventory still needs final PO classification outside the already-covered surfaces
- universal read-time redaction remains incomplete outside covered catalog and `dashboard/health` responses
- unsupported scope dimensions such as vendor/owner, supplier, locale/market, catalog, team, and assignee
- full API-client permission and scope modeling beyond the newly covered human-route boundary
- multi-role migration foundation
- product-admin/system-admin/super-admin boundary maturity
- any `category_manager` or `vendor` role introduction

Updated claim wording:

> Vexa PIM now has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, dashboard readiness, dashboard catalog-health, dashboard health with role-aware redaction, dashboard operations summary, and metrics KPI trend routes, partial API-client versus human route separation on covered surfaces, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

## 2026-04-27 PO Follow-Up: Compliance Workflow Scope Hardening And Human-Only Notification Boundaries

Decision: **Conditionally accepted for the bounded compliance workflow and notification boundary follow-up.**

Accepted in this follow-up:

- `GET /compliance/rules` now requires explicit `admin` access instead of inheriting broad authenticated read behavior
- covered API-key principals are now denied the human notification center and human compliance workflow route families
- supported delegated-scope enforcement now applies to compliance product issue reads, compliance validate requests, issue-inbox list results, and issue-inbox warning resolution
- human notification-center and issue-inbox behavior remained intact under focused integration proof after the change
- the sensitive-GET guard, focused remediation suite, delegated-access scope suite, issue-inbox integrations, notifications integrations, increment gate, sprint gate, staging workflow validator, and checked-in staging postdeploy harness all passed after the follow-up

Still not accepted as complete:

- broader authenticated read inventory still needs final PO classification outside the already-covered surfaces
- universal read-time redaction remains incomplete outside covered catalog and `dashboard/health` responses
- unsupported scope dimensions such as `vendor/owner`, `supplier`, `locale/market`, `catalog`, `team`, and `assignee`
- full API-client permission and scope modeling beyond the covered human-route boundaries
- multi-role migration foundation
- product-admin/system-admin/super-admin boundary maturity
- any `category_manager` or `vendor` role introduction

Updated claim wording:

> Vexa PIM now has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, dashboard readiness, dashboard catalog-health, dashboard health with role-aware redaction, dashboard operations summary, metrics KPI trend routes, compliance rule reads, human-only notifications and compliance workflow boundaries, partial API-client versus human route separation on covered surfaces, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

## 2026-04-27 PO Follow-Up: Broad Read Classification And Connector Management Write Hardening

Decision: **Conditionally accepted for the bounded shared read-policy and connector-management hardening follow-up.**

Accepted in this follow-up:

- the currently covered broad authenticated read surfaces now carry explicit checked-in `@ReadAccessPolicy(...)` classification instead of relying on unnamed broad access
- central response-policy handling now covers the approved catalog list, detail, search, variant, and stats reads plus the covered `dashboard/health` aggregate response
- viewer catalog search no longer leaks `matchedSku`
- viewer catalog stats no longer expose approval-queue counts, while reviewer and admin visibility remains intact
- viewer and reviewer can no longer mutate connector installations or publication-target state through the covered connector-management write routes
- editor reconnect still works after explicit connector permission grant, and admin publication-target management and connector access-entitlement flows remained intact under focused proof
- the focused remediation suite, connector access-entitlements integration, Shopify publication-target integration, delegated-access scope suite, increment gate, sprint gate, staging workflow validator, and checked-in staging postdeploy harness all passed after the follow-up

Still not accepted as complete:

- broader authenticated read inventory still needs final PO classification outside the already-covered surfaces
- universal read-time redaction remains incomplete outside covered catalog and `dashboard/health` responses
- unsupported scope dimensions such as `vendor/owner`, `supplier`, `locale/market`, `catalog`, `team`, and `assignee`
- full API-client permission and scope modeling beyond the covered human-route boundaries
- multi-role migration foundation
- product-admin/system-admin/super-admin boundary maturity
- any `category_manager` or `vendor` role introduction

Updated claim wording:

> Vexa PIM now has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, dashboard readiness, dashboard catalog-health, dashboard health with role-aware redaction, dashboard operations summary, metrics KPI trend routes, compliance rule reads, human-only notifications and compliance workflow boundaries, explicit broad-read classification for the covered authenticated read surfaces, restricted connector-management writes for viewer and reviewer, partial API-client versus human route separation on covered surfaces, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

## 2026-04-27 PO Follow-Up: Self-Service Auth Read Classification

Decision: **Conditionally accepted for the bounded self-service auth read classification follow-up.**

Accepted in this follow-up:

- `GET /auth/account/privacy-status` now carries explicit checked-in self-service read classification
- `GET /auth/account/export/:jobId/download` now carries explicit checked-in self-service download classification
- the sensitive-GET guard now requires those auth reads to stay explicitly classified
- a human viewer still gets their own privacy status and can queue then poll their own account export without role regression
- API-key principals remain blocked from the sensitive account export download route
- the focused remediation suite, delegated-access scope suite, API build, web build, increment gate, sprint gate, staging workflow validator, and checked-in staging postdeploy harness all passed after the follow-up

Still not accepted as complete:

- broader authenticated read inventory still needs final PO classification outside the already-covered surfaces
- universal read-time redaction remains incomplete outside covered catalog and `dashboard/health` responses
- unsupported scope dimensions such as `vendor/owner`, `supplier`, `locale/market`, `catalog`, `team`, and `assignee`
- full API-client permission and scope modeling beyond the covered human-route boundaries
- multi-role migration foundation
- product-admin/system-admin/super-admin boundary maturity
- any `category_manager` or `vendor` role introduction

Updated claim wording:

> Vexa PIM now has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, covered self-service auth reads, dashboard readiness, dashboard catalog-health, dashboard health with role-aware redaction, dashboard operations summary, metrics KPI trend routes, compliance rule reads, human-only notifications and compliance workflow boundaries, explicit broad-read classification for the covered authenticated read surfaces, restricted connector-management writes for viewer and reviewer, partial API-client versus human route separation on covered surfaces, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

## 2026-04-27 PO Follow-Up: Connector Workspace API-Client Boundary

Decision: **Conditionally accepted for the bounded connector workspace API-client boundary follow-up.**

Accepted in this follow-up:

- the covered connector workspace route family is now human-only
- API-key principals can no longer inherit human connector workspace access to definitions, installed accounts, schema reads, publication-target reads, reconnect flows, payload preview, install, or publication-target mutation routes
- focused remediation proof now includes explicit API-key denial for covered connector workspace reads
- human connector install, reconnect, delete, and action-matrix flows remained intact under focused regression proof
- the focused remediation suite, connector access-entitlements integration, delegated-access scope suite, API build, web build, increment gate, sprint gate, staging workflow validator, and checked-in staging postdeploy harness all passed after the follow-up

Still not accepted as complete:

- broader authenticated read inventory still needs final PO classification outside the already-covered surfaces
- universal read-time redaction remains incomplete outside covered catalog and `dashboard/health` responses
- unsupported scope dimensions such as `vendor/owner`, `supplier`, `locale/market`, `catalog`, `team`, and `assignee`
- full API-client permission and scope modeling beyond the covered human-route boundaries
- multi-role migration foundation
- product-admin/system-admin/super-admin boundary maturity
- any `category_manager` or `vendor` role introduction

Updated claim wording:

> Vexa PIM now has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, covered self-service auth reads, dashboard readiness, dashboard catalog-health, dashboard health with role-aware redaction, dashboard operations summary, metrics KPI trend routes, compliance rule reads, human-only notifications and compliance workflow boundaries, human-only connector workspace boundaries, explicit broad-read classification for the covered authenticated read surfaces, restricted connector-management writes for viewer and reviewer, partial API-client versus human route separation on covered surfaces, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

## 2026-04-27 PO Follow-Up: Marketplace Workspace API-Client Boundary

Decision: **Conditionally accepted for the bounded marketplace workspace API-client boundary follow-up.**

Accepted in this follow-up:

- the covered marketplace workspace route family is now human-only
- API-key principals can no longer inherit covered human marketplace workspace reads
- the ONDC controller now carries the same API-client boundary annotation for feature-enabled environments
- the focused remediation suite, delegated-access scope suite, API build, web build, increment gate, sprint gate, staging workflow validator, and checked-in staging postdeploy harness all passed after the follow-up

Still not accepted as complete:

- ONDC runtime denial is not yet claimed as universally validated because the module is feature-flagged off in the default environment
- broader authenticated read inventory still needs final PO classification outside the already-covered surfaces
- universal read-time redaction remains incomplete outside covered catalog and `dashboard/health` responses
- unsupported scope dimensions such as `vendor/owner`, `supplier`, `locale/market`, `catalog`, `team`, and `assignee`
- full API-client permission and scope modeling beyond the covered human-route boundaries
- multi-role migration foundation
- product-admin/system-admin/super-admin boundary maturity
- any `category_manager` or `vendor` role introduction

Updated claim wording:

> Vexa PIM now has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, covered self-service auth reads, dashboard readiness, dashboard catalog-health, dashboard health with role-aware redaction, dashboard operations summary, metrics KPI trend routes, compliance rule reads, human-only notifications and compliance workflow boundaries, human-only connector and marketplace workspace boundaries, explicit broad-read classification for the covered authenticated read surfaces, restricted connector-management writes for viewer and reviewer, partial API-client versus human route separation on covered surfaces, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

## 2026-04-27 PO Follow-Up: Bulk Operation Read Hardening And API-Client Boundary

Decision: **Conditionally accepted for the bounded bulk-operation read hardening follow-up.**

Accepted in this follow-up:

- covered `bulk-import` and `bulk-edit` reads now have explicit checked-in protected-read inventory coverage
- covered bulk operation route families are now human-only
- viewer and reviewer are denied covered bulk reads while editor access remains intact
- API-key principals can no longer inherit covered human bulk-operation route access
- the focused remediation suite, delegated-access scope suite, API build, web build, increment gate, sprint gate, staging workflow validator, and checked-in staging postdeploy harness all passed after the follow-up

Still not accepted as complete:

- this does not complete full import, export, or bulk policy maturity
- broader authenticated read inventory still needs final PO classification outside the already-covered surfaces
- universal read-time redaction remains incomplete outside covered catalog and `dashboard/health` responses
- unsupported scope dimensions such as `vendor/owner`, `supplier`, `locale/market`, `catalog`, `team`, and `assignee`
- full API-client permission and scope modeling beyond the covered human-route boundaries
- multi-role migration foundation
- product-admin/system-admin/super-admin boundary maturity
- any `category_manager` or `vendor` role introduction

Updated claim wording:

> Vexa PIM now has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, covered self-service auth reads, dashboard readiness, dashboard catalog-health, dashboard health with role-aware redaction, dashboard operations summary, metrics KPI trend routes, compliance rule reads, human-only notifications and compliance workflow boundaries, human-only connector, marketplace, and covered bulk-operation workspace boundaries, explicit broad-read classification for the covered authenticated read surfaces, restricted connector-management writes for viewer and reviewer, partial API-client versus human route separation on covered surfaces, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

## 2026-04-27 PO Follow-Up: Audit Read Human-Only Boundary

Decision: **Conditionally accepted for the bounded audit read boundary follow-up.**

Accepted in this follow-up:

- the audit read family is now human-only
- viewer, reviewer, and editor are denied audit-log reads while admin access remains intact
- API-key principals can no longer inherit covered audit-route access
- the focused remediation suite, delegated-access scope suite, API build, web build, increment gate, sprint gate, staging workflow validator, and checked-in staging postdeploy harness all passed after the follow-up

Still not accepted as complete:

- broader authenticated read inventory still needs final PO classification outside the already-covered surfaces
- universal read-time redaction remains incomplete outside covered catalog and `dashboard/health` responses
- unsupported scope dimensions such as `vendor/owner`, `supplier`, `locale/market`, `catalog`, `team`, and `assignee`
- full API-client permission and scope modeling beyond the covered human-route boundaries
- multi-role migration foundation
- product-admin/system-admin/super-admin boundary maturity
- any `category_manager` or `vendor` role introduction

Updated claim wording:

> Vexa PIM now has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, covered self-service auth reads, dashboard readiness, dashboard catalog-health, dashboard health with role-aware redaction, dashboard operations summary, metrics KPI trend routes, compliance rule reads, human-only audit, notifications, and compliance workflow boundaries, human-only connector, marketplace, and covered bulk-operation workspace boundaries, explicit broad-read classification for the covered authenticated read surfaces, restricted connector-management writes for viewer and reviewer, partial API-client versus human route separation on covered surfaces, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

## 2026-04-27 PO Follow-Up: Submission Read Human-Only Boundary

Decision: **Conditionally accepted for the bounded submission read boundary follow-up.**

Accepted in this follow-up:

- the submission read family is now human-only
- API-key principals can no longer inherit covered submission-route access
- the focused remediation suite, delegated-access scope suite, API build, web build, increment gate, sprint gate, staging workflow validator, and checked-in staging postdeploy harness all passed after the follow-up

Still not accepted as complete:

- broader authenticated read inventory still needs final PO classification outside the already-covered surfaces
- universal read-time redaction remains incomplete outside covered catalog and `dashboard/health` responses
- unsupported scope dimensions such as `vendor/owner`, `supplier`, `locale/market`, `catalog`, `team`, and `assignee`
- full API-client permission and scope modeling beyond the covered human-route boundaries
- multi-role migration foundation
- product-admin/system-admin/super-admin boundary maturity
- any `category_manager` or `vendor` role introduction

Updated claim wording:

> Vexa PIM now has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, covered self-service auth reads, dashboard readiness, dashboard catalog-health, dashboard health with role-aware redaction, dashboard operations summary, metrics KPI trend routes, compliance rule reads, human-only audit, notifications, compliance workflow, and submission boundaries, human-only connector, marketplace, and covered bulk-operation workspace boundaries, explicit broad-read classification for the covered authenticated read surfaces, restricted connector-management writes for viewer and reviewer, partial API-client versus human route separation on covered surfaces, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

## 2026-04-27 PO Follow-Up: AI Helper Human-Only Boundary

Decision: **Conditionally accepted for the bounded AI-helper boundary follow-up.**

Accepted in this follow-up:

- the covered AI-helper read family is now human-only
- API-key principals can no longer inherit covered AI-helper route access
- the focused remediation suite, delegated-access scope suite, API build, web build, increment gate, sprint gate, staging workflow validator, and checked-in staging postdeploy harness all passed after the follow-up

Still not accepted as complete:

- broader authenticated read inventory still needs final PO classification outside the already-covered surfaces
- universal read-time redaction remains incomplete outside covered catalog and `dashboard/health` responses
- unsupported scope dimensions such as `vendor/owner`, `supplier`, `locale/market`, `catalog`, `team`, and `assignee`
- full API-client permission and scope modeling beyond the covered human-route boundaries
- multi-role migration foundation
- product-admin/system-admin/super-admin boundary maturity
- any `category_manager` or `vendor` role introduction

Updated claim wording:

> Vexa PIM now has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, covered self-service auth reads, dashboard readiness, dashboard catalog-health, dashboard health with role-aware redaction, dashboard operations summary, metrics KPI trend routes, compliance rule reads, human-only audit, notifications, compliance workflow, submission, and AI-helper boundaries, human-only connector, marketplace, and covered bulk-operation workspace boundaries, explicit broad-read classification for the covered authenticated read surfaces, restricted connector-management writes for viewer and reviewer, partial API-client versus human route separation on covered surfaces, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

## 2026-04-27 PO Follow-Up: Billing Detail Read Inventory Closure

Decision: **Conditionally accepted for the bounded billing detail read inventory follow-up.**

Accepted in this follow-up:

- `GET /billing/plan-profile` and `GET /billing/upgrade-request` are now explicitly represented in the sensitive-read guard inventory
- viewer, reviewer, and editor denial is proven on the covered admin-only billing detail reads
- admin allow is proven on the covered admin-only billing detail reads
- API-key principals are proven denied on the covered billing detail read routes
- the focused remediation suite, delegated-access scope suite, API build, web build, increment gate, sprint gate, staging workflow validator, and checked-in staging postdeploy harness all passed after the follow-up

Still not accepted as complete:

- broader authenticated read inventory still needs final PO classification outside the already-covered surfaces
- universal read-time redaction remains incomplete outside covered catalog and `dashboard/health` responses
- unsupported scope dimensions such as `vendor/owner`, `supplier`, `locale/market`, `catalog`, `team`, and `assignee`
- full API-client permission and scope modeling beyond the covered human-route boundaries
- multi-role migration foundation
- product-admin/system-admin/super-admin boundary maturity
- any `category_manager` or `vendor` role introduction

Updated claim wording:

> Vexa PIM now has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, admin-only billing detail reads, covered self-service auth reads, dashboard readiness, dashboard catalog-health, dashboard health with role-aware redaction, dashboard operations summary, metrics KPI trend routes, compliance rule reads, human-only audit, notifications, compliance workflow, submission, and AI-helper boundaries, human-only connector, marketplace, and covered bulk-operation workspace boundaries, explicit broad-read classification for the covered authenticated read surfaces, restricted connector-management writes for viewer and reviewer, partial API-client versus human route separation on covered surfaces, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

## 2026-04-27 PO Checkpoint: Foundation Pass To Stop the Blocker Loop

Decision: **Conditionally accepted for the policy-foundation baseline pass.**

Accepted in this follow-up:

- authenticated read coverage is no longer tracked only by a curated route list; the guardrail now auto-discovers authenticated routes and fails when authenticated `GET` or `HEAD` handlers lack explicit classification metadata
- API-client policy is no longer only a deny-annotation pattern; covered authenticated routes now declare an API-client route policy and API keys are denied by default unless a route explicitly allows API-client access
- future delegated scope dimensions `vendor`, `owner`, `supplier`, `locale`, `market`, `catalog`, `team`, and `assignee` are now representable in the schema and DTO contract and safely rejected until enforcement exists
- multi-role migration has a real code-level foundation through deterministic role-resolution helpers that preserve single-role behavior, define explicit precedence, and keep API keys from inheriting human admin-boundary privileges
- Product Admin, System Admin, and Super Admin boundaries now exist as tested capability helpers even though live route enforcement is still rollout-pending
- central read-redaction infrastructure is more reusable because route-level read policies now flow through a global interceptor and notifications metadata now uses the shared redaction path

Still not accepted as complete:

- runtime deny of unclassified authenticated reads is not globally enabled yet; this pass enforces classification in guardrails and gates, not universal runtime lockout
- full API-client permission and scope modeling remains incomplete beyond the new default-deny route policy baseline
- future scope dimensions are representable and safely rejected, but not yet enforced for real delegated-access use cases
- multi-role storage rollout is still pending; the first attempt to add persistent role arrays was intentionally backed out after integration proof showed it was unsafe without database rollout sequencing
- Product Admin, System Admin, and Super Admin route mapping and full boundary maturity remain incomplete
- universal read-time redaction is still partial beyond the covered catalog, dashboard-health, and notifications families
- `category_manager` and `vendor` remain blocked because object ownership and scope enforcement are still not proven

Updated claim wording:

> Vexa PIM now has policy-foundation enforcement for authenticated-read classification and API-client route policy coverage in CI and gate validation, explicit default-deny API-key behavior on unclassified human routes, representable-but-safely-rejected future scope dimensions, deterministic multi-role and admin-boundary helper foundations, shadow-mode policy evaluation under legacy RBAC authority, and reusable central read-redaction infrastructure extended beyond catalog and dashboard into notifications. It still does not have full enterprise authorization maturity across runtime classification enforcement, all scope dimensions, API-client permission modeling, multi-role storage rollout, admin-boundary route mapping, or universal payload redaction.

## 2026-04-27 PO Checkpoint: Runtime Classification Enforcement

Decision: **Conditionally accepted for the bounded runtime-enforcement follow-up.**

Accepted in this follow-up:

- authenticated-read classification is now enforced at runtime by default, not only by CI and gate validation
- unclassified authenticated reads now fail closed
- classified authenticated reads remain allowed
- public routes remain unaffected
- API-client default deny remained intact under the stronger runtime rule
- the reusable PO backlog prompt now points future work toward the remaining foundation-level blockers instead of another controller-by-controller loop

Still not accepted as complete:

- full API-client permission and scope modeling remains incomplete
- future scope dimensions are still representable plus safely rejected, not yet fully enforced
- multi-role storage rollout remains incomplete
- Product Admin, System Admin, and Super Admin route enforcement maturity remains incomplete
- broader reusable payload redaction remains incomplete
- `category_manager` and `vendor` remain blocked because ownership and object-scope enforcement are still not proven

Updated claim wording:

> Vexa PIM now enforces authenticated-read classification both in CI/gates and at runtime, keeps API keys default-denied unless a route explicitly opts into API-client access, and preserves the previously validated policy-foundation behavior for scope handling, role helpers, and central redaction. It still does not have full enterprise authorization maturity across machine-principal permission modeling, full scope-dimension enforcement, multi-role storage rollout, admin-boundary route mapping, or universal payload redaction.

## 2026-04-27 PO Checkpoint: Explicit API-Client Scope Model

Decision: **Conditionally accepted for the bounded machine-principal scope follow-up.**

Accepted in this follow-up:

- API-client authorization moved beyond route-level default deny for the catalog API family
- machine principals now require explicit matching scopes such as `catalog.read` or `catalog.write`
- missing scopes, unrelated scopes, and unsupported future scopes now deny safely
- API keys cannot rely on human role fallback to reach scope-gated catalog routes
- the scope rollout is additive and migration-backed through `ApiAccessKey.scopes`

Still not accepted as complete:

- the explicit machine-principal scope model is not yet mapped across every future API-client-capable resource family
- future delegated scope dimensions are still representable plus safely rejected, not yet fully enforced
- multi-role persistence rollout remains incomplete
- Product Admin, System Admin, and Super Admin route enforcement maturity remains incomplete
- broader reusable payload redaction remains incomplete
- `category_manager` and `vendor` remain blocked because ownership and object-scope enforcement are still not proven

Updated claim wording:

> Vexa PIM now enforces explicit machine-principal scopes for the catalog API family, persists API-key scopes through a migration-backed additive rollout, denies missing or unrelated API-client scopes safely, and preserves default-deny behavior for human-only routes. It still does not have full enterprise authorization maturity across all machine-principal resources, future scope-dimension enforcement, multi-role persistence, admin-boundary route mapping, or universal payload redaction.

## 2026-04-27 PO Checkpoint: Fail-Closed Unsupported Scope Dimensions On Product Resources

Decision: **Conditionally accepted for the bounded scope-enforcement safety follow-up.**

Accepted in this follow-up:

- product-backed resources no longer silently proceed when a user carries unsupported future scope dimensions such as `vendor`
- unsupported-only and mixed-scope combinations now fail closed on covered catalog and media flows until the resource can actually prove those dimensions
- the expanded `AccessScopeType` values are now backed by an additive Postgres enum migration, not just Prisma schema and TypeScript definitions
- delegated-access integration coverage now proves three real cases on covered product resources:
  - unsupported-only dimension denial
  - mixed supported-plus-unsupported dimension denial
  - request-time denial when the route cannot prove the unsupported dimension

Still not accepted as complete:

- this is not full enforcement for `vendor`, `owner`, `supplier`, `locale`, `market`, `catalog`, `team`, or `assignee`
- only fail-closed behavior is proven on covered product-backed resources today
- resource models still lack the ownership or object fields needed to safely allow these dimensions in general
- `category_manager` and `vendor` remain blocked because the repo still does not prove their allowed-resource boundaries end to end
- multi-role persistence rollout, admin-boundary route enforcement, and broader shared redaction remain pending

Updated claim wording:

> Vexa PIM now enforces authenticated-read classification at runtime, requires explicit API-client scopes on the catalog API family, and fail-closes product-backed resource access when unsupported or mixed foundation scope dimensions are present without provable enforcement context. It still does not have full enterprise authorization maturity across real enforcement for future scope dimensions, multi-role persistence rollout, admin-boundary route mapping, or universal payload redaction.

## 2026-04-27 PO Checkpoint: Catalog Scope Enforcement On Connector Publication Targets

Decision: **Conditionally accepted for the bounded real-enforcement scope follow-up.**

Accepted in this follow-up:

- `catalog` is no longer only representable or denied everywhere; it is now genuinely enforced on Shopify connector publication-target reads and writes
- admins can store `catalog` scope assignments through the existing access-scope admin API
- a catalog-scoped connector user only sees publication targets whose `catalogId` matches an assigned catalog scope
- publication-target updates deny safely when the selected target is out of scope or has no provable `catalogId`
- other future dimensions remain fail-closed and are not overclaimed as supported

Still not accepted as complete:

- `catalog` is not yet a generally enforced scope dimension across every route family; it is proven only on the connector publication-target surface
- `vendor`, `owner`, `supplier`, `locale`, `market`, `team`, and `assignee` still remain representable but not broadly enforced
- `category_manager` remains blocked because category-scoped role boundaries are not yet proven end to end
- `vendor` remains blocked because vendor/object ownership enforcement is still not proven
- multi-role persistence rollout, admin-boundary route enforcement, and broader shared redaction remain pending

Updated claim wording:

> Vexa PIM now enforces authenticated-read classification at runtime, explicit API-client scopes on the catalog API family, fail-closed denial for unsupported or mixed future scope dimensions on product-backed resources, and real `catalog` scope enforcement on Shopify connector publication-target reads and writes. It still does not have full enterprise authorization maturity across broad enforcement of future scope dimensions, multi-role persistence rollout, admin-boundary route mapping, or universal payload redaction.

## 2026-04-27 PO Checkpoint: Representative Admin-Boundary Route Enforcement

Decision: **Conditionally accepted for the bounded admin-boundary follow-up.**

Accepted in this follow-up:

- representative governance routes no longer rely only on plain `@Roles("admin")`
- explicit `product_admin`, `system_admin`, and `super_admin` identities can now be exercised end to end through local auth and JWT claims
- `product_admin` is denied on system-governance user and security routes
- `system_admin` is allowed on representative user and security reads
- `system_admin` is denied on the representative `super_admin`-only access-scope mutation path
- `super_admin` is allowed on the representative `super_admin`-only access-scope mutation path
- legacy `admin` compatibility was preserved for the existing delegated-scope mutation path so the current rollout does not regress while boundary work is still partial

Still not accepted as complete:

- this is not yet a full route-by-route mapping of Product Admin, System Admin, and Super Admin across every sensitive admin or operational route
- the live rollout still depends on a local-auth/JWT bridge for explicit boundary roles rather than full persistent multi-role storage
- broader machine-principal scope modeling, future scope-dimension enforcement, and shared payload redaction are still incomplete
- `category_manager` remains blocked because category/object ownership boundaries are still not proven end to end
- `vendor` remains blocked because vendor/object-scope enforcement is still not proven

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, explicit API-client scope enforcement on the covered catalog API family, fail-closed protection for unsupported future scope dimensions on covered product-backed resources, real `catalog` scope enforcement on Shopify connector publication targets, and bounded live admin-boundary enforcement on representative governance routes for workspace users, workspace access scopes, and API-key management. It still does not have full enterprise authorization maturity across broad admin-boundary route mapping, machine-principal resources, persistent multi-role rollout, ownership-scope enforcement for blocked roles, or universal payload redaction.

## 2026-04-27 PO Checkpoint: Broader Admin-Boundary Route Mapping

Decision: **Conditionally accepted for the bounded broader governance follow-up.**

Accepted in this follow-up:

- explicit admin-boundary enforcement now extends beyond the earlier representative governance routes into:
  - billing governance (`plan-profile`, `billing-contact`, `upgrade-request`)
  - dashboard governance (`readiness`, `catalog-health`, `operations-summary`)
  - metrics governance (`kpi-trends`)
  - audit governance
  - outbound-webhook governance
  - connector-permission governance
- `product_admin` is now proven allowed on product-data governance reads while still denied on security and billing governance surfaces
- `system_admin` is now proven denied on product-data governance reads while allowed on billing, audit, webhook, connector-permission, workspace-user, and API-key governance reads
- `category_manager` and `vendor` are now explicitly denied with `FOUNDATION_ROLE_BLOCKED` on boundary-decorated governance routes instead of being able to drift through legacy admin fallback
- guardrail coverage now checks 28 admin-boundary routes and no longer misses coverage when a controller method uses multi-line decorators

Still not accepted as complete:

- this is still not full admin-boundary mapping across every remaining settings, billing, connector, dashboard, and operational governance route
- the rollout still uses the current local-auth and JWT bridge rather than persistent multi-role storage
- broader machine-principal resource coverage, ownership-scope enforcement, and universal shared redaction remain incomplete
- `category_manager` remains blocked because category/object ownership enforcement is still not proven end to end
- `vendor` remains blocked because vendor/object-scope enforcement is still not proven end to end

Updated claim wording:

> Vexa PIM now has bounded live admin-boundary enforcement on representative governance routes plus broader billing, dashboard, metrics, audit, outbound-webhook, and connector-permission governance routes, authenticated-read classification, covered catalog API-client scope enforcement, fail-closed handling for unsupported future scope dimensions on covered product-backed paths, and Shopify publication-target catalog scope enforcement. It is not yet enterprise-complete across full admin-boundary mapping, persistent multi-role authorization, ownership-scoped roles, full API-client resources, or universal response redaction.

## 2026-04-28 PO Checkpoint: Product-Governance Admin-Boundary Mapping

Decision: **Conditionally accepted for the bounded product-governance follow-up.**

Accepted in this follow-up:

- the checked-in pending-blocker PO policy now explicitly treats still-unmapped admin-only product-governance routes as the next default admin-boundary target
- compliance-rule governance now enforces `manage_product_data` instead of relying only on plain legacy admin
- marketplace export-job governance and marketplace simulation governance now enforce `manage_product_data`
- `product_admin` is now proven allowed on:
  - compliance-rule creation and reads
  - marketplace export-job reads
  - marketplace simulation reads
- `system_admin` is now proven denied on those product-governance routes
- low-privilege and blocked-foundation-role denial behavior remains intact

Still not accepted as complete:

- this is still not the full admin-boundary mapping across every remaining settings, billing, connector, dashboard, and operational governance route
- the rollout still depends on the existing local-auth and JWT bridge rather than persistent multi-role storage
- broader machine-principal scope coverage, ownership-scope enforcement, and universal shared redaction remain incomplete
- `category_manager` remains blocked because category/object ownership enforcement is still not proven end to end
- `vendor` remains blocked because vendor/object-scope enforcement is still not proven end to end

Updated claim wording:

> Vexa PIM now has bounded live admin-boundary enforcement on representative governance routes plus broader billing, dashboard, metrics, audit, outbound-webhook, connector-permission, compliance-rule, and marketplace export-governance routes, authenticated-read classification, covered catalog API-client scope enforcement, fail-closed handling for unsupported future scope dimensions on covered product-backed paths, and Shopify publication-target catalog scope enforcement. It is not yet enterprise-complete across full admin-boundary mapping, persistent multi-role authorization, ownership-scoped roles, full API-client resources, or universal response redaction.

## 2026-04-30 PO Checkpoint: Workspace-User Managed Assigned-Role Rules

Decision: **Accepted for the bounded workspace-user multi-role management semantics slice. Not accepted as full multi-role rollout or full access-policy completion.**

Accepted in this follow-up:

- managed workspace-user writes now have one explicit role-set rule:
  - at most one assigned role can be written through workspace-user create or update
  - supported managed-write roles are `reviewer`, `editor`, `product_admin`, and `system_admin`
  - `product_admin` and `system_admin` require scalar `role = admin`
  - unsupported managed-write roles such as `super_admin`, `category_manager`, and `vendor` are rejected
- duplicate role arrays remain rejected
- `assignedRoles: []` still clears the persisted role set
- update requests that omit `assignedRoles` now preserve the stored role set only when the preserved set is still compatible with the next scalar role
- the checked-in CRUD harness now proves:
  - bounded single-role managed writes
  - unsupported-role rejection
  - admin-boundary-role base-role enforcement
  - system-admin managed-write success and readback
  - incompatible preserved-role rejection on scalar downgrade
  - explicit clear behavior still falls back safely to scalar-only compatibility

Still not accepted as complete:

- this is still not full allowed-combination policy across every future multi-role use case
- this is still not scalar-role removal
- this is still not a live production multi-role rollout
- broader role-set management semantics and product decisions on future combinations still need dedicated work

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement plus bounded `media.read`, `compliance.read`, `rejection_intelligence.read`, `auto_suggestions.read`, and `taxonomy.read` API-client scope families for their matching read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes including marketplace readiness-and-preflight governance and billing plan-tier governance, shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, outbound-webhook delivery, audit-log, billing-governance, and audit-explorer/export reads with a shared JSON and CSV visibility contract, additive persisted multi-role read-path support on `AuthIdentity.assigned_roles` with scalar-role fallback preserved, durable local-auth and DB-auth compatibility proof for normalized assigned roles, explicit governance-boundary durability proof for persisted `system_admin` versus `product_admin` assigned roles, bounded operator-safe backfill, fallback, rollback, and managed role-set semantics for persisted assigned roles, and bounded workspace-user managed-write rules for assigned roles. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, durable multi-role rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-30 PO Checkpoint: Consolidated Access-Policy Lane State

Decision: **Accepted as a consolidation pass. Not accepted as full access-policy completion.**

Accepted in this consolidation:

- the currently validated access-policy lanes were exercised together under one full validation bundle
- no unresolved textual merge conflicts remained in the checked surfaces
- the merged state preserved the latest bounded workspace-user safety rule:
  - omitted `assignedRoles` only preserves the stored set when it remains compatible with the next scalar role
- the merged state stayed green across remediation, delegated scopes, sensitive-GET policy, foundation, notifications, web build, increment gate, sprint gate, and staging validation

Still not accepted as complete:

- this is a consolidation of already-proven bounded slices, not new enterprise-wide authorization completion
- broad vendor rollout, unsupported ABAC dimensions, durable multi-role rollout completion, full API-client coverage, full admin-boundary mapping, and universal response redaction still remain incomplete

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement plus bounded `media.read`, `compliance.read`, `rejection_intelligence.read`, `auto_suggestions.read`, and `taxonomy.read` API-client scope families for their matching read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes including marketplace readiness-and-preflight governance and billing plan-tier governance, shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, outbound-webhook delivery, audit-log, billing-governance, and audit-explorer/export reads with a shared JSON and CSV visibility contract, additive persisted multi-role read-path support on `AuthIdentity.assigned_roles` with scalar-role fallback preserved, durable local-auth and DB-auth compatibility proof for normalized assigned roles, explicit governance-boundary durability proof for persisted `system_admin` versus `product_admin` assigned roles, bounded operator-safe backfill, fallback, rollback, and managed role-set semantics for persisted assigned roles, and bounded workspace-user managed-write rules for assigned roles. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, durable multi-role rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-29 PO Checkpoint: Multi-Role Rollout Runbook and Rollback Proof

Decision: **Accepted for the bounded operator-safe multi-role rollout slice. Not accepted as full multi-role migration or full access-policy completion.**

Accepted in this follow-up:

- a checked-in operator script now defines the bounded rollout behavior for `AuthIdentity.assigned_roles`
- a checked-in runbook now documents dry-run, confirm, rollback, and verification commands
- additive backfill is now proven to:
  - target only rows whose `assigned_roles` is `NULL` or `[]`
  - copy only normalized scalar app-role singletons
  - skip invalid scalar roles instead of guessing
  - preserve pre-existing non-empty multi-role rows
- rollback is now proven to:
  - clear only scalar-singleton `assigned_roles` rows written by this bounded rollout contract
  - preserve true multi-role rows
  - fall back safely to scalar-only compatibility after clearing persisted role arrays
- real dry-run evidence was captured from the checked-in script:
  - backfill dry-run: `scannedCount=2313`, `eligibleCount=2274`, `invalidScalarRoleCount=2`, `skippedExistingAssignedRolesCount=37`, `updatedCount=0`
  - rollback dry-run: `scannedCount=2313`, `eligibleCount=0`, `invalidScalarRoleCount=2`, `skippedUnsafeRollbackCount=2311`, `updatedCount=0`

Still not accepted as complete:

- this is still not a live production backfill execution
- this is still not a rollback-complete multi-role rollout
- scalar `role` remains the compatibility field
- broader workspace-user role-set management policy and allowed-combination decisions still need dedicated product work

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement plus bounded `media.read`, `compliance.read`, `rejection_intelligence.read`, `auto_suggestions.read`, and `taxonomy.read` API-client scope families for their matching read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes including marketplace readiness-and-preflight governance and billing plan-tier governance, shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, outbound-webhook delivery, audit-log, billing-governance, and audit-explorer/export reads with a shared JSON and CSV visibility contract, additive persisted multi-role read-path support on `AuthIdentity.assigned_roles` with scalar-role fallback preserved, durable local-auth and DB-auth compatibility proof for normalized assigned roles, explicit governance-boundary durability proof for persisted `system_admin` versus `product_admin` assigned roles, and bounded operator-safe backfill, fallback, rollback, and managed role-set semantics for persisted assigned roles. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, durable multi-role rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-29 PO Checkpoint: Multi-Role Backfill, Fallback, and Rollback Semantics

Decision: **Accepted for the bounded multi-role semantics follow-up. Not accepted as full multi-role rollout.**

Accepted in this follow-up:

- additive backfill semantics are now explicit and proven:
  - legacy scalar-only users still work when `assigned_roles` is empty
  - DB-auth treats `NULL assigned_roles` as scalar-only compatibility rather than as an escalation path
- duplicate-role handling is now explicit and proven:
  - duplicate persisted or local assigned-role arrays normalize safely on auth resolution
  - duplicate assigned-role arrays are rejected on managed workspace-user create and update writes
- rollback-safe compatibility is now explicit and proven:
  - explicit `assignedRoles: []` clears the persisted role set
  - the next login after that clear falls back to scalar-only compatibility
  - former editor-capable access is removed after the clear
- invalid-role normalization and no-escalation behavior remained green

Still not accepted as complete:

- this is still not a destructive migration
- this is still not a backfill-complete rollout
- this is still not a rollback-complete rollout
- scalar `role` removal was not attempted
- broader workspace-user multi-role management semantics and allowed-combination policy are still not complete

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement plus bounded `media.read`, `compliance.read`, `rejection_intelligence.read`, `auto_suggestions.read`, and `taxonomy.read` API-client scope families for their matching read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes including marketplace readiness-and-preflight governance and billing plan-tier governance, shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, outbound-webhook delivery, audit-log, billing-governance, and audit-explorer/export reads with a shared JSON and CSV visibility contract, additive persisted multi-role read-path support on `AuthIdentity.assigned_roles` with scalar-role fallback preserved, durable local-auth and DB-auth compatibility proof for normalized assigned roles, explicit governance-boundary durability proof for persisted `system_admin` versus `product_admin` assigned roles, and bounded non-destructive backfill, fallback, rollback, and managed role-set semantics for persisted assigned roles. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, durable multi-role rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-29 PO Checkpoint: Durable Assigned-Roles Auth Lifecycle Proof

Decision: **Accepted for the bounded multi-role durability continuation. Not accepted as full multi-role rollout.**

Accepted in this follow-up:

- persisted `assigned_roles` are now proven durable across one more real DB-auth lifecycle, not just direct login
- a workspace-user-created identity with scalar `viewer` plus persisted `assignedRoles: ["editor"]` now proves:
  - login JWT keeps scalar `role: "viewer"` for compatibility
  - normalized `assignedRoles` still unlock the later editor-capable route decision
  - issued step-up JWTs retain the normalized assigned-role set
  - password-reset confirm does not strip the persisted assigned-role set
  - later login after password reset still resolves the same assigned-role bridge and route access
- the already-proven local-auth bridge, DB-auth read path, workspace-user write durability, scalar fallback, and invalid-role no-escalation behavior all remained green

Still not accepted as complete:

- this is still not a full multi-role migration
- no destructive backfill, no rollback-complete rollout, and no scalar-role removal were attempted
- broader workspace-user multi-role UX/API semantics and allowed-combination policy are still not complete

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement plus bounded `media.read`, `compliance.read`, `rejection_intelligence.read`, `auto_suggestions.read`, and `taxonomy.read` API-client scope families for their matching read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes including marketplace readiness-and-preflight governance and billing plan-tier governance, shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, outbound-webhook delivery, audit-log, billing-governance, and audit-explorer/export reads with a shared JSON and CSV visibility contract, additive persisted multi-role read-path support on `AuthIdentity.assigned_roles` with scalar-role fallback preserved, durable local-auth and DB-auth compatibility proof for normalized assigned roles, workspace-user governance read compatibility for normalized persisted assigned roles, and a bounded additive workspace-user write contract whose assigned-role changes are proven durable through later logins and password-reset-confirm auth resolution. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, durable multi-role rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-29 PO Checkpoint: Assigned-Roles Admin-Boundary Durability

Decision: **Accepted for the bounded multi-role durability continuation. Not accepted as full multi-role rollout.**

Accepted in this follow-up:

- one small PO contract is now explicit and proven:
  - scalar `admin` stays the compatibility app-role field
  - persisted assigned roles are additive inputs to governance-boundary evaluation
  - normalized assigned roles, not the scalar field alone, decide whether a user crosses `manage_security` boundaries
- DB-auth now has proof that:
  - a persisted `system_admin` assigned role survives login and is honored on security-governance reads
  - a persisted `product_admin` assigned role does not escalate into security-governance access
- local-auth now has the same bounded proof:
  - local identities with `assignedRoles: ["system_admin"]` can cross the same security-governance read boundary
  - local identities with `assignedRoles: ["product_admin"]` cannot

Still not accepted as complete:

- this is still not a full multi-role rollout
- no backfill-complete migration, rollback-complete migration, or scalar-role removal were attempted
- broader role-set management semantics and allowed-combination policy are still pending

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement plus bounded `media.read`, `compliance.read`, `rejection_intelligence.read`, `auto_suggestions.read`, and `taxonomy.read` API-client scope families for their matching read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes including marketplace readiness-and-preflight governance and billing plan-tier governance, shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, outbound-webhook delivery, audit-log, billing-governance, and audit-explorer/export reads with a shared JSON and CSV visibility contract, additive persisted multi-role read-path support on `AuthIdentity.assigned_roles` with scalar-role fallback preserved, durable local-auth and DB-auth compatibility proof for normalized assigned roles, explicit governance-boundary durability proof for persisted `system_admin` versus `product_admin` assigned roles, workspace-user governance read compatibility for normalized persisted assigned roles, and a bounded additive workspace-user write contract whose assigned-role changes are proven durable through later logins and password-reset-confirm auth resolution. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, durable multi-role rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-29 PO Checkpoint: Marketplace Readiness and Preflight Governance Mapping

Decision: **Accepted for the bounded marketplace-governance follow-up. Not accepted as full admin-boundary completion.**

Accepted in this follow-up:

- `POST /marketplace/connectors/:connectorSlug/mappings/preflight` now enforces `manage_product_data`
- `POST /marketplace/connectors/:connectorSlug/publish-readiness` now enforces `manage_product_data`
- `POST /marketplace/readiness/batch` now enforces `manage_product_data`
- `product_admin` is now proven allowed on the covered readiness and preflight governance routes
- `system_admin` is now proven denied on the covered readiness and preflight governance routes
- the sensitive policy guardrail now validates those three routes as part of the explicit admin-boundary-controlled surface

Still not accepted as complete:

- this is still not full admin-boundary mapping across every remaining settings, connector-governance, operational-governance, and marketplace-governance route
- broader machine-principal coverage, ownership enforcement, durable multi-role rollout, and universal shared redaction remain incomplete
- `category_manager` and `vendor` remain only partially proven on their already-covered bounded surfaces

Updated claim wording:

> Vexa PIM now has bounded live admin-boundary enforcement on representative governance routes plus broader billing, dashboard, metrics, audit, outbound-webhook, connector-permission, compliance-rule, marketplace export-governance, and marketplace readiness-and-preflight governance routes, authenticated-read classification, covered catalog API-client scope enforcement plus bounded media.read, compliance.read, rejection_intelligence.read, auto_suggestions.read, and taxonomy.read API-client scope families, bounded vendor/object ownership enforcement on proven product-backed reads, additive persisted multi-role read-path support on `AuthIdentity.assigned_roles` with scalar-role fallback preserved, workspace-user governance read compatibility for normalized persisted assigned roles, and a bounded additive workspace-user write contract for persisted assigned roles. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, durable multi-role rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-29 PO Checkpoint: Audit Log Governance Redaction

Decision: **Accepted for the bounded audit-log redaction follow-up. Not accepted as broader audit explorer or universal redaction completion.**

Accepted in this follow-up:

- `GET /audit/logs` now uses explicit central read redaction
- `system_admin` remains allowed on audit-log reads but receives `metadata: null`
- `system_admin` audit-log rows now surface `redactedFields: ["metadata"]`
- `super_admin` and legacy `admin` retain full audit-log metadata visibility

Still not accepted as complete:

- `GET /audit/events` and `GET /audit/events/export` still need a broader role-aware field contract before safe redaction rollout
- this does not complete universal response redaction
- broader admin-boundary mapping, broader API-client coverage, durable multi-role rollout, and unsupported ABAC dimensions remain incomplete

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement plus bounded media.read, compliance.read, rejection_intelligence.read, auto_suggestions.read, and taxonomy.read API-client scope families for their matching read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes including marketplace readiness-and-preflight governance, shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, outbound-webhook delivery, and audit-log reads, additive persisted multi-role read-path support on `AuthIdentity.assigned_roles` with scalar-role fallback preserved, workspace-user governance read compatibility for normalized persisted assigned roles, and a bounded additive workspace-user write contract for persisted assigned roles. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, durable multi-role rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-29 PO Checkpoint: Additive Multi-Role Persistence Read Path

Decision: **Accepted for the bounded persistence-read follow-up. Not accepted as full multi-role rollout.**

Accepted in this follow-up:

- `AuthIdentity` now has additive `assigned_roles` storage without removing legacy scalar `role`
- DB-backed auth now reads persisted `assigned_roles` when present
- DB-backed auth still falls back to scalar `role` when `assigned_roles` is empty
- JWT/local bridging stayed compatible because the read path now feeds the already-existing `assignedRoles` claim support
- dedicated DB-auth integration proof now validates:
  - persisted assigned roles are read when present
  - scalar fallback still works when assigned roles are empty
  - invalid assigned-role values normalize away and do not escalate privilege

Still not accepted as complete:

- this is not a full multi-role write rollout
- workspace-user CRUD still manages scalar `role` only
- there is no destructive migration, no scalar-role removal, and no admin hierarchy redesign in this slice
- broader vendor, owner, unsupported ABAC dimensions, full API-client coverage, and universal redaction work remain incomplete

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, bounded machine-principal scope families on covered catalog, media, compliance, rejection-intelligence, and auto-suggestion read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes, shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, and outbound-webhook delivery reads, and additive persisted multi-role read-path support on `AuthIdentity.assigned_roles` with scalar-role fallback preserved. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, durable multi-role write rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-29 PO Checkpoint: Workspace-User Assigned-Roles Read Compatibility

Decision: **Accepted for the bounded governance-read compatibility follow-up. Not accepted as multi-role write rollout.**

Accepted in this follow-up:

- workspace-user governance reads now include normalized persisted `assignedRoles`
- persisted invalid assigned-role strings are filtered out before governance-read output
- legacy scalar `role` remains the compatibility field for current callers
- no multi-role create or update contract was introduced accidentally

Still not accepted as complete:

- workspace-user CRUD still does not support multi-role assignment writes
- no additive multi-role DTO/API contract exists yet for create or update
- rollback-complete migration, backfill behavior, and admin UX/API for managing multiple persisted roles still need a dedicated slice

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, bounded machine-principal scope families on covered catalog, media, compliance, rejection-intelligence, and auto-suggestion read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes, shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, and outbound-webhook delivery reads, additive persisted multi-role read-path support on `AuthIdentity.assigned_roles` with scalar-role fallback preserved, and workspace-user governance read compatibility for normalized persisted assigned roles. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, durable multi-role write rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-29 PO Checkpoint: Workspace-User Assigned-Roles Additive Write Contract

Decision: **Accepted for the bounded multi-role write-contract follow-up. Not accepted as full multi-role rollout.**

Accepted in this follow-up:

- workspace-user create now accepts optional additive `assignedRoles`
- workspace-user role updates now accept optional additive `assignedRoles`
- persisted `assignedRoles` are normalized before storage
- omitting `assignedRoles` on role update preserves the existing stored values
- invalid assigned-role values are rejected instead of being stored
- workspace-user audit metadata now records assigned-role additions and changes

Still not accepted as complete:

- this is still not a full multi-role rollout
- scalar `role` remains the primary compatibility field and was not removed
- broader workspace-user multi-role UX/API, backfill sequencing, fallback verification, and rollback-complete rollout are still pending
- broader vendor breadth, owner breadth, unsupported ABAC dimensions, full API-client coverage, and universal redaction remain incomplete

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, bounded machine-principal scope families on covered catalog, media, compliance, rejection-intelligence, and auto-suggestion read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes, shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, and outbound-webhook delivery reads, additive persisted multi-role read-path support on `AuthIdentity.assigned_roles` with scalar-role fallback preserved, workspace-user governance read compatibility for normalized persisted assigned roles, and a bounded additive workspace-user write contract for persisted assigned roles. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, durable multi-role rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-29 PO Checkpoint: API-Client `taxonomy.read` Scope Foundation

Decision: **Accepted for the bounded machine-principal taxonomy metadata slice.**

Accepted in this follow-up:

- added a new API-client scope vocabulary item:
  - `taxonomy.read`
- enforced that scope only on the bounded taxonomy metadata family:
  - `GET /taxonomy/categories`
  - `GET /taxonomy/categories/:id`
  - `GET /taxonomy/categories/:id/attributes`
- proved:
  - API key with `taxonomy.read` can read the taxonomy metadata family
  - API key with unrelated scopes is denied
  - API key with no scopes is denied
  - human editor behavior remains valid
  - taxonomy writes remain blocked

Still not accepted as complete:

- this is not full API-client resource coverage
- the next obvious machine-principal candidate, `GET /issues/inbox`, mixes aggregate summaries with connector-installation filtering and needs a broader route-family contract
- broader vendor breadth, owner breadth, unsupported ABAC dimensions, full admin-boundary mapping, durable multi-role rollout, and universal response redaction remain incomplete

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement plus bounded `media.read`, `compliance.read`, `rejection_intelligence.read`, `auto_suggestions.read`, and `taxonomy.read` API-client scope families for their matching read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes, shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, and outbound-webhook delivery reads, additive persisted multi-role read-path support on `AuthIdentity.assigned_roles` with scalar-role fallback preserved, workspace-user governance read compatibility for normalized persisted assigned roles, and a bounded additive workspace-user write contract for persisted assigned roles. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, durable multi-role rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-29 PO Checkpoint: Billing Governance Read Redaction

Decision: **Accepted for the bounded governance-redaction follow-up.**

Accepted in this follow-up:

- `GET /billing/plan-profile` now uses a central read policy rather than relying only on route gating
- `GET /billing/upgrade-request` now uses a central read policy rather than relying only on route gating
- `system_admin` remains allowed on both routes but receives a bounded redacted view:
  - plan profile redacts `billingContactEmail` and `updatedBy`
  - upgrade request redacts `requestedBy`, `notes`, and `resolvedBy`
- `super_admin` and legacy `admin` retain full visibility where valid

Still not accepted as complete:

- this is still not universal redaction across all commercial or governance payloads
- internal commercial listing and export surfaces still need a broader field-level visibility design
- broader machine-principal coverage, unsupported ABAC dimensions, durable multi-role rollout, and full admin-boundary mapping remain incomplete

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement plus bounded `media.read`, `compliance.read`, `rejection_intelligence.read`, `auto_suggestions.read`, and `taxonomy.read` API-client scope families for their matching read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes including marketplace readiness-and-preflight governance, shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, outbound-webhook delivery, audit-log, and billing-governance reads, additive persisted multi-role read-path support on `AuthIdentity.assigned_roles` with scalar-role fallback preserved, workspace-user governance read compatibility for normalized persisted assigned roles, and a bounded additive workspace-user write contract for persisted assigned roles. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, durable multi-role rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-29 PO Checkpoint: Outbound Webhook Delivery Redaction Foundation

Decision: **Accepted for the bounded governance-redaction follow-up.**

Accepted in this follow-up:

- `GET /admin/webhooks/deliveries` now has an explicit central read policy instead of inheriting only route protection
- the delivery payload family now redacts `errorMessage` for `system_admin`
- `super_admin` and legacy `admin` retain the full delivery error text where valid
- the proof uses a real failed delivery fixture and confirms that lower-admin redaction happens on live delivery rows

Still not accepted as complete:

- this is still not universal field-level redaction across all governance payload families
- broader explorer-style audit payloads and other mixed metadata surfaces still need a larger field-level redaction design
- broader machine-principal coverage, unsupported ABAC dimensions, and persistent multi-role storage remain incomplete

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, bounded machine-principal scope families on covered catalog, media, compliance, rejection-intelligence, and auto-suggestion read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes, and shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, and outbound-webhook delivery reads. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-29 PO Checkpoint: Multi-Role Persistence Plan

Decision: **Accepted as planning foundation only.**

Accepted in this follow-up:

- the persistence blocker is now specifically identified:
  - `AuthIdentity` stores only scalar `role`
  - DB-auth resolution still emits `assignedRoles: []`
  - workspace-user CRUD still manages only scalar `role`
- the smallest safe rollout path is now defined as an additive `assigned_roles` column with read-path-first adoption and non-destructive rollback

Still not accepted as complete:

- no DB migration has been executed yet
- no backfill has been run
- no DB-auth integration proof exists yet for persisted assigned roles
- workspace-user write-path support for multi-role identities remains unimplemented

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, bounded machine-principal scope families on covered catalog, media, compliance, rejection-intelligence, and auto-suggestion read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes, shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, and outbound-webhook delivery reads, and a concrete additive plan for durable multi-role persistence. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, persistent multi-role authorization rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-29 PO Checkpoint: API-Client `media.read` Scope Foundation

Decision: **Accepted for the bounded machine-principal foundation slice.**

Accepted in this follow-up:

- added a new API-client scope vocabulary item:
  - `media.read`
- enforced that scope on one bounded read-only resource family:
  - `GET /media/assets`
  - `GET /media/assets/:id`
  - `GET /media/assets/:id/validation`
- proved:
  - API key with `media.read` can read the media family
  - API key with unrelated `catalog.*` scopes is denied
  - API key with no scopes is denied
  - human editor behavior remains valid
  - media writes remain blocked

Still not accepted as complete:

- this is not full API-client resource coverage
- broader machine-principal scope modeling is still incomplete outside the covered catalog and media read families
- vendor breadth, owner breadth, remaining admin-boundary mapping, persistent multi-role storage, and universal response redaction remain incomplete

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement plus a bounded media.read API-client scope family for the media read routes, actor-specific delegated-scope activation, bounded admin-boundary enforcement on covered governance routes, category-scoped enforcement on proven catalog and taxonomy surfaces, Shopify publication-target catalog scope enforcement, bounded owner-scope enforcement on marketplace mapping templates, bounded vendor/object ownership enforcement on the proven catalog, compliance issue, auto-suggestion, rejection-intelligence, and media read paths, and shared governance provenance redaction on covered API-key, workspace-user, access-scope, connector-permission, and outbound-webhook reads. It is not yet enterprise-complete across broad vendor enforcement, supplier or locale or market or team or assignee scope enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-29 PO Checkpoint: API-Client Scope Expansion Queue Batch

Decision: **Accepted for the bounded queue-1 machine-principal expansion batch.**

Accepted in this follow-up:

- added three more explicit API-client scope families:
  - `compliance.read`
  - `rejection_intelligence.read`
  - `auto_suggestions.read`
- enforced them only on:
  - `GET /compliance/products/:id/issues`
  - `GET /rejection-intelligence/products/:id/score`
  - `GET /auto-suggestions/products/:id/title-suggestion`
  - `GET /auto-suggestions/products/:id/attribute-enrichment`
  - `GET /auto-suggestions/products/:id/category-suggestion`
- proved:
  - exact-scope API keys are allowed
  - no-scope API keys are denied
  - unrelated-scope API keys are denied
  - human behavior remains valid
  - writes remain blocked

Still not accepted as complete:

- this does not complete the full API-client resource model
- queue 1 is exhausted only for the currently clean read-only pattern
- queue 2 next targets require broader field-level redaction design, not another simple provenance-only slice
- broader vendor breadth, owner breadth, admin-boundary breadth, multi-role persistence, and universal redaction remain incomplete

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement plus bounded media.read, compliance.read, rejection_intelligence.read, and auto_suggestions.read API-client scope families for their matching read routes, actor-specific delegated-scope activation, bounded admin-boundary enforcement on covered governance routes, category-scoped enforcement on proven catalog and taxonomy surfaces, Shopify publication-target catalog scope enforcement, bounded owner-scope enforcement on marketplace mapping templates, bounded vendor/object ownership enforcement on the proven catalog, compliance issue, auto-suggestion, rejection-intelligence, and media read paths, and shared governance provenance redaction on covered API-key, workspace-user, access-scope, connector-permission, and outbound-webhook reads. It is not yet enterprise-complete across broad vendor enforcement, supplier or locale or market or team or assignee scope enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-29 PO Checkpoint: Shared Governance Provenance Redaction Expansion

Decision: **Accepted for the bounded shared-redaction queue slice. Not accepted as universal redaction or full queue completion.**

Accepted in this follow-up:

- central governance provenance redaction now covers:
  - `GET /connectors/permissions`
  - `GET /admin/webhooks`
- `system_admin` remains allowed on those governance reads but now receives `createdBy` redacted through the shared response-policy path
- `super_admin` and legacy `admin` retain full provenance visibility on those reads
- the access-policy remediation suite now proves the redaction behavior instead of relying only on policy metadata

Still not accepted as complete:

- this is still not universal response redaction across all API families
- ONDC is disabled and explicitly out of scope for the current access-policy backlog. It is not an active blocker unless `FEATURE_ONDC_ENABLED` is enabled in a future release.
- the next plausible owner-scope candidate would require a different resource model rather than another clean governance-read repetition
- broad vendor enforcement, broader owner enforcement, broader API-client coverage, persistent multi-role storage rollout, and full admin-boundary mapping remain incomplete

Updated claim wording:

> Vexa PIM now has bounded vendor/object ownership enforcement on the canonical catalog read family plus compliance product-issue reads, auto-suggestion title, attribute-enrichment, and category-suggestion reads, rejection-intelligence score reads, and media asset reads, in addition to runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement, actor-specific delegated-scope activation, bounded admin-boundary enforcement on covered governance routes, category-scoped enforcement on proven catalog and taxonomy surfaces, Shopify publication-target catalog scope enforcement, bounded owner-scope enforcement on marketplace mapping templates, and shared governance provenance redaction on covered API-key, workspace-user, access-scope, connector-permission, and outbound-webhook reads. It is not yet enterprise-complete across broad vendor enforcement, supplier, locale, market, team, or assignee scope enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-29 PO Checkpoint: ONDC Backlog Classification

Decision: **Accepted. ONDC removed from active blockers and moved to disabled/future-scope status.**

ONDC status:

- ONDC is disabled by default because `FEATURE_ONDC_ENABLED` defaults false.
- `OndcModule` is only mounted when the feature flag is enabled.
- ONDC is not part of the current access-policy execution backlog.
- Do not treat ONDC routes as active blockers while the module remains disabled.
- If ONDC is enabled later, open a separate ONDC access-policy slice before release.

## 2026-04-29 PO Checkpoint: Audit Explorer and Export Visibility Contract

Decision: **Accepted for the bounded audit explorer/export visibility follow-up. Not accepted as universal redaction.**

Accepted in this follow-up:

- `GET /audit/events` now uses a shared governance redaction policy for lower admin visibility
- `GET /audit/events/export` now uses the same visibility decision before rendering CSV
- `system_admin` remains allowed on audit explorer reads but receives `metadata: null` in JSON and redacted metadata in CSV
- `super_admin` and legacy `admin` retain full metadata visibility on both JSON and CSV outputs
- CSV export no longer bypasses the JSON redaction decision for audit explorer metadata

Still not accepted as complete:

- this is not universal response redaction
- `GET /audit/events` and `GET /audit/events/export` are now aligned, but broader explorer/export payload families still need their own field-visibility contracts
- mixed marketplace lifecycle governance, commercial-ops token flows, broader API-client scope coverage, and durable multi-role rollout all remain incomplete

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement plus bounded `media.read`, `compliance.read`, `rejection_intelligence.read`, `auto_suggestions.read`, and `taxonomy.read` API-client scope families for their matching read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes including marketplace readiness-and-preflight governance, shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, outbound-webhook delivery, audit-log, billing-governance, and audit-explorer/export reads with a shared JSON and CSV visibility contract, additive persisted multi-role read-path support on `AuthIdentity.assigned_roles` with scalar-role fallback preserved, workspace-user governance read compatibility for normalized persisted assigned roles, and a bounded additive workspace-user write contract for persisted assigned roles. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, durable multi-role rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-29 PO Checkpoint: Durable Multi-Role Compatibility Proofs

Decision: **Accepted for the bounded durable multi-role follow-up. Not accepted as full multi-role rollout.**

Accepted in this follow-up:

- DB-backed `assigned_roles` persistence is now proven through later login, not just through create or update payload echoes
- workspace-user assigned-role writes now prove:
  - created users receive persisted assigned roles in later JWT claims
  - later role and assigned-role updates change subsequent JWT claims
  - omitting `assignedRoles` on update preserves the stored assigned-role set into later logins
- local identity-directory auth now has explicit compatibility proof:
  - normalized `assignedRoles` flow into local-mode JWT claims
  - invalid local assigned-role strings normalize away
  - scalar-only local identities remain legacy-compatible
- no new role escalation path was introduced

Still not accepted as complete:

- this is still not a backfill-complete or rollback-complete multi-role migration
- scalar `role` remains part of the durable compatibility model and has not been removed
- broader multi-role UX/API management and full admin-hierarchy semantics remain incomplete

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement plus bounded `media.read`, `compliance.read`, `rejection_intelligence.read`, `auto_suggestions.read`, and `taxonomy.read` API-client scope families for their matching read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes including marketplace readiness-and-preflight governance, shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, outbound-webhook delivery, audit-log, billing-governance, and audit-explorer/export reads with a shared JSON and CSV visibility contract, additive persisted multi-role read-path support on `AuthIdentity.assigned_roles` with scalar-role fallback preserved, durable local-auth and DB-auth compatibility proof for normalized assigned roles, workspace-user governance read compatibility for normalized persisted assigned roles, and a bounded additive workspace-user write contract whose assigned-role changes are proven durable through later logins. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, durable multi-role rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-29 PO Checkpoint: Billing Plan-Tier Governance Boundary

Decision: **Accepted for the bounded billing-governance follow-up. Not accepted as billing internal-flow completion.**

Accepted in this follow-up:

- `POST /billing/plan-tier` now participates in the same billing-governance admin boundary as the adjacent tenant billing routes
- `product_admin` is now denied at the admin boundary instead of falling through to the internal-only commercial block
- `system_admin` and `super_admin` preserve the existing `COMMERCIAL_MUTATION_INTERNAL_ONLY` behavior
- this keeps the human governance boundary explicit without changing the internal commercial-ops design

Still not accepted as complete:

- this does not redesign or widen `billing/internal/*` commercial-ops token flows
- this is one bounded governance mutation, not full billing authorization completion
- broader admin-boundary mapping, multi-role rollout, broader API-client coverage, and universal response redaction remain incomplete

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement plus bounded `media.read`, `compliance.read`, `rejection_intelligence.read`, `auto_suggestions.read`, and `taxonomy.read` API-client scope families for their matching read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes including marketplace readiness-and-preflight governance and billing plan-tier governance, shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, outbound-webhook delivery, audit-log, billing-governance, and audit-explorer/export reads with a shared JSON and CSV visibility contract, additive persisted multi-role read-path support on `AuthIdentity.assigned_roles` with scalar-role fallback preserved, durable local-auth and DB-auth compatibility proof for normalized assigned roles, workspace-user governance read compatibility for normalized persisted assigned roles, and a bounded additive workspace-user write contract whose assigned-role changes are proven durable through later logins. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, durable multi-role rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-28 PO Checkpoint: Vendor/Object Ownership Expansion To Auto-Suggestion Title Reads

Decision: **Accepted as a bounded vendor/object ownership expansion slice. Not accepted as broad vendor-role completion.**

Accepted in this follow-up:

- `GET /auto-suggestions/products/:id/title-suggestion` now participates in the already-proven vendor/object ownership model
- vendor can read owned auto-suggestion title data
- vendor is denied unowned auto-suggestion title data
- reviewer denial and editor allow remain intact on the auto-suggestion surface
- vendor writes and the other non-proven AI-helper routes remain fail-closed

Still not accepted as complete:

- this is still not broad vendor rollout
- vendor writes, taxonomy access, and governance surfaces remain blocked
- `supplier`, `locale`, `market`, `team`, and `assignee` enforcement remain pending
- broader API-client / machine-principal coverage, persistent multi-role storage rollout, full admin-boundary mapping, and universal response redaction remain incomplete

Updated claim wording:

> Vexa PIM now has bounded vendor/object ownership enforcement on the canonical catalog read family plus compliance product-issue reads, auto-suggestion title reads, rejection-intelligence score reads, and media asset reads, in addition to runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement, actor-specific delegated-scope activation, bounded admin-boundary enforcement on covered governance routes, category-scoped enforcement on proven catalog and taxonomy surfaces, Shopify publication-target catalog scope enforcement, bounded owner-scope enforcement on marketplace mapping templates, and shared governance provenance redaction on covered API-key, workspace-user, and access-scope reads. It is not yet enterprise-complete across broad vendor enforcement, supplier or locale or market or team or assignee scope enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-28 PO Checkpoint: Vendor/Object Ownership Expansion To Remaining Auto-Suggestion Reads

Decision: **Accepted as a bounded vendor/object ownership expansion slice. Not accepted as broad vendor-role completion.**

Accepted in this follow-up:

- `GET /auto-suggestions/products/:id/attribute-enrichment` now participates in the already-proven vendor/object ownership model
- `GET /auto-suggestions/products/:id/category-suggestion` now participates in the already-proven vendor/object ownership model
- vendor can read owned resources on both routes
- vendor is denied unowned resources on both routes
- reviewer denial and editor allow remain intact
- vendor writes and the repair route remain blocked

Still not accepted as complete:

- this is still not broad vendor rollout
- vendor writes, taxonomy access, and governance surfaces remain blocked
- `supplier`, `locale`, `market`, `team`, and `assignee` enforcement remain pending
- broader API-client / machine-principal coverage, persistent multi-role storage rollout, full admin-boundary mapping, and universal response redaction remain incomplete

Updated claim wording:

> Vexa PIM now has bounded vendor/object ownership enforcement on the canonical catalog read family plus compliance product-issue reads, auto-suggestion title, attribute-enrichment, and category-suggestion reads, rejection-intelligence score reads, and media asset reads, in addition to runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement, actor-specific delegated-scope activation, bounded admin-boundary enforcement on covered governance routes, category-scoped enforcement on proven catalog and taxonomy surfaces, Shopify publication-target catalog scope enforcement, bounded owner-scope enforcement on marketplace mapping templates, and shared governance provenance redaction on covered API-key, workspace-user, and access-scope reads. It is not yet enterprise-complete across broad vendor enforcement, supplier or locale or market or team or assignee scope enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-28 PO Checkpoint: Vendor/Object Ownership Expansion To Media Asset Reads

Decision: **Accepted as a bounded vendor/object ownership expansion slice. Not accepted as broad vendor-role completion.**

Accepted in this follow-up:

- the media asset read family now reuses the trusted `Product.vendorScopeKey` boundary for vendor-owned resource reads
- the covered vendor-safe media routes are now:
  - `GET /media/assets`
  - `GET /media/assets/:id`
  - `GET /media/assets/:id/validation`
- delegated-scope and remediation suites now prove:
  - vendor can read owned media asset lists
  - vendor can read owned media asset detail
  - vendor can read owned media validation output
  - vendor is denied unowned media assets
- vendor writes remain blocked and all non-proven vendor surfaces remain fail-closed

Still not accepted as complete:

- this is still not broad vendor rollout across all product-backed read families
- vendor writes, vendor taxonomy access, and vendor governance access remain blocked
- `supplier`, `locale`, `market`, `team`, and `assignee` remain representable but unenforced
- broader machine-principal coverage, persistent multi-role storage rollout, full admin-boundary mapping, and universal redaction remain incomplete
- `category_manager` remains only partially unblocked on the already proven category-scoped catalog and taxonomy surfaces

Updated claim wording:

> Vexa PIM now has bounded vendor/object ownership enforcement on the canonical catalog read family plus compliance product-issue reads and media asset reads, in addition to runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement, actor-specific delegated-scope activation, bounded admin-boundary enforcement on covered governance routes, category-scoped enforcement on proven catalog and taxonomy surfaces, Shopify publication-target catalog scope enforcement, bounded owner-scope enforcement on marketplace mapping templates, and shared governance provenance redaction on covered API-key, workspace-user, and access-scope reads. It is not yet enterprise-complete across broad vendor enforcement, supplier or locale or market or team or assignee scope enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-28 PO Checkpoint: Vendor/Object Ownership Expansion To Rejection Score Reads

Decision: **Accepted as a bounded vendor/object ownership expansion slice. Not accepted as broad vendor-role completion.**

Accepted in this follow-up:

- the rejection-intelligence score read now reuses the trusted `Product.vendorScopeKey` boundary for vendor-owned resource reads
- the covered vendor-safe rejection-score route is now:
  - `GET /rejection-intelligence/products/:id/score`
- delegated-scope and remediation suites now prove:
  - vendor can read owned rejection-intelligence score data
  - vendor is denied unowned rejection-intelligence score data
- reviewer access remains intact
- vendor writes and all non-proven vendor surfaces remain fail-closed

Still not accepted as complete:

- this is still not broad vendor rollout across all product-backed read families
- vendor writes, vendor taxonomy access, and vendor governance access remain blocked
- `supplier`, `locale`, `market`, `team`, and `assignee` remain representable but unenforced
- broader machine-principal coverage, persistent multi-role storage rollout, full admin-boundary mapping, and universal redaction remain incomplete
- `category_manager` remains only partially unblocked on the already proven category-scoped catalog and taxonomy surfaces

Updated claim wording:

> Vexa PIM now has bounded vendor/object ownership enforcement on the canonical catalog read family plus compliance product-issue reads, rejection-intelligence score reads, and media asset reads, in addition to runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement, actor-specific delegated-scope activation, bounded admin-boundary enforcement on covered governance routes, category-scoped enforcement on proven catalog and taxonomy surfaces, Shopify publication-target catalog scope enforcement, bounded owner-scope enforcement on marketplace mapping templates, and shared governance provenance redaction on covered API-key, workspace-user, and access-scope reads. It is not yet enterprise-complete across broad vendor enforcement, supplier or locale or market or team or assignee scope enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-28 PO Checkpoint: Shared Governance Provenance Redaction

Decision: **Accepted for the bounded shared-redaction follow-up.**

Accepted in this follow-up:

- API-key governance reads now use shared central redaction
- workspace-user governance reads now use shared central redaction
- workspace access-scope governance reads now use shared central redaction
- `system_admin` allow remains intact on the covered routes
- `super_admin` allow remains intact on the covered routes
- provenance fields such as `createdBy` are now centrally redacted for `system_admin` but retained for `super_admin` and legacy `admin`

Still not accepted as complete:

- this is not universal response redaction
- it does not complete broader vendor rollout, future-scope enforcement, persistent multi-role storage, broader API-client resource coverage, or full admin-boundary mapping
- `category_manager` remains only partially unblocked on proven category-scoped catalog and taxonomy surfaces
- `vendor` remains only partially unblocked on the proven canonical catalog read family and remains blocked elsewhere

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement, actor-specific delegated-scope activation, bounded admin-boundary enforcement on covered governance routes, category-scoped enforcement on proven catalog and taxonomy surfaces, Shopify publication-target catalog scope enforcement, bounded owner-scope enforcement on marketplace mapping templates, bounded vendor/object ownership enforcement on the canonical catalog read family, and shared governance provenance redaction on covered API-key, workspace-user, and access-scope reads. It is not yet enterprise-complete across broad vendor enforcement, supplier or locale or market or team or assignee scope enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-28 PO Checkpoint: Vendor/Object Ownership Expansion To Compliance Product-Issue Reads

Decision: **Accepted for the bounded vendor-expansion follow-up.**

Accepted in this follow-up:

- `GET /compliance/products/:id/issues` now participates in the already-proven vendor/object ownership model
- vendor is now allowed on owned compliance product-issue reads
- vendor is denied on unowned compliance product-issue reads
- the route still relies on the central product access assertion, so delegated category, brand, and vendor intersections remain consistent

Still not accepted as complete:

- this is not broad vendor rollout
- vendor writes, taxonomy reads, governance routes, and other non-proven vendor surfaces remain blocked
- supplier, locale, market, team, and assignee enforcement remain pending
- broader API-client resources, persistent multi-role authorization, full admin-boundary mapping, and universal response redaction remain incomplete

Updated claim wording:

> Vexa PIM now has bounded vendor/object ownership enforcement on the canonical catalog read family plus compliance product-issue reads, in addition to runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement, actor-specific delegated-scope activation, bounded admin-boundary enforcement on covered governance routes, category-scoped enforcement on proven catalog and taxonomy surfaces, Shopify publication-target catalog scope enforcement, bounded owner-scope enforcement on marketplace mapping templates, and shared governance provenance redaction on covered API-key, workspace-user, and access-scope reads. It is not yet enterprise-complete across broad vendor enforcement, supplier or locale or market or team or assignee scope enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-28 PO Checkpoint: Vendor/Object Ownership Foundation On Canonical Catalog Reads

Decision: **Conditionally accepted for the bounded vendor-ownership follow-up.**

Accepted in this follow-up:

- `Product.vendorScopeKey` now provides one trustworthy persisted vendor/object ownership source
- vendor delegated-scope assignments are now storable as a real foundation dimension
- vendor ownership is now enforced on the canonical catalog read family:
  - product list
  - product search
  - product detail
  - product variants
- vendors are now proven allowed on owned catalog resources
- vendors are now proven denied on unowned catalog resources
- mixed category-plus-vendor delegated scope is now proven to intersect correctly on catalog product reads
- vendor writes remain blocked
- taxonomy and other non-proven vendor surfaces remain blocked

Still not accepted as complete:

- this is not broad vendor rollout across products, taxonomy, marketplace, or governance surfaces
- `vendor` is only partially unblocked on one proven product-backed read path
- `supplier`, `locale`, `market`, `team`, and `assignee` enforcement remain unimplemented
- broader API-client or machine-principal resource coverage remains incomplete
- persistent multi-role storage rollout remains incomplete
- full admin-boundary mapping remains incomplete
- shared response redaction remains partial

Updated claim wording:

> Vexa PIM now has bounded vendor/object ownership enforcement on one proven product-backed catalog read path, in addition to runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement, actor-specific delegated-scope activation, bounded admin-boundary enforcement on covered governance routes, category-scoped enforcement on proven catalog and taxonomy surfaces, Shopify publication-target catalog scope enforcement, and owner-scope enforcement on marketplace mapping templates. It is not yet enterprise-complete across broad vendor enforcement, supplier or locale or market or team or assignee scope enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-28 PO Checkpoint: Owner-Scoped Marketplace Mapping Templates

Decision: **Accepted for the bounded ownership-enforcement follow-up.**

Accepted in this follow-up:

- `owner` scope assignments are now allowed into storage instead of being universally rejected
- marketplace mapping-template list, get, update, clone, and delete now enforce owned-resource access when `owner` scope is active
- template default-switch behavior now respects owner boundaries instead of mutating unrelated templates
- delegated-access proof now covers owner + category + channel intersection on owned mapping-template resources
- the mapping-manager integration harness was brought up to the current workspace-aware auth contract so this route family remains regression-tested

Still not accepted as complete:

- this is bounded `owner` enforcement on a single resource family, not broad ownership enforcement across the platform
- `vendor` remains blocked because there is still no trustworthy vendor/object boundary on product resources
- `supplier`, `locale`, `market`, `team`, and `assignee` remain representable but not enforced
- persistent multi-role storage rollout, broader machine-principal scope coverage, full admin-boundary mapping, and shared response redaction remain incomplete

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement, actor-specific delegated-scope activation, bounded live admin-boundary enforcement on covered governance routes, fail-closed handling for unsupported future scope dimensions on covered product-backed paths, Shopify publication-target catalog scope enforcement, partial safe unblocking of `category_manager` on proven category-scoped catalog and taxonomy surfaces, and bounded owner-scope enforcement on marketplace mapping templates that persist trustworthy ownership. It is not yet enterprise-complete across vendor/object ownership enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-28 PO Checkpoint: Category-Scoped Foundation Role Enforcement

Decision: **Accepted for the bounded category-scoped follow-up. Not accepted as full access-policy completion.**

Accepted in this follow-up:

- blocked foundation roles are no longer only blocked on admin-boundary routes; the default block now applies on ordinary RBAC routes unless a route explicitly opts them in
- `category_manager` is now explicitly allowed only on the catalog and taxonomy surfaces where category scope can be proven
- catalog and taxonomy services now carry effective foundation-role context into the shared access-policy engine, so a legacy `admin` app role no longer bypasses category scope for `category_manager`
- actor-specific scope activation is now proven and replaces the earlier tenant-global scope-coupling behavior
- remediation and delegated-scope suites now prove:
  - `category_manager` allowed on scoped catalog list/detail/create/update/delete and taxonomy metadata/attribute-definition paths
  - `category_manager` denied on out-of-scope product and category reads
  - `category_manager` denied on taxonomy hierarchy mutation
  - `vendor` still denied with fail-closed behavior until real vendor enforcement exists

Still not accepted as complete:

- this is only a partial unblock for `category_manager`, not full ownership enforcement
- `vendor` remains blocked because the current product and taxonomy model still lacks a provable vendor/object boundary
- ownership enforcement for `owner`, `supplier`, `locale`, `market`, `team`, and `assignee` is still not implemented
- persistent multi-role storage rollout remains incomplete
- broader API-client resource coverage remains incomplete
- universal shared response redaction remains incomplete
- full admin-boundary mapping remains incomplete

Updated claim wording:

> Vexa PIM now has runtime-enforced authenticated-read classification, explicit catalog API-client scope enforcement, actor-specific delegated-scope activation, bounded live admin-boundary enforcement on covered governance routes, fail-closed handling for unsupported future scope dimensions on covered product-backed paths, Shopify publication-target catalog scope enforcement, and partial safe unblocking of `category_manager` on proven category-scoped catalog and taxonomy surfaces. It is not yet enterprise-complete across vendor/object ownership enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.

## 2026-04-28 PO Checkpoint: Taxonomy Product-Governance Admin-Boundary Mapping

Decision: **Conditionally accepted for the bounded taxonomy-governance follow-up.**

Accepted in this follow-up:

- taxonomy category create, update, and delete governance now enforces `manage_product_data`
- taxonomy attribute-definition create, update, and delete governance now enforces `manage_product_data`
- `product_admin` is now proven allowed on the covered taxonomy governance routes
- `system_admin` is now proven denied on the covered taxonomy governance routes
- the sensitive policy guardrail now validates those taxonomy governance routes as part of the admin-boundary-controlled surface

Still not accepted as complete:

- this is still not full admin-boundary mapping across every remaining settings, connector-governance, operational-governance, and marketplace-governance route
- the rollout still depends on the current local-auth and JWT bridge rather than persistent multi-role storage
- broader machine-principal resource coverage, ownership enforcement, and universal shared redaction remain incomplete
- `category_manager` remains blocked because category/object ownership enforcement is still not proven end to end
- `vendor` remains blocked because vendor/object-scope enforcement is still not proven end to end

Updated claim wording:

> Vexa PIM now has bounded live admin-boundary enforcement on representative governance routes plus broader billing, dashboard, metrics, audit, outbound-webhook, connector-permission, compliance-rule, marketplace export-governance, and taxonomy product-governance routes, authenticated-read classification, covered catalog API-client scope enforcement, fail-closed handling for unsupported future scope dimensions on covered product-backed paths, and Shopify publication-target catalog scope enforcement. It is not yet enterprise-complete across full admin-boundary mapping, persistent multi-role authorization, ownership-scoped roles, full API-client resources, or universal response redaction.

## 2026-04-28 PO Checkpoint: Governance Barrier Removal

Decision: **Accepted for the bounded governance follow-up.**

Accepted in this follow-up:

- the remaining access-policy stream now has a real unlocked story record in `docs/execution/INCREMENT_STATE.json`
- the checked-in PO execution prompt no longer defaults to another narrow admin-boundary route slice when ownership and object-scope enforcement are the true critical path
- the security rules that must stay in place were preserved:
  - fail-closed behavior on ambiguous ownership or scope
  - no human-role fallback for API clients
  - `category_manager` and `vendor` remain blocked until proof exists

Still not accepted as complete:

- this removes a process barrier, not a code-level authorization blocker
- ownership and object-scope enforcement are still not implemented end to end
- broader machine-principal scope coverage, persistent multi-role storage, and shared redaction remain incomplete
- `category_manager` remains blocked because category/object ownership enforcement is still not proven end to end
- `vendor` remains blocked because vendor/object-scope enforcement is still not proven end to end

Updated claim wording:

> Vexa PIM now has bounded live admin-boundary enforcement on representative governance routes plus broader billing, dashboard, metrics, audit, outbound-webhook, connector-permission, compliance-rule, marketplace export-governance, and taxonomy product-governance routes, authenticated-read classification, covered catalog API-client scope enforcement, fail-closed handling for unsupported future scope dimensions on covered product-backed paths, and Shopify publication-target catalog scope enforcement. It is not yet enterprise-complete across full admin-boundary mapping, persistent multi-role authorization, ownership-scoped roles, full API-client resources, or universal response redaction.

## 2026-04-28 PO Checkpoint: Remaining Connector and Marketplace Admin-Boundary Mapping

Decision: **Conditionally accepted for the bounded connector-and-marketplace governance follow-up.**

Accepted in this follow-up:

- the checked-in pending-blocker PO policy now explicitly continues the admin-boundary backlog with remaining connector-governance and marketplace-governance routes
- marketplace mapping archive governance now enforces `manage_product_data`
- connector installation record deletion now enforces `manage_security`
- `product_admin` is now proven allowed on marketplace mapping archive governance
- `system_admin` is now proven denied on marketplace mapping archive governance
- `product_admin` is now proven denied on connector installation record deletion
- `system_admin` is now proven allowed on connector installation record deletion

Still not accepted as complete:

- this is still not full admin-boundary mapping across every remaining settings, connector governance, operational governance, and marketplace governance route
- the rollout still depends on the current local-auth and JWT bridge rather than persistent multi-role storage
- broader machine-principal resource coverage, ownership-scope enforcement, and universal shared redaction remain incomplete
- `category_manager` remains blocked because category/object ownership enforcement is still not proven end to end
- `vendor` remains blocked because vendor/object-scope enforcement is still not proven end to end

Updated claim wording:

> Vexa PIM now has bounded live admin-boundary enforcement on representative governance routes plus broader billing, dashboard, metrics, audit, outbound-webhook, connector-permission, compliance-rule, and marketplace export-governance routes, authenticated-read classification, covered catalog API-client scope enforcement, fail-closed handling for unsupported future scope dimensions on covered product-backed paths, and Shopify publication-target catalog scope enforcement. It is not yet enterprise-complete across full admin-boundary mapping, persistent multi-role authorization, ownership-scoped roles, full API-client resources, or universal response redaction.
