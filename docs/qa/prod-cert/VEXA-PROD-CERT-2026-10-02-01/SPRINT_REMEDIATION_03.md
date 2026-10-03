# Sprint R3 (INC-86 proposal) - deploy-pipeline integrity

Rule: live baseline first, one PR per story, review, merge one at a time, verify.

## Investigation (root cause, evidence)
- **Live baseline (2026-10-02/03):** web build lagged `main`: #1049 (web) merged but `/catalog/media` served the old HTML (220 unlabeled inputs) after the final deploy `37817c02` succeeded.
- `deploy-staging.yml` runs one deploy at a time, but GitHub keeps ONE pending run: of #1049/#1050/#1051 merged in ~90 s, runs for 8d250ebf and 3ab242d0 were `cancelled`.
- `scripts/railway-deploy.cjs getChangedFiles()` diffs `GITHUB_EVENT_BEFORE..GITHUB_SHA` (the previous *push*, not the previous *deploy*). The surviving run's diff was only #1051 (apps/api) -> web skipped. The API/web packages are built per service from `apps/api` / `apps/web`, so a skipped service stays on an older build.
- Impact: "merged" != "live" after any burst of merges; silent (workflow is green).

## Stories
| ID | Change | Acceptance criteria |
|---|---|---|
| R3-S1 (DEF-PC-021, P2) | Diff against the **last successful push deploy of `main`** (verified ancestor of HEAD) instead of the previous push; if unknown -> deploy BOTH (fail safe). Manual `deploy_targets` override unchanged. | AC1 cancelled runs' changes are included in the next run's targets (unit-tested with the incident's sequence). AC2 lookup failure, non-ancestor SHA, or no prior success -> api+web. AC3 manual dispatch runs are never used as a base. AC4 `validate-deploy-staging-workflow` and `railway-deploy.test` pass. |
| R3-S2 (DEF-PC-008) | **CTO decision: accept and document, no code.** Public `/api/v1/health` exposes env label + queue names only; the deploy scripts consume them (see R2 notes). Revisit only together with a pipeline migration. | Risk recorded in BUG_REGISTER as ACCEPTED. |
| R3-S3 | DEF-PC-003/005/009/015 stay a spike: need Railway replica counts, DB pool size, edge XFF behaviour, Sentry DSN (owner facts). | Not started. |

## Role review (summary)
SRE: fail-safe default (both services) costs only extra deploy time. Security: workflow gets explicit least-privilege `contents: read, actions: read`; no secrets used by the new step. QA: incident sequence replayed in a unit test. PO: no user-facing change. CTO: approves S1; S2 accepted risk.

## Delivery and live verification (2026-10-03)
| Item | PR | Result |
|---|---|---|
| R3-S1 base = last successful push deploy | #1053 (needed `cto-required-team-approved`; a re-run does not see a new label, a new commit does) | merged; own deploy `54682c1f`: both services deployed |
| R3-S1b stale API answers | #1054 | merged; its deploy resolved base `54682c1f` correctly |
| R3-S2 DEF-PC-008 | - | ACCEPTED risk (deploy scripts consume the public body) |

**Field proof of DEF-PC-021 fix:** the run for #1055 (`a7345a53`, web change) never started (GitHub: "recent account payments have failed or your spending limit needs to be increased"). The next run (`95bd9209`, #1056) logged `Deploy diff base: 2d369720` (last successful push deploy), whose diff contains #1055's `apps/web` change, and deployed **both** API and web. Under the old logic (`before..sha` = #1055..#1056 = connectors/docs/api) the web fix would have been skipped.
**New risk (owner):** GitHub Actions billing/spending-limit failure blocks all deploys and CI; check Billing & plans.
