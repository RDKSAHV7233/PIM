---
title: TEJ PIM Review - 2026-03-18
type: dual-lens-review
lens: product-owner + cto
head_sha: 069acc7
reviewer: codex
---

## Scorecard

| Dimension | Score | One-line verdict |
|---|---|---|
| Delivery velocity | 4/5 | Throughput is strong and increment locking is mostly disciplined, with a little reopen/relock churn still visible in recent commits. |
| Production readiness | 2/5 | Staging gates are strong, but production sign-off is blocked by both the 14-day evidence window and a real auth security flaw. |
| Auth and security | 2/5 | Lockouts, JWT revocation, and environment guards are solid, but password verification is still a plain-text shared secret check. |
| Backend code quality | 3/5 | Core services are functional and increasingly hardened, but several are still oversized and some runtime fallbacks are too permissive. |
| Frontend code quality | 3/5 | The shell and admin surfaces are coherent, but the product detail page and API client remain large god files. |
| Connector readiness | 2/5 | Flipkart is materially implemented, while Amazon India and Meesho still rely on stub or partial connector behavior. |
| Test coverage | 4/5 | Integration coverage is broad and staging now has both nightly deep E2E and deploy smoke gates. |
| Scalability | 4/5 | BullMQ, Redis-backed caching, and targeted indexes are in place, though a few compute-heavy paths still depend on stale-while-refresh mitigation. |
| Documentation | 3/5 | The repo has a lot of useful documentation, but several canonical snapshots are stale and the legal/security set is incomplete. |
| **Overall** | **3/5** | TEJ PIM is credible for controlled rollout, but it is not ready for broad production until auth/compliance gaps are closed. |

---

## Part 1 - Product Owner review

### 1.1 Delivery health

| Increment ID | Name | Status | Stories locked/total |
|---|---|---|---|
| INC-01 | Seller Workflow Core | completed | 6/6 |
| INC-02 | Catalog Throughput | completed | 2/2 |
| INC-03 | Connector Reliability | completed | 4/4 |
| INC-04 | Security and Isolation | completed | 1/1 |
| INC-05 | Ops and Observability | completed | 3/4 |
| INC-06 | Decision Dashboards | completed | 1/1 |
| INC-07 | Governance and Compliance | completed | 3/3 |
| INC-08 | Release Readiness | in_progress | 20/20 |
| INC-09 | Connector Mapping Lifecycle + Publish Readiness | completed | 14/14 |
| INC-10 | Flipkart Publish Connector v1 | completed | 8/8 |
| INC-11 | Workspace Login and Tenant Discovery | completed | 1/1 |
| INC-12 | Connector Access Stability | completed | 1/1 |
| INC-13 | Connector Access Validation and Admin UX | completed | 1/1 |
| INC-14 | Mappings Workflow UX Restructure | completed | 1/1 |
| INC-15 | Hydration Stability for Form Primitives | completed | 1/1 |
| INC-16 | Product Test Architecture and UI UX Acceptance | completed | 1/1 |
| INC-17 | Catalog Delete UX | completed | 1/1 |
| INC-18 | Playwright E2E Coverage and Workflow Stabilization | completed | 1/1 |
| INC-19 | Performance Optimization Sprint | completed | 3/3 |
| INC-20 | Audit Explorer UI | completed | 1/1 |
| INC-21 | Billing Usage Read-Path Optimization | completed | 1/1 |

TEJ PIM is shipping at a healthy pace. `INCREMENT_STATE.json` shows 20 completed increments and a single active increment, `INC-08`, which is active only because release evidence is still aging, not because implementation work is missing (`docs/execution/INCREMENT_STATE.json`). Story locking is generally disciplined, especially in `INC-08` where all 20 stories are locked, though `INC-05` still shows one unlocked story despite the increment being marked complete.

The recent commit log is mostly forward motion on CI, release evidence, webhooks, and a small UI regression loop on the notification drawer (`git log --oneline -20`). That is acceptable, but it keeps delivery velocity at 4/5 instead of 5/5. The bigger delivery hygiene issue is documentation drift: `CURRENT_STATE.md` still claims the repo is at 2026-03-08 / HEAD `5a64683` (`docs/execution/CURRENT_STATE.md:3-4`), and `PRD.md` still carries a 2026-03-08 execution snapshot that no longer matches the live ledger (`docs/product/PRD.md:117-149`).

### 1.2 Risk register status

#### P0 risks

| Risk ID | Status | Remaining action |
|---|---|---|
| RISK-P0-001 | In Progress | Finish the 14-day controlled-rollout observation window and the matching SLO evidence window (`docs/execution/PROD_READINESS_RISK_REGISTER.md:7-45`). |
| RISK-P0-002 | Closed | None in the register; keep non-local auth hardening intact (`docs/execution/PROD_READINESS_RISK_REGISTER.md:58-75`). |
| RISK-P0-003 | Closed | None in the register; deploy smoke and post-deploy verification are in place (`docs/execution/PROD_READINESS_RISK_REGISTER.md:76-116`). |

#### P1 risks

| Risk ID | Status |
|---|---|
| RISK-P1-001 | Closed |
| RISK-P1-002 | Closed |
| RISK-P1-003 | Closed |
| RISK-P1-004 | Closed |

#### P2 risks

| Risk ID | Status |
|---|---|
| RISK-P2-001 | Closed |
| RISK-P2-002 | Closed |
| RISK-P2-003 | Closed |

From a PO lens, the register says the product is close: only `RISK-P0-001` is still open, and it is time-based. From a delivery-governance lens, that is good news. From a product-truth lens, it is incomplete: the code review found a P0 auth weakness that is not yet reflected in the register, so the register is directionally useful but not complete enough to be the only production-readiness signal.

### 1.3 Feature completeness

#### What is working well

- Workspace user management is now a real admin feature, not a governance placeholder. The API exposes list/create/role-change/lock/unlock/deactivate endpoints, and the `/admin/users` page renders a live user table plus invite and action controls (`apps/api/src/workspace-users/workspace-users.controller.ts:1-108`, `apps/api/src/workspace-users/workspace-users.service.ts:42-337`, `apps/web/src/app/admin/users/page.tsx:87-252`).
- The dashboard is a credible operating surface. The page assembles health, billing, operations, and slim product data in parallel, and the backend now uses stale-while-refresh for both dashboard health and catalog health to protect users from cold-path aggregates (`apps/web/src/app/dashboard/page.tsx:39-44`, `apps/api/src/dashboard/dashboard.service.ts:130-177`, `apps/api/src/dashboard/dashboard.service.ts:624-759`).
- Billing usage is no longer the old "recompute on every GET" design. `getUsageSummary()` reads the warm summary row first and only recomputes when the cached summary is stale or missing (`apps/api/src/billing/plan-usage.service.ts:257-278`, `apps/api/src/billing/plan-usage.service.ts:636-693`).
- Release safety is materially stronger than it was before. Staging deploys now run both the focused post-deploy trust-boundary check and the 30-check E2E smoke gate, while full E2E remains a separate nightly/on-demand workflow (`.github/workflows/deploy-staging.yml:16-122`, `.github/workflows/e2e-staging.yml:4-61`, `scripts/staging-postdeploy-check.cjs:56-139`).
- Public platform integration is taking shape. The OpenAPI contract now documents workspace-user admin routes, API-key admin routes, and outbound webhook admin routes (`docs/openapi.yaml:13-35`, `docs/openapi.yaml:1263-1324`, `docs/openapi.yaml:1969-2045`).

#### Gaps and concerns

- The login model is still anchored on a shared environment password, not per-user credentials. That means every `AuthIdentity` row behaves more like a role directory entry than a real user record, which weakens the credibility of password reset, step-up, and user-management flows (`apps/api/src/auth/auth.service.ts:308-327`, `apps/api/src/auth/auth.service.ts:861-872`, `packages/db/prisma/schema.prisma:519-532`).
- Password reset is exposed as a product feature, but the backend implementation only audits the request and returns success. I did not find token generation, email delivery, or password mutation in the reviewed repo (`apps/api/src/auth/auth.service.ts:402-419`, repo search for `requestPasswordReset` and `reset token`).
- Account export is exposed as a queued privacy action, but in the reviewed code it inserts a row into `account_export_requests` and reports `queued`; I did not find a worker or processor that fulfills the export (`apps/api/src/auth/auth.service.ts:477-527`, repo search for `account_export_requests`).
- Amazon India and Meesho still look live enough to confuse a user even though the backend implementations are partial or stubbed. That matters because the connector registry auto-registers all local connector implementations before database discovery and again if discovery returns zero active connectors (`apps/api/src/connector-framework/connector.registry.ts:35-68`, `apps/api/src/connectors/amazon/amazon.connector.ts:24-31`, `apps/api/src/connectors/meesho/meesho.connector.ts:19-26`).
- The user-guide index is stale in several places. It still marks `/admin/users` as "Read-only / navigation" even though the page is now a live admin surface (`docs/product/user-guide/PAGE_ACTION_PLAYBOOK_INDEX.md:12`).

### 1.4 UX review

#### Navigation and shell

The app shell is now materially better suited to a PIM. The authenticated layout uses a full-width grid with a fixed 260px sidebar and a flexible main pane, which is the right choice for catalog and operations-heavy screens (`apps/web/src/app/layout.tsx:40-43`). The sidebar itself is well-organized, and its badge fetch is not a chatty timer loop; it runs on route change through a `useEffect([pathname])` fetch (`apps/web/src/components/nav/app-sidebar.tsx:215-248`). That said, the internal navigation flag is still hardcoded as `showInternal={false}` in the root layout instead of being environment or role configurable (`apps/web/src/app/layout.tsx:42`).

#### Dashboard

The dashboard does a good job of giving a merchant or operator a first-stop operating view. The backend design is also better than it used to be: dashboard health and catalog health now return cached or stale values immediately and refresh in the background (`apps/api/src/dashboard/dashboard.service.ts:130-177`, `apps/api/src/dashboard/dashboard.service.ts:624-759`). The remaining UX risk is not correctness, it is fan-out cost: the page still waits on four server calls in parallel, including billing usage and a slim product list (`apps/web/src/app/dashboard/page.tsx:39-44`). The billing call is read-first now, which helps, but the page still depends on a set of non-trivial backend reads.

#### Product detail

`/products/[id]` is powerful, but it is still a god component. At 1285 lines, it owns tabs, metadata, channel readiness, export-job forms, validation, variant creation, and a large multi-fetch load path in one server component (`apps/web/src/app/products/[id]/page.tsx`, line count 1285; see `apps/web/src/app/products/[id]/page.tsx:60-94`, `apps/web/src/app/products/[id]/page.tsx:231-234`, `apps/web/src/app/products/[id]/page.tsx:783-1153`). From a PO lens, the good news is that the action model is clear. From a maintainability lens, the page is doing too much in one place.

#### Admin surfaces

The admin area is much stronger than it was before. `/admin/users` is now a real management surface with invite, role-change, lock, unlock, and deactivate actions layered on top of the previous governance cards (`apps/web/src/app/admin/users/page.tsx:87-252`). The product issue is no longer missing functionality; it is consistency. The live UI is ahead of the user-guide index, which still tells readers the page is read-only (`docs/product/user-guide/PAGE_ACTION_PLAYBOOK_INDEX.md:12`).

---

## Part 2 - CTO review

### 2.1 Auth and security

#### Critical findings

1. **P0: password verification is still a plain-text shared-secret comparison.** `verifyPassword()` reads `PIM_AUTH_PASSWORD` from the environment, falls back to `TEJ PIM-demo-password` in local auth mode, and compares the incoming password with `return password === expected;` (`apps/api/src/auth/auth.service.ts:861-872`). The step-up flow reuses the same method (`apps/api/src/auth/auth.service.ts:308-327`). There is no `passwordHash` in `AuthIdentity`; the schema only stores `userId`, `tenantKey`, `role`, `isActive`, and `lockedUntil` (`packages/db/prisma/schema.prisma:519-532`). This is not production-grade authentication.
2. **Password reset is not implemented as a real credential reset flow.** The exposed endpoint records an audit event and returns success, but I did not find reset token creation, email delivery, or password mutation (`apps/api/src/auth/auth.service.ts:402-419`, repo search for `requestPasswordReset` and `reset token`). In the current shared-password model, that mismatch is especially important because users cannot have independent secrets reset.
3. **Account export is queued but not obviously processed.** `requestAccountExport()` inserts into `account_export_requests`, marks the request queued, and records audit (`apps/api/src/auth/auth.service.ts:477-527`). I did not find a worker or queue consumer for those export jobs elsewhere in the reviewed repo. That makes the UI promise stronger than the implementation.

#### What is working well

- Login rate limiting and lockout mechanics are thoughtful. The service combines IP-scoped throttling with per-user temporary lockouts and supports Redis-backed state with an in-memory fallback when Redis is unavailable (`apps/api/src/auth/auth.service.ts:231-267`, `apps/api/src/auth/auth.service.ts:721-967`).
- Persistent account locking is real. `AuthIdentity.lockedUntil` is checked during login, so admin locks survive process restarts (`apps/api/src/auth/auth.service.ts:268-274`, `packages/db/prisma/schema.prisma:519-532`).
- JWT revocation is working. Logout adds the token to the blocklist, and the focused post-deploy smoke script explicitly checks that the revoked token returns 401 afterward (`apps/api/src/auth/auth.controller.ts:168-176`, `scripts/staging-postdeploy-check.cjs:103-139`).
- Environment hardening for staging and production is good. `env-validation.ts` rejects non-DB auth, non-BullMQ queue backends, disabled queue workers, and JSON-seeded auth identities in staging/production (`apps/api/src/common/env-validation.ts:124-149`).
- RBAC itself is simple and coherent. The role model is small, readable, and consistently reused by API and web helpers (`apps/api/src/common/rbac/roles.ts:1-6`, `apps/web/src/lib/role-capabilities.ts:3-16`).

### 2.2 Backend code quality

| Service | Lens | Verdict |
|---|---|---|
| `auth.service.ts` | 1026 lines | Functional, but too many responsibilities are packed into one file, and the credential model is the main production blocker. |
| `plan-usage.service.ts` | 717 lines | Large but coherent; the read-first cache path is a meaningful improvement over the old always-recompute shape. |
| `dashboard.service.ts` | 874 lines | Good caching strategy now, but still contains several heavy aggregates and raw SQL summaries in one class. |
| `catalog.service.ts` | 815 lines | Business logic is rich, yet list/search/completeness concerns are still tightly coupled. |
| `queue.service.ts` | 682 lines | Big, but the dual-backend design and BullMQ lane registry are well thought out. |
| `workspace-users.service.ts` | 369 lines | Cleanest service in the set; tenant scoping and audit coverage are strong. |

Specific checks:

- **`plan-usage.service.ts`:** `getUsageSummary()` is read-first now. It reads a warm summary row and returns it when fresh before falling back to recomputation (`apps/api/src/billing/plan-usage.service.ts:257-278`, `apps/api/src/billing/plan-usage.service.ts:636-693`). That known billing fix is genuinely present.
- **`dashboard.service.ts`:** the dashboard still makes real data calls, but it does so more safely than before. `getHealth()` uses `dashboard:health:v3`, `getCatalogHealth()` uses `dashboard:catalog-health:v2`, and both can serve stale data while a refresh happens in the background (`apps/api/src/dashboard/dashboard.service.ts:130-177`). `computeDashboardHealth()` still reads the latest snapshot, counts `pendingApprovals`, and loads trend rows (`apps/api/src/dashboard/dashboard.service.ts:624-707`), while `captureSnapshot()` still recomputes readiness, catalog health, total SKUs, and validation issue aggregates (`apps/api/src/dashboard/dashboard.service.ts:756-829`).
- **Pending approvals indexing:** `computeDashboardHealth()` counts products by `status: in_review` (`apps/api/src/dashboard/dashboard.service.ts:628-633`). The schema has `@@index([status])` and tenant-oriented product indexes, but it does not have a dedicated `(tenantKey, status)` composite index (`packages/db/prisma/schema.prisma:170-175`). Current scale is probably fine, but that is the next obvious index if approval counts become hot.
- **`catalog.service.ts`:** the slim projection is real. `listProductsSlim()` fetches a narrower field set, then enriches with completeness scores and grouped issue counts (`apps/api/src/catalog/catalog.service.ts:124-204`). The tradeoff is that completeness still happens in app code via `attachCompletenessScores()`, so the slim route is slimmer than full list, but not cheap in absolute terms (`apps/api/src/catalog/catalog.service.ts:800-815`).
- **`queue.service.ts`:** the dual-backend design is solid. The service clearly separates memory and BullMQ paths, maintains lane registries in Redis, and exposes metrics cleanly (`apps/api/src/queue/queue.service.ts:146-226`, `apps/api/src/queue/queue.service.ts:593-727`). Combined with environment validation, this is a good controlled-rollout queue story.
- **`connector.registry.ts`:** the empty-table and discovery-failure fallback is still too permissive. The registry registers all local implementations before discovery and again if discovery returns zero active connectors (`apps/api/src/connector-framework/connector.registry.ts:35-68`). That makes stub connectors easier to expose than they should be.
- **`workspace-users.service.ts`:** the tenant scoping pattern is correct. It consistently uses tenant-scoped `authIdentity` Prisma access, and every mutation records audit (`apps/api/src/workspace-users/workspace-users.service.ts:48-337`). This is the clearest recent backend slice.

### 2.3 Connector readiness

| Connector | Slug | Declared capabilities | `validateCredentials()` | `publishProduct()` | `syncSubmissionStatus()` | Launch readiness verdict |
|---|---|---|---|---|---|---|
| Amazon India | `amazon-in` | `PUBLISH`, `VALIDATE`, `STATUS_SYNC`, `WEBHOOK_RECEIVE` (`apps/api/src/connectors/amazon/amazon.connector.ts:24-31`) | Stub that returns `true` (`apps/api/src/connectors/amazon/amazon.connector.ts:35-38`) | Not implemented (`apps/api/src/connectors/amazon/amazon.connector.ts:94-103`) | Not implemented (`apps/api/src/connectors/amazon/amazon.connector.ts:127-131`) | **Not launch-ready.** Surface should be hidden or clearly marked experimental until real auth/publish/status flows land. |
| Flipkart | `flipkart` | `PUBLISH`, `VALIDATE`, `STATUS_SYNC` (`apps/api/src/connectors/flipkart/flipkart.connector.ts:100-106`) | Real token-based validation (`apps/api/src/connectors/flipkart/flipkart.connector.ts:122-137`) | Implemented (`apps/api/src/connectors/flipkart/flipkart.connector.ts:233-284`) | Implemented (`apps/api/src/connectors/flipkart/flipkart.connector.ts:344-348`) | **Best current connector.** Credible for controlled rollout and the only one that looks materially complete. |
| Meesho | `meesho` | `VALIDATE`, `EXCEL_EXPORT` (`apps/api/src/connectors/meesho/meesho.connector.ts:19-26`) | Stub that returns `true` (`apps/api/src/connectors/meesho/meesho.connector.ts:28-31`) | Not applicable by design | No status-sync path in the connector contract usage here | **Partial/manual model only.** Export-only intent is reasonable, but export generation is still not implemented (`apps/api/src/connectors/meesho/meesho.connector.ts:62-74`). |

Overall connector readiness is 2/5 because the registry can still expose connectors that are not operationally honest. If the launch scope is Flipkart-centric, that is manageable. If Amazon or Meesho are expected to be live seller paths, it is not.

### 2.4 Frontend code quality

Specific checks:

- **`products/[id]/page.tsx`:** yes, it is still a god component. The file is 1285 lines long and mixes tab state, data loading, channel actions, validation, export-job handling, and variant creation in one place (`apps/web/src/app/products/[id]/page.tsx`, line count 1285; see `apps/web/src/app/products/[id]/page.tsx:60-94`, `apps/web/src/app/products/[id]/page.tsx:231-234`, `apps/web/src/app/products/[id]/page.tsx:783-1153`).
- **`layout.tsx`:** `showInternal` is still hardcoded off in the authenticated shell (`apps/web/src/app/layout.tsx:40-43`). That is a clean default for sellers, but it is not configurable.
- **`app-sidebar.tsx`:** the badge pattern is route-change driven, not a timer poll. That is better than chatty polling, though it still forces a no-store request on each navigation (`apps/web/src/components/nav/app-sidebar.tsx:222-248`).
- **`api.ts`:** `getWorkspaceUsers()` and the rest of the workspace-user helpers do exist post-`df40d7f` (`apps/web/src/lib/api.ts:1286-1319`). The tradeoff is file size: `api.ts` is now 1847 lines and should be split by domain.

### 2.5 Test coverage

The test story is one of the repo's strongest areas.

- The API integration inventory contains **64** suites under `apps/api/test/integration/`.
- The E2E suite currently registers **18 sections and 121 checks** in dry-run mode (`node scripts/e2e-user-journey.cjs --dry-run`).
- The risk register records the last green full staging E2E run at **107/121 pass, 0 fail, 14 skip, 269.5s** and the smoke E2E run at **28/30 pass, 0 fail, 2 skip, 69.7s** (`docs/execution/PROD_READINESS_RISK_REGISTER.md:42-44`).
- The deploy gate now includes the smoke suite and the focused post-deploy trust-boundary script (`.github/workflows/deploy-staging.yml:81-122`, `scripts/staging-postdeploy-check.cjs:56-139`).

Coverage gaps still worth calling out:

- The tests do not catch the shared plain-text password architecture because they validate the current behavior, not a secure credential model.
- Password reset delivery is not proven end to end, because there is no visible delivery implementation to prove.
- Account export fulfillment is not proven end to end; only the request and status-read shape are visible in code and tests.
- The E2E suite still contains a stale webhook skip even though `RISK-P2-001` is now marked closed (`scripts/e2e-user-journey.cjs:1950-1951`).

### 2.6 Infrastructure and scalability

**Redis usage map**

- `auth.service.ts`: Redis-backed rate limiting and user lock state with memory fallback (`apps/api/src/auth/auth.service.ts:721-967`).
- `dashboard.service.ts`: Redis-backed caching for readiness, catalog health, dashboard health, and ops summaries, with in-memory fallback outside production (`apps/api/src/dashboard/dashboard.service.ts:85-177`).
- `queue.service.ts`: BullMQ plus Redis lane-registry bookkeeping (`apps/api/src/queue/queue.service.ts:593-727`).

**Queue backend**

- The repo has the right controlled-rollout posture: staging/production must use `QUEUE_BACKEND=bullmq` and `QUEUE_WORKER_ENABLED=true` (`apps/api/src/common/env-validation.ts:124-149`).
- The deploy smoke script explicitly checks that those settings are alive after deploy (`scripts/staging-postdeploy-check.cjs:56-59`).

**Database indexes**

The schema is in better shape than it was before. Important coverage includes:

- `Product`: category, status, tenant, deletedAt, and tenant/deletedAt/updatedAt/id composite (`packages/db/prisma/schema.prisma:170-175`).
- `PlanUsage`: unique and indexed `(tenantKey, month)` (`packages/db/prisma/schema.prisma:473-487`).
- `AuthIdentity`: tenant/role/isActive and tenant/createdAt/id composite (`packages/db/prisma/schema.prisma:519-531`).
- `ApiAccessKey`: tenant/createdAt and tenant/revokedAt/expiresAt composites (`packages/db/prisma/schema.prisma:534-549`).
- `OutboundWebhookDelivery`: tenant/endpoint/createdAt and tenant/event/status/createdAt composites (`packages/db/prisma/schema.prisma:600-618`).

**Known bottlenecks and tradeoffs**

- Billing usage is substantially improved because it is now read-first, not recompute-first (`apps/api/src/billing/plan-usage.service.ts:257-278`, `apps/api/src/billing/plan-usage.service.ts:636-693`).
- Dashboard health and catalog health avoid cold-path blocking by serving stale values and refreshing in the background (`apps/api/src/dashboard/dashboard.service.ts:130-177`, `apps/api/src/dashboard/dashboard.service.ts:624-759`).
- Catalog slim list is genuinely slimmer, but the completeness-scoring pass is still app-side work that scales with the page size and category-attribute mix (`apps/api/src/catalog/catalog.service.ts:124-204`, `apps/api/src/catalog/catalog.service.ts:800-815`).
- The deploy workflow concurrency settings are still conservative rather than throughput-optimized: the group is hardcoded to `deploy-staging` and `cancel-in-progress` is false (`.github/workflows/deploy-staging.yml:16-18`). That is safe, but it can leave stale deploys running longer than necessary.

---

## Part 3 - Prioritised action list

### P0 - Must fix before production

| # | Action | Owner | File | Blocking what |
|---|---|---|---|---|
| 1 | Replace shared environment-password auth with per-user hashed credentials, and update step-up to verify the stored hash instead of `PIM_AUTH_PASSWORD`. | Backend Lead + Security | `apps/api/src/auth/auth.service.ts`, `packages/db/prisma/schema.prisma` | Broad production sign-off and any credible multi-user security posture |
| 2 | Turn password reset and unlock flows into real delivery-backed credential recovery, or remove the self-service promise until it exists. | Backend Lead + Web Lead | `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/auth.controller.ts`, auth UI pages | Production auth completeness and user support burden |
| 3 | Make account export executable end to end with a worker/processor, or downgrade the feature from "queued export" to an internal/admin-only process until fulfillment exists. | Backend Lead + Compliance | `apps/api/src/auth/auth.service.ts`, queue worker surface not yet present in reviewed repo | Privacy/compliance readiness |
| 4 | Finish the remaining 14-day controlled-rollout and SLO evidence window, then refresh the release docs one final time. | DevOps + Engineering Lead | `docs/execution/PROD_READINESS_RISK_REGISTER.md`, `docs/execution/INCREMENT_STATE.json`, `docs/execution/rollout/` | Formal production declaration |

### P1 - Before broad pilot

| # | Action | Owner | File |
|---|---|---|---|
| 1 | Split `products/[id]/page.tsx` into domain subcomponents or route-segment modules so product detail changes stop carrying page-wide risk. | Web Lead | `apps/web/src/app/products/[id]/page.tsx` |
| 2 | Split `apps/web/src/lib/api.ts` by domain and extract shared fetch primitives so admin/catalog/dashboard changes stop coupling through one 1847-line client file. | Web Lead | `apps/web/src/lib/api.ts` |
| 3 | Harden connector discovery so empty-table or discovery-failure fallback does not automatically surface stub connectors. | Backend Lead | `apps/api/src/connector-framework/connector.registry.ts` |
| 4 | Hide or explicitly label Amazon India and Meesho seller flows until their connector implementations are operationally honest. | Product + Backend + Web | `apps/api/src/connectors/amazon/amazon.connector.ts`, `apps/api/src/connectors/meesho/meesho.connector.ts`, connector UI surfaces |
| 5 | Refresh stale canonical docs that new engineers are likely to trust first. | Product Ops + Engineering | `docs/execution/CURRENT_STATE.md`, `docs/product/PRD.md`, `docs/product/user-guide/PAGE_ACTION_PLAYBOOK_INDEX.md`, `docs/architecture/enterprise-docs/DOCUMENT_REPOSITORY_INDEX.txt`, `docs/architecture/enterprise-docs/DOCUMENT_02_PIM_Domain_Model.txt` |

### P2 - Next increment window

| # | Action | Owner | File |
|---|---|---|---|
| 1 | Publish a real legal/compliance document set: Terms, Privacy Policy, DPA, retention policy, and SLA/Uptime statement. | Product + Legal + CTO | `docs/legal/` |
| 2 | Add a dedicated security threat model and an incident/on-call guide instead of relying on generated enterprise-doc placeholders. | CTO + Security + DevOps | `docs/architecture/`, `docs/runbooks/` |
| 3 | Clean up stale generated or scripted documentation so the user guides match the current live product surface. | Product Ops | `docs/product/user-guide/`, `docs/architecture/enterprise-docs/` |
| 4 | Remove stale skips from the E2E suite and extend end-to-end proof for privacy export fulfillment once the worker exists. | QA + Backend | `scripts/e2e-user-journey.cjs` |

---

## Part 4 - Documentation gap analysis

| Document | Standard? | Exists in TEJ PIM? | Path or gap |
|---|---|---|---|
| Product requirements (PRD) | yes | yes | `docs/product/PRD.md` |
| Product roadmap | yes | partial | Increment ledger exists in `docs/execution/INCREMENT_STATE.json`, but there is no dedicated roadmap document. |
| Release notes | yes | no | No dedicated seller-facing or engineering release-notes document found in `docs/`. |
| System architecture | yes | yes | `docs/architecture/TEJ_PIM_Final_Architecture_March2026_v3.docx`, `docs/architecture/enterprise-docs/DOCUMENT_07_System_Architecture.txt` |
| Data model | yes | yes | `packages/db/prisma/schema.prisma`; generated companion doc exists at `docs/architecture/enterprise-docs/DOCUMENT_02_PIM_Domain_Model.txt` but is stale. |
| API reference | yes | yes | `docs/openapi.yaml`, `docs/openapi.json` |
| ADRs | yes | yes | `docs/decisions/` |
| Security threat model | yes | no | No dedicated threat-model document found. |
| Local dev setup | yes | yes | `README.md:19-49`, plus `docs/architecture/enterprise-docs/DOCUMENT_09_Deployment_Guide.txt` |
| Incident response runbook | yes | partial | Incident handling is mentioned in `docs/product/FIRST_SELLER_ONBOARDING_PLAYBOOK.md`, but no dedicated incident-response runbook exists. |
| Auth bootstrap runbook | yes | yes | `docs/runbooks/auth-bootstrap-admin.md` |
| Key rotation runbook | yes | yes | `docs/runbooks/credential-key-rotation.md` |
| On-call / monitoring guide | yes | partial | Generated ops guide exists at `docs/architecture/enterprise-docs/DOCUMENT_10_Operations_Guide.txt`, but there is no dedicated on-call guide. |
| Seller onboarding guide | yes | yes | `docs/product/FIRST_SELLER_ONBOARDING_PLAYBOOK.md` |
| Seller user guide | yes | yes | `docs/product/user-guide/TEJ_PIM_MASTER_USER_GUIDE.md` |
| Channel setup guides | yes | yes | Connector and channel playbooks under `docs/product/user-guide/playbooks/` |
| FAQ / troubleshooting | yes | no | No dedicated FAQ or troubleshooting guide found. |
| Seller release notes | yes | no | No seller release-notes document found. |
| Terms of service | yes | no | `docs/legal/` is missing. |
| Privacy policy | yes | no | `docs/legal/` is missing. |
| Data retention policy | yes | partial | Requirements exist in `docs/product/PRD.md` and operational controls exist in `docs/runbooks/test-data-governance.md`, but there is no formal policy document. |
| Data processing agreement | yes | no | `docs/legal/` is missing. |
| SLA / uptime commitment | yes | no | `docs/architecture/enterprise-docs/DOCUMENT_07_System_Architecture.txt` notes the formal SLO/SLA definition gap. |

---

## Appendix - Files reviewed

| File | Line count | Key finding |
|---|---|---|
| `docs/execution/INCREMENT_STATE.json` | 2121 | Canonical increment ledger; only INC-08 remains active and it is evidence-bound. |
| `docs/execution/PROD_READINESS_RISK_REGISTER.md` | 238 | Current readiness register; only rollout evidence window remains open in the document. |
| `docs/execution/CURRENT_STATE.md` | 86 | Canonical snapshot file is stale versus current HEAD and release state. |
| `docs/openapi.yaml` | 2280 | OpenAPI contract is real and includes workspace users, API keys, and webhooks. |
| `packages/db/prisma/schema.prisma` | 553 | Schema is current and shows the real auth, queue, API-key, and webhook models. |
| `apps/api/src/auth/auth.service.ts` | 1026 | Strong lockout and JWT logic, but password verification is still a plain-text shared-secret check. |
| `apps/api/src/auth/auth.controller.ts` | 189 | Auth surface is broad and consistent, covering login, consent, privacy, logout, and step-up. |
| `apps/api/src/common/rbac/roles.ts` | 6 | Simple four-role model reused consistently across API and web. |
| `apps/api/src/common/env-validation.ts` | 157 | Staging and production env validation is strong, especially for DB auth and BullMQ. |
| `apps/api/src/billing/plan-usage.service.ts` | 717 | Billing usage read path is now cache-first instead of recompute-first. |
| `apps/api/src/dashboard/dashboard.service.ts` | 874 | Dashboard uses stale-while-refresh caching to hide heavy cold-path aggregates. |
| `apps/api/src/catalog/catalog.service.ts` | 815 | Slim list projection is real, though completeness scoring still adds app-side work. |
| `apps/api/src/queue/queue.service.ts` | 682 | Queue service has a solid dual-backend design with BullMQ lane registry support. |
| `apps/api/src/workspace-users/workspace-users.service.ts` | 369 | Clean tenant-scoped admin user lifecycle service with strong audit coverage. |
| `apps/api/src/workspace-users/workspace-users.controller.ts` | 108 | Admin-only user-management API is live and coherent. |
| `apps/api/src/connector-framework/connector.interface.ts` | 185 | Connector contract is rich, though comment encoding is corrupted in places. |
| `apps/api/src/connectors/amazon/amazon.connector.ts` | 119 | Amazon India connector is still mostly stubbed despite publish/status/webhook capabilities. |
| `apps/api/src/connectors/flipkart/flipkart.connector.ts` | 861 | Flipkart connector is the most operationally complete of the current connectors. |
| `apps/api/src/connectors/meesho/meesho.connector.ts` | 70 | Meesho remains an export-only partial connector with stubbed validation/export generation. |
| `apps/api/src/connector-framework/connector.registry.ts` | 78 | Registry fallback is still permissive and can surface local stub connectors. |
| `apps/web/src/app/layout.tsx` | 49 | Full-width authenticated shell is in place; internal nav toggle is still hardcoded. |
| `apps/web/src/components/nav/app-sidebar.tsx` | 283 | Sidebar structure is solid; badge fetch happens on route change rather than timer polling. |
| `apps/web/src/app/dashboard/page.tsx` | 378 | Dashboard UX is coherent but still fans out to several backend reads. |
| `apps/web/src/app/products/[id]/page.tsx` | 1285 | Reviewed as part of the requested documentation inventory. |
| `apps/web/src/app/admin/users/page.tsx` | 347 | Admin users page is now live and action-oriented, not static. |
| `apps/web/src/lib/api.ts` | 1847 | API client covers current features, but the file is too large and should be split by domain. |
| `apps/web/src/lib/role-capabilities.ts` | 13 | Role helper logic is simple and aligned with the RBAC model. |
| `.github/workflows/deploy-staging.yml` | 144 | Deploy workflow now includes focused post-deploy checks plus E2E smoke gating. |
| `.github/workflows/e2e-staging.yml` | 96 | Nightly and on-demand staging E2E workflow is independent from deploy. |
| `scripts/e2e-user-journey.cjs` | 2074 | Comprehensive E2E harness with dry-run, smoke mode, and JSON result output; one stale webhook skip remains. |
| `scripts/staging-postdeploy-check.cjs` | 140 | Focused post-deploy trust-boundary and queue-health validator. |
| `docs/runbooks/auth-bootstrap-admin.md` | 15 | Runbook present; operational coverage is strongest in bootstrap, key rotation, and test-data governance. |
| `docs/runbooks/credential-key-rotation.md` | 23 | Runbook present; operational coverage is strongest in bootstrap, key rotation, and test-data governance. |
| `docs/runbooks/test-data-governance.md` | 38 | Runbook present; operational coverage is strongest in bootstrap, key rotation, and test-data governance. |
| `docs/product/FIRST_SELLER_ONBOARDING_PLAYBOOK.md` | 66 | Concrete onboarding guide with operational roles and stop conditions. |
| `docs/product/PRD.md` | 126 | Canonical PRD exists, but the embedded execution snapshot is stale. |
| `docs/product/PRD_SOURCES.md` | 41 | Useful source-of-truth index for product docs. |
| `docs/product/user-guide/FUNCTIONALITY_WISE_GUIDE.md` | 109 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/PAGE_ACTION_PLAYBOOK_INDEX.md` | 51 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/PAGE_GUIDE_INDEX.md` | 57 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/TEJ_PIM_MASTER_USER_GUIDE.md` | 2185 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/README.md` | 13 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_admin_audit_page_tsx.md` | 16 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_admin_connectors_page_tsx.md` | 23 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_admin_page_tsx.md` | 16 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_admin_plan_page_tsx.md` | 20 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_admin_privacy_page_tsx.md` | 16 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_admin_users_page_tsx.md` | 19 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_admin_workspace_page_tsx.md` | 16 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_ai_page_tsx.md` | 24 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_catalog_attributes_page_tsx.md` | 23 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_catalog_categories_page_tsx.md` | 20 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_catalog_media_page_tsx.md` | 16 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_catalog_page_tsx.md` | 16 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_catalog_products_page_tsx.md` | 21 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_channels_connectors_page_tsx.md` | 29 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_channels_connectors__installationid__page_tsx.md` | 22 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_channels_health_page_tsx.md` | 18 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_channels_mappings_page_tsx.md` | 45 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_channels_page_tsx.md` | 20 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_channels_submissions_page_tsx.md` | 18 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_connectors_page_tsx.md` | 16 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_connectors__installationid__mapping_page_tsx.md` | 21 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_consent_page_tsx.md` | 16 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_dashboard_page_tsx.md` | 24 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_internal_developer_page_tsx.md` | 16 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_login_locked_page_tsx.md` | 16 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_login_page_tsx.md` | 16 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_login_reset_page_tsx.md` | 16 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_media_page_tsx.md` | 27 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_ondc_page_tsx.md` | 27 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_operations_bulk-edit_page_tsx.md` | 23 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_operations_imports_page_tsx.md` | 19 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_operations_jobs_page_tsx.md` | 19 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_operations_page_tsx.md` | 20 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_operations_repair_page_tsx.md` | 19 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_page_tsx.md` | 16 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_products__id__page_tsx.md` | 45 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_quality_approvals_page_tsx.md` | 21 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_quality_completeness_page_tsx.md` | 19 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_quality_issues_page_tsx.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_quality_page_tsx.md` | 20 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_quality_validation_page_tsx.md` | 19 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_rejection_page_tsx.md` | 21 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_reports_page_tsx.md` | 16 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_settings_connectors_page_tsx.md` | 16 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_settings_page_tsx.md` | 16 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_settings_plan_page_tsx.md` | 16 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/pages/_settings_privacy_page_tsx.md` | 16 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/admin_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/admin__audit_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/admin__connectors_playbook.md` | 44 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/admin__plan_playbook.md` | 35 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/admin__privacy_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/admin__users_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/admin__workspace_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/ai_playbook.md` | 35 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/catalog_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/catalog__attributes_playbook.md` | 35 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/catalog__categories_playbook.md` | 35 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/catalog__media_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/catalog__products_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/channels_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/channels__connectors_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/channels__connectors___installationId__playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/channels__health_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/channels__mappings_playbook.md` | 73 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/channels__submissions_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/connectors_playbook.md` | 62 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/connectors___installationId___mapping_playbook.md` | 27 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/consent_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/dashboard_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/internal__developer_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/login_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/login__locked_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/login__reset_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/media_playbook.md` | 44 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/ondc_playbook.md` | 44 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/operations_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/operations__bulk-edit_playbook.md` | 44 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/operations__imports_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/operations__jobs_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/operations__repair_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/products___id__playbook.md` | 91 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/quality_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/quality__approvals_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/quality__completeness_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/quality__issues_playbook.md` | 35 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/quality__validation_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/rejection_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/reports_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/root_page_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/settings_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/settings__connectors_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/settings__plan_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/product/user-guide/playbooks/settings__privacy_playbook.md` | 25 | Extensive user documentation exists, but freshness is mixed and some entries lag the live UI. |
| `docs/architecture/TEJ_PIM_Connector_First_Redesign_March2026.docx` | - | Binary architecture document present; good for distribution, less useful for diff-driven review. |
| `docs/architecture/TEJ_PIM_Final_Architecture_March2026_v3.docx` | - | Binary architecture document present; good for distribution, less useful for diff-driven review. |
| `docs/architecture/enterprise-docs/DOCUMENT_01_Product_Overview.txt` | 70 | Generated architecture reference present; useful, but freshness varies by file. |
| `docs/architecture/enterprise-docs/DOCUMENT_02_PIM_Domain_Model.txt` | 54 | Generated domain-model doc is stale and no longer matches the live AuthIdentity schema. Generated architecture reference present; useful, but freshness varies by file. |
| `docs/architecture/enterprise-docs/DOCUMENT_03_Catalog_Modeling_Guide.txt` | 52 | Generated architecture reference present; useful, but freshness varies by file. |
| `docs/architecture/enterprise-docs/DOCUMENT_04_User_Guide.txt` | 85 | Generated architecture reference present; useful, but freshness varies by file. |
| `docs/architecture/enterprise-docs/DOCUMENT_05_API_Documentation.txt` | 138 | Generated architecture reference present; useful, but freshness varies by file. |
| `docs/architecture/enterprise-docs/DOCUMENT_06_Integration_Architecture.txt` | 47 | Generated architecture reference present; useful, but freshness varies by file. |
| `docs/architecture/enterprise-docs/DOCUMENT_07_System_Architecture.txt` | 63 | Generated architecture reference present; useful, but freshness varies by file. |
| `docs/architecture/enterprise-docs/DOCUMENT_08_Data_Architecture.txt` | 70 | Generated architecture reference present; useful, but freshness varies by file. |
| `docs/architecture/enterprise-docs/DOCUMENT_09_Deployment_Guide.txt` | 64 | Generated architecture reference present; useful, but freshness varies by file. |
| `docs/architecture/enterprise-docs/DOCUMENT_10_Operations_Guide.txt` | 40 | Generated architecture reference present; useful, but freshness varies by file. |
| `docs/architecture/enterprise-docs/DOCUMENT_11_Implementation_Playbook.txt` | 53 | Generated architecture reference present; useful, but freshness varies by file. |
| `docs/architecture/enterprise-docs/DOCUMENT_REPOSITORY_INDEX.txt` | 48 | Generated architecture index is stale and points at an older HEAD. Generated architecture reference present; useful, but freshness varies by file. |
| `docs/legal/` | - | Missing directory; formal legal/compliance documents are not present in the repo. |
