---
title: Scaling Architecture Guide
audience: internal-eng
status: active
last_updated: 2026-05-25
owner: Engineering
---

Use this guide when you need to scale Vexa PIM beyond its single-replica pilot configuration, tune BullMQ concurrency, or configure connection pooling for high-tenant load.

> **Corrected 2026-09-17:** this guide previously described Neon serverless Postgres throughout. Confirmed directly against the live Railway dashboard: **Postgres is self-hosted on Railway** (`ghcr.io/railwayapp-templates/postgres-ssl` image + Railway volume), not Neon — Neon was never actually provisioned in this environment. Every Neon-specific instruction below (the pooled endpoint, the Neon dashboard, the free-tier connection cap) describes infrastructure that doesn't exist here. See `docs/runbooks/backup-restore.md` §1 for the same correction, and `docs/operations/CURRENT_PRODUCTION_ARCHITECTURE.md` for the current live topology, which is also the only Railway environment that exists — there is no separate "production" tier today.

## 1. Current Architecture (Pilot)

```
Internet
   │
   ▼
Railway ("App Vexa" web + "Vexa API")     1 replica each
  └── NestJS API (port 8080)
       ├── PrismaService          per-tenant PrismaClient (up to 50 cached), self-hosted Railway Postgres
       ├── BullMQ queues          → Redis (Railway Redis)
       └── /api/v1/health/metrics → Prometheus scrape

Railway Postgres (self-hosted)   ghcr.io/railwayapp-templates/postgres-ssl on a Railway volume
                                   Hobby plan: no native backup schedule, no PITR (see backup-restore.md §6)
Railway Postgres (observability) second instance, same image, backs OBSERVABILITY_DATABASE_URL
Redis (Railway)                  single instance; 512 MB default
Cloudflare R2                    media and backup storage
```

Design limits at pilot scale (single tenant, ≤30k products, ≤10 concurrent users): no issues observed.

---

## 2. When to Scale

Watch these signals:

| Signal | Check | Scale action |
|--------|-------|-------------|
| API p95 latency > 2 s | `pim_api_request_duration_ms` Grafana panel | Add API replicas |
| API CPU > 70% sustained | Railway resource dashboard | Add API replicas |
| DB connection errors | `PrismaClientInitializationError` in logs | Enable connection pooling |
| Queue throughput < demand | `pim_queue_jobs_enqueued_total` vs `_completed_total` | Increase worker replicas or concurrency |
| Redis memory > 80% | Railway Redis dashboard | Increase Redis plan or review queue TTL settings |

---

## 3. Scale API Replicas (Railway)

1. Go to Railway dashboard → `Vexa API` service → **Settings → Replicas**. (Corrected 2026-09-17: the live service is named `Vexa API`, not `pim1-api` — this doc's service names were stale.)
2. Increase replica count.
3. Click **Deploy**.

All replicas share the same self-hosted Railway Postgres instance and Redis instance. The API is stateless between requests (no in-memory session state). Horizontal scaling is safe once connection pooling is enabled (see section 4) — but see the note below first.

**Do not scale beyond 3 replicas without connection pooling — and measure real connection counts before doing either.** `PrismaService` does not hold one shared client: it lazily creates a **separate `PrismaClient` per tenant** (up to 50 cached, FIFO-evicted), each with its own connection-limited datasource. Real connection count is *(API replicas × concurrently-active tenants per replica × per-client pool size)* — not simply "connections grow with replica count." Check `pg_stat_activity` against the real per-tenant fan-out, not a plan-tier connection cap, before increasing replicas.

---

## 4. Enable Connection Pooling

There is no managed pooled endpoint here — Postgres is self-hosted on Railway, not Neon, so the only real option is a self-managed pooler.

### 4.1 PgBouncer sidecar

Deploy PgBouncer as a Railway sidecar service:

1. Deploy the `pgbouncer` Docker image as a Railway service.
2. Configure `pgbouncer.ini` with `pool_mode = transaction` and `max_client_conn = 100`.
3. Set `DATABASE_URL_POOLED` to the PgBouncer endpoint. `DATABASE_URL_DIRECT` stays the non-pooled string, used only for migrations.

Transaction-mode pooling is compatible with Prisma's query engine. No code changes required — `PrismaService` already uses `DATABASE_URL_POOLED` for all queries and `DATABASE_URL_DIRECT` only during `prisma migrate deploy`.

### 4.2 Verify pooling is active

After configuring, look for this in Railway logs on startup:

```
PrismaService: connecting with pooled URL
```

Run a load test and monitor active connections directly against the Railway Postgres instance:

```sql
SELECT count(*) FROM pg_stat_activity;
```

It should stay stable under concurrent load rather than growing linearly with replicas × per-tenant client fan-out (see § 3).

---

## 5. Scale Worker Replicas

> **Corrected 2026-09-17:** the live Railway project (confirmed via direct dashboard check) has no separate `pim1-worker` service today — the only compute services are `App Vexa` (web) and `Vexa API` (API). Worker mode is controlled by the `QUEUE_WORKER_ENABLED` flag (see `incident-response.md` §4) and, as currently deployed, appears to run in-process on the API service rather than as a dedicated worker deployment. Before following the steps below, confirm in the Railway dashboard whether a separate worker service now exists — if not, "scaling the worker" today means either enabling worker mode on additional API replicas or actually standing up the dedicated worker service this section assumes.

The BullMQ worker is stateless and can be scaled horizontally. Each worker replica independently polls queues from Redis.

1. Go to Railway dashboard → the worker service (if one has been created; see the note above) → **Settings → Replicas**.
2. Increase replica count.
3. Deploy.

BullMQ uses Redis-based locking to ensure each job is processed by exactly one worker. Idempotency guarantees:
- **Import jobs**: each row has a unique DB record; duplicate processing attempts are rejected by the unique constraint.
- **Export/publish jobs**: idempotent at the connector layer — re-sending the same product to Amazon/Flipkart is safe (they deduplicate by external ID).

### 5.1 Tune Worker Concurrency

Each worker process has a concurrency setting per queue. Default is 5 concurrent jobs per queue per replica. To change:

Find the concurrency config in `apps/api/src/queue/queue-worker.ts` (or equivalent worker entrypoint):

```typescript
const worker = new Worker(QUEUE_NAME, processor, {
  connection: redisConnection,
  concurrency: Number(process.env.QUEUE_WORKER_CONCURRENCY ?? "5"),
});
```

Set `QUEUE_WORKER_CONCURRENCY` in Railway Variables for the worker service (or the `Vexa API` service, if worker mode is running in-process there — see the note in § 5).

High-concurrency recommendations:
- Import queue: 3–5 (I/O bound, safe to run concurrently)
- Export/connector queue: 2–3 (depends on connector API rate limits)

---

## 6. Redis Memory Sizing

At pilot scale (< 10 tenants, < 100 concurrent jobs), 512 MB Redis is sufficient.

Rules of thumb for sizing:
- Each queued job payload: ~2–10 KB
- BullMQ active job sets and completion logs: ~1 KB per job entry
- Peak queue depth × average payload size × 2 (for safety margin) = minimum Redis RAM

For 50 tenants × 100 jobs in-flight × 10 KB average = 50 MB. A 256 MB Redis handles this with headroom. Upgrade to 1 GB for > 200 concurrent jobs.

---

## 7. Database Sizing

Railway's self-hosted Postgres does not autoscale storage or compute — this is a fixed volume on a fixed plan, not a serverless product. Monitor:
- **Storage**: Railway service metrics show volume disk usage. Alert if approaching the volume's provisioned size — growth requires a manual volume resize, not an automatic scale-up.
- **Connections**: `SELECT count(*) FROM pg_stat_activity;` — alert if approaching `max_connections` (check `SHOW max_connections;`), accounting for the per-tenant `PrismaClient` fan-out described in § 3.
- **Compute**: fixed to the Railway plan/instance size. There is no auto-scaling compute tier — a sustained CPU/memory ceiling means upgrading the Railway service plan, not waiting for autoscale.
- **Backup/PITR**: Railway's native backup and point-in-time recovery are Pro-plan-only. This account is on Hobby — confirmed via the Railway dashboard (Postgres → Backups tab: "only available for customers on the Pro plan," no schedule configured). The only real recovery path is the daily `pg_dump` → R2 job in `docs/runbooks/backup-restore.md`.

---

## 8. Phase 3 Pre-Launch Checklist

- [ ] Connection pooling configured and verified (section 4)
- [ ] Load test run with `k6` or `artillery` simulating 50-tenant concurrent catalog load — no "too many connections" errors
- [ ] API replicas scaled to at least 2 for HA
- [ ] Worker replicas scaled to at least 2 for queue throughput
- [ ] Redis memory headroom > 40% at peak load
- [ ] Railway Postgres active connections (`pg_stat_activity`) < 60% of `max_connections` under load, measured against real per-tenant `PrismaClient` fan-out, not replica count alone
- [ ] Prometheus alert for DB connection exhaustion configured
- [ ] Upgrade to Railway Pro plan (or migrate to a managed Postgres with PITR) evaluated — Hobby plan has no native backup/PITR of any kind
- [ ] Observability fully activated (see [Observability Activation Guide](../runbooks/observability-activation.md))
