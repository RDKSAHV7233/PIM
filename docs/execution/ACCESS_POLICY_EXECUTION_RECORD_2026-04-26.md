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
