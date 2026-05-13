# QA Phase 0 Baseline (2026-03-29)

This document records the current Vexa PIM validation baseline directly from the repository and sets the starting point for phased QA automation execution.

## Frontend Route Inventory

### Public
- `/`
- `/login`
- `/login/locked`
- `/login/reset`
- `/consent`
- `/signup`
- `/signup/verify`

### Authenticated tenant
- `/dashboard`
- `/catalog`
- `/catalog/attributes`
- `/catalog/categories`
- `/catalog/media`
- `/catalog/products`
- `/products/[id]`
- `/channels`
- `/channels/connectors`
- `/channels/connectors/[installationId]`
- `/channels/health`
- `/channels/mappings`
- `/channels/submissions`
- `/connectors`
- `/connectors/[installationId]/mapping`
- `/operations`
- `/operations/bulk-edit`
- `/operations/imports`
- `/operations/jobs`
- `/operations/repair`
- `/quality`
- `/quality/approvals`
- `/quality/completeness`
- `/quality/issues`
- `/quality/validation`
- `/media`
- `/reports`
- `/rejection`

### Admin / governance
- `/admin`
- `/admin/api-keys`
- `/admin/audit`
- `/admin/connectors`
- `/admin/plan`
- `/admin/privacy`
- `/admin/users`
- `/admin/webhooks`
- `/admin/workspace`

### Internal non-production ops
- `/internal/developer`
- `/ai`
- `/ondc`

### Redirect / alias pages
- `/settings`
- `/settings/connectors`
- `/settings/plan`
- `/settings/privacy`

## Backend Endpoint Inventory By Domain

### Auth and onboarding
- `auth`
- `signup`
- `platform/tenants`

### Catalog and workflow
- `catalog`
- `products`
- `taxonomy/categories`
- `auto-suggestions`

### Quality and governance
- `compliance`
- `issues`
- `audit`
- `notifications`

### Channels and publishing
- `connectors`
- `marketplace`
- `submissions`
- `dashboard`
- `metrics`

### Operations
- `bulk-import`
- `bulk-edit`
- `media`

### Access and admin control
- `admin/api-keys`
- `admin/workspace/users`
- `admin/webhooks`
- `billing`

### Platform / feature-gated internal
- `ondc`
- `rejection-intelligence`

## Action Inventory By Page

### Public auth and onboarding
- `/login`
  - submit workspace-aware login
  - handle invalid credentials, workspace-not-found, rate limit, account lock, suspension
  - branch into `/login/reset` and `/login/locked`
- `/login/reset`
  - request password reset email
  - confirm password reset from token
  - return to login with workspace/email context
- `/login/locked`
  - resend unlock/recovery email
  - return to login with workspace context
- `/signup`
  - check workspace availability
  - submit workspace creation
  - handle pending verification / duplicate email / delivery failure
- `/signup/verify`
  - verify token
  - resend verification

### Core catalog
- `/catalog/products`
  - list/search/filter products
  - open product detail
  - route into mapping manager and workflow actions
- `/products/[id]`
  - edit product fields
  - validate readiness
  - workflow transitions
  - review / reject / repair

### Quality
- `/quality/issues`
  - list/filter issues
  - drill into product and severity views
- `/quality/approvals`
  - review approval queue
  - approve / reject if surfaced by role
- `/quality/validation`
  - blocking/warning summaries

### Channels and publishing
- `/channels/connectors`
  - connector install / manage
  - permission-gated actions
- `/channels/mappings`
  - mapping lifecycle and protected edits
- `/channels/submissions`
  - publish/readiness lifecycle
- `/channels/health`
  - review publishing health surface

### Operations
- `/operations/imports`
  - import template / upload / process / status
- `/operations/bulk-edit`
  - scope and protected bulk update actions
- `/operations/jobs`
  - queue/job visibility

### Admin and commercial
- `/admin/users`
  - workspace user create / role / lock / deactivate
- `/admin/api-keys`
  - api key lifecycle
- `/admin/webhooks`
  - webhook management
- `/admin/privacy`
  - privacy status / export / deletion
- `/admin/audit`
  - filter / export audit trail
- `/admin/plan`
  - usage visibility
  - signup analytics
  - billing contact management
  - upgrade request flow

### Internal commercial ops
- `/internal/developer`
  - tenant search
  - request queue
  - request lifecycle actions
  - attention/SLA filters
  - export flows
  - tenant and request detail views
  - audit follow-up links

## UI To Endpoint Map

### Public auth and onboarding
- `/login`
  - `POST /auth/login`
- `/login/reset`
  - `POST /auth/password-reset/request`
  - `POST /auth/password-reset/confirm`
- `/login/locked`
  - `POST /auth/resend-unlock`
- `/signup`
  - `GET /signup/workspace/availability`
  - `POST /signup/workspace`
- `/signup/verify`
  - `POST /signup/verify`
  - `POST /signup/resend-verification`

### Admin and governance
- `/admin/users`
  - `GET/POST /admin/workspace/users`
  - `PATCH /admin/workspace/users/:userId/role`
  - `POST /admin/workspace/users/:userId/lock`
  - `POST /admin/workspace/users/:userId/unlock`
  - `POST /admin/workspace/users/:userId/deactivate`
  - `POST /admin/workspace/users/:userId/password`
- `/admin/api-keys`
  - `GET/POST /admin/api-keys`
- `/admin/webhooks`
  - `GET/POST /admin/webhooks`
- `/admin/privacy`
  - `GET /auth/account/privacy-status`
  - `POST /auth/account/export`
  - `GET /auth/account/export/:jobId/download`
  - `DELETE /auth/account`
- `/admin/audit`
  - `GET /audit/events`
  - `GET /audit/events/export`
- `/admin/plan`
  - `GET /billing/usage`
  - `GET /billing/upgrade-request`
  - `POST /billing/upgrade-request`
  - `POST /billing/billing-contact`
  - `GET /metrics/*` and dashboard/signup trend helpers via current API client usage

### Channels and publishing
- `/channels/connectors`
  - `GET /connectors`
  - install/reconnect/remove connector installer routes under `connectors`
- `/channels/mappings`
  - mapping-related `connectors` / `marketplace` lifecycle endpoints
- `/channels/submissions`
  - `submissions`
  - `marketplace`
- `/channels/health`
  - `dashboard`
  - `metrics`

### Operations
- `/operations/imports`
  - `bulk-import`
- `/operations/bulk-edit`
  - `bulk-edit`
- `/operations/jobs`
  - queue/job state endpoints under existing operations and marketplace surfaces

### Internal commercial ops
- `/internal/developer`
  - hidden internal billing routes:
    - `GET /billing/internal/overview`
    - `GET /billing/internal/upgrade-requests`
    - `POST /billing/internal/upgrade-requests/status`
    - `GET /billing/internal/upgrade-requests/export`
    - `GET /billing/internal/tenants/search`
    - `GET /billing/internal/tenants/export`

## Current Coverage Clusters

### Strong coverage already present
- public signup
- auth password reset and lockout API
- auth suspension UI
- catalog workflow transitions
- quality reviewer role
- connector permissions and mapping lifecycle
- operations import/bulk-edit boundaries
- admin privacy and audit
- billing/commercial control
- internal commercial ops overview/exports/detail filters
- dashboard signup analytics

### Existing representative tests
- API:
  - `public-signup.test.cjs`
  - `auth-password-reset.test.cjs`
  - `auth-login-lockout.test.cjs`
  - `product-workflow-transitions.test.cjs`
  - `connector-access-entitlements.test.cjs`
  - `billing-commercial-control.test.cjs`
  - `billing-upgrade-request.test.cjs`
- Web:
  - `public-signup-ui.test.cjs`
  - `public-signup-web-flow.test.cjs`
  - `auth-shell-ui.test.cjs`
  - `auth-suspension-ui.test.cjs`
  - `product-detail-workflow-ui.test.cjs`
  - `internal-commercial-ops-ui.test.cjs`
  - `admin-privacy-ui.test.cjs`
  - `audit-explorer-ui.test.cjs`

## Obvious Blind Spots At Baseline

### Phase 1 gaps
- no focused web contract test for recovery surfaces:
  - `/login/reset`
  - `/login/locked`
- login recovery routing is present, but not explicitly validated as a connected web-contract surface

### Future phase gaps
- no single consolidated route/action inventory artifact existed before this baseline
- approvals and quality pages have coverage, but not yet a single phase report tying page inventory to endpoints
- channel health/readiness browser-critical flows still rely more on API and source-contract coverage than full browser journeys
- alias/redirect coverage is still scattered rather than centrally inventoried

## Phase 0 Quality Verdict

### Verdict
- Phase 0 is now trustworthy enough to guide incremental QA work.

### Why
- route inventory is grounded in real `page.tsx` files
- backend inventory is grounded in current controllers
- current coverage clusters are strong in the highest-risk domains
- current blind spots are now explicit instead of implicit

### Remaining risk
- this is an execution baseline, not complete validation coverage
- route/action mapping for some secondary pages is still summarized at the domain level rather than exhaustively enumerated per button

## Phase 1 Selected Increment

### Chosen slice
- recovery surface validation for:
  - `/login/reset`
  - `/login/locked`

### Why this slice
- it closes the most obvious public-auth web-contract gap
- it complements existing backend truth in:
  - `auth-password-reset.test.cjs`
  - `auth-login-lockout.test.cjs`
- it improves confidence without duplicating existing signup and suspension work
