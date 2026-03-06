# ORBIT Admin UI - Functionality-wise User Guide

## Scope
This guide groups capabilities by business function (instead of by tab).

Primary implementation sources:
- `admin-ui/src/ui/OrbitShell.tsx`
- `admin-ui/src/pages/*.tsx`
- `admin-ui/src/ExecutionDetailPage.tsx`
- `admin-ui/src/ui/auth/AuthScreen.tsx`
- `admin-ui/src/auth.ts`

## 1) Authentication and Session Management

**Entry screen**
- Auth screen appears when no valid session is present.

**Supported flows**
1. Password login
2. OTP login
3. MFA OTP verification after challenge
4. Access token refresh
5. Logout

**User steps**
1. Enter tenant slug and email.
2. Choose password or OTP mode.
3. Complete first factor.
4. If prompted, complete MFA OTP.
5. Shell loads with tab set based on role.

**APIs**
- `/auth/login`, `/auth/otp/request`, `/auth/otp/verify`, `/auth/mfa/verify`, `/auth/refresh`, `/auth/logout`

---

## 2) Execution Monitoring and Drill-down

**Primary pages**
- Dashboard
- Executions
- Execution Detail

**What users can do**
- See execution KPIs and latest runs.
- Filter execution list by lifecycle status.
- Open a run for timeline/payload/failure details.

**Execution lifecycle labels in UI**
- queued, running, completed (from `succeeded`), failed, dead

**Data pattern**
- List endpoint (`/executions`) + per-item detail enrichment (`/internal/executions/:id`).

---

## 3) Replay, DLQ, and Failure Recovery

**Primary pages**
- Execution Detail (Replay)
- DLQ (Replay/Resolve)

**Replay paths**
- From execution detail: `/admin/executions/:executionId/replay`
- From DLQ page: `/admin/executions/dlq/:executionId/replay`

**Resolve path**
- `/dlq/:executionId/resolve`

**Control safeguards present in UI**
- Confirmation modal before DLQ actions
- Resolve button restricted to operator role
- Action busy indicators and result message feedback

---

## 4) Command and Control Operations

**Primary pages**
- Cmd Console
- Cmd Ledger

**Supported commands in UI**
- `RETRY_EXECUTION`
- `CANCEL_EXECUTION`

**Safety checks before submit**
- Execution ID required
- Minimum reason length required
- Exact typed confirmation phrase required

**Audit visibility**
- Ledger page shows issued commands + latest command result status.

---

## 5) Connector Health and Runtime Operations

**Primary pages**
- Connectors
- Conn Admin (scope-gated)

**Connector health capability**
- Pull live health list
- Filter/search connectors
- Test connector connection

**Admin capability (Conn Admin)**
- Sync definition registry
- Register new connector definitions
- Manage circuit breaker thresholds
- Force breaker states open/closed with explicit reason and confirmation
- Inspect breaker events

---

## 6) Tenant Runtime Configuration

**Primary page**
- Tenants

**Capabilities**
- View tenant-level execution aggregates.
- Read connector runtime config.
- Update runtime config when role is operator.

**Config fields shown in UI**
- mode
- sync_enabled
- mfa_required_for_changes
- max_concurrent_executions
- max_queue_depth

---

## 7) Access Policy Governance

**Primary page**
- Access

**Capabilities**
- Query policies with filters.
- Grant new policy (allow/deny) with principal/action/domain scope.
- Revoke selected policy.
- Evaluate effective access decision for action+domain (with optional subject for super_admin).

**Permission model in UI**
- Read/grant/revoke/review each gate independently based on JWT scopes.

---

## 8) API Key Lifecycle Governance

**Primary page**
- API Keys (scope-gated)

**Capabilities**
- List active/revoked key records.
- Create key for tenant (optional connector binding + expiry + scopes).
- Rotate key with overlap seconds.
- Revoke key.
- Copy raw issued key one time from in-memory display panel.

**Guardrails**
- Explicit confirmation prompts on rotate and revoke.
- Permission requirement: `api_keys:manage`.

---

## 9) Alerting and Circuit-History Features (Present in Source, Not in Shell Tabs)

**Alert Routing**
- Rule CRUD and test-send features exist in source page.
- Not mounted in current tab nav.

**Circuit Breaker History page**
- Search connector ID and fetch breaker event history.
- Not mounted in current tab nav.

---

## Functional Cross-reference Matrix

| Functionality | Primary Page(s) | API Calls |
|---|---|---|
| Login + session bootstrap | Auth Screen | `/auth/login`, `/auth/refresh`, `/auth/logout` |
| OTP + MFA | Auth Screen | `/auth/otp/request`, `/auth/otp/verify`, `/auth/mfa/verify` |
| Monitor runs | Dashboard, Executions | `/executions`, `/internal/executions/:id` |
| Execution replay | Execution Detail, DLQ | `/admin/executions/:id/replay`, `/admin/executions/dlq/:id/replay` |
| DLQ resolution | DLQ | `/dlq/:id/resolve` |
| Operational commands | Cmd Console, Cmd Ledger | `/internal/control/commands`, `/internal/control/command-results` |
| Connector health | Connectors | `/internal/connectors/health`, `/admin/connectors/:id/test-connection` |
| Connector registry admin | Conn Admin | `/internal/connectors/catalog`, `/internal/connectors/definitions*`, breaker admin routes |
| Tenant runtime config | Tenants | `/internal/connectors/config` (GET/PUT) |
| Access policies | Access | `/internal/access/policies*`, `/internal/access/effective` |
| API key lifecycle | API Keys | `/internal/access/api-keys*` |
| Alert routing (source-present) | Alert Routing page | `/internal/alerts/rules*`, `/internal/alerts/test` |

---

## Known Gaps Explicitly Visible in Source
1. Tab navigation is internal state based (no deep-link URL routing in shell).
2. Alert Routing and Circuit Breaker History pages are implemented but not mounted in `OrbitShell`.
3. `ui/ExecutionDetail.tsx` and `ui/ExecutionTimeline.tsx` components exist but are not used by mounted pages.
