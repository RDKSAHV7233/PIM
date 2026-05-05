#!/usr/bin/env bash
# db-backup.sh — Create a pg_dump backup and optionally upload to R2.
#
# Usage:
#   DATABASE_URL=postgres://... ./scripts/db-backup.sh [output-dir]
#
# Environment variables (all optional):
#   DATABASE_URL           – Postgres connection string (required)
#   DB_BACKUP_DIR          – Local output directory (default: ./backups)
#   R2_BUCKET_NAME         – If set, upload backup to R2 after dump
#   R2_ACCOUNT_ID          – Cloudflare R2 account ID
#   R2_ACCESS_KEY_ID       – R2 access key
#   R2_SECRET_ACCESS_KEY   – R2 secret key
#   R2_ENDPOINT            – Custom R2/S3 endpoint URL (overrides R2_ACCOUNT_ID)
#   APP_ENV                – Environment label embedded in backup file name

set -euo pipefail

DATABASE_URL="${DATABASE_URL:-}"
if [[ -z "$DATABASE_URL" ]]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  exit 1
fi

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ENV_LABEL="${APP_ENV:-unknown}"
BACKUP_DIR="${DB_BACKUP_DIR:-${1:-./backups}}"
BACKUP_FILE="${BACKUP_DIR}/vexa-pim-${ENV_LABEL}-${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"

echo "INFO: Starting database backup → ${BACKUP_FILE}"
pg_dump \
  --format=custom \
  --compress=9 \
  --no-password \
  "$DATABASE_URL" \
  --file="$BACKUP_FILE"

BACKUP_SIZE="$(du -sh "$BACKUP_FILE" | cut -f1)"
echo "INFO: Backup complete. Size: ${BACKUP_SIZE}"

if [[ -n "${R2_BUCKET_NAME:-}" && -n "${R2_ACCESS_KEY_ID:-}" ]]; then
  ENDPOINT="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com}"
  S3_KEY="backups/vexa-pim-${ENV_LABEL}-${TIMESTAMP}.dump"

  echo "INFO: Uploading backup to R2 s3://${R2_BUCKET_NAME}/${S3_KEY}"
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  AWS_DEFAULT_REGION="auto" \
  aws s3 cp "$BACKUP_FILE" "s3://${R2_BUCKET_NAME}/${S3_KEY}" \
    --endpoint-url "$ENDPOINT" \
    --no-progress

  echo "INFO: Upload complete → ${S3_KEY}"
fi

echo "INFO: db-backup.sh finished successfully."
