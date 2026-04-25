# Troubleshooting

Status: Canonical  
Last reviewed: 2026-04-25

## API Fails On Startup

Check `.env` against `apps/api/src/common/env-validation.ts`. Common causes:

- `JWT_SECRET` shorter than 32 characters
- missing database URLs
- missing R2 variables
- staging/production using `AUTH_MODE=local`
- staging/production using `QUEUE_BACKEND=memory`
- `AUTH_EMAIL_PROVIDER=resend` without API key or sender

## Web App Cannot Reach API

Confirm:

- API is running with `npm run dev:api`
- `PIM_API_BASE_URL` points to `http://localhost:4000/api/v1`
- `CORS_ORIGIN` includes the web origin

## Database Or Prisma Errors

Run:

```bash
npm run infra:up
npm run prisma:generate
npm run prisma:migrate:deploy
```

For tenant-sensitive changes, run RLS verification scripts from `package.json`.

## Connector Lane Looks Wrong

Connector health depends on definitions, installed accounts, credential status, and capability gating. A connector with disabled or failed credentials should surface setup or attention state instead of being treated as healthy.

Check:

- connector definition returned by `/api/v1/connectors/definitions`
- installed accounts for the tenant
- credential status and failure reason
- channel mapping readiness
- route contract tests for connector pages

## OpenAPI Drift

Run:

```bash
npm run openapi:check
```

If the diff is intentional, commit regenerated `docs/openapi.yaml` and `docs/openapi.json` with the API change.

## Stale Local UI

If route output appears stale, stop the web dev server and remove the Next.js build cache for `apps/web/.next`, then restart `npm run dev:web`.

