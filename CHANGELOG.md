# Changelog

All notable changes to Vexa PIM. Legacy technical codename: `PIM1`. Format: [date] - commit SHA - summary.

---

## [2026-05-30] — Phase 3 enterprise delivery + security fixes

### Security
- **Fixed cross-tenant identity leak in login** (`fix(auth)` — PR #156, commit `d5e2258`): `prisma.tenant()` was called without `tenantId` during unauthenticated identity lookup, causing the RLS extension to fall back to `DEFAULT_TENANT_KEY`. In multi-tenant deployments this could resolve an auth identity row from the wrong tenant. Fix passes `tenantId` explicitly to scope the lookup. Companion write-path fix was PR #147.

### ⚠️ Breaking Changes
- **`editor` role removed from `POST /products/:id/review-decision`** (PR #152 — shipping with Phase 3 merge): The endpoint that applies approve/reject decisions on in-review products previously accepted `admin`, `editor`, and `approver` roles. The `editor` role has been removed — editors should not self-approve drafts they authored. **Impact:** any API key or service account with `editor` role that calls this endpoint will receive `403 Forbidden` after this change ships. Rotate those keys to `approver` role before upgrading.

### Added
- `lastSignInAt` column on `authIdentity`: new migration `20260529000001_auth_identity_last_sign_in_at`, recorded on successful login, surfaced in workspace-users admin table.
- Shopify connector managed-install e2e Playwright suite (`test(e2e)` — PR #152).
- Meesho Phase M-1: 6-category Excel export templates (Kurtis, T-shirts, Sarees, Casual Shoes, Leggings, Home Décor), `MeeshoExportPanel` UI, `POST /marketplace/connectors/:id/export` endpoint, `EXCEL_EXPORT` capability (PR #153). Phase M-2 — live API publish — blocked on `RD-MEESHO-1` (external vendor credential access).
- `product_admin` and `system_admin` boundary roles bypass plan-limit enforcement and are granted unlimited usage display in the admin UI.
- RLS-BYPASS audit annotations on `tenantRaw` / `tenantExecRaw` wrappers to flag intentional raw query paths for security reviewers (PR #159).
- 3 new API contract tests: `prisma-connection-pool-contract`, `commercial-reminders-contract`, `meesho-export-contract` (PR #159).
- Startup env gate via `instrumentation.ts`: blocks web app startup when `AUTH_MODE`, `JWT_SECRET`, or `PIM_API_BASE_URL` are missing (PR #154).
- Global IST timezone (`en-IN` + `Asia/Kolkata`) across ~33 datetime display sites (PR #154).
- Responsive `mobileHide` sweep across DataGrid secondary columns on Products, Approvals, Jobs, and Audit pages (PR #154).
- Async bulk-import job poll in integration test — fixes race against BullMQ worker drain (PR #160).

### Changed
- `reviewer` role added to `POST /products/:id/review-decision` (alongside `admin` and `approver`). See Breaking Changes above re: `editor` removal.
- Meesho connector launch stage promoted from `planned` → `manual` (export-only, not self-serve).
- `CURRENT_STATE.md` V11 addendum: Gate 3 closed, enterprise signoff unblocked, pricing approved, web test suite at 117.
- `docs/product/pricing.md` updated with PO-approved price points: STARTER ₹4,499/mo, GROWTH ₹11,999/mo, ENTERPRISE custom (sign-off 2026-05-27, Atharva). Remaining sign-offs before public publish: CTO (infra cost), CFO (LTV/CAC), GTM (annual discount), Legal.

### Fixed
- Production bugfixes: roles surface, approval flow, Meesho tile, notifications retargeting.
- `tmp` dependency bumped `0.2.5 → 0.2.7` to patch HIGH CVE [GHSA-ph9p-34f9-6g65](https://github.com/advisories/GHSA-ph9p-34f9-6g65) (PR #151).
- `vexa-pim-website-handover/` excluded from git tracking via `.gitignore` (PR #151).
- **PlanGuard boundary-role bypass** (PR #167): `PlanGuard` (NestJS `CanActivate`) now reads `request.pimAdminBoundaryRoles` and short-circuits per-tenant plan-limit checks for `product_admin` / `system_admin`, matching the bypass `RbacGuard` already had. Emits a structured `PLAN_GUARD_BOUNDARY_BYPASS` log entry per bypass so capacity-planning dashboards can track internal-role over-limit operations.

### Refactor
- **Centralised display timezone / locale** (PR #168): ~65 inline `.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })` callsites across 33 files now route through `formatDateTime` / `formatDate` / `formatTime` in `@/lib/format.ts`. Helpers are driven by `NEXT_PUBLIC_DISPLAY_LOCALE` and `NEXT_PUBLIC_DISPLAY_TIMEZONE` env vars (defaults preserve IST behaviour). Pre-requisite for BACKLOG-TZ (per-tenant timezone setting) — when that lands, the helpers will accept an optional `{ locale, timeZone }` override without touching call sites again.

### Tests
- **Migrated `.cjs` contract tests → real TypeScript unit tests** (PR #169): The `meesho-export` and `commercial-reminders` `.cjs` contract tests asserted invariants via `fs.readFileSync` + `String.includes()` — fragile, and one had already silently drifted (asserted `meesho_upload_` while live connector emits `meesho_<category>_`). Replaced with: new "MeeshoConnector class-level invariants" suite in `meesho-category-templates.spec.ts` (capabilities, implementationStatus, real filename via `generateExportFile()`), and new `commercial-reminders.service.spec.ts` covering timer scheduling, double-clear safety, and per-tenant error isolation via `jest.useFakeTimers()`. `prisma-connection-pool-contract.test.cjs` retained as the right form for structural DB-config invariants.

---

## [2026-05-26] - 6f57e4c - v0.9.1-release
### Added
- 5 composite DB index migrations (2026-05-24/25): `ValidationIssue` status/severity, `MarketplaceExportJob` status/channel/updatedAt, `BulkImportJob`, `BulkEditOperation`, `AttributeDefinition`, `ConnectorSubmission` installation+status, `Product` delta-sync scan `(tenantKey, status, deletedAt, id)`.
- Partial unique index `uq_export_job_product_installation` on `MarketplaceExportJob(tenantKey, productId, installationId) WHERE installationId IS NOT NULL` — enforces delta-sync idempotency at DB level.
- Redis-backed `CacheService` wired into `ComplianceService`, `CatalogService`, `TaxonomyService`, `AutoSuggestionsService` — in-memory fallback, SCAN-based prefix invalidation, 30s retry backoff.
- `retargetProductNotifications(productId)` in `NotificationsService` — redirects stale notification links to `/catalog/products` on product delete and purge (PR #139).
- Backfill script `scripts/repair-stale-product-notifications.cjs` with dry-run and per-tenant scoping.
- Node.js upgraded to v22 (current LTS) in CI.
- `npm audit --audit-level=high` step added to CI pipeline.

### Changed
- PRD updated to v1.1: 8-role table from live code, INC-08 marked complete, release readiness updated to reflect Gate 3 closure.
- `admin-guide.md` roles section updated to document all 8 roles.
- `PROD_READINESS_RISK_REGISTER.md` RISK-P0-001 closed; Gate 3 formally closed 2026-05-26 (14/14 observation days).
- Issue #1 (Release Readiness) closed — all 5 gates confirmed closed.

### Fixed
- Duplicate `take` property in `bulk-edit.service.ts` (TS1117 error).
- Duplicate `take` property in `rejection-intelligence.service.ts` (TS1117 error).
- `@nestjs/cli` upgraded to 11.0.21 to resolve picomatch HIGH vulnerability.

## [2026-05-17] - v0.9.0-pilot
### Added
- AuditLog composite index `idx_audit_logs_tenant_resource_action_created` via migration `20260517000002_auditlog_resource_action_index` to support product revision and activity queries at scale (ADR-005).
- `approval-comments` and `product-activity-timeline` integration tests wired as named npm scripts and gated steps in `scripts/run-increment-gates.cjs`.
- Server-action guard in `createExportJobAction` rejects export queueing for in-development channels at the action boundary.
- Centralized `IN_DEVELOPMENT_CHANNELS` registry in `apps/web/src/lib/marketplace-channels.ts` with `isChannelInDevelopment()` helper for UI surfaces.
- OIDC IdP configuration admin UI at `/admin/auth-policy/oidc` with self-serve issuer / clientId / clientSecret / callbackUrl / scopes / claims mapping configuration. Surfaces a disconnect card when configured.
- New step-up scope `STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK = "auth_config_high_risk"` in `apps/api/src/auth/jwt.ts` plus DTO acceptance in `step-up.dto.ts`. Applied via `@RequireStepUp` + `StepUpGuard` to OIDC controller `upsertConfig` and `deleteConfig` endpoints. Frontend forms collect a `stepUpPassword` field and issue a scoped step-up token before each mutation.
- Web integration test `admin-oidc-config-route-contract.test.cjs` with 16 assertions covering page composition, server-action wiring, step-up enforcement (frontend + backend DTO + controller decorator), API client surface, navigation.
- API integration test `auth-oidc-config-step-up.test.cjs` — boots the real API, verifies StepUpGuard runtime behavior: 401 STEP_UP_REQUIRED without token, 201 with correct-scope token, 403 STEP_UP_SCOPE_MISMATCH with mapping_high_risk scope, GET does not require step-up, DELETE follows the same gate as POST. Wired as named npm script and as a hard-gated step in `run-increment-gates.cjs` (no `allowFailure`).
- ADRs 005–010: revisions-from-audit-log, allowFailure sunset policy, JSON attribute blob acceptance, billing operator-mediated, Smart Suggestions rule-based, OIDC self-serve with step-up.
- AuditLog retention policy runbook: `docs/runbooks/audit-log-retention.md`.
- PO sign-off V4: `docs/execution/PO_SIGNOFF_CONTROLLED_PILOT_V4_2026-05-17.md` (supersedes V3).
- INC-10 diagnostic memo: `docs/execution/INC-10_IDEMPOTENCY_DIAGNOSTIC_2026-05-17.md`.
- Commit plan: `docs/execution/COMMIT_PLAN_2026-05-17.md`.

### Changed
- Meesho connector tile in `/connectors` page now honestly states the connector is in development; Excel export is not yet available. Replaces misleading copy that implied the export already worked.
- Operations dashboard KPI values now display `<windowLimit>+` when at the cap, with helper text disclosing the window cap. Replaces the prior cap-equals-total ambiguity. Stale TODO comments removed.
- `CURRENT_STATE.md` updated with V4 addendum reflecting PR #71 merge, PR #72 follow-up, 111/111 web tests, and the V4 approved/forbidden claim deltas.

### Deprecated
- `.env.staging` is now a deprecation stub redirecting to `.env.staging.example` as the canonical template. Real staging credentials never live in the repo.

## [2026-03-19] - bf77c26
### Changed
- Refreshed CURRENT_STATE.md, PRD.md, and the domain model reference to reflect the current increment ledger and release-readiness state.

## [2026-03-19] - d3ac876
### Changed
- Added connector implementation status metadata so Amazon India and Meesho are labeled honestly in connector surfaces.
- Sellers now see limited or export-only channel messaging before attempting publish workflows.

## [2026-03-19] - b0fdca2
### Changed
- Split api.ts into domain-focused modules under src/lib/api/ while keeping the public barrel stable for callers.

## [2026-03-19] - bd47041
### Changed
- Split the product detail page into tab components while preserving existing server-rendered behavior and actions.

## [2026-03-19] - ca268ca
### Added
- Added the security threat model, incident response runbook, and on-call guide for operations readiness.

## [2026-03-19] - 86abab7
### Security
- Replaced shared-password auth checks with per-user bcrypt verification and a constant-time legacy fallback.
- Step-up authentication now re-verifies the stored credential path instead of relying on an environment password.
- Password reset and unlock responses now describe the real admin-assisted recovery path.

## [2026-03-19] - a4b6095
### Added
- Added baseline legal and compliance documents for terms of service, privacy policy, data retention, and DPA.

## [2026-03-19] - a8505fc
### Changed
- Changed account export to an honest admin-only manual process instead of reporting a fake queued automation path.

## [2026-03-18] - df40d7f
### Added
- Added workspace user administration for listing users, changing roles, locking, unlocking, deactivating, and setting passwords with persistent AuthIdentity lock state.

## [2026-03-17] - 60f62bd
### Performance
- Served warm billing usage reads from the current-month cache row instead of recomputing usage on every request.

## [2026-03-17] - ebd7992
### Performance
- Removed the extra catalog stats call from the dashboard home path to reduce steady-state load and latency.
