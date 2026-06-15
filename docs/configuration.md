# Configuration

Status: Canonical
Last reviewed: 2026-06-15

The source of truth for required API environment variables is `apps/api/src/common/env-validation.ts`. Example values live in `.env.example`.

## Main Variable Groups

| Area | Variables |
|---|---|
| Database | `DATABASE_URL_POOLED`, `DATABASE_URL_DIRECT` |
| Auth | `JWT_SECRET`, `JWT_EXPIRY`, `AUTH_MODE`, `PIM_AUTH_PASSWORD`, `PIM_AUTH_IDENTITIES_JSON` |
| Tenancy | `PIM_DEFAULT_TENANT_KEY`, `PIM_DEFAULT_ROLE`, `PIM_ALLOW_LEGACY_HEADERS` |
| Web/API URLs | `PIM_API_BASE_URL`, `PIM_WEB_BASE_URL`, `CORS_ORIGIN`, `PORT` |
| Queue/cache | `REDIS_URL`, `QUEUE_BACKEND`, `QUEUE_WORKER_ENABLED` |
| Media/object storage | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`, `R2_ENDPOINT` |
| Account export storage | `ACCOUNT_EXPORT_STORAGE_MODE`, `ACCOUNT_EXPORT_STORAGE_DIR` |
| Credential encryption | `CREDENTIAL_ENCRYPTION_KEY_V1`, `CREDENTIAL_ENCRYPTION_KEY_V2`, `CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION` |
| Feature flags | `FEATURE_ONDC_ENABLED`, `NEXT_PUBLIC_FEATURE_ONDC_ENABLED`, `FEATURE_PUBLIC_SIGNUP_ENABLED`, `NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED`, `FEATURE_REAL_SPAPI_VALIDATION` |
| Commercial ops | `PIM_COMMERCIAL_CONTACT_URL`, `PIM_COMMERCIAL_CONTACT_EMAIL`, `PIM_COMMERCIAL_OPS_TOKEN`, `PIM_COMMERCIAL_TRIAL_DAYS` |

## Auth Modes

- `AUTH_MODE=local`: local development only
- `AUTH_MODE=db`: required for staging and production

When `AUTH_MODE=db`, do not depend on `PIM_AUTH_IDENTITIES_JSON`.

## Email Providers

Supported API values:

- `AUTH_EMAIL_PROVIDER=file`
- `AUTH_EMAIL_PROVIDER=console`
- `AUTH_EMAIL_PROVIDER=resend`

Staging cannot use `file`. Production must use `resend`.

## Account Export Storage

- `ACCOUNT_EXPORT_STORAGE_MODE=auto`: dev falls back to local disk; staging/production use object storage
- `ACCOUNT_EXPORT_STORAGE_MODE=filesystem`: use a writable mounted path via `ACCOUNT_EXPORT_STORAGE_DIR`
- `ACCOUNT_EXPORT_STORAGE_MODE=object_storage`: force the R2/S3-compatible path

This applies to account export artifacts only. Media and bulk-import object storage still depend on the `R2_*` configuration.

## Connector And Feature Notes

- Connector credentials are primarily stored per installation in the database.
- Environment variables are still used for defaults, validation toggles, and some local/test paths.
- `FEATURE_PUBLIC_SIGNUP_ENABLED=true` also requires the public web flag for the UI to expose signup.
- `FEATURE_ONDC_ENABLED=true` only enables the ONDC route in non-production admin contexts.
- Real Amazon validation mode requires the related connector secrets defined in `env-validation.ts`.

