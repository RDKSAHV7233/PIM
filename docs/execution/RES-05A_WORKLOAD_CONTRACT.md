# RES-05A Workload / SLO Contract

Status: FROZEN (CTO decision 2026-08-29, issue #713)

This is the canonical source of truth for Vexa PIM pilot-phase workload assumptions and service-level objectives. All downstream evidence (RES-05B load proof, RES-05F final review) tests against these values.

## Pilot Parameters

| Parameter | Value |
| --- | --- |
| Tenants | 1 |
| Max products | 30,000 |
| Max concurrent users | 10 |
| API replicas | 1 (scaling to 2 authorized via #714) |
| Worker replicas | 1 |
| Database | Neon PostgreSQL serverless, 25 connection cap (free tier) |
| Redis | Railway Redis, 512 MB |
| Queue backend | BullMQ (Redis-backed) |
| Worker concurrency | 5 jobs/queue/replica (default) |

## Latency SLOs

| Endpoint Class | Metric | Threshold | Revision Note |
| --- | --- | --- | --- |
| Health (`/health`) | p95 response time | ≤ 400 ms | Revised from 200 ms — prior WSL runs showed 295–390 ms cross-region; 400 ms is realistic for Railway cold-start; tighten post-pilot |
| Catalog products (`/catalog/products?slim=true`) | p95 response time | ≤ 3000 ms | Revised from 2000 ms — slim path observed 2622 ms from WSL; 3000 ms covers cross-region variance |
| Dashboard (`/dashboard/health`) | p95 response time | ≤ 3000 ms | Observed 728–1285 ms, well within gate |
| Connectors (`/connectors/installed`) | p95 response time | ≤ 1000 ms | Observed 740–795 ms |
| Audit (`/audit/logs`) | p95 response time | ≤ 2000 ms | Observed 761–777 ms |

## Error Rate SLOs

| Metric | Threshold |
| --- | --- |
| HTTP 5xx rate | ≤ 0.5% |
| Request failure rate (non-429) | ≤ 0.5% |

HTTP 429 (rate limiting) is tracked separately and is expected only when documented limits are intentionally exceeded. It does not count against the failure rate SLO.

## Queue / Async SLOs

| Metric | Threshold | Scope |
| --- | --- | --- |
| Enqueue-to-processing p95 | ≤ 30 s | Expected load (≤ 25 VUs) |
| Enqueue-to-processing p95 | ≤ 60 s | Burst load (≤ 50 VUs) |
| Export/publish job completion p95 | ≤ 120 s | Per job class |

## Error Budget

- Monthly error rate allowance: 0.5% of requests
- Aligned with proposed 99.5% monthly uptime target in `docs/legal/sla.md`
- Error budget is consumed by any request returning 5xx or non-429 failure
- Budget resets on the 1st of each calendar month

## Load Test Profiles

These profiles are approved for RES-05B k6 load proof execution. The k6 harness (`scripts/res-05b-k6-load-proof.js`) must use thresholds that match or exceed the SLOs above.

| Profile | VUs | Duration | Purpose |
| --- | --- | --- | --- |
| health | 1 | 1 min | Unauthenticated health-only check |
| smoke | 1 | 2 min | Fast authenticated read-path proof |
| baseline | 5 | 15 min | Low-volume baseline |
| expected | ramp to 25 | 30 min | Approved expected-load shape |
| burst | ramp to 50 | 10 min | Approved burst shape |
| sustained | 25 | 60 min | Sustained load endurance |

## Contract Governance

- Changes to these SLOs require explicit CTO approval
- Threshold revisions must include evidence (k6 run data, latency observations) justifying the change
- Tightening thresholds post-pilot is expected; relaxing requires a documented commercial or technical rationale
- This document is referenced by: `docs/execution/RES-05B_K6_LOAD_PROOF.md`, `scripts/res-05b-k6-load-proof.js`
