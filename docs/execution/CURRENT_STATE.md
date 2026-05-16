# Vexa PIM Current State

- Date: 2026-05-16
- Repo HEAD: main (INC-35, INC-36, INC-39 all merged via PRs #55–#58) + fix/oidc-guard-policy (guard fix, PR in review)
- Scope: current code, current validation output, sellability proof slices, Large Import Mode MVP, release-governance state, and Gate C enterprise increments (INC-35 RBAC, INC-36 localization schema, INC-39 OIDC SSO — all merged)
- Naming note: customer-facing product brand is `Vexa PIM`; legacy repo/package/env identifiers still use `PIM1`

## 1. Current Truth Summary

- Targeted code-level production-readiness blockers around web JWT/session fail-closed behavior, privileged internal route trust boundaries, web build/increment gate stability, submissions and DLQ count honesty, readiness proxy failure masking, and catalog products pagination have been closed in the current repo state.
- Large Import Mode MVP is now implemented as an additive path for single-file CSV imports from `10,001` to `30,000` rows, with one parent run, one unified repair/result flow, and one combined error report.
- The safe claim boundary for imports is now explicit: standard CSV/JSON imports remain capped at `10,000` rows; large mode is CSV-only and blocks files above `30,000` rows.
- Sellability slices for revision-backed approvals, validate-before-import, responsive/accessibility hardening, golden-path browser proof, and user-guide traceability have been completed in the current repo state.
- The current local validation bundle is green for API lint/build, web lint/build/test, and targeted buyer-journey browser proof.
- Fresh release-governance evidence is now checked in: the latest staging rollout snapshot `docs/execution/rollout/2026-05-12_CONTROLLED_ROLLOUT_SNAPSHOT.json` reports `healthOk: true`, `controlledPending: []`, and `broadPending: []`. All gates are green.
- `INC-08` is complete in the execution ledger and current live rollout evidence confirms all gates green as of 2026-05-12.

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
- Enterprise Gate C work: INC-35 (8-role RBAC), INC-36 (localization schema), INC-39 (OIDC SSO login) all merged to main. Enterprise signoff requires RG-C4 (bundles), RG-C5 (workflow), RG-C6 (search).

### Not allowed to say

- Enterprise-ready (Gate C requires RG-C4/C5/C6 after current PRs merge)
- OIDC fully enforced (PR #58 merged; OIDC login and per-tenant config API are live; no admin UI for IdP config yet)
- Self-serve billing
- All launch docs current before review
- All historical review docs are current

### Current decision

- Demo readiness: allowed
- Controlled pilot posture: allowed (2026-05-12 rollout snapshot: all gates green)
- Paid SMB / early mid-market posture: allowed with the documented claim boundary
- Production signoff: allowed pending final enterprise-readiness checklist
- Enterprise signoff: blocked (RG-C4/C5/C6 open)

## 5. Validation Snapshot

Most recent local validation rerun in this repo state:

- `npm run lint --workspace @pim1/api` - pass
- `npm run build --workspace @pim1/api` - pass
- `npm run lint --workspace @pim1/web` - pass
- `npm run build --workspace @pim1/web` - pass
- `npm run test --workspace @pim1/web` - pass (`WEBTEST_SUMMARY total=99 failed=0`)
- `npx playwright test apps/web/test/e2e/demo-tenant-end-to-end.spec.js --config playwright.config.cjs` - pass
- `npx playwright test apps/web/test/e2e/publish-failure-recovery.spec.js --config playwright.config.cjs` - pass
- `npx playwright test apps/web/test/e2e/pending-feedback.spec.js --config playwright.config.cjs` - pass
- `npx playwright test apps/web/test/e2e/large-import-mode.spec.js --config playwright.config.cjs` - pass
- `npx playwright test apps/web/test/e2e/viewport-core-workflows.spec.js --config playwright.config.cjs` - pass
- `npx playwright test apps/web/test/e2e/keyboard-core-journey.spec.js --config playwright.config.cjs` - pass
- `npm run gate:run:increment` - pass

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

## 7. Active Production-Signoff Blockers

Source: `docs/execution/INCREMENT_STATE.json` plus current validation truth

1. The latest checked-in rollout snapshot `docs/execution/rollout/2026-05-09T06-30-00.032Z_CONTROLLED_ROLLOUT_SNAPSHOT.json` is still blocked for launch-governance use: it shows `controlledRollout.pending = ["Health endpoint env mismatch: expected 'staging', got 'unset'."]` even though `broadRollout.criteria.observationWindowDaysCovered = 15 / 14`.
2. Historical April and early-May review documents remain useful context, but must not be treated as the current launch truth when they conflict with current code or the latest artifacts.
3. The execution ledger still records `INC-08` as complete, but current external production claims should follow a fresh healthy rollout snapshot rather than older green snapshots.

## 8. Future-Scope And Follow-Up Items

- Add a dedicated backend path for hide-test-data filtered catalog totals if very large catalogs make the current slim-page scan too expensive.
- Add stronger browser proof and operational evidence before broadening any import claim beyond the current `30,000`-row CSV boundary.
- Keep connector/runtime claims bounded to connector-specific evidence.
- Do not expand enterprise-role UX claims beyond the current four-role frontend plus delegated-scope explanation until dedicated shells are implemented and validated.

## 9. Reviewer Guidance

- For code and release truth, prefer current code plus the latest validation output over older review prose.
- Use `docs/execution/INCREMENT_STATE.json` to judge whether release governance is actually closed.
- Treat April 2026 execution and review docs as historical context unless their claims are still reproduced by the current repo state.
