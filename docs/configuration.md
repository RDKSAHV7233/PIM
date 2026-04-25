# Configuration

Status: Canonical  
Last reviewed: 2026-04-25

The source of truth for required API environment variables is `apps/api/src/common/env-validation.ts`. The example values live in `.env.example`.

## Core Variables

| Area | Variables |
|---|---|
| Database | `DATABASE_URL_POOLED`, `DATABASE_URL_DIRECT` |
| Auth | `JWT_SECRET`, `JWT_EXPIRY`, `AUTH_MODE`, `PIM_AUTH_PASSWORD`, `PIM_AUTH_IDENTITIES_JSON` |
| Tenancy | `PIM_DEFAULT_TENANT_KEY`, `PIM_DEFAULT_ROLE`, `PIM_ALLOW_LEGACY_HEADERS` |
| Web/API URLs | `PIM_API_BASE_URL`, `PIM_WEB_BASE_URL`, `CORS_ORIGIN`, `PORT` |
| Queue/cache | `REDIS_URL`, `QUEUE_BACKEND`, `QUEUE_WORKER_ENABLED` |
| Media | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`, `R2_ENDPOINT` |
| Credential encryption | `CREDENTIAL_ENCRYPTION_KEY_V1`, `CREDENTIAL_ENCRYPTION_KEY_V2`, `CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION` |
| Feature flags | `FEATURE_ONDC_ENABLED`, `NEXT_PUBLIC_FEATURE_ONDC_ENABLED`, `FEATURE_PUBLIC_SIGNUP_ENABLED`, `NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED`, `FEATURE_REAL_SPAPI_VALIDATION` |
| Commercial ops | `PIM_COMMERCIAL_CONTACT_URL`, `PIM_COMMERCIAL_CONTACT_EMAIL`, `PIM_COMMERCIAL_OPS_TOKEN`, `PIM_COMMERCIAL_TRIAL_DAYS` |

## Auth Modes

- `AUTH_MODE=local`: local development only.
- `AUTH_MODE=db`: required for staging and production.

When `AUTH_MODE=db`, do not use `PIM_AUTH_IDENTITIES_JSON`.

## Email Providers

Supported API values:

- `AUTH_EMAIL_PROVIDER=file`
- `AUTH_EMAIL_PROVIDER=console`
- `AUTH_EMAIL_PROVIDER=resend`

Staging cannot use `file`. Production must use `resend` and must set `AUTH_EMAIL_RESEND_API_KEY` and `AUTH_EMAIL_FROM`.

## Connector Variables

Connector credentials are stored through installation flows and encrypted in the database. Environment variables are used for connector-level defaults, validation toggles, and local/test credentials:

- Amazon: `AMAZON_CLIENT_ID`, `AMAZON_CLIENT_SECRET`, `PIM_AMAZON_VALIDATION_ENDPOINT`, `PIM_AMAZON_VALIDATION_TOKEN`, `PIM_AMAZON_WEBHOOK_SECRET`
- Flipkart: `FLIPKART_CLIENT_ID`, `FLIPKART_CLIENT_SECRET`, `PIM_FLIPKART_OAUTH_BASE_URL`, `FLIPKART_OAUTH_BASE_URL`, `PIM_FLIPKART_API_BASE_URL`, `FLIPKART_API_BASE_URL`
- Shopify: `PIM_SHOPIFY_*` variables where used by the Shopify connector and install flow
- Meesho: `MEESHO_MERCHANT_ID`, `MEESHO_SECRET_KEY`

When `FEATURE_REAL_SPAPI_VALIDATION=true`, API startup validation requires Amazon, Flipkart, and Meesho credential variables listed in `env-validation.ts`.

