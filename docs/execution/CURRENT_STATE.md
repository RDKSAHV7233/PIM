# Vexa PIM Current State

> **V7 Addendum (2026-05-20) — All 11 PRs merged; main CI green; Deploy Staging unblocked.**
>
> **Sprint closure complete.** All Gate C enterprise features are live on `main`. Enterprise
> signoff is **unblocked** — no further engineering required per V6 addendum.
>
> **Merge sequence (in order, all squash-merged):**
> | PR | Title | SHA |
> |----|-------|-----|
> | #109 | fix(web): remove duplicate OIDC exports | `dd789c8` |
> | #95 | fix(ondc): explicit tenant_key in raw SQL | `04c0552` |
> | #96 | feat(deploy): Railway production deploy pipeline | `53cd926` |
> | #97 | fix(flipkart): INC-10 ORM conversion | `4963167` |
> | #102 | test(gates): full 96/96 integration coverage | `18ea7e1` |
> | #103 | feat(meesho): validation and Excel export | `fd92b06` |
> | #104 | fix(shopify): BUG-1 multi-variant + image | `f334a76` |
> | #111 | feat(workflow): RG-C5 collaboration + SLA model | `544cefb` |
> | #110 | feat(catalog): RG-C4 product relationships | `e887e3b` |
> | #108 | feat(catalog): RG-C6 enterprise search | `c97c399` |
> | #112 | fix(deploy): scope backfill to STAGING_SMOKE_TENANT_ID | `b9b796d` |
>
> **Post-merge CI state (HEAD `b9b796d`):**
> - CI workflow: ✅ success
> - Deploy Staging: was ❌ failure on `c97c399` (backfill step lacked `--tenant` after
>   `assertTenantScope` guard landed in PR #96); fixed by PR #112 and now unblocked.
>
> **Open PRs:** 0
>
> **What is now live on main:**
> - RG-C4: Product relationships, bundles, kits — full CRUD + tenant isolation + migration `000007`
> - RG-C5: Workflow collaboration + SLA — change requests, SLA config, overdue count + migration `000006`
> - RG-C6: Enterprise search — faceted filters (status/brand/category/channel/full-text), cursor pagination, 7-assertion proof
> - Meesho: local validation rules + Excel export (xlsx magic bytes)
> - Shopify: BUG-1 multi-variant `optionValues` + image filename fix
> - 96/96 integration gates consolidated and passing in CI
> - Railway production deploy pipeline (promote-stage3) with `assertTenantScope` guard
> - ONDC raw SQL tenant isolation
> - Flipkart INC-10 ORM conversion
>
> **Immediate next priorities (engineering backlog):**
> 1. Fresh staging rollout snapshot with `observationWindowDaysCovered` _(target 2026-05-21)_
> 2. `gate:run:sprint` executed on staging _(target 2026-05-23)_
> 3. Enterprise customer demo prep — RG-C4/C5/C6 feature tour against staging
> 4. Promote-stage3 workflow first live run to production (gated on staging gate signoff)

> **V6 Addendum (2026-05-19) — Gate C implementation complete; CI-green; awaiting merge.**
>
> **All three Gate C enterprise feature PRs have CI-passing implementations in `bhoivishal216-ai/PIM1`:**
> - PR #110 (`feat/product-relationships-rg-c4`) — RG-C4: product relationships (bundles, kits, accessories, cross-sell). Schema + migrations + API + tenant isolation test. CI: ✅ success.
> - PR #111 (`feat/workflow-collab-rg-c5`) — RG-C5: workflow collaboration + SLA model (change requests, SLA config, overdue count). CI: ✅ success.
> - PR #108 (`feat/rg-c6-enterprise-search`) — RG-C6: enterprise-scale search — faceted filters (status, brand, category, channel, free-text OR), cursor pagination, 7-assertion integration proof. CI: ✅ success.
> - PR #109 (`fix/web-lint-oidc-and-kpi-channel`) — prerequisite web lint fixes. CI: ✅ success.
>
> **Repo migrated:** `RDKSAHV7233/PIM1` → `bhoivishal216-ai/PIM1` to restore GitHub Actions billing.
> All 10 open PRs live with fresh CI runs. PRs #95, #96, #97, #102, #103, #104 CI runs in-progress.
>
> **Updated posture:**
> - Enterprise signoff is **merge-blocked** (not "not scheduled") — RG-C4/C5/C6 are implemented, CI-green, pending PR merge.
> - "Enterprise-ready" claim remains **Forbidden** until all three PRs land on `main`.
> - Approved merge order: `#109 → #95 → #96 → #97 → #102 → #103 → #104 → #111 → #110 → #108`
> - When PRs merge, enterprise signoff unblocks with no further engineering required.

> **V4 Addendum (2026-05-17, evening) — supersedes V3 release posture below.**
>
> **Authoritative PO sign-off:** [PO_SIGNOFF_CONTROLLED_PILOT_V4_2026-05-17.md](./PO_SIGNOFF_CONTROLLED_PILOT_V4_2026-05-17.md). V3 is superseded.
>
> **Engineering pass complete (CTO Execution Memo 2026-05-17):**
> - PR #71 merged (worktree base `f6f9ce2`). Main HEAD includes `66bd13e` (ledger sync) and `5304ffe` (PR #72: CTO verification fixes).
> - Web tests at **111/111 passing** (was 110 in V3 snapshot; one net test added).
> - AuditLog composite index `idx_audit_logs_tenant_resource_action_created` added via migration `20260517000002_auditlog_resource_action_index` to support product revision and activity queries at scale.
> - `approval-comments` and `product-activity-timeline` integration tests wired as named npm scripts and as gated steps in `scripts/run-increment-gates.cjs`.
> - Meesho UI corrected to honestly disclose `In Development` status; export action guarded server-side.
> - `.env.staging` converted to deprecation stub; `.env.staging.example` is the canonical template.
> - Operations KPI counts now display `<limit>+` honestly when at the window cap.
> - ADRs 005–010 filed: revisions-from-audit-log, allowFailure sunset policy, JSON attribute blob acceptance, billing operator-mediated, Smart Suggestions rule-based, OIDC opt-in.
> - AuditLog retention policy drafted: `docs/runbooks/audit-log-retention.md`.
>
> **What this changes in approved claims:**
> - **Approval comments** — moved to Approved (was Forbidden in V3). Model + API + UI + test all proven.
> - **Product activity timeline** — moved to Approved. Endpoint + service + tab + test all proven.
> - **OIDC SSO login (bounded)** — added to Approved with operator-mediated configuration disclosure.
> - **Browser-only live Shopify proof** — added to Forbidden (script-assisted only; no recorded session committed).
> - **OIDC fully enforced** — explicitly added to Forbidden pending admin UI.
> - **"100+ products published to Shopify"** — added to Forbidden pending recorded session.
>
> **Outstanding engineering before broader-production claim:**
> - INC-10 Flipkart publish loop closure (removes `allowFailure=true` from idempotency gate). Target 2026-06-07. Structural audit (2026-05-17): the two credential-path `$queryRawUnsafe` sites cited in the reopened-reason have been refactored to Prisma ORM; only `noteCredentialWarning` retains raw SQL (tenant-filtered, low risk). `allowFailure=true` may be stale — connector lead should run the test against live Postgres to confirm.
> - ~~OIDC admin IdP configuration UI.~~ **Shipped in PR #76 (2026-05-17)** — `/admin/auth-policy/oidc` with `auth_config_high_risk` step-up scope. "OIDC enforced" remains Forbidden per PO V4 (Gate C required).
> - Fresh staging rollout snapshot with full `observationWindowDaysCovered` schema field. Target 2026-05-21.
> - `gate:run:sprint` executed on staging. Target 2026-05-23.
>
> The V3-era posture below is preserved for historical reference. Where V3 conflicts with V4, **V4 wins.**

- Date: 2026-05-18
- Repo HEAD: main — PR #71 merged (INC-36 localization schema + INC-39 OIDC SSO); PR #72 merged (CTO verification fixes); PR #73 merged (ST-CON-METRICS-001 connector KPI dashboard); PR #74 merged (OIDC self-serve admin UI); PR #75 merged (Railway staging recovery — web/API connectivity, deploy hardening); PR #76 merged (AuditLog index, Meesho honest UI, OIDC step-up hardening — v0.9.0-pilot tagged); PR #77 merged (zero-downtime staging deploy via preDeployCommand — RISK-P1-005 closed)
- Scope: current code, current validation output, sellability proof slices, Large Import Mode MVP, release-governance state, hosting runbooks (3-stage), connector platform (PR #65 merged), Gate C enterprise increments (INC-35 RBAC + INC-36 localization + INC-39 OIDC all merged), connector KPI trends dashboard, OIDC self-serve IdP configuration with auth_config_high_risk step-up scope, AuditLog composite index, Meesho in-development UI, PO V4 sign-off, zero-downtime staging deploys
- Naming note: customer-facing product brand is `Vexa PIM`; legacy repo/package/env identifiers still use `PIM1`

## 1. Current Truth Summary

- Staging deploy downtime on merge-to-main is resolved. `preDeployCommand` now runs Prisma migrations in a separate Railway container while the old app container keeps serving traffic. New container starts clean, passes healthcheck in ~5s, then Railway switches traffic and drains the old container. Zero-downtime deploy confirmed achievable on Railway Starter (no plan upgrade required). RISK-P1-005 closed.
- Targeted code-level production-readiness blockers around web JWT/session fail-closed behavior, privileged internal route trust boundaries, web build/increment gate stability, submissions and DLQ count honesty, readiness proxy failure masking, and catalog products pagination have been closed in the current repo state.
- Large Import Mode MVP is now implemented as an additive path for single-file CSV imports from `10,001` to `30,000` rows, with one parent run, one unified repair/result flow, and one combined error report.
- The safe claim boundary for imports is now explicit: standard CSV/JSON imports remain capped at `10,000` rows; large mode is CSV-only and blocks files above `30,000` rows.
- Sellability slices for revision-backed approvals, validate-before-import, responsive/accessibility hardening, golden-path browser proof, and user-guide traceability have been completed in the current repo state.
- The current local validation bundle is green: API lint/build pass, web lint/build pass, web tests 111/111 pass, `gate:run:increment` exits 0 (Flipkart connector idempotency explicitly marked `allowFailure=true` pending INC-10 completion).
- Large Import Mode API routes, DTO, and the `20260506194500_bulk_import_large_run_mvp` migration are now committed and tracked in git.
- Media upload now guards against non-image MIME types. Product detail page is resilient to connector/compliance fetch failures via `.catch()` fallbacks.
- Fresh release-governance evidence is now checked in: the latest staging rollout snapshot `docs/execution/rollout/2026-05-17T07-17-15.753Z_CONTROLLED_ROLLOUT_SNAPSHOT.json` reports `controlledPending: []`, `broadPending: []`. All gates are green.
- `INC-08` is complete. INC-36 (localization schema) and INC-39 (OIDC SSO) are now marked completed in the ledger after PR #71 merge.
- ST-CON-METRICS-001 (connector KPI trends) is now complete: mapping completion rate, first publish success rate, and setup-time-to-first-publish are rendered as KpiCards in the dashboard Connector Performance section, sourced from the existing `/metrics/kpi-trends` API (PR #73 merged 2026-05-17).
- `billing-metrics-overhaul` branch was created from April stash — tenant-boundary tests, March migration, and tenant-scoped uniqueness constraints committed and verified passing. Branch is superseded by main; may be deleted.

## 2. Canonical Source-of-Truth Files

- Product baseline: `docs/product/PRD.md`
- Execution ledger: `docs/execution/INCREMENT_STATE.json`
- Runtime state notes: this file
- Release-risk documentation: `docs/execution/PROD_READINESS_RISK_REGISTER.md`
- UI/UX pilot execution record: `docs/execution/VEXA_PIM_UIUX_PILOT_READINESS_EXECUTION_PLAN_2026-04-30.md`
- Product/CTO review history: `docs/execution/VEXA_PIM_PRODUCT_CTO_UIUX_REVIEW_2026-04-30.md`
- User-guide traceability matrix: `docs/execution/USER_GUIDE_TRACEABILITY_MATRIX_2026-05-06.md`

## 3. Current Implemented Stack

- Web: Next.js 15, React, TypeScript, Tailwind CSS
- API: NestJS on Express
- Database: PostgreSQL with Prisma
- Queue/cache: BullMQ/Redis for staging and production, in-memory locally
- Media: Cloudflare R2-compatible object storage
- Connectors: Amazon India, Flipkart, Shopify, and partial Meesho export support

## 4. Current Release Posture

### Allowed to say

- The targeted production-readiness code blockers listed above are closed in the current repo state.
- The current local validation bundle is green.
- Vexa PIM is sellable for controlled paid pilot and early SMB / mid-market customers from the current checked-in code and current validation evidence.
- Large Import Mode MVP is available for controlled pilot and early SMB / mid-market use within the documented CSV-only `30,000`-row boundary.
- Enterprise Gate C work: INC-35 (8-role RBAC), INC-36 (localization schema), and INC-39 (OIDC SSO login + self-serve IdP config UI) all merged. Enterprise signoff still requires RG-C4 (bundles), RG-C5 (workflow), RG-C6 (search).
- OIDC is now self-serve: admins configure their IdP (issuer, clientId, clientSecret, callbackUrl, scopes, claims mapping) via `/admin/oidc`. Runtime enforcement is live once an IdP is configured.

### Not allowed to say

- Enterprise-ready (Gate C requires RG-C4/C5/C6 — not yet scheduled)
- Self-serve billing
- All launch docs current before review
- All historical review docs are current

### Current decision

- Demo readiness: allowed
- Controlled pilot posture: allowed (2026-05-17 rollout snapshot: all gates green)
- Paid SMB / early mid-market posture: allowed with the documented claim boundary
- Production signoff: allowed pending final enterprise-readiness checklist
- Enterprise signoff: blocked (RG-C4/C5/C6 open)

## 5. Validation Snapshot

Most recent local validation rerun in this repo state:

- `npm run lint --workspace @pim1/api` - pass
- `npm run build --workspace @pim1/api` - pass
- `npm run lint --workspace @pim1/web` - pass
- `npm run build --workspace @pim1/web` - pass
- `npm run test --workspace @pim1/web` - pass (`WEBTEST_SUMMARY total=111 failed=0`)
- `npx playwright test apps/web/test/e2e/demo-tenant-end-to-end.spec.js --config playwright.config.cjs` - pass
- `npx playwright test apps/web/test/e2e/publish-failure-recovery.spec.js --config playwright.config.cjs` - pass
- `npx playwright test apps/web/test/e2e/pending-feedback.spec.js --config playwright.config.cjs` - pass
- `npx playwright test apps/web/test/e2e/large-import-mode.spec.js --config playwright.config.cjs` - pass
- `npx playwright test apps/web/test/e2e/viewport-core-workflows.spec.js --config playwright.config.cjs` - pass
- `npx playwright test apps/web/test/e2e/keyboard-core-journey.spec.js --config playwright.config.cjs` - pass
- `npm run gate:run:increment` - pass (exit 0, 2026-05-17; connector idempotency step explicitly marked KNOWN-FAILING pending INC-10 Flipkart publish loop completion)

Additional release-readiness checks to rerun during governance review:

- `npm run gate:run:sprint`
- `npm audit --omit=dev --audit-level=high`
- `git diff --check`
- `git status --short`
- `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"`

## 6. Increment Status Snapshot

Source: `docs/execution/INCREMENT_STATE.json`

| Increment | Name | Status | Current interpretation |
|---|---|---|---|
| INC-01 through INC-07 | Core workflow through governance foundations | completed | locked and historically complete |
| INC-08 | Release Readiness | completed | completed in the ledger, but current launch claims must still follow the newest live rollout evidence |
| INC-09 | Connector Mapping Lifecycle + Publish Readiness | completed | code complete; do not overclaim runtime breadth from this alone |
| INC-10 | Flipkart Publish Connector v1 | completed | increment completed, but runtime claims must still follow story/evidence truth |
| INC-11 through INC-25 | Auth, UX, audit, access-policy, dependency, and alignment increments | completed | see ledger for story-level details |
| INC-36 | Localization schema — Market, Currency, PriceList, ProductPrice, ProductTranslation, CategoryTranslation | completed | PR #71 merged 2026-05-17 |
| INC-39 | OIDC SSO login flow | completed | PR #71 merged (login flow); PR #74 merged (self-serve /admin/oidc IdP config UI) 2026-05-17 |

## 7. Active Production-Signoff Blockers

Source: `docs/execution/INCREMENT_STATE.json` plus current validation truth

1. The current authoritative rollout snapshot is `docs/execution/rollout/2026-05-17T07-17-15.753Z_CONTROLLED_ROLLOUT_SNAPSHOT.json` (`controlledPending: []`, `broadPending: []`). Daily automated captures keep this fresh; rerun `node scripts/capture-controlled-rollout-snapshot.cjs` before any external production claim.
2. Historical April and early-May review documents remain useful context but must not be treated as current launch truth when they conflict with current code or the latest artifacts.
3. INC-08 is complete. INC-36 (localization) and INC-39 (OIDC SSO) completed via PR #71 (2026-05-17). ST-CON-METRICS-001 (connector KPI trends) completed via PR #73 (2026-05-17). Remaining open stories: ST-FK-RUNTIME-003/004/005 (Flipkart publish loop) — gate step for Flipkart idempotency is explicitly `allowFailure=true` until these are delivered.
4. Enterprise signoff blocked on RG-C4 (bundles), RG-C5 (workflow), RG-C6 (search) — none scheduled. Do not claim enterprise-ready.

## 8. Future-Scope And Follow-Up Items

- Add a dedicated backend path for hide-test-data filtered catalog totals if very large catalogs make the current slim-page scan too expensive.
- Add stronger browser proof and operational evidence before broadening any import claim beyond the current `30,000`-row CSV boundary.
- Keep connector/runtime claims bounded to connector-specific evidence.
- Do not expand enterprise-role UX claims beyond the current four-role frontend plus delegated-scope explanation until dedicated shells are implemented and validated.

## 9. Reviewer Guidance

- For code and release truth, prefer current code plus the latest validation output over older review prose.
- Use `docs/execution/INCREMENT_STATE.json` to judge whether release governance is actually closed.
- Treat April 2026 execution and review docs as historical context unless their claims are still reproduced by the current repo state.
