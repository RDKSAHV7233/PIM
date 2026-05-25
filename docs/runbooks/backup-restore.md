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
| Postgres (full) | `pg_dump` → gzip → R2 | Daily (automated) | 30 days | `s3://${R2_BUCKET_NAME}/backups/` |
| Postgres (PITR) | Neon daily PITR | Continuous | 7 days (Neon Pro) | Neon dashboard |
| Media / images | Cloudflare R2 | Continuous (on upload) | Indefinite (pay-as-you-go) | R2 `media/` prefix |
| Redis | Upstash Pro persistence | AOF (per-write) | N/A — cache is rebuilt on reconnect | Upstash managed |

**Preferred recovery path:** Neon PITR for precision recovery (within 7-day window). Fall back to `pg_dump` for restores older than 7 days or if Neon PITR is unavailable.

---

## 2. Automated Daily Backup

The backup job is configured as a Railway cron service or GitHub Actions scheduled workflow. It runs at 02:00 UTC daily.

```bash
# The cron command (reference — do not run manually unless triggering ad-hoc backup):
pg_dump "${DATABASE_URL_DIRECT}" \
  | gzip \
  | aws s3 cp - "s3://${R2_BUCKET_NAME}/backups/$(date +%Y-%m-%d).sql.gz" \
    --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
```

Required env vars: `DATABASE_URL_DIRECT`, `R2_BUCKET_NAME`, `R2_ACCOUNT_ID`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.

---

## 3. Verify Backup Health

Run weekly. Confirm the most recent backup exists and is non-zero.

```bash
# List last 10 backups
aws s3 ls s3://${R2_BUCKET_NAME}/backups/ \
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
  | aws s3 cp - "s3://${R2_BUCKET_NAME}/backups/manual-$(date +%Y-%m-%dT%H%M%S).sql.gz" \
    --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

echo "Ad-hoc backup complete."

# Verify it landed
aws s3 ls s3://${R2_BUCKET_NAME}/backups/ \
  --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  | grep "manual-"
```

---

## 5. Restore from pg_dump Backup

Use when Neon PITR is unavailable or you need a backup older than 7 days.

```bash
# 1. Identify the target backup file
aws s3 ls s3://${R2_BUCKET_NAME}/backups/ \
  --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  --recursive | sort | tail -20

# 2. Stop API traffic before restoring — set Railway API replicas to 0
#    This prevents writes during the restore window.

# 3. Stream and restore (replaces all data in the target database)
aws s3 cp "s3://${R2_BUCKET_NAME}/backups/<YYYY-MM-DD>.sql.gz" - \
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

## 6. Restore via Neon PITR (Preferred)

Use for any restore within the last 7 days when you need a specific point in time.

1. Go to the **Neon dashboard** → your project → **Branches**
2. Click **Restore** on the main branch
3. Select the target date and time (UTC)
4. Neon creates a restore branch — validate it before promoting to main
5. After validation, promote the restore branch to replace the main branch
6. Reconnect the API: verify `DATABASE_URL_DIRECT` and `DATABASE_URL_POOLED` point to the correct Neon endpoint

PITR does not require stopping API traffic upfront, but **do stop traffic before promoting** the branch to main to avoid split-brain writes.

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
