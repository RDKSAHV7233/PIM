# Vexa PIM Access Policy Execution Record - 2026-04-26

Baseline:
- [Access Policy PO Execution Plan - 2026-04-25](./ACCESS_POLICY_PO_EXECUTION_PLAN_2026-04-25.md)
- [Access Policy PO Checkpoint - 2026-04-26](./ACCESS_POLICY_PO_CHECKPOINT_2026-04-26.md)
- [Enterprise Delegated-Access Report - 2026-04-25](./VEXA_PIM_ENTERPRISE_DELEGATED_ACCESS_REPORT_2026-04-25.md)

## Scope

This execution record covers the current bounded access-policy release slice:

- standard npm entrypoints for access-policy validation
- governance-suite inclusion
- GitHub PR CI inclusion
- formal increment and sprint gate inclusion
- local gate execution proof for the current branch
- live staging smoke validation for deployed admin and selected non-admin paths
- live rollout snapshot capture against the deployed staging API
- GitHub deploy-backed staging signoff and artifact validation

This record does not claim that the full multi-release access-policy roadmap is complete.

## What Changed In This Slice

The prior execution plan and delegated-access report already established backend enforcement for:

- stale JWT rejection after later deactivate or lock
- workflow content locking
- restricted field and payload protection
- supported delegated-access scopes
- sanitized denial auditing

This slice adds delivery-governance execution proof that those protections are now part of the normal repo validation surface:

- [package.json](../../package.json) exposes:
  - `test:integration:access-policy-remediation`
  - `test:integration:delegated-access-scopes`
  - `gate:run:increment`
  - `gate:run:sprint`
- [run-product-suite.cjs](../../scripts/run-product-suite.cjs) includes the new access-policy suites in the `governance` suite
- [.github/workflows/ci.yml](../../.github/workflows/ci.yml) runs the critical access-policy hardening and delegated-access scope tests in PR CI
- [run-increment-gates.cjs](../../scripts/run-increment-gates.cjs) includes the access-policy authz suites
- [run-sprint-gates.cjs](../../scripts/run-sprint-gates.cjs) includes the same authz suites for sprint gate coverage
- [gates README](./gates/README.md) documents the expanded increment gate runner
- [.github/workflows/deploy-staging.yml](../../.github/workflows/deploy-staging.yml) now enables `STAGING_VALIDATE_NON_ADMIN=true` for the staging post-deploy verification step
- [validate-deploy-staging-workflow.cjs](../../scripts/validate-deploy-staging-workflow.cjs) now enforces that the deploy workflow keeps the non-admin access-policy smoke enabled
- [staging-postdeploy-check.cjs](../../scripts/staging-postdeploy-check.cjs) now supports opt-in non-admin staging validation for viewer, reviewer, and editor denial paths plus stale-token rejection after later lock/deactivate
- [staging-fetch-via-curl.cjs](../../scripts/staging-fetch-via-curl.cjs) now preserves multi-cookie responses so Railway web-session proofs work through the local DNS override path
- live staging smoke validation is now proven at the deployed app layer for both admin smoke behavior and selected non-admin denial paths using the supplied staging API base, smoke credentials, and a DNS override workaround for this machine
- GitHub deploy-backed evidence now proves the enhanced staging smoke path on commit `6f4f7d4`, with CI and Deploy Staging both passing and the uploaded gate artifacts validating successfully

## Commands Executed

### Focused Validation

- `npm run build --workspace @pim1/api`
- `npm run build --workspace @pim1/web`
- `node apps/api/test/integration/access-policy-remediation.test.cjs`
- `node apps/api/test/integration/delegated-access-scopes.test.cjs`
- `node apps/api/test/integration/auth-revocation.test.cjs`
- `node apps/api/test/integration/product-workflow-transitions.test.cjs`
- `node apps/api/test/integration/workspace-user-crud.test.cjs`
- `node apps/web/test/integration/admin-users-route-contract.test.cjs`
- `node apps/web/test/integration/connector-install-form.test.cjs`
- `npm run test:integration:access-policy-remediation`
- `npm run test:integration:delegated-access-scopes`

### Gate Validation

- `npm run guard:unsafe-raw`
- `npm run gate:run:increment`
- `npm run gate:run:sprint`
- `node scripts/validate-deploy-staging-workflow.cjs`
- `$env:APP_ENV='staging'; npm run gate:signoff -- --suite ACCESS-POLICY-LOCAL-GATE-SIGNOFF --tenantId SMOKE_TENANT_LOCAL --runUrl local://pim1/access-policy-local-gate-signoff-2026-04-26`
- `$env:APP_ENV='staging'; npm run rollout:snapshot -- --environment staging --tenantId SMOKE_TENANT_LOCAL`
- `$env:APP_ENV='staging'; npm run gate:signoff -- --suite ACCESS-POLICY-STAGING-SMOKE-LOCAL --tenantId default --runUrl local://pim1/access-policy-staging-smoke-2026-04-26`

### Live Staging Smoke Validation

- `node scripts/staging-postdeploy-check.test.cjs`
- `Resolve-DnsName api-staging-490e.up.railway.app -Server 1.1.1.1`
- `Resolve-DnsName pim1-staging.up.railway.app -Server 1.1.1.1`
- `curl --resolve <staging-host>:443:151.101.2.15 https://api-staging-490e.up.railway.app/api/v1/health`
- staging API smoke sequence using supplied workspace/user credentials:
  - health
  - legacy-header rejection
  - login
  - billing usage
  - installed connectors
  - admin audit-log access
  - logout
  - revoked-token replay
- staging web smoke sequence using supplied workspace/user credentials:
  - web login
  - `/channels` admin CTA render
  - `/admin/connectors` admin governance form render
- enhanced live staging smoke via `node -r ./scripts/staging-fetch-via-curl.cjs scripts/staging-postdeploy-check.cjs` with:
  - `STAGING_VALIDATE_NON_ADMIN=true`
  - temporary viewer, reviewer, and editor creation
  - viewer/reviewer/editor audit-log denial checks
  - viewer denial on admin workspace-users route
  - viewer stale-token rejection after later lock
  - viewer stale-token rejection and login denial after later deactivation
- `$env:APP_ENV='staging'; npm run gate:signoff -- --suite ACCESS-POLICY-STAGING-NONADMIN-SMOKE-LOCAL --tenantId default --runUrl local://pim1/access-policy-staging-nonadmin-smoke-2026-04-26`
- `$env:APP_ENV='staging'; $env:STAGING_RESOLVE_IP='151.101.2.15'; node -r ./scripts/staging-fetch-via-curl.cjs scripts/capture-controlled-rollout-snapshot.cjs --environment staging --tenantId default --apiBase https://api-staging-490e.up.railway.app/api/v1`

### GitHub Deploy-Backed Evidence

- `gh run view 24964166068 --json databaseId,status,conclusion,name,event,headSha,displayTitle,url,createdAt,updatedAt`
- `gh run view 24964166066 --json databaseId,status,conclusion,name,event,headSha,displayTitle,url,createdAt,updatedAt`
- `gh run download 24964166066 --name "staging-gate-artifacts-24964166066" --dir ".tmp/staging-artifacts/24964166066"`
- `node scripts/validate-live-staging-evidence.cjs --artifactDir ".tmp/staging-artifacts/24964166066" --environment staging --tenantId default`

## Results

| Area | Command | Result | Notes |
|---|---|---|---|
| API build | `npm run build --workspace @pim1/api` | Passed | Backend compiled successfully |
| Web build | `npm run build --workspace @pim1/web` | Passed | Frontend compiled successfully |
| Access-policy remediation | `node apps/api/test/integration/access-policy-remediation.test.cjs` | Passed | Restricted writes, payload restrictions, denial auditing |
| Delegated-access scopes | `node apps/api/test/integration/delegated-access-scopes.test.cjs` | Passed | Category, brand, channel, connector-account enforcement |
| JWT revoke/logout | `node apps/api/test/integration/auth-revocation.test.cjs` | Passed | Existing revocation behavior preserved |
| Lock/deactivate stale-token protection | `node apps/api/test/integration/workspace-user-crud.test.cjs` | Passed | Later lock/deactivate rejects stale JWT |
| Workflow locking | `node apps/api/test/integration/product-workflow-transitions.test.cjs` | Passed | Approved/archived content lock preserved |
| Admin users route contract | `node apps/web/test/integration/admin-users-route-contract.test.cjs` | Passed | Admin scope-management UI remains aligned |
| Connector install form | `node apps/web/test/integration/connector-install-form.test.cjs` | Passed | Connector setup contract preserved |
| Standard npm entrypoint | `npm run test:integration:access-policy-remediation` | Passed | Script wiring validated |
| Standard npm entrypoint | `npm run test:integration:delegated-access-scopes` | Passed | Script wiring validated |
| Unsafe raw guard | `npm run guard:unsafe-raw` | Passed | Required RLS bypass annotation coverage restored |
| Formal increment gate | `npm run gate:run:increment` | Passed | Includes workflow, session, access-policy, and delegated-access authz checks |
| Formal sprint gate | `npm run gate:run:sprint` | Passed | Sprint gate also carries the authz suites |
| Staging deploy workflow guard | `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Confirms deploy workflow now enables `STAGING_VALIDATE_NON_ADMIN=true` in post-deploy verification |
| Local staging-format signoff | `$env:APP_ENV='staging'; npm run gate:signoff -- --suite ACCESS-POLICY-LOCAL-GATE-SIGNOFF --tenantId SMOKE_TENANT_LOCAL --runUrl local://pim1/access-policy-local-gate-signoff-2026-04-26` | Passed | Wrote local gate artifact [ACCESS-POLICY-LOCAL-GATE-SIGNOFF](./gates/2026-04-25T20-37-52.893Z_ACCESS-POLICY-LOCAL-GATE-SIGNOFF.json) |
| Controlled rollout snapshot | `$env:APP_ENV='staging'; npm run rollout:snapshot -- --environment staging --tenantId SMOKE_TENANT_LOCAL` | Passed | Wrote [2026-04-25T20-43-15.911Z_CONTROLLED_ROLLOUT_SNAPSHOT.json](./rollout/2026-04-25T20-43-15.911Z_CONTROLLED_ROLLOUT_SNAPSHOT.json) |
| Live staging API health | `curl --resolve <staging-host>:443:151.101.2.15 https://api-staging-490e.up.railway.app/api/v1/health` | Passed | Returned `status: ok`, `env: staging`, `queueRuntime.backend: bullmq`, `workerEnabled: true` |
| Live legacy-header probe | staging API GET with forged `x-pim-role` / `x-pim-tenant` | Passed | Returned `403` and confirmed legacy headers are disabled |
| Live staging login | staging API POST `/auth/login` with supplied smoke credentials | Passed | Returned `role: admin`, `tenantId: default`, and access token |
| Live authenticated admin reads | billing usage, installed connectors, audit logs | Passed | Admin token worked on deployed staging API |
| Live token revocation | logout followed by billing usage replay | Passed | Replay returned `TOKEN_REVOKED` |
| Live staging web login | staging web POST `/api/auth/login` with supplied smoke credentials | Passed | Returned admin session payload |
| Live staging web admin render | `/channels` and `/admin/connectors` | Passed | Admin CTA and governance form rendered; read-only fallback strings absent |
| Staging smoke signoff artifact | `$env:APP_ENV='staging'; npm run gate:signoff -- --suite ACCESS-POLICY-STAGING-SMOKE-LOCAL --tenantId default --runUrl local://pim1/access-policy-staging-smoke-2026-04-26` | Passed | Wrote [ACCESS-POLICY-STAGING-SMOKE-LOCAL](./gates/2026-04-25T20-56-40.969Z_ACCESS-POLICY-STAGING-SMOKE-LOCAL.json) |
| Staging smoke regression harness | `node scripts/staging-postdeploy-check.test.cjs` | Passed | New opt-in non-admin path is covered by the checked-in script harness |
| Live non-admin access-policy smoke | enhanced staging smoke with `STAGING_VALIDATE_NON_ADMIN=true` | Passed | Viewer/reviewer/editor denied audit logs; viewer denied admin workspace-users; stale viewer JWT rejected after later lock and deactivation |
| Non-admin staging smoke signoff artifact | `$env:APP_ENV='staging'; npm run gate:signoff -- --suite ACCESS-POLICY-STAGING-NONADMIN-SMOKE-LOCAL --tenantId default --runUrl local://pim1/access-policy-staging-nonadmin-smoke-2026-04-26` | Passed | Wrote [ACCESS-POLICY-STAGING-NONADMIN-SMOKE-LOCAL](./gates/2026-04-26T01-29-30.857Z_ACCESS-POLICY-STAGING-NONADMIN-SMOKE-LOCAL.json) |
| Live rollout snapshot | `$env:APP_ENV='staging'; $env:STAGING_RESOLVE_IP='151.101.2.15'; node -r ./scripts/staging-fetch-via-curl.cjs scripts/capture-controlled-rollout-snapshot.cjs --environment staging --tenantId default --apiBase https://api-staging-490e.up.railway.app/api/v1` | Passed | Wrote [2026-04-25T21-17-37.433Z_CONTROLLED_ROLLOUT_SNAPSHOT.json](./rollout/2026-04-25T21-17-37.433Z_CONTROLLED_ROLLOUT_SNAPSHOT.json) with `health.ok=true`, `controlledPending=[]`, `broadPending=[]` |
| GitHub CI | [Run 24964166068](https://github.com/RDKSAHV7233/PIM1/actions/runs/24964166068) | Passed | Commit `6f4f7d4`; critical access-policy staging-smoke changes passed CI |
| GitHub Deploy Staging | [Run 24964166066](https://github.com/RDKSAHV7233/PIM1/actions/runs/24964166066) | Passed | Deployed commit `6f4f7d4`; staging post-deploy verification ran with `STAGING_VALIDATE_NON_ADMIN=true` |
| Deploy-backed evidence validation | `node scripts/validate-live-staging-evidence.cjs --artifactDir ".tmp/staging-artifacts/24964166066" --environment staging --tenantId default` | Passed | Validated `2026-04-26T18-50-10.965Z_STAGING_DEPLOY_POSTCHECK.json` and `2026-04-26T18-50-11.013Z_CONTROLLED_ROLLOUT_SNAPSHOT.json` from the GitHub artifact bundle |

## Gate Notes

- The increment gate and sprint gate now both validate the current access-policy slice through standard repo commands instead of ad hoc one-off test execution.
- A local regression in [rejection-notification.test.cjs](../../apps/api/test/integration/rejection-notification.test.cjs) was repaired during this slice so the expanded increment gate could pass under the current workspace-login contract.
- The raw SQL governance guard also required a missing RLS comment in [connector-webhook-ingestion.service.ts](../../apps/api/src/connector-framework/connector-webhook-ingestion.service.ts) before the increment gate could pass cleanly.
- The rollout snapshot now consumes the local signoff artifact and current recorded evidence successfully.
- The staging smoke runner itself is now stronger: it can validate selected non-admin denial paths on the deployed app instead of stopping at the admin happy path.
- The staging deploy workflow now carries that enhanced smoke path by default through `STAGING_VALIDATE_NON_ADMIN=true`, and the workflow validator protects that setting.
- Real staging API and web smoke validation now succeeded using the supplied credentials, including viewer/reviewer/editor denial-path coverage and stale-token rejection after later lock/deactivate.
- A live rollout snapshot against the deployed staging API now reports `health.ok=true`, `controlledPending=[]`, and `broadPending=[]`.
- GitHub Deploy Staging run [24964166066](https://github.com/RDKSAHV7233/PIM1/actions/runs/24964166066) now provides deploy-backed provenance for the same evidence path, and the downloaded artifact bundle passed `validate-live-staging-evidence.cjs`.
- This machine's default DNS resolver still refuses Railway hostnames, so live staging checks and the live rollout snapshot were executed with externally resolved IPs and the curl-based DNS shim rather than direct hostname resolution.

## Sign-off Position

Current execution verdict:

- access-policy hardening remains validated
- supported delegated-access enforcement remains validated
- PR CI now enforces the critical access-policy suites
- formal increment and sprint gate runners now enforce the same authz suites locally
- deploy-backed staging verification is configured to run the enhanced non-admin access-policy smoke on future staging deploy runs
- deploy-backed staging verification has now passed on GitHub Deploy Staging run [24964166066](https://github.com/RDKSAHV7233/PIM1/actions/runs/24964166066)
- live staging smoke now validates the deployed app for health, legacy-header rejection, login, revoked-token handling, admin API reads, admin web governance rendering, selected non-admin denial paths, and stale-token rejection after later lock/deactivate
- live rollout evidence for this slice now includes a clean deployed staging snapshot with no controlled or broad pending blockers

This branch is therefore stronger than a documentation-only remediation claim because the supported protections are:

- implemented in backend code
- covered by focused integration tests
- reachable through standard npm commands
- included in governance runs
- included in PR CI
- included in local gate runners
- validated against the live deployed staging app for the bounded access-policy slice
- validated through a GitHub deploy-backed staging artifact bundle

## Limits Of This Record

This record does not claim:

- full enterprise delegated-access support across unsupported scopes
- universal read-time field redaction
- full deny-by-default replacement for all authenticated `GET` paths
- final role-maturity completion

A local staging-format signoff artifact was created in this slice:

- [2026-04-25T20-37-52.893Z_ACCESS-POLICY-LOCAL-GATE-SIGNOFF.json](./gates/2026-04-25T20-37-52.893Z_ACCESS-POLICY-LOCAL-GATE-SIGNOFF.json)
- [2026-04-25T20-43-15.911Z_CONTROLLED_ROLLOUT_SNAPSHOT.json](./rollout/2026-04-25T20-43-15.911Z_CONTROLLED_ROLLOUT_SNAPSHOT.json)
- [2026-04-25T20-56-40.969Z_ACCESS-POLICY-STAGING-SMOKE-LOCAL.json](./gates/2026-04-25T20-56-40.969Z_ACCESS-POLICY-STAGING-SMOKE-LOCAL.json)
- [2026-04-26T01-29-30.857Z_ACCESS-POLICY-STAGING-NONADMIN-SMOKE-LOCAL.json](./gates/2026-04-26T01-29-30.857Z_ACCESS-POLICY-STAGING-NONADMIN-SMOKE-LOCAL.json)
- [2026-04-25T21-17-37.433Z_CONTROLLED_ROLLOUT_SNAPSHOT.json](./rollout/2026-04-25T21-17-37.433Z_CONTROLLED_ROLLOUT_SNAPSHOT.json)

GitHub deploy-backed staging evidence is now also available:

- [Deploy Staging run 24964166066](https://github.com/RDKSAHV7233/PIM1/actions/runs/24964166066)
- `2026-04-26T18-50-10.965Z_STAGING_DEPLOY_POSTCHECK.json`
- `2026-04-26T18-50-11.013Z_CONTROLLED_ROLLOUT_SNAPSHOT.json`

Those deploy artifacts were downloaded from GitHub and validated locally with [validate-live-staging-evidence.cjs](../../scripts/validate-live-staging-evidence.cjs).

## Next Execution Step

The next useful bounded step is backlog execution for the remaining enterprise-readiness gaps: broader sensitive `GET` deny-by-default migration, universal read-time field redaction, unsupported scope dimensions, and role-maturity migration. Do not expand roles before the policy, scope, and migration prerequisites are validated.

## 2026-04-27 Bounded Follow-Up: Sensitive Reads And Shadow-Mode Gate Wiring

Scope:

- broadened sensitive read protection for connector submission metadata by requiring `admin` or `editor` on the submissions controller
- added an `AccessPolicyService.can(actor, action, resource, context)` shadow-mode decision API with stable reason codes and sanitized mismatch audit metadata
- wired RBAC shadow evaluation behind `PIM_ACCESS_POLICY_SHADOW_MODE` while keeping legacy RBAC authoritative
- added a sensitive-GET policy guard and included it in increment and sprint gates
- added access-policy remediation and delegated-access scope suites to both formal gate runners
- fixed gate harness drift in `rejection-notification.test.cjs` by using workspace-scoped login setup
- added the required RLS-bypass governance comment for the webhook submission lookup raw SQL call

Files changed in this follow-up:

- `apps/api/src/app.module.ts`
- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/src/common/rbac/rbac.guard.ts`
- `apps/api/src/connector-framework/connector-webhook-ingestion.service.ts`
- `apps/api/src/marketplace/submissions.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `apps/api/test/integration/rejection-notification.test.cjs`
- `package.json`
- `scripts/run-increment-gates.cjs`
- `scripts/run-sprint-gates.cjs`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run guard:sensitive-gets` | Passed | 23 sensitive read routes checked for explicit role protection |
| `npm run build --workspace @pim1/api` | Passed | API compiled with access-policy module wired into the app |
| `npm run test:integration:access-policy-remediation` | Passed | Includes sensitive submission read denial, shadow parity, and sanitized denial audit checks |
| `npm run test:integration:delegated-access-scopes` | Passed | Supported category, brand, channel, and connector-account scopes still pass |
| `npm run build --workspace @pim1/web` | Passed | Web build remains healthy |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Staging workflow still enforces non-admin access-policy smoke |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Staging smoke harness still covers workspace login, revocation, admin render, and non-admin denials |
| `npm run test:integration:rejection-notification` | Failed, then passed | Initial failure was workspace-scoped login harness drift: `WORKSPACE_NOT_FOUND`, then `INVALID_CREDENTIALS`; fixed by adding temporary workspace mapping and test password env |
| `npm run guard:unsafe-raw` | Failed, then passed | Initial failure at `apps/api/src/connector-framework/connector-webhook-ingestion.service.ts:200`; fixed with required manual tenant-filter comment |
| `npm run gate:run:increment` | Failed twice, then passed | Final pass includes access-policy remediation, delegated-access scopes, and sensitive-GET guard; 16 steps passed |
| `npm run gate:run:sprint` | Passed | Sprint runner now uses `scripts/run-sprint-gates.cjs` and includes access-policy suites; 14 steps passed |

PO/CTO validation:

- accepted for the current bounded slice: broader sensitive submission read protection, shadow-mode foundation under legacy RBAC authority, explicit gate coverage for sensitive GET annotations, and continued proof for supported delegated scopes
- not accepted as complete: universal read-time redaction, unsupported scopes such as vendor/owner and locale, API-client principal separation, multi-role migration, product-admin boundary validation, or final role maturity
- product claim wording remains: Vexa PIM has verified access-policy hardening and supported delegated-access enforcement for selected scope dimensions, but it does not yet have a complete enterprise authorization model across all scope, field-redaction, API-client, and role-maturity requirements

Rollback notes:

- disable `PIM_ACCESS_POLICY_SHADOW_MODE` if shadow mismatch audit volume becomes noisy; legacy RBAC remains authoritative
- if legitimate editor submission reads are blocked unexpectedly, revert only the submissions controller role annotation and keep the sensitive-GET guard for the remaining routes
- keep monitoring denial audit volume and storage impact before expanding deny-by-default reads further

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this is continuing an access-policy backlog slice without a matching unlocked story record in the increment state file

## 2026-04-27 Bounded Follow-Up: Catalog Read Redaction And Legacy Alias Scope Enforcement

Scope:

- added central catalog read redaction for sensitive product and variant fields on unauthorized reads
- preserved admin and editor visibility for sensitive catalog fields
- propagated authenticated actor context through the legacy `/products` API alias so delegated scope checks and read redaction are no longer bypassed there
- added focused regression coverage for redacted catalog reads and for legacy alias scope enforcement

Files changed in this follow-up:

- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/src/catalog/catalog.service.ts`
- `apps/api/src/catalog/products.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `apps/api/test/integration/delegated-access-scopes.test.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with catalog redaction and legacy alias actor propagation |
| `npm run test:integration:access-policy-remediation` | Passed | Viewer catalog reads redact pricing and inventory; legacy `/products/:id` alias uses actor-aware redaction |
| `npm run test:integration:delegated-access-scopes` | Passed | Legacy `/products/:id` alias now respects category-and-brand scope intersection |
| `npm run gate:run:increment` | Passed | Increment gate stayed green after the catalog read-path changes |

PO/CTO validation:

- accepted for the current bounded slice: central catalog read redaction for pricing and inventory fields on unauthorized reads, plus closure of the legacy alias bypass for delegated scope enforcement
- not accepted as complete: universal read-time redaction outside the covered catalog product and variant paths, unsupported scope dimensions, API-client principal separation, multi-role migration, and role-boundary maturity

Rollback notes:

- revert only the catalog redaction and legacy alias actor propagation if reviewer or viewer product read surfaces prove to need additional disclosed fields
- keep the focused remediation and delegated-scope tests as the acceptance gate for any future adjustment to reviewer and viewer catalog visibility

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-30 Consolidation: Parallel Access-Policy Lanes Merged

Scope:

- consolidated the currently validated access-policy lanes into one checked full-validation pass
- verified there were no unresolved textual merge conflicts in `apps/api`, `docs`, `packages`, or `scripts`
- kept the current merged lane state intact and updated execution evidence once rather than reopening individual slices

Merged lanes in this consolidation pass:

- bounded vendor/object ownership enforcement on proven product-backed reads
- bounded API-client scope vocabulary on covered catalog, media, compliance, rejection-intelligence, auto-suggestions, and taxonomy families
- shared governance redaction on covered governance reads and audit explorer/export outputs
- bounded admin-boundary enforcement on the covered governance route families
- additive persisted multi-role read-path, bounded rollout runbook semantics, and bounded workspace-user managed-write semantics

Conflict resolution:

- no textual conflict markers were present
- no code-level merge rollback was required
- one runtime seam was explicitly kept safe in the merged state: workspace-user role updates now preserve omitted `assignedRoles` only when the preserved set stays compatible with the next scalar role, so old admin-boundary assignments cannot silently ride through a scalar-role downgrade

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled successfully on the merged lane state |
| `npm run test:integration:access-policy-remediation` | Passed | Full remediation suite stayed green on the merged lane state |
| `npm run test:integration:delegated-access-scopes` | Passed | Full delegated-scope suite stayed green on the merged lane state |
| `npm run guard:sensitive-gets` | Passed | Merged coverage now reports `authenticatedReadRoutes=71`, `adminBoundaryCheckedRoutes=49`, and `allowed_with_api_scope=29` |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Foundation invariants stayed green |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Notification authz and redaction stayed green |
| `npm run build --workspace @pim1/web` | Passed | Web build stayed healthy on the merged lane state |
| `npm run gate:run:increment` | Passed | Increment gate passed with `INCREMENT_CORE_GATES totalSteps=16` |
| `npm run gate:run:sprint` | Failed once, then passed | First run hit the known transient Next export cleanup wobble: `ENOTEMPTY ... apps\\web\\.next\\export`; sequential rerun passed without source changes |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Staging deploy workflow contract stayed green |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Staging postdeploy checks stayed green |
| `git diff --check` | Passed | Only existing CRLF warnings remained |
| touched-file secret scan with `rg` | Passed with expected local/test-only matches | No real credentials introduced |

PO/CTO validation:

- accepted for the consolidation pass: the validated access-policy lanes now coexist as one green merged state with one updated evidence point instead of separate unverified branches of truth
- not accepted as complete: this consolidation does not expand the authorization surface beyond what each bounded slice already proved
- product claim wording remains: Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement plus bounded `media.read`, `compliance.read`, `rejection_intelligence.read`, `auto_suggestions.read`, and `taxonomy.read` API-client scope families for their matching read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes including marketplace readiness-and-preflight governance and billing plan-tier governance, shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, outbound-webhook delivery, audit-log, billing-governance, and audit-explorer/export reads with a shared JSON and CSV visibility contract, additive persisted multi-role read-path support on `AuthIdentity.assigned_roles` with scalar-role fallback preserved, durable local-auth and DB-auth compatibility proof for normalized assigned roles, explicit governance-boundary durability proof for persisted `system_admin` versus `product_admin` assigned roles, bounded operator-safe backfill, fallback, rollback, and managed role-set semantics for persisted assigned roles, and bounded workspace-user managed-write rules for assigned roles. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, durable multi-role rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

Lock update:

- no `INCREMENT_STATE.json` story was updated in this consolidation pass because `ST-ACCESS-POLICY-BACKLOG-001` still represents an in-progress backlog stream rather than an accepted final completion

## 2026-04-30 Bounded Follow-Up: Workspace-User Managed Assigned-Role Semantics

Scope:

- tightened workspace-user create and role-update flows so managed `assignedRoles` follow one bounded write contract
- preserved scalar-role fallback, explicit clear semantics, and legacy read compatibility for already-persisted rows
- kept the changes inside the workspace-user management path rather than widening runtime auth or policy evaluation
- updated execution docs and checkpoint from the passing integration evidence

Files changed in this follow-up:

- `apps/api/src/workspace-users/workspace-users.service.ts`
- `apps/api/test/integration/workspace-user-crud.test.cjs`
- `docs/execution/ACCESS_POLICY_EXECUTION_RECORD_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PO_CHECKPOINT_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`

Bounded managed-write contract:

- workspace-user create and update accept at most one managed assigned role
- supported managed assigned roles are:
  - `reviewer`
  - `editor`
  - `product_admin`
  - `system_admin`
- `product_admin` and `system_admin` require scalar `role = admin`
- unsupported managed-write roles such as `super_admin`, `category_manager`, and `vendor` are rejected
- duplicates remain rejected
- `assignedRoles: []` still clears the persisted role set
- omitting `assignedRoles` on update still preserves the existing role set only when that preserved set remains compatible with the next scalar role

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with the bounded workspace-user role-set contract |
| `node apps/api/test/integration/workspace-user-crud.test.cjs` | Failed once, then passed | First run collided with the known shared `apps/api/dist` artifact race and could not resolve `../billing/plan-usage.service` from `apps/api/dist/auth/auth.service.js`; sequential rerun passed without source changes |
| `node apps/api/test/integration/auth-assigned-roles-read-path.test.cjs` | Failed once, then passed | Initial run hit the same shared `dist` race; sequential rerun proved DB-auth compatibility remained green |
| `node apps/api/test/integration/auth-local-assigned-roles-bridge.test.cjs` | Failed once, then passed | Initial run hit the same shared `dist` race; sequential rerun proved local-auth compatibility remained green |
| `npm run test:integration:access-policy-remediation` | Passed | Broader access-policy remediation remained green after the managed-write contract change |
| `npm run test:integration:delegated-access-scopes` | Passed | Delegated-scope suite remained green |
| `npm run guard:sensitive-gets` | Passed | Sensitive GET guard coverage stayed unchanged |

PO/CTO validation:

- accepted for the current bounded slice: workspace-user managed assigned-role semantics are now explicit and tested
- accepted proofs now include:
  - bounded single-role managed writes
  - unsupported managed-write roles rejected
  - admin-boundary assigned roles require scalar admin
  - `system_admin` can be managed and read back through workspace-user flows
  - omitted `assignedRoles` preserves compatible role sets but rejects incompatible scalar-role downgrades
  - explicit clear behavior still removes the persisted role set and falls back safely to scalar-only compatibility
- not accepted as complete: this is still not broader multi-role policy completion, not allowed-combination completion across the whole product, and not scalar-role removal
- product claim wording remains: Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement plus bounded `media.read`, `compliance.read`, `rejection_intelligence.read`, `auto_suggestions.read`, and `taxonomy.read` API-client scope families for their matching read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes including marketplace readiness-and-preflight governance and billing plan-tier governance, shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, outbound-webhook delivery, audit-log, billing-governance, and audit-explorer/export reads with a shared JSON and CSV visibility contract, additive persisted multi-role read-path support on `AuthIdentity.assigned_roles` with scalar-role fallback preserved, durable local-auth and DB-auth compatibility proof for normalized assigned roles, explicit governance-boundary durability proof for persisted `system_admin` versus `product_admin` assigned roles, bounded operator-safe backfill, fallback, rollback, and managed role-set semantics for persisted assigned roles, and bounded workspace-user managed-write rules for assigned roles. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, durable multi-role rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

Rollback notes:

- revert only the workspace-user managed-write contract if a proven legitimate admin workflow depends on multi-value or unsupported assigned-role sets
- keep the read-path compatibility proofs and explicit clear behavior unless a later validated rollout replaces them with equivalent or stronger evidence

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-29 Bounded Follow-Up: AuthIdentity Assigned-Roles Rollout Runbook and Proof

Scope:

- added an operator-safe rollout script at `scripts/auth-identity-assigned-roles-rollout.cjs`
- added a checked-in runbook at [docs/runbooks/auth-identity-assigned-roles-rollout.md](../runbooks/auth-identity-assigned-roles-rollout.md)
- added a dist-backed integration harness at `apps/api/test/integration/auth-assigned-roles-rollout-runbook.test.cjs`
- kept scalar `role` as the compatibility field and did not widen runtime authorization behavior
- proved additive backfill, dry-run reporting, and rollback-safe compatibility without destructive migration

Files changed in this follow-up:

- `scripts/auth-identity-assigned-roles-rollout.cjs`
- `apps/api/test/integration/auth-assigned-roles-rollout-runbook.test.cjs`
- `docs/runbooks/auth-identity-assigned-roles-rollout.md`
- `docs/execution/ACCESS_POLICY_EXECUTION_RECORD_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PO_CHECKPOINT_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`

Bounded rollout contract:

- backfill only touches `AuthIdentity` rows whose `assigned_roles` is `NULL` or `[]`
- backfill only writes normalized scalar app-role singletons:
  - `viewer` -> `["viewer"]`
  - `reviewer` -> `["reviewer"]`
  - `editor` -> `["editor"]`
  - `admin` -> `["admin"]`
- invalid scalar roles are skipped, not guessed
- pre-existing non-empty `assigned_roles` rows are preserved
- rollback only clears rows whose `assigned_roles` exactly equals the scalar singleton that this rollout would have written
- rollback does not clear true multi-role rows

Observed dry-run evidence from the checked-in operator script:

- `node scripts/auth-identity-assigned-roles-rollout.cjs --dry-run`
  - `scannedCount: 2313`
  - `eligibleCount: 2274`
  - `invalidScalarRoleCount: 2`
  - `skippedExistingAssignedRolesCount: 37`
  - `updatedCount: 0`
- `node scripts/auth-identity-assigned-roles-rollout.cjs --rollback --dry-run`
  - `scannedCount: 2313`
  - `eligibleCount: 0`
  - `invalidScalarRoleCount: 2`
  - `skippedUnsafeRollbackCount: 2311`
  - `updatedCount: 0`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API build remained green with the operator-only rollout slice |
| `node apps/api/test/integration/auth-assigned-roles-rollout-runbook.test.cjs` | Failed once, then passed | First failure was a real proof mismatch: the tenant bootstrap admin made the eligible backfill count `5`, not `4`. Updated the proof to match the live tenant fixture, then reran successfully |
| `node scripts/auth-identity-assigned-roles-rollout.cjs --dry-run` | Passed | Reported additive all-tenant backfill candidates without mutating rows |
| `node scripts/auth-identity-assigned-roles-rollout.cjs --rollback --dry-run` | Passed | Reported rollback-safe scope without mutating rows |
| `node apps/api/test/integration/auth-assigned-roles-read-path.test.cjs` | Passed | Existing DB-auth assigned-role compatibility proofs remained green |
| `node apps/api/test/integration/auth-local-assigned-roles-bridge.test.cjs` | Passed | Existing local-auth assigned-role compatibility proofs remained green |
| `node apps/api/test/integration/workspace-user-crud.test.cjs` | Passed | Workspace-user managed assigned-role semantics remained green |
| `npm run test:integration:access-policy-remediation` | Passed | Broader access-policy remediation suite stayed green after the rollout script addition |
| `npm run test:integration:delegated-access-scopes` | Passed | Delegated-scope suite stayed green after the rollout script addition |
| `npm run guard:sensitive-gets` | Passed | Sensitive GET coverage stayed unchanged at `authenticatedReadRoutes=71`, `adminBoundaryCheckedRoutes=49` |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Foundation invariants remained green |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Notification authz and redaction behavior remained green |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy; no frontend changes were needed |
| `npm run gate:run:increment` | Passed | Increment gate stayed green with the rollout proof slice |
| `npm run gate:run:sprint` | Failed once, then passed | First failure was the known transient Next build artifact wobble: `ENOENT ... .next\\types\\routes.d.ts`. Sequential rerun passed without source changes |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Staging deploy workflow contract stayed intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Staging postdeploy harness stayed green |
| `git diff --check` | Passed | Only existing CRLF warnings remained |
| touched-file secret scan with `rg` | Passed with expected local/test-only matches | Only local dummy credentials and role-fixture values matched |

PO/CTO validation:

- accepted for the current bounded slice: Vexa PIM now has an operator-safe checked-in runbook and proof harness for additive `assigned_roles` backfill and rollback behavior
- accepted proofs now include:
  - additive backfill only targets `NULL` or empty `assigned_roles`
  - invalid scalar roles are skipped
  - pre-existing true multi-role rows are preserved
  - rollback only clears scalar-singleton rows written by the bounded rollout contract
  - scalar-role fallback still preserves legacy access after rollback
- not accepted as complete: this is still not a full multi-role migration, not live operator execution evidence, not scalar-role removal, and not wider role-set management policy completion
- product claim wording remains: Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement plus bounded `media.read`, `compliance.read`, `rejection_intelligence.read`, `auto_suggestions.read`, and `taxonomy.read` API-client scope families for their matching read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes including marketplace readiness-and-preflight governance and billing plan-tier governance, shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, outbound-webhook delivery, audit-log, billing-governance, and audit-explorer/export reads with a shared JSON and CSV visibility contract, additive persisted multi-role read-path support on `AuthIdentity.assigned_roles` with scalar-role fallback preserved, durable local-auth and DB-auth compatibility proof for normalized assigned roles, explicit governance-boundary durability proof for persisted `system_admin` versus `product_admin` assigned roles, and bounded operator-safe backfill, fallback, rollback, and managed role-set semantics for persisted assigned roles. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, durable multi-role rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

Rollback notes:

- revert only the rollout script, runbook, and dedicated rollout-proof harness if a proven operator-contract regression appears in this bounded multi-role slice
- keep scalar-role fallback and the existing auth compatibility proofs in place unless a later separately validated rollout replaces them with equivalent evidence
- do not treat the transient sprint-gate `.next/types/routes.d.ts` failure as rollback evidence; the sequential rerun passed without source changes

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-29 Bounded Follow-Up: Multi-Role Backfill, Fallback, and Rollback Semantics

Scope:

- hardened the bounded multi-role rollout contract with explicit proof for additive backfill, scalar fallback, rollback-safe compatibility, and managed role-set validation
- expanded the DB-auth assigned-role harness to cover duplicate persisted role arrays and `NULL assigned_roles` fallback behavior
- expanded the local-auth assigned-role harness to cover duplicate local role arrays and `assignedRoles: null` compatibility
- expanded the workspace-user CRUD harness to prove:
  - duplicate assigned-role sets are rejected on managed writes
  - omitted `assignedRoles` still preserves existing values
  - explicit `assignedRoles: []` clears the persisted role set
  - later login after that clear falls back to scalar-only compatibility

Files changed in this follow-up:

- `apps/api/test/integration/auth-assigned-roles-read-path.test.cjs`
- `apps/api/test/integration/auth-local-assigned-roles-bridge.test.cjs`
- `apps/api/test/integration/workspace-user-crud.test.cjs`
- `docs/execution/ACCESS_POLICY_EXECUTION_RECORD_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PO_CHECKPOINT_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API build stayed green; no runtime auth patch was required for this bounded slice |
| `node apps/api/test/integration/auth-assigned-roles-read-path.test.cjs` | Failed once, then passed | First failure was a real proof bug: the raw SQL rollback step used snake_case `AuthIdentity` column names that do not exist. Fixed the test to use `tenantKey` and `userId`, then reran successfully |
| `node apps/api/test/integration/auth-local-assigned-roles-bridge.test.cjs` | Passed | Proved duplicate local role arrays normalize safely and `assignedRoles: null` falls back to scalar-only compatibility |
| `node apps/api/test/integration/workspace-user-crud.test.cjs` | Failed once, then passed | First failure exposed the live DTO contract: duplicate `assignedRoles` are rejected on managed writes. Adjusted the proof to assert rejection instead of silent dedupe, then reran successfully |
| `npm run test:integration:access-policy-remediation` | Passed | Existing access-policy coverage remained green after the multi-role durability proof expansion |
| `npm run test:integration:delegated-access-scopes` | Passed | Existing delegated-scope coverage remained green |
| `npm run guard:sensitive-gets` | Passed | Guardrail counts remained stable: `authenticatedReadRoutes=71`, `authenticatedRoutes=158`, `publicRoutes=19`, `adminBoundaryCheckedRoutes=49` |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Existing policy foundation coverage remained green |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Notifications regression coverage remained green |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy after the backend-test-only slice |
| `npm run gate:run:increment` | Passed | Increment gate remained green |
| `npm run gate:run:sprint` | Passed | Sprint gate remained green |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Staging deploy workflow contract remained green |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Staging postdeploy validation remained green |
| `git diff --check` | Passed | No new patch-format or whitespace errors beyond existing CRLF warnings |
| touched-file secret scan with `rg` | Passed with expected local test-only matches | Only local dummy passwords, JWT secrets, and DB fallback strings matched |

PO/CTO validation:

- accepted for the current bounded slice:
  - additive backfill remains non-destructive because scalar `role` is preserved and empty or missing `assigned_roles` still behave like scalar-only identities
  - duplicate persisted or local assigned-role arrays normalize safely on the auth read path
  - duplicate assigned-role arrays are rejected on managed workspace-user writes
  - explicit `assignedRoles: []` clears the persisted role set and the next login falls back to scalar-only compatibility
  - `NULL assigned_roles` remains rollback-safe for DB-auth and does not escalate privilege
- not accepted as complete:
  - this is still not a backfill-complete or rollback-complete migration
  - scalar `role` removal was not attempted
  - broader workspace-user multi-role management semantics and allowed-combination policy are still not complete
- product claim wording now becomes: Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement plus bounded `media.read`, `compliance.read`, `rejection_intelligence.read`, `auto_suggestions.read`, and `taxonomy.read` API-client scope families for their matching read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes including marketplace readiness-and-preflight governance and billing plan-tier governance, shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, outbound-webhook delivery, audit-log, billing-governance, and audit-explorer/export reads with a shared JSON and CSV visibility contract, additive persisted multi-role read-path support on `AuthIdentity.assigned_roles` with scalar-role fallback preserved, durable local-auth and DB-auth compatibility proof for normalized assigned roles, explicit governance-boundary durability proof for persisted `system_admin` versus `product_admin` assigned roles, and bounded non-destructive backfill, fallback, rollback, and managed role-set semantics for persisted assigned roles. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, durable multi-role rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

Rollback notes:

- revert only the added test proofs if a later product decision intentionally changes the bounded multi-role contract around duplicate-role rejection, explicit clear semantics, or scalar-only rollback compatibility
- keep scalar fallback, null-safe compatibility, and no-escalation proof in place so future multi-role rollout work remains explicit and regression-tested

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching completed story record

## 2026-04-29 Bounded Follow-Up: Assigned-Roles Admin-Boundary Durability Proof

Scope:

- defined and validated one small PO contract for durable multi-role persistence:
  - persisted assigned roles are additive inputs to governance-boundary evaluation
  - scalar `admin` remains the compatibility app-role field
  - normalized assigned roles, not the scalar field alone, decide whether a user crosses `manage_security` boundaries
- proved that contract on both DB-auth and local-auth paths without changing runtime authorization code

Files changed in this follow-up:

- `apps/api/test/integration/auth-assigned-roles-read-path.test.cjs`
- `apps/api/test/integration/auth-local-assigned-roles-bridge.test.cjs`
- `docs/execution/ACCESS_POLICY_EXECUTION_RECORD_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PO_CHECKPOINT_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled cleanly before the proof-only slice |
| `node apps/api/test/integration/auth-assigned-roles-read-path.test.cjs` | Failed, then passed | First parallel run hit the known shared `apps/api/dist` race (`Cannot find module '../billing/plan-usage.service'` from `apps/api/dist/auth/auth.service.js`); sequential rerun passed and proved DB-auth governance-boundary durability |
| `node apps/api/test/integration/auth-local-assigned-roles-bridge.test.cjs` | Failed, then passed | First parallel run hit the same shared `dist` race; sequential rerun passed and proved local-auth governance-boundary durability |
| `npm run test:integration:access-policy-remediation` | Failed, then passed | The first parallel run failed only because `apps/api/dist/main.js` was unavailable during the shared build-artifact race; sequential rerun passed |
| `npm run test:integration:delegated-access-scopes` | Failed, then passed | The first parallel run failed only because `apps/api/dist/main.js` was unavailable during the shared build-artifact race; sequential rerun passed |
| `npm run guard:sensitive-gets` | Passed | Sensitive-GET policy counts stayed unchanged during the proof-only slice |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Foundation suite remained green |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Notifications auth behavior remained green |
| `npm run build --workspace @pim1/web` | Passed | Web build unchanged by the auth-only slice |
| `npm run gate:run:increment` | Passed | `INCREMENT_CORE_GATES totalSteps=16` |
| `npm run gate:run:sprint` | Passed | `SPRINT_CORE_GATES totalSteps=14` |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deployment workflow contract unchanged |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Staging postdeploy checks remained green |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Increment tracking JSON remained valid |
| `git diff --check` | Passed with CRLF warnings only | No patch-format regressions |
| touched-file secret scan with `rg` | Passed with expected test-only matches | Only local dummy tokens/passwords appeared in test fixtures |

PO/CTO validation:

- accepted for the current bounded slice: persisted assigned roles now have explicit durability proof on governance-boundary reads for both DB-auth and local-auth paths; `system_admin` assigned roles survive login and are honored on `manage_security` reads, while `product_admin` assigned roles do not escalate into that boundary
- not accepted as complete: this is still not a full multi-role rollout, not broader role-set management semantics, and not backfill/rollback-complete migration behavior
- product claim wording remains: Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement plus bounded `media.read`, `compliance.read`, `rejection_intelligence.read`, `auto_suggestions.read`, and `taxonomy.read` API-client scope families for their matching read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes including marketplace readiness-and-preflight governance and billing plan-tier governance, shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, outbound-webhook delivery, audit-log, billing-governance, and audit-explorer/export reads with a shared JSON and CSV visibility contract, additive persisted multi-role read-path support on `AuthIdentity.assigned_roles` with scalar-role fallback preserved, durable local-auth and DB-auth compatibility proof for normalized assigned roles, explicit governance-boundary durability proof for persisted `system_admin` versus `product_admin` assigned roles, workspace-user governance read compatibility for normalized persisted assigned roles, and a bounded additive workspace-user write contract whose assigned-role changes are proven durable through later logins and password-reset-confirm auth resolution. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, durable multi-role rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

Rollback notes:

- revert only the added auth durability assertions if a later product decision intentionally narrows how assigned roles participate in governance-boundary reads
- keep the DB-auth and local-auth governance-boundary proofs so future multi-role changes must stay explicit and regression-tested

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-29 Bounded Follow-Up: Durable Assigned-Roles Auth Lifecycle Proof

Scope:

- strengthened the bounded multi-role durability proof without changing the runtime role model
- extended the DB-auth per-user password integration harness so a workspace-user-created identity with scalar `viewer` plus persisted `assignedRoles: ["editor"]` is exercised across:
  - direct login
  - issued step-up token
  - password-reset confirm
- preserved the already-proven additive behavior:
  - scalar `role` remains in the JWT claim as compatibility state
  - normalized `assignedRoles` still drive the later editor-capable route decision
  - invalid or missing assigned roles are still handled by the existing read-path tests

Files changed in this follow-up:

- `apps/api/test/integration/auth-per-user-password.test.cjs`
- `docs/execution/ACCESS_POLICY_EXECUTION_RECORD_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PO_CHECKPOINT_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API build stayed green; the later auth test race was from concurrent `dist` access, not a code regression |
| `node apps/api/test/integration/auth-per-user-password.test.cjs` | Failed, then passed | First run was started in parallel with the API build and hit the known `apps/api/dist` race (`Cannot find module '../billing/plan-usage.service'` from `apps/api/dist/auth/auth.service.js`); sequential rerun passed and proved assigned-role durability through login, step-up, and password-reset confirm |
| `node apps/api/test/integration/auth-assigned-roles-read-path.test.cjs` | Passed | Proved DB-backed `assigned_roles` read path, scalar fallback, invalid-role normalization, and workspace-user governance read compatibility |
| `node apps/api/test/integration/auth-local-assigned-roles-bridge.test.cjs` | Passed | Proved local identity-directory `assignedRoles` bridge, scalar fallback, and no escalation from invalid local roles |
| `node apps/api/test/integration/workspace-user-crud.test.cjs` | Passed | Proved workspace-user assigned-role write durability through later logins plus preserved role-update semantics |
| `npm run test:integration:access-policy-remediation` | Passed | No regression to the broader bounded access-policy rollout |
| `npm run test:integration:delegated-access-scopes` | Passed | No delegated-scope regression from the auth-durability proof slice |
| `npm run guard:sensitive-gets` | Passed | Guard counts stayed stable during the auth-only slice |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Foundation suite remained green |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Notifications auth behavior remained green |
| `npm run build --workspace @pim1/web` | Passed | Web build unchanged by the auth-only slice |
| `npm run gate:run:increment` | Passed | `INCREMENT_CORE_GATES totalSteps=16` |
| `npm run gate:run:sprint` | Passed | `SPRINT_CORE_GATES totalSteps=14` |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deployment workflow contract unchanged |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Staging postdeploy checks remained green |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Increment tracking JSON remained valid |
| `git diff --check` | Passed with CRLF warnings only | No patch-format regressions |
| touched-file secret scan with `rg` | Passed with expected test-only matches | Only local dummy tokens/passwords appeared in test fixtures |

PO/CTO validation:

- accepted for the current bounded slice: durable assigned-role behavior is now proven across one more real auth lifecycle, including direct DB-auth login, step-up token issuance, and password-reset-confirm relogin, while preserving scalar-role fallback and the existing no-escalation behavior
- not accepted as complete: this is still not a full multi-role migration, not a backfill-complete rollout, not a rollback-complete rollout, and not scalar-role removal
- product claim wording remains: Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement plus bounded `media.read`, `compliance.read`, `rejection_intelligence.read`, `auto_suggestions.read`, and `taxonomy.read` API-client scope families for their matching read routes, bounded vendor/object ownership enforcement on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes including marketplace readiness-and-preflight governance and billing plan-tier governance, shared governance redaction on covered API-key, workspace-user, access-scope, connector-permission, outbound-webhook endpoint, outbound-webhook delivery, audit-log, billing-governance, and audit-explorer/export reads with a shared JSON and CSV visibility contract, additive persisted multi-role read-path support on `AuthIdentity.assigned_roles` with scalar-role fallback preserved, durable local-auth and DB-auth compatibility proof for normalized assigned roles, workspace-user governance read compatibility for normalized persisted assigned roles, and a bounded additive workspace-user write contract whose assigned-role changes are proven durable through later logins and password-reset-confirm auth resolution. It is not yet enterprise-complete across broad vendor enforcement, unsupported ABAC dimensions, durable multi-role rollout, full API-client resources, full admin-boundary mapping, or universal response redaction.

Rollback notes:

- revert only the new per-user-password durability assertions if a later product decision intentionally narrows the current password-reset or step-up compatibility contract for persisted assigned roles
- keep the bounded login, step-up, and password-reset durability proofs so any future multi-role auth changes remain explicit and regression-tested

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-29 Bounded Follow-Up: Marketplace Readiness and Preflight Admin-Boundary Mapping

Scope:

- added explicit `manage_product_data` admin-boundary coverage to the live marketplace readiness and mapping-preflight governance family
- covered:
  - `POST /marketplace/connectors/:connectorSlug/mappings/preflight`
  - `POST /marketplace/connectors/:connectorSlug/publish-readiness`
  - `POST /marketplace/readiness/batch`
- extended the sensitive policy guard so these routes are now part of the checked admin-boundary surface
- expanded remediation proof so `product_admin` allow and `system_admin` deny are both exercised on the new route family

Files changed in this follow-up:

- `apps/api/src/marketplace/marketplace.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with the new marketplace governance boundary decorators |
| `npm run test:integration:access-policy-remediation` | Passed after fixture fixes | First failed on a proof mismatch (`preflight` returns `201`, not `200`) and then on an incorrect publish-readiness route path; final rerun passed |
| `npm run test:integration:delegated-access-scopes` | Passed | Delegated-scope behavior remained green after the governance-only slice |
| `npm run guard:sensitive-gets` | Passed | Guardrail now validates 49 admin-boundary checked routes |
| `node apps/api/test/integration/marketplace-readiness-batch.test.cjs` | Passed | Existing marketplace batch-readiness contract still holds under the new boundary |

PO/CTO validation:

- accepted for the current bounded slice: the marketplace readiness and mapping-preflight governance family now uses explicit `manage_product_data` admin-boundary enforcement, `product_admin` is proven allowed on those routes, and `system_admin` is proven denied
- not accepted as complete: this still does not finish all remaining admin-boundary mapping, and it does not widen vendor, owner, API-client, or redaction claims
- product claim wording remains aligned with the bounded governance model and should include the newly covered marketplace readiness and preflight family

Rollback notes:

- revert only the new marketplace readiness or preflight boundary decorators if a proven product requirement restores non-admin governance access to those routes
- keep the remediation assertions and sensitive-route guard entries so any future widening of this family remains explicit and reviewed

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation within `ST-ACCESS-POLICY-BACKLOG-001`

## 2026-04-29 Bounded Follow-Up: Audit Log Governance Redaction

Scope:

- added a central read policy for `GET /audit/logs`
- kept the existing `manage_security` admin-boundary and human-only route contract intact
- redacted raw audit `metadata` for `system_admin`
- preserved full audit-log metadata visibility for `super_admin` and legacy `admin`
- left `GET /audit/events` and `GET /audit/events/export` unchanged because they still need a broader explorer/export redaction design

Files changed in this follow-up:

- `apps/api/src/common/rbac/read-access-policy.decorator.ts`
- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/src/audit/audit.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with audit-log read policy wiring |
| `npm run test:integration:access-policy-remediation` | Passed after sequential rerun | Parallel first run hit shared `apps/api/dist` artifact timing; sequential rerun proved `system_admin` metadata redaction and `super_admin` metadata retention |
| `npm run test:integration:delegated-access-scopes` | Passed after sequential rerun | Parallel first run hit the same shared build-artifact timing; no policy regression |
| `npm run guard:sensitive-gets` | Passed | Guardrail recognized the new audit-log central redaction policy |

PO/CTO validation:

- accepted for the current bounded slice: `GET /audit/logs` now has central field-level redaction for lower admin-boundary roles, with `system_admin` still allowed but metadata-redacted and `super_admin` plus legacy `admin` retaining full detail
- not accepted as complete: this does not complete broader audit explorer/export redaction, universal response redaction, or the remaining access-policy backlog
- export and explorer payloads remain deliberately unchanged until a wider role-aware field contract is proven

Rollback notes:

- revert only the new `audit_logs_governance_redacted` read policy and the audit-log metadata redaction helper if a proven product requirement restores raw audit metadata to `system_admin`
- keep the remediation assertions so any future widening of audit-log detail stays explicit and reviewed

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation within `ST-ACCESS-POLICY-BACKLOG-001`

## 2026-04-29 Bounded Foundation Follow-Up: Additive AuthIdentity Assigned-Roles Read Path

Scope:

- added additive `assigned_roles` persistence on `AuthIdentity` without removing the legacy scalar `role`
- updated DB-backed auth resolution and password-reset identity resolution to read persisted `assigned_roles`
- kept scalar `role` as the compatibility fallback when `assigned_roles` is empty or missing
- added a dedicated DB-auth integration proof for persisted multi-role reads without widening workspace-user CRUD into a multi-role write rollout

Files changed in this follow-up:

- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260429113000_add_auth_identity_assigned_roles/migration.sql`
- `apps/api/src/auth/auth.service.ts`
- `apps/api/test/integration/auth-assigned-roles-read-path.test.cjs`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `apps/api/test/integration/delegated-access-scopes.test.cjs`
- `apps/api/test/integration/api-keys.test.cjs`
- `apps/api/test/integration/shopify-publication-targets-api.test.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run prisma:generate` | Passed | Prisma client regenerated with additive `assigned_roles` field |
| `npm run build --workspace @pim1/api` | Passed | API compiled with persisted assigned-role reads |
| `node apps/api/test/integration/auth-assigned-roles-read-path.test.cjs` | Failed, then passed | First proof incorrectly expected boundary-role access to bypass scalar app-role checks on `GET /compliance/rules`; switched to `GET /marketplace/channels`, which truthfully proves assigned editor role activation while invalid-only roles stay denied |
| `npm run test:integration:access-policy-remediation` | Passed | Existing access-policy coverage stayed green with the additive auth change |
| `npm run test:integration:delegated-access-scopes` | Passed | Delegated scope behavior remained intact |
| `npm run guard:sensitive-gets` | Passed | Sensitive GET coverage remained stable after the auth persistence slice |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Existing role-resolution and API-client foundation checks stayed green |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Notification redaction behavior remained green |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy |
| `npm run gate:run:increment` | Passed | Increment gates remained green after a sequential long-timeout run |
| `npm run gate:run:sprint` | Passed | Sprint gates remained green |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deploy workflow contract remained intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Staging postdeploy harness still passed |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Increment state remained valid |
| `git diff --check` | Passed with CRLF warnings only | No whitespace or patch-shape errors |
| touched-file secret scan with `rg` | Passed with expected local/test-only matches | Only local dummy passwords, token helper names, and new `assigned_roles` references matched |

What is now proven:

- DB-backed auth can persist and read `assigned_roles`
- when `assigned_roles` is present, valid entries are normalized and emitted into JWT claims
- scalar `role` remains the fallback when `assigned_roles` is empty
- invalid persisted assigned-role strings are dropped and do not escalate privilege
- legacy scalar-role workspace-user CRUD behavior remains unchanged in this slice

What remains out of scope:

- multi-role write APIs and workspace-user CRUD rollout
- destructive backfill or scalar-role removal
- broad admin hierarchy redesign
- broader ABAC dimension rollout

Rollback notes:

- revert only the additive `assigned_roles` field, its migration, and the DB-auth read-path wiring if a proven DB-auth regression appears
- keep the dedicated DB-auth proof so any future multi-role rollout or rollback still has runtime evidence for persisted-role reads
- do not remove scalar `role` until a later, separately validated write-path and migration slice is complete

## 2026-04-29 Bounded Follow-Up: Workspace-User Governance Read Compatibility For Assigned Roles

Scope:

- extended workspace-user governance reads to include normalized persisted `assigned_roles`
- preserved the legacy scalar `role` field as the primary app-role contract
- kept workspace-user writes unchanged: no multi-role create or update contract was introduced in this follow-up
- extended the existing DB-auth assigned-roles integration proof to validate workspace-user governance read compatibility

Files changed in this follow-up:

- `apps/api/src/workspace-users/workspace-users.service.ts`
- `apps/api/test/integration/auth-assigned-roles-read-path.test.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with workspace-user assigned-role read compatibility |
| `node apps/api/test/integration/auth-assigned-roles-read-path.test.cjs` | Passed | Workspace-user listing now surfaces normalized persisted assigned roles while scalar fallback remains intact |
| `npm run test:integration:access-policy-remediation` | Passed | Existing access-policy remediation coverage remained green |
| `npm run test:integration:delegated-access-scopes` | Passed | Delegated scope behavior remained green |
| `npm run guard:sensitive-gets` | Passed | Sensitive GET coverage remained stable |

What is now proven:

- `GET /admin/workspace/users` includes normalized `assignedRoles` from persisted `AuthIdentity.assigned_roles`
- invalid persisted assigned-role strings are filtered out of governance read output
- scalar `role` remains unchanged as the compatibility field
- no workspace-user multi-role write contract was introduced by accident

Why the queue stops here:

- the next multi-role step is no longer a read-compatibility extension
- it requires explicit write-contract design for create/update APIs, validation rules, fallback behavior, and audit semantics
- that is a separate rollout slice, not another zero-design continuation of the current pattern

## 2026-04-29 Bounded Follow-Up: Workspace-User Assigned-Roles Additive Write Contract

Scope:

- extended workspace-user create and role-update DTOs to accept optional `assignedRoles`
- persisted normalized `assignedRoles` on workspace-user create and update
- preserved scalar `role` as the compatibility field and primary app-role contract
- preserved existing behavior when `assignedRoles` is omitted on role update
- rejected invalid assigned-role values at the DTO/service boundary instead of silently storing them
- extended audit metadata for workspace-user create and role-change events to capture assigned-role changes

Files changed in this follow-up:

- `apps/api/src/workspace-users/dto/create-workspace-user.dto.ts`
- `apps/api/src/workspace-users/dto/update-workspace-user-role.dto.ts`
- `apps/api/src/workspace-users/workspace-users.service.ts`
- `apps/api/test/integration/workspace-user-crud.test.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with additive workspace-user assigned-role writes |
| `node apps/api/test/integration/workspace-user-crud.test.cjs` | Passed | Admin can create/update persisted assigned roles, omitted `assignedRoles` preserves existing values, invalid assigned roles are rejected, and audit metadata captures the change |
| `node apps/api/test/integration/auth-assigned-roles-read-path.test.cjs` | Passed | DB-auth read-path proof remained green after the write-contract slice |
| `npm run test:integration:access-policy-remediation` | Passed | Existing access-policy remediation coverage stayed green |
| `npm run test:integration:delegated-access-scopes` | Passed | Delegated scope behavior remained green |
| `npm run guard:sensitive-gets` | Passed | Sensitive GET coverage remained stable |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Foundation checks stayed green |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Notifications suite remained green |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy |
| `npm run gate:run:increment` | Passed | Increment gates remained green |
| `npm run gate:run:sprint` | Passed | Sprint gates remained green |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deploy workflow contract remained intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Staging postdeploy harness remained green |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Increment state remained valid |
| `git diff --check` | Passed with CRLF warnings only | No patch-shape or whitespace regressions |
| touched-file secret scan with `rg` | Passed with expected local/test-only matches | Only local dummy passwords, token helper names, and assigned-role references matched |

What is now proven:

- workspace-user create can persist additive `assignedRoles`
- workspace-user role update can persist additive `assignedRoles`
- omitting `assignedRoles` on role update preserves the existing stored values
- invalid assigned-role values are rejected instead of being stored
- workspace-user audit rows now record assigned-role additions and changes

Why the queue stops here:

- the next multi-role step is no longer a narrow compatibility or additive write-contract slice
- remaining work needs explicit rollout decisions for:
  - backfill behavior
  - broader API/UI management flows
  - rollback semantics beyond the current additive contract
  - eventual scalar-role deprecation planning

## 2026-04-29 Continuous Queue: API-Client `taxonomy.read` Scope Foundation

Scope:

- added one bounded machine-principal scope family for taxonomy metadata reads
- kept taxonomy write routes unchanged and API clients still blocked from taxonomy governance mutations
- preserved existing human behavior on taxonomy metadata routes while allowing API clients only with the exact new scope

Files changed in this follow-up:

- `apps/api/src/common/rbac/api-client-policy.decorator.ts`
- `apps/api/src/common/rbac/read-access-policy.decorator.ts`
- `apps/api/src/taxonomy/taxonomy.controller.ts`
- `apps/api/test/integration/access-policy-foundation.test.cjs`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with the additive `taxonomy.read` scope vocabulary and controller metadata |
| `npm run test:integration:access-policy-remediation` | Failed, then passed | First proof incorrectly assumed `GET /taxonomy/categories?all=true` returned a paginated `{ items }` envelope. The live route returns an array for `all=true`, so the assertion was corrected in `apps/api/test/integration/access-policy-remediation.test.cjs` without changing product behavior. |
| `npm run test:integration:delegated-access-scopes` | Passed | Existing delegated scope and vendor/category-manager proofs remained green |
| `npm run guard:sensitive-gets` | Passed | Guard now recognizes taxonomy metadata as `scope_filtered` with explicit API-client scope allowance |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Foundation vocabulary proof now includes `taxonomy.read` |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Notification coverage remained green |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy |
| `npm run gate:run:increment` | Passed after long-timeout rerun | First run hit a shell timeout only; sequential rerun passed with `INCREMENT_CORE_GATES totalSteps=16` |
| `npm run gate:run:sprint` | Passed | Sprint gates remained green with `SPRINT_CORE_GATES totalSteps=14` |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deploy workflow contract remained intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Staging postdeploy harness remained green |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Increment state remained valid |
| `git diff --check` | Passed with CRLF warnings only | No patch-shape or whitespace regressions |
| touched-file secret scan with `rg` | Passed with expected local/test-only matches | Only local dummy tokens, passwords, and new scope strings matched |

What is now proven:

- API-client scope vocabulary now includes `taxonomy.read`
- API keys with exact `taxonomy.read` can read:
  - `GET /taxonomy/categories`
  - `GET /taxonomy/categories/:id`
  - `GET /taxonomy/categories/:id/attributes`
- API keys with unrelated scopes are denied on those taxonomy metadata routes
- API keys with no scopes are denied on those taxonomy metadata routes
- human editor behavior on taxonomy metadata reads remains valid
- taxonomy writes remain blocked for API clients

Why the queue stops here:

- the next obvious API-client candidate is `GET /issues/inbox`
- that route mixes aggregate summary behavior with optional connector-installation filtering and scope-derived product filtering
- expanding machine-principal access there needs a broader route-family contract than this clean metadata foundation slice

## 2026-04-29 Continuous Queue: Outbound Webhook Delivery Redaction Foundation

Scope:

- added one bounded field-level redaction foundation for outbound webhook delivery governance reads
- kept existing webhook governance route protection and provenance redaction intact
- redacted `errorMessage` for lower admin boundary readers while preserving full visibility for `super_admin` and legacy `admin`

Files changed in this follow-up:

- `apps/api/src/common/rbac/read-access-policy.decorator.ts`
- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/src/outbound-webhooks/outbound-webhooks.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with the new outbound webhook delivery read policy |
| `npm run test:integration:access-policy-remediation` | Passed | Proved `system_admin` delivery reads redact `errorMessage` while `super_admin` retains it |
| `npm run test:integration:delegated-access-scopes` | Passed | Existing delegated-scope behavior stayed green |
| `npm run guard:sensitive-gets` | Passed | Guard now recognizes the delivery read policy as centrally redacted |

PO/CTO validation:

- accepted for the current bounded slice: shared governance field-level redaction now covers outbound webhook delivery reads, and the proof uses a real failed-delivery fixture rather than a mocked payload shape
- not accepted as complete: this is still not universal response redaction, and broader mixed-payload governance families still need a larger field-level policy design
- product claim wording remains: Vexa PIM has runtime-enforced authenticated-read classification, bounded machine-principal scope families on covered read routes, bounded vendor/object ownership on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes, and shared governance redaction on covered governance payload families. It is not yet a complete enterprise authorization model across all fields, scopes, machine principals, role persistence, or governance surfaces.

Rollback notes:

- revert only the delivery read policy and the `errorMessage`-redaction helper if a validated incident-response requirement proves `system_admin` must see raw delivery failure text
- keep the remediation proof and guardrail entry so any future visibility widening remains explicit and reviewed

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without full story completion

## 2026-04-29 Continuous Queue: Billing Governance Read Redaction

Scope:

- added one bounded field-level redaction slice for the live billing governance read family
- kept the existing `system_admin` / `super_admin` admin-boundary contract intact
- redacted plan-profile and upgrade-request sensitive commercial fields for `system_admin` while preserving the full view for `super_admin` and legacy `admin`

Files changed in this follow-up:

- `apps/api/src/common/rbac/read-access-policy.decorator.ts`
- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/src/billing/billing.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with the new billing governance read policies |
| `npm run test:integration:access-policy-remediation` | Passed | Proved `system_admin` redaction and `super_admin` full visibility on `plan-profile` and `upgrade-request` |
| `npm run test:integration:delegated-access-scopes` | Passed | Existing delegated-scope behavior stayed green |
| `npm run guard:sensitive-gets` | Passed | Guard now recognizes both billing governance read policies as centrally redacted |

PO/CTO validation:

- accepted for the current bounded slice: shared governance field-level redaction now covers the live billing governance read family without widening access or changing the write routes
- not accepted as complete: this is still not universal response redaction, and broader commercial internal/export payloads still need a larger visibility contract before safe rollout
- product claim wording remains: Vexa PIM has runtime-enforced authenticated-read classification, bounded machine-principal scope families on covered read routes, bounded vendor/object ownership on proven product-backed reads, bounded admin-boundary enforcement on covered governance routes, additive multi-role persistence foundations, and shared governance redaction on covered governance payload families. It is not yet a complete enterprise authorization model across all fields, scopes, machine principals, durable role rollout, or governance surfaces.

Rollback notes:

- revert only the two billing read policies and the bounded billing redaction helpers if a validated commercial requirement proves `system_admin` must retain raw contact or request-detail visibility
- keep the remediation proofs and guardrail entries so any future widening of billing governance visibility remains explicit and reviewed

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without full story completion

## 2026-04-29 Foundation Plan: Multi-Role Persistence Rollout

Scope:

- inspected the current persisted auth model after the webhook-delivery redaction slice
- converted the multi-role blocker from a vague backlog item into a concrete migration and rollout plan
- did not execute destructive persistence changes in this pass

Current blocker proof:

- `packages/db/prisma/schema.prisma` still defines `AuthIdentity` with only a scalar `role` field and no persisted `assignedRoles`
- `apps/api/src/auth/auth.service.ts` DB-backed identity resolution still returns `assignedRoles: []`
- `apps/api/src/workspace-users/workspace-users.service.ts` still reads and writes only the scalar `role`
- JWT and local-auth bridging already support `assignedRoles`, so the missing piece is durable DB storage rather than token vocabulary

Smallest safe rollout plan:

1. additive schema only
   - add `assignedRoles String[] @default([]) @map("assigned_roles")` to `AuthIdentity`
   - keep the legacy scalar `role` field as the primary app-role fallback during rollout
2. read-path first
   - update DB auth resolution to select `assignedRoles`
   - normalize persisted roles through the existing `normalizeFoundationRole` pipeline
   - keep null or missing arrays equivalent to `[]`
3. backward-compatible write path
   - leave existing user-create and role-change flows valid for single-role callers
   - add optional assigned-role updates only after read-path rollout is proven
   - keep deterministic primary-role resolution through the existing role-utils helper
4. backfill
   - set `assigned_roles = []` for existing rows
   - do not infer admin-boundary roles from historical scalar `role` values automatically
5. rollback
   - stop writing `assigned_roles`
   - continue honoring the scalar `role`
   - leave the additive column in place; no destructive rollback required
6. required proof before execution
   - DB-auth login preserves assigned roles in JWT claims
   - legacy single-role rows still authenticate unchanged
   - API clients do not inherit persisted human assigned roles
   - workspace user CRUD remains deterministic and does not widen access through ordering bugs

PO/CTO validation:

- accepted for the current bounded slice: the multi-role blocker is now reduced to a concrete additive migration and rollout plan grounded in the actual repo state
- not accepted as complete: persistence is still not implemented, backfilled, or validated in DB-auth mode
- product claim wording remains: Vexa PIM has bounded authorization foundations across covered machine-principal scopes, vendor/object reads, admin-boundary routes, and governance redaction, plus a concrete multi-role persistence rollout plan. It is not yet a complete enterprise authorization model across durable multi-role storage, broad ABAC dimensions, or universal response redaction.

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without full story completion

## 2026-04-29 Foundation Slice: API-Client Scope Vocabulary Expansion for Media Reads

Scope:

- added one new machine-principal scope family beyond catalog: `media.read`
- applied that scope only to the bounded read-only media route family:
  - `GET /media/assets`
  - `GET /media/assets/:id`
  - `GET /media/assets/:id/validation`
- preserved class-level API-client deny for media writes and left all non-media machine-principal families unchanged

Files changed in this follow-up:

- `apps/api/src/common/rbac/api-client-policy.decorator.ts`
- `apps/api/src/common/rbac/read-access-policy.decorator.ts`
- `apps/api/src/media/media.controller.ts`
- `apps/api/test/integration/access-policy-foundation.test.cjs`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with the new `media.read` scope vocabulary and media-route scope metadata |
| `npm run test:integration:access-policy-remediation` | Passed | Added proof that API keys with `media.read` can access media reads, while catalog-only and no-scope keys are denied |
| `npm run test:integration:delegated-access-scopes` | Passed | Existing delegated human and vendor scope behavior stayed green after the machine-principal foundation addition |
| `npm run guard:sensitive-gets` | Failed, then passed | First failure was a real guardrail precedence bug: class-level `@DisallowApiClient()` still beat method-level read-policy API metadata for media routes. Fixed in `scripts/validate-sensitive-get-policy.cjs` to mirror runtime precedence, then reran successfully. |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Foundation suite now proves the API-client vocabulary includes `media.read` |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Notifications redaction baseline remained intact |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy after the backend-only slice |
| `npm run gate:run:increment` | Passed | Increment gate stayed green with the added API-client scope family |
| `npm run gate:run:sprint` | Passed | Sprint gate stayed green with the media scope addition |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deploy workflow contract remained intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Staging postdeploy harness remained intact |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Increment state JSON still valid |
| `git diff --check` | Passed with CRLF warnings only | No patch-formatting errors |
| touched-file secret scan with `rg` | Passed with expected local/test-only matches | Only local test DB URL, demo-password strings, and API-key test fixtures matched; no real secrets were introduced |

PO/CTO validation:

- accepted for the current bounded foundation slice:
  - `media.read` now exists as a real API-client scope vocabulary item
  - the media read family now requires explicit `media.read` scope for API-key access
  - API keys with unrelated catalog scopes or no scopes are denied on media reads
  - human editor access remained valid and media writes remain blocked to API clients
- not accepted as complete:
  - this is not a full API-client redesign
  - only the bounded media read family is now proven beyond the covered catalog API family
  - broader machine-principal resource coverage, vendor breadth, owner breadth, remaining admin-boundary mapping, persistent multi-role rollout, and universal response redaction all remain incomplete
- exact product claim wording:
  - `Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement plus a bounded media.read API-client scope family for the media read routes, actor-specific delegated-scope activation, bounded admin-boundary enforcement on covered governance routes, category-scoped enforcement on proven catalog and taxonomy surfaces, Shopify publication-target catalog scope enforcement, bounded owner-scope enforcement on marketplace mapping templates, bounded vendor/object ownership enforcement on the proven catalog, compliance issue, auto-suggestion, rejection-intelligence, and media read paths, and shared governance provenance redaction on covered API-key, workspace-user, access-scope, connector-permission, and outbound-webhook reads. It is not yet enterprise-complete across broad vendor enforcement, supplier or locale or market or team or assignee scope enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.`

Rollback notes:

- revert only the `media.read` scope vocabulary and method-level media route scope requirements if a proven machine-principal regression shows the family cannot be safely scoped this way
- keep the guardrail precedence fix in `scripts/validate-sensitive-get-policy.cjs` because it aligns the validator with the live runtime metadata resolution order
- keep media writes API-client denied unless a separate validated write-scope slice proves safe semantics

Lock update:

- no `INCREMENT_STATE.json` lock update was made because `ST-ACCESS-POLICY-BACKLOG-001` remains in progress and this slice does not complete the full story

## 2026-04-29 Continuous Queue: API-Client Scope Expansion Batch

Scope:

- continued queue 1 past the already-validated `media.read` slice
- added three more bounded machine-principal read-scope families:
  - `compliance.read`
  - `rejection_intelligence.read`
  - `auto_suggestions.read`
- enforced them only on the matching read-only families:
  - `GET /compliance/products/:id/issues`
  - `GET /rejection-intelligence/products/:id/score`
  - `GET /auto-suggestions/products/:id/title-suggestion`
  - `GET /auto-suggestions/products/:id/attribute-enrichment`
  - `GET /auto-suggestions/products/:id/category-suggestion`
- preserved API-client deny on writes and on all remaining non-proven machine-principal surfaces

Files changed in this follow-up:

- `apps/api/src/common/rbac/api-client-policy.decorator.ts`
- `apps/api/src/compliance/compliance.controller.ts`
- `apps/api/src/rejection-intelligence/rejection-intelligence.controller.ts`
- `apps/api/src/auto-suggestions/auto-suggestions.controller.ts`
- `apps/api/test/integration/access-policy-foundation.test.cjs`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with the added API-client scope vocabulary and route-family metadata |
| `npm run test:integration:access-policy-remediation` | Failed, then passed | First failure was an outdated expectation in the remediation suite: catalog-scoped API keys on newly scope-backed AI-helper routes now fail with `API_CLIENT_SCOPE_FORBIDDEN`, not `API_CLIENT_FORBIDDEN`. Fixed in `apps/api/test/integration/access-policy-remediation.test.cjs`, then reran successfully. |
| `npm run test:integration:delegated-access-scopes` | Passed | Existing delegated human and vendor scope behavior remained intact |
| `npm run guard:sensitive-gets` | Passed | Guard coverage now counts `allowed_with_api_scope=25` after the new scope-backed route families |

Queue review after the new batch:

- queue 1 safe additions are now exhausted for the currently clean read-only pattern
- skipped as not safe for this queue:
  - connector preview and connector account surfaces because they trend into payload preview, credentials, and installation lifecycle semantics
  - marketplace export, simulation, and submission surfaces because they are tied to export or write lifecycle semantics rather than clean machine-principal reads
  - issue inbox aggregate paths because they are scoped aggregate/filter surfaces rather than one narrow direct read family
- queue 2 was inspected next, but no equally safe provenance-only redaction target remained:
  - `GET /admin/webhooks/deliveries` carries request and response payload fields, which needs broader field-level redaction design rather than the current lightweight provenance pattern
  - audit explorer reads carry mixed metadata and explorer semantics, which also needs a broader policy shape instead of another small provenance-only extension

PO/CTO validation:

- accepted for the current continuous queue batch:
  - API-client scope vocabulary now includes `compliance.read`, `rejection_intelligence.read`, and `auto_suggestions.read`
  - those scopes are proven only on their matching bounded read families
  - API keys with exact scope are allowed
  - API keys with no scope or unrelated scope are denied
  - human reviewer, editor, and admin behavior remained intact
  - writes remained blocked
- not accepted as complete:
  - this is still not a full API-client model
  - broader machine-principal scope coverage still remains incomplete outside the currently covered catalog, media, compliance issue, rejection score, and auto-suggestions read families
  - queue 2 onward still needs broader redaction or design work before safe continuation
- exact product claim wording:
  - `Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement plus bounded media.read, compliance.read, rejection_intelligence.read, and auto_suggestions.read API-client scope families for their matching read routes, actor-specific delegated-scope activation, bounded admin-boundary enforcement on covered governance routes, category-scoped enforcement on proven catalog and taxonomy surfaces, Shopify publication-target catalog scope enforcement, bounded owner-scope enforcement on marketplace mapping templates, bounded vendor/object ownership enforcement on the proven catalog, compliance issue, auto-suggestion, rejection-intelligence, and media read paths, and shared governance provenance redaction on covered API-key, workspace-user, access-scope, connector-permission, and outbound-webhook reads. It is not yet enterprise-complete across broad vendor enforcement, supplier or locale or market or team or assignee scope enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.`

Lock update:

- no `INCREMENT_STATE.json` lock update was made because `ST-ACCESS-POLICY-BACKLOG-001` remains in progress and this batch does not complete the full story

## 2026-04-29 Continuous Queue: Shared Governance Provenance Redaction Expansion

Scope:

- extended central governance provenance redaction from the already-covered workspace user, workspace access-scope, and API-key reads into:
  - `GET /connectors/permissions`
  - `GET /admin/webhooks`
- kept the existing security admin-boundary rules intact and changed only read-policy metadata plus central response-policy coverage
- validated the queue stop condition for further admin-boundary work instead of forcing a dead or unsafe route family:
  - `ONDC` looked like a candidate on paper, but the route family is feature-flagged off in `apps/api/src/app.module.ts`, so it is not a live admin-boundary backlog surface in this environment

Files changed in this follow-up:

- `apps/api/src/common/rbac/read-access-policy.decorator.ts`
- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/src/connector-installer/connector-installer.controller.ts`
- `apps/api/src/outbound-webhooks/outbound-webhooks.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`
- `docs/execution/ACCESS_POLICY_EXECUTION_RECORD_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PO_CHECKPOINT_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with the new governance redaction policies |
| `npm run test:integration:access-policy-remediation` | Passed after two fixture corrections | First failure used an invalid webhook `eventType`; second failure used a connector-permission `principalType=user` without a matching DB-auth identity. Final passing run proved system-admin redaction and super-admin visibility on both new governance reads. |
| `npm run test:integration:delegated-access-scopes` | Passed | No delegated-scope regression from the governance-only slice |
| `npm run guard:sensitive-gets` | Passed | Guard still reports `authenticatedReadRoutes=71`, `authenticatedRoutes=158`, `publicRoutes=19`, `adminBoundaryCheckedRoutes=46` |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Foundation enforcement remains intact |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Existing shared redaction coverage remains intact |
| `npm run build --workspace @pim1/web` | Passed | Web build unaffected by backend-only slice |
| `npm run gate:run:increment` | Passed | `INCREMENT_CORE_GATES totalSteps=16` |
| `npm run gate:run:sprint` | Passed | `SPRINT_CORE_GATES totalSteps=14` |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deploy workflow contract unchanged |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Staging postdeploy harness still green |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Increment state JSON remains valid |
| `git diff --check` | Passed with CRLF warnings only | No patch-format regression |
| touched-file secret scan with `rg` | Passed with expected test-only matches | No real secrets introduced |

PO/CTO validation:

- accepted for the current bounded queue slice:
  - central governance provenance redaction now covers connector-permission reads and outbound-webhook endpoint reads
  - `system_admin` stays allowed on those routes but receives `createdBy` redacted
  - `super_admin` and legacy `admin` retain full provenance visibility
  - queue 2 is now complete for the currently covered governance read families
- not accepted as complete:
  - this is still not universal response redaction
  - no additional safe live admin-boundary route family was validated after this slice because the remaining obvious `ONDC` candidate is feature-flagged off, and the next owner-scope candidate would require a different resource model instead of another clean governance read extension
  - broader API-client coverage, persistent multi-role rollout, broad vendor enforcement, and broader owner-scope expansion remain incomplete
- product claim wording:
  - Vexa PIM now has bounded vendor/object ownership enforcement on the canonical catalog read family plus compliance product-issue reads, auto-suggestion title, attribute-enrichment, and category-suggestion reads, rejection-intelligence score reads, and media asset reads, in addition to runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement, actor-specific delegated-scope activation, bounded admin-boundary enforcement on covered governance routes, category-scoped enforcement on proven catalog and taxonomy surfaces, Shopify publication-target catalog scope enforcement, bounded owner-scope enforcement on marketplace mapping templates, and shared governance provenance redaction on covered API-key, workspace-user, access-scope, connector-permission, and outbound-webhook reads. It is not yet enterprise-complete across broad vendor enforcement, supplier or locale or market or team or assignee scope enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.

Rollback notes:

- revert only the route-level `ReadAccessPolicy(...)` metadata on `GET /connectors/permissions` or `GET /admin/webhooks` if PO later decides `system_admin` should regain raw provenance visibility
- keep the central redaction cases and remediation assertions so any visibility widening remains explicit and tested
- do not use the discarded `ONDC` trial as evidence for admin-boundary completion while the feature flag keeps that route family out of the live app surface

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because `INC-24 / ST-ACCESS-POLICY-BACKLOG-001` remains an in-progress queue rather than a completed access-policy story

## 2026-04-28 Bounded Follow-Up: Vendor/Object Ownership Expansion To Auto-Suggestion Title Reads

Scope:

- expanded the previously validated vendor/object ownership boundary from the canonical catalog family, compliance product-issue reads, rejection-intelligence score reads, and media asset reads into one additional adjacent product-backed read path
- opted only `GET /auto-suggestions/products/:id/title-suggestion` into bounded vendor access
- preserved reviewer denial, editor allow, API-client denial, and blocked vendor write behavior on the rest of the AI-helper surface

Files changed in this follow-up:

- `apps/api/src/auto-suggestions/auto-suggestions.controller.ts`
- `apps/api/src/auto-suggestions/auto-suggestions.service.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `apps/api/test/integration/delegated-access-scopes.test.cjs`
- `docs/execution/ACCESS_POLICY_EXECUTION_RECORD_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PO_CHECKPOINT_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled after the controller-level vendor opt-in and service ownership propagation |
| `npm run test:integration:delegated-access-scopes` | Passed | Proved `vendor_scope_extends_to_owned_auto_suggestion_reads` |
| `npm run test:integration:access-policy-remediation` | Passed | Proved `vendor_allowed_owned_auto_suggestion_reads_on_proven_path_only` while preserving reviewer denial and editor allow |
| `npm run guard:sensitive-gets` | Passed | Classification coverage now reports `scope_filtered=7` and `admin_editor=14` |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Runtime authenticated-read and API-client foundation checks stayed green |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Shared redaction coverage stayed green |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy after the backend-only slice |
| `npm run gate:run:increment` | Timed out once, then passed | First failure was shell timeout only during the long sequential gate run; reran with a longer timeout and got `INCREMENT_CORE_GATES totalSteps=16` |
| `npm run gate:run:sprint` | Passed | Final log reported `SPRINT_CORE_GATES totalSteps=14` |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Staging workflow contract remained intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Checked-in staging postdeploy harness still validated auth and non-admin denial smoke coverage |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Increment tracking JSON remains valid |
| `git diff --check` | Passed with CRLF warnings only | No patch-formatting errors introduced |
| touched-file secret scan with `rg` | Passed with expected local/test-only matches | Only local DB URLs, dummy JWT secrets, bearer-header helpers, and existing credential-variable names matched |

PO/CTO validation:

- accepted for the current bounded slice: vendor/object ownership is now proven on one more adjacent product-backed read path by reusing the trusted `Product.vendorScopeKey` boundary through auto-suggestion title reads
- not accepted as complete: this does not broaden vendor writes, vendor taxonomy access, vendor governance access, supplier or locale or market or team or assignee enforcement, broader machine-principal coverage, persistent multi-role rollout, full admin-boundary mapping, or universal response redaction
- product claim wording remains:
  - `Vexa PIM now has bounded vendor/object ownership enforcement on the canonical catalog read family plus compliance product-issue reads, auto-suggestion title reads, rejection-intelligence score reads, and media asset reads, in addition to runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement, actor-specific delegated-scope activation, bounded admin-boundary enforcement on covered governance routes, category-scoped enforcement on proven catalog and taxonomy surfaces, Shopify publication-target catalog scope enforcement, bounded owner-scope enforcement on marketplace mapping templates, and shared governance provenance redaction on covered API-key, workspace-user, and access-scope reads. It is not yet enterprise-complete across broad vendor enforcement, supplier or locale or market or team or assignee scope enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.`

Rollback notes:

- revert only the `FoundationRoleAccess("vendor")` opt-in on `GET /auto-suggestions/products/:id/title-suggestion` and the service-level `vendorScopeKey` propagation if a proven regression shows title-suggestion reads should not inherit the same trusted product boundary as the already validated vendor-safe catalog family
- keep the focused delegated-scope and remediation assertions so any future role broadening on the remaining AI-helper routes stays explicit and reviewed

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because `INC-24 / ST-ACCESS-POLICY-BACKLOG-001` remains in progress and this slice does not complete the story

## 2026-04-28 Bounded Follow-Up: Vendor/Object Ownership Expansion To Remaining Auto-Suggestion Reads

Scope:

- stayed within the same already-proven auto-suggestions product-backed family and continued the safe bounded queue instead of hopping to a new resource model
- opted `GET /auto-suggestions/products/:id/attribute-enrichment` into bounded vendor access
- opted `GET /auto-suggestions/products/:id/category-suggestion` into bounded vendor access
- kept `POST /auto-suggestions/products/:id/repair` blocked for vendor and preserved API-client denial on the full family

Files changed in this follow-up:

- `apps/api/src/auto-suggestions/auto-suggestions.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `apps/api/test/integration/delegated-access-scopes.test.cjs`
- `docs/execution/ACCESS_POLICY_EXECUTION_RECORD_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PO_CHECKPOINT_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with the two additional scope-filtered vendor-safe auto-suggestion reads |
| `npm run test:integration:delegated-access-scopes` | Passed | Proved `vendor_scope_extends_to_owned_auto_suggestion_attribute_reads` and `vendor_scope_extends_to_owned_auto_suggestion_category_reads` |
| `npm run test:integration:access-policy-remediation` | Passed | Proved vendor owned/unowned allow-deny behavior for the two new routes while preserving reviewer denial and editor allow |
| `npm run guard:sensitive-gets` | Passed | Classification coverage moved to `scope_filtered=9` and `admin_editor=12` |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Runtime authenticated-read and API-client foundation checks stayed green |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Shared redaction coverage stayed green |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy after the backend-only slice |
| `npm run gate:run:increment` | Passed | Final log reported `INCREMENT_CORE_GATES totalSteps=16` |
| `npm run gate:run:sprint` | Passed | Final log reported `SPRINT_CORE_GATES totalSteps=14` |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Staging workflow contract remained intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Checked-in staging postdeploy harness still validated auth and non-admin denial smoke coverage |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Increment tracking JSON remains valid |
| `git diff --check` | Passed with CRLF warnings only | No patch-formatting errors introduced |
| touched-file secret scan with `rg` | Passed with expected local/test-only matches | Only local DB URLs, dummy JWT secrets, bearer-header helpers, and existing credential-variable names matched |

PO/CTO validation:

- accepted for the current bounded slice: the remaining read-only auto-suggestion siblings now reuse the same trusted `Product.vendorScopeKey` boundary, so the covered vendor-safe auto-suggestion family is now title suggestion plus attribute enrichment plus category suggestion
- not accepted as complete: this still does not broaden vendor writes, vendor taxonomy access, vendor governance access, supplier or locale or market or team or assignee enforcement, broader machine-principal coverage, persistent multi-role rollout, full admin-boundary mapping, or universal response redaction
- product claim wording remains:
  - `Vexa PIM now has bounded vendor/object ownership enforcement on the canonical catalog read family plus compliance product-issue reads, auto-suggestion title, attribute-enrichment, and category-suggestion reads, rejection-intelligence score reads, and media asset reads, in addition to runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement, actor-specific delegated-scope activation, bounded admin-boundary enforcement on covered governance routes, category-scoped enforcement on proven catalog and taxonomy surfaces, Shopify publication-target catalog scope enforcement, bounded owner-scope enforcement on marketplace mapping templates, and shared governance provenance redaction on covered API-key, workspace-user, and access-scope reads. It is not yet enterprise-complete across broad vendor enforcement, supplier or locale or market or team or assignee scope enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.`

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because `INC-24 / ST-ACCESS-POLICY-BACKLOG-001` remains in progress and this slice does not complete the story

## 2026-04-28 Bounded Follow-Up: Vendor/Object Ownership Expansion To Media Asset Reads

Scope:

- expanded bounded vendor/object ownership enforcement from canonical catalog reads and compliance product-issue reads into the adjacent media asset read family
- opted the media asset read routes into `vendor` foundation-role access while keeping media writes fail-closed
- passed `effectiveRoles` through the media controller so vendor scope can reach the shared policy engine
- expanded central media scope enforcement so `vendor` is treated as a supported read dimension on media assets
- preserved admin and existing scoped-role behavior while proving vendor allow and deny behavior on owned versus unowned assets

Scope expansion:

- expanded from the initially planned controller and integration-test surface into `apps/api/src/common/access-policy/access-policy.service.ts` and `apps/api/src/media/media.service.ts` because the media read family depended on the shared media scope builder and product access assertions carrying `vendorScopeKey`; without that central ownership signal the new vendor route opt-in would have failed closed for the wrong reason

Files changed in this follow-up:

- `apps/api/src/media/media.controller.ts`
- `apps/api/src/media/media.service.ts`
- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `apps/api/test/integration/delegated-access-scopes.test.cjs`
- `docs/execution/ACCESS_POLICY_EXECUTION_RECORD_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PO_CHECKPOINT_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed after one compile fix | Initial failure came from over-typing `resolveActor()` against full `FastifyRequest`; fixed in `apps/api/src/media/media.controller.ts` without weakening route behavior |
| `npm run test:integration:delegated-access-scopes` | Passed after one real policy fix | Initial failure showed owned vendor media reads were denied because `MediaService` product selects omitted `vendorScopeKey`; fixed by carrying the ownership field through media product access assertions |
| `npm run test:integration:access-policy-remediation` | Passed | Proved vendor allow on owned media list/detail/validation and deny on unowned media detail while keeping vendor writes blocked |
| `npm run guard:sensitive-gets` | Passed | Guard coverage remained stable with authenticated-read and admin-boundary counts unchanged |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Runtime classification and API-client foundation behavior remain intact |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Shared notification redaction remained intact |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy after the backend-only slice |
| `npm run gate:run:increment` | Passed | Increment gate stayed green with the media vendor expansion |
| `npm run gate:run:sprint` | Passed | Sprint gate stayed green with the media vendor expansion |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Staging workflow contract remains intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Postdeploy harness remained green |
| `git diff --check` | Passed with CRLF warnings only | No patch-formatting regressions |
| touched-file secret scan with `rg` | Passed with expected local/test-only matches | No real secrets introduced |

PO/CTO validation:

- accepted for the current bounded slice: vendor/object ownership is now proven on one additional product-backed read family by reusing the trusted `Product.vendorScopeKey` boundary through media assets
- vendors can now read owned media asset lists, asset details, and asset validation results
- vendors remain denied on unowned media assets
- vendor writes, taxonomy, governance, and all other non-proven vendor surfaces remain fail-closed
- not accepted as complete: this is still not broad vendor rollout; `supplier`, `locale`, `market`, `team`, and `assignee` remain unenforced; broader API-client resources, persistent multi-role rollout, full admin-boundary mapping, and universal redaction remain incomplete
- exact product claim wording:
  - `Vexa PIM now has bounded vendor/object ownership enforcement on the canonical catalog read family plus compliance product-issue reads and media asset reads, in addition to runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement, actor-specific delegated-scope activation, bounded admin-boundary enforcement on covered governance routes, category-scoped enforcement on proven catalog and taxonomy surfaces, Shopify publication-target catalog scope enforcement, bounded owner-scope enforcement on marketplace mapping templates, and shared governance provenance redaction on covered API-key, workspace-user, and access-scope reads. It is not yet enterprise-complete across broad vendor enforcement, supplier or locale or market or team or assignee scope enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.`

Rollback notes:

- revert only the `FoundationRoleAccess("vendor")` opt-in on the media read routes and the supporting media read-scope changes if a proven regression shows those routes do not actually derive ownership through `Product.vendorScopeKey`
- keep the delegated-scope and remediation assertions so future vendor widening on media must remain explicit and reviewed
- do not widen vendor media writes from this slice; that would require separate object-safe edit proof

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because `ST-ACCESS-POLICY-BACKLOG-001` remains an in-progress unlocked backlog stream rather than a completed bounded story

## 2026-04-28 Bounded Follow-Up: Vendor/Object Ownership Expansion To Rejection Score Reads

Scope:

- expanded bounded vendor/object ownership enforcement from the canonical catalog family, compliance product-issue reads, and media asset reads into the adjacent rejection-intelligence score read family
- opted `GET /rejection-intelligence/products/:id/score` into `vendor` foundation-role access
- passed `effectiveRoles` through the rejection-intelligence controller so vendor scope can reach the shared policy engine
- preserved reviewer access and existing human-only API-client behavior while proving vendor allow and deny behavior through the same trusted product boundary

Scope expansion:

- expanded from the initially planned controller and integration-test surface into `apps/api/src/rejection-intelligence/rejection-intelligence.service.ts` because the service-level `assertProductAccess()` call needed to carry `vendorScopeKey`; without that persisted ownership field the new vendor route opt-in would have failed closed even for owned resources

Files changed in this follow-up:

- `apps/api/src/rejection-intelligence/rejection-intelligence.controller.ts`
- `apps/api/src/rejection-intelligence/rejection-intelligence.service.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `apps/api/test/integration/delegated-access-scopes.test.cjs`
- `docs/execution/ACCESS_POLICY_EXECUTION_RECORD_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PO_CHECKPOINT_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with vendor-safe rejection-score route updates |
| `npm run test:integration:delegated-access-scopes` | Passed after sequential rerun | One false failure came from the known shared `apps/api/dist` artifact race when commands were launched together; sequential rerun proved the real behavior |
| `npm run test:integration:access-policy-remediation` | Passed after sequential rerun | Proved vendor allow on owned rejection-score reads and deny on unowned rejection-score reads |
| `npm run guard:sensitive-gets` | Passed | Guard coverage remained stable after changing the route classification to `scope_filtered` |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Runtime classification and API-client foundation behavior remained intact |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Shared notification redaction remained intact |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy after the backend-only slice |
| `npm run gate:run:increment` | Passed | Increment gate stayed green with the rejection-score vendor expansion |
| `npm run gate:run:sprint` | Passed | Sprint gate stayed green with the rejection-score vendor expansion |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Staging workflow contract remained intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Postdeploy harness remained green |
| `git diff --check` | Passed with CRLF warnings only | No patch-formatting regressions |
| touched-file secret scan with `rg` | Passed with expected local/test-only matches | No real secrets introduced |

PO/CTO validation:

- accepted for the current bounded slice: vendor/object ownership is now proven on one more adjacent product-backed read family by reusing the trusted `Product.vendorScopeKey` boundary through rejection-intelligence score reads
- vendors can now read owned rejection-intelligence scores
- vendors remain denied on unowned rejection-intelligence scores
- vendor writes, taxonomy, governance, and all other non-proven vendor surfaces remain fail-closed
- not accepted as complete: this is still not broad vendor rollout; `supplier`, `locale`, `market`, `team`, and `assignee` remain unenforced; broader API-client resources, persistent multi-role rollout, full admin-boundary mapping, and universal redaction remain incomplete
- exact product claim wording:
  - `Vexa PIM now has bounded vendor/object ownership enforcement on the canonical catalog read family plus compliance product-issue reads, rejection-intelligence score reads, and media asset reads, in addition to runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement, actor-specific delegated-scope activation, bounded admin-boundary enforcement on covered governance routes, category-scoped enforcement on proven catalog and taxonomy surfaces, Shopify publication-target catalog scope enforcement, bounded owner-scope enforcement on marketplace mapping templates, and shared governance provenance redaction on covered API-key, workspace-user, and access-scope reads. It is not yet enterprise-complete across broad vendor enforcement, supplier or locale or market or team or assignee scope enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.`

Rollback notes:

- revert only the `FoundationRoleAccess("vendor")` opt-in on `GET /rejection-intelligence/products/:id/score` and the service-level ownership propagation if a proven regression shows that rejection-score reads should not inherit the same trusted product boundary as the canonical catalog family
- keep the delegated-scope and remediation assertions so future vendor widening on AI or score-based read families remains explicit and reviewed
- do not widen vendor writes or AI repair behavior from this slice; those would require separate edit-safe proof

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because `ST-ACCESS-POLICY-BACKLOG-001` remains an in-progress unlocked backlog stream rather than a completed bounded story

## 2026-04-28 Bounded Follow-Up: Shared Governance Provenance Redaction

Scope:

- expanded shared read-response redaction beyond catalog, dashboard, and notifications into security-governance reads
- converted the following admin governance read families to explicit shared read policies with central redaction:
  - `GET /admin/workspace/users`
  - `GET /admin/workspace/access-scopes`
  - `GET /admin/api-keys`
- preserved existing admin-boundary enforcement and API-client denial behavior
- kept the redaction bounded to provenance fields only: `createdBy` is now redacted for `system_admin` while retained for `super_admin` and legacy `admin`

Files changed in this follow-up:

- `apps/api/src/common/rbac/read-access-policy.decorator.ts`
- `apps/api/src/common/rbac/read-access-policy.interceptor.ts`
- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/src/api-keys/api-keys.controller.ts`
- `apps/api/src/workspace-users/workspace-users.controller.ts`
- `apps/api/src/workspace-users/workspace-access-scopes.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with the new governance redaction policies and interceptor actor-role propagation |
| `npm run test:integration:access-policy-remediation` | Failed, then passed | First failure was a real regression: `super admin allowed scope mutation failed: expected 201, got 500`; root cause was a duplicate brand-scope fixture introduced by this slice in `apps/api/test/integration/access-policy-remediation.test.cjs`; fixed by using a unique scope value for the earlier boundary read-redaction proof and reran successfully |
| `npm run guard:sensitive-gets` | Passed | Guard now validates the added governance redaction policies; coverage remained `authenticatedReadRoutes=71`, `authenticatedRoutes=158`, `publicRoutes=19`, `adminBoundaryCheckedRoutes=46` |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Runtime read-classification and API-client baseline behavior remained intact |
| `npm run test:integration:delegated-access-scopes` | Passed | Delegated ownership, category, brand, and vendor scope behavior remained intact after the shared-redaction slice |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Existing shared notification redaction still behaves correctly |
| `npm run build --workspace @pim1/web` | Passed | No web regression from the backend-only governance redaction slice |
| `npm run gate:run:increment` | Passed | Increment gate stayed green with the governance redaction expansion |
| `npm run gate:run:sprint` | Passed | Sprint gate stayed green with the governance redaction expansion |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Staging workflow contract remained intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Staging postdeploy validation remained green |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Increment tracking JSON remained valid |
| `git diff --check` | Passed with CRLF warnings only | No patch-format errors |
| touched-file secret scan with `rg` | Passed with expected local/test-only matches | Only local DB URL and API-key variable-name matches were found; no real credentials were introduced |

PO/CTO validation:

- accepted for the current bounded slice:
  - shared response redaction is now real on API-key governance, workspace-user governance, and workspace access-scope governance reads
  - `system_admin` is still allowed to manage the covered security-governance routes, but provenance fields such as `createdBy` are centrally redacted
  - `super_admin` and legacy `admin` retain the full provenance fields on the covered routes
  - existing admin-boundary, delegated-scope, vendor-foundation, and API-client guardrails remained intact
- not accepted as complete:
  - this is a partial shared-redaction expansion, not universal response redaction
  - broader vendor rollout, future scope enforcement, multi-role persistence, broader API-client scope coverage, and full admin-boundary mapping remain open
- product claim wording:
  - `Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement, actor-specific delegated-scope activation, bounded admin-boundary enforcement on covered governance routes, category-scoped enforcement on proven catalog and taxonomy surfaces, Shopify publication-target catalog scope enforcement, bounded owner-scope enforcement on marketplace mapping templates, bounded vendor/object ownership enforcement on the canonical catalog read family, and shared governance provenance redaction on covered API-key, workspace-user, and access-scope reads. It is not yet enterprise-complete across broad vendor enforcement, supplier or locale or market or team or assignee scope enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.`

Rollback notes:

- revert only the three governance read policies and the central provenance-redaction helper if a proven operational requirement shows `system_admin` must retain `createdBy` on those exact payloads
- keep the remediation assertions that distinguish `system_admin` from `super_admin` so any future governance-visibility broadening remains explicit and reviewed
- do not loosen the admin-boundary or API-client denial behavior while rolling back provenance redaction

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because `ST-ACCESS-POLICY-BACKLOG-001` remains an in-progress backlog stream

## 2026-04-28 Bounded Follow-Up: Vendor/Object Ownership Expansion To Compliance Product-Issue Reads

Scope:

- expanded the previously validated vendor/object ownership boundary from canonical catalog reads into one adjacent product-backed read family
- opted `GET /compliance/products/:id/issues` into bounded vendor access
- preserved vendor write denial, vendor taxonomy denial, and all other non-proven vendor surfaces as fail-closed
- preserved category-manager partial unblocking, admin-boundary work, API-client coverage, and shared governance provenance redaction

Files changed in this follow-up:

- `apps/api/src/compliance/compliance.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `apps/api/test/integration/delegated-access-scopes.test.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with the bounded vendor opt-in on compliance product-issue reads |
| `npm run test:integration:delegated-access-scopes` | Passed | Proved `vendor_scope_extends_to_owned_compliance_issue_reads` while preserving existing scope-intersection behavior |
| `npm run test:integration:access-policy-remediation` | Failed, then passed | First failure was a real test-assumption mismatch: `expected vendor owned compliance issues payload, got []`; root cause was the remediation fixture not guaranteeing open issues on the owned product; fixed by asserting the correct route contract (`200` plus array payload) rather than forcing issue count; reran successfully |
| `npm run guard:sensitive-gets` | Passed | No classification or API-client coverage regression |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Runtime classification and machine-principal baseline behavior remained intact |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Existing centralized notification redaction remained intact |
| `npm run build --workspace @pim1/web` | Passed | No web regression from the backend-only vendor slice |
| `npm run gate:run:increment` | Passed | Increment gate remained green |
| `npm run gate:run:sprint` | Passed | Sprint gate remained green |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Staging workflow contract remained intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Staging postdeploy contract remained intact |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Increment tracking JSON remained valid |
| `git diff --check` | Passed with CRLF warnings only | No patch-format errors |
| touched-file secret scan with `rg` | Passed with expected local/test-only matches | Only local DB URL and API-key variable-name matches were found; no real credentials introduced |

PO/CTO validation:

- accepted for the current bounded slice:
  - vendor/object ownership is now proven on one additional product-backed read family: compliance product-issue reads
  - vendor can read owned product issues
  - vendor is denied unowned product issues
  - mixed delegated-scope intersections remain enforced through the existing product access assertion
  - vendor writes, taxonomy access, governance routes, and other non-proven vendor surfaces remain fail-closed
- not accepted as complete:
  - this is still not broad vendor rollout
  - it does not complete supplier, locale, market, team, or assignee enforcement
  - it does not complete broader API-client resource coverage, persistent multi-role authorization, full admin-boundary mapping, or universal response redaction
- product claim wording:
  - `Vexa PIM now has bounded vendor/object ownership enforcement on the canonical catalog read family plus compliance product-issue reads, in addition to runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement, actor-specific delegated-scope activation, bounded admin-boundary enforcement on covered governance routes, category-scoped enforcement on proven catalog and taxonomy surfaces, Shopify publication-target catalog scope enforcement, bounded owner-scope enforcement on marketplace mapping templates, and shared governance provenance redaction on covered API-key, workspace-user, and access-scope reads. It is not yet enterprise-complete across broad vendor enforcement, supplier or locale or market or team or assignee scope enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.`

Rollback notes:

- revert only the compliance route foundation-role opt-in if a proven vendor workflow regression appears there
- keep the delegated-scope and remediation proofs so any future widening of vendor access continues to require explicit evidence
- do not widen vendor write or taxonomy access as part of any rollback; those surfaces should remain fail-closed until separately proven

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because `ST-ACCESS-POLICY-BACKLOG-001` remains an in-progress backlog stream

## 2026-04-28 Bounded Follow-Up: Vendor/Object Ownership Foundation On Canonical Catalog Reads

Scope:

- added a minimal persisted vendor ownership field to `Product` with additive migration safety
- allowed `vendor` delegated-scope assignments to be stored as a real foundation dimension
- enforced vendor/object ownership on the canonical catalog product read family only:
  - `GET /catalog/products`
  - `GET /catalog/products/search`
  - `GET /catalog/products/:id`
  - `GET /catalog/products/:id/variants`
- preserved fail-closed behavior for vendor writes and non-proven vendor surfaces
- kept vendor ownership data redacted from read payloads

Files changed in this follow-up:

- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260428131500_add_product_vendor_scope_key/migration.sql`
- `apps/api/src/catalog/dto/create-product.dto.ts`
- `apps/api/src/catalog/dto/update-product.dto.ts`
- `apps/api/src/catalog/catalog.controller.ts`
- `apps/api/src/catalog/catalog.service.ts`
- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `apps/api/test/integration/delegated-access-scopes.test.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run prisma:generate` | Passed | Prisma client regenerated with `Product.vendorScopeKey` |
| `npm run build --workspace @pim1/api` | Failed once, then passed | First failure was a tooling race because Prisma generate and API build were started together; sequential rerun succeeded |
| `npm run test:integration:delegated-access-scopes` | Failed twice, then passed | First failure was a stale test expecting vendor assignments to remain rejected. Second failure found a real bug: product updates were silently clearing `vendorScopeKey` when omitted. Fix preserved existing ownership on update and final run proved owned-read enforcement plus category/brand/vendor intersection |
| `npm run test:integration:access-policy-remediation` | Failed twice, then passed | First failure found missing vendor foundation-role opt-in on `GET /catalog/products/:id/variants`. Second failure found `POST /catalog/products` had been accidentally widened to vendor during route patching. Both controller metadata issues were corrected |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Foundation coverage remains intact |
| `npm run guard:sensitive-gets` | Passed | Classification and API-client coverage remain intact while vendor path stays bounded to catalog reads |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Notification redaction coverage remains intact |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy with backend-only vendor slice |
| `npm run gate:run:increment` | Passed | Increment core gates remained green |
| `npm run gate:run:sprint` | Passed | Sprint core gates remained green |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Staging workflow contract remains intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Postdeploy harness remains green |
| `git diff --check` | Passed with CRLF warnings only | No patch-formatting regressions |
| touched-file secret scan with `rg` | Passed with expected test-only matches | Only local DB URLs, demo passwords, and existing test-token patterns matched |

PO/CTO validation:

- accepted for the current bounded slice: one trustworthy vendor/object ownership source now exists on `Product`, vendor scope is enforced on the canonical catalog read family, vendors can read owned resources, vendors are denied unowned resources, category plus vendor intersection is proven in delegated access, and vendor stays blocked on writes and non-proven paths
- not accepted as complete: this is not broad vendor rollout, taxonomy and other non-catalog vendor surfaces remain blocked, supplier or locale or market or team or assignee enforcement remain incomplete, persistent multi-role rollout remains incomplete, full admin-boundary mapping remains incomplete, broader API-client resources remain incomplete, and universal response redaction remains incomplete
- product claim wording:
  - Vexa PIM now has bounded vendor/object ownership enforcement on one proven product-backed catalog read path, in addition to runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement, actor-specific delegated-scope activation, bounded admin-boundary enforcement on covered governance routes, category-scoped enforcement on proven catalog and taxonomy surfaces, Shopify publication-target catalog scope enforcement, and owner-scope enforcement on marketplace mapping templates. It is not yet enterprise-complete across broad vendor enforcement, supplier or locale or market or team or assignee scope enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.

Rollback notes:

- revert only the vendor additions on canonical catalog read routes and `Product.vendorScopeKey` persistence if regression proof shows the ownership source is untrustworthy
- preserve the fail-closed behavior for vendor writes and non-proven routes even if this bounded read path is revisited
- preserve the update-path fix that keeps existing `vendorScopeKey` values when updates omit the field, because clearing ownership implicitly would reintroduce false denials and unsafe drift

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because `ST-ACCESS-POLICY-BACKLOG-001` remains in progress and the broader authorization backlog is not complete yet

## 2026-04-28 Bounded Follow-Up: Owner-Scoped Marketplace Mapping Templates

Scope:

- reviewed the remaining blockers as PO and selected the next critical-path ownership slice instead of another generic route pass
- turned `owner` from “representable only” into real bounded enforcement on marketplace mapping-template resources that already persist trustworthy `createdBy`
- preserved the category-scoped foundation work and kept `vendor` blocked because the product data model still does not prove a vendor boundary
- fixed the mapping-manager integration harness so it logs in with a workspace slug and checked-in test password, matching the current auth contract

Files changed in this follow-up:

- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/src/marketplace/marketplace.service.ts`
- `apps/api/test/integration/delegated-access-scopes.test.cjs`
- `apps/api/test/integration/mapping-manager.test.cjs`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with owner-scope storage and marketplace-template ownership enforcement |
| `npm run test:integration:delegated-access-scopes` | Passed | New proof: owner-scoped mapping templates require ownership plus category/channel intersection |
| `node apps/api/test/integration/mapping-manager.test.cjs` | Failed first, then passed | First failure was stale auth-harness drift (`WORKSPACE_NOT_FOUND` then `INVALID_CREDENTIALS`); fixed by adding workspace slug and `PIM_AUTH_PASSWORD` to the harness |
| `npm run guard:sensitive-gets` | Passed | Sensitive GET guard remained green; no weakening of runtime classification |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Foundation behavior unchanged |
| `npm run test:integration:access-policy-remediation` | Passed | Broader access-policy regression suite remained green |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Existing centralized notification redaction remained intact |
| `npm run build --workspace @pim1/web` | Passed | No web regression from backend-only slice |
| `npm run gate:run:increment` | Passed | Increment gate stayed green after the owner-scope slice |
| `npm run gate:run:sprint` | Passed after longer sequential rerun | First run hit shell timeout only; no product regression was indicated in the log |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Staging workflow contract remains intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Postdeploy harness still validates login, revocation, and non-admin denials |
| `git diff --check` | Passed | CRLF warnings only |
| touched-file secret scan with `rg` | Passed with expected local test-only matches | Only local DB URL, local dev secrets, and bearer-header test strings matched |

PO/CTO validation:

- accepted for the current bounded slice:
  - `owner` scope assignments are now storable instead of universally blocked
  - marketplace mapping-template list, get, update, clone, and delete now enforce owned-resource access when `owner` scope is active
  - template creation and default-template switching now preserve owner boundaries instead of mutating unrelated templates
  - delegated-access coverage proves allow/deny behavior under owner plus category/channel intersection
- not accepted as complete:
  - this is not broad ownership enforcement across all resources
  - `vendor` is still blocked because the product model still has no trustworthy vendor/object boundary
  - `supplier`, `locale`, `market`, `team`, and `assignee` remain representable but unenforced
  - multi-role persistence, broader machine-principal resources, full admin-boundary mapping, and shared redaction are still pending
- product claim wording now is:
  - Vexa PIM now has runtime-enforced authenticated-read classification, covered catalog API-client scope enforcement, actor-specific delegated-scope activation, bounded live admin-boundary enforcement on covered governance routes, fail-closed handling for unsupported future scope dimensions on covered product-backed paths, Shopify publication-target catalog scope enforcement, partial safe unblocking of `category_manager` on proven category-scoped catalog and taxonomy surfaces, and bounded owner-scope enforcement on marketplace mapping templates that persist trustworthy ownership. It is not yet enterprise-complete across vendor/object ownership enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.

Rollback notes:

- revert only the owner-scope storage allowance and marketplace-template ownership checks if a proven business requirement needs shared template visibility for owner-scoped actors
- keep the delegated-access proof and mapping-manager harness fixes so future ownership changes remain explicit and regression-tested
- do not relax `vendor` blocking based on this slice; it did not add vendor/object enforcement

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because `ST-ACCESS-POLICY-BACKLOG-001` remains in progress and this slice does not complete the overall backlog

## 2026-04-28 Bounded Follow-Up: Category-Scoped Foundation Role Enforcement

Scope:

- enforced blocked foundation roles by default across normal RBAC routes, not only admin-boundary routes
- explicitly opted `category_manager` into the catalog and taxonomy surfaces that can already prove category scope safely
- fixed policy-actor propagation so scoped foundation roles no longer inherit legacy-admin global bypass inside catalog and taxonomy enforcement
- fixed a deeper scope-engine blocker where active scope dimensions were resolved tenant-wide instead of actor-specific
- expanded remediation and delegated-access integration coverage to prove:
  - `category_manager` is allowed only on scoped catalog and taxonomy surfaces
  - `category_manager` is denied out of scope and denied hierarchy mutation
  - `vendor` remains blocked until real vendor/object enforcement exists
  - actor-specific scope activation replaces the old cross-user scope-coupling bug

Scope expansion:

- expanded from the original test-only proof plan into:
  - `apps/api/src/common/access-policy/access-policy.service.ts`
  - `apps/api/src/catalog/catalog.controller.ts`
  - `apps/api/src/catalog/catalog.service.ts`
  - `apps/api/src/taxonomy/taxonomy.controller.ts`
  - `apps/api/src/taxonomy/taxonomy.module.ts`
  - `apps/api/src/taxonomy/taxonomy.service.ts`
- reason: focused remediation exposed two real regressions that had to be fixed in source, not hidden in tests:
  - missing `AccessPolicyModule` wiring in `TaxonomyModule`
  - tenant-global scope activation causing one user’s assignments to constrain unrelated users

Files changed in this follow-up:

- `apps/api/src/common/rbac/foundation-role-access.decorator.ts`
- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/src/catalog/catalog.controller.ts`
- `apps/api/src/catalog/catalog.service.ts`
- `apps/api/src/taxonomy/taxonomy.controller.ts`
- `apps/api/src/taxonomy/taxonomy.module.ts`
- `apps/api/src/taxonomy/taxonomy.service.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `apps/api/test/integration/delegated-access-scopes.test.cjs`
- `docs/execution/ACCESS_POLICY_EXECUTION_RECORD_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PO_CHECKPOINT_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled after scoped foundation-role enforcement and taxonomy module wiring |
| `npm run test:integration:access-policy-remediation` | Failed, then passed | First failure: Nest DI boot regression because `TaxonomyModule` did not import `AccessPolicyModule`; fixed in `apps/api/src/taxonomy/taxonomy.module.ts`. Second failure: `category_manager` still inherited admin payload visibility because redaction keyed off legacy app role only; fixed centrally in `AccessPolicyService`. Final run proved scoped allow/deny behavior |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Runtime authenticated-read enforcement and API-client route policy still intact |
| `npm run guard:sensitive-gets` | Passed | Guardrail remained green with `authenticatedReadRoutes=71`, `authenticatedRoutes=158`, `publicRoutes=19`, `adminBoundaryCheckedRoutes=46` |
| `npm run test:integration:delegated-access-scopes` | Failed, then passed | First failure exposed the actor-specific scope activation change: old test assumptions depended on tenant-global scope activation. Updated the suite to assert the new actor-specific semantics and preserved fail-closed behavior where connector preview still needs explicit connector permission grants |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Shared notification redaction and notification workflows remained intact |
| `npm run build --workspace @pim1/web` | Passed | Web build stayed green; no frontend changes required |
| `npm run gate:run:increment` | Timed out once, then passed | First failure was shell timeout only; reran sequentially with a longer timeout and the gate completed green |
| `npm run gate:run:sprint` | Passed | Sprint gate completed green |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deploy workflow contract remained intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Staging postdeploy harness remained intact |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Increment-state JSON still valid |
| `git diff --check` | Passed with CRLF warnings only | No patch-formatting errors |
| touched-file secret scan with `rg` | Passed with expected local/test-only matches | Only local Postgres URLs, local env defaults, and bearer-header test strings matched |

PO/CTO validation:

- accepted for the current bounded slice:
  - the access-policy engine no longer activates scope dimensions tenant-wide for unrelated users
  - `category_manager` is now partially and safely unblocked on provable category-scoped catalog and taxonomy surfaces
  - `category_manager` remains denied on hierarchy mutation and non-opted-in routes
  - `vendor` remains fail-closed and blocked until true vendor/object enforcement exists
- not accepted as complete:
  - this does not complete ownership enforcement for `vendor`, `owner`, `supplier`, `locale`, `market`, `team`, or `assignee`
  - this does not complete persistent multi-role storage rollout
  - this does not complete broader API-client resource coverage beyond the covered catalog family
  - this does not complete universal shared payload redaction
  - this does not complete full admin-boundary mapping
- product claim wording remains:
  - Vexa PIM now has runtime-enforced authenticated-read classification, explicit catalog API-client scope enforcement, actor-specific delegated-scope activation, bounded live admin-boundary enforcement on covered governance routes, fail-closed handling for unsupported future scope dimensions on covered product-backed paths, Shopify publication-target catalog scope enforcement, and partial safe unblocking of `category_manager` on proven category-scoped catalog and taxonomy surfaces. It is not yet enterprise-complete across vendor/object ownership enforcement, persistent multi-role authorization, full API-client resources, full admin-boundary mapping, or universal response redaction.

Rollback notes:

- revert the new `FoundationRoleAccess` use only if a proven category-scoped workflow is blocked unexpectedly on the catalog or taxonomy routes covered here
- keep the actor-specific scope activation fix; reverting that would restore a tenant-global scope coupling bug where one user’s assignments can alter another user’s authorization behavior
- keep `vendor` blocked until the product model exposes a trustworthy vendor/object boundary and tests prove it

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because `ST-ACCESS-POLICY-BACKLOG-001` remains in progress and its acceptance is broader than this bounded slice

## 2026-04-28 Governance Follow-Up: Remove Execution-Policy Barriers

Scope:

- removed the governance barrier where the remaining access-policy backlog had no unlocked story record in `INCREMENT_STATE.json`
- removed the checked-in PO prompt bias that kept defaulting to another narrow admin-boundary slice even after ownership and object-scope enforcement became the real critical path
- preserved the actual security policies that must remain fail-closed, including blocked `category_manager` and `vendor` introduction until enforcement is proven

Files changed in this follow-up:

- `docs/execution/INCREMENT_STATE.json`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | New increment and story record are valid JSON |
| `git diff --check` | Passed | No patch-format or whitespace errors introduced by the governance change |
| `git status --short` | Passed | Worktree remains intentionally dirty from the broader validated access-policy stream; this pass added only governance docs |

PO/CTO validation:

- accepted for the current bounded slice: the access-policy backlog now has a real unlocked story record (`INC-24` / `ST-ACCESS-POLICY-BACKLOG-001`) and the checked-in execution prompt no longer forces repeated admin-boundary micro-slices when ownership or object-scope enforcement is the true blocker
- not accepted as complete: this does not itself implement ownership enforcement, broader machine-principal coverage, persistent multi-role storage, or universal redaction; it removes the process barrier so those code slices can now be executed as the default critical path
- product claim wording remains:

> Vexa PIM now has bounded live admin-boundary enforcement on representative governance routes plus broader billing, dashboard, metrics, audit, outbound-webhook, connector-permission, compliance-rule, marketplace export-governance, and taxonomy product-governance routes, authenticated-read classification, covered catalog API-client scope enforcement, fail-closed handling for unsupported future scope dimensions on covered product-backed paths, and Shopify publication-target catalog scope enforcement. It is not yet enterprise-complete across full admin-boundary mapping, persistent multi-role authorization, ownership-scoped roles, full API-client resources, or universal response redaction.

Rollback notes:

- do not roll back the new unlocked story record unless a replacement tracking mechanism is introduced in the same change
- do not restore the old prompt default that preferred another admin-boundary slice once ownership and object-scope enforcement are the true critical path

Lock update:

- created unlocked tracking for the remaining access-policy stream in `INC-24` / `ST-ACCESS-POLICY-BACKLOG-001`

## 2026-04-28 Bounded Follow-Up: Taxonomy Product-Governance Admin-Boundary Mapping

Scope:

- mapped taxonomy category governance writes to explicit `manage_product_data` admin-boundary enforcement
- mapped taxonomy attribute-definition governance writes to explicit `manage_product_data` admin-boundary enforcement
- extended the sensitive policy guardrail to validate the taxonomy write-governance routes as admin-boundary controlled surfaces
- added focused remediation proof that `product_admin` can perform taxonomy governance while `system_admin` is denied

Files changed in this follow-up:

- `apps/api/src/taxonomy/taxonomy.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with taxonomy admin-boundary write enforcement |
| `npm run guard:sensitive-gets` | Passed | Guardrail now validates `adminBoundaryCheckedRoutes=46` |
| `npm run test:integration:access-policy-remediation` | Passed after sequential rerun | First failure was the known shared `apps/api/dist` artifact race (`API build output not found at ... apps/api/dist/main.js`); no product-code regression and sequential rerun passed |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Runtime classification, future-scope foundation, and admin-boundary capability proofs remain intact |
| `npm run test:integration:delegated-access-scopes` | Passed | Scope enforcement and fail-closed future-dimension behavior remain intact |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Shared notification redaction remained healthy |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy with the backend-only taxonomy slice |
| `npm run gate:run:increment *> .tmp-gate-increment.log` | Passed | Increment gate stayed green with `INCREMENT_CORE_GATES totalSteps=16` |
| `npm run gate:run:sprint *> .tmp-gate-sprint.log` | Passed | Sprint gate stayed green with `SPRINT_CORE_GATES totalSteps=14` |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Staging workflow contract remained intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Checked-in postdeploy harness remained healthy |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Increment state file is still valid JSON |
| `git diff --check` | Passed with CRLF warnings only | No whitespace or patch-format regressions |
| touched-file secret scan with `rg`/`Select-String` | Passed with expected local test-only matches | Only local DB URLs, fixture secrets, and token variable names matched; no real credentials were introduced |

PO/CTO validation:

- accepted for the current bounded slice: taxonomy category and attribute governance writes now enforce `manage_product_data`, `product_admin` is proven allowed, `system_admin` is proven denied, and the admin-boundary guardrail coverage expanded without reopening already passing governance slices
- not accepted as complete: this is still not full admin-boundary mapping across every remaining settings, connector-governance, operational-governance, and marketplace-governance route; persistent multi-role storage, broader machine-principal resource coverage, ownership enforcement, and broader shared redaction remain incomplete
- product claim wording remains:

> Vexa PIM now has bounded live admin-boundary enforcement on representative governance routes plus broader billing, dashboard, metrics, audit, outbound-webhook, connector-permission, compliance-rule, marketplace export-governance, and taxonomy product-governance routes, authenticated-read classification, covered catalog API-client scope enforcement, fail-closed handling for unsupported future scope dimensions on covered product-backed paths, and Shopify publication-target catalog scope enforcement. It is not yet enterprise-complete across full admin-boundary mapping, persistent multi-role authorization, ownership-scoped roles, full API-client resources, or universal response redaction.

Rollback notes:

- revert only the taxonomy write-route `AdminBoundaryAccess` decorators if a proven product requirement shows taxonomy governance must move to another boundary capability
- keep the remediation proofs and guardrail entries so future taxonomy-governance boundary changes remain explicit and reviewed
- if later ownership work narrows taxonomy governance further for `category_manager`, add that as an explicit capability or scope proof rather than widening the current boundary silently

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-28 Bounded Follow-Up: Remaining Connector and Marketplace Admin-Boundary Mapping

Scope:

- mapped the remaining admin-only marketplace mapping-archive governance route to `manage_product_data`
- mapped the remaining admin-only connector installation record deletion route to `manage_security`
- expanded remediation proof and guardrail coverage for the new boundary-decorated routes
- updated the checked-in pending-backlog PO prompt to make this connector-and-marketplace governance pattern the next default continuation inside the admin-boundary backlog

Files changed in this follow-up:

- `apps/api/src/connector-installer/connector-installer.controller.ts`
- `apps/api/src/marketplace/marketplace.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`
- `docs/execution/ACCESS_POLICY_EXECUTION_RECORD_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PO_CHECKPOINT_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with the new connector and marketplace admin-boundary decorators |
| `npm run guard:sensitive-gets` | Passed | Guardrail now checks `adminBoundaryCheckedRoutes=40`, including mapping archive and connector installation record deletion |
| `npm run test:integration:access-policy-remediation` | Failed first, then passed | First failure was a known shared-`dist` race from parallel execution; sequential rerun exposed a real mapping fixture issue (`target_category_required`), which was fixed by adding the required category mapping data to the archive proof payload |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Foundation enforcement remains intact, including admin-boundary capability separation |
| `npm run test:integration:delegated-access-scopes` | Passed | Scope-enforcement slice stayed green after the new admin-boundary mapping |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Existing central redaction proof remained green |
| `npm run build --workspace @pim1/web` | Passed | Web build stayed healthy; no frontend changes were required |
| `npm run gate:run:increment *> .tmp-gate-increment.log` | Timed out once, then passed | Only the shell timeout was hit; the sequential rerun completed with `INCREMENT_CORE_GATES totalSteps=16` |
| `npm run gate:run:sprint *> .tmp-gate-sprint.log` | Passed | Sprint gate completed with `SPRINT_CORE_GATES totalSteps=14` |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Staging deploy workflow contract remained valid |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Postdeploy smoke harness remained valid |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Increment state JSON still parses cleanly |
| `git diff --check` | Passed with CRLF warnings only | No patch-formatting failures |
| touched-file secret scan with `rg` | Passed with expected local/test-only matches | Only local DB fallback and token/helper strings matched; no real secrets were introduced |

PO/CTO validation:

- accepted for this bounded slice:
  - marketplace mapping archive governance now enforces `manage_product_data`
  - connector installation record deletion now enforces `manage_security`
  - `product_admin` allow and `system_admin` deny are proven for the new marketplace archive governance route
  - `product_admin` deny and `system_admin` allow are proven for connector installation record deletion
- not accepted as complete:
  - this is still not the full admin-boundary mapping across every remaining settings, connector, operational, and marketplace governance route
  - persistent multi-role rollout, broader API-client resources, ownership enforcement, and universal shared redaction remain incomplete
- product claim wording remains:

> Vexa PIM now has bounded live admin-boundary enforcement on representative governance routes plus broader billing, dashboard, metrics, audit, outbound-webhook, connector-permission, compliance-rule, and marketplace export-governance routes, authenticated-read classification, covered catalog API-client scope enforcement, fail-closed handling for unsupported future scope dimensions on covered product-backed paths, and Shopify publication-target catalog scope enforcement. It is not yet enterprise-complete across full admin-boundary mapping, persistent multi-role authorization, ownership-scoped roles, full API-client resources, or universal response redaction.

Rollback notes:

- if a legitimate system-level integration support workflow is blocked on connector installation record deletion, revisit only that route with direct failing evidence before widening the capability
- do not remove the new admin-boundary decorators without equivalent policy replacement and the same remediation proof
- keep the guardrail expectations and added remediation assertions so these two routes cannot silently drift back to legacy-admin-only behavior

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-28 Bounded Follow-Up: Product-Governance Admin-Boundary Mapping

Scope:

- updated the checked-in pending-blocker PO policy so the next default admin-boundary sub-slice explicitly targets unmapped admin-only product-governance routes before broader redesign work
- mapped compliance-rule governance to explicit `manage_product_data` admin-boundary capability
- mapped marketplace export-job and marketplace simulation governance to explicit `manage_product_data` admin-boundary capability
- extended remediation and guardrail coverage so these routes now prove `product_admin` allow, `system_admin` deny, and continued low-privilege denial behavior

Files changed in this follow-up:

- `apps/api/src/compliance/compliance.controller.ts`
- `apps/api/src/marketplace/marketplace.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`
- `docs/execution/ACCESS_POLICY_EXECUTION_RECORD_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PO_CHECKPOINT_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with product-governance boundary decorators |
| `npm run guard:sensitive-gets` | Passed | Guardrail now checks 38 admin-boundary route expectations |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Foundation behavior stayed intact |
| `npm run test:integration:access-policy-remediation` | Passed | Added proof for product-admin allow and system-admin deny on compliance-rule and export-governance routes |
| `npm run test:integration:delegated-access-scopes` | Passed | Delegated scope behavior unchanged |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Notification redaction behavior unchanged |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy without UI changes |
| `npm run gate:run:increment *> .tmp-gate-increment.log` | Passed | Final log reports `INCREMENT_CORE_GATES totalSteps=16` |
| `npm run gate:run:sprint *> .tmp-gate-sprint.log` | Passed | Final log reports `SPRINT_CORE_GATES totalSteps=14` |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Workflow contract remains intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Staging postdeploy verification remains intact |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Increment state file remains valid |
| `git diff --check` | Passed with warnings | CRLF warnings only |
| touched-file secret scan with `rg` | Passed with expected local matches | Only the local Postgres integration URL matched; no real secrets introduced |

PO/CTO validation:

- accepted for the current bounded slice: the pending-blocker policy now explicitly drives unmapped admin-only product-governance routes toward `manage_product_data`; compliance-rule governance is now product-admin scoped instead of plain legacy admin; and marketplace export-job and simulation governance now enforce product-admin versus system-admin boundaries with validated route proof
- not accepted as complete: this does not finish all remaining admin-boundary mapping across settings, billing, connector, dashboard, and operational governance routes; persistent multi-role storage rollout remains pending; broader machine-principal coverage remains partial; ownership-scoped blocked roles remain blocked; and shared payload redaction remains partial
- product claim wording remains: Vexa PIM now has bounded live admin-boundary enforcement on representative governance routes plus broader billing, dashboard, metrics, audit, outbound-webhook, connector-permission, compliance-rule, and marketplace export-governance routes, authenticated-read classification, covered catalog API-client scope enforcement, fail-closed handling for unsupported future scope dimensions on covered product-backed paths, and Shopify publication-target catalog scope enforcement. It is not yet enterprise-complete across full admin-boundary mapping, persistent multi-role authorization, ownership-scoped roles, full API-client resources, or universal response redaction.

Rollback notes:

- revert only the new `@AdminBoundaryAccess({ capability: "manage_product_data" })` annotations on compliance-rule or marketplace export-governance routes if a proven operator or product-admin workflow is blocked unexpectedly
- keep the guardrail additions and remediation proofs so future changes to these routes remain explicit and reviewable

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-27 Bounded Follow-Up: Broader Admin-Boundary Route Mapping

Scope:

- expanded live admin-boundary enforcement from the representative governance routes into broader high-risk billing, dashboard, metrics, audit, outbound-webhook, and connector-permission governance surfaces
- preserved existing authenticated-read classification and covered catalog API-client scope enforcement
- added explicit blocked-foundation-role denial proof for `category_manager` and `vendor` on boundary-decorated routes
- tightened the sensitive-GET guard so broader admin-boundary coverage is mechanically checked instead of implied
- fixed a real guardrail parser defect where multi-line decorators caused `AdminBoundaryAccess` coverage to be dropped from validation for otherwise-correct routes

Scope expansion:

- expanded from the prior representative admin-boundary scope into additional governance controllers because the remaining blocker was not another new policy primitive; it was proving the broader route mapping with real guardrail and remediation coverage

Files changed in this follow-up:

- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/src/common/rbac/rbac.guard.ts`
- `apps/api/src/billing/billing.controller.ts`
- `apps/api/src/dashboard/dashboard.controller.ts`
- `apps/api/src/metrics/metrics.controller.ts`
- `apps/api/src/audit/audit.controller.ts`
- `apps/api/src/outbound-webhooks/outbound-webhooks.controller.ts`
- `apps/api/src/connector-installer/connector-installer.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`
- `docs/execution/ACCESS_POLICY_EXECUTION_RECORD_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PO_CHECKPOINT_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`

First failures and fixes:

- `npm run guard:sensitive-gets` first failed with `GET /metrics/kpi-trends is missing AdminBoundaryAccess coverage`
  - root cause: `scripts/validate-sensitive-get-policy.cjs` dropped decorator metadata when a route used multi-line decorators such as `@ApiQuery({ ... })`
  - fix: updated the controller parser to preserve pending decorators across multi-line decorator bodies
- `npm run test:integration:access-policy-remediation` first failed with `API build output not found at ... apps/api/dist/main.js`
  - root cause: accidental parallel execution against the shared `apps/api/dist` artifact
  - fix: reran sequentially and kept the rest of the bundle sequential for the slice
- `npm run test:integration:access-policy-remediation` then failed on `POLICY_SHADOW_MISMATCH`
  - root cause 1: the shadow policy engine denied boundary-decorated routes too early for plain editor, reviewer, and viewer actors instead of deferring to the route role or read-policy path
  - fix 1: aligned `AccessPolicyService.can(...)` with runtime guard behavior so admin-boundary checks only short-circuit when explicit boundary roles or legacy admin fallback are actually relevant
  - root cause 2: the guard shadow bookkeeping labeled some editor-allowed dashboard reads as `ADMIN_BOUNDARY_ALLOWED` even though they were allowed via `@Roles(...)`
  - fix 2: added `resolveAdminBoundaryAllowedReason(...)` so shadow reasons mirror the actual enforcement path

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with broader admin-boundary route mapping and shadow-policy alignment |
| `npm run guard:sensitive-gets` | Passed | Guardrail now validates 71 authenticated read routes, 158 authenticated routes total, and 28 admin-boundary route expectations |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Foundation assertions stayed green after the broader admin-boundary slice |
| `npm run test:integration:access-policy-remediation` | Passed | Added proofs for product vs system admin splits, blocked foundation roles, billing governance, webhook governance, and connector-permission governance |
| `npm run test:integration:delegated-access-scopes` | Passed | Delegated scope behavior remained stable after the guard and policy-service changes |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Notification redaction behavior remained intact |
| `npm run build --workspace @pim1/web` | Passed | Web build stayed healthy without UI changes |
| `npm run gate:run:increment *> .tmp-gate-increment.log` | Passed | First attempt only hit shell timeout; sequential rerun passed with `INCREMENT_CORE_GATES totalSteps=16` |
| `npm run gate:run:sprint *> .tmp-gate-sprint.log` | Passed | Sprint gate passed with `SPRINT_CORE_GATES totalSteps=14` |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deploy workflow contract remains intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Staging postdeploy verification remains intact |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Increment state file remains valid |
| `git diff --check` | Passed with warnings | CRLF conversion warnings only; no diff formatting errors |
| touched-file secret scan with `rg` | Passed with expected local matches | Only local Postgres test URL and a bearer-token error string matched; no real secrets introduced |
| `git status --short` | Passed for inspection | Worktree remains intentionally dirty because earlier validated access-policy backlog files are still in flight |

PO/CTO validation:

- accepted for the current bounded slice: broader live admin-boundary enforcement now covers billing governance, dashboard governance, metrics governance, audit governance, outbound-webhook governance, and connector-permission governance in addition to the previously validated representative routes; blocked foundation roles are now explicitly denied on boundary-decorated routes; and the sensitive-GET guard mechanically checks 28 admin-boundary expectations
- not accepted as complete: this is still not full route-by-route admin-boundary mapping across every settings, billing, connector, dashboard, and operational governance surface; persistent multi-role storage rollout remains incomplete; machine-principal scope modeling remains partial beyond the covered catalog API family; broader ownership-scope enforcement remains incomplete; and shared payload redaction remains partial
- product claim wording remains: Vexa PIM now has bounded live admin-boundary enforcement on representative governance routes plus broader billing, dashboard, metrics, audit, outbound-webhook, and connector-permission governance routes, authenticated-read classification, covered catalog API-client scope enforcement, fail-closed handling for unsupported future scope dimensions on covered product-backed paths, and Shopify publication-target catalog scope enforcement. It is not yet enterprise-complete across full admin-boundary mapping, persistent multi-role authorization, ownership-scoped roles, full API-client resources, or universal response redaction.

Rollback notes:

- revert only the newly added `@AdminBoundaryAccess(...)` annotations on the broader governance routes if a proven setup flow or legitimate operator workflow is blocked unexpectedly
- keep the guardrail parser fix in `scripts/validate-sensitive-get-policy.cjs`; it closes a real validation blind spot and should not be rolled back with route-policy changes
- keep the new remediation assertions for blocked foundation roles and product-vs-system admin boundaries so future route relaxations stay explicit and reviewed

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-27 Foundation Follow-Up: Admin-Boundary Route Enforcement

Scope:

- carried explicit admin-boundary role assignments through local auth and JWT claims so bounded live enforcement can be exercised without a full persistence migration
- added shared `AdminBoundaryAccess` metadata and guard enforcement for representative sensitive governance routes
- enforced bounded live distinctions on:
  - `GET /admin/workspace/users` -> `manage_users`
  - `GET /admin/api-keys` -> `manage_security`
  - `GET /admin/workspace/access-scopes` -> `manage_security`
  - `POST` and `DELETE /admin/workspace/access-scopes` -> explicit `super_admin`, while preserving legacy `admin` fallback for the existing delegated-scope rollout path
- expanded validation so the sensitive-GET guard now checks boundary metadata on those representative routes
- proved end-to-end route behavior for `product_admin`, `system_admin`, and `super_admin`

Files changed in this follow-up:

- `apps/api/src/common/rbac/admin-boundary.decorator.ts`
- `apps/api/src/common/rbac/role-utils.ts`
- `apps/api/src/common/rbac/rbac.guard.ts`
- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/src/auth/auth.service.ts`
- `apps/api/src/auth/jwt.ts`
- `apps/api/src/auth/jwt-auth.guard.ts`
- `apps/api/src/workspace-users/workspace-users.controller.ts`
- `apps/api/src/workspace-users/workspace-access-scopes.controller.ts`
- `apps/api/src/api-keys/api-keys.controller.ts`
- `apps/api/test/integration/access-policy-foundation.test.cjs`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Failed, then passed | First failure was a real compile spillover after adding `assignedRoles` to `ResolvedLoginIdentity`; one password-reset DB auth path still built the old shape. Fixed by adding `assignedRoles: []` in that path, then reran successfully. |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Foundation proof still covers deterministic role resolution, runtime read classification, and explicit API-client scope requirements. |
| `npm run guard:sensitive-gets` | Passed | Guard now validates authenticated-read classification, API-client policy coverage, and boundary coverage for 5 representative governance routes. |
| `npm run test:integration:access-policy-remediation` | Failed twice, then passed | First failure showed a real regression in the test flow: moving a live super-admin scope mutation too early caused downstream viewer product reads to trip scope checks. Fixed by moving that mutation proof later so the established catalog assertions stay isolated. Second failure showed policy shadow mismatches because legacy allow was still recorded as `ROLE_ALLOWED` while policy now returns `ADMIN_BOUNDARY_ALLOWED`; fixed by aligning guard shadow bookkeeping with the new boundary semantics. Final rerun passed. |
| `npm run test:integration:delegated-access-scopes` | Failed, then passed | First failure proved a rollout compatibility break: delegated-scope setup still relies on legacy `admin` for scope mutations. Fixed by restoring legacy-admin fallback on `POST`/`DELETE /admin/workspace/access-scopes` while still denying explicit `system_admin` and allowing explicit `super_admin`. Final rerun passed. |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Existing central redaction proof remained intact. |
| `npm run prisma:generate` | Passed | Prisma client stayed in sync after the auth and guard changes. |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy; this slice was backend and validation only. |
| `npm run gate:run:increment *> .tmp-gate-increment.log` | Passed | `INCREMENT_CORE_GATES totalSteps=16`. |
| `npm run gate:run:sprint *> .tmp-gate-sprint.log` | Passed | `SPRINT_CORE_GATES totalSteps=14`. |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Checked-in deploy workflow contract remained valid. |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Checked-in staging postdeploy harness still validates workspace login, revocation, admin render, non-admin denials, and stale-token rejection. |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Increment tracking file remains valid JSON. |
| `git diff --check` | Passed with CRLF warnings only | No patch-formatting or whitespace errors. |
| touched-file secret scan with `rg` | Passed with expected test-only matches | Matches were JWT helper names, local dummy password/defaults in the integration harness, and existing auth/token variable references; no real secrets were introduced. |

PO/CTO validation:

- accepted for the current bounded slice:
  - representative live admin-boundary enforcement now exists on workspace user governance, access-scope governance, and API-key governance routes
  - explicit boundary principals are now testable end to end through local auth plus JWT claims
  - `product_admin` is denied on system-admin governance routes
  - `system_admin` is allowed on user and security reads but denied on the representative `super_admin`-only access-scope mutation path
  - `super_admin` is allowed on the representative `super_admin`-only access-scope mutation path
  - guardrail coverage now protects these representative routes from silently drifting back to plain `@Roles("admin")` behavior
- not accepted as complete:
  - this is not a full route-by-route admin-boundary rollout across all admin, settings, dashboard, connector, billing, and operational governance surfaces
  - multi-role persistence is still not rolled out beyond local-auth/JWT bridge behavior
  - full machine-principal permission modeling beyond the covered catalog API family remains pending
  - future scope dimensions beyond the already-proven catalog publication-target surface and fail-closed paths remain incomplete
  - broader shared payload redaction remains partial
  - `category_manager` and `vendor` remain blocked
- product claim wording:
  - Vexa PIM now has runtime-enforced authenticated-read classification, explicit API-client scope enforcement on the covered catalog API family, fail-closed protection for unsupported future scope dimensions on covered product-backed resources, real `catalog` scope enforcement on Shopify connector publication targets, and bounded live admin-boundary enforcement on representative governance routes for workspace users, workspace access scopes, and API-key management. It still does not have full enterprise authorization maturity across broad admin-boundary route mapping, machine-principal resources, persistent multi-role rollout, ownership-scope enforcement for blocked roles, or universal payload redaction.

Rollback notes:

- revert only the new `AdminBoundaryAccess` mappings and JWT/local-auth `assignedRoles` propagation if a proven legitimate governance workflow is blocked and cannot be remapped safely
- keep the guardrail coverage and remediation assertions even if route ownership changes, so future boundary relaxations remain explicit and reviewed
- do not roll back the earlier catalog scope and fail-closed foundation work as part of any admin-boundary follow-up unless direct regression evidence points there

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-27 Foundation Follow-Up: Catalog Scope Enforcement For Connector Publication Targets

Scope:

- promoted `catalog` from representable-only to genuinely enforced on the Shopify connector publication-target surface
- allowed `catalog` scope assignment storage through the admin access-scope API while leaving other future dimensions in the fail-closed foundation bucket
- extended connector publication-target reads and writes so catalog-scoped actors only see targets whose `catalogId` matches an assigned scope value
- denied publication-target updates when the requested target is outside the assigned catalog scope or has no provable `catalogId`
- kept other connector routes fail-closed unless they explicitly support the `catalog` dimension

Files changed in this follow-up:

- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/src/connector-installer/connector-installer.service.ts`
- `apps/api/test/integration/delegated-access-scopes.test.cjs`
- `apps/api/test/integration/shopify-publication-targets-api.test.cjs`
- `packages/db/prisma/migrations/20260427153000_expand_access_scope_dimensions/migration.sql`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run prisma:generate` | Passed | Prisma client remained healthy after the additive migration and bounded catalog-scope rollout |
| `npm run build --workspace @pim1/api` | Passed | API compiled with catalog-scope enforcement on connector publication targets |
| `npm run guard:sensitive-gets` | Passed | Authenticated-read and API-client coverage remained intact |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Foundation enforcement and machine-principal scope proofs remained intact |
| `npm run test:integration:access-policy-remediation` | Passed | Existing remediation behavior did not regress |
| `npm run test:integration:delegated-access-scopes` | Failed once, then passed | First failure was a repeated shared-`dist` artifact race from running build and test in parallel; rerun sequentially passed after excluding `catalog` from the still-rejected pending-scope list |
| `node apps/api/test/integration/shopify-publication-targets-api.test.cjs` | Failed once, then passed | First failure was a local DB env fallback bug still pointing to `HOST:5432`; patched the harness to use the same safe local fallback and reran successfully |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Shared notification redaction remained intact |
| `npm run build --workspace @pim1/web` | Passed | No frontend regression from the bounded backend-only rollout |
| `npm run gate:run:increment *> .tmp-gate-increment.log` | Passed | Increment gate completed with `INCREMENT_CORE_GATES totalSteps=16` |
| `npm run gate:run:sprint *> .tmp-gate-sprint.log` | Passed | Sprint gate completed with `SPRINT_CORE_GATES totalSteps=14` |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Staging workflow contract remained intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Postdeploy access-policy smoke remained intact |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Increment state file remained valid JSON |
| `git diff --check` | Passed with CRLF warnings only | No whitespace or patch-format regressions |
| touched-file secret scan with `rg` | Passed with expected local test-only matches | Only local DB fallback strings, dummy JWT secret values, header helpers, and existing credential-variable names matched |

PO/CTO validation:

- accepted for the current bounded slice: `catalog` scope is now truly enforced on Shopify publication-target reads and writes, out-of-scope or catalogless publication targets deny safely, and unsupported future dimensions remain fail-closed elsewhere
- not accepted as complete: this does not make `catalog` a universally enforced scope dimension. It is proven only on connector publication targets today. `vendor`, `owner`, `supplier`, `locale`, `market`, `team`, and `assignee` still remain representable but not broadly enforced, and most connector routes still do not support `catalog`
- product claim wording now becomes: Vexa PIM now enforces authenticated-read classification at runtime, explicit API-client scopes on the catalog API family, fail-closed denial for unsupported or mixed future scope dimensions on product-backed resources, and real `catalog` scope enforcement on Shopify connector publication-target reads and writes. It still does not have full enterprise authorization maturity across broad enforcement of future scope dimensions, multi-role persistence rollout, admin-boundary route mapping, or universal payload redaction.

Rollback notes:

- revert only the catalog-scope handling in connector publication-target routes and the additive enum migration if a proven regression blocks legitimate connector publication workflows
- keep the new focused Shopify publication-target integration proof and delegated-access scope proof so future changes cannot silently relax catalog-scope enforcement
- if broader connector surfaces later claim `catalog` support, require explicit tests per route family rather than inheriting support by assumption

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-27 Foundation Follow-Up: Fail-Closed Unsupported Scope Dimensions On Product Resources

Scope:

- kept the previously validated category and brand product-scope enforcement intact
- added shared fail-closed handling for product-backed resources when an actor carries scope dimensions that the current resource model cannot prove or enforce
- applied that fail-closed check to catalog product list, detail, create or update request validation, and media list or detail paths that derive scope from products
- added the missing additive database migration so the expanded `AccessScopeType` enum is representable in Postgres storage as well as Prisma schema and TypeScript
- extended the delegated-access integration harness to apply the new enum migration and prove unsupported-only and mixed-scope runtime denial on product resources

Files changed in this follow-up:

- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/test/integration/delegated-access-scopes.test.cjs`
- `packages/db/prisma/migrations/20260427153000_expand_access_scope_dimensions/migration.sql`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run prisma:generate` | Passed | Prisma client remained healthy with the additive access-scope enum migration present |
| `npm run build --workspace @pim1/api` | Passed | API compiled with fail-closed unsupported-scope checks on product-backed resources |
| `npm run guard:sensitive-gets` | Passed | Authenticated-read and API-client coverage remained intact; classification coverage unchanged by the scope slice |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Foundation runtime and machine-principal guard proofs remained intact |
| `npm run test:integration:access-policy-remediation` | Passed | Existing remediation behavior did not regress |
| `npm run test:integration:delegated-access-scopes` | Failed first, then passed | First failure was a validation artifact race from running build and test in parallel against `apps/api/dist`; sequential rerun exposed the real issue that Postgres enum `AccessScopeType` still lacked `vendor`; added additive enum migration and delegated-access test migration runner, then reran successfully |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Shared redaction behavior outside catalog remained intact |
| `npm run build --workspace @pim1/web` | Passed | Web build stayed healthy with no frontend changes required |
| `npm run gate:run:increment *> .tmp-gate-increment.log` | Timed out once, then passed | First failure was shell timeout only; longer sequential rerun passed with `INCREMENT_CORE_GATES totalSteps=16` |
| `npm run gate:run:sprint *> .tmp-gate-sprint.log` | Passed | Sprint gate passed with `SPRINT_CORE_GATES totalSteps=14` |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Staging deploy workflow contract remained intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Postdeploy authz smoke remained intact |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Increment state file remained valid JSON |
| `git diff --check` | Passed with CRLF warnings only | No whitespace or patch-format regressions |
| touched-file secret scan with `rg` | Passed with expected local test-only matches | Only local database URL fallback, dummy JWT secret, bearer-header helper, and commercial test header literals matched |

PO/CTO validation:

- accepted for the current bounded slice: unsupported and mixed foundation scope dimensions now fail closed on product-backed resources instead of being silently ignored, the missing Postgres enum rollout for expanded `AccessScopeType` is now checked in, and delegated-access tests prove safe denial for unsupported-only, mixed-scope, and unprovable request cases on catalog resources
- not accepted as complete: this does not mean `vendor`, `owner`, `supplier`, `locale`, `market`, `catalog`, `team`, or `assignee` are generally enforced; it means product-backed resources now deny safely when those dimensions are present and cannot be proven. Real enforcement for those dimensions still needs resource fields, ownership resolution, and route-by-route support
- product claim wording now becomes: Vexa PIM now enforces authenticated-read classification at runtime, requires explicit API-client scopes on the catalog API family, and fail-closes product-backed resource access when unsupported or mixed foundation scope dimensions are present without provable enforcement context. It still does not have full enterprise authorization maturity across real enforcement for future scope dimensions, multi-role persistence rollout, admin-boundary route mapping, or universal payload redaction.

Rollback notes:

- revert only the new product-backed unsupported-scope denial helper and the enum-expansion migration if a proven regression shows legitimate scoped product workflows are being blocked unexpectedly
- keep the delegated-access integration proofs and migration runner so future work cannot regress into silently ignoring unsupported dimensions
- if later resource modeling adds real vendor, owner, supplier, locale, market, catalog, team, or assignee fields, replace fail-closed denial with actual enforcement only after explicit tests prove allow and deny behavior

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-27 Foundation Pass: Policy-Foundation Enforcement Baseline

Scope:

- replaced curated sensitive-read guard behavior with explicit authenticated-route classification and API-client policy discovery across controller metadata
- introduced foundation decorators and guard semantics so authenticated `GET` and `HEAD` routes must declare a classification and every authenticated route must declare an API-client decision
- moved API-key behavior from scattered deny annotations toward explicit default-deny route policy semantics, while preserving explicit catalog API access where already intended
- expanded the scope model contract so future dimensions `vendor`, `owner`, `supplier`, `locale`, `market`, `catalog`, `team`, and `assignee` are representable and safely rejected until enforcement exists
- added transitional multi-role and admin-boundary helpers without changing live database role storage, preserving current runtime compatibility
- centralized read-policy response handling through a global interceptor and extended reusable redaction coverage to notifications metadata in addition to the existing catalog and dashboard payload families

Scope expansion:

- expanded from pure guard and policy-engine files into selected controllers so the new foundation guardrail could auto-discover explicit route classifications and API-client policies instead of relying on a manual allowlist
- briefly expanded into Prisma schema role storage, but reverted the new `AuthIdentity.roles` and `ApiAccessKey.roles` columns in the same pass after integration proof showed they would require a database rollout not yet available in this bounded slice

Files changed in this follow-up:

- `apps/api/src/api-keys/api-keys.controller.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/audit/audit.controller.ts`
- `apps/api/src/auth/jwt-auth.guard.ts`
- `apps/api/src/auto-suggestions/auto-suggestions.controller.ts`
- `apps/api/src/billing/billing.controller.ts`
- `apps/api/src/bulk-edit/bulk-edit.controller.ts`
- `apps/api/src/bulk-import/bulk-import.controller.ts`
- `apps/api/src/catalog/catalog.controller.ts`
- `apps/api/src/catalog/products.controller.ts`
- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/src/common/rbac/api-client-policy.decorator.ts`
- `apps/api/src/common/rbac/rbac.guard.ts`
- `apps/api/src/common/rbac/read-access-policy.decorator.ts`
- `apps/api/src/common/rbac/read-access-policy.interceptor.ts`
- `apps/api/src/common/rbac/role-utils.ts`
- `apps/api/src/common/rbac/roles.ts`
- `apps/api/src/compliance/compliance.controller.ts`
- `apps/api/src/connector-installer/connector-installer.controller.ts`
- `apps/api/src/dashboard/dashboard.controller.ts`
- `apps/api/src/marketplace/marketplace.controller.ts`
- `apps/api/src/marketplace/submissions.controller.ts`
- `apps/api/src/media/media.controller.ts`
- `apps/api/src/metrics/metrics.controller.ts`
- `apps/api/src/notifications/notifications.controller.ts`
- `apps/api/src/ondc/ondc.controller.ts`
- `apps/api/src/outbound-webhooks/outbound-webhooks.controller.ts`
- `apps/api/src/rejection-intelligence/rejection-intelligence.controller.ts`
- `apps/api/src/taxonomy/taxonomy.controller.ts`
- `apps/api/src/workspace-users/dto/create-access-scope-assignment.dto.ts`
- `apps/api/src/workspace-users/workspace-access-scopes.controller.ts`
- `apps/api/src/workspace-users/workspace-users.controller.ts`
- `apps/api/test/integration/access-policy-foundation.test.cjs`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `apps/api/test/integration/delegated-access-scopes.test.cjs`
- `apps/api/test/integration/notifications-center.test.cjs`
- `packages/db/prisma/schema.prisma`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Failed, then passed | First failure proved two real foundation issues: Prisma client types were stale after scope-enum expansion, and `rbac.guard.ts` still had an impossible `api_key` branch. Fixed by running `npm run prisma:generate` and removing the dead branch, then reran successfully. |
| `npm run guard:sensitive-gets` | Passed | New auto-discovery guard validated `authenticatedReadRoutes=70`, `authenticatedRoutes=157`, `publicRoutes=19`, classification coverage, API-client policy coverage, and redaction-handler presence. |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Proved single-role compatibility, deterministic multi-role helper behavior, API-client least-privilege isolation, admin-boundary capability distinction, and scope-schema representation of future dimensions. |
| `npm run test:integration:access-policy-remediation` | Failed, then passed | First failure was a real regression from adding `roles` columns to `AuthIdentity` and `ApiAccessKey` before any database rollout; creating an API key returned 500. Fixed by reverting those new storage columns while keeping code-level multi-role helpers, regenerating Prisma, and rerunning successfully. |
| `npm run test:integration:delegated-access-scopes` | Passed | Added proof that future scope dimensions are representable in the contract and safely rejected until enforcement exists. |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Proved central notification metadata redaction for low-privilege reviewer reads. |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy after the foundation-only backend shift. |
| `npm run gate:run:increment *> .tmp-gate-increment.log` | Timed out once, then passed | First run exceeded the shell timeout while still progressing; no product regression. Sequential rerun with a longer timeout completed green with `INCREMENT_CORE_GATES totalSteps=16`. |
| `npm run gate:run:sprint *> .tmp-gate-sprint.log` | Passed | Sequential run completed green with `SPRINT_CORE_GATES totalSteps=14`. |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Staging deploy workflow contract still includes non-admin trust-boundary and postdeploy verification steps. |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Checked-in staging postdeploy harness still validates workspace login, revocation, admin render, non-admin denials, and stale-token rejection. |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Increment state file remains valid JSON. |
| `git diff --check` | Passed with warnings | Only CRLF normalization warnings in the dirty worktree; no diff formatting failures. |
| touched-file secret scan with `rg` | Passed with expected local/test-only matches | Matches were local dummy passwords, token variable names, and checked-in staging/dev helper strings; no real secrets were introduced. |

PO/CTO validation:

- accepted for this foundation pass:
  - the blocker loop around default authenticated reads is reduced by a real mechanism change: authenticated reads now require explicit classification metadata to satisfy the guardrail script, and newly added authenticated routes must also declare an API-client decision
  - API-client behavior is no longer dependent only on scattered `@DisallowApiClient()` annotations; the guard now applies explicit route policy with API-key default deny unless a route opts into `allowed_with_api_scope`
  - future scope dimensions are now representable in the schema and DTO contract and are safely rejected until enforcement exists, which removes the “not representable” blocker
  - multi-role migration is reduced from “not started” to “code-level foundation implemented, storage rollout pending” through deterministic role resolution helpers that preserve legacy behavior and prevent API-client privilege inheritance
  - admin-boundary foundation now exists at the code-policy level through explicit Product Admin, System Admin, and Super Admin capability helpers and tests, while preserving current live admin behavior
  - central read redaction is more reusable than before because route-level read policies now flow through a global interceptor and notifications became an additional shared redaction family
- not accepted as complete:
  - runtime deny of unclassified authenticated reads is not globally enabled yet; the new guarantee is guardrail-enforced in CI and gates, not universal runtime lockout
  - full API-client permission and scope modeling is still pending; this pass establishes default deny and explicit policy coverage, not route-by-route service scopes for machine principals
  - the new scope dimensions are only representable plus safely rejected; object ownership and actual enforcement logic remain incomplete
  - multi-role storage migration is not rolled out yet because the first attempt proved unsafe without database migration sequencing
  - Product Admin, System Admin, and Super Admin route mapping and enforcement maturity are still incomplete
  - universal redaction remains partial because only covered read-policy families currently have redaction handlers
  - `category_manager` and `vendor` remain blocked because ownership and object-scope enforcement still are not proven
- product claim wording:
  - Vexa PIM now has policy-foundation enforcement for authenticated-read classification and API-client route policy coverage in CI and gate validation, explicit default-deny API-key behavior on unclassified human routes, representable-but-safely-rejected future scope dimensions, deterministic multi-role and admin-boundary helper foundations, shadow-mode policy evaluation under legacy RBAC authority, and reusable central read-redaction infrastructure extended beyond catalog and dashboard into notifications. It still does not have full enterprise authorization maturity across runtime classification enforcement, all scope dimensions, API-client permission modeling, multi-role storage rollout, admin-boundary route mapping, or universal payload redaction.

Rollback notes:

- if the foundation guard proves too noisy in follow-up work, revert only the auto-discovery validation contract and route metadata additions together; do not partially keep the new validator without the explicit route classifications it depends on
- do not reintroduce `AuthIdentity.roles` or `ApiAccessKey.roles` storage columns until a real database migration plan is prepared and validated end to end
- keep the global read-policy interceptor even if one redaction family changes, because removing it would regress the move away from route-by-route redaction hand-rolling

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded foundation pass without a matching unlocked story record

## 2026-04-27 Foundation Follow-Up: Runtime Classification-Required Enforcement

Scope:

- turned authenticated-read classification enforcement on by default at runtime in the shared RBAC guard
- strengthened the foundation integration test so it now proves:
  - classified authenticated reads still pass
  - unclassified authenticated reads fail closed
  - public routes bypass the authenticated-read requirement
  - API-client reads remain default-deny without explicit route allow
- upgraded the reusable PO backlog prompt to steer future passes toward runtime enforcement, machine-principal modeling, real scope enforcement, and bounded fail-closed execution

Files changed in this follow-up:

- `apps/api/src/common/rbac/rbac.guard.ts`
- `apps/api/test/integration/access-policy-foundation.test.cjs`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API build stayed green after enabling runtime classification enforcement by default |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | New runtime proofs validated classified allow, unclassified deny, public-route bypass, and API-client default deny |
| `npm run guard:sensitive-gets` | Passed | Guardrail still auto-discovers complete authenticated-read and API-client policy coverage |
| `npm run test:integration:access-policy-remediation` | Passed | Existing covered authorization behaviors remained stable |
| `npm run test:integration:delegated-access-scopes` | Passed | Scope-enforcement behavior remained stable |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Central notification redaction remained intact |
| `npm run prisma:generate` | Passed | Prisma client regenerated cleanly in the validation bundle |
| `npm run build --workspace @pim1/web` | Timed out once, then passed | First run exceeded the shell timeout with no product regression signal; sequential rerun with longer timeout passed |
| `npm run gate:run:increment *> .tmp-gate-increment.log` | Timed out once, then passed | First run exceeded the shell timeout while progressing; sequential rerun with longer timeout passed with `INCREMENT_CORE_GATES totalSteps=16` |
| `npm run gate:run:sprint *> .tmp-gate-sprint.log` | Passed | Sequential run passed with `SPRINT_CORE_GATES totalSteps=14` |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Staging workflow contract remained healthy |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Checked-in staging postdeploy harness remained healthy |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Increment state file remained valid JSON |
| `git diff --check` | Passed with warnings | Only CRLF normalization warnings in the dirty worktree |
| touched-file secret scan with `rg` | Passed with expected local/test-only matches | No real secrets were introduced |

PO/CTO validation:

- accepted for this follow-up:
  - runtime classification-required enforcement is now enabled by default for authenticated reads
  - the system now fails closed for unclassified authenticated reads instead of only relying on CI and gate guardrails
  - the reusable backlog prompt is now aligned with the foundation-first execution path and the remaining blocker order
- not accepted as complete:
  - this does not complete the full API-client permission model
  - this does not complete enforcement for future scope dimensions
  - this does not complete multi-role storage rollout, admin-boundary route mapping, or broader redaction families
  - `category_manager` and `vendor` remain blocked
- product claim wording:
  - Vexa PIM now enforces authenticated-read classification both in CI/gates and at runtime, keeps API keys default-denied unless a route explicitly opts into API-client access, and preserves the previously validated policy-foundation behavior for scope handling, role helpers, and central redaction. It still does not have full enterprise authorization maturity across machine-principal permission modeling, full scope-dimension enforcement, multi-role storage rollout, admin-boundary route mapping, or universal payload redaction.

Rollback notes:

- if runtime classification enforcement unexpectedly blocks a legitimate authenticated read, add the missing explicit classification metadata to the route rather than weakening the shared default
- preserve the foundation test cases proving unclassified authenticated reads fail closed so future changes cannot silently reopen default-read drift

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy continuation without a matching unlocked story record

## 2026-04-27 Foundation Follow-Up: Explicit API-Client Scope Model

Scope:

- added additive persistence for API-key scopes through `ApiAccessKey.scopes` plus a checked-in migration
- implemented explicit machine-principal scope matching for `allowed_with_api_scope` routes instead of route-level allow alone
- required catalog API routes to declare `catalog.read` or `catalog.write` scope metadata
- kept API keys default-denied everywhere else and prevented human-role fallback when scopes are missing or unrelated
- extended the guardrail and focused integration suites to prove matching-scope allow, missing-scope deny, unrelated-scope deny, unsupported-scope rejection, and viewer-role least privilege

Files changed in this follow-up:

- `apps/api/src/common/rbac/api-client-policy.decorator.ts`
- `apps/api/src/common/rbac/rbac.guard.ts`
- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/src/auth/jwt-auth.guard.ts`
- `apps/api/src/api-keys/api-keys.service.ts`
- `apps/api/src/api-keys/dto/create-api-key.dto.ts`
- `apps/api/src/catalog/catalog.controller.ts`
- `apps/api/src/catalog/products.controller.ts`
- `apps/api/test/integration/access-policy-foundation.test.cjs`
- `apps/api/test/integration/api-keys.test.cjs`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260427113000_api_access_key_scopes/migration.sql`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run prisma:generate` | Passed | Prisma client regenerated with `ApiAccessKey.scopes` support |
| `npm run build --workspace @pim1/api` | Failed, then passed | First failure proved `api-keys.service.ts` still had one select path missing `scopes`; fixed the select and reran successfully |
| `npm run guard:sensitive-gets` | Passed | Guardrail now also requires explicit API-client scope metadata on `allowed_with_api_scope` routes |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Passed | Added proof that API clients require matching declared route scopes |
| `node apps/api/test/integration/api-keys.test.cjs` | Passed | Proved supported-scope creation, unsupported-scope rejection, matching-scope allow, read-only deny on write, no-scope deny on read, viewer least privilege, and revocation behavior |
| `npm run test:integration:access-policy-remediation` | Passed | Proved catalog API-client scope matching, missing-scope deny, unrelated-scope deny, and no human-role fallback |
| `npm run test:integration:delegated-access-scopes` | Passed | Existing delegated-access behavior remained stable |
| `node apps/api/test/integration/notifications-center.test.cjs` | Passed | Existing notification redaction behavior remained stable |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy after the additive backend/API-key schema change |
| `npm run gate:run:increment *> .tmp-gate-increment.log` | Passed | Increment gate passed with `INCREMENT_CORE_GATES totalSteps=16` |
| `npm run gate:run:sprint *> .tmp-gate-sprint.log` | Passed | Sprint gate passed with `SPRINT_CORE_GATES totalSteps=14` |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Staging workflow contract remained healthy |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Checked-in staging postdeploy harness remained healthy |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Increment state file remained valid JSON |
| `git diff --check` | Passed with warnings | Only CRLF normalization warnings in the dirty worktree |
| touched-file secret scan with `rg` | Passed with expected local/test-only matches | No real secrets were introduced |

PO/CTO validation:

- accepted for this follow-up:
  - API-client authorization is no longer only route-level default deny; the catalog API family now requires explicit machine-principal scopes and exact scope matching
  - API keys cannot inherit human route access on the catalog family through role alone
  - missing, unrelated, and unsupported API-client scopes now deny safely
  - the API-key scope rollout is additive and migration-backed rather than implicit
- not accepted as complete:
  - the explicit machine-principal scope model is still only implemented for the currently intentional API-client surface, not all future API-client-capable resources
  - object and scope-dimension enforcement blockers remain pending
  - multi-role persistence rollout, admin-boundary route mapping, broader redaction, and `category_manager`/`vendor` re-evaluation remain pending
- product claim wording:
  - Vexa PIM now enforces explicit machine-principal scopes for the catalog API family, persists API-key scopes through a migration-backed additive rollout, denies missing or unrelated API-client scopes safely, and preserves default-deny behavior for human-only routes. It still does not have full enterprise authorization maturity across all machine-principal resources, future scope-dimension enforcement, multi-role persistence, admin-boundary route mapping, or universal payload redaction.

Rollback notes:

- if a catalog API route needs to remain machine-accessible, add the correct explicit API-client scope metadata rather than weakening the shared scope check
- keep the additive `ApiAccessKey.scopes` migration even if the supported scope list changes, because removing it would regress the explicit machine-principal model back to route-only allow

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy continuation without a matching unlocked story record

## 2026-04-27 PO Follow-Up: Billing Detail Read Inventory Closure

Scope:

- promoted `GET /billing/plan-profile` and `GET /billing/upgrade-request` from implicit controller knowledge into explicit sensitive-read inventory coverage
- expanded the focused remediation suite to prove viewer, reviewer, and editor denial on both admin-only billing detail reads while retaining admin allow
- expanded API-key denial evidence for the covered billing detail read routes
- updated the reusable PO backlog prompt to keep shared-artifact validation steps sequential where `apps/api/dist` or `apps/web/.next` are reused

Files changed in this follow-up:

- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `docs/execution/ACCESS_POLICY_EXECUTION_RECORD_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled before the focused billing validation rerun |
| `npm run guard:sensitive-gets` | Passed | Sensitive GET guard now validates 55 explicit protected routes including `billing/plan-profile` and `billing/upgrade-request` |
| `npm run test:integration:access-policy-remediation` | Passed | Added proof for viewer, reviewer, and editor denial on admin-only billing detail reads, admin allow, and API-key denial |
| `npm run test:integration:delegated-access-scopes` | Passed | Existing delegated-access coverage remained green after the billing inventory expansion |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy; no frontend change was required for the proof-only slice |
| `npm run gate:run:increment` | Passed | Increment gate stayed green with the expanded billing read inventory |
| `npm run gate:run:sprint` | Passed | Sprint gate passed on sequential rerun after a parallel `.next` artifact race produced a false failure during the first attempt |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deploy workflow contract remained intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Checked-in staging postdeploy harness remained green |
| `git diff --check` | Passed with CRLF warnings only | No patch-formatting failures were introduced |
| touched-file secret scan with `rg` | Passed with expected local/test-value matches | Only local development defaults, token variable names, and test helpers matched; no real secrets were introduced |

PO/CTO validation:

- accepted for the current bounded slice: the admin-only billing detail reads are now explicitly classified in the sensitive-read guard, the remediation suite proves viewer, reviewer, and editor denial plus admin allow, and API-key principals remain denied on the covered billing detail routes
- not accepted as complete: broader authenticated read inventory still needs final PO classification outside the already-covered surfaces; universal read-time redaction remains incomplete outside covered catalog and `dashboard/health` responses; unsupported scopes, API-client permission modeling, multi-role migration, and admin-boundary maturity all remain pending
- product claim wording remains: Vexa PIM has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, admin-only billing detail reads, covered self-service auth reads, dashboard readiness, dashboard catalog-health, dashboard health with role-aware redaction, dashboard operations summary, metrics KPI trend routes, compliance rule reads, human-only audit, notifications, compliance workflow, submission, and AI-helper boundaries, human-only connector, marketplace, and covered bulk-operation workspace boundaries, explicit broad-read classification for the covered authenticated read surfaces, restricted connector-management writes for viewer and reviewer, partial API-client versus human route separation on covered surfaces, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

Rollback notes:

- no controller access policy needed to be reverted or relaxed in this follow-up because the slice closed an evidence and inventory gap rather than changing the billing route policy itself
- if a future product decision broadens non-admin visibility into billing detail signals, update the sensitive-read guard and remediation proofs in the same change so the role shift remains explicit
- keep validation steps that share `apps/api/dist` or `apps/web/.next` sequential to avoid artifact-race false failures

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-27 Bounded Follow-Up: AI Helper Human-Only Boundary

Scope:

- made the covered `auto-suggestions` and `rejection-intelligence` read families human-only so API-key principals cannot inherit human AI-helper access
- extended the focused remediation suite to prove API-key denial on covered AI-helper reads while preserving the existing human viewer, reviewer, editor, and admin behavior
- extended the sensitive-GET guard to require explicit API-client boundary annotation on both AI-helper controllers
- kept the slice bounded to the AI-helper route family, remediation proof, and documentation without widening into new principal-schema work

Files changed in this follow-up:

- `apps/api/src/auto-suggestions/auto-suggestions.controller.ts`
- `apps/api/src/rejection-intelligence/rejection-intelligence.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with the AI-helper human-only boundaries |
| `npm run guard:sensitive-gets` | Passed | Sensitive GET guard now validates 53 protected route classifications and 22 controller-level policy snippets |
| `npm run test:integration:access-policy-remediation` | Passed | API-key principals are denied covered auto-suggestion and rejection-intelligence reads while existing human-path expectations remain intact |
| `npm run test:integration:delegated-access-scopes` | Passed | Existing delegated scope enforcement remained green after the AI-helper boundary change |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy after the backend-only slice |
| `npm run gate:run:increment` | Passed | Increment gate passed after the AI-helper follow-up |
| `npm run gate:run:sprint` | Passed | Sprint gate passed after the AI-helper follow-up |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deploy workflow validation remained intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Checked-in staging postdeploy harness remained green |
| `git diff --check` | Passed | No patch-formatting failures; only CRLF conversion warnings were reported separately |
| touched-file secret scan with `rg` | Passed with expected local-only matches | No real secrets were introduced |

PO/CTO validation:

- accepted for the current bounded slice: the covered AI-helper read family is now explicitly human-only, API-key principals can no longer inherit covered AI-helper access, and the focused remediation suite proves the new machine-principal denials
- not accepted as complete: this advances item `2` materially and shrinks item `1`, but it does not complete multi-role migration, scope-model expansion, or universal redaction
- product claim wording remains: Vexa PIM has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, covered self-service auth reads, dashboard readiness, dashboard catalog-health, dashboard health with role-aware redaction, dashboard operations summary, metrics KPI trend routes, compliance rule reads, human-only audit, notifications, compliance workflow, submission, and AI-helper boundaries, human-only connector, marketplace, and covered bulk-operation workspace boundaries, partial API-client versus human route separation on covered surfaces, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

Rollback notes:

- revert only the AI-helper controller `@DisallowApiClient()` annotations if a proven machine-principal AI-helper requirement is approved with an explicit replacement permission model
- keep the focused remediation assertions and sensitive-GET guard entries so any future widening of AI-helper access remains deliberate and reviewed
- if a later product decision introduces machine-safe AI-helper APIs, keep the current human-only boundary on the existing workflow endpoints until the new contract is implemented and tested

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-27 Bounded Follow-Up: Submission Read Human-Only Boundary

Scope:

- made the submissions controller human-only so API-key principals cannot inherit human submission-list, dead-letter, detail, or issue-read access
- extended the focused remediation suite to prove API-key denial on covered submission reads while preserving the existing viewer denial and editor or admin human-path behavior
- extended the sensitive-GET guard to require explicit API-client boundary annotation on the submissions controller
- kept the slice bounded to the submission route family, remediation proof, and documentation without widening into new submission workflow semantics

Files changed in this follow-up:

- `apps/api/src/marketplace/submissions.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with the submissions controller human-only boundary |
| `npm run guard:sensitive-gets` | Passed | Sensitive GET guard now validates 53 protected route classifications and 20 controller-level policy snippets |
| `npm run test:integration:access-policy-remediation` | Passed | API-key principals are denied covered submission reads while the existing sensitive submission human-path denials remain intact |
| `npm run test:integration:delegated-access-scopes` | Passed | Existing delegated scope enforcement remained green after the submissions boundary change |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy after the backend-only slice |
| `npm run gate:run:increment` | Passed | Increment gate passed after the submissions follow-up |
| `npm run gate:run:sprint` | Passed | Sprint gate passed after the submissions follow-up |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deploy workflow validation remained intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Checked-in staging postdeploy harness remained green |
| `git diff --check` | Passed | No patch-formatting failures; only CRLF conversion warnings were reported separately |
| touched-file secret scan with `rg` | Passed with expected local-only matches | No real secrets were introduced |

PO/CTO validation:

- accepted for the current bounded slice: the submission read family is now explicitly human-only, API-key principals can no longer inherit covered submission access, and the focused remediation suite proves the new machine-principal denials
- not accepted as complete: broader authenticated read classification, universal read-time redaction, unsupported scopes, fuller API-client modeling, multi-role migration, and final admin-boundary maturity all remain pending
- product claim wording remains: Vexa PIM has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, covered self-service auth reads, dashboard readiness, dashboard catalog-health, dashboard health with role-aware redaction, dashboard operations summary, metrics KPI trend routes, compliance rule reads, human-only audit, notifications, compliance workflow, and submission boundaries, human-only connector, marketplace, and covered bulk-operation workspace boundaries, partial API-client versus human route separation on covered surfaces, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

Rollback notes:

- revert only the submissions controller `@DisallowApiClient()` annotation if a proven machine-principal submission requirement is approved with an explicit replacement permission model
- keep the focused remediation assertions and sensitive-GET guard entry so any future widening of submission access remains deliberate and reviewed
- if a later product decision splits safe submission summaries from privileged provider submission detail, keep the current stricter boundary until the narrower contract is implemented and tested

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-27 Bounded Follow-Up: Audit Read Human-Only Boundary

Scope:

- made the audit controller human-only so API-key principals cannot inherit human audit-log or audit-event access
- extended the focused remediation suite to prove viewer, reviewer, and editor denial on audit-log reads while preserving admin allow behavior
- extended the sensitive-GET guard to require explicit API-client boundary annotation on the audit controller
- kept the slice bounded to the audit route family, remediation proof, and documentation without widening into unrelated admin surfaces

Files changed in this follow-up:

- `apps/api/src/audit/audit.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with the audit controller human-only boundary |
| `npm run guard:sensitive-gets` | Passed | Sensitive GET guard now validates 53 protected route classifications and 19 controller-level policy snippets |
| `npm run test:integration:access-policy-remediation` | Failed twice, then passed | First failure was a test expectation mismatch: audit logs return an array, not an `{ items }` envelope. Second failure was a query-window mismatch after adding new audit denials: `LIMIT 50` no longer included the earlier `FIELD_WRITE_RESTRICTED` row, so the focused audit-log query was widened to `LIMIT 200`. Final rerun passed with viewer/reviewer/editor audit denial, admin allow, and API-key denial proof. |
| `npm run test:integration:delegated-access-scopes` | Passed | Existing delegated scope enforcement remained green after the audit boundary change |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy after the backend-only slice |
| `npm run gate:run:increment` | Passed | Increment gate passed after the audit follow-up |
| `npm run gate:run:sprint` | Passed | Sprint gate passed after the audit follow-up |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deploy workflow validation remained intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Checked-in staging postdeploy harness remained green |
| `git diff --check` | Passed | No patch-formatting failures; only CRLF conversion warnings were reported separately |
| touched-file secret scan with `rg` | Passed with expected local-only matches | No real secrets were introduced |

PO/CTO validation:

- accepted for the current bounded slice: the audit read family is now explicitly human-only, low-privilege human roles remain denied, admin reads remain intact, and API-key principals can no longer inherit covered audit access
- not accepted as complete: broader authenticated read classification, universal read-time redaction, unsupported scopes, fuller API-client modeling, multi-role migration, and final admin-boundary maturity all remain pending
- product claim wording remains: Vexa PIM has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, covered self-service auth reads, dashboard readiness, dashboard catalog-health, dashboard health with role-aware redaction, dashboard operations summary, metrics KPI trend routes, compliance rule reads, human-only audit, notifications, and compliance workflow boundaries, human-only connector, marketplace, and covered bulk-operation workspace boundaries, partial API-client versus human route separation on covered surfaces, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

Rollback notes:

- revert only the audit controller `@DisallowApiClient()` annotation if a proven machine-principal audit requirement is approved with an explicit replacement permission model
- keep the focused remediation assertions and sensitive-GET guard entry so any future widening of audit access remains deliberate and reviewed
- if a later product decision splits safe audit aggregates from privileged raw audit data, keep the current stricter boundary until the narrower contract is implemented and tested

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-27 Bounded Follow-Up: Bulk Operation Read Hardening And API-Client Boundary

Scope:

- made the covered `bulk-import` and `bulk-edit` controller families human-only so API-key principals cannot inherit human operational job and template access
- extended the sensitive-GET guard inventory to explicitly include bulk-import template list and detail reads in addition to the already-covered bulk job and bulk operation reads
- added focused remediation proof for viewer and reviewer denial, editor allow, and API-key denial on covered bulk operation reads
- kept the change bounded to controller-level access policy, guard inventory, and remediation evidence without widening into new bulk workflow semantics

Files changed in this follow-up:

- `apps/api/src/bulk-import/bulk-import.controller.ts`
- `apps/api/src/bulk-edit/bulk-edit.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with bulk controller API-client boundaries |
| `npm run guard:sensitive-gets` | Passed | Sensitive GET guard now validates 53 protected route classifications and 18 controller-level policy snippets |
| `npm run test:integration:access-policy-remediation` | Passed | Viewer and reviewer are denied covered bulk reads, editor retains access, and API-key principals are denied human bulk routes |
| `npm run test:integration:delegated-access-scopes` | Passed | Existing delegated scope enforcement remained green after the bulk controller boundary change |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy after the backend-only slice |
| `npm run gate:run:increment` | Passed | Increment gate passed after the bulk-operation follow-up |
| `npm run gate:run:sprint` | Passed | Sprint gate passed after the bulk-operation follow-up |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deploy workflow validation remained intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Checked-in staging postdeploy harness remained green |
| `git diff --check` | Passed | No patch-formatting failures; only CRLF conversion warnings were reported separately |
| touched-file secret scan with `rg` | Passed with expected local-only matches | No real secrets were introduced |

PO/CTO validation:

- accepted for the current bounded slice: covered bulk-import and bulk-edit reads are now explicitly inventoried, human-only, and backed by denial or allow evidence for human low-privilege users, human editor users, and API-key principals
- not accepted as complete: this does not complete full bulk, import, or export policy maturity; broader authenticated read classification, universal read-time redaction, unsupported scopes, fuller API-client modeling, multi-role migration, and final admin-boundary maturity all remain pending
- product claim wording remains: Vexa PIM has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, covered self-service auth reads, dashboard readiness, dashboard catalog-health, dashboard health with role-aware redaction, dashboard operations summary, metrics KPI trend routes, compliance rule reads, human-only notifications and compliance workflow boundaries, human-only connector, marketplace, and covered bulk-operation workspace boundaries, partial API-client versus human route separation on covered surfaces, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

Rollback notes:

- revert only the `@DisallowApiClient()` annotations on the bulk controllers if a proven machine-principal requirement is approved with an explicit replacement permission model
- keep the expanded sensitive-GET guard entries and remediation assertions so any future widening of bulk route access remains explicit and reviewed
- if later product work distinguishes safe bulk template metadata from privileged operational job reads, keep the current stricter boundary until the narrower contract is implemented and tested

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-27 Bounded Follow-Up: Marketplace Workspace API-Client Boundary

Scope:

- made the covered marketplace workspace controller human-only so API-key principals cannot inherit human marketplace workspace access
- extended the sensitive-GET guard coverage to require explicit `@DisallowApiClient()` protection on the marketplace controller and the ONDC controller
- added focused remediation proof for API-key denial on live marketplace workspace reads
- documented the ONDC nuance explicitly: the ONDC controller is now defensively annotated, but the module is feature-flagged and is not mounted in the default validation environment

Files changed in this follow-up:

- `apps/api/src/marketplace/marketplace.controller.ts`
- `apps/api/src/ondc/ondc.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with marketplace and ONDC API-client boundary annotations |
| `npm run guard:sensitive-gets` | Passed | Sensitive GET guard now validates 51 protected route classifications and 16 controller-level policy snippets |
| `npm run test:integration:access-policy-remediation` | Passed | API-key principals are denied live marketplace workspace reads while human connector and marketplace boundaries remain intact |
| `npm run test:integration:delegated-access-scopes` | Passed | Delegated scope enforcement remained green after the marketplace boundary change |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy after the backend-only slice |
| `npm run gate:run:increment` | Passed | Increment gate passed after the marketplace boundary follow-up |
| `npm run gate:run:sprint` | Passed | Sprint gate passed after the marketplace boundary follow-up |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deploy workflow validation remained intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Checked-in staging postdeploy harness remained green |
| `git diff --check` | Passed | No patch-formatting failures; only CRLF conversion warnings were reported separately |
| touched-file secret scan with `rg` | Passed with expected local-only matches | No real secrets were introduced |

PO/CTO validation:

- accepted for the current bounded slice: the live marketplace workspace route family is now human-only, API-key principals can no longer inherit covered human marketplace reads, and the ONDC controller now carries the same boundary annotation for feature-enabled environments
- not accepted as complete: ONDC runtime denial is not claimed as universally validated because the module is feature-flagged off in the default test environment; broader authenticated read classification, universal read-time redaction, unsupported scopes, full API-client modeling, multi-role migration, and final admin-boundary maturity all remain pending
- product claim wording remains: Vexa PIM has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, covered self-service auth reads, dashboard readiness, dashboard catalog-health, dashboard health with role-aware redaction, dashboard operations summary, metrics KPI trend routes, compliance rule reads, human-only notifications and compliance workflow boundaries, human-only connector and marketplace workspace boundaries, partial API-client versus human route separation on covered surfaces, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

Rollback notes:

- revert only the marketplace or ONDC `@DisallowApiClient()` annotations if a proven machine-principal requirement is approved with an explicit replacement permission model
- keep the remediation assertion and guard entries so any future widening of marketplace or ONDC access remains deliberate and reviewed
- if ONDC is enabled in a later environment, add focused runtime denial proof there before claiming live ONDC API-client separation coverage

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-27 Bounded Follow-Up: Connector Workspace API-Client Boundary

Scope:

- hardened the connector workspace controller as human-only until a real machine-principal permission model exists
- blocked API-key principals from inheriting human connector workspace access on definitions, installed accounts, product-type schema, publications, payload preview, reconnect, install, and publication-target routes
- preserved existing human admin and editor connector flows under focused regression proof
- extended remediation evidence so API-key principals are explicitly denied the human connector workspace while allowed catalog reads remain intact

Files changed in this follow-up:

- `apps/api/src/connector-installer/connector-installer.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with connector workspace API-client boundary |
| `npm run guard:sensitive-gets` | Passed | Controller snippet coverage increased to 14 with connector workspace API-client blocking |
| `npm run test:integration:access-policy-remediation` | Passed | API-key principals are denied connector definitions and installed connectors; allowed catalog read behavior remains intact |
| `node apps/api/test/integration/connector-access-entitlements.test.cjs` | Passed | Human connector install, reconnect, delete, and action-matrix flows remain intact |
| `npm run test:integration:delegated-access-scopes` | Passed | Supported scope enforcement remained stable after the connector boundary change |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy after the backend-only slice |
| `npm run gate:run:increment` | Passed via redirected log | The gate completed successfully when shell output was redirected to a temp log to avoid tool timeout pressure |
| `npm run gate:run:sprint` | Passed via redirected log | The gate completed successfully when shell output was redirected to a temp log to avoid tool timeout pressure |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deploy workflow contract remains intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Checked-in staging postdeploy harness still validates workspace login, revocation, admin render, and non-admin denials |

PO/CTO validation:

- accepted for the current bounded slice: the human connector workspace is no longer available to API-key principals, the secure default that API clients cannot inherit human admin behavior is now enforced on the covered connector route family, and human admin/editor connector flows remain intact
- not accepted as complete: broader authenticated read inventory still needs final PO classification outside the already-covered surfaces; universal read-time redaction remains incomplete outside covered catalog and `dashboard/health` responses; unsupported scope dimensions such as `vendor/owner`, `supplier`, `locale/market`, `catalog`, `team`, and `assignee`; full API-client permission and scope modeling beyond the covered human-route boundaries; multi-role migration foundation; product-admin/system-admin/super-admin boundary maturity; or any `category_manager` or `vendor` role introduction
- product claim wording remains: Vexa PIM has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, covered self-service auth reads, dashboard readiness, dashboard catalog-health, dashboard health with role-aware redaction, dashboard operations summary, metrics KPI trend routes, compliance rule reads, human-only notifications and compliance workflow boundaries, human-only connector workspace boundaries, explicit broad-read classification for the covered authenticated read surfaces, restricted connector-management writes for viewer and reviewer, partial API-client versus human route separation on covered surfaces, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

Rollback notes:

- revert the class-level connector workspace API-client boundary only if a validated product decision introduces explicit machine permissions for those connector routes
- keep the remediation assertions and guard snippet check so future connector API-client allowances remain deliberate and reviewable
- if shell-layer gate output grows too large for direct tool streaming, prefer redirected-log reruns before treating the timeout as product failure evidence

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-27 Bounded Follow-Up: Self-Service Auth Read Classification

Scope:

- added explicit checked-in `@ReadAccessPolicy(...)` classification for the remaining covered authenticated self-service auth reads
- classified `GET /auth/account/privacy-status` as a self-service account privacy read
- classified `GET /auth/account/export/:jobId/download` as a self-service account export download read
- extended focused remediation evidence so a human viewer still gets self-service privacy and export behavior while API-key principals remain blocked from the download route
- extended the sensitive-GET guard to require explicit policy classification on both covered auth reads

Files changed in this follow-up:

- `apps/api/src/common/rbac/read-access-policy.decorator.ts`
- `apps/api/src/auth/auth.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with explicit self-service auth read classification |
| `npm run guard:sensitive-gets` | Passed | Sensitive GET guard now validates 51 checked route or classification points including the two auth self-service reads |
| `npm run test:integration:access-policy-remediation` | Passed | Viewer self-service privacy status and queued export download remain allowed; API-key export download remains denied |
| `npm run test:integration:delegated-access-scopes` | Passed | Scope enforcement remained stable after the auth-read metadata changes |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy after the backend-only slice |
| `npm run gate:run:increment` | Timed out twice in the shell tool, then passed | The direct tool invocation timed out at the shell layer; rerunning with output redirected to a temp log completed successfully with the gate result intact |
| `npm run gate:run:sprint` | Passed | Completed successfully when run with log redirection to avoid shell output timeout pressure |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deploy workflow contract remains intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Checked-in staging postdeploy harness still validates workspace login, revocation, admin render, and non-admin denials |

PO/CTO validation:

- accepted for the current bounded slice: the remaining covered self-service auth reads now carry explicit checked-in policy classification, the sensitive-GET guard enforces that classification, a human viewer still gets their own privacy-status and queued export-download flow, and API-key principals remain blocked from the sensitive download route
- not accepted as complete: broader authenticated read inventory still needs final PO classification outside the already-covered surfaces; universal read-time redaction remains incomplete outside covered catalog and `dashboard/health` responses; unsupported scope dimensions such as `vendor/owner`, `supplier`, `locale/market`, `catalog`, `team`, and `assignee`; full API-client permission and scope modeling beyond the covered human-route boundaries; multi-role migration foundation; product-admin/system-admin/super-admin boundary maturity; or any `category_manager` or `vendor` role introduction
- product claim wording remains: Vexa PIM has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, covered self-service auth reads, dashboard readiness, dashboard catalog-health, dashboard health with role-aware redaction, dashboard operations summary, metrics KPI trend routes, compliance rule reads, human-only notifications and compliance workflow boundaries, explicit broad-read classification for the covered authenticated read surfaces, restricted connector-management writes for viewer and reviewer, partial API-client versus human route separation on covered surfaces, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

Rollback notes:

- revert only the self-service auth `@ReadAccessPolicy(...)` annotations if a validated product decision changes how those reads should be classified, not because the routes are broad by role today
- keep the auth-read guard coverage and remediation assertions so future changes to privacy-status or export-download access remain explicit and reviewed
- treat shell-layer gate timeouts as tooling noise only after a rerun with redirected output confirms the actual gate result

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-27 Bounded Follow-Up: Broad Read Classification Foundation And Connector Management Write Hardening

Scope:

- added explicit checked-in broad-read classification with `@ReadAccessPolicy(...)` for the currently approved low-risk or redaction-backed authenticated read surfaces instead of leaving them as unnamed broad reads
- expanded central read-response policy handling inside `AccessPolicyService` so covered catalog list/detail/search/variant and stats responses plus `dashboard/health` all flow through named response policy paths
- fixed a real catalog search leak by redacting `matchedSku` for unauthorized actors on covered search reads
- fixed a mixed-sensitivity aggregate leak by redacting approval-queue counts from `catalog/stats` for viewer actors while preserving reviewer and admin visibility
- hardened connector-management write routes so `viewer` and `reviewer` can no longer install, uninstall, reconnect, complete OAuth callbacks, or mutate publication targets
- preserved current `admin` and `editor` connector-management behavior on the covered routes

Scope expansion:

- expanded from read-policy plumbing into connector-management controller roles because the inventory pass exposed live `APP_ROLES` write mutations on connector install and reconnect surfaces, which was an adjacent access-policy blocker inside the same backlog line and safer to close immediately than defer

Files changed in this follow-up:

- `apps/api/src/common/rbac/read-access-policy.decorator.ts`
- `apps/api/src/common/rbac/rbac.guard.ts`
- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/src/catalog/catalog.controller.ts`
- `apps/api/src/catalog/catalog.service.ts`
- `apps/api/src/catalog/products.controller.ts`
- `apps/api/src/dashboard/dashboard.controller.ts`
- `apps/api/src/media/media.controller.ts`
- `apps/api/src/notifications/notifications.controller.ts`
- `apps/api/src/compliance/issues.controller.ts`
- `apps/api/src/taxonomy/taxonomy.controller.ts`
- `apps/api/src/workspace-users/workspace-users.controller.ts`
- `apps/api/src/workspace-users/workspace-access-scopes.controller.ts`
- `apps/api/src/api-keys/api-keys.controller.ts`
- `apps/api/src/outbound-webhooks/outbound-webhooks.controller.ts`
- `apps/api/src/connector-installer/connector-installer.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `apps/web/src/lib/api/core.ts`
- `apps/web/src/app/quality/approvals/page.tsx`
- `apps/web/test/integration/quality-approvals-route-contract.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with read-policy classification and connector-management role hardening |
| `npm run guard:sensitive-gets` | Passed | Sensitive GET guard now validates 49 checked route or classification points and 13 controller checks |
| `npm run test:integration:access-policy-remediation` | Passed | Proved catalog search redaction, catalog stats approval-queue redaction, API-key human-route denials, viewer and reviewer connector-management write denials, and editor reconnect allow after grant |
| `node apps/web/test/integration/quality-approvals-route-contract.test.cjs` | Failed first, then passed | First contract failed on exact-string drift after approval-queue restricted copy changed; passed after updating the contract assertions to the new restricted-state wording |
| `node apps/api/test/integration/connector-access-entitlements.test.cjs` | Passed | Connector install, disable, reconnect, and action-matrix flows remain intact for allowed actors |
| `node apps/api/test/integration/shopify-publication-targets-api.test.cjs` | Failed first due parallel build race, then passed on sequential rerun | The first failure was a dist availability race while API build and the dist-backed test ran concurrently; no source rollback was needed |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy with the approval-queue restricted-state UI |
| `npm run test:integration:delegated-access-scopes` | Passed | Supported scope intersections remained intact after the shared read-policy plumbing changes |
| `npm run gate:run:increment` | Passed | Increment gate stayed green after the shared read-policy and connector-management updates |
| `npm run gate:run:sprint` | Passed | Sprint gate stayed green after the shared read-policy and connector-management updates |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deploy workflow contract remains intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Checked-in staging postdeploy harness still validates workspace login, revocation, admin render, and non-admin denials |

PO/CTO validation:

- accepted for the current bounded slice: explicit broad-read classification is now checked into code for the currently covered authenticated read surfaces, covered catalog and dashboard reads now use central named response policy handling, viewer catalog search no longer leaks `matchedSku`, viewer catalog stats no longer expose approval-queue counts, and viewer or reviewer connector-management writes are now blocked at the controller boundary
- not accepted as complete: broader authenticated read inventory still needs explicit PO classification outside the already-covered surfaces; universal read-time redaction remains incomplete outside covered catalog and `dashboard/health` responses; unsupported scope dimensions such as `vendor/owner`, `supplier`, `locale/market`, `catalog`, `team`, and `assignee`; full API-client permission and scope modeling beyond the covered human-route boundaries; multi-role migration foundation; product-admin/system-admin/super-admin boundary maturity; or any `category_manager` or `vendor` role introduction
- product claim wording remains: Vexa PIM has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, dashboard readiness, dashboard catalog-health, dashboard health with role-aware redaction, dashboard operations summary, metrics KPI trend routes, compliance rule reads, human-only notifications and compliance workflow boundaries, explicit broad-read classification for the covered authenticated read surfaces, restricted connector-management writes for viewer and reviewer, partial API-client versus human route separation on covered surfaces, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

Rollback notes:

- revert only the `@ReadAccessPolicy(...)` annotations and `applyReadResponsePolicy(...)` wiring for a covered route if a proven product requirement needs a different safe contract for that route
- keep the new read-policy decorator, sensitive-GET guard coverage, and focused remediation assertions so future broad-read expansion remains explicit and reviewable
- revert connector-management route role tightening only if a validated operator workflow proves that `viewer` or `reviewer` must mutate connectors, and capture that decision as a new PO exception because the secure default is to keep those writes limited to `admin` and `editor`
- if a dist-backed integration test fails while an API build is running in parallel, rerun it sequentially before treating the result as product regression evidence

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-27 Bounded Follow-Up: Compliance Workflow Scope Hardening And Human-Only Notification Boundaries

Scope:

- hardened `GET /compliance/rules` from broad authenticated access to explicit `admin` access
- marked `notifications`, `compliance`, and `issues` controller families as human-only so covered API-key principals can no longer inherit notification-center or compliance-workflow reads
- extended delegated-scope enforcement into compliance product issue reads, compliance validation requests, and issue-inbox list and resolve flows for the currently supported category and brand scope model
- preserved current reviewer and viewer human access to the issue inbox while ensuring scoped actors only see in-scope issue rows

Scope expansion:

- expanded into `apps/api/test/integration/notifications-center.test.cjs` after a real validation failure proved the test still assumed editor export rights even though the validated access-policy model already requires admin export rights; the test now uses the allowed export actor while still proving that publish-failure notifications reach the export-job creator

Files changed in this follow-up:

- `apps/api/src/compliance/compliance.controller.ts`
- `apps/api/src/compliance/compliance.module.ts`
- `apps/api/src/compliance/compliance.service.ts`
- `apps/api/src/compliance/issues.controller.ts`
- `apps/api/src/notifications/notifications.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `apps/api/test/integration/delegated-access-scopes.test.cjs`
- `apps/api/test/integration/notifications-center.test.cjs`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with compliance scope enforcement and human-only route metadata |
| `npm run guard:sensitive-gets` | Passed | Sensitive GET guard now validates 33 protected read routes and 8 controller or service policy checks |
| `npm run test:integration:access-policy-remediation` | Passed | Viewer, reviewer, and editor are denied compliance rule reads; API-key principals are denied notifications, issue inbox, and compliance rules |
| `npm run test:integration:delegated-access-scopes` | Passed | Compliance product issue reads, validate requests, issue-inbox list, and issue-inbox resolution now respect supported scope intersections |
| `node apps/api/test/integration/issue-inbox.test.cjs` | Passed | Human issue-inbox behavior remained intact for normal warning and blocker workflows |
| `node apps/api/test/integration/issue-inbox-tenant-boundary.test.cjs` | Passed | Installation-filtered issue-inbox queries remain tenant-safe |
| `node apps/api/test/integration/notifications-center.test.cjs` | Failed once, then passed | First failure was a stale test assumption expecting editor export rights; rerun passed after aligning the export-job creator with the current admin-only export policy |
| `node apps/api/test/integration/notifications-tenant-boundary.test.cjs` | Passed | Notification list and mark-read behavior remain tenant-safe for human users |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy after the backend-only follow-up |
| `npm run gate:run:increment` | Passed | Increment gate accepted the compliance and human-route boundary slice |
| `npm run gate:run:sprint` | Passed | Sprint gate accepted the new compliance and human-route boundary slice |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deploy workflow contract still includes non-admin access-policy smoke coverage |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Checked-in staging postdeploy harness still validates auth boundary and non-admin denial expectations |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Passed | Governance state file remains valid JSON |
| `git diff --check` | Passed with CRLF warnings only | No patch-formatting or whitespace errors were introduced |
| touched-file secret scan with `rg` | Passed with expected local test-value matches | Only local dummy database URLs in the integration harness matched the scan pattern; no real secrets were introduced |

PO/CTO validation:

- accepted for the current bounded slice: compliance rule reads are now explicitly admin-only, covered API-key principals are denied human-only notification and compliance workflow surfaces, and supported delegated-scope enforcement now reaches compliance issue reads and queue actions instead of stopping at catalog detail paths
- not accepted as complete: broader authenticated read inventory still needs final PO classification outside the already-covered surfaces; universal read-time redaction remains incomplete outside covered catalog and `dashboard/health`; unsupported scope dimensions, full API-client permission modeling, multi-role migration, Product Admin boundary maturity, and final role-split work all remain pending
- product claim wording remains: Vexa PIM has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, dashboard readiness, dashboard catalog-health, dashboard health with role-aware redaction, dashboard operations summary, metrics KPI trend routes, compliance rule reads, human-only notifications and compliance workflow boundaries, partial API-client versus human route separation on covered surfaces, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

Rollback notes:

- revert only the compliance controller metadata and service-level scope assertions if legitimate human compliance workflows are proven blocked unexpectedly
- keep the sensitive-GET guard entries and focused remediation proofs so any future widening of compliance or notification reads remains explicit and reviewed
- if a future API-client permission model intentionally grants machine access to parts of the compliance workflow, replace the current blanket human-only boundary with explicit API-client permissions rather than silently removing the route metadata

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-27 Bounded Follow-Up: Dashboard Health Redaction And API-Client Human-Route Boundaries

Scope:

- classified `GET /dashboard/health` as a mixed-sensitivity human route instead of leaving it as a broad unshaped authenticated read
- added centralized role-aware dashboard-health redaction in `AccessPolicyService` so viewer and reviewer actors retain aggregate quality and catalog signals while connector-account breakdown is removed, and viewer approval-queue visibility is also removed
- preserved aggregate `publishReadyTotal` and `blockedTotal` values on the redacted response so covered web pages can stay honest without fabricating zeroes
- blocked API-client principals from covered human-only route families on `dashboard`, `billing`, `metrics`, and authenticated `auth` account endpoints by using explicit route metadata in the shared RBAC guard
- expanded the dashboard and channel web pages to recognize redacted sections and show role-aware fallback copy instead of misleading detail panels

Scope expansion:

- expanded from the original `dashboard/health` blocker into the shared RBAC guard, authenticated account routes, and dashboard web callers because fixing the health route safely required both centralized actor-type enforcement and honest UI handling of redacted aggregate responses
- added `DashboardModule` wiring for `AccessPolicyModule` after validation exposed a real Nest dependency gap introduced by the new controller-level policy dependency

Files changed in this follow-up:

- `apps/api/src/common/rbac/api-client-policy.decorator.ts`
- `apps/api/src/common/rbac/rbac.guard.ts`
- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/src/dashboard/dashboard.controller.ts`
- `apps/api/src/dashboard/dashboard.module.ts`
- `apps/api/src/billing/billing.controller.ts`
- `apps/api/src/metrics/metrics.controller.ts`
- `apps/api/src/auth/auth.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `apps/web/src/lib/api/core.ts`
- `apps/web/src/app/dashboard/page.tsx`
- `apps/web/src/app/channels/page.tsx`
- `apps/web/src/app/channels/health/page.tsx`
- `apps/web/test/integration/dashboard-route-contract.test.cjs`
- `apps/web/test/integration/channels-health-route-contract.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with centralized dashboard-health redaction and API-client route metadata |
| `npm run guard:sensitive-gets` | Passed | Sensitive GET guard still validates 32 protected routes and now checks 4 controller-level API-client policy hooks |
| `npm run test:integration:access-policy-remediation` | Failed once, then passed | Initial failure was a real Nest wiring issue: `DashboardController` could not resolve `AccessPolicyService` until `DashboardModule` imported `AccessPolicyModule`; rerun passed after the targeted fix |
| `node apps/web/test/integration/dashboard-route-contract.test.cjs` | Passed | Dashboard route contract now proves redaction-aware fallback messaging for restricted health sections |
| `node apps/web/test/integration/channels-health-route-contract.test.cjs` | Failed once, then passed | Initial failure was a string-contract mismatch on the new restricted copy; route contract passed after aligning the expected substring to the checked-in copy |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy with the new redaction-aware dashboard and channel pages |
| `npm run test:integration:delegated-access-scopes` | Passed | Existing supported scope intersections still behave correctly after the shared policy changes |
| `npm run gate:run:increment` | Failed once, then passed | First failure was a validation-runner artifact while `gate:run:increment` and `gate:run:sprint` built `apps/web` concurrently and one run lost `.next/types/routes.d.ts`; sequential rerun passed with no code change required |
| `npm run gate:run:sprint` | Passed | Sprint gate accepted the new dashboard-health and API-client boundary slice |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deploy workflow contract remains intact, including non-admin access-policy smoke wiring |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Checked-in staging postdeploy harness still proves workspace login, logout, revocation, admin render, and non-admin denials |

PO/CTO validation:

- accepted for the current bounded slice: `dashboard/health` no longer relies on broad unclassified reads, covered web surfaces now render aggregate health data honestly under redaction, and API clients no longer inherit human dashboard, billing, metrics, or authenticated account-route behavior on the newly covered routes
- not accepted as complete: broader authenticated read inventory still needs final PO classification outside the already-covered surfaces; universal read-time redaction remains incomplete outside covered catalog and dashboard-health responses; unsupported scopes, full API-client permission modeling, multi-role migration, Product Admin boundary maturity, and final role-split work all remain pending
- product claim wording remains: Vexa PIM has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, dashboard readiness, dashboard catalog-health, dashboard health with role-aware redaction, dashboard operations summary, and metrics KPI trend routes, partial API-client versus human route separation on covered surfaces, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

Rollback notes:

- revert only the `dashboard/health` response redaction and covered `@DisallowApiClient()` annotations if a proven product requirement restores broader access, and keep the focused remediation assertions so any widening stays explicit
- if a future product decision wants reviewer or viewer access to more workflow detail, add a narrower approved-safe summary contract instead of restoring raw connector breakdown or viewer approval-queue visibility
- do not use the transient concurrent `.next/types/routes.d.ts` gate failure as rollback evidence; the sequential increment-gate rerun passed without product-code changes

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-27 Bounded Follow-Up: Dashboard Readiness And Catalog-Health Sensitive Read Hardening

Scope:

- updated the checked-in Product Owner backlog prompt with the latest blocker snapshot so future execution keeps starting from the first still-pending sensitive-read backlog item
- promoted `GET /dashboard/readiness` from broad authenticated access to explicit `admin` or `editor` access
- promoted `GET /dashboard/catalog-health` from broad authenticated access to explicit `admin` or `editor` access
- extended the sensitive-GET guard to cover both newly protected dashboard read routes
- added focused remediation coverage proving viewer and reviewer denial plus editor and admin allow behavior for both routes

Files changed in this follow-up:

- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`
- `apps/api/src/dashboard/dashboard.controller.ts`
- `scripts/validate-sensitive-get-policy.cjs`
- `apps/api/test/integration/access-policy-remediation.test.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with explicit readiness and catalog-health route protection |
| `npm run guard:sensitive-gets` | Passed | Sensitive GET guard now validates 32 explicit protected read routes |
| `npm run test:integration:access-policy-remediation` | Failed, then passed | First failure was a validation-runner mistake: the dist-backed remediation suite raced the API build when both were launched in parallel; reran sequentially and the suite passed with the new denial matrix |
| `node apps/api/test/integration/dashboard-aggregations.test.cjs` | Passed | Admin dashboard readiness and catalog-health shapes remain intact |
| `node apps/api/test/integration/dashboard-tenant-boundary.test.cjs` | Passed | Existing tenant boundary proof remained intact for dashboard reads already covered there |
| `npm run build --workspace @pim1/web` | Passed | No web code changes were required for this backend-only slice |
| `npm run test:integration:delegated-access-scopes` | Passed | Existing supported scope enforcement remained intact after the dashboard read hardening |
| `npm run gate:run:increment` | Passed | Increment gate stayed green with the expanded dashboard read protections |
| `npm run gate:run:sprint` | Passed | Sprint gate stayed green with the expanded dashboard read protections |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deploy workflow contract remains intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Checked-in staging postdeploy harness remains intact after the slice |

PO/CTO validation:

- accepted for the current bounded slice: `dashboard/readiness` and `dashboard/catalog-health` are now explicit sensitive reads restricted to `admin` and `editor`, the remediation suite proves viewer and reviewer denial plus editor and admin allow behavior, and the reusable PO prompt now includes the live blocker snapshot for the next pass
- not accepted as complete: `dashboard/health` and any other broad authenticated dashboard or aggregate reads still need classification and either explicit role protection or central redaction; universal read-time redaction remains partial; unsupported scopes, API-client principal separation, multi-role migration, Product Admin boundary maturity, and final role split work all remain pending
- product claim wording remains: Vexa PIM has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, dashboard readiness, dashboard catalog-health, dashboard operations summary, and metrics KPI trend routes, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

Rollback notes:

- revert only the role annotations on `dashboard/readiness` or `dashboard/catalog-health` if a proven product requirement restores broader access to those aggregate reads
- keep the sensitive-GET guard entries and remediation assertions so any future widening remains explicit and reviewed
- treat `dashboard/health` as a separate product decision; do not use this slice as justification to silently widen or narrow that route without its own acceptance evidence

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-27 Bounded Follow-Up: Dashboard Operations And Metrics Sensitive Read Hardening

Scope:

- updated the checked-in Product Owner backlog prompt so future execution continues the remaining access-policy queue one item at a time from the first still-pending backlog item
- promoted `GET /dashboard/operations-summary` from broad authenticated access to explicit `admin` or `editor` access
- promoted `GET /metrics/kpi-trends` from broad authenticated access to explicit `admin` access because the route includes tenant signup funnel and operational trend data
- extended the sensitive-GET guard to cover both newly protected routes
- added focused remediation coverage proving viewer and reviewer denial for dashboard operations summary, viewer/reviewer/editor denial for metrics KPI trends, and allowed admin or editor behavior where expected
- updated the dashboard page and navigation-summary route so read-only roles degrade gracefully instead of failing on newly protected operational reads

Scope expansion:

- expanded from the backend controllers into the dashboard page and navigation summary route because protecting the API without adapting those callers would have turned the hardening change into a reviewer and viewer dashboard regression

Files changed in this follow-up:

- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`
- `apps/api/src/dashboard/dashboard.controller.ts`
- `apps/api/src/metrics/metrics.controller.ts`
- `scripts/validate-sensitive-get-policy.cjs`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `apps/web/src/app/dashboard/page.tsx`
- `apps/web/src/app/api/navigation/summary/route.ts`
- `apps/web/test/integration/dashboard-route-contract.test.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with explicit dashboard operations and metrics route role protection |
| `npm run guard:sensitive-gets` | Passed | Sensitive GET guard now validates 30 explicit protected read routes |
| `npm run test:integration:access-policy-remediation` | Passed | Viewer and reviewer denied dashboard operations summary; viewer, reviewer, and editor denied metrics KPI trends; admin and editor allow paths remained intact |
| `npm run test:integration:metrics-kpi-trends` | Passed | Admin KPI trends behavior remains intact for tenant-scoped connector and signup series |
| `node apps/api/test/integration/dashboard-aggregations.test.cjs` | Passed | Admin dashboard operations summary shape and cache behavior remain intact |
| `node apps/api/test/integration/dashboard-tenant-boundary.test.cjs` | Passed | Dashboard operations summary remains tenant-scoped |
| `node apps/web/test/integration/dashboard-route-contract.test.cjs` | Failed, then passed | First failure was expected contract drift after making the connectors drilldown role-aware; updated the contract to match the new boundary |
| `npm run build --workspace @pim1/web` | Failed, then passed | First failure was TypeScript nullability on role-aware operations fallback in `apps/web/src/app/dashboard/page.tsx`; fixed without changing the product decision |
| `npm run test:integration:delegated-access-scopes` | Passed | Existing supported scope enforcement remained intact after the dashboard and metrics route hardening |
| `npm run gate:run:increment` | Passed | Increment gate stayed green with the new operational-read restrictions |
| `npm run gate:run:sprint` | Passed | Sprint gate stayed green with the new operational-read restrictions |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deploy workflow contract remains intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Checked-in staging postdeploy harness remains intact after the slice |

PO/CTO validation:

- accepted for the current bounded slice: `dashboard/operations-summary` is now an explicit sensitive read restricted to `admin` and `editor`, `metrics/kpi-trends` is now an explicit sensitive read restricted to `admin`, the remediation suite proves the denial matrix, and read-only dashboard and navigation callers now render role-aware fallbacks instead of failing on newly protected reads
- not accepted as complete: broader sensitive `GET` hardening still remains for `dashboard/readiness`, `dashboard/catalog-health`, `dashboard/health`, and any other authenticated read surfaces that still rely on broad access; universal read-time redaction remains partial; unsupported scopes, API-client principal separation, multi-role migration, Product Admin boundary maturity, and final role split work all remain pending
- product claim wording remains: Vexa PIM has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, billing usage, dashboard operations summary, and metrics KPI trend routes, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

Rollback notes:

- revert only the role annotations on `dashboard/operations-summary` or `metrics/kpi-trends` if a proven product requirement restores broader access to those operational reads
- keep the sensitive-GET guard entries and remediation assertions so any future widening of those routes remains explicit and reviewed
- if broader dashboard health data is later split into safe versus privileged summaries, keep the current privileged routes locked down until the narrower public-safe contract is fully implemented and tested

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-29 Continuous Queue: Audit Explorer and Export Visibility Contract

Scope:

- added one shared visibility contract for:
  - `GET /audit/events`
  - `GET /audit/events/export`
- routed both JSON and CSV audit explorer responses through the same governance redaction decision
- preserved full explorer metadata for `super_admin` and legacy `admin`
- redacted explorer metadata for `system_admin`

Scope expansion:

- expanded from the audit controller and remediation suite into:
  - `apps/api/src/audit/audit.module.ts`
  - `apps/api/src/common/access-policy/access-policy.module.ts`
- this expansion was required because the new controller-level `AccessPolicyService` dependency created a real module-availability regression that needed explicit `forwardRef` wiring

Files changed in this follow-up:

- `apps/api/src/audit/audit.controller.ts`
- `apps/api/src/audit/audit.module.ts`
- `apps/api/src/audit/audit.service.ts`
- `apps/api/src/common/access-policy/access-policy.module.ts`
- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/src/common/rbac/read-access-policy.decorator.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled after adding the shared audit explorer visibility contract and module wiring |
| `npm run test:integration:access-policy-remediation` | Passed | Proved `system_admin` JSON and CSV metadata redaction plus `super_admin` metadata retention on the audit explorer family |
| `npm run test:integration:delegated-access-scopes` | Passed | Delegated-scope coverage stayed green after the audit-only slice |
| `npm run guard:sensitive-gets` | Passed | Sensitive-GET guard now validates the new `audit_events_governance_redacted` read policy |

PO/CTO validation:

- accepted for the current bounded slice: audit explorer JSON and CSV outputs now share one visibility contract, `system_admin` gets redacted metadata, `super_admin` and legacy `admin` retain full metadata, and CSV no longer bypasses JSON redaction
- not accepted as complete: this is not universal redaction, and other explorer/export or mixed governance payload families still need their own narrower field-visibility contracts

Rollback notes:

- revert only the audit explorer read-policy annotations and shared CSV rendering path if a proven product requirement later restores broader lower-admin metadata visibility
- keep the focused remediation assertions so any future change to audit explorer visibility remains explicit and reviewed
- if later audit work introduces field-by-field explorer metadata visibility instead of full metadata nulling, keep JSON and CSV tied to the same contract until both outputs are proven together

## 2026-04-29 Continuous Queue: Durable Multi-Role Compatibility Proofs

Scope:

- extended the current bounded multi-role rollout from additive storage and payload compatibility into durable login proof
- proved DB-backed `assigned_roles` survive through later login after workspace-user create and update flows
- proved local identity-directory auth uses the same normalized `assignedRoles` bridge semantics
- preserved scalar-role fallback and no-escalation behavior

Files changed in this follow-up:

- `apps/api/test/integration/auth-local-assigned-roles-bridge.test.cjs`
- `apps/api/test/integration/workspace-user-crud.test.cjs`
- `docs/execution/ACCESS_POLICY_EXECUTION_RECORD_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PO_CHECKPOINT_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled without changing the existing auth or workspace-user implementation |
| `node apps/api/test/integration/auth-assigned-roles-read-path.test.cjs` | Passed after sequential rerun | Initial parallel run collided with the shared `apps/api/dist` tree while the API build was still writing files; the sequential rerun proved DB-backed `assigned_roles` login behavior remained correct |
| `node apps/api/test/integration/auth-local-assigned-roles-bridge.test.cjs` | Passed after sequential rerun | Proved local identity-directory `assignedRoles` bridge, scalar fallback, and invalid-role normalization |
| `node apps/api/test/integration/workspace-user-crud.test.cjs` | Passed after sequential rerun | Proved assigned-role writes persist into later logins and remove former editor-capable access when the stored role set changes |
| `npm run test:integration:access-policy-remediation` | Passed | Broad access-policy regression suite remained green |
| `npm run test:integration:delegated-access-scopes` | Passed | Delegated-scope enforcement remained green after the durability proofs |
| `npm run guard:sensitive-gets` | Passed | Sensitive-GET guard remained unchanged at `authenticatedReadRoutes=71`, `authenticatedRoutes=158`, `publicRoutes=19`, and `adminBoundaryCheckedRoutes=49` |

PO/CTO validation:

- accepted for the current bounded slice: durable multi-role compatibility is now proven beyond additive storage alone, including local identity bridge compatibility, persisted assigned-role write durability through later logins, scalar fallback preservation, and no-escalation behavior
- not accepted as complete: this is still not a destructive migration, not a backfill-complete rollout, not scalar-role removal, and not the full multi-role admin UX/API surface

Rollback notes:

- revert only the added durability proofs if a later product decision intentionally narrows the current multi-role compatibility contract
- keep the bounded login and workspace-user persistence assertions so future multi-role changes remain explicit and regression-tested
- do not remove scalar-role fallback until a later validated rollout proves backfill, rollback, and wider API semantics

## 2026-04-29 Continuous Queue: Billing Plan-Tier Governance Boundary

Scope:

- extended the already-proven billing governance boundary to `POST /billing/plan-tier`
- kept the existing internal-only commercial block for allowed security admins
- made the `product_admin` denial explicit at the admin-boundary layer instead of via the downstream commercial-only fallback

Files changed in this follow-up:

- `apps/api/src/billing/billing.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `docs/execution/ACCESS_POLICY_EXECUTION_RECORD_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PO_CHECKPOINT_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with the bounded billing plan-tier admin boundary |
| `npm run test:integration:access-policy-remediation` | Passed | Proved `product_admin` boundary denial plus preserved `COMMERCIAL_MUTATION_INTERNAL_ONLY` behavior for `system_admin` and `super_admin` |
| `npm run test:integration:delegated-access-scopes` | Passed | No delegated-scope regression from the governance-only slice |
| `npm run guard:sensitive-gets` | Passed | Sensitive-GET guard remained unchanged because this slice is POST-only governance enforcement |

PO/CTO validation:

- accepted for the current bounded slice: billing plan-tier now has an explicit governance boundary aligned with the adjacent billing-governance routes, while the internal commercial-ops mutation block remains intact for the allowed higher-privilege roles
- not accepted as complete: this does not widen or redesign `billing/internal/*` commercial token flows and is not full billing authorization completion

Rollback notes:

- revert only the `@AdminBoundaryAccess(...)` addition on `POST /billing/plan-tier` if a proven product decision restores broader product-admin reach to that route
- keep the remediation assertions so any future widening of the plan-tier route remains explicit and reviewed

## 2026-04-27 Bounded Follow-Up: Billing Usage Sensitive Read Hardening

Scope:

- promoted `GET /billing/usage` from broad authenticated read behavior to explicit `admin` or `editor` access
- extended the sensitive-GET guard to cover billing usage as a protected high-risk read
- added focused access-policy remediation coverage for viewer and reviewer denial, plus editor and admin allow behavior on billing usage
- performed a minimal frontend scope expansion so reviewer and viewer dashboards no longer depend on billing usage and instead render a role-aware fallback message
- updated the dashboard client hook to avoid unnecessary billing-usage fetches for read-only roles

Scope expansion:

- expanded from the backend billing controller into the dashboard web caller and the shared plan-usage hook because leaving reviewer and viewer dashboard paths untouched would have converted a backend hardening change into a broader user-facing dashboard regression

Files changed in this follow-up:

- `apps/api/src/billing/billing.controller.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `apps/web/src/app/dashboard/page.tsx`
- `apps/web/src/hooks/use-plan-usage.ts`
- `apps/web/test/integration/dashboard-route-contract.test.cjs`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with billing usage route protection |
| `npm run guard:sensitive-gets` | Passed | Sensitive GET guard now validates 28 protected read routes |
| `npm run test:integration:access-policy-remediation` | Passed | Viewer and reviewer denied billing usage; editor and admin still allowed |
| `node apps/api/test/integration/billing-usage-cache-read.test.cjs` | Passed | Billing usage cache behavior remains intact for allowed callers |
| `node apps/web/test/integration/dashboard-route-contract.test.cjs` | Passed | Dashboard route now uses role-aware billing usage access and read-only fallback behavior |
| `npm run build --workspace @pim1/web` | Passed | Web build remains healthy with the dashboard fallback change |
| `npm run gate:run:increment` | Passed | Increment gate stayed green with billing usage hardening |
| `npm run gate:run:sprint` | Passed | Sprint gate stayed green with billing usage hardening |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deploy workflow contract remains intact |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Staging postdeploy harness still passes after the billing slice |

PO/CTO validation:

- accepted for the current bounded slice: billing usage is now an explicit sensitive read restricted to `admin` and `editor`, the remediation suite proves reviewer and viewer denial, and reviewer and viewer dashboard paths no longer rely on that sensitive payload
- not accepted as complete: dashboard, metrics, and other remaining authenticated reads still need broader sensitive-GET review; universal read-time redaction remains partial; unsupported scopes, API-client principal separation, multi-role migration, Product Admin boundary maturity, and final role split work all remain pending
- product claim wording remains: Vexa PIM has verified access-policy hardening, selected sensitive-read protection including covered catalog, AI helper, and billing usage routes, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

Rollback notes:

- revert only the billing usage role annotation and reviewer or viewer dashboard fallback if a proven business requirement restores non-editor access to billing usage
- keep the focused remediation assertions and sensitive-GET guard entry so any future relaxation of billing access remains explicit and reviewed
- if dashboard follow-up work later broadens role-aware summary data, keep billing status and plan usage as separate protected commercial signals unless PO signs off on a narrower public summary shape

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record

## 2026-04-27 Bounded Follow-Up: AI Helper Sensitive Read Hardening

Scope:

- added a Product Owner execution prompt for all still-pending access-policy backlog items in [ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md](./ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md)
- hardened `auto-suggestions` sensitive read endpoints with explicit `admin` or `editor` access
- hardened `rejection-intelligence` score reads with explicit `admin`, `editor`, or `reviewer` access
- extended direct object-ID scope enforcement to AI helper reads and AI repair flows by passing authenticated actor context into the services and asserting product scope centrally
- expanded the sensitive-GET guard and focused integration suites to cover the newly protected AI helper routes

Files changed in this follow-up:

- `apps/api/src/auto-suggestions/auto-suggestions.controller.ts`
- `apps/api/src/auto-suggestions/auto-suggestions.module.ts`
- `apps/api/src/auto-suggestions/auto-suggestions.service.ts`
- `apps/api/src/rejection-intelligence/rejection-intelligence.controller.ts`
- `apps/api/src/rejection-intelligence/rejection-intelligence.module.ts`
- `apps/api/src/rejection-intelligence/rejection-intelligence.service.ts`
- `apps/api/test/integration/access-policy-remediation.test.cjs`
- `apps/api/test/integration/delegated-access-scopes.test.cjs`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`
- `scripts/validate-sensitive-get-policy.cjs`

Validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @pim1/api` | Passed | API compiled with AI helper role hardening and scope-aware service enforcement |
| `npm run guard:sensitive-gets` | Passed | Sensitive GET guard now validates 27 explicit high-risk read routes including AI helper reads |
| `npm run test:integration:access-policy-remediation` | Passed | Viewer and reviewer are denied auto-suggestion reads; viewer is denied rejection-intelligence score; reviewer score access remains allowed |
| `npm run test:integration:delegated-access-scopes` | Passed | Direct AI helper reads and AI repair dry-runs now respect category and brand intersection scope enforcement |
| `node apps/api/test/integration/rejection-intelligence-score.test.cjs` | Passed | Existing rejection score behavior remains intact for allowed actors and cross-tenant access stays denied |
| `npm run build --workspace @pim1/web` | Passed | Web build remained healthy after the backend-only slice |
| `npm run gate:run:increment` | Passed | Increment gate stayed green with the expanded AI helper authz coverage |
| `npm run gate:run:sprint` | Passed | Sprint gate passed; its built-in retry recovered one transient `metrics-kpi-trends` first-publish assertion miss before succeeding on the second attempt |
| `node scripts/validate-deploy-staging-workflow.cjs` | Passed | Deploy workflow contract still protects non-admin staging smoke coverage |
| `node scripts/staging-postdeploy-check.test.cjs` | Passed | Checked-in staging postdeploy harness still validates workspace login, revocation, admin render, and non-admin denials |
| `git diff --check` | Passed | No patch formatting or whitespace errors |
| touched-file secret scan with `rg` | Passed with expected test-fixture matches | Only local dummy test tokens, passwords, and secret variable names matched; no real credentials were introduced |

PO/CTO validation:

- accepted for the current bounded slice: AI helper sensitive read hardening, reviewer-safe rejection score access, direct object-ID scope enforcement for AI helper routes, and a checked-in PO prompt for the remaining backlog order
- not accepted as complete: broader sensitive `GET` hardening for dashboard, metrics, billing, and other remaining authenticated read surfaces; universal read-time redaction outside covered catalog paths; unsupported scopes such as vendor or owner and locale; API-client principal separation; multi-role migration; Product Admin boundary maturity; or final role split work
- product claim wording remains: Vexa PIM has verified access-policy hardening, selected sensitive-read protection including covered catalog and AI helper routes, shadow-mode policy evaluation under legacy RBAC authority, and supported delegated-access enforcement for selected scope dimensions. It is not yet a complete enterprise authorization model across all fields, scopes, API-client principals, and role-maturity requirements.

Rollback notes:

- revert only the AI helper controller role annotations and service-level scope assertions if legitimate reviewer or editor workflows are proven blocked unexpectedly
- keep the sensitive-GET guard entries and focused tests so future route-role changes still require explicit product review
- if the sprint gate shows recurring metrics flakiness outside this slice, treat that as an existing gate stability issue and do not roll back the AI helper authorization changes without direct regression evidence

Lock update:

- no `INCREMENT_STATE.json` story was updated in this follow-up because this remains a bounded access-policy backlog continuation without a matching unlocked story record
