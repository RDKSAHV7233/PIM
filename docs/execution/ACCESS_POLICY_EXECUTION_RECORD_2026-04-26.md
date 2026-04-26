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

## Gate Notes

- The increment gate and sprint gate now both validate the current access-policy slice through standard repo commands instead of ad hoc one-off test execution.
- A local regression in [rejection-notification.test.cjs](../../apps/api/test/integration/rejection-notification.test.cjs) was repaired during this slice so the expanded increment gate could pass under the current workspace-login contract.
- The raw SQL governance guard also required a missing RLS comment in [connector-webhook-ingestion.service.ts](../../apps/api/src/connector-framework/connector-webhook-ingestion.service.ts) before the increment gate could pass cleanly.
- The rollout snapshot now consumes the local signoff artifact and current recorded evidence successfully.
- The staging smoke runner itself is now stronger: it can validate selected non-admin denial paths on the deployed app instead of stopping at the admin happy path.
- The staging deploy workflow now carries that enhanced smoke path by default through `STAGING_VALIDATE_NON_ADMIN=true`, and the workflow validator protects that setting.
- Real staging API and web smoke validation now succeeded using the supplied credentials, including viewer/reviewer/editor denial-path coverage and stale-token rejection after later lock/deactivate.
- A live rollout snapshot against the deployed staging API now reports `health.ok=true`, `controlledPending=[]`, and `broadPending=[]`.
- This machine's default DNS resolver still refuses Railway hostnames, so live staging checks and the live rollout snapshot were executed with externally resolved IPs and the curl-based DNS shim rather than direct hostname resolution.

## Sign-off Position

Current execution verdict:

- access-policy hardening remains validated
- supported delegated-access enforcement remains validated
- PR CI now enforces the critical access-policy suites
- formal increment and sprint gate runners now enforce the same authz suites locally
- deploy-backed staging verification is configured to run the enhanced non-admin access-policy smoke on future staging deploy runs
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

Those artifacts are intentionally local-run evidence. They now include a real deployed staging smoke pass plus a clean deployed staging rollout snapshot, but they still do not replace a GitHub deploy-backed staging signoff run with an external run URL captured directly from the deploy workflow.

## Next Execution Step

The next useful bounded step is to carry this same automated evidence path into a real staging deployment signoff run with a GitHub Actions run URL, so the same smoke and rollout proof can be validated by [validate-live-staging-evidence.cjs](../../scripts/validate-live-staging-evidence.cjs) without relying on local-run artifacts.
