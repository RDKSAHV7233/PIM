# P1 Woo Auth / JWT Revocation — Required-Team Review (post-hoc)

Date: 2026-09-05
Reviewed artifact: PR [#722](https://github.com/bhoivishal216-ai/PIM/pull/722), "P1: WooCommerce auth-revocation fail-closed technical proof", branch `proof/p1-woo-auth-technical-proof-20260905-a`, head SHA `14adabff` — **merged to `main` as `63c24d02` at 2026-09-05T15:07:57Z**.
Reviewers: this session, filling the "required team" roles defined in `docs/execution/REQUIRED_TEAM_AGENT_HANDOFF_2026-09-04.md` via three separate adversarial Claude Sonnet 5 reviews (two specialist technical lanes, one CTO/PO/QA/Security/SRE synthesis), each given only the actual diff/tests/docs and told to be skeptical.

**This is a post-hoc review.** The PR was merged before this review ran, and after `docs/execution/P1_WOO_AUTH_SIGNOFF_REVIEW_2026-09-05.md` had already recorded Security/QA/SRE as NO-GO for the same work. Section 1 below treats that sequencing as a first-class finding, not a footnote.

## External facts (independently verified, not self-reported by the PR)

- CI on the exact reviewed SHA (`14adabff`): `detect-changes`, `build`, `backend-tests`, `e2e` all green.
- The exact SHA was deployed to shared staging via a dedicated `workflow_dispatch` (GitHub Actions run [33973982774](https://github.com/bhoivishal216-ai/PIM/actions/runs/33973982774)) — all 30 steps passed: readiness probe, post-deploy auth/trust-boundary verification, Internal Ops Summary/Errors acceptance, public-signup smoke check, E2E smoke.
- Separately, the PR was merged into `main` (`63c24d02`) at 2026-09-05T15:07:57Z, which also triggered the ordinary push-based staging deploy — so the same code landed on staging twice, by two different trigger paths.
- No real external proof exists yet of: live WooCommerce app-auth onboarding against an actual store, tenant ownership of real (non-mocked) credential rows, or an induced-outage test against deployed staging Redis/the blocklist observing the fail-closed/degraded policy hold in reality. Only local unit/mock tests and static code review exist for both halves of this PR.

## 1. Process finding — governance gap

This is a governance violation, not a technicality, on two independent counts:

- **Backend Lead stop condition** ("Stop if Woo fix and auth policy are mixed in one PR"): PR #722's own title and technical-proof doc bundle the WooCommerce app-auth fix (P1-1) and the JWT revocation fail-closed policy (P1-2) into one branch/PR, despite the handoff doc — written one day earlier — having already split this work into two separate blocker branches specifically to avoid this.
- **CTO / Approval Gate stop condition** ("No merge... until CTO records decision"; Approval Gate requires "CTO, PO, Security, QA, and SRE record a fresh readiness decision"): `P1_WOO_AUTH_SIGNOFF_REVIEW_2026-09-05.md` had already recorded Security, QA, and SRE as explicitly **NO-GO**. The PR merged to `main` anyway, before any required-team technical review — including this one — had actually run.

CI passing and staging-deploy succeeding are necessary conditions the handoff doc explicitly separates from sufficiency. The substantive review step that was skipped here is tenant-isolation- and auth-security-relevant, not cosmetic, so this is treated as a real governance incident (see follow-up #7/#8 below), not an administrative footnote.

## 2. Technical findings

### P1-2: JWT revocation fail-closed policy — CONCERNS

- **PASS** — code matches the documented policy exactly: every revocation-check failure either denies outright or is gated by an explicit closed allowlist (`public_safe` classification / `taxonomy_safe_metadata` policy) for GET/HEAD/OPTIONS only. No silent fail-open found anywhere, including on an adjacent untouched file (`step-up.guard.ts`), which still fails closed by not catching the exception.
- **PASS** — monitoring exists: warn logs plus Error Authority capture (`severity: "p1"`) on every outage event, though no dedicated fail-closed-vs-degraded metric/dashboard exists yet.
- **PASS** — test coverage genuinely simulates outage (mocked rejected promises) for mutating/admin/step-up/refresh paths, not just the happy path.
- **CONCERN** — the policy decision doc's own stated operational requirement for an explicit **maximum duration / circuit breaker** on the degraded-read allowance is not implemented. Degraded mode is unbounded for as long as Redis stays down.
- **CONCERN** — no staging runtime proof of the actual outage behavior exists. Nobody has actually killed/blocked Redis on deployed staging and observed the policy hold end-to-end; only mocked local tests exist.

**Disposition: leave in `main`, do not revert.** No fail-open path was found. The gap is an availability/blast-radius concern (unbounded degraded window), not a "the code is unsafe as merged" concern — worth fixing promptly, not worth reverting a net-positive security change over.

### P1-1: WooCommerce app-auth tenant-key enforcement — CONCERNS

- **PASS** — tenant-key enforcement on `handleOAuthCallback` / `getPlainCredential` / `parseWebhookEvent` is real and correctly implemented at the app layer: a missing tenant context throws before any DB call, not a silent default.
- **PASS** — test coverage is genuine (verified by hand-tracing parameter positions against real call signatures), not test theater.
- **CONCERN** — the "manual tenant filter" / RLS-bypass comment overstates what's actually enforced. The raw-SQL upsert's `ON CONFLICT DO UPDATE` has no DB-level `WHERE tenant_key = $1` ownership guard and uses a non-tenant-scoped Prisma client; safety rests entirely on `installationId` UUID uniqueness. This matches pre-existing Shopify precedent in the same codebase — not a novel regression — but the comment's claim is stronger than the actual guarantee, and should be corrected.
- **CONCERN** — a new, untested failure interaction: if `resolveCredentials` throws for a missing tenant context (newly possible after this PR) during a `validateCredentials()` heartbeat check, it will misreport "invalid credentials" rather than "unavailable" — the exact bug class BUG-WOO-HEALTH-001/#472 was created to prevent, reachable via a new trigger, and currently untested.

**Disposition: leave in `main`, do not revert.** Strict improvement over prior state; no evidence of regression. Not safe to treat as "tenant isolation solved" until the DB-level guard is added.

## 3. Follow-up work required, prioritized

| # | Follow-up | Owner (per handoff role table) | Urgency |
|---|---|---|---|
| 1 | Run an actual induced-Redis-outage test against deployed staging and capture evidence | SRE/Platform + Auth/IAM Engineer | Immediate |
| 2 | Implement circuit breaker / explicit maximum duration on the degraded-read auth allowance | Auth/IAM Engineer, reviewed by Security Lead/AppSec | High |
| 3 | Run real staging WooCommerce app-auth onboarding against a live store; verify credential rows are tenant-owned (not mocked) | WooCommerce Connector Engineer + Data/Multi-tenant Reviewer | Immediate |
| 4 | Add DB-level tenant-ownership guard on the WooCommerce credential upsert (`WHERE tenant_key = $1` on conflict); correct the misleading RLS-bypass comment | WooCommerce Connector Engineer, reviewed by Data/Multi-tenant Reviewer | High |
| 5 | Add a test for `validateCredentials()` behavior when `resolveCredentials` throws for missing tenant context; confirm it reports "unavailable," not "invalid" | WooCommerce Connector Engineer + QA/Reliability | High |
| 6 | Add a dedicated fail-closed-vs-degraded metric/dashboard for the revocation policy | SRE/Platform | Medium |
| 7 | Enforce mechanically (branch protection / PR template check / release process) that P1-domain fixes cannot be merged as one bundled PR, and that merge is blocked until CTO decision is recorded | Release Engineering/Git Maintainer + CTO/Architecture Review Board | High |
| 8 | Root-cause why #722 merged ahead of required-team review despite a recorded NO-GO, and close that process gap | CTO / Architecture Review Board | Medium |

## 4. Approval Gate verdict: **NO-GO**

Customer onboarding / live promotion remains **NO-GO**, consistent with (not a softening of) `P1_WOO_AUTH_SIGNOFF_REVIEW_2026-09-05.md`'s own recorded Security/QA/SRE NO-GO. CI-green and staging-deploy-green do not satisfy the Approval Gate's additional explicit requirements:

- P1-2's failure policy is implemented but not "signed and implemented or explicitly accepted by Security/SRE/CTO" — the max-duration requirement is unmet and no formal sign-off has been recorded since merge.
- Required runtime evidence (real Woo onboarding, real tenant-ownership proof on non-mocked rows, real induced-outage proof on deployed staging) is entirely absent.
- No fresh, *named* CTO/PO/Security/QA/SRE decision has been recorded for the state as merged — this document is an agent-run technical review, not that decision.

**What would flip this to GO:** follow-ups #1 and #3 executed with evidence captured against the deployed SHA; follow-up #2 implemented or an explicit written, time-bound risk acceptance signed by Security Lead and SRE; follow-up #4 at minimum scheduled with a committed date; named CTO/PO/Security/QA/SRE individuals actually recording approval; and a concrete fix for the process gap in §1 so it doesn't repeat.

## 5. Summary for the human CTO/PO

PR #722 shipped two real security improvements (WooCommerce credential tenant-checks and a JWT-outage fail-closed policy) that don't need to be reverted — neither fails open. But it was merged to `main` before the required security/QA/SRE review ran, and after your own signoff doc had already recorded NO-GO for exactly this work. Nobody has tested it against a live WooCommerce store or a real Redis outage — only mocked tests exist — and one documented safety net (a time limit on degraded-mode auth) was never built. Recommendation: don't revert, hold customer onboarding at NO-GO until real onboarding and outage tests are run and you personally record sign-off, and separately, find out why this merged ahead of review so it doesn't happen again.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
