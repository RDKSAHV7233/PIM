#!/usr/bin/env bash
# db-restore.sh — Restore a pg_dump backup created by db-backup.sh.
#
# Usage:
#   DATABASE_URL=postgres://... ./scripts/db-restore.sh <backup-file>
#
# The target database must already exist; existing data will be dropped
# and replaced by the backup. Requires pg_restore in PATH.
#
# Environment variables:
#   DATABASE_URL   – Postgres connection string for the TARGET database (required)
#   R2_BUCKET_NAME / R2_* – If backup-file looks like an S3 key (no leading /),
#                           download it from R2 first, then restore locally.

set -euo pipefail

DATABASE_URL="${DATABASE_URL:-}"
if [[ -z "$DATABASE_URL" ]]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  exit 1
fi

BACKUP_FILE="${1:-}"
if [[ -z "$BACKUP_FILE" ]]; then
  echo "ERROR: Backup file path or R2 key required as first argument." >&2
  echo "Usage: $0 <backup-file-or-r2-key>" >&2
  exit 1
fi

TEMP_FILE=""
if [[ ! -f "$BACKUP_FILE" ]]; then
  if [[ -n "${R2_BUCKET_NAME:-}" && -n "${R2_ACCESS_KEY_ID:-}" ]]; then
    ENDPOINT="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com}"
    TEMP_FILE="$(mktemp --suffix=.dump)"
    echo "INFO: Downloading ${BACKUP_FILE} from R2 → ${TEMP_FILE}"
    AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    AWS_DEFAULT_REGION="auto" \
    aws s3 cp "s3://${R2_BUCKET_NAME}/${BACKUP_FILE}" "$TEMP_FILE" \
      --endpoint-url "$ENDPOINT" \
      --no-progress
    BACKUP_FILE="$TEMP_FILE"
  else
    echo "ERROR: File not found: ${BACKUP_FILE}" >&2
    exit 1
  fi
fi

echo "INFO: Restoring database from ${BACKUP_FILE}"
echo "WARNING: This will DROP all existing data in the target database."
read -r -p "Continue? [y/N] " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "INFO: Restore cancelled."
  [[ -n "$TEMP_FILE" ]] && rm -f "$TEMP_FILE"
  exit 0
fi

pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --no-password \
  --dbname="$DATABASE_URL" \
  "$BACKUP_FILE"

[[ -n "$TEMP_FILE" ]] && rm -f "$TEMP_FILE"
echo "INFO: db-restore.sh finished successfully."
