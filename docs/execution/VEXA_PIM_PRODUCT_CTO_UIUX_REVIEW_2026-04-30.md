# Vexa PIM Product, CTO, Enterprise, Security, and UI/UX Review - 2026-04-30

Evaluation date: 2026-04-30  
Repository: `RDKSAHV7233/PIM1`  
Workspace reviewed: `default`  
Review type: code, docs, tests, gates, build output, execution records, and live staging evidence from the same evaluation cycle  
Review scope: documentation only. No application code or tests were changed.

## 1. Executive verdict

**Verdict: Ready for controlled pilot, not enterprise-ready.**

Vexa PIM has enough proven catalog, quality, workflow, import, connector, audit, notification, access-policy, and admin-governance capability to support an internal demo and a conditional controlled pilot with admin-led onboarding and bounded claims. The live staging smoke is useful evidence, but it is not accepted as full 4-hour role-readiness completion. Vexa PIM should not be positioned as enterprise-ready or broadly released yet because release readiness is not fully locked, some connector runtime stories remain in progress, and the frontend role model is narrower than the backend access-policy model.

Evidence label: **Proven** for build/test results and source references. **Observed** for live staging workflow results captured under `.codex-evidence/`. **Inferred** only where called out from code structure.

### 2026-04-30 validation rerun addendum

This review captured multiple checkpoints across the same execution cycle. A later rerun and triage pass materially updated the validation truth after the earlier smoke and mid-execution observations:

- `@pim1/web` now has a canonical `test` script and the current web suite is green.
- The earlier "12 failing UI contract tests" state is no longer current for the present dirty tree; the current packaged web suite passes.
- Product dirty-state protection, variant lifecycle UX, bulk-import row-level review, bounded queued-export proof, cross-role notifications, and bounded role-aware frontend alignment were completed and recorded in `docs/execution/VEXA_PIM_UIUX_PILOT_READINESS_EXECUTION_PLAN_2026-04-30.md`.
- A later rerun restored validation truthfulness for:
  - `npm run lint --workspace @pim1/api`
  - `npm run build --workspace @pim1/api`
  - `npm run lint --workspace @pim1/web`
  - `npm run build --workspace @pim1/web`
  - `npm run gate:run:increment`
  - `npm run gate:run:sprint`
  - `npm audit --omit=dev --audit-level=high`
  - `git diff --check`

Current release-manager interpretation:

- **Validation truthfulness:** restored
- **Dependency P0 closure:** acceptable again
- **Main remaining risk:** commit hygiene and stale docs, not failing validation

When older sections below conflict with this rerun addendum, treat this addendum plus the pilot-readiness execution plan as the authoritative current-state view.

### PO review acceptance addendum

PO verdict: **Accepted as live staging smoke evaluation. Not accepted as full 4-hour role-readiness completion.**

Release readiness interpretation:

| Area | PO verdict |
|---|---|
| Merchandiser flow | Usable with friction |
| Catalog Manager flow | Mostly ready |
| Operations/Admin flow | Mostly ready |
| Enterprise UI readiness | Not fully proven yet |
| Full release readiness | Needs deeper evaluation before broad release |

Accepted live staging evidence:

```text
login
dashboard load
product list
product creation
required-field validation
product detail
variant creation
category parent/child creation
attributes page
quality dashboard
issue inbox
approvals
jobs
connectors
channel health
audit logs
webhooks
users/roles
bulk edit
bulk import upload submission
```

Partial smoke areas requiring deeper validation:

```text
variant management: create works, edit/delete controls not visible
bulk import: upload observed, imported catalog rows not fully verified
publish/export: not deeply tested
cross-role notifications: not tested
failure scenarios: not tested
```

Strongest failed smoke finding:

```text
Unsaved-change warning is missing when editing product title and navigating to Variants tab.
```

Severity:
- **P1:** Fix unsaved-change protection before serious pilot.
- **P2:** Fix or verify variant edit/delete controls before broader release.
- **P2:** Complete row-level bulk-import verification before broader release.

### Final PO acceptance addendum

PO verdict: **Accepted as the final Vexa PIM product/CTO/UIUX review documentation.**

Accepted interpretation:

```text
Backend/access-policy maturity is stronger than frontend UX maturity.
```

Final PO decision:

```text
Decision: ACCEPTED
Pilot readiness: YES, controlled pilot only
Enterprise readiness: NO
Broad release readiness: NO
INC-24 closeout: Can be considered separately only if access-policy blockers are formally scoped/future-scoped
```

Approved next step:

```text
Move next to UI/UX pilot-readiness execution.
Do not start another backend access-policy wave first.
```

Recommended execution order:

```text
1. Add canonical web test script for @pim1/web
2. Resolve the previously failing 12 UI contract tests and restore a green packaged web suite
3. Add unsaved-change warning on product edit tab navigation
4. Align frontend role UX with backend access-policy roles
5. Review INC-08 and connector/runtime stories for pilot impact
```

## 2. Product readiness score

**7.0 / 10**

Reason: Core PIM workflows are substantially present and validated: products, variants, categories, attributes, import jobs, bulk edit, validation/issues, approvals, connector setup, mappings, jobs, submissions, audit, API keys, users, billing/plan, webhooks, and notifications. The product is pilotable, but not release-ready because live UX gaps and web contract failures remain.

Key evidence:
- Web build route inventory proves active routes for `/catalog/products`, `/catalog/categories`, `/catalog/attributes`, `/products/[id]`, `/operations/imports`, `/operations/bulk-edit`, `/operations/jobs`, `/quality/issues`, `/quality/approvals`, `/channels/connectors`, `/channels/mappings`, `/channels/submissions`, `/admin/users`, `/admin/api-keys`, `/admin/audit`, `/admin/webhooks`, and `/admin/plan`.
- Live staging created `TEST-MERCHANDISER-PRODUCT-001-02-27-00`, created a variant in 0.904 sec, validated a product in 2.527 sec, created parent/child categories in about 4.05 sec each, and loaded main route inventory screenshots under `.codex-evidence/pim-role-eval-*`.
- Direct web integration sweep: 65 of 77 passed, 12 failed.

## 3. CTO technical readiness score

**8.0 / 10**

Reason: API and web builds pass, access-policy suites pass, increment and sprint gates pass, deploy workflow validation passes, tenant isolation and connector idempotency tests pass, and guard scripts report strong sensitive-read coverage. Technical readiness is higher than product/UI readiness. Deductions are for missing `@pim1/web` test script, failing web UI contracts, dirty worktree, and in-progress increment state.

## 4. Enterprise readiness score

**6.5 / 10**

Reason: Multi-tenant data modeling, tenant-scoped tests, RBAC/admin-boundary/access-policy, API key scope checks, redaction tests, audit logs, and deploy checks are proven. Enterprise readiness is blocked by UI incompleteness for foundation roles, open connector runtime stories, unsupported ABAC dimensions that intentionally fail closed, and incomplete evidence for at-scale marketplace operations in the UI.

## 5. UI/UX readiness score

**6.4 / 10**

Reason: The UI has a broad route surface, clear admin/product/quality/operations groupings, loading states, empty states, role-aware copy, status banners, and many route-contract tests. It is good enough for demo and controlled pilot, but not polished enough for limited or enterprise release because direct UI tests fail, live unsaved-change protection failed, product variant editing is create/list only, the frontend exposes only `admin|editor|reviewer|viewer` roles while the backend supports richer foundation/admin-boundary roles, and internal/admin surfaces need sharper commercial-demo gating.

UI/UX score breakdown:

| Area | Score | Evidence |
|---|---:|---|
| Navigation clarity | 7 | Proven from `apps/web/src/components/nav/app-sidebar.tsx`; routes grouped by Workspace, Catalog, Connections, Quality, Operate, Settings. |
| Core workflow usability | 6 | Proven from route/component tests and live product/category/variant validation; unsaved-change warning failed live. |
| Admin/governance UX | 7 | Proven from admin route contracts for users, API keys, audit, connectors, webhooks, plan. |
| Role-aware UX | 6 | Proven for app roles; partially proven for foundation roles because web `AppRole` is only `admin|editor|reviewer|viewer`. |
| Error/empty states | 7 | Proven by route contracts for imports/jobs/channels/quality and dashboard fallback tests. |
| Enterprise readiness | 6 | Strong backend evidence, weaker frontend role and marketplace scale evidence. |
| Visual consistency | 7 | Shared `PageHeader`, cards, status chips, buttons, pending buttons, and shell are visible in code. |
| Accessibility basics | 6 | Skip link, labels, aria labels, focus work in notification center exist; full keyboard/screen-reader testing not performed. |
| Overall UI/UX readiness | 6.4 | Pilot-ready with caveats; not release-ready. |

## 6. What is complete

Only proven items are listed.

- **API build health:** `npm run build --workspace @pim1/api` passed.
- **Web build health:** `npm run build --workspace @pim1/web` passed and produced a full Next.js route inventory.
- **Increment and sprint gates:** `npm run gate:run:increment` passed with 16 steps; `npm run gate:run:sprint` passed with 14 steps.
- **Tenant isolation:** sprint gate ran `test:integration:rls-isolation` with 100 requests split across two tenants.
- **Access-policy foundation and remediation:** all required access-policy commands passed.
- **Delegated access scopes:** `npm run test:integration:delegated-access-scopes` passed.
- **Sensitive GET guard:** `npm run guard:sensitive-gets` passed with 71 authenticated read routes, 158 authenticated routes, 19 public routes, 35 API-client allowed-with-scope routes, and 49 admin-boundary checked routes.
- **Workspace user CRUD and assigned roles:** required workspace/auth assigned-role tests passed.
- **Notifications center backend behavior:** `node apps/api/test/integration/notifications-center.test.cjs` passed.
- **Deploy workflow static validation:** `node scripts/validate-deploy-staging-workflow.cjs` passed.
- **Staging postdeploy static validation:** `node scripts/staging-postdeploy-check.test.cjs` passed.
- **Core web route contracts:** direct web tests passed for dashboard, catalog products, product detail, operations imports/jobs/repair, quality issues/approvals/overview, channels overview/health/submissions, admin users/API keys/connectors/webhooks/audit, connector install, mapping, Shopify surfaces, auth recovery, signup, privacy, and webhooks copy.
- **Live staging bounded workflows:** product creation, variant creation, validation, category hierarchy creation, and route inventory were observed and screenshot-captured in `.codex-evidence/`.

## 7. What is partially complete

- **Variant management:** variant creation and list are proven, but edit/delete controls were not found live and `apps/web/src/app/products/[id]/_components/variants-tab.tsx` renders create plus list only. Evidence: **Observed/Proven**.
- **Bulk import:** route, upload UI, pending buttons, progress UI, jobs, and tests exist; live import was submitted and partially verified, but full row-level success/failure and 100/1000-row scale behavior were not fully proven. Evidence: **Partially proven**.
- **Marketplace publishing:** connector setup, mappings, readiness, export jobs, idempotency, submissions, channel health, Shopify/Flipkart/Meesho surfaces are present. Full live marketplace publish at enterprise volume was not proven. Evidence: **Partially proven**.
- **Role-aware UX:** app roles are represented in web UI; backend foundation roles are broader. Web `AppRole` is only `admin | editor | reviewer | viewer` in `apps/web/src/lib/api/core.ts`, while backend roles include `product_admin`, `system_admin`, `super_admin`, `category_manager`, and `vendor` in `apps/api/src/common/rbac/roles.ts`. Evidence: **Proven**.
- **Admin plan/commercial workflow:** source uses Vexa commercial workflow and direct export tests pass, but one stale UI contract still expects older TEJ wording. Evidence: **Partially proven**.
- **Notification center:** actual shell imports and renders `NotificationCenter` through `AuthenticatedShell`, but `notification-center-ui.test.cjs` is stale because it still expects layout-level imports. Evidence: **Proven test drift**.

## 8. What is not complete

- **Release readiness lock:** `docs/execution/INCREMENT_STATE.json` shows `INC-08` status `in_progress` while deliveryStatus is `completed`; this is not a clean release lock.
- **Connector runtime backlog:** `ST-CON-METRICS-001`, `ST-FK-RUNTIME-003`, `ST-FK-PUBLISH-004`, and `ST-FK-STATUS-005` are still `in_progress`/unlocked in `INCREMENT_STATE.json`.
- **Web package test entrypoint:** `npm run test --workspace @pim1/web` fails because `@pim1/web` has no `test` script.
- **Web UI contract closure:** direct web integration sweep failed 12 of 77 tests.
- **Unsaved changes protection:** live staging product detail edit followed by tab change did not show an unsaved-change warning.
- **Enterprise-scale publish SLA:** no proven UI or live evidence that 100 products can publish in under 5 minutes or that 1000 to 5000 products/day is operationally proven.
- **Complete frontend foundation-role UX:** vendor and category_manager backend rules are tested, but frontend role surfaces remain centered on app roles.

## 9. Active blockers

### Release blockers

1. **Web test command missing**
   - Evidence: `npm run test --workspace @pim1/web` failed with `Missing script: "test"`.
   - Likely area: `apps/web/package.json`.
   - Classification: test packaging/release gate issue.

2. **Direct web integration sweep is not green**
   - Evidence: loop over `apps/web/test/integration/*.test.cjs` returned `WEBTEST_SUMMARY total=77 failed=12`.
   - Failed tests: `admin-plan-signup-conversion-ui.test.cjs`, `api-http-error-guard.test.cjs`, `auth-shell-ui.test.cjs`, `catalog-delete-ui.test.cjs`, `catalog-first-shell.test.cjs`, `connector-access-delete-helper.test.cjs`, `global-search-ui.test.cjs`, `internal-surface-gating.test.cjs`, `marketplace-capability-ui-gating.test.cjs`, `notification-center-ui.test.cjs`, `pending-feedback-rollout-ui.test.cjs`, `product-shell-uiux.test.cjs`.
   - Classification: mixed real UI gaps and stale contract tests. Must be triaged before release.

3. **Unsaved-change warning failed live**
   - Evidence: live staging product title edit followed by Variants tab navigation showed no warning; `unsavedWarningShown=false`.
   - Likely area: product detail form/tab navigation under `apps/web/src/app/products/[id]`.
   - Classification: real UX/data-loss blocker for release.

4. **Release increment state is not clean**
   - Evidence: `docs/execution/INCREMENT_STATE.json` has `INC-08` status `in_progress`.
   - Classification: governance/release-readiness blocker.

### Enterprise blockers

1. **Open connector/runtime stories**
   - Evidence: `INCREMENT_STATE.json` shows `ST-CON-METRICS-001`, `ST-FK-RUNTIME-003`, `ST-FK-PUBLISH-004`, and `ST-FK-STATUS-005` in progress/unlocked.

2. **Frontend role model is narrower than backend access model**
   - Evidence: web `AppRole` is only `admin|editor|reviewer|viewer`; backend has admin-boundary and foundation roles.
   - Impact: enterprise demos for vendor, category_manager, product_admin, system_admin, and super_admin need careful backend/API framing or custom accounts; the UI does not yet fully express these personas.

3. **Unsupported ABAC dimensions are intentionally fail-closed**
   - Evidence: delegated access scope test validates `future_scope_dimensions_are_representable_but_safely_rejected_until_enforced`.
   - Impact: truthful claim is "bounded access-policy maturity", not full ABAC.

4. **Enterprise publish scale is not proven**
   - Evidence: connector idempotency and jobs pass, but no measured proof for 100-product/5-minute or 1000-5000/day UI operation.

### Future-scope items

- Complete frontend UX for `vendor`, `category_manager`, `product_admin`, `system_admin`, and `super_admin`.
- Add durable unsaved-change and autosave recovery.
- Add variant edit/delete/copy-template UX.
- Add enterprise-scale publish dashboard with SLA metrics.
- Add full import partial-success reconciliation UX for failed rows and duplicate SKUs at scale.
- Add full live marketplace publish verification with external product URL proof.

### Out-of-scope items

- Penetration testing.
- Production traffic/load testing.
- Real customer data validation.
- Contractual compliance/legal review.
- Actual enterprise customer acceptance testing.
- Storing or exposing staging credentials in documentation.

## 10. Security/access-policy review

### What is proven

- **Authenticated-read classification and sensitive GET coverage:** `npm run guard:sensitive-gets` passed. Metrics: 71 authenticated-read routes, 158 authenticated routes, 19 public routes, 49 admin-boundary checked routes.
- **Admin-boundary coverage:** access-policy remediation validated product_admin/system_admin/super_admin separation and route denials/allowances.
- **Vendor/category/owner scope enforcement:** delegated access scopes validated category/brand intersections, issue inbox scoping, vendor-owned resources, connector account/channel scopes, and audited denials.
- **API-key scopes:** remediation validated exact scope requirements for issue inbox, bulk import, taxonomy, AI helper, connector, marketplace, submission, audit, billing, account export, and human-only routes.
- **Redaction coverage:** remediation validated viewer SKU redaction, audit metadata redaction differences, webhook delivery error redaction, bulk import source payload redaction, billing profile/request redaction, and dashboard role redaction.
- **Audit logs:** audit route contracts pass, backend audit tests pass, and schema has tenant-scoped `AuditLog`.
- **Multi-tenant isolation:** tenant isolation integration passed and schema carries `tenantKey` on core models.

### What remains risky

- The backend access-policy model is more mature than the frontend role UX. Enterprise buyers may expect visible admin-boundary/foundation-role controls.
- Unsupported ABAC dimensions are not supported; they fail closed. That is safe, but it is not full ABAC.
- Dirty worktree means the current local review state is not a clean release artifact.
- The web integration sweep is not green, so UI/security affordance regressions may be masked by stale or failing tests.

### Truthfulness of current product claims

Truthful:
- "Tenant-scoped access-policy controls are substantially validated for bounded routes."
- "Admin-boundary and API-client scope enforcement are covered by integration tests."
- "Sensitive authenticated reads have guard coverage."

Not truthful:
- "Full enterprise ABAC is complete."
- "All roles have complete UI experiences."
- "The product is enterprise-ready."
- "All web UI tests are green."

## 11. Detailed UI/UX review

### UI/UX executive summary

The UI is coherent enough for a guided pilot. The information architecture is recognizable and business-oriented: Catalog, Connections, Quality, Operate, and Settings. There is strong route coverage and many route-contract tests. The weak points are release polish, role-specific enterprise UX, unsaved-change safety, a missing web test command, and untriaged failing UI contracts.

### Screens/routes reviewed

Proven from build output and source:
- `/dashboard`
- `/catalog/products`
- `/catalog/categories`
- `/catalog/attributes`
- `/catalog/media`
- `/products/[id]`
- `/operations/imports`
- `/operations/bulk-edit`
- `/operations/jobs`
- `/operations/repair`
- `/quality/issues`
- `/quality/validation`
- `/quality/completeness`
- `/quality/approvals`
- `/rejection`
- `/channels`
- `/channels/connectors`
- `/channels/connectors/[installationId]`
- `/channels/connectors/setup`
- `/channels/health`
- `/channels/mappings`
- `/channels/submissions`
- `/connectors`
- `/connectors/setup`
- `/admin`
- `/admin/users`
- `/admin/api-keys`
- `/admin/connectors`
- `/admin/audit`
- `/admin/webhooks`
- `/admin/plan`
- `/admin/privacy`
- `/internal/developer`
- `/ai`
- `/ondc`

### Role-based UX assessment

| Role | Assessment | Evidence | Severity |
|---|---|---|---|
| Product admin | Backend-admin capabilities are proven; product UI supports create/edit/delete/validate/publish-readiness. Frontend does not distinguish `product_admin` as a first-class `AppRole`. | `apps/api/src/common/rbac/roles.ts`, `apps/web/src/lib/api/core.ts` | P1 |
| System admin | Backend admin-boundary coverage is proven. UI admin modules exist for users, API keys, webhooks, audit, plan, privacy. Frontend does not distinguish `system_admin`. | access-policy tests, admin route contracts | P1 |
| Editor | Strongest UI fit. Can work catalog, import, bulk edit, quality, channels with bounded restrictions. | `apps/web/src/lib/role-capabilities.ts`, route tests | P2 |
| Reviewer | Approval decision UX is tested and read-only elsewhere. | `quality-reviewer-role-ui.test.cjs`, approvals route contract | P2 |
| Vendor | Backend owned-resource reads are tested, but no complete vendor-specific frontend journey is proven. | `access-policy-remediation`, `delegated-access-scopes`, web `AppRole` type | P1 |
| Category manager | Backend scoped catalog/taxonomy paths are tested, but no complete category_manager frontend journey is proven. | taxonomy controller and delegated tests | P1 |
| API/client operations user | API-key scopes are strongly tested; UI for API key management exists for admin. Machine-principal UX is admin-facing, not an operator cockpit. | `admin-api-keys-route-contract.test.cjs`, access-policy remediation | P2 |

### Core journey assessment

- **Create/edit product:** Route and live product create are proven. Product create form worked live. Edit form lacks live unsaved-change protection.
- **Manage variants:** Create/list proven. Edit/delete/copy variant not proven; live controls were absent and component renders no row actions.
- **Assign category/taxonomy:** Categories route and live parent/child creation are proven. Attribute definitions exist per category.
- **Manage attributes:** Attribute route exists and schema supports category-specific definitions with data type, required, allowed values, and appliesTo.
- **Import products:** Imports route, sample templates, pending feedback, progress component, jobs, error rows, and tests exist. Full bulk scale and row-level live reconciliation not fully proven.
- **Inspect failed import rows:** Import/jobs/repair routes and bulk import error redaction tests exist. Live failed-row inspection not fully exercised in this review.
- **Export/publish products:** Product channels tab queues export jobs and shows readiness, jobs, recovery actions. Full live publish to marketplace not proven.
- **Connector setup:** Setup forms for Flipkart, Amazon, Shopify handoff, connector governance, access policies, and launch-honesty notes are tested.
- **Marketplace export/readiness:** Product readiness summary, readiness blockers, channel health, submissions, connector details, and Shopify readiness panels are proven by tests.
- **Compliance issue review:** Quality issues/approvals/validation/completeness routes exist and tests pass.
- **Rejection intelligence:** `/rejection` exists and backend access tests validate rejection score visibility.
- **Auto-suggestion/AI helper:** Backend access tests validate AI helper read scopes; UI route `/ai` exists but is internal/gated and not a production customer claim.
- **Vendor read-only journey:** Backend proven; frontend incomplete.
- **Category manager scoped journey:** Backend proven; frontend incomplete.
- **Workspace-user management:** Admin users route contract and backend workspace CRUD tests pass.
- **API key management:** Admin API key route contract and backend API key scope tests pass.
- **Audit/log review:** Admin audit UI and export route tests pass.
- **Billing/plan/usage:** Admin plan route exists; export tests pass; one direct UI contract is stale/failing against current Vexa copy.

### Navigation and information architecture review

The main navigation is clear and grouped by work type in `apps/web/src/components/nav/app-sidebar.tsx`. Role visibility exists through `canViewAdminNavigationItem`, with `editor_plus` and `admin` visibility levels. Admin/governance areas are separated under Settings and Connections Governance. However, internal tools are appended when `showInternal` is true, and `AuthenticatedShell` passes `showInternal={actorRole === "admin"}`. That is useful for internal admins but risky for customer-facing enterprise demos unless environment-gated or tenant-gated.

### Dashboard UX review

Dashboard route contract passed and proves parallel loading of health, usage, operations, products, and admin trends, plus live catalog/publish/ops KPIs and next-best-action links. Dashboard API fallback UI test passed. The direct web sweep still failed `catalog-first-shell.test.cjs`, which expects KPI cards to link directly to filtered drill-down views, so drill-down completeness should be reviewed.

### Catalog/product UX review

Strengths:
- Product workbench route contract passed.
- Create product form has inline submit failure handling.
- Product detail fetch orchestration and route contract passed.
- Product overview exposes blockers and delete controls.
- Product channels tab has readiness, simulator, template save, queue, processing, and requeue actions.

Gaps:
- Unsaved-change warning failed live.
- Variants lack edit/delete row actions.
- Direct test `catalog-delete-ui.test.cjs` failed because the test expects exact copy/imports; source shows delete controls in overview, so this is likely partly stale but still must be triaged.

### Import/export UX review

Imports have route contracts, pending buttons, sample templates, progress component, and jobs/repair pages. Export has product-level channel tab, readiness blockers, queued jobs, processing and requeue actions, and connector submissions. Enterprise readiness requires proof of partial success/failure handling and at-scale publish timing.

### Connector/marketplace UX review

Connector setup and portfolio pages are unusually launch-honest: tests validate non-live forms are hidden, managed Shopify handoff exists, and implementation-status notes are shown. Connector permissions and action matrices exist. The failed `marketplace-capability-ui-gating.test.cjs` is stale in file target because `publishableChannels` moved to `product-detail-deferred-section.tsx`, where source proves installed-connector capability filtering exists.

### Admin/settings UX review

Admin routes are broad and well tested: users, API keys, connectors, webhooks, audit, plan, privacy. The users route exposes role matrix and delegated access scope management. API key and webhook actions are admin-only. The gap is that foundation/admin-boundary backend roles are not first-class frontend personas.

### Audit/security UX review

Audit explorer UI test passed and proves typed event fetching, filters, export controls, commercial audit actions, and export proxy. Backend audit/redaction tests are strong. UI should better explain redacted fields for non-super-admin/system-admin viewers in enterprise contexts.

### Billing/usage UX review

Plan/usage route is present and source shows Vexa commercial workflow, usage/profile, signup conversion, billing contact, upgrade request, and commercial status alerts. Direct export UI tests pass. One stale UI test still expects TEJ wording and should be updated or intentionally retired.

### Error/loading/empty-state review

Proven:
- Loading files exist for catalog products and product detail.
- Dashboard API fallback test passed.
- Operations imports/jobs/repair route contracts validate empty states and repair escalation.
- Channels health route validates empty state.
- Admin webhooks and API keys validate empty/read-only fallback states.
- Auth recovery, suspension, locked account, and CSRF tests pass.

Gaps:
- Missing unsaved-change warning is a data-loss UX blocker.
- Some failed UI contracts are specifically about pending feedback, though source now shows many pending labels; reconcile test expectations with current components.

### Accessibility/responsive risks

Proven basics:
- Root layout includes skip link.
- Product detail tabs use `aria-label`.
- Notification center source includes dialog, focus restore/trap patterns, and body scroll lock.
- Inputs commonly use labels.
- Tables use overflow wrappers and min widths in several places.

Risks:
- Full keyboard navigation and screen-reader testing was not run.
- Mobile table overflow may be acceptable but needs browser testing across product, audit, imports, jobs, and connector detail routes.
- Some inline SVG icons are used in sidebar; no issue by itself, but icon-only controls need tooltip/aria review route-by-route.

### Visual consistency review

The app uses shared `PageHeader`, `Card`, `StatusChip`, `Button`, `PendingSubmitButton`, and shell components. This gives a consistent enterprise-ops feel. Visual risks are mostly density and route-specific complexity, not inconsistent component styling.

### UI performance risks

Proven strengths:
- Dashboard and product detail fetch independent data in parallel.
- Product readiness batch route is tested.
- Route contracts prove normalized query state and parallel fetches.

Risks:
- Large tables rely on server fetch plus overflow/pagination patterns but no load test was run.
- Import/export progress is present, but long-running, high-volume publish progress was not live-measured.
- Sidebar badge fetch runs client-side on route changes; low risk but should remain resilient.

### Top 10 UI/UX issues ranked by severity

1. **P0 - Unsaved product edits can be lost on tab navigation**
   - Route: `/products/[id]`
   - Affected role: editor/admin
   - Evidence: live staging `unsavedWarningShown=false`
   - Recommendation: add dirty-state tracking, tab/back warning, and/or draft autosave.

2. **P1 - Web test entrypoint missing**
   - Route/surface: all web
   - Affected role: release team
   - Evidence: `npm run test --workspace @pim1/web` missing script
   - Recommendation: add a canonical web test script that runs the maintained direct integration suite.

3. **P1 - Direct web integration suite has 12 failures**
   - Route/surface: shell, catalog, internal, connector, plan, product
   - Evidence: 65/77 passed, 12 failed
   - Recommendation: triage each as stale test or real UI gap; do not release until green or waived with record.

4. **P1 - Foundation/admin-boundary roles are backend-ready but UI-incomplete**
   - Route: admin/users, catalog, taxonomy, vendor views
   - Affected roles: vendor, category_manager, product_admin, system_admin, super_admin
   - Evidence: web `AppRole` only four roles; backend has more roles
   - Recommendation: design role-specific navigation, badges, permission-denied copy, and scoped landing pages.

5. **P1 - Internal routes may appear for admin shell**
   - Route: sidebar/internal
   - Affected role: customer admin
   - Evidence: `showInternal={actorRole === "admin"}`
   - Recommendation: gate internal routes by environment/operator claim, not generic workspace admin.

6. **P2 - Variant lifecycle is incomplete in UI**
   - Route: `/products/[id]?tab=variants`
   - Affected role: merchandiser/editor
   - Evidence: `variants-tab.tsx` renders create/list only; live edit/delete controls absent
   - Recommendation: add edit/delete/clone variant controls with confirmation and audit.

7. **P2 - Publish SLA and high-volume progress not proven**
   - Route: product channels, operations jobs
   - Affected role: operations
   - Evidence: jobs/status tests exist, no 100-product/5-minute live proof
   - Recommendation: add bulk publish UX tests and measured staging run.

8. **P2 - Import partial-failure UX not fully proven live**
   - Route: `/operations/imports`, `/operations/jobs`, `/operations/repair`
   - Affected role: operations/catalog manager
   - Evidence: route tests pass; live import only partially verified
   - Recommendation: run 10-row partial-success and duplicate SKU scenario.

9. **P2 - Dashboard drill-down expectations are not fully met**
   - Route: `/dashboard`
   - Affected role: admin/ops
   - Evidence: `catalog-first-shell.test.cjs` failed
   - Recommendation: ensure KPI cards deep-link to filtered work queues.

10. **P3 - Some UI contract tests are stale after refactor**
   - Route: shell/product/plan
   - Affected role: engineering
   - Evidence: tests expect layout-level `NotificationCenter`/`GlobalSearch`, while current source mounts them in `AuthenticatedShell`
   - Recommendation: update tests to assert current architecture.

### Top 10 UI/UX improvements ranked by business value

1. Add unsaved-change warning and draft recovery on product forms.
2. Make `npm run test --workspace @pim1/web` the canonical web test command.
3. Close or update the 12 failing web UI contracts.
4. Build explicit vendor/category_manager/system_admin/product_admin/super_admin UI flows.
5. Add variant edit/delete/clone actions.
6. Add bulk publish progress and SLA dashboard for operations.
7. Add import failure reconciliation views with duplicate SKU detection.
8. Gate internal/lab navigation by environment/operator entitlement.
9. Add permission-denied pages that explain redaction/scope boundaries.
10. Add responsive and accessibility browser test pass for tables, drawers, and modals.

### UI ready for demo, pilot, or release

- Internal demo: **Yes**, guided and with caveats.
- Controlled pilot: **Yes**, if pilot scope excludes unsupported enterprise claims and includes admin-led onboarding.
- Limited release: **No**, not until web UI contracts are green/waived, unsaved changes are fixed, and release state is clean.
- Enterprise release: **No**.

## 12. Engineering risks

- Missing `@pim1/web` `test` script makes standard web test execution fail.
- Direct web integration suite has 12 failures.
- Dirty worktree exists before this review; release artifact is not clean.
- `INCREMENT_STATE.json` contains in-progress release/connector stories.
- Some tests are stale after component relocation, which increases false-negative and false-positive risk.
- No production-scale load/publish proof in this review.
- Backend access-policy maturity is ahead of frontend role UX.
- Existing `.codex-evidence/` is untracked local evidence, not committed review artifact.

## 13. Recommended release claim

Approved wording:

> Vexa PIM is ready for an internal demo and controlled pilot of tenant-scoped catalog management, product quality workflows, imports, connector setup/mapping, operations monitoring, audit/admin controls, and bounded access-policy enforcement. Enterprise release and broad marketplace automation remain pending final UI contract closure, unsaved-change protection, connector runtime completion, release-state lock, and at-scale publish validation.

PO-approved smoke wording:

> Vexa PIM has live staging evidence for core catalog creation, category management, selected governance/admin pages, connector visibility, bulk-import submission, and role-oriented workflows. Merchandiser, Catalog Manager, and Operations/Admin flows are usable to mostly ready in smoke testing. Remaining UX gaps include missing unsaved-change protection, incomplete variant management verification, incomplete row-level bulk-import verification, and untested publish/failure/notification scenarios.

Final PO-approved product claim:

> Vexa PIM is ready for a controlled pilot with proven backend access-policy hardening, core catalog/category/admin workflows, and green API/build/gate validation. It is not yet enterprise-ready due to remaining UI contract failures, incomplete frontend role UX alignment, missing unsaved-change protection, and open pilot-readiness backlog items.

## 14. Claims to avoid

- "Enterprise-ready."
- "Fully release-ready."
- "Full ABAC is complete."
- "All enterprise roles have complete UI experiences."
- "All web tests are green."
- "Full UI regression suite green."
- "Full merchandiser workflow complete."
- "Bulk import fully verified."
- "Variant lifecycle complete."
- "Publish workflow production-ready."
- "All role journeys validated."
- "Frontend UX fully aligned with backend authorization."
- "Complete connector/runtime readiness."
- "No data-loss risk."
- "Fully self-serve marketplace publishing is production-ready."
- "Can publish 100 products in under 5 minutes" unless measured in a representative staging/prod-like run.
- "Can support 1000-5000 publishes/day" unless proven by load and operations tests.
- "Variant management is complete" until edit/delete/clone are present.
- "Bulk import partial failure handling is fully proven live" until the failure scenarios are run.

## 15. Next 10 development priorities

1. Add/standardize the canonical web test script for `@pim1/web`.
2. Keep the previously failing UI contract tests green in the packaged web suite and watch for regressions.
3. Monitor dirty-state protection, variant lifecycle, and row-level import verification in live pilot usage.
4. Continue aligning frontend role UX with backend access-policy roles where enterprise personas remain future scope.
5. Review `INC-08` and connector/runtime stories for pilot impact.
6. Verify live failure scenarios beyond bounded route-contract coverage.
7. Run broader publish/export connector proof if pilot scope expands beyond queued-export readiness.
8. Prove partial-failure import behavior live at larger batch sizes.
9. Prove connector/runtime stability beyond the current bounded pilot connector path.
10. Add Playwright regression checks for product dirty-state, variant lifecycle, and import verification.

## 16. Final PO decision

- Can demo? **Yes.** Use a scripted path with known caveats.
- Can pilot? **Conditional controlled pilot only.** Limit to known-supported catalog, quality, import submission, connector visibility/setup, admin, audit, and access-policy workflows.
- Can release? **No.** Run a deeper 4-hour role-readiness evaluation and close/waive release blockers first.
- Can call enterprise-ready? **No.**
- Should INC-24 be closed? **Yes, keep INC-24 closed/locked for its bounded access-policy backlog story.** Evidence: `INCREMENT_STATE.json` marks `INC-24` and `ST-ACCESS-POLICY-BACKLOG-001` completed/locked, and all required access-policy validation commands passed. Do not use INC-24 closure to claim full enterprise release readiness.

Final PO position:

```text
Decision: ACCEPTED AS SMOKE EVIDENCE
Demo readiness: Yes, with scripted path and known caveats
Controlled pilot readiness: Conditional
Broad release readiness: Not yet
Enterprise-ready claim: No
Proceed with targeted UX fixes and a deeper 4-hour role-readiness evaluation before claiming release readiness.
```

## 17. Validation appendix

### Required validation commands

| Command | Result | Evidence / important output |
|---|---|---|
| `npm run build --workspace @pim1/api` | Pass | `nest build` completed. |
| `npm run build --workspace @pim1/web` | Pass | Next.js build completed; 29 static pages generated; route inventory listed catalog, quality, operations, channels, admin, auth, and API routes. |
| `npm run test:integration:access-policy-remediation` | Pass | Validated 120+ access-policy behaviors including redaction, admin-boundary, API keys, dashboard, billing, audit, connector, marketplace, taxonomy, and denial auditing. |
| `npm run test:integration:delegated-access-scopes` | Pass | Validated category/brand/vendor intersections, issue inbox scoping, connector scope intersections, future dims fail-closed, admin tenant boundary, and audited denials. |
| `npm run guard:sensitive-gets` | Pass | `authenticatedReadRoutes: 71`, `authenticatedRoutes: 158`, `publicRoutes: 19`, `adminBoundaryCheckedRoutes: 49`. |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Pass | Validated multi-role resolution, API client default deny, admin-boundary roles, public bypass, and scope vocabulary. |
| `node apps/api/test/integration/notifications-center.test.cjs` | Pass | Validated import failure, approval decision, publish failure notifications, unread decrement, reviewer filtering, and redaction. |
| `node apps/api/test/integration/workspace-user-crud.test.cjs` | Pass | Validated admin CRUD, duplicate rejection, assigned roles, lock/deactivate stale JWT rejection, viewer forbidden, self-protection. |
| `node apps/api/test/integration/auth-assigned-roles-read-path.test.cjs` | Pass | Validated assigned role reads, fallback/normalization, governance reads, system_admin security governance, product_admin denial. |
| `node apps/api/test/integration/auth-local-assigned-roles-bridge.test.cjs` | Pass | Assigned roles bridge passed. |
| `node apps/api/test/integration/auth-assigned-roles-rollout-runbook.test.cjs` | Pass | Assigned roles rollout runbook validation passed. |
| `npm run gate:run:increment` | Pass | 16 steps passed including API/web builds, connector idempotency, webhook dedupe, RLS, rejection notification, metrics, dashboard, workflow, access policy, delegated scopes, unsafe raw, sensitive GET. |
| `npm run gate:run:sprint` | Pass | 14 steps passed, same core sprint suite. |
| `node scripts/validate-deploy-staging-workflow.cjs` | Pass | Validated workflow dispatch, environment protection, migration secret guard, Railway deploy script, smoke checks, postdeploy access-policy checks, artifact uploads. |
| `node scripts/staging-postdeploy-check.test.cjs` | Pass | Validated workspace-scoped login smoke, bearer reuse, logout revocation, role render, non-admin audit denial, stale token rejection. |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Pass | `INCREMENT_STATE.json valid`. |
| `git diff --check` | Pass with line-ending warnings | No whitespace errors. Git warned that five pre-existing modified files will be normalized from LF to CRLF the next time Git touches them. |
| `git status --short` | Pass, dirty worktree | Pre-existing modified files remained; new review doc is untracked until added. See final git status below. |

### UI/Web validation commands

| Command | Result | Evidence / important output |
|---|---|---|
| `npm run lint --workspace @pim1/web` | Pass | `tsc --noEmit` completed. |
| `npm run test --workspace @pim1/web` | Fail | Missing script: `test`. Likely area: `apps/web/package.json`. Classification: test packaging/release gate issue. |
| `node apps/web/test/integration/dashboard-route-contract.test.cjs` | Pass | Validated shared server auth context, parallel fetches, live KPIs, drilldowns, signup funnel, priority queue, and auth redirects. |
| Direct loop over `apps/web/test/integration/*.test.cjs` | Fail | 77 total, 65 passed, 12 failed. Classification: mixed stale UI contracts and real gaps requiring triage. |

Failed direct web tests:

| Test | Failure snippet | Likely classification |
|---|---|---|
| `admin-plan-signup-conversion-ui.test.cjs` | "Plan page must be read-only for customer admins and route plan changes into a tracked TEJ commercial workflow." | Likely stale copy expectation; source uses Vexa commercial ops. |
| `api-http-error-guard.test.cjs` | "ApiHttpError must provide a structural instanceof guard..." | Stale file target; source has guard in `apps/web/src/lib/api/core.ts`. |
| `auth-shell-ui.test.cjs` | "Root layout must render the authenticated shell from auth-token presence..." | Mostly stale exact-string expectation after shell refactor; root layout uses `hasServerAuthToken`. |
| `catalog-delete-ui.test.cjs` | "Product detail must expose soft delete and admin hard delete controls." | Likely stale exact-string/import expectation; overview source has soft/hard delete controls. Still triage. |
| `catalog-first-shell.test.cjs` | "Dashboard KPI cards must link directly to filtered drill-down views." | Likely real UI completeness gap. |
| `connector-access-delete-helper.test.cjs` | "fetchJson must detect whether a request body is present..." | Source now does this in `apps/web/src/lib/api/core.ts`; likely stale path/expectation. |
| `global-search-ui.test.cjs` | "Authenticated shell must mount the global search in the header only when auth is present." | Stale layout-level expectation; `AuthenticatedShell` renders `GlobalSearch`. |
| `internal-surface-gating.test.cjs` | "Seller-facing app navigation must hide internal lab routes by default." | Real commercial-demo risk: admin shell can show internal section. |
| `marketplace-capability-ui-gating.test.cjs` | "Product page must derive publishable channels..." | Stale file target; logic moved to `product-detail-deferred-section.tsx`. |
| `notification-center-ui.test.cjs` | "layout must import NotificationCenter" | Stale after `AuthenticatedShell` refactor; shell imports and renders it. |
| `pending-feedback-rollout-ui.test.cjs` | "connector setup and operations surfaces must add pending feedback..." | Source shows many pending labels; likely stale exact expectation for dynamic Shopify label or paths. |
| `product-shell-uiux.test.cjs` | "Authenticated shell must expose global search in the top bar." | Stale layout-level expectation; shell exposes `GlobalSearch`, `NotificationCenter`, `RoleBadge`. |

### Live staging evidence from evaluation cycle

Evidence directories:
- `.codex-evidence/pim-role-eval-2026-04-29T20-56-44-855Z`
- `.codex-evidence/pim-role-eval-resume-2026-04-29T20-58-55-132Z`

Observed/measured:
- Login API: 1.704 sec first run, 1.318 sec resume run.
- Dashboard load after login: 6.773 sec first run.
- Product list load: 4.799 sec first run, 6.450 sec resume run.
- Product create: `TEST-MERCHANDISER-PRODUCT-001-02-27-00`; submit wait 5.118 sec; form had 11 fields and fit viewport.
- Variant create: 0.904 sec; edit/delete controls not found.
- Product validation: 2.527 sec; blockers visible for several channels.
- Unsaved-change warning: failed on product title edit followed by Variants tab navigation.
- Category parent/child creation: about 4.05 sec each.
- Bulk import: upload/submit path observed, 7.076 sec wait, full verification partial.

### Final git status

```text
 M apps/api/test/integration/workspace-user-crud.test.cjs
 M docs/execution/ACCESS_POLICY_EXECUTION_RECORD_2026-04-26.md
 M docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md
 M docs/execution/ACCESS_POLICY_PO_CHECKPOINT_2026-04-26.md
 M docs/execution/INCREMENT_STATE.json
?? .codex-evidence/
?? docs/execution/VEXA_PIM_PRODUCT_CTO_UIUX_REVIEW_2026-04-30.md
```

Only the dated review document was intentionally created by this task. The other modified/untracked entries were present before the documentation write or came from prior evidence capture and were not reverted.

## 18. Source appendix

### Files inspected

- `AGENTS.md`
- `docs/execution/INCREMENT_STATE.json`
- `docs/execution/ACCESS_POLICY_EXECUTION_RECORD_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`
- `docs/execution/ACCESS_POLICY_PO_CHECKPOINT_2026-04-26.md`
- `docs/execution/VEXA_PIM_ENTERPRISE_DELEGATED_ACCESS_REPORT_2026-04-25.md`
- `docs/execution/VEXA_PIM_PO_CTO_LAUNCH_GATE_2026-04-16.md`
- `docs/product/user-guide/TEJ_PIM_MASTER_USER_GUIDE.md`
- `docs/user-guide.md`
- `docs/openapi.json`
- `docs/openapi.yaml`
- `docs/runbooks/*`
- `packages/db/prisma/schema.prisma`
- `apps/api/src/common/rbac/roles.ts`
- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/src/catalog/catalog.controller.ts`
- `apps/api/src/taxonomy/taxonomy.controller.ts`
- `apps/api/src/billing/billing.controller.ts`
- `apps/api/src/workspace-users/*`
- `apps/api/src/api-keys/*`
- `apps/web/package.json`
- `apps/web/src/app/layout.tsx`
- `apps/web/src/components/nav/app-sidebar.tsx`
- `apps/web/src/components/nav/authenticated-shell.tsx`
- `apps/web/src/components/nav/global-search.tsx`
- `apps/web/src/components/nav/notification-center.tsx`
- `apps/web/src/lib/admin-navigation.ts`
- `apps/web/src/lib/role-capabilities.ts`
- `apps/web/src/lib/api/core.ts`
- `apps/web/src/app/catalog/products/page.tsx`
- `apps/web/src/components/product/products-tab.tsx`
- `apps/web/src/app/products/[id]/page.tsx`
- `apps/web/src/app/products/[id]/_components/*`
- `apps/web/src/app/operations/*`
- `apps/web/src/app/quality/*`
- `apps/web/src/app/channels/*`
- `apps/web/src/app/connectors/*`
- `apps/web/src/app/admin/*`
- `apps/web/test/integration/*.test.cjs`

### Tests inspected/run

- API access-policy foundation/remediation/delegated/access-role tests listed in validation appendix.
- API notifications and workspace-user CRUD tests listed in validation appendix.
- Web route contracts and UI tests under `apps/web/test/integration`.
- Gate scripts under `scripts/run-increment-gates.cjs`, `scripts/run-sprint-gates.cjs`, `scripts/validate-deploy-staging-workflow.cjs`, and `scripts/staging-postdeploy-check.test.cjs`.

### Routes inspected

See the "Screens/routes reviewed" section for the route list. Build output also proves the corresponding Next.js routes compiled.

## Final note

The correct commercial posture is disciplined optimism: Vexa PIM is a strong controlled-pilot candidate with unusually mature backend access-policy evidence, but it is not enterprise-ready until UI/release blockers are closed and at-scale marketplace operations are measured.
