# PIM1 Current State Verification

- Audit date: 2026-03-31
- Repo root: `C:\Users\Om Computers\PIM1`
- Repo HEAD at audit start: `78dd1c5`
- Repo HEAD at continuation refresh: `8911dc5`
- Git checkpoint created before verification: tag `audit-pre-verification-20260331-001`
- Audit mode: evidence-first, no code fixes before audit, no destructive edits
- Repo moved during verification; command-status sections below reflect the refreshed current HEAD unless explicitly described as audit-start state.
- Files changed by this audit: this report and the four companion audit artifacts only
- `docs/execution/INCREMENT_STATE.json` lock updates: none

## Executive Summary

PIM1 has a large amount of real functionality: the web app builds, the API build/typecheck/lint now pass on current HEAD, the mapping lifecycle is implemented, mapping precedence/rollback/step-up all pass live integration tests, readiness gating exists server-side, product workflow and approval flow are real, tenant isolation has strong foundations, and many admin/governance surfaces are wired.

PIM1 is **NOT READY** for production launch from the current repository state.

The main reasons are:
- tenant isolation is not strong enough to call launch-safe because `Variant.skuCode` is still globally unique (`packages/db/prisma/schema.prisma:185`), `Category.slug` is still globally unique (`packages/db/prisma/schema.prisma:108`), and many raw-SQL paths still rely on manual tenant filters (`apps/api/src/audit/audit.service.ts:81`, `apps/api/src/billing/plan-usage.service.ts:589`, `apps/api/src/compliance/compliance.service.ts:173`, `apps/api/src/dashboard/dashboard.service.ts:338`, `apps/api/src/marketplace/marketplace.service.ts:423`, `apps/api/src/media/media.service.ts:272`)
- connector launch truth is still uneven: Flipkart is the only seller-ready path; Amazon India is `planned`; Meesho is `manual`; the safe fallback registry defaults to Flipkart (`apps/api/src/connector-framework/connector-launch-policy.ts:17`, `apps/api/src/connector-framework/connector-launch-policy.ts:26`, `apps/api/src/connector-framework/connector-launch-policy.ts:52`)
- several important verification suites are still environment-coupled or bootstrap-sensitive: `cmd /c npm.cmd test` fails at `connector-idempotency-semantics` with `401 INVALID_CREDENTIALS`, `marketplace-capability-gating` still fails `401 INVALID_CREDENTIALS`, `bulk-edit-empty-scope` and `media-ssrf-guard` still fail `404 WORKSPACE_NOT_FOUND`, and several standalone suites hit `spawn EPERM`
- some visible routes are legacy redirects or placeholder-level admin surfaces and should not be counted as production-complete product depth (`apps/web/src/app/admin/workspace/page.tsx:23`, `apps/web/src/app/settings/page.tsx:6`, `apps/web/src/app/reports/page.tsx:6`)

## System Map

### 1. Top-level apps, services, packages

| Area | What exists | Evidence |
|---|---|---|
| Monorepo root | npm workspace monorepo with `apps/*` and `packages/*` | `package.json` |
| Web app | Next.js app in `apps/web` | `apps/web/package.json` |
| API/backend | NestJS app in `apps/api` | `apps/api/package.json` |
| DB/schema package | Prisma schema package in `packages/db` | `packages/db/package.json`, `packages/db/prisma/schema.prisma` |

### 2. Major backend modules by path

Source of truth: `apps/api/src/app.module.ts`

| Module | Path evidence |
|---|---|
| API keys | `apps/api/src/api-keys/` |
| Auth and step-up | `apps/api/src/auth/` |
| Audit | `apps/api/src/audit/` |
| Billing/commercial governance | `apps/api/src/billing/` |
| Taxonomy | `apps/api/src/taxonomy/` |
| Compliance/issues | `apps/api/src/compliance/` |
| Dashboard | `apps/api/src/dashboard/` |
| Connector framework/runtime | `apps/api/src/connector-framework/` |
| Connector installer/access | `apps/api/src/connector-installer/` |
| Bulk import | `apps/api/src/bulk-import/` |
| Bulk edit | `apps/api/src/bulk-edit/` |
| Catalog/products/variants | `apps/api/src/catalog/` |
| Marketplace/mappings/submissions/export jobs | `apps/api/src/marketplace/` |
| Media | `apps/api/src/media/` |
| Metrics | `apps/api/src/metrics/` |
| Notifications | `apps/api/src/notifications/` |
| Outbound webhooks | `apps/api/src/outbound-webhooks/` |
| Platform admin / tenant provisioning | `apps/api/src/platform-admin/` |
| Public signup | `apps/api/src/signup/` |
| Workspace users | `apps/api/src/workspace-users/` |
| Tenant directory/context | `apps/api/src/common/tenant/` |
| Queue/backpressure | `apps/api/src/queue/` |
| Logging/correlation | `apps/api/src/common/logging/` |
| ONDC feature module | `apps/api/src/ondc/` gated behind `FEATURE_ONDC_ENABLED` |

### 3. User-facing routes/pages

Source of truth: `apps/web/src/app/**/page.tsx`

#### Core authenticated routes

- `/dashboard`
- `/catalog/products`
- `/products/[id]`
- `/catalog/categories`
- `/catalog/attributes`
- `/catalog/media`
- `/media`
- `/channels`
- `/channels/connectors`
- `/channels/connectors/[installationId]`
- `/channels/mappings`
- `/channels/submissions`
- `/channels/health`
- `/quality`
- `/quality/issues`
- `/quality/approvals`
- `/quality/completeness`
- `/quality/validation`
- `/rejection`
- `/operations`
- `/operations/imports`
- `/operations/bulk-edit`
- `/operations/jobs`
- `/operations/repair`
- `/admin`
- `/admin/workspace`
- `/admin/plan`
- `/admin/users`
- `/admin/connectors`
- `/admin/api-keys`
- `/admin/privacy`
- `/admin/audit`
- `/admin/webhooks`

#### Auth and onboarding routes

- `/login`
- `/login/locked`
- `/login/reset`
- `/signup`
- `/signup/verify`
- `/consent`

#### Internal, feature-gated, or transition routes

- `/ai`
- `/ondc`
- `/internal/developer`
- `/connectors`
- `/connectors/[installationId]/mapping`
- `/settings`
- `/settings/plan`
- `/settings/privacy`
- `/settings/connectors`
- `/reports`
- `/`
- `/catalog`

Evidence: `apps/web/src/app/page.tsx`, `apps/web/src/app/admin/**/page.tsx`, `apps/web/src/app/catalog/**/page.tsx`, `apps/web/src/app/channels/**/page.tsx`, `apps/web/src/app/operations/**/page.tsx`, `apps/web/src/app/quality/**/page.tsx`

### 4. Backend route groups / controllers / endpoint surfaces

Source of truth: `apps/api/src/*/*controller.ts`

| Controller | Base group | Key endpoints | Evidence |
|---|---|---|---|
| AuthController | `/auth` | `/login`, `/logout`, `/password-reset/request`, `/password-reset/confirm`, `/step-up`, `/account/privacy-status`, `/account/export`, `/account/export/:jobId/download`, `/account` | `apps/api/src/auth/auth.controller.ts` |
| ApiKeysController | `/admin/api-keys` | list, create, revoke | `apps/api/src/api-keys/api-keys.controller.ts` |
| AuditController | `/audit` | list, events, export | `apps/api/src/audit/audit.controller.ts` |
| BillingController | `/billing`, `/internal` | usage, plan profile, billing contact, upgrade request, internal commercial ops | `apps/api/src/billing/billing.controller.ts` |
| BulkImportController | `/bulk-import` | templates, jobs, rows, process, repair, requeue-dlq | `apps/api/src/bulk-import/bulk-import.controller.ts` |
| BulkEditController | `/bulk-edit` | preview, apply, operation history | `apps/api/src/bulk-edit/bulk-edit.controller.ts` |
| CatalogController | `/catalog` | product CRUD, variant CRUD, review decision, delete/purge | `apps/api/src/catalog/catalog.controller.ts` |
| ProductsController | `/products` legacy | product CRUD | `apps/api/src/catalog/products.controller.ts` |
| TaxonomyController | `/taxonomy` | categories CRUD, attributes CRUD | `apps/api/src/taxonomy/taxonomy.controller.ts` |
| ComplianceController | `/compliance` | rules CRUD, validate product, product issues | `apps/api/src/compliance/compliance.controller.ts` |
| IssuesController | `/issues` | inbox, resolve | `apps/api/src/compliance/issues.controller.ts` |
| DashboardController | `/dashboard` | readiness, catalog-health, health, operations-summary | `apps/api/src/dashboard/dashboard.controller.ts` |
| MetricsController | `/metrics` | KPI trends | `apps/api/src/metrics/metrics.controller.ts` |
| MediaController | `/media` | upload/list/get/validate/bulk-associate | `apps/api/src/media/media.controller.ts` |
| ConnectorInstallerController | `/connectors` | definitions, install, installed, reconnect, uninstall/delete, payload preview, permissions | `apps/api/src/connector-installer/connector-installer.controller.ts` |
| MarketplaceController | `/marketplace` | channels, mapping versions, resolve/preflight/readiness, templates, simulate, batch readiness, export jobs | `apps/api/src/marketplace/marketplace.controller.ts` |
| SubmissionsController | `/submissions` | list, dead-letter, detail, issues, sync, retry | `apps/api/src/marketplace/submissions.controller.ts` |
| OutboundWebhooksController | `/admin/webhooks` | create/list/pause/resume/test/delete/deliveries | `apps/api/src/outbound-webhooks/outbound-webhooks.controller.ts` |
| NotificationsController | `/notifications` | list, mark read, mark all read | `apps/api/src/notifications/notifications.controller.ts` |
| SignupController | `/signup` | availability, create workspace, verify, resend | `apps/api/src/signup/signup.controller.ts` |
| WorkspaceUsersController | `/admin/workspace/users` | list/create/role/lifecycle | `apps/api/src/workspace-users/workspace-users.controller.ts` |
| PlatformAdminController | `/platform/tenants` | tenant provisioning | `apps/api/src/platform-admin/platform-admin.controller.ts` |
| RejectionIntelligenceController | `/rejection-intelligence` | product score | `apps/api/src/rejection-intelligence/rejection-intelligence.controller.ts` |
| OndcController | `/ondc` | versions, mappings, simulate | `apps/api/src/ondc/ondc.controller.ts` |

### 5. DB entities/tables/models and key relationships

Source of truth: `packages/db/prisma/schema.prisma`

- `Category`: parent/child tree; related to `Product`, `AttributeDefinition`, `ComplianceRule`, `ChannelMappingTemplate`, `MarketplaceExportJob`, `BulkImportJob`, `BulkImportTemplate`
- `Product`: belongs to `Category`; has many `Variant`, `ValidationIssue`, `MarketplaceExportJob`, `BulkImportRow`, `BulkEditOperationItem`
- `Variant`: belongs to `Product`
- `AttributeDefinition`: belongs to `Category`
- `ComplianceRule`: optional relation to `Category`
- `ValidationIssue`: belongs to `Product`; optional relation to `Variant` and `ComplianceRule`
- `BulkImportJob` -> has many `BulkImportRow`
- `BulkEditOperation` -> has many `BulkEditOperationItem`
- `MarketplaceExportJob` -> belongs to `Product`, `Category`, optional `ChannelMappingTemplate`
- Governance/auth/privacy models: `AuthIdentity`, `ApiAccessKey`, `WorkspaceDirectory`, `AuditLog`, `AccountConsentEvent`, `AccountExportRequest`, `AccountDeletionRequest`, `AuthRecoveryToken`, `PublicSignupRequest`, `UserNotification`, `ConnectorPermission`, `PlanUsage`, `TenantPlanProfile`, `TenantCommercialRequest`, `OutboundWebhookEndpoint`, `OutboundWebhookDelivery`

### 6. Background jobs / workers / queues / cron flows

| Queue or job | Purpose | Evidence |
|---|---|---|
| `bulk-import` | import processing | `apps/api/src/queue/queue.constants.ts`, `apps/api/src/bulk-import/bulk-import.service.ts` |
| `connector-submission` | connector submission/export processing and retries | `apps/api/src/queue/queue.constants.ts`, `apps/api/src/marketplace/marketplace.service.ts` |
| `connector-webhook` | connector webhook processing | `apps/api/src/connector-framework/connector-webhook-processing.service.ts` |
| `webhook-event` | outbound webhook deliveries | `apps/api/src/outbound-webhooks/outbound-webhooks.service.ts` |
| `auth-email` | auth mail delivery | `apps/api/src/auth/auth.service.ts` |
| `account-export` | account export generation | `apps/api/src/auth/auth.service.ts` |
| CI cron | staging daily rollout evidence capture | `.github/workflows/capture-daily-rollout-evidence.yml` |
| CI schedule | nightly staging E2E journey | `.github/workflows/e2e-staging.yml` |

### 7. External integrations / connectors

| Integration | Current truth | Evidence |
|---|---|---|
| Flipkart | materially implemented, seller-ready connector path | `apps/api/src/connectors/flipkart/flipkart.connector.ts`, `apps/api/test/integration/flipkart-publish-job.test.cjs` |
| Amazon India | partial connector, launch stage planned, not seller-ready | `apps/api/src/connectors/amazon/amazon.connector.ts`, `apps/api/src/connector-framework/connector-launch-policy.ts:17`, `apps/web/src/app/connectors/page.tsx:131` |
| Meesho | partial/manual export workflow; direct publish not supported | `apps/api/src/connectors/meesho/meesho.connector.ts`, `apps/api/src/connector-framework/connector-launch-policy.ts` |
| ONDC | feature-gated, admin-only, non-production | `apps/api/src/app.module.ts`, `apps/web/src/app/ondc/page.tsx`, `apps/api/test/integration/ondc-feature-gating.test.cjs` |
| PostgreSQL / Prisma | core data layer | `packages/db/prisma/schema.prisma`, `apps/api/src/prisma/prisma.service.ts` |
| Redis / BullMQ | queueing, lockouts, blocklist, backpressure | `apps/api/src/queue/queue.service.ts`, `apps/api/src/auth/auth.service.ts`, `apps/api/src/common/env-validation.ts` |
| R2 / object storage | media and account export storage | `.env.example`, `apps/api/src/auth/auth-export-storage.service.ts`, `apps/api/src/media/media.service.ts` |
| Email provider | file/console/resend modes | `apps/api/src/common/env-validation.ts`, `apps/api/src/auth/auth-email.service.ts` |
| Outbound webhooks | tenant-configured webhook delivery | `apps/api/src/outbound-webhooks/outbound-webhooks.service.ts`, `apps/web/src/app/admin/webhooks/page.tsx` |

### 8. Feature flags and env-gated modules

| Flag or gate | Behavior | Evidence |
|---|---|---|
| `FEATURE_ONDC_ENABLED` | enables ONDC module and page | `apps/api/src/app.module.ts`, `apps/web/src/app/ondc/page.tsx`, `.env.example` |
| `FEATURE_PUBLIC_SIGNUP_ENABLED` and `NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED` | enable public signup API and UI | `apps/api/src/signup/signup.service.ts`, `apps/web/src/lib/public-signup.ts`, `.env.example` |
| `FEATURE_REAL_SPAPI_VALIDATION` | requires live marketplace credentials when enabled | `apps/api/src/common/env-validation.ts`, `apps/api/src/connectors/amazon/amazon-validation.ts` |
| `APP_ENV !== production` | exposes Swagger; allows internal AI/ONDC/developer pages | `apps/api/src/main.ts`, `apps/web/src/app/ai/page.tsx`, `apps/web/src/app/ondc/page.tsx`, `apps/web/src/app/internal/developer/page.tsx` |
| `AUTH_MODE` | `local` vs `db` auth mode; staging/prod must use `db` | `apps/api/src/common/env-validation.ts`, `.env.example` |
| `QUEUE_BACKEND` and `QUEUE_WORKER_ENABLED` | queue backend/runtime gating | `apps/api/src/common/env-validation.ts`, `.env.example` |
| `CONNECTOR_SAFE_FALLBACK_SLUGS` | safe registry fallback | `apps/api/src/connector-framework/connector-launch-policy.ts` |
| `CONNECTOR_STUB_SLUGS` and `NEXT_PUBLIC_CONNECTOR_STUB_SLUGS` | hide stub connectors from seller-facing surfaces | `.env.example`, `apps/api/src/connector-installer/connector-installer.service.ts`, `apps/api/src/marketplace/marketplace.service.ts` |

### 9. Ten most critical end-to-end flows

| Flow | Current reality | Evidence |
|---|---|---|
| Workspace login and session issuance | real | `apps/api/src/auth/auth.controller.ts`, `apps/api/test/integration/auth-revocation.test.cjs`, `apps/web/test/e2e/auth.workspace.spec.js` |
| Step-up for high-risk mapping actions | real | `apps/api/src/auth/auth.controller.ts`, `apps/api/src/marketplace/marketplace.controller.ts`, `apps/api/test/integration/connector-mapping-step-up.test.cjs` |
| Public signup -> verification -> first admin | real but feature-flagged | `apps/api/src/signup/signup.controller.ts`, `apps/api/test/integration/public-signup.test.cjs`, `apps/web/test/integration/public-signup-web-flow.test.cjs` |
| Category + attribute setup | real, with limited attribute-management depth | `apps/api/src/taxonomy/taxonomy.controller.ts`, `apps/web/src/app/catalog/categories/page.tsx`, `apps/web/src/app/catalog/attributes/page.tsx` |
| Product create/update + workflow transitions | real | `apps/api/src/catalog/catalog.controller.ts`, `apps/api/test/integration/create-product-pricing-normalization.test.cjs`, `apps/api/test/integration/product-workflow-transitions.test.cjs` |
| Bulk import -> process -> row repair -> DLQ requeue | real, but tenant-boundary verification currently failing | `apps/api/src/bulk-import/bulk-import.controller.ts`, `apps/web/src/app/operations/imports/page.tsx`, `apps/web/test/e2e/operations-import-repair.spec.js`, `apps/api/test/integration/bulk-import-tenant-boundary.test.cjs` |
| Issue inbox -> review decision -> approval queue | real | `apps/api/src/compliance/issues.controller.ts`, `apps/api/src/catalog/catalog.controller.ts`, `apps/web/src/app/quality/approvals/page.tsx`, `apps/web/test/e2e/reviewer-approvals.spec.js` |
| Connector install -> permissions -> connector detail | real for Flipkart, partial across connector set | `apps/api/src/connector-installer/connector-installer.controller.ts`, `apps/web/src/app/connectors/page.tsx`, `apps/web/test/e2e/channels-connector-detail-drilldown.spec.js` |
| Mapping draft -> validate -> publish -> precedence -> rollback | real and strongly verified | `apps/api/src/marketplace/connector-mapping.service.ts`, `apps/web/src/app/channels/mappings/page.tsx`, `apps/api/test/integration/connector-mapping-lifecycle.test.cjs`, `apps/api/test/integration/connector-mapping-precedence.test.cjs`, `apps/api/test/integration/connector-mapping-rollback.test.cjs`, `apps/web/test/e2e/channels-mapping-publish.spec.js` |
| Readiness gating -> export job -> submission tracking -> retry / DLQ | real for current implemented connector path | `apps/api/src/marketplace/marketplace.service.ts`, `apps/api/test/integration/marketplace-readiness-batch.test.cjs`, `apps/api/test/integration/submission-lifecycle-api.test.cjs`, `apps/api/test/integration/marketplace-worker-failure-visibility.test.cjs`, `apps/web/src/app/operations/jobs/page.tsx` |

## Capability Inventory

| Capability | Status | What exists | What is missing / not launch-ready | Runtime confidence | Evidence |
|---|---|---|---|---|---|
| Authentication | WORKING | login, logout, lockout, reset, revocation, step-up, per-user password hashes | local shared-password fallback still exists outside strict DB mode | High | `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/auth.service.ts`, `apps/api/test/integration/auth-revocation.test.cjs`, `apps/api/test/integration/auth-login-lockout.test.cjs` |
| Authorization / RBAC | WORKING | app-wide JWT + RBAC guards, reviewer role, connector permissions | none blocking found in current scan | High | `apps/api/src/app.module.ts`, `apps/api/src/common/rbac/roles.ts`, `apps/api/test/integration/quality-reviewer-role.test.cjs`, `apps/api/test/integration/connector-access-entitlements.test.cjs` |
| Tenant isolation | PARTIAL | tenant middleware, Prisma tenant extension, RLS policies, passing isolation tests | global `Variant.skuCode` and `Category.slug`; many raw SQL `RLS-BYPASS` paths rely on manual filters | Medium | `apps/api/src/common/tenant/tenant-context.middleware.ts`, `apps/api/src/prisma/extensions/tenant-scope.ts`, `packages/db/prisma/schema.prisma`, `scripts/verify-tenant-rls.cjs`, `apps/api/test/integration/rls-isolation.test.cjs` |
| Product CRUD | WORKING | real product endpoints and product workbench/detail UI | no blocker found in audited paths | High | `apps/api/src/catalog/catalog.controller.ts`, `apps/web/src/app/catalog/products/page.tsx`, `apps/web/src/app/products/[id]/page.tsx`, `apps/api/test/integration/create-product-pricing-normalization.test.cjs` |
| Variant handling | PARTIAL | variant CRUD exists in catalog module and product detail | tenant-scoped SKU uniqueness missing; dedicated variant runtime coverage is thin | Medium | `apps/api/src/catalog/catalog.controller.ts`, `packages/db/prisma/schema.prisma`, `apps/web/src/app/products/[id]/page.tsx` |
| Category management | PARTIAL | category CRUD/tree exists, category page real | richer governance/edit depth not fully verified; category slug is global unique | Medium | `apps/api/src/taxonomy/taxonomy.controller.ts`, `apps/web/src/app/catalog/categories/page.tsx`, `packages/db/prisma/schema.prisma` |
| Attribute management | PARTIAL | add/list definitions by category works in real page | full edit/delete workflow not surfaced clearly in UI | High | `apps/api/src/taxonomy/taxonomy.controller.ts`, `apps/web/src/app/catalog/attributes/page.tsx`, `docs/admin-setup-checklist.md` |
| Media handling | PARTIAL | upload, list, validate, bulk associate UI/API exist | current run did not cleanly verify media SSRF guard | Medium | `apps/api/src/media/media.controller.ts`, `apps/web/src/app/media/page.tsx`, `apps/api/test/integration/media-ssrf-guard.test.cjs` |
| Dashboard | WORKING | real API-backed dashboard with health, readiness, ops, KPI views | no blocker found in current audited flow | High | `apps/api/src/dashboard/dashboard.controller.ts`, `apps/web/src/app/dashboard/page.tsx`, `apps/api/test/integration/dashboard-aggregations.test.cjs`, `apps/web/test/e2e/dashboard-priority-drilldown.spec.js` |
| Quality issue inbox | WORKING | inbox list and resolution flow exist | no blocker found in current audited flow | High | `apps/api/src/compliance/issues.controller.ts`, `apps/web/src/app/quality/issues/page.tsx`, `apps/api/test/integration/issue-inbox.test.cjs` |
| Approval queue | WORKING | real `in_review` queue with approve/reject actions and reviewer role | no blocker found in current audited flow | High | `apps/api/src/catalog/catalog.controller.ts`, `apps/web/src/app/quality/approvals/page.tsx`, `apps/web/test/e2e/reviewer-approvals.spec.js` |
| Bulk import | PARTIAL | templates, jobs, process, row repair, DLQ requeue, imports UI | tenant-boundary integration did not pass in current run | Medium | `apps/api/src/bulk-import/bulk-import.controller.ts`, `apps/web/src/app/operations/imports/page.tsx`, `apps/web/test/e2e/operations-import-repair.spec.js`, `apps/api/test/integration/bulk-import-tenant-boundary.test.cjs` |
| Repair center | WORKING | real repair dashboard for import failures and dead-letter submissions | no blocker found in current audited flow | High | `apps/web/src/app/operations/repair/page.tsx`, `apps/web/test/e2e/operations-import-repair.spec.js` |
| Bulk edit | PARTIAL | preview/apply/history APIs and UI exist | empty-scope verification failed in current run; no executed browser proof in this audit | Medium | `apps/api/src/bulk-edit/bulk-edit.controller.ts`, `apps/web/src/app/operations/bulk-edit/page.tsx`, `apps/api/test/integration/bulk-edit-empty-scope.test.cjs` |
| Connector installation/config | PARTIAL | definitions/install/list/reconnect/uninstall/delete/permissions exist | only Flipkart is seller-ready; Amazon is partial and Meesho is guided/manual | High | `apps/api/src/connector-installer/connector-installer.controller.ts`, `apps/web/src/app/connectors/page.tsx`, `apps/api/src/connector-framework/connector-launch-policy.ts` |
| Mapping creation/edit/publish | WORKING | canonical `/channels/mappings` UI, versioned drafts, validate/publish flow | no blocker found in current audited Flipkart path | High | `apps/web/src/app/channels/mappings/page.tsx`, `apps/api/src/marketplace/marketplace.controller.ts`, `apps/web/test/e2e/channels-mapping-publish.spec.js` |
| Mapping versioning | WORKING | version table, lifecycle states, list/create/validate/publish | no blocker found in current audited flow | High | `packages/db/prisma/migrations/20260306171000_connector_mapping_lifecycle_v1/migration.sql`, `apps/api/test/integration/connector-mapping-lifecycle.test.cjs` |
| Mapping rollback | WORKING | rollback endpoint creates new published clone and preserves invariants | no blocker found in current audited flow | High | `apps/api/src/marketplace/connector-mapping.service.ts`, `apps/api/test/integration/connector-mapping-rollback.test.cjs` |
| Step-up protected actions | WORKING | publish, rollback, archive protected by step-up guard and scoped token | no blocker found in current audited flow | High | `apps/api/src/marketplace/marketplace.controller.ts`, `apps/api/src/auth/step-up.guard.ts`, `apps/api/test/integration/connector-mapping-step-up.test.cjs` |
| Readiness checks | WORKING | preflight, publish readiness, batch readiness, server-side export block | no blocker found in current audited flow | High | `apps/api/src/marketplace/connector-mapping.service.ts`, `apps/api/test/integration/marketplace-readiness-batch.test.cjs` |
| Publish/export flow | PARTIAL | export job creation, queueing, submission lifecycle, retry/DLQ exist | connector coverage is incomplete across the connector set; current root verification still fails idempotency/bootstrap proof | Medium | `apps/api/src/marketplace/marketplace.service.ts:463`, `apps/api/test/integration/submission-lifecycle-api.test.cjs`, `apps/api/test/integration/connector-capability-orchestration.test.cjs`, `cmd /c npm.cmd test` |
| Submission logging | WORKING | `connector_submissions` lifecycle, list/detail/issues/sync/retry surfaces | no blocker found in current audited flow | High | `apps/api/src/marketplace/submissions.controller.ts`, `apps/api/test/integration/submission-lifecycle-api.test.cjs`, `apps/web/src/app/channels/submissions/page.tsx` |
| Job monitoring | WORKING | operations jobs page, dead-letter listing, worker failure visibility | no blocker found in current audited flow | High | `apps/web/src/app/operations/jobs/page.tsx`, `apps/api/test/integration/marketplace-worker-failure-visibility.test.cjs` |
| Audit logging | WORKING | audit capture, explorer page, export, actor-context test | detailed UI is summary-first, not a full explorer product | High | `apps/api/src/audit/audit.controller.ts`, `apps/web/src/app/admin/audit/page.tsx`, `apps/api/test/integration/audit-actor-context.test.cjs`, `apps/web/test/e2e/audit-explorer.spec.js` |
| Privacy/export/deletion requests | WORKING | privacy status, account export, secure download, delete-account scheduling, admin privacy page | no blocker found in current audited flow | High | `apps/api/src/auth/auth.controller.ts`, `apps/web/src/app/admin/privacy/page.tsx`, `apps/api/test/integration/auth-account-privacy.test.cjs` |
| Settings/admin | PARTIAL | admin pages for plan, users, connectors, API keys, privacy, audit, webhooks are real | `/admin/workspace` is placeholder and `/settings*` are legacy redirects | High | `apps/web/src/app/admin/page.tsx`, `apps/web/src/app/admin/workspace/page.tsx`, `apps/web/src/app/settings/page.tsx` |
| Internal/labs/non-prod routes | PARTIAL | `/ai`, `/ondc`, `/internal/developer` are real pages | they are admin-only and blocked in production; not launchable seller surfaces | High | `apps/web/src/app/ai/page.tsx`, `apps/web/src/app/ondc/page.tsx`, `apps/web/src/app/internal/developer/page.tsx` |

## Verification Commands Run

### Passed

- refreshed current-HEAD build health:
  - `npx tsc -p apps/api/tsconfig.build.json --noEmit`
  - `npm run lint --workspace @pim1/api`
  - `npm run build --workspace @pim1/api`
- `npx tsc -p apps/web/tsconfig.json --noEmit`
- `npm run lint --workspace @pim1/web`
- `npm run build --workspace @pim1/web`
- `npm run test:integration:auth-revocation`
- `npm run test:integration:create-product-pricing-normalization`
- `npm run test:integration:product-workflow-transitions`
- `npm run test:integration:connector-mapping-lifecycle`
- `node apps/api/test/integration/connector-mapping-precedence.test.cjs`
- `node apps/api/test/integration/connector-mapping-rollback.test.cjs`
- `node apps/api/test/integration/connector-mapping-step-up.test.cjs`
- `npm run test:integration:marketplace-readiness-batch`
- `npm run test:integration:submission-lifecycle-api`
- `npm run test:integration:dashboard-aggregations`
- `npm run test:integration:notifications-center`
- `npm run test:integration:metrics-kpi-trends`
- `npm run test:integration:marketplace-worker-failure-visibility`
- `npm run test:integration:api-keys`
- `npm run test:integration:auth-account-privacy`
- `npm run test:integration:rls-isolation`
- `npm run test:integration:issue-inbox`
- `npm run test:integration:quality-reviewer-role`
- `npm run test:integration:connector-access-entitlements`
- `npm run test:integration:outbound-webhooks`
- `npm run test:integration:public-signup`
- `npm run test:integration:web-public-signup`
- `npm run test:integration:auth-login-lockout`
- `npm run test:integration:billing-commercial-governance-access`
- `npm run test:integration:billing-upgrade-request`
- `npm run test:integration:billing-commercial-notifications`
- `npm run test:integration:audit-actor-context`
- `node apps/api/test/integration/audit-explorer-api.test.cjs`
- `npm run test:integration:credential-rotation`
- `npm run test:integration:ondc-feature-gating`
- `npm run test:integration:web-auth-cookie-csrf`
- `cmd /c npm.cmd run test:integration:connector-capability-orchestration`

### Failed

- `cmd /c npm.cmd test`
  - `connector-idempotency-semantics` still failed with login `401 INVALID_CREDENTIALS`
- `cmd /c npm.cmd run test:product`
  - API lint/build and web lint passed, but web build failed with `spawn EPERM`
- `cmd /c npm.cmd run test:integration:marketplace-capability-gating`
  - login failed with `401 INVALID_CREDENTIALS`
- `cmd /c npm.cmd run test:integration:bulk-edit-empty-scope`
  - login failed with `404 WORKSPACE_NOT_FOUND`
- `cmd /c npm.cmd run test:integration:media-ssrf-guard`
  - login failed with `404 WORKSPACE_NOT_FOUND`

### Blocked by Environment

- raw PowerShell `npm run ...` invocations were blocked by execution policy; reruns used `cmd /c npm.cmd ...`
- `cmd /c npm.cmd run test:integration:env-validation`
  - blocked by `spawn EPERM`
- `cmd /c npm.cmd run test:integration:catalog-completeness`
  - blocked by `spawn EPERM`
- `cmd /c npm.cmd run test:integration:connector-idempotency-semantics`
  - blocked by `spawn EPERM` on standalone rerun, even though the root `npm test` path reached the suite and failed semantically with `401 INVALID_CREDENTIALS`
- `cmd /c npm.cmd run test:integration:mapping-manager`
  - blocked by `spawn EPERM`
- `cmd /c npm.cmd run test:integration:bulk-import-tenant-boundary`
  - blocked by `spawn EPERM`
- `npx playwright test --config=playwright.config.cjs`
  - 23 passed, 6 failed because `PLAYWRIGHT_SIGNUP_OUTBOX_DIR` was not set
- browser flows blocked by that env:
  - `apps/web/test/e2e/admin-plan-signup-export.spec.js`
  - `apps/web/test/e2e/admin-plan-upgrade-request.spec.js`
  - `apps/web/test/e2e/dashboard-signup-drilldown.spec.js`
  - `apps/web/test/e2e/internal-commercial-audit-followup.spec.js`
  - `apps/web/test/e2e/internal-commercial-ops.spec.js`
  - `apps/web/test/e2e/public-signup.spec.js`

## Domain Integrity Findings

| Severity | Finding | Evidence |
|---|---|---|
| Critical | `Variant.skuCode` is globally unique instead of tenant-scoped. Multi-tenant sellers cannot safely share SKU namespaces. | `packages/db/prisma/schema.prisma:180`, `packages/db/prisma/schema.prisma:185` |
| Critical | `Category.slug` is globally unique instead of tenant-scoped. That creates cross-tenant namespace coupling in core taxonomy. | `packages/db/prisma/schema.prisma:104`, `packages/db/prisma/schema.prisma:108` |
| High | Tenant isolation is strong in architecture but still depends on many manual raw-SQL filters marked `RLS-BYPASS`. | `apps/api/src/audit/audit.service.ts:81`, `apps/api/src/billing/plan-usage.service.ts:589`, `apps/api/src/compliance/compliance.service.ts:173`, `apps/api/src/dashboard/dashboard.service.ts:338`, `apps/api/src/marketplace/marketplace.service.ts:423`, `apps/api/src/media/media.service.ts:272` |
| High | Connector launch maturity is still uneven: Flipkart is the only seller-ready path; Amazon India is `planned`; Meesho is `manual`; safe fallback registration defaults to Flipkart. | `apps/api/src/connector-framework/connector-launch-policy.ts:17`, `apps/api/src/connector-framework/connector-launch-policy.ts:26`, `apps/api/src/connector-framework/connector-launch-policy.ts:52`, `apps/web/src/app/connectors/page.tsx:131`, `apps/web/src/app/connectors/page.tsx:135` |
| High | Readiness gating is implemented server-side and blocks export creation correctly. This is a positive integrity result and should be preserved as release-critical behavior. | `apps/api/src/marketplace/marketplace.service.ts:463`, `apps/api/src/marketplace/marketplace.service.ts:489`, `apps/api/src/marketplace/connector-mapping.service.ts:1131`, `apps/api/src/marketplace/connector-mapping.service.ts:1141`, `apps/api/test/integration/marketplace-readiness-batch.test.cjs` |
| High | Mapping lifecycle integrity is strong: allowed states, one-published-version invariant, deterministic precedence, rollback cloning, and step-up enforcement all verified live. | `packages/db/prisma/migrations/20260306171000_connector_mapping_lifecycle_v1/migration.sql`, `apps/api/src/marketplace/marketplace.controller.ts:91`, `apps/api/src/marketplace/marketplace.controller.ts:109`, `apps/api/src/marketplace/marketplace.controller.ts:128`, `apps/api/test/integration/connector-mapping-lifecycle.test.cjs`, `apps/api/test/integration/connector-mapping-precedence.test.cjs`, `apps/api/test/integration/connector-mapping-rollback.test.cjs`, `apps/api/test/integration/connector-mapping-step-up.test.cjs` |
| Medium | Submission idempotency exists in code, but the named end-to-end semantics test still does not reproduce cleanly. | `apps/api/src/connector-framework/connector-framework.service.ts`, `apps/api/test/integration/connector-idempotency-semantics.test.cjs`, `cmd /c npm.cmd test`, `cmd /c npm.cmd run test:integration:connector-idempotency-semantics` |
| Medium | Current verification reproducibility is weaker than launch-ready because some suites still fail bootstrap and some are environment-blocked by child-process launch policy. | `cmd /c npm.cmd run test:integration:marketplace-capability-gating`, `cmd /c npm.cmd run test:integration:bulk-edit-empty-scope`, `cmd /c npm.cmd run test:integration:media-ssrf-guard`, `cmd /c npm.cmd run test:integration:env-validation`, `cmd /c npm.cmd run test:integration:catalog-completeness`, `cmd /c npm.cmd run test:integration:mapping-manager`, `cmd /c npm.cmd run test:integration:bulk-import-tenant-boundary`, `scripts/run-product-suite.cjs` |

## UI Surface Reality Map

| Route | Status | Current reality | Evidence |
|---|---|---|---|
| `/dashboard` | REAL | API-backed dashboard with health/KPI/triage | `apps/web/src/app/dashboard/page.tsx`, `apps/api/test/integration/dashboard-aggregations.test.cjs` |
| `/catalog/products` | REAL | product workbench | `apps/web/src/app/catalog/products/page.tsx`, `apps/web/test/integration/catalog-products-route-contract.test.cjs` |
| `/products/[id]` | REAL | product detail with readiness, exports, variants, quality | `apps/web/src/app/products/[id]/page.tsx`, `apps/web/test/integration/product-detail-route-contract.test.cjs` |
| `/catalog/categories` | PARTIAL | real taxonomy page, but category management depth is limited | `apps/web/src/app/catalog/categories/page.tsx`, `apps/api/src/taxonomy/taxonomy.controller.ts` |
| `/catalog/attributes` | PARTIAL | real page for attribute definitions; not a full admin editor | `apps/web/src/app/catalog/attributes/page.tsx` |
| `/catalog/media` | ALIAS | exports `/media` | `apps/web/src/app/catalog/media/page.tsx` |
| `/media` | REAL | API-backed upload/list/validation/bulk association page | `apps/web/src/app/media/page.tsx`, `apps/api/src/media/media.controller.ts` |
| `/channels/connectors` | ALIAS-CANONICAL | canonical nav path that re-exports `/connectors` page | `apps/web/src/app/channels/connectors/page.tsx`, `apps/web/src/app/connectors/page.tsx:131`, `apps/web/src/app/connectors/page.tsx:135` |
| `/connectors` | REAL | actual connector matrix/install page; shows honest launch stages | `apps/web/src/app/connectors/page.tsx:131`, `apps/web/src/app/connectors/page.tsx:135` |
| `/channels/mappings` | REAL | canonical mapping editor with preflight/readiness/history/rollback context | `apps/web/src/app/channels/mappings/page.tsx:177`, `apps/web/src/app/channels/mappings/page.tsx:209`, `apps/web/test/e2e/channels-mapping-publish.spec.js` |
| `/connectors/[installationId]/mapping` | TRANSITION-ONLY | redirector into canonical mapping workspace | `apps/web/src/app/connectors/[installationId]/mapping/page.tsx:72` |
| `/operations/imports` | REAL | imports dashboard with job list and row repair | `apps/web/src/app/operations/imports/page.tsx`, `apps/web/test/e2e/operations-import-repair.spec.js` |
| `/operations/bulk-edit` | REAL | bulk edit preview/apply/history page | `apps/web/src/app/operations/bulk-edit/page.tsx` |
| `/operations/jobs` | REAL | jobs and submission monitoring page | `apps/web/src/app/operations/jobs/page.tsx` |
| `/operations/repair` | REAL | import failure and dead-letter repair surface | `apps/web/src/app/operations/repair/page.tsx` |
| `/admin/workspace` | PLACEHOLDER-PARTIAL | page is real but only says workspace settings are managed elsewhere | `apps/web/src/app/admin/workspace/page.tsx:11`, `apps/web/src/app/admin/workspace/page.tsx:23` |
| `/settings` | LEGACY REDIRECT | redirects to `/admin` | `apps/web/src/app/settings/page.tsx:6` |
| `/settings/plan` | LEGACY REDIRECT | redirects to `/admin/plan` | `apps/web/src/app/settings/plan/page.tsx:6` |
| `/settings/privacy` | LEGACY REDIRECT | redirects to `/admin/privacy` | `apps/web/src/app/settings/privacy/page.tsx:6` |
| `/settings/connectors` | LEGACY REDIRECT | redirects to `/admin/connectors` | `apps/web/src/app/settings/connectors/page.tsx:6` |
| `/reports` | LEGACY REDIRECT | redirects to `/dashboard` | `apps/web/src/app/reports/page.tsx:6` |
| `/ai` | INTERNAL NON-PROD | real admin-only page blocked in production | `apps/web/src/app/ai/page.tsx` |
| `/ondc` | INTERNAL NON-PROD + FLAGGED | real admin-only page blocked in production and behind feature flag | `apps/web/src/app/ondc/page.tsx`, `apps/api/test/integration/ondc-feature-gating.test.cjs` |
| `/internal/developer` | INTERNAL NON-PROD | real admin-only internal commercial ops page | `apps/web/src/app/internal/developer/page.tsx` |

## Critical Test Coverage Matrix

Detailed matrix: `PIM1_TEST_COVERAGE_MATRIX.md`

Short verdict:
- product workflow transitions: strong
- mapping lifecycle: strong
- mapping precedence: strong
- rollback: strong
- step-up security: strong
- tenant isolation: medium-high foundation, but not fully closed because uniqueness and raw-SQL coverage gaps remain
- import validation: medium
- submission flow: medium-high
- readiness gating: strong

## Docs Truth Reconciliation

Detailed reconciliation: `PIM1_DOCS_VS_CODE_TRUTH.md`

Short verdict:
- current connector docs are mostly honest and aligned
- admin setup checklist is largely aligned
- several generated page playbooks are stale or low-value
- `docs/execution/CURRENT_STATE.md` is partially stale relative to current HEAD
- older review material contains security statements that are no longer fully true

## Production Readiness Verdict

### Verdict

**NOT READY**

### Why this is the correct verdict

- release-blocking tenant-isolation gaps remain in the schema and raw-SQL trust boundary
- connector launch scope is not production-complete beyond Flipkart
- current verification is not reproducible enough to sign off launch confidence
- internal/legacy/placeholder surfaces still need cleanup or hard launch scoping
- execution docs still show `INC-08` rollout evidence open

## Top Launch Blockers

Detailed blocker list: `PIM1_LAUNCH_BLOCKERS.md`

1. Global `Variant.skuCode` uniqueness instead of tenant-scoped uniqueness
2. Global `Category.slug` uniqueness instead of tenant-scoped uniqueness
3. Manual-tenant-filter dependency across many `RLS-BYPASS` raw SQL paths
4. Only Flipkart is seller-ready; Amazon is planned and Meesho is manual
5. Root `cmd /c npm.cmd test` still fails at `connector-idempotency-semantics`
6. `marketplace-capability-gating`, `bulk-edit-empty-scope`, and `media-ssrf-guard` still fail login/workspace bootstrap
7. `env-validation`, `catalog-completeness`, `mapping-manager`, and `bulk-import-tenant-boundary` are currently blocked by `spawn EPERM`
8. `/admin/workspace` is placeholder and `/settings*` plus `/reports` are legacy redirects
9. Browser verification for signup/commercial flows is blocked unless `PLAYWRIGHT_SIGNUP_OUTBOX_DIR` is set
10. `docs/execution/CURRENT_STATE.md` / `INCREMENT_STATE.json` still show rollout evidence incomplete under `INC-08`

## Recommended Next Actions

### Launch blockers

1. Change `Variant.skuCode` and `Category.slug` to tenant-scoped uniqueness with migration plus regression tests.
2. Audit every `RLS-BYPASS` raw-SQL path and add explicit tenant-leak tests for each service family.
3. Keep seller launch truth strict: Flipkart only for self-serve; keep Amazon and Meesho hidden or guided until complete.
4. Fix the failing integration suites so they no longer depend on local password/workspace drift.
5. Remove `spawn EPERM` blockers from standalone integration runs and the product suite.
6. Either implement real `/admin/workspace` settings or remove it from launch scope; document `/settings*` and `/reports` as aliases only.
7. Standardize Playwright signup/commercial test wrappers so required outbox env is always provisioned.
8. Preserve and extend the current server-side readiness + step-up guardrails while fixing test/bootstrap issues.

### Post-launch improvements

9. Expand end-to-end coverage around media SSRF, bulk edit, and bulk import tenant boundaries.
10. Close rollout evidence continuity and observation-window gaps tracked under `INC-08` before calling the system beta-ready.

## Required Final Report Addendum

### Changed files

- `PIM1_CURRENT_STATE_VERIFICATION.md`
- `PIM1_VERIFICATION_FINDINGS.csv`
- `PIM1_TEST_COVERAGE_MATRIX.md`
- `PIM1_DOCS_VS_CODE_TRUTH.md`
- `PIM1_LAUNCH_BLOCKERS.md`

### Commands run

See `Verification Commands Run` above.

### Pass/fail results

- Pass: API build/lint/typecheck on current HEAD, major mapping, readiness, dashboard, privacy, audit, auth, reviewer, signup, submission, webhook, connector capability orchestration, and many browser workflows
- Fail: root `npm test`, marketplace capability gating, bulk-edit empty-scope, media SSRF guard, and several env-coupled suites

### Remaining blockers

See `Top Launch Blockers` above.

### Lock updates made in `docs/execution/INCREMENT_STATE.json`

- None
