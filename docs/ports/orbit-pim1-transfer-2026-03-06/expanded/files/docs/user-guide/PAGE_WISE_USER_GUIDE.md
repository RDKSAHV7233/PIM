# ORBIT Admin UI - Page-wise User Guide

## Scope
This guide is generated from the current UI source in `admin-ui/src` and documents each mounted screen and action flow.

Primary source files:
- `admin-ui/src/ui/OrbitShell.tsx`
- `admin-ui/src/App.tsx`
- `admin-ui/src/pages/*.tsx`
- `admin-ui/src/ExecutionDetailPage.tsx`
- `admin-ui/src/ui/auth/AuthScreen.tsx`

## Navigation and Role Matrix
The app uses tab-based navigation in `OrbitShell` (not URL routing).

| UI Role | Tabs visible | Scope-gated tabs |
|---|---|---|
| `operator` | Dashboard, Executions, Cmd Console, Cmd Ledger, Connectors, Tenants, Access, DLQ | `Conn Admin` requires `connectors:manage`; `API Keys` requires `api_keys:manage` |
| `tenant_admin` | Dashboard, Executions, Connectors, Tenants, Access, DLQ | `API Keys` requires `api_keys:manage` |
| `connector_dev` | Connectors, Dashboard | None |

---

## 1. Auth Screen
**Component:** `ui/auth/AuthScreen.tsx`

**Purpose**
Authenticate user and establish session before loading shell.

**Modes**
- Password login
- OTP login
- MFA verification (triggered by challenge token)

**Actions**
- Password flow: Tenant slug + email + password -> Sign in
- OTP flow: Request OTP -> enter OTP -> Verify OTP
- MFA flow: Enter MFA OTP -> Verify MFA

**Backend APIs**
- `POST /auth/login`
- `POST /auth/otp/request`
- `POST /auth/otp/verify`
- `POST /auth/mfa/verify`
- Session bootstrap: `POST /auth/refresh`
- Logout: `POST /auth/logout`

**User-visible states**
- Busy states (`Signing in...`, `Verifying...`)
- Error message area
- Info message area (for OTP or MFA prompts)

---

## 2. Dashboard
**Component:** `pages/orbit-dashboard.tsx`

**Purpose**
Operational snapshot of executions, DLQ, connector health, and alerts.

**Key widgets**
- KPI cards: Events Today, Active Executions, DLQ Depth, p95 Latency proxy
- Recent Executions table (with `View` action)
- Queue depth by tenant bars
- Connector health list
- DLQ panel
- Alerts panel

**Actions**
- Open execution detail from Recent Executions (`View`)

**Backend APIs**
- `GET /admin/executions/dlq?limit=20`
- `GET /internal/connectors/health`
- `GET /alerts`
- Uses `useExecutionList()` -> `GET /executions` and per-row detail reads

**Refresh behavior**
- Auto-refresh every 10 seconds

---

## 3. Executions
**Component:** `pages/orbit-executions.tsx`

**Purpose**
View and triage execution records with status filtering and summary counters.

**Key elements**
- Summary cards: Total, Queued, Running, Completed, Failed, Dead, DLQ, Retries
- Status filter chips (`all`, `queued`, `running`, `completed`, `failed`, `dead`)
- Execution table with `View`

**Actions**
- Refresh list
- Filter by status
- Open execution detail

**Data source**
- `useExecutionList()`
  - `GET /executions`
  - `GET /internal/executions/:executionId` (enrichment)

---

## 4. Execution Detail
**Component:** `ExecutionDetailPage.tsx`

**Purpose**
Deep inspection and replay handling for one execution.

**Sections/Tabs**
- Header summary: execution id, tenant, connector, created, status chip
- Details tab
- Payload tab (redacted payload display)
- Trace tab (timeline events)

**Actions**
- Back to list
- Replay (only when status is `failed` or `dead`)
- Tab switching

**Backend APIs**
- `GET /executions`
- `GET /internal/executions/:executionId`
- Replay: `POST /admin/executions/:executionId/replay`

**Special fields shown (when present)**
- `terminalFailureReason`
- `retryOf`
- `dlqEntryId`

---

## 5. Cmd Console
**Component:** `pages/command-console.tsx`

**Purpose**
Submit controlled commands to retry or cancel execution.

**Command types**
- `RETRY_EXECUTION`
- `CANCEL_EXECUTION`

**Required inputs/validation**
- Execution ID required
- Reason minimum length: 10 chars
- Typed confirmation required exactly: `CONFIRM <COMMAND_TYPE>`

**Backend API**
- `POST /internal/control/commands`

---

## 6. Cmd Ledger
**Component:** `pages/command-ledger.tsx`

**Purpose**
Audit-style view of command submission and command result stream.

**Key elements**
- Command table
- Latest result status per command
- Optional reason on result

**Backend APIs**
- `GET /internal/control/commands`
- `GET /internal/control/command-results`

---

## 7. Connectors
**Component:** `pages/orbit-connectors.tsx`

**Purpose**
Connector catalog and live health checks.

**Key elements**
- Search + type/status filters
- Connector list table
- Connector detail pane (phase, type, auth, events, endpoints)

**Actions**
- Select connector
- Test Connection

**Backend APIs**
- `GET /internal/connectors/health`
- `POST /admin/connectors/:connectorId/test-connection`

---

## 8. Conn Admin
**Component:** `pages/orbit-connector-admin.tsx`

**Access prerequisite**
- Scope: `connectors:manage` (or super admin)

**Purpose**
Admin-level connector registry and circuit breaker control surface.

**Main areas**
- Runtime catalog
- Register definition form
- Circuit breaker controls
- Definition registry list
- Marketplace listings list
- Recent circuit breaker events

**Actions**
- Sync built-in definitions
- Register definition
- Test connector connection
- Update circuit breaker thresholds
- Force breaker open/closed (reason required + confirm)

**Backend APIs**
- `GET /internal/connectors/catalog`
- `GET /internal/connectors/definitions?include_inactive=true`
- `GET /internal/connectors/marketplace`
- `POST /internal/connectors/definitions/sync`
- `POST /internal/connectors/definitions`
- `POST /admin/connectors/:id/test-connection`
- `GET /admin/connectors/:id/circuit-breaker`
- `PUT /admin/connectors/:id/circuit-breaker`
- `POST /admin/connectors/:id/circuit-breaker/force-open`
- `POST /admin/connectors/:id/circuit-breaker/force-closed`
- `GET /admin/connectors/:id/circuit-breaker/events?limit=20`

---

## 9. Tenants
**Component:** `pages/orbit-tenants.tsx`

**Purpose**
Tenant-scoped execution summary + runtime connector config.

**Role behavior**
- Operator role: editable config
- Non-operator: read-only config

**Main areas**
- Tenant execution aggregate table
- Runtime connector config form

**Actions**
- Save runtime config (operator only)

**Backend APIs**
- `GET /internal/connectors/config`
- `PUT /internal/connectors/config`

---

## 10. Access
**Component:** `pages/orbit-access.tsx`

**Purpose**
Manage domain-scoped policy allow/deny entries and evaluate effective access.

**Permission checks**
- Read: `access:read` or `users:manage` or super admin
- Grant: `access:grant` or `users:manage` or super admin
- Revoke: `access:revoke` or `users:manage` or super admin
- Review/evaluate: `access:review` or `users:manage` or super admin

**Main areas**
- Policy list with filters
- Selected policy details and revoke workflow
- Grant form
- Effective access evaluator

**Backend APIs**
- `GET /internal/access/policies?...`
- `POST /internal/access/policies/grant`
- `POST /internal/access/policies/revoke`
- `POST /internal/access/effective`

---

## 11. API Keys
**Component:** `pages/orbit-api-keys.tsx`

**Access prerequisite**
- Scope: `api_keys:manage` (or super admin)

**Purpose**
Create, rotate, revoke tenant API keys.

**Main areas**
- Keys table
- Create form
- Selected key rotate/revoke panel
- One-time raw key display panel with copy action

**Actions**
- Create key
- Rotate key (with confirmation)
- Revoke key (with confirmation)
- Copy newly issued raw key

**Backend APIs**
- `GET /internal/access/api-keys`
- `POST /internal/access/api-keys`
- `POST /internal/access/api-keys/:id/rotate`
- `POST /internal/access/api-keys/:id/revoke`

---

## 12. DLQ
**Component:** `pages/orbit-dlq.tsx`

**Purpose**
Dead-letter triage and recovery operations.

**Main areas**
- DLQ table
- Selected item detail panel
- Confirm dialog for replay/resolve actions

**Actions**
- Replay failed execution
- Resolve DLQ entry

**Role behavior**
- Resolve is enabled only for operator role (`isOperatorRole(claims)`)

**Backend APIs**
- `GET /admin/executions/dlq?limit=200`
- Replay path helper: `POST /admin/executions/dlq/:executionId/replay`
- Resolve: `POST /dlq/:executionId/resolve`

---

## 13. Source-Present but Not Mounted in Shell Tabs
These pages exist in source but are not wired into `OrbitShell` tab navigation:

1. **Alert Routing** (`pages/orbit-alerts.tsx`)
   - APIs used:
     - `GET /internal/alerts/rules`
     - `POST /internal/alerts/rules`
     - `DELETE /internal/alerts/rules/:ruleId`
     - `POST /internal/alerts/test`

2. **Circuit Breaker History** (`pages/orbit-circuit-breaker-history.tsx`)
   - Uses `components/CircuitBreakerHistory.tsx`
   - API used inside component:
     - `GET /admin/connectors/:connectorId/circuit-breaker/events?limit=:n`

---

## Notes
- UI mock mode can be enabled via `VITE_UI_MOCK=true` in development (`IS_DEV_MOCK` in `lib/api.ts`).
- All HTTP errors are mapped through `ApiError` in `lib/api.ts` and surfaced as page-level messages.
