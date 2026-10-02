# Sprint R1 — Production-certification remediation (INC-84)

Status: PLAN + IMPLEMENTATION READY FOR REVIEW. Nothing here is deployed. Production auto-deploys from `main` (single environment, no separate gate), so merging any story reaches real customers.

## 1. Sprint goal
Close the production-certification defects that are confirmed, cheap to fix and independently releasable, with each fix proven by tests, reviewed by every required role, accepted by the PO, approved by the CTO, and verified on live after deploy. Infrastructure-dependent and product-decision items are groomed, not built.

## 2. Team and who actually signs
| Role | Who | What they decide / own in this sprint |
|---|---|---|
| **Product Owner (PO)** | **You (human)** | Accept or reject each story against its acceptance criteria; decide product-behaviour changes (e.g. images-only media). |
| **CTO / Release Commander** | **You (human)** | Approve release order, deploy window, rollback; decide infra items (throttle storage, DB pool). |
| Engineering (Dev) | Agent | Implement, unit/integration tests, negative proofs. |
| QA lead | Agent review | Acceptance-criteria coverage, regression runs, evidence. |
| Security engineer | Agent review | Abuse cases, fail-open/closed, header/content safety. |
| SRE / DevOps | Agent review | Failure modes, rollout, rollback, monitoring. |
| Data/Storage | Agent review | Stored data impact (legacy media). |
| UX/Accessibility | Agent review | User-visible behaviour of the session redirect. |
**Honesty rule:** the agent reviews below are analysis, not approvals. A story is **Done only after the PO accepts and the CTO approves** (the two human sign-off boxes). Until then each story is `ready_for_acceptance`; `INCREMENT_STATE.json` locks are NOT set (AGENTS.md rule 6/7).

## 3. Product backlog (ordered by risk × certainty)
| Pri | Item | Bug | Sprint? |
|---|---|---|---|
| 1 | API process must survive a background-task DB error | DEF-PC-013 (P1) | **S1** |
| 2 | Public media must not host executable content | DEF-PC-002 (P2) + DEF-PC-014 | **S3** |
| 3 | Expired/revoked session must reach the login page | DEF-PC-016 (P2) | **S4** |
| 4 | NUL character must be a 400, not a 500 | DEF-PC-010 (P3, live-confirmed) | **S2** |
| 5 | Redis-backed throttling, coherent per-client limit | DEF-PC-003 (P2, live-confirmed) | Spike S5 (needs CTO decision + Railway facts) |
| 6 | SSR requests share one throttle key | DEF-PC-005 (P1 hypothesis) | Spike S5 |
| 7 | DB pool sizing and saturation alert | DEF-PC-015 | Spike S5 |
| 8 | Internal proof page public | DEF-PC-001 (live-confirmed) | Next sprint (small; PO to confirm) |
| 9 | HSTS, X-Powered-By, public health detail | DEF-PC-017/018/008 | Next sprint |
| 10 | `limit` ignored; import vs create title rule; 429 headers; a11y | DEF-PC-011/012/007/019/020 | Backlog |

## 4. Sprint backlog and acceptance criteria
Edit-scope rule (AGENTS.md §3): each story lists its files; anything else touched is reported as scope expansion.

### S1 — API survives transient DB errors in background timers (DEF-PC-013, P1)
**Investigation:** `OutboundWebhooksService.recoverStuckQueuedDeliveries` runs from `setInterval` and is `try/finally` with no `catch`; a Prisma P2024 pool timeout became an unhandled rejection and the API exited with code 1 (reproduced). No `unhandledRejection` handler exists in the API. 14 other `setInterval(() => void …)` timers exist (not audited).
**Acceptance (Given/When/Then):**
1. Given the recovery query rejects with P2024, when the timer fires, then the error is logged and **no** `unhandledRejection` is raised.
2. Given any other background promise rejects unhandled, when the event fires, then it is logged and the process keeps serving; `uncaughtException` keeps Node's default.
3. The new service test fails with the fix removed (negative proof) and passes with it.
**Scope:** `outbound-webhooks/outbound-webhooks.service.ts` (+spec), `common/process-guards.ts` (+spec), `main.ts` (1 import + 1 call).
**Risk:** low; behaviour only changes on an error path. Residual: a swallowed rejection could hide a bug → mitigated by error-level logs (Sentry/ops alerts already capture ERROR).
**Rollback:** revert PR; no data or schema impact.

### S2 — NUL (U+0000) is a 400, not a 500 (DEF-PC-010, P3, live-confirmed)
**Acceptance:** 1) `GET /catalog/products/search?q=a%00b` → 400 `VALIDATION_FAILED` (live today: 500). 2) NUL in a JSON body string (also nested, array items, object keys), path param or query → 400. 3) Normal, unicode, emoji, quote, 10k-char input unchanged. 4) Raw `Buffer` bodies (Stripe/Resend/connector webhooks) are never scanned.
**Scope:** `common/reject-nul-bytes.middleware.ts` (+spec), `main.ts` (1 import + 1 `app.use`).
**Risk:** low; one security question: does any signed webhook route lose its raw body? (No: Buffers are skipped and the middleware runs after the raw parsers.) **Rollback:** revert PR.

### S3 — Public media is safe to serve (DEF-PC-002 + DEF-PC-014, P2)
**Acceptance:** 1) Upload with a type outside {png, jpeg, webp, gif} → 400. 2) Declared type must match the file's magic bytes. 3) A real PNG is still accepted. 4) Public `GET /media/assets/{id}/file` sends `Content-Security-Policy: default-src 'none'; sandbox`, a valid `Content-Disposition` for any filename (non-Latin works; quotes/semicolons/CR/LF cannot break out), and serves any legacy non-image row as an octet-stream **attachment**. 5) All pre-existing media tests pass.
**Scope:** `media/media-content-safety.ts` (+spec), `media/media.service.ts` (+spec), `media/media.controller.ts`.
**Product decision (PO):** images-only is a behaviour change; flows that upload non-image or untyped media (e.g. bulk association defaulting to `application/octet-stream`) will now get 400.
**Data decision (CTO/Data):** legacy objects already in R2 with non-image types are unchanged by this code (R2 serves them directly). Needs an inventory query and either deletion or corrected response headers; not in this sprint's code.
**Rollback:** revert PR. Assets uploaded before rollback stay valid (they are images).

### S4 — Expired or revoked session reaches the login page (DEF-PC-016, P2)
**Investigation:** reproduced locally: a token with valid signature/exp but revoked server-side → `/dashboard` renders the shell with an empty main. Cause: `/login` trusts local token validity and redirects to `/dashboard`, while pages that get a 401 redirect to `/login?reason=session_expired` — a ping-pong.
**Acceptance:** 1) With such a token, `/dashboard`, `/catalog/products`, `/admin/users` end on `/login?reason=session_expired&next=<page>` with the password form visible. 2) A visitor with a genuinely valid session who opens `/login` is still forwarded to `/dashboard`. 3) New e2e spec passes (3 routes).
**Scope:** `apps/web/src/app/login/page.tsx`, `apps/web/test/e2e/stale-session-login-redirect.spec.js`.
**Known follow-up (not in scope):** `RootLayout` still draws the signed-in header on `/login` while a stale cookie looks locally valid.
**Rollback:** revert PR.

### S5 — SPIKE (no code): throttle storage, SSR rate-limit key, DB pool (DEF-PC-003/005/015)
**Needs from CTO/SRE:** Railway API replica count, web replica count, how the web service reaches the API (public URL or private network), `DATABASE_URL` pool settings, whether `PIM_DISABLE_THROTTLER` is unset. **Output:** a decision on Redis-backed `ThrottlerStorage` and on forwarding the visitor IP (or exempting the web service) before any load test.

## 5. Definition of Done (every story)
- [ ] Acceptance criteria each mapped to a test, with a negative proof where the bug is behavioural
- [ ] Type-check clean (`tsc -p apps/api/tsconfig.build.json --noEmit`)
- [ ] Story's unit tests pass; **full API unit suite passes**
- [ ] Lint on touched files; `npm run openapi:check` unchanged (no unintended API-surface diff)
- [ ] `scripts/check-pr-scope.cjs` clean on the story branch (single dominant risk domain)
- [ ] Security review (agent) with findings addressed or accepted by CTO
- [ ] Code review (agent) with findings addressed
- [ ] SRE review: failure mode, rollout, rollback, monitoring noted
- [ ] **PO accepted** (human) and **CTO approved** (human)
- [ ] After deploy: live verification run and recorded (section 7)
- [ ] `INCREMENT_STATE.json` updated only after PO acceptance (`status=completed`, `locked=true`, `commit`, `tests_passed`)

## 6. Release plan
Order (each its own small PR, merged one at a time, live-verified between merges): **S1 → S2 → S4 → S3**. Rationale: S1 removes the outage risk and is invisible to users; S2/S4 are small and user-visible fixes; S3 changes product behaviour and needs the PO's explicit yes. Because `main` auto-deploys straight to production with no gate, merge only in a quiet window, one at a time, with the SRE watching error rate and API restarts for 15 minutes after each deploy. Note `main` deployed 9 times on 2026-10-02 and each deploy runs a smoke test that creates and purges `e2e-*` users in the live workspace; plan merges around that.
**Rollback:** revert the merged PR on `main` (auto-deploys the revert), or redeploy the previous Railway deployment. None of the stories touches schema, data or auth tokens.

## 7. Live verification after each deploy (read-only, run by the agent)
| Story | Check | Expected |
|---|---|---|
| S1 | Railway logs: no `exit code 1` / restarts in the 24 h after deploy; no `P2024` followed by process exit | no restarts |
| S2 | Signed-in `GET /api/catalog/search?q=a%00b` and `q=blue` | 400 and 200 (today: 500 and 200) |
| S4 | With a signed-in session, nothing changes; verify `/login?reason=session_expired` renders the form for a visitor with a stale cookie (cannot be forced on live without logging out; accept the local e2e as the proof and watch for support reports) | form shown |
| S3 | Anonymous GET of an existing asset still serves the image; (with PO approval) one harmless upload declared `text/html` → 400 | image OK; 400 |

## 8. Review log (agent reviews — analysis, not approvals)
Disposition key: **FIX** = change before merge · **ACCEPT** = known and accepted pending CTO · **BACKLOG** = new story.

### Security engineer
| ID | Story | Finding | Sev | Disposition |
|---|---|---|---|---|
| SEC-S1-1 | S1 | Logging instead of crashing can hide a failed fire-and-forget task that used to fail loudly (e.g. an audit write). | Info | ACCEPT; SRE adds an alert on the log line `Unhandled promise rejection (process kept alive)` (SRE-S1-1). |
| SEC-S1-2 | S1 | The logged message can carry DB error text. Same data class as existing ERROR logs. | Low | ACCEPT |
| SEC-S2-1 | S2 | Express middleware runs before multer, so multipart endpoints (`bulk-import/runs/upload`, `pricing` file upload) are **not** scanned: NUL in a multipart field/filename can still 500. | Low | **BACKLOG** (DEF-PC-010b): a Nest global pipe/interceptor or a multer `fileFilter`. |
| SEC-S2-2 | S2 | Scan depth capped at 32 levels; a NUL deeper than that is not blocked (still only a 500). | Info | ACCEPT |
| SEC-S2-3 | S2 | The middleware runs before Nest guards: unauthenticated NUL requests get 400 (not 401) and are not counted by the IP throttle. Cost is one linear scan of ≤10 MB. The response never echoes input. | Info | ACCEPT |
| SEC-S3-1 | S3 | A polyglot (valid PNG/GIF header followed by script/HTML) passes a magic-byte check. It is served as `image/*` with `nosniff` (helmet) and a sandbox CSP in local-storage mode; **R2 responses in production carry neither `nosniff` nor CSP**. | Medium | ACCEPT for this sprint; **CTO/Ops** to add `X-Content-Type-Options: nosniff` and CSP via a custom domain / Cloudflare transform rule for the R2 bucket (S3b). |
| SEC-S3-2 | S3 | The code fix closes **new** uploads only. The controller changes sit on the local-streaming branch; the production redirect path to `r2.dev` is untouched, so legacy non-image objects stay live. | Medium | **BACKLOG** S3b: inventory (`SELECT mime_type, count(*) FROM media_assets GROUP BY 1`) then delete or fix headers. |
| SEC-S3-3 | S3 | SVG is now rejected (logos are a common SVG use). | Info | **PO decision** |
| SEC-S4-1 | S4 | An attacker-supplied `?reason=session_expired` stops the auto-forward for a signed-in user, so they see the login form. No auth bypass; `next` is still sanitised. | Info | ACCEPT |

### SRE / DevOps
| ID | Story | Finding | Disposition |
|---|---|---|---|
| SRE-S1-1 | S1 | Add an ops alert on the `process kept alive` error log, and on API restarts / exit code 1 (indirect proof for DEF-PC-013). | FIX (ops config, CTO) |
| SRE-S1-2 | S1 | 14 other `setInterval(() => void this.runScheduled…())` timers are not audited for the same missing-catch pattern. | **BACKLOG** S1b |
| SRE-ALL-1 | all | `main` deploys straight to production (9 deploys on 2026-10-02) and every deploy runs a smoke test that creates and purges `e2e-*` users in the live workspace. Merge one story at a time and watch error rate and restarts for 15 minutes. | ACCEPT (process) |
| SRE-S3-1 | S3 | **Pre-merge gate:** confirm no legitimate production traffic uploads non-image or untyped media (API clients, bulk association with `application/octet-stream`). Run the mime inventory query and review recent `POST /media/assets` volume. | FIX (gate before merge) |
| SRE-ALL-2 | all | Rollback = revert the PR (auto-deploys the revert) or redeploy the previous Railway deployment; no schema/data/token changes in any story. | OK |

### QA lead
| Story | Acceptance coverage | Gap |
|---|---|---|
| S1 | AC1 negative proof run (test fails without the fix) ✓; AC2 3 tests ✓ | none |
| S2 | AC1–4: URL, body, nested, params, keys, Buffer ✓; local end-to-end 500→400 ✓ | multipart (SEC-S2-1) |
| S3 | AC1,2,4 unit + local end-to-end ✓; AC3 (real PNG accepted) proven by helper tests + local run | no service-level unit test of the accept path (needs AsyncLocalStorage tenant context + storage stubs) → BACKLOG, low |
| S4 | AC1,3 e2e 3/3 ✓ and manual pre/post repro ✓; AC2 (valid session still forwarded) covered by the existing e2e logins | e2e was not run against the pre-fix build; pre-fix proof is the manual local repro |

### Data / Storage
S3 does not touch stored data. Legacy non-image objects in R2 remain publicly served until S3b. Suggested query for the owner: `SELECT mime_type, count(*) FROM media_assets GROUP BY 1 ORDER BY 2 DESC;` and list rows with `mime_type NOT IN ('image/png','image/jpeg','image/webp','image/gif')`.

### UX / Accessibility
S4: the user now sees the login form with the session-expired notice instead of a blank page. Follow-up (BACKLOG): `RootLayout` still draws the signed-in header (nav, "Role: …", Logout) on `/login` while a stale cookie looks locally valid.

### Product Owner and CTO questions (need your answer)
1. **PO:** is images-only (png/jpeg/webp/gif) correct? Are SVG logos or PDFs needed as media? (S3)
2. **PO:** accept S4's behaviour (login form with notice) as the fix for the blank page?
3. **CTO:** approve merge order S1 → S2 → S4 → S3, one at a time, in a quiet window?
4. **CTO:** who runs the mime inventory (SRE-S3-1) and the R2 header change (SEC-S3-1)?
5. **CTO:** Railway facts for the S5 spike (replicas, web→API URL, DB pool settings).


### Independent code review (skill `code-review`, high effort) and its outcome
Each story branch was reviewed against its diff; every finding was fixed, deliberately skipped (with a reason) or judged not needed.
| Story | Findings | Fixed | Skipped (reason) | Notable catch |
|---|---|---|---|---|
| S1 | 9 | 6 | 3 (shared timer wrapper → backlog S1b; Sentry premise needs a Railway fact; no metric infra) | **Regression in my own fix:** `bootstrap()` had no `.catch`, so the new guard would have swallowed boot failures (half-started process or exit 0). Fixed with `runAndExitOnFailure` + tests. |
| S2 | 9 | 7 | 2 (efficiency trade-off; OAuth callbacks accepted) | Mounted before helmet/CORS/correlation; request-level scan missed file-derived NULs → root-cause mapping added to the global exception filter (scope expansion: `error-authority/api-exception-capture.filter.ts` + spec). Verified live-local: CSV file with a NUL in the SKU cell now returns 400. |
| S3 | 10 | 7 | 3 (R2 path/legacy objects → backlog S3b; OpenAPI enum deferred; non-PNG dimensions out of scope) | **Bug in my own code:** the filename regex did not strip backslashes (typo from an escape-mangling shell); replaced with an explicit loop. Also: GIF stored as `.bin`, bulk rows with `application/octet-stream` would have broken (now inferred from bytes). |
| S4 | 6 | 4 | 1 (clear stale cookie at the 401 redirect → backlog S4b) + 1 not needed | AC2 (valid session still forwarded) had no test; spec used 3 logins against a 10-per-15-minute auth limit. |

## 9. Sign-off board (updated as work proceeds)
Final evidence (all green): **S1** commit `e29d0be6`; **S2** `6610b0e9`; **S3** `9dab318f`; **S4** `9e66f5c9`. Full API unit suite per backend branch: S1 2391 passed, S2 2394, S3 2406 (18 skipped by the repo, 0 failed); type-check clean; PR-scope clean (single domain each). S4: web lint clean, e2e spec 4/4 on a rebuilt local stack. Live baseline captured before deploy and kept locally (not committed).
| Story | Dev tests | Agent: QA | Agent: Security | Agent: SRE | Agent: Code review | **PO accepts** | **CTO approves** | Deployed | Live verified |
|---|---|---|---|---|---|---|---|---|---|
| S1 | ✅ | ✅ | ✅ (accepted risks noted) | ✅ (alert on `process kept alive` log is an ops action) | ✅ 9 findings closed | ☑ merged by you | ☑ merged by you | yes (1370206e) | partial: health OK; 24 h Railway log check pending |
| S2 | ✅ | ✅ | ✅ | ✅ | ✅ 9 findings closed | ☑ | ☑ | yes (cdb664ef) | **yes**: NUL search 500 -> 400 on live |
| S3 | ✅ | ✅ | ✅ (R2 headers + legacy objects = S3b) | ✅ pre-merge gate met: 55/55 live assets are image/png | ✅ 10 findings closed | ☑ (images-only accepted by merging) | ☑ | yes (99eee3ae) | partial: 55/55 existing assets OK; live upload rejection check pending approval |
| S4 | ✅ | ✅ | ✅ | ✅ | ✅ 6 findings closed | ☑ | ☑ | yes (82888723) | **yes**: valid session unchanged; expired-reason URL shows login form |

### Backlog created by this sprint
S1b audit the 14 other `setInterval(() => void …)` timers · S3b legacy non-image media + R2 response headers (nosniff/CSP) · S4b clear stale cookies at the 401 redirect + RootLayout header on `/login` · S5 throttle/pool spike (needs Railway facts) · DEF-PC-001/017/018/008 next sprint.

## 10. Retrospective (first entry)
**What went wrong:** the first five fixes were investigated, implemented and tested ad hoc and committed as one batch, with no stories, acceptance criteria, role reviews or PO/CTO gates. **Change:** work now runs as stories with the Definition of Done above; one story = one branch = one reviewable PR; the human sign-offs are explicit and nothing is locked or deployed before them.
