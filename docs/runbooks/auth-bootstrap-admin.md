# Auth Bootstrap Admin Runbook

## Purpose
Create or update the first admin identity in DB-backed auth mode.

## Preconditions
- `AUTH_MODE=db`
- migrations applied
- `PIM_AUTH_PASSWORD` configured

## Command
```bash
npm run auth:bootstrap-admin -- --userId admin --tenantKey default --role admin --createdBy ops
```

## Verify
1. Login with `userId=admin` and configured password.
2. Decode JWT and verify `role=admin`, `tenantId=default`.
3. Open `/settings/connectors` and verify admin actions are visible.
