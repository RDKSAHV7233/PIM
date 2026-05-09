# Vexa PIM Current State

- Date: 2026-05-09
- Repo HEAD: `56b29e6`
- Scope: current code, current validation output, and release-governance state after the P0 regression fixes, rollout-health contract restoration, and the latest checked-in remote rollout evidence review
- Naming note: customer-facing product brand is `Vexa PIM`; legacy repo/package/env identifiers still use `PIM1`

## 1. Current Truth Summary

- Targeted code-level production-readiness blockers around web JWT/session fail-closed behavior, privileged internal route trust boundaries, web build/increment gate stability, submissions and DLQ count honesty, readiness proxy failure masking, and catalog products pagination have been closed in the current repo state.
- Large Import Mode MVP is now implemented as an additive path for single-file CSV imports from `10,001` to `30,000` rows, with one parent run, one unified repair/result flow, and one combined error report.
- The safe claim boundary for imports is now explicit: standard CSV/JSON imports remain capped at `10,000` rows; large mode is CSV-only and blocks files above `30,000` rows.
- The current local validation bundle is green for API lint/build, web lint/build/test, both targeted Playwright proofs, and both repo gate suites.
- Fresh release-governance evidence is checked in on remote `main`: the latest staging rollout snapshot `docs/execution/rollout/2026-05-09T06-30-00.032Z_CONTROLLED_ROLLOUT_SNAPSHOT.json` reports `healthOk: true`, `controlledPending: ["Health endpoint env mismatch: expected 'staging', got 'unset'."]`, and `broadPending: []`.
- `INC-08` remains complete in the execution ledger based on earlier evidence bundles, but the newest live rollout snapshot should govern current launch claims. Broad-rollout observation is complete again; the remaining blocker is the controlled-rollout health-contract mismatch on deployed staging.

## 2. Canonical Source-of-Truth Files

- Product baseline: `docs/product/PRD.md`
- Execution ledger: `docs/execution/INCREMENT_STATE.json`
- Runtime state notes: this file
- Release-risk documentation: `docs/execution/PROD_READINESS_RISK_REGISTER.md`
- UI/UX pilot execution record: `docs/execution/VEXA_PIM_UIUX_PILOT_READINESS_EXECUTION_PLAN_2026-04-30.md`
- Product/CTO review history: `docs/execution/VEXA_PIM_PRODUCT_CTO_UIUX_REVIEW_2026-04-30.md`

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
- Large Import Mode MVP is available for controlled pilot and early SMB / mid-market use within the documented CSV-only `30,000`-row boundary.
- Local code validation is green again, but the checked-in rollout evidence is stale and must be refreshed before controlled-pilot or broader release-governance claims are restored.
- Enterprise-readiness remains out of scope for the current evidence bundle.

### Not allowed to say

- Enterprise-ready
- All launch docs current before review
- All historical review docs are current

### Current decision

- Demo readiness: allowed
- Controlled pilot posture: pending fresh rollout evidence
- Production signoff: blocked pending fresh controlled-rollout evidence on deployed staging
- Enterprise signoff: blocked

## 5. Validation Snapshot

Most recent local validation rerun in this repo state:

- `npm run lint --workspace @pim1/api` - pass
- `npm run build --workspace @pim1/api` - pass
- `npm run lint --workspace @pim1/web` - pass
- `npm run build --workspace @pim1/web` - pass
- `npm run test --workspace @pim1/web` - pass (`WEBTEST_SUMMARY total=98 failed=0`)
- targeted Playwright proof:
  - `apps/web/test/e2e/pending-feedback.spec.js` - pass
  - `apps/web/test/e2e/large-import-mode.spec.js` - pass
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
