# Auth Bootstrap Admin Runbook

## Purpose
Create or update the first admin identity in DB-backed auth mode.

## Preconditions
- `AUTH_MODE=db`
- migrations applied
- bootstrap password available via `--password` or `PIM_BOOTSTRAP_PASSWORD`

## Legacy hash cutover
Before disabling DB-backed shared-password fallback, migrate any remaining legacy rows:

```bash
npm run auth:migrate:legacy-password-hashes -- --tenant default
```

The script reports `updatedCount` and `remainingCount`. Do not remove the DB fallback path until `remainingCount` is `0`.

## Command
```bash
npm run auth:bootstrap-admin -- --userId admin --tenantKey default --role admin --createdBy ops --password "<temporary-password>"
```

## Verify
1. Login with `userId=admin` and the bootstrap password used above.
2. Decode JWT and verify `role=admin`, `tenantId=default`.
3. Open `/admin/connectors` and verify admin actions are visible.
