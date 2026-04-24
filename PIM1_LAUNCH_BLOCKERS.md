# PIM1 Launch Blockers

- Audit date: 2026-03-31
- Audit start HEAD: `78dd1c5`
- Continuation refresh HEAD: `8911dc5`
- Launch verdict from current repo truth: **NOT READY**
- Current positive note: API build health recovered on the refreshed HEAD. `npx tsc -p apps/api/tsconfig.build.json --noEmit`, `npm run lint --workspace @pim1/api`, and `npm run build --workspace @pim1/api` all passed on `8911dc5`.

## Ranked blockers

| Rank | Severity | Blocker | Why it blocks launch | Evidence |
|---|---|---|---|---|
| 1 | Critical | `Variant.skuCode` is globally unique | Multi-tenant SKU namespaces are coupled across tenants. Tenant isolation is a release blocker in this repo. | `packages/db/prisma/schema.prisma:180`, `packages/db/prisma/schema.prisma:185` |
| 2 | Critical | `Category.slug` is globally unique | Tenant taxonomy namespaces are coupled across tenants. | `packages/db/prisma/schema.prisma:104`, `packages/db/prisma/schema.prisma:108` |
| 3 | High | Raw SQL trust boundary still depends on manual tenant filters | Many services use `RLS-BYPASS` and rely on developer discipline instead of automatic tenant scoping. | `apps/api/src/audit/audit.service.ts:81`, `apps/api/src/billing/plan-usage.service.ts:589`, `apps/api/src/compliance/compliance.service.ts:173`, `apps/api/src/dashboard/dashboard.service.ts:338`, `apps/api/src/marketplace/marketplace.service.ts:423`, `apps/api/src/media/media.service.ts:272` |
| 4 | High | Connector launch scope is not production-complete | Flipkart is the only seller-ready connector path; Amazon is `planned`; Meesho is `manual`; the safe fallback registry defaults to Flipkart only. | `apps/api/src/connector-framework/connector-launch-policy.ts:17`, `apps/api/src/connector-framework/connector-launch-policy.ts:26`, `apps/api/src/connector-framework/connector-launch-policy.ts:52`, `apps/web/src/app/connectors/page.tsx:131`, `apps/web/src/app/connectors/page.tsx:135` |
| 5 | High | Root verification still fails on a critical connector semantics path | `cmd /c npm.cmd test` still stops in `connector-idempotency-semantics` with `401 INVALID_CREDENTIALS`, so the top-level repo health signal is still red. | `cmd /c npm.cmd test`, `apps/api/test/integration/connector-idempotency-semantics.test.cjs` |
| 6 | High | Several important suites still fail on auth/workspace bootstrap | Current failures include `marketplace-capability-gating` (`401 INVALID_CREDENTIALS`), `bulk-edit-empty-scope` (`404 WORKSPACE_NOT_FOUND`), and `media-ssrf-guard` (`404 WORKSPACE_NOT_FOUND`). | `cmd /c npm.cmd run test:integration:marketplace-capability-gating`, `cmd /c npm.cmd run test:integration:bulk-edit-empty-scope`, `cmd /c npm.cmd run test:integration:media-ssrf-guard` |
| 7 | Medium | Several standalone integration suites are environment-blocked by child-process launch failures | `env-validation`, `catalog-completeness`, `mapping-manager`, and `bulk-import-tenant-boundary` hit `spawn EPERM` in the current environment, so those proofs remain incomplete. | `cmd /c npm.cmd run test:integration:env-validation`, `cmd /c npm.cmd run test:integration:catalog-completeness`, `cmd /c npm.cmd run test:integration:mapping-manager`, `cmd /c npm.cmd run test:integration:bulk-import-tenant-boundary` |
| 8 | Medium | Important browser flows require missing outbox configuration | Signup/commercial browser proof is incomplete until `PLAYWRIGHT_SIGNUP_OUTBOX_DIR` is provisioned. | `npx playwright test --config=playwright.config.cjs`, `apps/web/test/e2e/admin-plan-signup-export.spec.js`, `apps/web/test/e2e/admin-plan-upgrade-request.spec.js`, `apps/web/test/e2e/dashboard-signup-drilldown.spec.js`, `apps/web/test/e2e/internal-commercial-audit-followup.spec.js`, `apps/web/test/e2e/internal-commercial-ops.spec.js`, `apps/web/test/e2e/public-signup.spec.js` |
| 9 | Medium | Admin/settings launch surface still contains redirect and placeholder debt | `/admin/workspace` is a placeholder; `/settings*` and `/reports` are aliases, not standalone production surfaces. | `apps/web/src/app/admin/workspace/page.tsx:11`, `apps/web/src/app/admin/workspace/page.tsx:23`, `apps/web/src/app/settings/page.tsx:6`, `apps/web/src/app/settings/plan/page.tsx:6`, `apps/web/src/app/settings/privacy/page.tsx:6`, `apps/web/src/app/settings/connectors/page.tsx:6`, `apps/web/src/app/reports/page.tsx:6` |
| 10 | Medium | Execution ledger still shows rollout evidence open under `INC-08` | Even if code and tests were cleaner, the checked-in launch evidence is still incomplete. | `docs/execution/CURRENT_STATE.md:68`, `docs/execution/CURRENT_STATE.md:87`, `docs/execution/INCREMENT_STATE.json:498`, `docs/execution/INCREMENT_STATE.json:500` |

## Blocking vs post-launch

### Launch blockers

- Make SKU and category uniqueness tenant-scoped.
- Reduce or harden manual-tenant-filter raw SQL paths.
- Keep connector launch truth strict until Amazon and Meesho are genuinely ready.
- Fix the remaining auth/workspace bootstrap failures in critical integration suites.
- Remove `spawn EPERM` blockers from standalone integration runs.
- Restore clean browser verification for signup/commercial paths.

### Post-launch improvements

- Improve the workspace settings surface or remove it from the main admin shell.
- Continue rollout-evidence accumulation and automate sign-off reporting.
