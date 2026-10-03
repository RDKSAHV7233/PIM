# Sprint R2 (INC-85 proposal) — plan, live baseline FIRST

Rule from the PO/CTO: **check every issue on live before committing; push only after the plan is approved; verify on live after each deploy, one story at a time.**

## 1. Live baseline (production `04ca33a9`, captured 2026-10-03)

| Bug | Live today | How verified |
|---|---|---|
| DEF-PC-001 proof page public | PRESENT. Anonymous `GET /internal/error-authority/runtime-proof/server-action` -> 200 with the token form. Sibling `/runtime-proof` -> 404 (it needs a header token). | curl. Code read: the page renders when `APP_ENV=staging` + `ERROR_AUTHORITY_ENABLED=true` + `ERROR_AUTHORITY_RUNTIME_PROOF_TOKEN` is set; the **action** is token-protected (timing-safe), so only the existence of the form leaks. Production runs `APP_ENV=staging`, so the proof token is set in prod. |
| DEF-PC-007 429 without `Retry-After` | NOT TESTABLE on live (would 429 real users). **Code-confirmed:** `@nestjs/throttler` 6.5.0 writes `Retry-After-<throttlerName>` (e.g. `Retry-After-ip`), never the standard `Retry-After`. Normal live responses do carry `x-ratelimit-limit-ip/remaining-ip/reset-ip`. Register wording ("no headers") was too broad; corrected here. | throttler.guard.js lines 121/135-137 + live headers |
| DEF-PC-008 public health detail | PRESENT. `/api/v1/health` anonymous returns `status, env:"staging", queueRuntime, queues` (11 queues). `/health`, `/health/ready`, `/api/v1/health/ready` -> 200; `/api/v1/health/internal` and `/metrics` -> 401. | curl |
| DEF-PC-011 `limit` ignored without cursor | NOT VERIFIABLE live (needs the API bearer; cookie is httpOnly). Code identical to prod build. | local repro |
| DEF-PC-012 import accepts 1-char title | NOT TESTED live (needs an import = mutation). Code identical. | local repro |
| DEF-PC-017 no HSTS | PRESENT (`/`, `/login`, `/dashboard`, API) | curl -I |
| DEF-PC-018 `X-Powered-By: Next.js` | PRESENT on `/login` | curl -I |
| DEF-PC-019 unlabeled inputs `/catalog/media` | PRESENT: 220 of 787 inputs unlabeled | DOM probe |
| DEF-PC-020 no `<nav>` landmark | PRESENT: 0 | DOM probe |
| Probe pack `scripts/live-safe-probes.cjs` | 36 pass / 3 fail (HSTS, X-Powered-By, API CSP) | unchanged |

Not baseline-able, parked: DEF-PC-003/005/015 (spike S5 needs Railway facts), DEF-PC-009 (edge XFF behaviour).

## 2. Stories (one PR each, one dominant risk domain, ~<10 files)

| ID | Bug | Change | Acceptance criteria | Live check after deploy |
|---|---|---|---|---|
| R2-S1 | 018 + 017 | web `next.config`: `poweredByHeader:false`; add `Strict-Transport-Security` on web (and API via helmet) | AC1 no `X-Powered-By` on `/login`, `/`, API. AC2 HSTS present with the agreed policy. AC3 no change to CSP/other headers. | probe pack goes 36/3 -> 38/1 |
| R2-S2 | 019 + 020 | `/catalog/media`: `aria-label` (asset name + field) on per-asset inputs; wrap sidebar in `<nav aria-label="Primary">` | AC1 0 unlabeled inputs on `/catalog/media`. AC2 exactly one primary `nav` landmark on dashboard/products/media. AC3 existing e2e selectors still pass (media + sidebar specs). | DOM probe: 0 unlabeled, 1 nav |
| R2-S3 | 007 | Throttler guard subclass that also emits standard `Retry-After` (seconds) on 429 | AC1 429 carries `Retry-After`. AC2 per-throttler headers unchanged. AC3 non-429 responses unchanged. | Unit/HTTP test only (not triggered live) |
| R2-S4 | 011 | `/products?limit=N` honours `limit` without a cursor | AC1 limit=1/3/50/200 return that many rows + a cursor. AC2 no-param call still returns the legacy list (backward compat for the web UI). | NOT possible without bearer; local repro + user-run check |
| R2-S5 | 008 | Public `/api/v1/health` -> `{status}` only; detail only on `/health/internal` | AC1 anonymous body has no env/queue names. AC2 Railway healthcheck + uptime monitor still green. | curl after deploy |
| R2-S6 | 001 | **Ops action, no code:** unset `ERROR_AUTHORITY_RUNTIME_PROOF_TOKEN` in prod after the proof (page then returns 404 by its own gate) | AC1 anonymous GET -> 404. | curl |
| R2-S7 | 012 | Align import title rule with `CreateProductDto` (min 2) | Needs PO decision; parked unless approved |

## 3. Decisions needed (PO/CTO)

1. **HSTS policy (S1):** `max-age=31536000` without `includeSubDomains`/`preload` (recommended; reversible in a year), or `includeSubDomains` (is anything under `vexapim.com` still HTTP only? e.g. the www/WordPress site)?
2. **Health contract (S5):** is anything external (Railway healthcheck path, uptime monitor, status page) reading `queues`/`env` from the public `/api/v1/health`? If unknown, I will do S5 last and only after you confirm; the safe alternative is leaving it and accepting the risk.
3. **Proof token (S6):** OK to unset `ERROR_AUTHORITY_RUNTIME_PROOF_TOKEN` in Railway (you do it; I never touch secrets)? Re-set when a future proof run is needed.
4. **S4 `limit`:** keep the legacy full list when `limit` is absent (recommended) — confirm.
5. **S7 import title:** reject 1-char titles on import too, yes/no.

## 4. Order and gates
S1 -> S2 -> S3 -> S4 -> S5 (after decision 2). For each: implement locally, unit/e2e on a rebuilt local stack, independent code review (Security/QA/SRE role notes), per-story PR, you merge, live check from the table, then the next. Role review is recorded per story as in R1. Locks only after PO acceptance + CTO approval.

## 5. Delivery log (2026-10-02/03)

Corrections to the baseline found while implementing: the **API already sent HSTS** (only the web app lacked it); `limit` is ignored without `pagination=cursor` (not a bare `cursor`); Railway healthchecks use `/health` and `/api/v1/health/ready`, not `/api/v1/health`.

| Story | PR | Merged | CI | Live verification |
|---|---|---|---|---|
| R2-S1 HSTS + no X-Powered-By | #1047 | 19:47Z | pass | **VERIFIED LIVE** 19:50Z: `/login` and `/` send `strict-transport-security: max-age=31536000; includeSubDomains`, no `x-powered-by`; probe pack 38 pass / 1 fail (only API CSP, informational) |
| R2-S2 media labels + nav | #1049 | 19:47Z | pass | pending deploy `37817c02` |
| R2-S3 Retry-After | #1050 | 19:48Z | pass | unit-tested only (429 not forced on live) |
| R2-S4 limit honoured | #1051 | 19:48Z | pass | pending deploy + signed-in check |
| R2-S5 health detail | - | - | - | not started (no external consumer confirmed) |
| R2-S6 proof token | - | - | - | owner action in Railway |
| R2-S7 import title | - | - | - | parked (PO decision) |

### R2-S5 decision (CTO): deferred to R3, risk accepted meanwhile
The public `GET /api/v1/health` (`status`, `env`, `queueRuntime`, `queues`) is **consumed by the deploy pipeline**: `scripts/staging-postdeploy-check.cjs` asserts `env` and `queueRuntime.backend/workerEnabled`; `staging-public-signup-check.cjs`, `capture-controlled-rollout-snapshot.cjs` (reads `queues`) and the acceptance scripts read `env`. Trimming the public body would fail post-deploy verification. Correct sequence (R3, CI/deploy risk domain): (1) move these scripts to an authenticated detail endpoint (`/health/internal`), (2) then trim the public body to `{status}`. Exposure today: environment label and queue names only (no tenant data, no secrets).

### Live result after final deploy `37817c02` (2026-10-02 ~20:00Z)
| Story | Result |
|---|---|
| S1 HSTS / X-Powered-By | **VERIFIED LIVE** (web and `/`; probe pack 38/1) |
| S2 media labels + nav | **NOT LIVE YET.** Signed-in `/catalog/media`: 220 of 787 inputs unlabeled, 0 `nav`; fresh no-store fetch of the page HTML has no `Alt text for` and no `<nav aria-label="Primary">`. Cause below. |
| S3, S4 (API) | Deployed (API deploys the whole tree at `37817c02`); S3 unit-only; S4 needs a signed-in API call to verify |

**DEF-PC-021 (new, P2, deploy pipeline): a merged web-only change can silently never reach production.** `scripts/railway-deploy.cjs` chooses services from the files changed between the push's `before` and `sha`. `deploy-staging.yml` serialises runs (`concurrency: deploy-staging`, `cancel-in-progress:false`), but GitHub keeps only ONE pending run, so when #1049 (web), #1050 (api) and #1051 (api) merged within ~90 s, the runs for #1049 and #1050 were cancelled and the surviving run (`37817c02`) saw only #1051's diff -> api only. The web service was last deployed at #1047, so #1049 is merged but not live. Impact: any burst of merges can skip a service. Workaround: `workflow_dispatch` with `deploy_targets=web` (owner action; my attempt was blocked by the permission classifier and I did not retry). Fix (R3, CI/deploy domain): deploy both services when the diff range is not a single commit, or compute targets against the last *successfully deployed* SHA instead of `before`.

### Live verification, signed-in admin session (2026-10-03)
| Story | Result |
|---|---|
| S1 | VERIFIED LIVE (HSTS present, no X-Powered-By; probe pack 38 pass / 1 fail = API CSP only) |
| S2 | **VERIFIED LIVE**: `/catalog/media` 111 alt-text inputs carry `aria-label="Alt text for <file>"`, **0 unlabeled of 787 inputs (was 220)**; exactly one `nav[aria-label=Primary]` on `/dashboard`, `/catalog/products`, `/catalog/media`. Web had been redeployed by the owner after DEF-PC-021. |
| S3 | Deployed with API; unit-tested only (429 not forced on live) |
| S4 | Deployed with API. **Not verifiable on live**: the product list has no same-origin proxy and the session cookie is not usable against the API origin from the browser; needs an API bearer. `/catalog/products` still renders normally (no regression seen). Live check remains: signed-in `GET /api/v1/catalog/products?limit=1` -> 1 row. |
| Incidental | Session had expired after the deploy; `/catalog/media` -> `/login?reason=session_expired` showed the form with the expiry notice (INC-84-S4 fix working on live, no loop). |
