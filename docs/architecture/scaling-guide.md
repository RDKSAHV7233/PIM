---
title: Scaling Architecture Guide
audience: internal-eng
status: active
last_updated: 2026-05-25
owner: Engineering
---

Use this guide when you need to scale Vexa PIM beyond its single-replica pilot configuration, tune BullMQ concurrency, or configure connection pooling for high-tenant load.

## 1. Current Architecture (Pilot)

```
Internet
   │
   ▼
Railway (pim1-api)               1 replica
  └── NestJS API (port 8080)
       ├── PrismaService          direct Neon connection per request
       ├── BullMQ queues          → Redis (Railway Redis)
       └── /api/v1/health/metrics → Prometheus scrape

Railway (pim1-worker)            1 replica
  └── BullMQ worker
       ├── ConnectorQueue
       ├── ExportQueue
       └── ImportQueue

Neon (PostgreSQL)                serverless; auto-scales connections up to limit
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

1. Go to Railway dashboard → `pim1-api` service → **Settings → Replicas**.
2. Increase replica count.
3. Click **Deploy**.

All replicas share the same Neon database and Redis instance. The API is stateless between requests (no in-memory session state). Horizontal scaling is safe once connection pooling is enabled (see section 4).

**Do not scale beyond 3 replicas without connection pooling.** Each Prisma replica opens its own connection pool to Neon, and Neon's free tier caps connections at 25.

---

## 4. Enable Connection Pooling

### 4.1 Option A — Neon Pooled Endpoint (recommended)

Neon provides a built-in PgBouncer pooler. To activate:

1. In the [Neon console](https://console.neon.tech), open your project.
2. Click **Connection Details**.
3. Select **Connection pooling: Pooled**.
4. Copy the pooled connection string (it ends in `-pooler.neon.tech`).
5. In Railway Variables for `pim1-api`:
   - Set `DATABASE_URL_POOLED` to the pooled string.
   - Keep `DATABASE_URL_DIRECT` as the non-pooled string (used only for migrations).

No code changes required — `PrismaService` already uses `DATABASE_URL_POOLED` for all queries and `DATABASE_URL_DIRECT` only during `prisma migrate deploy`.

### 4.2 Option B — PgBouncer sidecar

If you prefer self-managed pooling, deploy PgBouncer as a Railway sidecar service:

1. Deploy the `pgbouncer` Docker image as a Railway service.
2. Configure `pgbouncer.ini` with `pool_mode = transaction` and `max_client_conn = 100`.
3. Set `DATABASE_URL_POOLED` to the PgBouncer endpoint.

Transaction-mode pooling is compatible with Prisma's query engine.

### 4.3 Verify pooling is active

After configuring, look for this in Railway logs on startup:

```
PrismaService: connecting with pooled URL
```

Run a load test and monitor Neon's connection count — it should stay stable under concurrent load rather than growing linearly with replicas.

---

## 5. Scale Worker Replicas

The BullMQ worker is stateless and can be scaled horizontally. Each worker replica independently polls queues from Redis.

1. Go to Railway dashboard → `pim1-worker` service → **Settings → Replicas**.
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

Set `QUEUE_WORKER_CONCURRENCY` in Railway Variables for `pim1-worker`.

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

Neon scales storage automatically. Monitor:
- **Storage**: Neon dashboard shows total DB size. Alert if approaching plan limit.
- **Connections**: Alert if active connections > 80% of `max_client_conn` in your Neon plan.
- **Compute**: Neon serverless auto-scales compute. For predictable latency under sustained load, upgrade to a fixed compute plan.

---

## 8. Phase 3 Pre-Launch Checklist

- [ ] Connection pooling configured and verified (section 4)
- [ ] Load test run with `k6` or `artillery` simulating 50-tenant concurrent catalog load — no "too many connections" errors
- [ ] API replicas scaled to at least 2 for HA
- [ ] Worker replicas scaled to at least 2 for queue throughput
- [ ] Redis memory headroom > 40% at peak load
- [ ] Neon active connections < 60% of plan limit under load
- [ ] Prometheus alert for DB connection exhaustion configured
- [ ] Observability fully activated (see [Observability Activation Guide](../runbooks/observability-activation.md))
