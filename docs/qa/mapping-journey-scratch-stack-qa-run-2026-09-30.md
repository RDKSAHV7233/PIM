# Vexa Channel Mapping: scratch-stack QA run (2026-09-30)

Environment: a **local** scratch stack, not production. API on `localhost:4001` and web on `localhost:3001`, built from
`main` (`0afb169c`), using the repo's isolated `playwright_e2e` schema in the local Postgres and the seeded test
identities and password from the tracked `.env.playwright`. Nothing in this run touched app.vexapim.com.
This covers the cases the production runs could not do: roles, step-up, publish, rollback, archive.

## Method notes (read before trusting numbers)
- The first attempt at an "after" run silently tested the OLD code: the worktree had been reset to its original branch
  (`86e9e1bf`) by the environment, so both the "mine" and the "baseline" runs used the same commit. That conclusion was
  discarded. The valid comparison below was rerun with the worktree confirmed on `0afb169c` and the web build cleared.
- The category tree is cached for 60 s, so a category created through the API is not visible to the wizard immediately.

## 1. Existing Playwright specs: baseline vs current main
Same 6 spec files (20 tests) run against `86e9e1bf` (before any of the mapping fixes) and against `0afb169c`.

| | passed | failed |
|---|---|---|
| Baseline `86e9e1bf` | 9 | 11 |
| Current `main` `0afb169c` | 9 | 11 |

Per-test comparison: **0 differences**. None of PRs #1001 to #1010 changed the outcome of any of these specs.
The same 11 tests fail in both runs: `channels-mapping-hydration` (1), `channels-mapping-publish-complex-blockers` (1),
`channels-mapping-publish` (4), `shopify-field-mapping` (1), `rbac-role-enforcement` (publisher, approver, connector_admin) and
`rbac-admin-boundary-roles` (connector_admin). Causes were only checked for some: the `shopify-field-mapping` failure is a
`POST /catalog/products` setup call rejected with 400 "property sku should not exist", and several others are 10 s
`toBeVisible` / `toContainText` timeouts. The rest were not diagnosed. Two more specs (`channels-mapping-account-change`,
`shopify-account-mismatch`) hit a plan limit on a first, discarded run and are not part of the comparison.
These are pre-existing in this environment (identical on the baseline), not regressions from the mapping PRs; an owner should triage them.

## 2. API cases (scratch API, 29 checks)
| Area | Result |
|---|---|
| All 8 seeded roles can log in | PASS |
| Who can create a mapping draft | admin, editor, channel_manager. Denied (403): reviewer, viewer, publisher, approver, connector_admin. |
| Who can list mapping versions | admin, editor, channel_manager (200); the other five roles get 403. |
| Forged validate/archive by viewer, reviewer, publisher, approver | All rejected (403). channel_manager can validate (a legitimate writer) but not archive. |
| Unauthenticated write | 401 |
| Validate a complete draft | PASS |
| Publish without a step-up token | 401 `STEP_UP_REQUIRED` |
| Publish with a forged token / wrong-scope token / another user's token / `confirm:false` | All rejected |
| Step-up with the wrong password | 401 `STEP_UP_INVALID_CREDENTIALS` (see DEF-26 for the UI consequence) |
| Publish with a valid step-up | PASS |
| Viewer cannot publish even with their own step-up | 403 |
| Publishing v2 supersedes v1 (exactly one live version in scope) | PASS |
| Rollback restores v1 as a new published version; one live | PASS |
| Rollback / archive without step-up | Rejected (401) |
| Archive without step-up / with a too-short reason | 401 / 400. (The first attempt at a successful draft archive used a 2-character reason, which the API correctly rejects; a successful draft archive and a repeat-archive were **not** re-run, so no result is claimed.) |
| Archive the live version | 201 (allowed by design; DEF-07) |
| Malformed JSON, wrong-typed rules, oversized rules, unknown id, quote characters in the category scope | 400 / 400 / 201 / 404 / 200; never a 5xx |
| Duplicate creates (D4) | Two versions, as documented in the decision record |
| Validating with unmapped `required_fields` | Succeeds, by design (DEF-15 was reclassified) |

## 3. UI cases (scratch web app, real clicks)
| Case | Result |
|---|---|
| **DEF-16** double-click on "Save draft version", machine-instant | **1 draft** (the old build made 2) |
| DEF-16 at human speed (150 ms between clicks) | At 150 ms the button was disabled and read "Saving draft..."; **1 draft** |
| Validate through the UI, then Publish with the correct test password | PASS: "Version 1 (all connector accounts) is currently live" |
| Publish with a WRONG step-up password | **FAIL (DEF-26)**: see below; fixed and re-verified |
| Viewer role: sidebar and direct URL | No Mappings link in the sidebar; the direct URL bounces to the dashboard with no explanation (DEF-28) |

## 4. New defects from this run
| ID | Sev | Finding | Status |
|---|---|---|---|
| **DEF-26** | **P1** | A wrong step-up password on Publish or Archive was treated as an expired session: the operator was redirected to the login page and then the dashboard, losing their place, and the intended "Step-up re-authentication failed" message was never shown. The API returns `401 {"error":"STEP_UP_INVALID_CREDENTIALS"}` and the session-expiry classifier treated every 401 as an expired session. Very likely the cause of the odd `login?next=%2Fdashboard` seen in production (DEF-25), not confirmed. | **Fixed** in the accompanying PR; verified in the browser: the operator stays on the mapping page with "The password was not accepted. Re-enter your password to publish this mapping version." |
| DEF-27 | P2 | A draft with compatibility "Blocked" was accepted by validate (201); publishing such a version was not re-checked in this run. Readiness still blocks exports, so this may be intended. | Needs a product ruling |
| DEF-28 | P3 | A role without mapping access who opens `/channels/mappings` directly is redirected to the dashboard with only a generic "some dashboard data is restricted" banner, not a message saying mappings need a channel-manager role. | Open |

## 5. Not covered
- Cross-tenant isolation (the scratch stack has one tenant), mid-session expiry, other browsers, screen readers, throttled performance, concurrent users.
- Archive and rollback through the UI (covered through the API only).
- The role-based UI checks for publisher, approver, connector_admin, reviewer (only viewer was checked in the UI; the API matrix covers all 8).
