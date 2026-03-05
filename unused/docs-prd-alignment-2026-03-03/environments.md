# Environments

## Development
- Local machine with `.env`.
- Shared services optional (`docker compose`).
- Base API URL: `http://localhost:4000/api/v1`.

## Staging
- Dedicated app + Postgres + Redis + media bucket.
- Target URL: `https://pim1-staging.fly.dev`.
- Bucket: `pim1-media-staging`.
- Smoke tenant required for gate checks.

Gate sign-off format:

```json
{
  "environment": "staging",
  "tenantId": "SMOKE_TENANT_ID",
  "date": "2026-03-03",
  "gitTag": "vX.Y.Z",
  "runUrl": "https://github.com/<org>/<repo>/actions/runs/<id>"
}
```

## Production
- Separate infra from staging.
- Never share DB instance or Redis with staging.
- All feature gates must pass in staging before production deploy.
