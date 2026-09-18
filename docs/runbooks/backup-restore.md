---
title: Backup and Restore Runbook
audience: internal-ops
status: active
last_updated: 2026-05-26
owner: Engineering / DevOps
---

Use this runbook to verify backup health, trigger an ad-hoc backup, and restore to a specific point in time. Practice the restore procedure in staging at least once per quarter before any production incident requires it.

---

## 1. Backup Strategy

| Data | Method | Frequency | Retention | Location |
|------|--------|-----------|-----------|----------|
| Postgres (full) | `pg_dump` → gzip → R2 | Daily (automated, `.github/workflows/backup-r2-daily.yml`) | 30 days (7-backup floor) | R2 `${R2_PRIVATE_BUCKET_NAME}/backups/` |
| Media / images | Cloudflare R2 | Continuous (on upload) | Indefinite (pay-as-you-go) | R2 `media/` prefix |
| Redis | Railway-managed volume, `--save 60 1` RDB snapshot | Snapshot on write activity | N/A — cache is rebuilt on reconnect | Railway `Redis` service volume |

**Current environment note (corrected 2026-08-27):** staging/production Postgres runs as a **self-hosted Railway service** (`ghcr.io/railwayapp-templates/postgres-ssl` image + Railway volume), not Neon. There is no managed point-in-time-recovery product in front of it — this doc previously described a Neon PITR path that was never actually provisioned in this environment. **The daily `pg_dump` → R2 backup below is the only real recovery path.** RPO is bounded by the backup interval (up to 24h), not by continuous PITR. If Neon (or another PITR-capable managed Postgres) is adopted later, restore this section's PITR guidance and update RES-05E accordingly — until then, do not tell an incident responder to look for a Neon dashboard.

**Confirmed 2026-09-17, directly against the Railway dashboard:** Railway's own backup/PITR is Pro-plan-only; this account is on Hobby, "No backup schedule" is configured, and there's exactly one manual snapshot (~25 days old) per Postgres instance. Railway contributes nothing ongoing — the workflow below is the entire real backup mechanism.

**Second gap, also confirmed 2026-09-17:** there are actually **two** Postgres instances in this Railway project. This whole runbook — including the workflow below — only ever covers the main application database (`STAGING_DATABASE_URL_DIRECT`). The second instance, backing `OBSERVABILITY_DATABASE_URL` (captured errors/exceptions), has **no backup path at all** — not this workflow, not a Railway snapshot, nothing. It's designed to fail open and self-purge after 90 days, so treating it as disposable is probably the right call, but nobody has written that decision down. Add it to the workflow below or explicitly accept the gap here — don't leave it silent.

---

## 2. Automated Daily Backup

The backup job is `.github/workflows/backup-r2-daily.yml`, running `scripts/r2-backup-run.cjs` on a `0 2 * * *` (02:00 UTC) schedule, or on-demand via the workflow's `workflow_dispatch` trigger (Actions tab → "Daily R2 Database Backup" → Run workflow).

The script: `pg_dump` (plain SQL, PostgreSQL 18 client to match the server) → gzip → upload to `${R2_PRIVATE_BUCKET_NAME}/backups/<ISO-timestamp>.sql.gz` → verify the uploaded object is non-zero via a `HeadObject` call (fails the run if not) → prune backups older than 30 days, always keeping at least the 7 most recent regardless of age.

Required GitHub Actions secrets (repo → Settings → Secrets and variables → Actions): `STAGING_DATABASE_URL_DIRECT` (already present), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PRIVATE_BUCKET_NAME` (**not yet added as of 2026-08-27** — the workflow fails closed with a clear message if any are missing rather than silently no-op'ing).

Manual reference command, for an ad-hoc backup outside the workflow (see section 4):

```bash
pg_dump --format=plain --no-owner --no-privileges "${DATABASE_URL_DIRECT}" \
  | gzip \
  | aws s3 cp - "s3://${R2_PRIVATE_BUCKET_NAME}/backups/manual-$(date -u +%Y-%m-%dT%H%M%SZ).sql.gz" \
    --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
```

---

## 3. Verify Backup Health

Run weekly. Confirm the most recent backup exists and is non-zero.

```bash
# List last 10 backups
aws s3 ls s3://${R2_PRIVATE_BUCKET_NAME}/backups/ \
  --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  --recursive | sort | tail -10

# Check file size — a healthy full backup is typically 10–500 MB depending on catalog size
# A zero-byte or missing today's file means the cron failed — investigate Railway/GitHub Actions logs
```

---

## 4. Trigger an Ad-hoc Backup

Use before a risky migration or schema change.

```bash
# Set env vars first (or export from Railway env)
pg_dump "${DATABASE_URL_DIRECT}" \
  | gzip \
  | aws s3 cp - "s3://${R2_PRIVATE_BUCKET_NAME}/backups/manual-$(date +%Y-%m-%dT%H%M%S).sql.gz" \
    --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

echo "Ad-hoc backup complete."

# Verify it landed
aws s3 ls s3://${R2_PRIVATE_BUCKET_NAME}/backups/ \
  --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  | grep "manual-"
```

---

## 5. Restore from pg_dump Backup

This is the only restore path in the current environment (see section 6 — no PITR is available). Use the most recent backup for the smallest possible data loss.

```bash
# 1. Identify the target backup file
aws s3 ls s3://${R2_PRIVATE_BUCKET_NAME}/backups/ \
  --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  --recursive | sort | tail -20

# 2. Stop API traffic before restoring — set Railway API replicas to 0
#    This prevents writes during the restore window.

# 3. Stream and restore (replaces all data in the target database)
aws s3 cp "s3://${R2_PRIVATE_BUCKET_NAME}/backups/<YYYY-MM-DD>.sql.gz" - \
  --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  | gunzip \
  | psql "${DATABASE_URL_DIRECT}"

# 4. Verify row counts
psql "${DATABASE_URL_DIRECT}" -c "SELECT COUNT(*) FROM \"Product\";"
psql "${DATABASE_URL_DIRECT}" -c "SELECT COUNT(*) FROM \"Tenant\";"
psql "${DATABASE_URL_DIRECT}" -c "SELECT COUNT(*) FROM \"WorkspaceDirectory\";"

# 5. Run RLS isolation check
npm run test:integration:rls-isolation

# 6. Re-enable API traffic (set replicas back to 1)
```

---

## 6. Point-in-Time Recovery — NOT AVAILABLE

This section previously described restoring via Neon PITR. **Neon is not used in this environment** — Postgres runs as a self-hosted Railway service (`ghcr.io/railwayapp-templates/postgres-ssl` image on a Railway volume), which has no continuous point-in-time-recovery capability without separately configured WAL archiving (not currently set up).

The only recovery path today is section 5 (restore from the daily `pg_dump` backup). This means recovery can only return the database to the state as of the most recent daily backup (up to 24h of data loss), not to an arbitrary point in time.

If sub-24h RPO becomes a requirement, evaluate either (a) enabling WAL-archiving-based PITR against the existing Railway Postgres, or (b) migrating to a managed Postgres provider with built-in PITR (e.g. Neon, RDS). Until one of those is implemented, do not tell an incident responder to look for a Neon dashboard — it doesn't exist.

---

## 7. Media / R2 Restore

Product images stored in R2 are not backed up separately — R2 provides 11 nines of durability and is the primary store.

- If an image file is accidentally deleted, it is not recoverable from backup.
- If the R2 bucket itself is deleted, contact Cloudflare support immediately (bucket deletion is irreversible within the standard retention window).
- The `pg_dump` backup does NOT include media files — it only covers database rows. Image URLs in the database point to R2; as long as R2 is intact, images are accessible after a DB restore.

---

## 8. Post-Restore Validation

After any restore, run these checks before re-enabling user traffic:

```bash
# API health
curl https://api.yourvexa.com/api/v1/health
# Expected: {"status":"ok"}

# Database connectivity
node -e "const {PrismaClient} = require('@prisma/client'); const p = new PrismaClient(); p.\$queryRaw\`SELECT 1\`.then(() => { console.log('DB ok'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });"

# RLS isolation
npm run test:integration:rls-isolation

# Product count — compare against pre-incident dashboard reading
psql "${DATABASE_URL_DIRECT}" -c "SELECT COUNT(*) FROM \"Product\";"

# Submission pipeline — submit a test product and confirm it reaches Operations → Jobs
```

See `docs/runbooks/disaster-recovery.md` for the full post-recovery checklist.

---

## 9. Backup Failure Response

If the daily backup did not run:

1. Check Railway cron logs or GitHub Actions workflow run for error detail
2. Verify `DATABASE_URL_DIRECT` and R2 credentials are still valid in the cron service env vars
3. Trigger an ad-hoc backup immediately (section 4 above)
4. Investigate and fix the cron failure before the next scheduled run
5. If backup has been missing for more than 48 hours, page DevOps on call (P1)
