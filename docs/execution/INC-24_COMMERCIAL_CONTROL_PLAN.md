---
title: Vexa PIM Commercial Control Plan
status: proposed
owner: Product + CTO
last_updated: 2026-03-26
---

## 1. Purpose

Define the next commercial-control increment for Vexa PIM so the product can distinguish:

- pricing plan
- billing state
- access state

without overloading `planTier` to mean payment truth.

This plan is grounded in the current repo and current validation evidence.

## 2. Current validated reality

### What exists today

1. New self-serve workspaces land on `STARTER`.
2. Plan usage and plan limits are enforced.
3. Tenant plan profile exists and is the current commercial source of truth.
4. Login already respects workspace activity through `WorkspaceDirectory.isActive`.

### What does not exist today

1. No billing status such as `trial`, `active_paid`, `past_due`, or `cancelled`.
2. No supported workspace suspension flow.
3. No payment-provider checkout or subscription sync during signup.
4. No production distinction between unpaid and paid beyond plan tier convention.

### Current risk that must be closed first

Tenant admins can currently change their own plan tier from `/admin/plan` and `POST /api/v1/billing/plan-tier`.

That is not acceptable for real commercial control.

## 3. PO review

### Verdict

Conditional go.

### Why

The product model is close, but TEJ still treats:

- plan tier
- payment state
- access state

as if they were the same thing.

That works for pilot operations, but not for commercial reality.

### PO requirements

1. Keep signup simple.
2. Keep customer-facing plan visibility.
3. Remove tenant self-upgrade.
4. Replace self-upgrade with an honest upgrade-request or contact-sales path.
5. Add a clear commercial status model.
6. Make suspension and reactivation operationally clear.
7. Ensure suspended tenants get a clear, supportable login outcome rather than a generic credential failure.
8. Surface pre-suspension commercial warnings clearly so customers see `trial`, `past_due`, or impending cancellation before access is interrupted.
9. Notify the customer workspace admin about significant commercial state changes, not only in-product.
10. Define a stable commercial-notification recipient policy so billing notices do not depend on guessing among current admins.
11. Provide a durable place to manage the billing-contact recipient, or explicitly document the fallback policy until that surface exists.

## 4. CTO review

### Verdict

Approved as the right next architecture slice.

### Why

The repo already has the foundations:

- `TenantPlanProfile`
- `WorkspaceDirectory.isActive`
- login gating
- audit logging
- admin plan usage UI

So the right move is to extend commercial state cleanly, not bolt on ad hoc flags.

### CTO requirements

1. Do not overload `planTier`.
2. Do not leave commercial mutations on tenant-admin routes.
3. Internal commercial mutations must target tenants explicitly, not only the caller's current tenant context.
4. Make suspension explicit and testable across all access paths, not only fresh login.
5. Preserve plan-limit enforcement.
6. Add audit coverage for commercial changes.
7. Internal commercial mutations must preserve operator attribution in audit trails.

### Additional validated architecture findings

1. `PlanUsageService.setTenantPlanTier()` currently acts on the current tenant context, so it cannot serve as the internal ops mutation path for arbitrary tenants without refactor.
2. Existing bearer-token access is accepted by `JwtAuthGuard` without re-checking workspace activity after token issuance.
3. API key access is resolved without checking `WorkspaceDirectory.isActive`, so suspension enforced only at login would be incomplete.
4. Background jobs already queued with tenant context will continue unless the suspension policy explicitly decides what should still run and what should stop.
5. TEJ already routes plan-limit upgrade actions to `/admin/plan`, but there is no self-serve billing checkout, so Phase 0 must keep that page useful and honest.
6. Current login UI and docs only understand existing auth outcomes such as invalid credentials, account locked, rate limited, workspace not found, forbidden, and session expired, so suspension needs an explicit new UX/documentation path.
7. Current customer plan UX has success-state plumbing and alert patterns, but no billing-state warnings such as trial ending, past due, or cancellation at period end.
8. TEJ already has auth/signup email delivery infrastructure, but there is no current commercial-notification path for trial expiry, past due, cancellation, or suspension events.
9. TEJ has admin users, in-app notifications, and outbound webhook primitives, but no explicit `billing contact` or commercial-recipient model today.
10. The existing `Admin / Workspace Settings` surface is currently only a placeholder and does not yet provide a workspace-profile or billing-contact editor.
11. Most authenticated web pages currently redirect `401/403` responses into the same login reasons (`session_expired` or `forbidden`), so suspended-session handling must become an app-wide redirect contract, not just a login-page string.
12. Current API auth surfaces return structured auth errors for login, JWT, API key, and plan-limit cases, but there is no defined machine-readable commercial-suspension contract yet for API consumers or automation.
13. Tenant-scoped queue workers already process account exports, connector submissions, status syncs, and outbound webhooks from stored payloads, so suspension needs an explicit side-effect policy for queued and automated work.
14. Existing job and delivery status models already distinguish `failed`, `retrying`, `dead_letter`, and in some cases `skipped`, so suspension policy should preserve operator observability instead of collapsing intentional blocks into generic failures.
15. TEJ already has pause/resume, unlock, deactivate, revoke, and requeue patterns in different modules, so tenant reactivation needs an explicit recovery policy rather than assuming everything resumes automatically.
16. Privacy/export/deletion flows are currently protected by the same authenticated access model as the rest of the app, so suspension policy must explicitly decide whether those governance flows remain available, require an exception path, or pause with a documented support process.
17. The current token-guarded platform bootstrap route is already present in generated OpenAPI output, so internal commercial endpoints need an explicit documentation/visibility decision rather than assuming they will stay hidden automatically.
18. TEJ already has a KPI/event pipeline and admin analytics surfaces, but there are no current commercial-state metrics for trial, paid, past due, suspended, cancelled, or resumed tenants.
19. The current metrics pipeline and KPI endpoint are tenant-scoped, so fleet-level commercial visibility for ops/finance cannot rely on the existing tenant dashboard path alone.
20. The current repo can provision or resolve a known tenant, but it does not expose a clear internal tenant-discovery/search surface for ops to locate a tenant by workspace slug, display name, tenant key, or admin email before applying commercial changes.
21. The current repo does not have a native upgrade-request intake or tracking flow for plan changes; today the customer plan path is still direct mutation, and there is no built-in commercial request record or queue for support/sales follow-up.
22. TEJ already has strong role-based read-only patterns for viewer/reviewer behavior, but it does not have a workspace-wide commercial read-only mode. Introducing a `restricted` or `read-only due to billing` state would require broad mutation-surface and UI work well beyond simple auth gating.

## 5. Target model

### Keep

`planTier`

- `STARTER`
- `GROWTH`
- `ENTERPRISE`

### Add

`billingStatus`

- `trial`
- `active_paid`
- `past_due`
- `cancelled`

`accessStatus`

- `active`
- `suspended`

### v1 access recommendation

Keep commercial access binary in the first increment:

- `active`
- `suspended`

Do not add a separate commercial `read-only` or `restricted` tenant mode in v1 unless TEJ deliberately wants a broader cross-surface authorization project.

Use warning states and grace periods before suspension instead of trying to convert the whole product into a billing-driven read-only workspace mode.

### Add commercial metadata

- `trialEndsAt`
- `paidThroughAt`
- `graceEndsAt`
- `cancelledAt`
- `suspendedAt`
- `suspensionReason`
- `billingProvider`
- `externalCustomerId`
- `externalSubscriptionId`
- `updatedBy`

## 6. Recommended schema strategy

### v1 recommendation

Extend `TenantPlanProfile` to include:

- `billingStatus`
- `accessStatus`
- commercial dates
- billing provider identifiers

This is the smallest coherent change because `TenantPlanProfile` is already the current plan authority.

### Later enhancement

Add a separate commercial-history table, for example:

- `TenantCommercialEvent`

to capture:

- status changes
- suspensions
- resumptions
- cancellations
- provider webhook transitions

## 7. Required surface split

### Tenant admin surface

Keep `/admin/plan`, but change it to:

- show usage
- show current commercial state
- show upgrade/contact CTA
- not directly mutate commercial state

The customer-facing CTA should be framed as:

- `Request upgrade`
- `Contact Vexa`

not as immediate self-serve paid-plan mutation unless TEJ later ships real checkout.

### Internal ops/platform surface

Add a separate internal control path for:

- set plan tier
- set billing status
- suspend tenant
- resume tenant
- cancel tenant

This should not reuse tenant-admin access, and it must accept an explicit tenant identifier rather than relying on current tenant context.

It should also capture the acting operator identity for audit, rather than relying on a shared token with weak attribution.

## 8. Increment plan

### Phase 0A: lock the two prerequisites

Scope:

1. decide the customer-facing upgrade-request destination
2. decide the internal commercial-auth model

Recommended v1 choices:

1. customer upgrade path:
   - add a configurable commercial contact target such as:
     - `PIM_COMMERCIAL_CONTACT_URL`
     - or `PIM_COMMERCIAL_CONTACT_EMAIL`
   - route `/admin/plan` and plan-limit modals to that contact path honestly
   - include enough tenant context for TEJ to act on the request, at minimum:
     - tenant key
     - current plan tier
     - current commercial state once available
     - requesting user identifier if available
   - decide whether upgrade requests are:
     - purely out-of-band contact
     - or persisted as an internal commercial request record for tracking and follow-up
2. internal commercial auth:
   - dedicated internal commercial token
   - require explicit operator identity headers such as:
     - `x-pim-operator-id`
     - `x-pim-operator-role`
   - audit every mutation with that operator identity

Why this is the recommended minimum:

- the current repo has no self-serve billing checkout
- the current repo has no formal operator role/auth surface
- the current bootstrap token flow is too weak to be the long-term commercial-control boundary

Success:

- customer upgrade CTA has a real destination
- customer upgrade CTA carries enough tenant context to avoid manual back-and-forth
- TEJ has an explicit rule for whether upgrade requests are tracked internally or handled purely out of band
- internal commercial mutations have attributable operator identity
- Phase 0 can proceed without guessing these inputs in code

### Phase 0: close self-upgrade risk

Scope:

1. remove tenant-admin self-upgrade from `/admin/plan`
2. block tenant-admin use of `POST /billing/plan-tier`
3. preserve internal operational ability through a dedicated path or platform-admin token flow
4. update tests that currently rely on tenant-admin commercial mutation
5. keep `/admin/plan` and plan-limit redirects useful by replacing `Update plan` with upgrade-request/contact-sales UI

Success:

- tenant admins can still read plan/usage
- tenant admins cannot self-upgrade
- existing billing usage reads still work
- connector and commercial tests still have a valid internal way to seed paid plans
- plan-limit flows still land on a useful customer-facing next step

### Phase 1: add commercial state model

Scope:

1. extend `TenantPlanProfile`
2. set signup defaults to:
   - `planTier=STARTER`
   - `billingStatus=trial`
   - `accessStatus=active`
3. migrate existing tenants safely
4. extend billing read contracts so customer-facing plan views can display the new commercial truth
5. add customer-facing warning states for `trial`, `past_due`, and end-of-term `cancelled`
6. decide which commercial-state changes also trigger customer email or outbound notification
7. define who receives those commercial notifications, for example:
   - explicit billing contact email
   - designated billing contact user
   - fallback to active workspace admins if no billing contact is set
8. decide where that billing-contact recipient is managed:
   - customer-facing workspace settings
   - internal ops-only commercial profile
   - or fallback-only for the first increment

Success:

- new signup receives correct commercial defaults
- old tenants migrate without breaking billing reads
- `/billing/usage`, `/billing/plan-profile`, and `/admin/plan` can show `billingStatus` and `accessStatus` without guessing from plan tier
- customers can see upcoming commercial risk before access changes, for example trial expiry, grace-period risk, or scheduled cancellation
- TEJ has an explicit rule for which commercial changes notify the workspace admin out of band
- TEJ has an explicit rule for who receives commercial notifications and what fallback applies if that recipient is missing
- TEJ has a defined management path for billing-contact data, or an explicit first-increment fallback if customer editing is deferred

### Phase 2: enforce access status

Scope:

1. block login when `accessStatus=suspended`
2. return stable auth error such as `TENANT_SUSPENDED`
3. enforce suspension for existing JWT-authenticated requests
4. enforce suspension for API-key-authenticated requests
5. define suspension policy for background jobs and queued work
6. decide whether `WorkspaceDirectory.isActive` remains separate or is derived from access state
7. add dedicated auth/UI/docs handling for a suspended-tenant outcome such as `TENANT_SUSPENDED`
8. add app-wide redirect/re-entry handling so suspended sessions route users into a distinct suspended-tenant explanation instead of generic `forbidden`
9. define stable machine-client behavior for suspended access, including HTTP status, error code, and retry expectations for API consumers and automation
10. define which queued and automated tenant side effects are blocked, allowed, or drained when a tenant is suspended, including exports, connector jobs, and outbound webhooks
11. define how suspension-driven blocks are recorded in job/delivery state, notifications, and audit so operators can distinguish policy from failure
12. define what tenant reactivation restores automatically versus what requires deliberate operator action, for example API access, webhook delivery, or export-job requeue
13. define whether privacy/export/deletion flows remain available during suspension and how that is enforced or exception-handled
14. define how internal commercial endpoints appear in generated API docs and public contracts, including whether they are hidden, separately tagged, or documented as operator-only
15. define the minimum commercial observability set for ops, finance, and support, including tenant counts and state-transition metrics
16. define how fleet-level commercial reporting is produced for internal ops, separate from tenant-scoped customer metrics where necessary
17. define how internal ops discover and select the correct tenant before commercial mutation, including search by workspace slug, display name, tenant key, and where possible admin email

Success:

- suspended tenant cannot log in
- suspended tenant cannot continue operating through previously issued bearer tokens
- suspended tenant cannot continue operating through active API keys
- queued/background work behavior is explicit and tested
- suspended tenant sees a clear login/support message instead of a generic auth failure
- suspended tenant hitting any authenticated page is redirected into a distinct suspended-tenant experience rather than `session_expired` or `forbidden`
- API clients and automation receive a stable non-ambiguous suspended-tenant response they can handle without treating it as a generic auth bug
- queued exports, connector jobs, and outbound webhook deliveries follow the documented suspension policy instead of continuing implicitly
- suspension-driven blocking is visible to operators as an intentional state, not a misleading generic failure
- tenant reactivation has a deterministic recovery path so TEJ knows what resumes automatically and what remains paused or requires requeue
- privacy/export/deletion flows follow an explicit suspension policy rather than being accidentally blocked by generic auth gating
- internal commercial controls have an explicit documentation posture and do not accidentally masquerade as customer/public APIs
- TEJ can observe commercial state at an operational level without manual database inspection
- internal ops can answer fleet-level commercial questions without misusing tenant-scoped customer metrics
- internal ops can locate the correct tenant to manage without direct database access or guesswork
- active tenant still can
- password reset and signup verification remain correct

### Phase 3: internal commercial ops API

Scope:

1. add internal-only endpoints for:
   - get commercial profile
   - set plan tier
   - set billing status
   - suspend
   - resume
   - cancel
2. audit every change
3. require explicit tenant targeting on every mutating action

Success:

- internal/platform admin can manage commercial state
- tenant admin is forbidden
- audit trail is complete

### Phase 4: internal commercial ops UI

Scope:

1. add internal commercial management page
2. expose:
   - plan tier
   - billing status
   - access status
   - commercial dates
   - reason/history

Success:

- commercial operations become manageable without direct DB intervention
- customer-facing `/admin/plan` remains clean and honest

### Phase 5: provider integration

Scope:

1. optional payment/subscription sync
2. map provider events into:
   - `active_paid`
   - `past_due`
   - `cancelled`

Success:

- provider truth can update TEJ commercial state idempotently
- manual ops path still exists as fallback

## 9. Validation matrix

### Current validation already run

- `node apps/api/test/integration/public-signup.test.cjs`
- `node apps/api/test/integration/workspace-user-crud.test.cjs`
- `node apps/api/test/integration/connector-access-principal-validation.test.cjs`
- `node apps/api/test/integration/connector-access-entitlements.test.cjs`
- `node apps/api/test/integration/billing-usage-cache-read.test.cjs`
- `node apps/web/test/integration/public-signup-ui.test.cjs`
- `node apps/web/test/integration/connector-access-admin-form.test.cjs`

Note:

Two local tests required `PIM_AUTH_PASSWORD=tej-pim-demo-password` because this machine has a local auth password override. That is local environment drift, not product behavior.

### Required validation for Phase 0

1. tenant admin can view `/admin/plan`
2. tenant admin cannot mutate plan tier
3. existing billing usage endpoint still works
4. connector plan-limit enforcement still works
5. plan-limit UI still gives a valid upgrade/contact action instead of a dead end
6. upgrade/contact actions include enough tenant context for support or sales to act directly

### Required validation for Phase 0A

1. `/admin/plan` and plan-limit modal can render a real upgrade/contact destination
2. env/config validation supports the chosen contact target cleanly
3. internal commercial mutation requests require operator identity metadata
4. audit rows record operator identity on commercial mutations

### Required validation for Phase 1

1. new signup creates `trial + active + STARTER`
2. old tenants migrate safely
3. plan usage summary still resolves
4. customer-facing billing responses include the new commercial fields cleanly
5. `/admin/plan` and related customer surfaces show clear warning states for `trial`, `past_due`, and scheduled cancellation
6. chosen commercial-state transitions generate the expected customer notifications
7. commercial notifications are addressed to the configured billing recipient or a defined admin fallback path
8. the chosen billing-contact management path is implemented or the documented fallback is enforced consistently

### Required validation for Phase 2

1. suspended tenant login returns `TENANT_SUSPENDED`
2. active tenant login still succeeds
3. password reset does not bypass suspension
4. existing bearer token access is denied after suspension
5. existing API key access is denied after suspension
6. queued/background work follows the chosen suspension policy deterministically
7. login UI and product docs present a clear suspended-tenant explanation and next step
8. server-rendered pages and authenticated web flows map suspended-session responses to a distinct suspended-tenant redirect reason
9. API clients and API-key callers receive the documented suspended-tenant response shape and status code consistently
10. queued exports, connector jobs, and outbound webhook deliveries are blocked, drained, or skipped according to the chosen suspension policy
11. operators can distinguish suspension-driven skips/blocks from ordinary job failure in audit and operational views
12. tenant resume/reactivation follows the documented recovery policy for jobs, webhooks, sessions, and API access
13. privacy/export/deletion behavior during suspension matches the documented governance policy
14. generated API docs reflect the intended visibility of internal commercial endpoints
15. metrics and admin/ops views can answer basic commercial questions such as current tenant counts by state and recent suspension/resume activity
16. fleet-level commercial reporting is available through the intended internal surface rather than only through tenant-local dashboards

### Required validation for Phase 3

1. internal/platform admin can update commercial state
2. tenant admin receives `403`
3. audit rows are written for every commercial mutation
4. audit rows identify the acting operator, not only a shared platform token path

### Required validation for Phase 5

1. repeated provider events are idempotent
2. cancellation after paid-through date results in suspension
3. past-due grace and suspension logic is deterministic

## 10. Non-goals for the first commercial-control increment

1. full billing checkout
2. invoicing
3. tax handling
4. full subscription self-service portal
5. SCIM/SSO-based entitlement sync

## 11. Recommended starting point

Start with Phase 0 before any payment integration work.

The first unacceptable commercial behavior to remove is tenant self-upgrade.

After that, add:

- `billingStatus`
- `accessStatus`

before building payment-provider sync.
