---
title: Stage 3 — Pilot Ready Runbook
audience: internal-ops
status: active
last_updated: 2026-05-17
owner: Engineering
---

# Stage 3 — Pilot Ready

> **STATUS: NEVER EXECUTED — verified 2026-09-17.** `promote-stage3.yml` has zero recorded runs in the repo's GitHub Actions history (`gh run list --workflow=promote-stage3.yml`), and only one `RAILWAY_PROJECT_ID` secret exists repo-wide — so even if run, it would deploy into the same Railway project as staging, under an environment name ("Production") that doesn't currently exist there. The multi-provider architecture below (Railway + Vercel + Neon/Railway-Pro-PITR + Upstash) was never built. Real pilot traffic — including a real ENTERPRISE-plan tenant with active billing — runs directly on the single self-hosted Railway environment described in `docs/operations/CURRENT_PRODUCTION_ARCHITECTURE.md`. Treat this document as a historical/aspirational plan from 2026-05-17, not a live procedure, until it is either executed for real or formally retired. In particular, the "Exit gate — pilot go-live" checklist below was never actually the gate the real pilot went live through.

**Cost:** ₹10,000–15,000/month  
**Purpose:** Production-grade hosting for pilot tenants; multi-tenant RLS enforced; daily backups  
**Workflow:** [promote-stage3.yml](../../.github/workflows/promote-stage3.yml)

## 1. Services

| Service | Provider | Tier | Notes |
|---------|----------|------|-------|
| API | Railway | Starter (2 vCPU, 2 GB RAM) | Always-on; separate worker service |
| Worker | Railway | Dedicated service | BullMQ worker process |
| Web | Vercel | Pro with team | Custom domain, analytics, edge |
| Database | Neon / Railway managed Postgres | Pro (50 GB, daily PITR) | Or Railway managed Postgres |
| Redis | Upstash | Pro (1 GB, persistence) | BullMQ durable jobs + auth |
| Object Storage | Cloudflare R2 | Pay-as-you-go | Product images, import exports |

## 2. Architecture checklist

- [ ] API and Worker run as separate Railway services pointing to the same DB
- [ ] `QUEUE_WORKER_ENABLED=true` on Worker service; `false` on API service
- [ ] RLS policies applied: `npm run tenant:verify-rls:ci`
- [ ] Backups configured: Neon daily backup or `pg_dump` cron to R2 bucket
- [ ] `DATA_RETENTION_DAYS_PERSONAL=365` confirmed
- [ ] `DPDP_CONSENT_VERSION=1` set

## 3. Daily backup procedure

```bash
# Automated via Railway cron or GitHub Actions schedule
pg_dump "${DATABASE_URL_DIRECT}" \
  | gzip \
  | aws s3 cp - "s3://${R2_BUCKET_NAME}/backups/$(date +%Y-%m-%d).sql.gz" \
    --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
```

Verify backup weekly by restoring to a local Postgres and counting products/tenants.

## 4. Deploy checklist

- [ ] Copy `.env-templates/.env.stage3.example` → Railway environment variables
- [ ] Apply migrations via `promote-stage3` workflow or `npm run prisma:migrate:deploy`
- [ ] Run `promote-stage3` workflow with `STAGING_URL` input
- [ ] Confirm `tenant:verify-rls:ci` exits 0
- [ ] Trigger import test: upload 50-row CSV, confirm all rows land in Postgres
- [ ] Confirm backup created for the day

## 5. Exit gate — pilot go-live

All of the following must be true before onboarding pilot tenants:

- [ ] `promote-stage3` workflow exits 0
- [ ] RLS isolation test passes: `npm run test:integration:rls-isolation`
- [ ] Daily backup verified (restore + product count match)
- [ ] Legal/DPDP consent banner live on Web
- [ ] Incident response runbook reviewed: [incident-response.md](../runbooks/incident-response.md)
- [ ] On-call rotation set up: [on-call-guide.md](../runbooks/on-call-guide.md)
