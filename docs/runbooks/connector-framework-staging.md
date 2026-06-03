# Connector Framework — Staging Deployment Runbook

New env vars and operational notes introduced in the connector framework overhaul
(2026-06-03). Required before first staging or production deploy of this branch.

---

## New environment variables

### ConnectorHeartbeatService

| Variable | Required | Default | Notes |
|---|---|---|---|
| `CONNECTOR_HEARTBEAT_DISABLED` | No | _(not set)_ | Set to `true` to disable the 6-hour credential validation cycle. Use in test environments where connectors have no real credentials. Do NOT set in staging or production. |

The heartbeat runs 30 seconds after app boot and every 6 hours thereafter. It:
- Calls `validateCredentials()` on every `ACTIVE` or `CREDENTIAL_EXPIRED` connector installation
- Sets `ConnectorInstallation.status = CREDENTIAL_EXPIRED` on failure
- Auto-promotes `CREDENTIAL_EXPIRED → ACTIVE` when validation passes again
- Triggers credential key rotation if `CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION` has changed

**Verify in staging:** After deploy, check logs for `connector.credential.heartbeat_completed` within 5 minutes of boot.

---

### ConnectorSubmissionStorageService

Oversized submission payload snapshots (>64KB) are uploaded to R2 instead of written
to local filesystem. Uses the same R2 credentials as `AuthExportStorageService` and
`BulkImportStorageService`.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `R2_ACCOUNT_ID` | Yes (prod/staging) | — | Already required for account exports and bulk imports. Also used here. |
| `R2_ACCESS_KEY_ID` | Yes (prod/staging) | — | Same as above. |
| `R2_SECRET_ACCESS_KEY` | Yes (prod/staging) | — | Same as above. |
| `R2_BUCKET_NAME` | Yes (prod/staging) | — | Same bucket used for exports and imports. Snapshots are stored under `connector-snapshots/` prefix. |
| `R2_ENDPOINT` | No | `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com` | Override for local dev (e.g. MinIO at `http://localhost:9000`). |
| `CONNECTOR_SNAPSHOT_STORAGE_DIR` | No | `storage/connector-snapshots` | Local filesystem fallback path. Only used when `APP_ENV` is not `staging` or `production` and `R2_ACCOUNT_ID` is unset or `local-dev`. |

**In staging/production:** If `R2_ACCOUNT_ID` is set and `APP_ENV=staging` or `APP_ENV=production`, R2 is used automatically. If R2 is misconfigured, large payload snapshots are stored with `uploadFailed: true` inline — submissions are not blocked.

**Verify in staging:** Trigger a bulk publish of a product with a large attribute set. Check `ConnectorSubmission.payloadSnapshotUrl` contains an `https://` presigned R2 URL, not a local path.

---

### ConnectorHttpClient — per-connector rate limits

Rate limits are compiled-in defaults (no env var needed). Current values:

| Connector | Burst capacity | Sustained rate |
|---|---|---|
| `amazon-in` | 5 requests | 5 req/sec |
| `shopify` | 10 requests | 2 req/sec |
| `flipkart` | 3 requests | 1 req/sec |
| `meesho` | 2 requests | 1 req/sec |
| _(unknown)_ | 5 requests | 2 req/sec |

These are conservative defaults. Adjust in `connector-http-client.service.ts` if marketplace API documentation specifies higher limits.

---

## Credential key rotation — updated behaviour

> **This supersedes the manual rotation script described in `credential-key-rotation.md`.**

Key rotation is now **automatic on deploy** via `ConnectorHeartbeatService`:

1. On app boot (after 30s delay), heartbeat checks if any credentials are on a stale key version
2. If stale credentials are found, `ConnectorCredentialService.rotateAllCredentials()` is called automatically
3. Up to 100 credentials are re-encrypted per rotation run; subsequent heartbeat ticks process the remainder

**To rotate credentials:**
1. Add the new key: `CREDENTIAL_ENCRYPTION_KEY_V2=<new-key>`
2. Update the current version: `CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION=2`
3. Keep the old key: `CREDENTIAL_ENCRYPTION_KEY_V1=<old-key>` (required for decryption during rotation)
4. Deploy — rotation runs automatically at boot
5. Verify in logs: `connector.credential.rotation_completed` with `rotated > 0`
6. After all credentials are rotated, `CREDENTIAL_ENCRYPTION_KEY_V1` can be removed in a subsequent deploy

**Note:** The manual `npm run credentials:rotate` script is still available as a fallback. The automatic rotation handles the common case.

---

## Pre-deploy checklist

- [ ] `CONNECTOR_HEARTBEAT_DISABLED` is NOT set (or is `false`) in staging
- [ ] R2 credentials are configured: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
- [ ] At least one connector has credentials installed (to verify heartbeat fires)
- [ ] `CREDENTIAL_ENCRYPTION_KEY_V1` and `CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION=1` are set
- [ ] `APP_ENV=staging` is set (forces R2 over local filesystem fallback)

## Post-deploy verification

```bash
# 1. Wait ~60 seconds after deploy, then check heartbeat fired
grep "connector.credential.heartbeat_completed" /var/log/api.log | tail -1

# 2. Verify credential access works for an active installation
# (trigger a validateCredentials call via the admin UI or API)

# 3. Check snapshot upload works (trigger a publish and inspect the submission)
psql $DATABASE_URL -c "
  SELECT payload_snapshot_url, status
  FROM connector_submissions
  WHERE payload_snapshot_url IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 5;
"
```
