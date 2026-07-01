# PR #365 — Infra Fail-Fast Staging Validation Checklist

**Branch:** `fix/infra-fail-fast-production`
**Scope:** QueueService Redis startup check + ConnectorRegistry fallback gate
**Gate:** Must validate on Railway staging with real Redis before marking Ready for Review.

---

## Pre-requisites

- [ ] Railway staging environment accessible
- [ ] Ability to temporarily modify environment variables on the staging service
- [ ] Railway service logs viewable in real time
- [ ] `APP_ENV=staging` is set on the staging service (confirm before starting)

```bash
# Confirm current staging env vars
railway variables --environment staging | grep -E "APP_ENV|QUEUE_BACKEND|REDIS_URL"
```

**Expected:** `APP_ENV=staging`, `QUEUE_BACKEND=bullmq`, `REDIS_URL=redis://...`

---

## Test 1: Normal startup — Redis available

**What:** API boots successfully when Redis is up and connector definitions exist.

**Steps:**
1. Deploy `fix/infra-fail-fast-production` branch to staging (or use Railway preview env).
2. Watch service logs during startup.

```bash
railway logs --environment staging | head -50
```

**Expected output (no crash, healthy boot):**
- NestJS startup banner appears
- No `QueueService: QUEUE_BACKEND=bullmq but Redis is unreachable` error
- No `ConnectorRegistry: connector definitions fell back` error
- Health check returns 200:

```bash
curl -s https://<staging-api-url>/health | jq .
```

**Pass evidence:** Screenshot of clean startup logs + health check 200.

---

## Test 2: Redis unavailable in staging — API refuses to boot

**What:** With `QUEUE_BACKEND=bullmq` and Redis unreachable, API crashes at startup.

**Steps:**
1. Temporarily set `REDIS_URL` to an unreachable address:

```bash
railway variables set REDIS_URL=redis://localhost:1 --environment staging
```

2. Trigger a redeploy (or restart the service).
3. Watch logs for the crash.

```bash
railway logs --environment staging | head -30
```

**Expected output (hard crash with clear message):**
```
QueueService: QUEUE_BACKEND=bullmq but Redis is unreachable at startup (...).
Refusing to boot in staging/production with a broken queue backend — jobs would
silently never run. Fix REDIS_URL or Redis connectivity and restart.
```

4. Confirm the service does NOT reach a healthy state — it should crash-loop or show "unhealthy" in Railway.

**Pass evidence:** Screenshot of crash log showing the exact error message. Service status shows unhealthy/restarting.

**Cleanup:** Restore the correct `REDIS_URL` immediately after capturing evidence.

```bash
railway variables set REDIS_URL=<original-redis-url> --environment staging
```

---

## Test 3: Redis unavailable in development — API continues with warning

**What:** In development mode, Redis being unreachable is a warning, not a crash.

**Steps:**
1. On your local machine, ensure `APP_ENV=development` (or unset).
2. Set `QUEUE_BACKEND=bullmq` and `REDIS_URL=redis://localhost:1` (or stop your local Redis).
3. Start the API:

```bash
cd apps/api && npm run start:dev
```

**Expected output (warning, not crash):**
```
[QueueService] QueueService: Redis unreachable at startup (ECONNREFUSED). Continuing in development mode.
```

API should fully start and respond to requests (queue jobs will fail individually but the process stays up).

**Pass evidence:** Screenshot of startup logs showing the WARN line and the API responding to a health check.

---

## Test 4: Memory queue in development — no Redis needed

**What:** Default `QUEUE_BACKEND=memory` in development needs no Redis at all.

**Steps:**
1. Ensure `QUEUE_BACKEND` is unset or set to `memory`.
2. Ensure `REDIS_URL` is unset.
3. Start the API:

```bash
cd apps/api && npm run start:dev
```

**Expected:** Clean startup. No Redis warnings. `onModuleInit` returns immediately (the `if (this.backend !== "bullmq") return` guard fires).

**Pass evidence:** Clean startup logs with no queue/Redis warnings.

---

## Test 5: Connector fallback blocked in staging

**What:** If connector definitions are empty or DB discovery fails in staging, API refuses to boot.

**Steps:**
1. On staging, temporarily empty or corrupt the `ConnectorDefinition` table (or simulate by temporarily revoking DB read access to that table — if not practical, use the indirect test below).

**Indirect test (preferred — less destructive):**
1. Deploy the branch to a Railway preview environment.
2. Set `APP_ENV=staging` and point `DATABASE_URL` at a DB where `ConnectorDefinition` has zero active rows.

**Expected crash log:**
```
ConnectorRegistry: connector definitions fell back to the safe set
(reason: connector_definitions_empty_or_unmapped). Refusing to boot in
staging/production with a degraded connector catalogue — sellers would see
fewer channels than expected.
```

**Pass evidence:** Screenshot of the crash log. Service stays unhealthy.

---

## Test 6: Connector fallback allowed in development

**What:** In development, empty connector definitions fall back silently (existing behavior preserved).

**Steps:**
1. On local, set `APP_ENV=development`.
2. Temporarily empty the `ConnectorDefinition` table in your local DB (or use a fresh unseeded DB).
3. Start the API.

**Expected:** Warning in logs about fallback, but API boots successfully:
```
[ConnectorRegistry] Connector registry is using the safe fallback connector set.
```

**Pass evidence:** Screenshot of warning log + API health check 200.

---

## Test 7: Railway restart policy behavior

**What:** When the API crashes due to fail-fast, Railway's restart policy should attempt restarts but eventually stop (not infinite crash-loop burning resources).

**Steps:**
1. Use the Redis-unavailable scenario from Test 2.
2. Observe Railway's restart behavior over 3-5 minutes.

**Expected:**
- Railway attempts 2-3 restarts.
- After repeated failures, Railway marks the deployment as "crashed" or "failed" (not "active").
- No infinite restart loop consuming resources.

**Pass evidence:** Screenshot of Railway deployment status showing "crashed/failed" after restart attempts.

---

## Test 8: Log clarity

**What:** Both failure messages include enough context to diagnose without reading source code.

**Checklist (verify from Test 2 and Test 5 logs):**
- [ ] QueueService error includes the word "Redis" and the connection error reason
- [ ] QueueService error says "QUEUE_BACKEND=bullmq" (confirms which config path triggered it)
- [ ] QueueService error says "Fix REDIS_URL or Redis connectivity and restart"
- [ ] ConnectorRegistry error includes the `reason` string (e.g., `connector_definitions_empty_or_unmapped`)
- [ ] ConnectorRegistry error says "Fix the connector-definition data/DB connectivity and restart"
- [ ] Neither error exposes secrets (no Redis password, no DB credentials in the log)

**Pass evidence:** Annotated screenshots of both error messages with each bullet confirmed.

---

## Summary

| # | Test | Environment | Pass? |
|---|------|-------------|-------|
| 1 | Normal startup (Redis up) | staging | [ ] |
| 2 | Redis down — hard crash | staging | [ ] |
| 3 | Redis down — warn only | development | [ ] |
| 4 | Memory queue — no Redis | development | [ ] |
| 5 | Connector fallback blocked | staging | [ ] |
| 6 | Connector fallback allowed | development | [ ] |
| 7 | Railway restart policy | staging | [ ] |
| 8 | Log clarity | staging | [ ] |

**After all tests pass:** PR #365 can be marked Ready for Review.

**Rollback plan:** Revert the single commit — the only change is two `onModuleInit` guards gated on `APP_ENV`. Reverting restores the previous lenient behavior (silent degradation). No DB migration, no schema change, no data to clean up.
