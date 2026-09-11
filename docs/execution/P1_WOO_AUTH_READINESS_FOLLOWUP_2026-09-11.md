---
title: P1 Woo/Auth Readiness Follow-Up — Claude Analysis Pass
status: staging-proof-go-live-no-go — unchanged from 2026-09-06
owner: CTO / Security / QA / SRE / PO
prepared_by: Claude (analysis / evidence audit only — not a substitute for named sign-off)
last_updated: 2026-09-11
continues: docs/execution/P1_WOO_AUTH_POST_MERGE_REQUIRED_TEAM_REVIEW_2026-09-06.md
supersedes: nothing — this record cannot grant approval; see Scope below
---

# P1 Woo/Auth Readiness Follow-Up — 2026-09-11

## Scope and authority

This is a Claude-run audit against the evidence checklist in
`P1_WOO_AUTH_POST_MERGE_REQUIRED_TEAM_REVIEW_2026-09-06.md`, requested during
an unrelated connectors-workspace UI change (removing development/lifecycle
status chips from `/channels/connectors`) after a claim surfaced that "P1 is
already resolved." No source for that claim was found in the repository — no
PR, commit, or doc after `#727` (merged 2026-09-06) closes it.

Per `docs/execution/REQUIRED_TEAM_AGENT_HANDOFF_2026-09-04.md`'s Approval
Gate, reopening customer onboarding requires **named** CTO, PO, Security, QA,
and SRE approval. An AI-run review can audit evidence and report a verdict —
which is what this document does — but it cannot itself constitute that
approval. Treat everything below as input to a real review, not as the
review's output.

## Evidence checklist — 09-06 vs. 09-11

| Required evidence | 2026-09-06 | 2026-09-11 |
| --- | --- | --- |
| CI green on the reviewed SHA | Missing | **Still missing.** The three most recent `CI` runs on `main` are all `failure`, including the current tip `05daff6d` ([run 34558958160](https://github.com/RDKSAHV7233/PIM/actions/runs/34558958160), 2026-09-11 03:34 UTC) — failing step: `Integration test coverage drift guard (PIM#754)`, not a compile error. See "New finding" below — this is unrelated to WooCommerce/P1 but still means no run currently qualifies as "CI green." |
| Deploy Staging run from current `main` | Missing | Mixed. Recent runs alternate success/failure; one failure shares a SHA with a `CI` success and vice versa. No run is tied to a green build. |
| `STAGING_DEPLOY_POSTCHECK` artifact | Missing | Not found for this workstream. |
| Controlled rollout snapshot | Missing | Not found. |
| Real Woo app-auth onboarding proof in staging | Missing | Not found. |
| Redacted credential-row evidence (`tenant_key`, `installation_id`, `credential_type`) | Missing | Not found. |
| Live Redis/revocation-authority outage proof | Missing | Not found. |
| Named CTO, PO, Security, QA, SRE approvals | Missing | Not found. |

## Closed since 09-06

Narrow engineering hardening landed, all consistent with what the 09-06 doc
already anticipated ("later Woo tenant-guard hardening exists") and explicitly
said would not by itself change the verdict:

- [#736](https://github.com/RDKSAHV7233/PIM/pull/736) / [#743](https://github.com/RDKSAHV7233/PIM/pull/743) — DB-level tenant guard on WooCommerce/Shopify credential upsert.
- [#746](https://github.com/RDKSAHV7233/PIM/pull/746) / [#747](https://github.com/RDKSAHV7233/PIM/pull/747) / [#750](https://github.com/RDKSAHV7233/PIM/pull/750) — wrap Woo/Shopify credential writes in a transaction.

## New finding not present in the 09-06 record

`main`'s `CI` workflow is currently red on tip `05daff6d`
([run 34558958160](https://github.com/RDKSAHV7233/PIM/actions/runs/34558958160)).
Root cause, confirmed via `gh run view --json jobs`: the `build` job's only
failing step is `Integration test coverage drift guard (PIM#754)`.
`apps/web/test/integration/signup-verify-button-gate.test.cjs` (added when H-1
merged as `6ac77941`, "gate signup verification behind an explicit click") was
never registered in `scripts/check-integration-test-coverage.cjs`. It's a
DB-free, pure static-assertion test (`fs.readFileSync` source checks, no
Prisma/DB access) — the fix is a one-line addition to `GLOB_COVERED_TESTS`.

*(Correction: an earlier version of this document attributed the CI failure to
TypeScript/Prisma-client errors reproduced while booting `apps/api` locally.
Those errors came from this session's own local environment — a `node_modules`
junction whose generated Prisma client didn't match the worktree's schema —
not from `main`. The `build` job's actual failure is the coverage-drift guard
above; unrelated to WooCommerce/P1, but it does mean no current `main` run
qualifies as "CI green.")*

## Per-lens read (audit only, not sign-off)

- **CTO / Architecture** — Tenant-guard and transaction hardening is sound
  directionally. No architecture sign-off can rest on a currently-broken
  build. Unchanged from NO-GO.
- **Security / AppSec** — No new staging outage proof or credential-row
  evidence since 09-06. Fail-closed revocation code exists but remains
  unproven per the org's own checklist. Unchanged from NO-GO.
- **QA / Reliability** — No staging Woo onboarding run recorded since 09-06;
  CI itself is failing, which removes even the local-proof evidence the 09-06
  doc still credited. Unchanged from NO-GO, arguably regressed.
- **SRE / DevOps** — Deploy Staging is executing but inconsistently, with no
  artifact tying a specific SHA to a verified Woo app-auth staging pass.
  Unchanged from NO-GO.
- **PO** — Nothing supersedes the 09-06 block on customer setup/install lanes,
  public claims, and pilot restart. A decision to reopen scope regardless is a
  PO call that needs to be made explicitly and in writing — this document does
  not make it.

## Verdict

**Unchanged: STAGING GO for proof execution only, LIVE NO-GO for
WooCommerce.** Nothing between 2026-09-06 and 2026-09-11 closes the
outstanding evidence in the checklist above, and the new `main` build failure
makes the bar harder to clear, not easier.

## What would actually close this

Everything listed as "Missing" in the evidence table, plus a fix for the
current `main` build failure, followed by named CTO, PO, Security, QA, and
SRE approval recorded the same way `P1_WOO_AUTH_POST_MERGE_REQUIRED_TEAM_REVIEW_2026-09-06.md`
recorded its per-role verdicts.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
