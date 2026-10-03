# Sprint R4 (INC-87 proposal) - fire-and-forget safety (backlog S1b)

## Investigation
Audit of every background timer and `void <promise>` call in `apps/api/src` (14 `setInterval`s, ~35 `void` call sites), following DEF-PC-013 (a transient DB error in an un-caught timer promise killed the API process).
- **Safe (9 scheduled runners):** commercial-reminders, grace-period-escalation, bulk-edit/bulk-import stale recovery, connector heartbeat + webhook lease sweeper, woocommerce/export-job reconciliation, error-authority retention, media integrity, internal-ops alerts (both), plan-usage rollup: each wraps the advisory lock and the job in try/catch.
- **Still able to reject (3 hot-path call sites):**
  1. `QueueService.captureTerminalWorkerFailure` called with `void` (2 sites) on every terminal worker failure; its classification/capture work was not in a try/catch.
  2. `AuditService.record` called with `void` on every mutating request; `sanitizeMetadata` (recursive) and `normalizeTenantKey` ran **outside** its try/catch.
  3. `ApiKeysService.touchLastUsed` called with `void` on every API-key request; `prisma.tenant()` ran outside the `.catch`.
- Live baseline: not observable (needs a fault). S1 of R1 already turned a stray rejection into a log line (`registerProcessGuards`); this removes the remaining sources.

## Story R4-S1 (P3 resilience, api only)
Make the three helpers total (never reject), log the capture failure.
AC1 capture failure -> logged, no rejection. AC2 audit record never rejects (invalid tenant key, 20k-deep metadata) and still writes + redacts normally. AC3 touchLastUsed never rejects (throwing prisma.tenant(), update failure) and still updates. AC4 tests fail on the pre-fix code (3 of 4 do; the 4th pins existing behaviour).

## Role review
SRE: removes crash/noise sources on hot paths, behaviour otherwise identical. Security: audit redaction unchanged (test asserts `token` redacted); no new data logged (message only). QA: spec fails pre-fix. PO: no user-visible change. CTO: approve.

## Incident note: transient live write slowdown + 500s (2026-10-03, ~07:00-08:20Z) - DEF-PC-022 (P2 candidate, cause unknown)
Evidence is the post-deploy smoke test (runs against live as the real workspace admin):
| Deploy run | create_product_draft | workflow_submit | other | result |
|---|---|---|---|---|
| 2c2e830f 06:52Z | 204 ms | 187 ms | delete_product 6.6 s | green |
| 9c5af98a 07:03Z | **9.25 s, HTTP 500** | skipped | create_workspace_user 3.2 s | FAILED |
| edf053ea 07:18Z | 6.4 s | **8.9 s, HTTP 500** | delete_product 17.4 s, delete_category 15.4 s | FAILED |
| 0b8a4653 08:31Z | 1.3 s | 88 ms | workflow_approve 4.4 s, delete_product 5.0 s | green (29/0) |
Commits between (#1060-#1063) are connector registry/label changes, not catalog code; my merged R1-R4 changes do not touch the catalog write path (the only API change after 06:11Z deploys was #1058's catch-hardening; #1064 is web-only). Pattern matches DB connection-pool exhaustion / saturation (candidate DEF-PC-015: local P2024 under load) but **cause not confirmed**: needs Railway CPU/memory/DB connection metrics, restarts and slow-query data for the window. Tail latency (4-5 s on a few steps) is still above the 06:52Z baseline at 08:31Z.
Positive: the DEF-PC-021 fix held under real failed deploys (next deploy's base = last SUCCESSFUL deploy `2c2e830f`, so the failed runs' changes were included; both services deployed).

## DEF-PC-022 update: smoke-latency time series is BIMODAL (2026-10-03 ~09:50Z), cause still unknown
`create_product_draft / get_product / workflow_approve` (ms) from the post-deploy smoke of the last 20 deploys (CI runner -> live API, same keep-alive client each run):
- FAST runs (18:56, 19:00, 19:47, 19:48 on 10-02; 06:52 on 10-03): ~80-210 / 46-150 / 150-280.
- SLOW runs (all others, incl. 09:45 `5e71930d`): **~3,800-4,050 / ~1,430-1,870 / ~6,000-6,600** - remarkably constant, i.e. a roughly fixed multiplier on every request, not random load. 08:31 was mixed (1.3 s / 56 ms / 4.4 s). Two runs failed with HTTP 500 at ~9.25 s (07:03) and 8.9 s (07:18) = the 10 s pool timeout.
- Runs are fast or slow as a whole => consistent with the client's keep-alive connection landing on one of several API instances (the throttle counters from anonymous probes show 291-299 across 40 sequential calls => several instances, each with its own in-memory counter), OR with a per-deploy state (DB route, cold caches). Anonymous `/api/v1/health/ready` (touches DB+Redis) shows NO slow instance right now: server-side ~400-570 ms from here, uniform.
Hypotheses to check in Railway (owner): (1) API replica count and whether one replica is in a different region from Postgres / uses the public proxy host instead of `*.railway.internal` in DATABASE_URL_POOLED; (2) Postgres CPU/connection count/slow-query log at 07:00-08:20Z and 09:45Z; (3) `DB_POOL_CONNECTION_LIMIT` (see boot log line added by INC-91-S1: "DB pool: connection_limit=N"); (4) any deploy where API restarts coincide with slow smoke (cold start of sweeps/heartbeats).
