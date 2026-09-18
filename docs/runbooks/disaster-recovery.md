---
title: Disaster Recovery Runbook
audience: internal-ops
status: active
last_updated: 2026-05-26
owner: Engineering / DevOps
---

Use this runbook when a production incident requires restoring service from a backup or failed-over state. Practice these steps in staging before any production incident.

## 1. RPO / RTO Targets

| Target | Value | Basis |
|--------|-------|-------|
| RPO (max data loss) | 24 hours | Daily `pg_dump` backup to R2 (`.github/workflows/backup-r2-daily.yml`) — the only real recovery path; no PITR is available (see `docs/runbooks/backup-restore.md` section 6) |
| RTO (max downtime) | 4 hours | Manual restore + smoke test window |

These are current-state targets for Pilot. Enterprise targets (lower RPO/RTO) require either active streaming replication or a managed Postgres with built-in PITR (e.g. Neon, RDS) — neither is in place today.

> **New gap, confirmed 2026-09-17:** the RPO/RTO targets above cover the main application database only. A **second Postgres instance** exists for observability data (`OBSERVABILITY_DATABASE_URL`, backing captured errors/exceptions) and has **no backup of any kind** — not the daily R2 job, not a Railway snapshot, nothing. That data is designed to fail open and self-purge after 90 days, so it's likely fine to treat as disposable — but that's never been written down as a decision. If it needs a real RPO, add it to `backup-r2-daily.yml` explicitly; if it doesn't, say so here instead of leaving it unaddressed.

> Also confirmed 2026-09-17, directly against the Railway dashboard: Railway's own backup/PITR is **Pro-plan-only**; this account is on **Hobby**, has **no backup schedule** configured, and has exactly one manual snapshot per database, ~25 days old. Railway itself contributes zero ongoing protection — the daily `pg_dump` → R2 job below is the entire real backup story for the main database.

---

## 2. Failure Scenarios and Recovery Steps

### 2A. Database Corruption or Accidental Deletion

**Symptoms:** API returns 500 on all catalog reads; database errors in API logs; missing tenant data.

**Recovery:**

```bash
# 1. Confirm the problem — check API logs
railway logs --service pim-api | tail -100

# 2. Stop traffic to prevent further writes
# On Railway: temporarily set API service replicas to 0 (do not delete the service)

# 3. Identify the last good backup
# Neon PITR: restore via Neon dashboard to the last known-good point in time
# pg_dump backup: list available backups in R2:
aws s3 ls s3://${R2_PRIVATE_BUCKET_NAME}/backups/ \
  --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  --recursive | sort | tail -10

# 4. Restore from pg_dump backup
aws s3 cp "s3://${R2_PRIVATE_BUCKET_NAME}/backups/<YYYY-MM-DD>.sql.gz" - \
  --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  | gunzip | psql "${DATABASE_URL_DIRECT}"

# 5. Run post-restore validation (see section 4)
# 6. Re-enable API traffic
```

**Escalation:** If restoration from backup fails, page CTO immediately (P0).

---

### 2B. Railway API Service Down

**Symptoms:** Web app shows "Reconnecting" banner; API health endpoint unreachable; all product operations fail.

**Recovery:**

```bash
# 1. Check Railway status
# Visit https://status.railway.app

# 2. Check service logs on Railway dashboard
# Look for crash loop, OOM, or deployment failure

# 3. Restart the service
railway service restart --service pim-api

# 4. If restart does not recover: re-deploy the last known-good image
# Use Railway dashboard → Deployments → Re-deploy last successful deployment

# 5. Verify health endpoint responds
curl https://api.yourvexa.com/api/v1/health
# Expected: {"status":"ok"}
```

**Note:** Migrations run as Railway `preDeployCommand`. A failed migration blocks the deploy and the previous version remains running. This is intentional — do not force-start without investigating the migration failure.

---

### 2C. Redis Down

**Symptoms:** Auth rate limiting not enforcing; JWT blocklist not checked (sessions cannot be revoked); BullMQ workers stop processing.

**Recovery:**

```bash
# Redis is on Upstash Pro (persistent). Check Upstash dashboard first.
# If Redis is truly unavailable:
# - The API falls back to in-memory for cache (CacheService has fallback)
# - Auth still works: bcrypt verification is DB-based
# - BullMQ jobs stop processing — no new submissions go through
# - JWT revocation does not work until Redis recovers

# 1. Check Upstash Redis dashboard for the PIM Redis instance
# 2. If Upstash reports the instance is healthy but API cannot connect:
#    verify REDIS_URL env var is correct on the API Railway service
# 3. If Upstash instance is degraded: wait for Upstash SLA recovery
#    or trigger a manual failover from the Upstash console

# After Redis recovers:
# - BullMQ workers auto-reconnect and resume processing queued jobs
# - In-flight jobs that were processing when Redis went down may need
#   manual retry via Operations → Dead Letter Queue
```

**SLA note:** Auth continues working during Redis outage. Session revocation is deferred until Redis recovers — inform users of this risk if the outage exceeds 30 minutes.

---

### 2D. Cloudflare R2 / Media Storage Down

**Symptoms:** Product images fail to load; media upload endpoint returns 500; account export fails.

**Recovery:**

```bash
# Media reads (CDN): Cloudflare CDN may serve cached images even if R2 is degraded.
# New uploads will fail. This is non-critical for catalog operations.

# 1. Check Cloudflare status: https://www.cloudflarestatus.com
# 2. If R2 is confirmed degraded, set appropriate expectations with active sellers:
#    - Existing images may still load via CDN cache
#    - New image uploads are unavailable until R2 recovers
# 3. No manual recovery action needed — services auto-recover when R2 comes back
# 4. After R2 recovers: retry any failed media uploads from Operations → Imports
```

---

## 3. Post-Recovery Validation Checklist

Run these checks after any recovery action before re-enabling user traffic:

```bash
# 1. API health
curl https://api.yourvexa.com/api/v1/health
# Expected: {"status":"ok"}

# 2. Database connectivity
node -e "const {PrismaClient} = require('@prisma/client'); const p = new PrismaClient(); p.$queryRaw\`SELECT 1\`.then(() => { console.log('DB ok'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });"

# 3. Row counts match pre-incident state
# Check product count for main tenant:
# Compare with last known-good count in monitoring dashboards

# 4. RLS isolation
npm run test:integration:rls-isolation

# 5. Submission pipeline
# Submit a test product to a test channel and confirm it reaches Operations → Jobs

# 6. Auth
# Log in with a known admin account and confirm JWT is issued correctly
```

---

## 4. Communication Template

When a P0 incident is confirmed, send within 15 minutes to all active pilot tenants:

> **Subject: Vexa PIM — Service Disruption**
>
> We are aware of an issue affecting Vexa PIM and are actively investigating. [Brief description, e.g., "Product catalog and submission operations are temporarily unavailable."]
>
> Current status: Under investigation. We will provide an update within [1 hour / 2 hours].
>
> Affected features: [List].
>
> Your data is safe. No action is required from you at this time.

Follow up with resolution notice once service is restored.

---

## 5. Escalation

| Severity | Who to page | When |
|----------|-------------|------|
| P0 — database loss, service fully down | CTO + DevOps on call | Immediately |
| P1 — degraded service, Redis/R2 down | DevOps on call | Within 30 minutes |
| P2 — partial degradation, single feature | DevOps next business day | Next business day |

See `docs/runbooks/incident-response.md` for full escalation matrix and contact details.
