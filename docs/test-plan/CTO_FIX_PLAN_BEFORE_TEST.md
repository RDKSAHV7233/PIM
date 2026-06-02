# CTO Fix Plan — Before Test Execution

- **Product**: Vexa PIM
- **Date**: 2026-06-02
- **Author**: CTO
- **Status**: EXECUTE — no test automation until these items ship
- **Urgency**: Blocks first paying customer at scale

---

## Executive Summary

The QA test plan exposed 14 production defects and infrastructure gaps that no amount of testing can fix — they need code changes first. Writing tests against broken behavior locks in the wrong contract.

This plan is organized into 4 blocks:

| Block | Risk | Items | Effort | Deadline |
|-------|------|-------|--------|----------|
| **A: Revenue Protection** | Money walks out the door | 4 | 3 days | Before any paid pilot |
| **B: Security & Data Integrity** | Breach / compliance violation | 3 | 2 days | Before any production data |
| **C: RBAC & Auth Accuracy** | Wrong access = wrong trust | 4 | 2 days | Before multi-role tenants |
| **D: Test Infrastructure** | Can't validate the above | 3 | 1 day | Before Phase 1 of test plan |
| **Total** | | **14** | **~8 eng-days** | |

---

## Block A: Revenue Protection

These are not bugs in the traditional sense — they are holes in the billing fence. A STARTER tenant (₹4,499/mo) can currently bypass limits that should force an upgrade to GROWTH (₹11,999/mo). Every day these stay open is potential revenue leakage.

### A-1. User creation has no plan-limit guard decorator

**Status**: SERVICE-LEVEL ENFORCEMENT EXISTS, GUARD-LEVEL MISSING

**What I found**: `workspace-users.controller.ts:62` (POST create user) has no `@RequirePlanLimit("users")` decorator. The user-count check does happen inside `WorkspaceUsersService.createUser()` at line 138, which calls `planUsage.checkLimit("users", 1, tenantKey)` and throws `PLAN_USERS_LIMIT_EXCEEDED` (not `PLAN_LIMIT_EXCEEDED`).

**What's wrong**: This is the only plan resource enforced at the service level instead of the guard level. This creates two problems:
1. **Inconsistent error codes**: The PlanGuard returns `{ error: "PLAN_LIMIT_EXCEEDED" }` with HTTP 402. The service returns `{ error: "PLAN_USERS_LIMIT_EXCEEDED" }` with HTTP 403. The UI at `apps/web/src/app/admin/users/actions.ts:62` handles both codes separately — a maintenance burden and a sign that the code grew organically.
2. **Dev-mode bypass doesn't apply**: `PlanGuard` has a deliberate bypass when `APP_ENV=development && PIM_PLAN_TIER_OVERRIDE` is set. The service-level check doesn't have this, so dev/test environments hit real limit enforcement for users but not for SKUs/submissions. This will break test data seeding if a test tenant already has 3 users (STARTER limit).

**Fix**:
```
File: apps/api/src/workspace-users/workspace-users.controller.ts
Line 61, on the createUser method:

+ @RequirePlanLimit("users")
  @Post()
  createUser(...)
```

Then remove the duplicate service-level check in `workspace-users.service.ts:137-145` — or keep it as a defense-in-depth belt, but change the error code to match `PLAN_LIMIT_EXCEEDED` so the UI only needs one handler.

**Impact**: STARTER tenant with 3 users can currently add a 4th if they hit the API directly (bypassing the service). The guard-level check runs before the controller method executes.

---

### A-2. PlanLimitModal missing labels for connector and user resources

**Status**: UI GAP — user sees raw resource key

**What I found**: `apps/web/src/components/ui/plan-limit-modal.tsx:19-31` has a `normalizeResourceLabel()` function that maps resource keys to human labels. Current mappings:
- `"skus"` → `"SKU"`
- `"submissions"` → `"submission"`
- `"storage_gb"` / `"storagegb"` → `"storage"`
- Everything else → **falls through to raw key** (e.g. `"connectors_installations"`, `"connector_accounts"`, `"users"`)

**What's wrong**: If a GROWTH tenant hits 10 connector installations (the limit), the modal title reads: *"You reached your connectors_installations limit"* — a raw underscore-separated key shown to a seller. This is unacceptable for a commercial product.

**Fix**:
```typescript
// apps/web/src/components/ui/plan-limit-modal.tsx
function normalizeResourceLabel(resource: string): string {
  const normalized = resource.toLowerCase();
  if (normalized === "skus") return "SKU";
  if (normalized === "submissions") return "submission";
  if (normalized === "storagegb" || normalized === "storage_gb") return "storage";
+ if (normalized === "users") return "user";
+ if (normalized === "connectors_installations") return "connector installation";
+ if (normalized === "connector_accounts") return "connector account";
  return resource;
}
```

**Impact**: 3 plan resources currently show raw keys to paying customers.

---

### A-3. Grace period → suspension escalation has no automated trigger

**Status**: MANUAL-ONLY — no cron job

**What I found**: The Stripe webhook controller at `stripe-webhook.controller.ts:110-123` handles `invoice.payment_failed` by setting `billingStatus: "past_due"` and `graceEndsAt` (7 days from now). The suspension page and enforcement exist (`account-suspended/page.tsx`, `jwt-auth.guard.ts:144-156`).

**What's missing**: There is no scheduled job that checks "has `graceEndsAt` passed?" and transitions the tenant to `accessStatus: "suspended"`. The grace period sets an end date but nothing acts on it. Suspension only happens via manual internal commercial ops API call (`billing.controller.ts:580`).

**What this means**: A tenant whose payment fails gets a 7-day grace period, but after those 7 days... nothing happens. They continue using the product for free indefinitely until someone manually suspends them.

**Fix**: Create a scheduled job (BullMQ repeatable or cron) that:
1. Queries for tenants where `billingStatus = 'past_due' AND graceEndsAt < NOW() AND accessStatus != 'suspended'`
2. Sets `accessStatus = 'suspended'` and `suspendedAt = NOW()`
3. Sends `tenant_access_suspended` notification
4. Logs to audit

```
New file: apps/api/src/billing/grace-period-escalation.job.ts
Schedule: every 6 hours
```

**Impact**: Without this, every payment failure requires manual intervention to suspend. At scale with 100+ tenants, this is unsustainable and means unpaid tenants get indefinite free access.

---

### A-4. Stripe checkout session doesn't enforce plan-tier product mapping

**Status**: ENV VARS MAY NOT BE SET

**What I found**: `stripe.service.ts:10-14` maps plan tiers to Stripe price IDs via environment variables:
```typescript
const PLAN_TIER_TO_PRICE_ID_ENV = {
  STARTER: "STRIPE_PRICE_ID_STARTER",
  GROWTH: "STRIPE_PRICE_ID_GROWTH",
  ENTERPRISE: "STRIPE_PRICE_ID_ENTERPRISE",
};
```

The `createCheckoutSession` method reads these env vars. If any are missing/empty, the checkout will fail silently or create a session with no line items.

**What I also found from the memory file**: "Stripe products" is listed as one of 6 pending ops actions. This confirms the price IDs may not be configured yet.

**Fix**:
1. Create the 3 Stripe products and prices in Stripe dashboard (test mode for staging, live for production)
2. Set `STRIPE_PRICE_ID_STARTER`, `STRIPE_PRICE_ID_GROWTH`, `STRIPE_PRICE_ID_ENTERPRISE` in staging and production secrets
3. Add a startup validation in `stripe.service.ts` that logs a warning if `isEnabled()` returns true but any price ID is missing
4. Set `FEATURE_STRIPE_BILLING_ENABLED=true` in staging

**Impact**: Self-serve upgrade is dead without this. Every upgrade requires manual commercial ops intervention.

---

## Block B: Security & Data Integrity

### B-1. Audit log does not redact sensitive fields — needs verification

**Status**: UNVERIFIED — test plan flagged this but no one has checked

**What the PRD says**: "DG-002: Sensitive credential/token values are never logged or stored in audit metadata."

**What I need verified**: The `AuditService.record()` method writes metadata as JSONB. If a connector credential update passes the raw API key/secret in the audit metadata, it's a DPA violation. Same for password hashes if the user-management audit includes them.

**Fix**: 
1. Read `audit.service.ts` — verify the `metadata` field is filtered before write
2. Grep all `auditService.record()` calls for any that pass `password`, `secret`, `token`, `apiKey`, `credential` in metadata
3. If found, add a `sanitizeAuditMetadata()` utility that strips sensitive keys
4. Add an integration test: create a connector credential → read audit log → assert no credential value in metadata

```
File to check: apps/api/src/audit/audit.service.ts
Grep: auditService.record.*password|secret|token|apiKey|credential
```

**Impact**: If credentials appear in audit logs, it's a data protection violation that could block enterprise sales.

---

### B-2. Cross-tenant isolation has no E2E UI test — but the enforcement works

**Status**: API-ENFORCED, UI-UNTESTED

**What I found**: The JWT auth guard resolves `pimTenant` from the token, and every Prisma query goes through `prisma.tenant(tenantKey)` which scopes reads. RLS integration tests exist and pass.

**What's missing**: No test verifies that a user who knows another tenant's product ID can't navigate to `/products/[other-tenant-product-id]` in the browser and see data. The API would return 404/403, but the question is: does the UI show a helpful error, or does it crash?

**Fix**: This is a test gap, not a code fix. But before writing the test, verify:
1. The product detail page (`apps/web/src/app/products/[id]/page.tsx`) handles API 404 gracefully
2. It doesn't show a partial page with blank fields (which could leak structure)

Add to Block D (test infrastructure).

---

### B-3. SSRF protection needs E2E verification on media URL upload path

**Status**: API-TESTED, NOT E2E-VERIFIED

**What I found**: `media.controller.ts` has SSRF guards (API integration tests exist). But the web app's media upload might also accept URL-based imports (paste image URL instead of file upload).

**Fix**: Verify the web media upload component doesn't have a "paste URL" feature that bypasses the API's SSRF check. If it does, ensure the URL goes through the API's validation, not a direct client-side fetch. This is a test verification, not a code change — add to Block D.

---

## Block C: RBAC & Auth Accuracy

### C-1. Test plan RBAC matrix has 5 factual errors — must regenerate from code

**Status**: DOCUMENTATION ERROR — will cause wrong test assertions

**Errors found by diffing `@Roles()` decorators against the test plan matrix**:

| Surface | Test Plan Says | Code Actually Says | Impact |
|---------|---------------|-------------------|--------|
| Channel Mappings | admin, channel_mgr only | `@Roles("admin", "editor", "channel_manager")` — **editor has access** | False 403 expectation |
| Connector Install | admin, connector_admin only | `@Roles("admin", "editor", "connector_admin")` — **editor has access** | False 403 expectation |
| Products (publish) | admin, editor, publisher | `@Roles("admin", "editor", "publisher", "channel_manager")` — **channel_mgr has access** | Missed permission |
| Submissions (read) | not specified | `@Roles("admin", "editor", "publisher", "channel_manager")` | Untracked |
| Approval Comments | admin, approver, reviewer | `@Roles("admin", "editor", "reviewer", "approver")` — **editor has access** | False 403 expectation |

**Fix**: Regenerate the RBAC matrix by running this grep against every controller and building the truth table from code:

```bash
grep -rn "@Roles(" apps/api/src/ --include="*.ts" | \
  sed 's/.*@Roles(\(.*\))/\1/' | sort | uniq -c | sort -rn
```

Then update `docs/test-plan/VEXA_PIM_E2E_TEST_PLAN.md` Section 4 with the corrected matrix.

**Impact**: If the test plan's matrix is wrong, every RBAC test we write will assert the wrong behavior. Tests will either pass when they shouldn't (false confidence) or fail when the code is correct (false alarms that erode trust in the suite).

---

### C-2. `ROLE_PERMISSION_MATRIX` only defines 4 of 8 roles

**Status**: STRUCTURAL GAP

**What I found**: `roles.ts:31-36` defines `ROLE_PERMISSION_MATRIX` with only Admin, Editor, Reviewer, Viewer. The 4 missing roles — `publisher`, `approver`, `channel_manager`, `connector_admin` — are not represented. This matrix is returned by `GET /admin/workspace/users/role-capabilities` and used in the admin UI to show permission levels.

**What this means**: When an admin looks at the role management page, they only see the permission breakdown for 4 roles. The other 4 roles have descriptions (from `ENTERPRISE_ROLE_CAPABILITIES`) but no per-domain capability matrix. An admin assigning `channel_manager` can't see what that role can and can't do.

**Fix**:
```typescript
// apps/api/src/common/rbac/roles.ts
export const ROLE_PERMISSION_MATRIX = [
  { role: "Admin",           catalog: "write", channels: "write", ops: "write", quality: "write", admin: "full" },
  { role: "Editor",          catalog: "write", channels: "write", ops: "write", quality: "write", admin: "limited" },
+ { role: "Publisher",       catalog: "read",  channels: "publish",ops: "read",  quality: "read",  admin: "none" },
+ { role: "Approver",        catalog: "read",  channels: "read",  ops: "read",  quality: "approve",admin: "none" },
+ { role: "Channel Manager", catalog: "read",  channels: "write", ops: "read",  quality: "read",  admin: "none" },
+ { role: "Connector Admin", catalog: "read",  channels: "config",ops: "read",  quality: "read",  admin: "limited" },
  { role: "Reviewer",        catalog: "read",  channels: "read",  ops: "read",  quality: "approve",admin: "none" },
  { role: "Viewer",          catalog: "read",  channels: "read",  ops: "read",  quality: "read",  admin: "none" },
] as const;
```

Verify the type `RolePermissionEntry` still compiles (it's derived from `typeof ROLE_PERMISSION_MATRIX[number]`, so new string literal values in `channels` need the type to widen or the new values need to be valid).

**Impact**: Admin users can't make informed role assignments for 4 of 8 roles.

---

### C-3. Playwright global-setup only authenticates 4 of 8 roles

**Status**: TEST INFRASTRUCTURE GAP

**What I found**: `global-setup.cjs:73-78` defines `roleUsers` for only `admin`, `editor`, `reviewer`, `viewer`. Tests for `publisher`, `approver`, `channel_manager`, `connector_admin` cannot use pre-authenticated sessions — they'd need to login fresh per-test, hitting the 10-login-per-15-minute rate limit.

**Fix**:
```javascript
// apps/web/test/e2e/helpers/global-setup.cjs
const roleUsers = {
  admin:           process.env.PLAYWRIGHT_ADMIN_USER           || "admin@vexa-pim.local",
  editor:          process.env.PLAYWRIGHT_EDITOR_USER          || "editor@vexa-pim.local",
  reviewer:        process.env.PLAYWRIGHT_REVIEWER_USER        || "reviewer@vexa-pim.local",
  viewer:          process.env.PLAYWRIGHT_VIEWER_USER          || "viewer@vexa-pim.local",
+ publisher:       process.env.PLAYWRIGHT_PUBLISHER_USER       || "publisher@vexa-pim.local",
+ approver:        process.env.PLAYWRIGHT_APPROVER_USER        || "approver@vexa-pim.local",
+ channel_manager: process.env.PLAYWRIGHT_CHANNEL_MANAGER_USER || "channel_manager@vexa-pim.local",
+ connector_admin: process.env.PLAYWRIGHT_CONNECTOR_ADMIN_USER || "connector_admin@vexa-pim.local",
};
```

Also update `playwright.config.cjs` to add storage state paths for the new roles:
```javascript
const storageStatePaths = {
  admin:           path.join(STORAGE_STATE_DIR, "admin.json"),
  editor:          path.join(STORAGE_STATE_DIR, "editor.json"),
  reviewer:        path.join(STORAGE_STATE_DIR, "reviewer.json"),
  viewer:          path.join(STORAGE_STATE_DIR, "viewer.json"),
+ publisher:       path.join(STORAGE_STATE_DIR, "publisher.json"),
+ approver:        path.join(STORAGE_STATE_DIR, "approver.json"),
+ channel_manager: path.join(STORAGE_STATE_DIR, "channel_manager.json"),
+ connector_admin: path.join(STORAGE_STATE_DIR, "connector_admin.json"),
};
```

**Prerequisite**: The test tenant must have auth identities for all 8 roles. Check the seed/fixture data and add the missing 4 users.

**Impact**: Without this, the entire RBAC test suite (TS-17, the highest-priority gap) is blocked.

---

### C-4. Navigation sidebar doesn't hide sections by role — only admin sub-items

**Status**: PARTIAL IMPLEMENTATION

**What I found**: `app-sidebar.tsx` shows 7 top-level sections (Dashboard, Products, Catalog, Channels, Quality, Operations, Settings) to **all roles**. Role-based filtering only happens on admin sub-items via `canViewAdminNavigationItem()`.

This means a `viewer` sees the "Operations" nav section (with Bulk Import, Bulk Edit sub-items) even though they have no write access. They can navigate there and see an empty or error state. Similarly, a `publisher` sees "Quality > Approvals" even though they can't approve.

**What this means for testing**: The test plan assumes "Navigation: menu items hidden for unpermitted surfaces" (RBAC-012). This test will FAIL because the sidebar doesn't actually hide unpermitted sections — it just hides admin sub-items.

**Decision required**: Is this by design (show everything, let the page enforce access) or a gap (should hide inaccessible sections)?

**My recommendation**: This is acceptable for MVP — showing the nav and returning "no access" on the page is a valid UX pattern. But the test plan must be updated to match: RBAC-012 should test that **admin sub-items** are hidden, not that top-level sections are hidden. And each page must handle "insufficient permissions" gracefully (not crash, not show a blank page).

**Fix**: Update the test plan. No code change needed for MVP, but add a follow-up ticket to implement role-aware nav filtering post-launch.

---

## Block D: Test Infrastructure

### D-1. Seed data for 8-role test tenant

**Status**: PREREQUISITE FOR ALL RBAC TESTS

The test tenant needs auth identities for all 8 roles. Currently only 4 exist (admin, editor, reviewer, viewer).

**Fix**: Add to the test seed script (or create one if it doesn't exist):
```
publisher@vexa-pim.local       role=publisher
approver@vexa-pim.local        role=approver
channel_manager@vexa-pim.local role=channel_manager
connector_admin@vexa-pim.local role=connector_admin
```

Each needs: `userId`, `role`, `passwordHash` (same test password), `isActive: true`.

**File**: Check `PIM_AUTH_IDENTITIES_JSON` env var format and add the 4 missing users there for local auth mode. For DB auth mode, add a seed migration or test setup script.

---

### D-2. Smoke test tag and tiered execution

**Status**: NO TAGGING SYSTEM

The existing 32 specs run as one flat suite (~25 min). There's no way to run a fast subset on every commit.

**Fix**:
1. Add a `@smoke` tag convention: specs that form the 5-minute smoke gate use `test.describe.configure({ tag: '@smoke' })` (Playwright 1.42+ tagging)
2. Select 10-12 tests as smoke:
   - AUTH-001 (login works)
   - PROD-001 (create product)
   - IMP-001 (basic import)
   - CONN-004 (mapping exists)
   - DASH-001 (dashboard loads)
   - USR-001 (invite user)
   - KEY-001 (API key create)
   - SIGN-001 (signup form)
   - One approval flow test
   - One publish/submit test
3. Add npm script: `"test:e2e:smoke": "playwright test --grep @smoke"`
4. Wire into CI: smoke on every push, full suite nightly

**Impact**: Without this, developers either run the full 25+ min suite (slow feedback) or skip E2E entirely (no feedback).

---

### D-3. Plan-limit E2E testing strategy

**Status**: UNTESTABLE IN DEV MODE

The `PlanGuard` at `plan-guard.guard.ts:37-45` bypasses all quota checks when `APP_ENV=development && PIM_PLAN_TIER_OVERRIDE` is set. E2E tests run in development mode.

**Options**:

| Option | Pros | Cons |
|--------|------|------|
| A: Unset `PIM_PLAN_TIER_OVERRIDE` during plan-limit tests | Simple | May break other tests that need unlimited quotas |
| B: Add a test-specific flag `PIM_PLAN_GUARD_FORCE_ENFORCE=true` | Surgical | Another env var to manage |
| C: Test plan limits on staging only | Realistic | Slower feedback loop |

**My recommendation**: Option B. Add a single env var that overrides the dev-mode bypass:

```typescript
// plan-guard.guard.ts
const forceEnforce = String(process.env.PIM_PLAN_GUARD_FORCE_ENFORCE ?? "").trim().toLowerCase();
if (tierOverride && appEnv === "development" && forceEnforce !== "true") {
  // skip checks
}
```

Then the E2E plan-limit tests can set `PIM_PLAN_GUARD_FORCE_ENFORCE=true` and `PIM_PLAN_TIER_OVERRIDE=STARTER` to get a real enforcement test at STARTER limits.

---

## Execution Order

```
Week 1, Days 1-3: Block A (revenue protection)
├── A-1: Add @RequirePlanLimit("users") to workspace-users controller     [0.5 day]
├── A-2: Add missing resource labels to PlanLimitModal                     [0.5 day]
├── A-3: Build grace-period-escalation scheduled job                       [1.5 days]
└── A-4: Configure Stripe products + price IDs in staging                  [0.5 day]

Week 1, Days 3-4: Block B (security)
├── B-1: Audit log redaction verification + fix if needed                  [1 day]
├── B-2: Cross-tenant URL manipulation → verify graceful 404 in UI         [0.5 day]
└── B-3: SSRF media URL path verification                                  [0.5 day]

Week 1, Day 5: Block C (RBAC accuracy)
├── C-1: Regenerate RBAC matrix from @Roles() decorators                   [0.5 day]
├── C-2: Add 4 missing roles to ROLE_PERMISSION_MATRIX                     [0.5 day]
├── C-3: Extend global-setup.cjs for 8-role pre-auth                       [0.5 day — needs D-1 first]
└── C-4: Update test plan RBAC-012 to match actual sidebar behavior        [0.25 day]

Week 2, Days 1-2: Block D (test infrastructure)
├── D-1: Seed 4 additional role users in test tenant                       [0.5 day]
├── D-2: Implement @smoke tag + tiered CI execution                        [0.5 day]
└── D-3: Add PIM_PLAN_GUARD_FORCE_ENFORCE flag                             [0.5 day]

Week 2, Day 3: VERIFICATION
├── Run existing 32 E2E specs → all green                                  [0.5 day]
├── Run 144+ API integration tests → all green                             [0.25 day]
├── Manually verify plan limit modal for all 6 resource types               [0.25 day]
└── CTO sign-off → hand off to QA for test plan Phase 1                    [—]
```

---

## What This Does NOT Cover (Deferred)

| Item | Why Deferred | When |
|------|-------------|------|
| Nav sidebar role-filtering | Acceptable UX for MVP (page-level enforcement works) | Post-launch sprint |
| ONDC connector testing | Flag-gated, no pilot customers yet | When ONDC flag enabled |
| Performance baselines | Need stable feature set first | After test plan Phase 3 |
| Self-serve Stripe checkout | Manual upgrade via commercial ops is acceptable for first 50 tenants | After 50-tenant milestone |
| Production synthetic monitoring | Need production deployment first | Week after first prod deploy |
| Delta sync E2E | Sprint 8+ feature, not blocking launch | Next quarter |

---

## Success Criteria

After this fix plan executes, the following must be true:

1. **A STARTER tenant creating a 4th user gets a clear "User limit reached (3/3)" error** — not a 500 or raw JSON
2. **A tenant whose payment failed 8 days ago is automatically suspended** — not silently active
3. **All 6 plan-limit resource types show human-readable labels in the upgrade modal** — no raw keys
4. **Stripe products exist in staging** — self-serve checkout returns a valid Stripe URL
5. **The RBAC matrix in the test plan matches the actual `@Roles()` decorators** — no false assertions
6. **All 8 roles can authenticate in Playwright** — pre-auth sessions cached in global-setup
7. **The E2E suite has a `@smoke` subset that runs in < 5 minutes** — fast CI feedback
8. **Plan-limit tests can run in dev mode** — `PIM_PLAN_GUARD_FORCE_ENFORCE` flag works
9. **Audit logs contain zero credential/token/password values** — verified by grep + test
10. **All 32 existing E2E specs and 144+ integration tests pass** — green baseline before new tests

---

*No test automation begins until items 1-10 are verified. Testing broken behavior is worse than not testing — it creates a false contract that makes the real fix harder.*
