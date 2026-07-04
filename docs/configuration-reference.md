---
title: Environment Variables Reference
audience: internal-eng
status: active
last_updated: 2026-05-26
owner: Engineering
---

Use this document when setting up a new environment, debugging a misconfigured service, or understanding what breaks if a variable is missing. Source: `apps/api/src/common/env-validation.ts` and `.env.example`.

## 1. Critical Path — app fails to start without these

| Variable | Required | Default | What breaks if missing |
|----------|----------|---------|------------------------|
| `DATABASE_URL_POOLED` | Yes | — | API cannot connect to database |
| `DATABASE_URL_DIRECT` | Yes | — | Prisma migrations fail; needed for schema operations |
| `JWT_SECRET` or `PIM_JWT_SECRET` | Yes | — | All authentication fails |
| `CREDENTIAL_ENCRYPTION_KEY_V1` | Yes | — | Connector credentials cannot be encrypted/decrypted |
| `CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION` | Yes | `1` | Key rotation lookup fails |
| `APP_ENV` | Yes | — | Env validation rejects startup; must be `development`, `staging`, or `production` |

---

## 2. Infrastructure

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `REDIS_URL` | Yes | — | Auth rate limiting, JWT blocklist, cache; `redis://localhost:6379` locally |
| `R2_ACCOUNT_ID` | Yes | — | Cloudflare R2 media storage |
| `R2_ACCESS_KEY_ID` | Yes | — | R2 credentials |
| `R2_SECRET_ACCESS_KEY` | Yes | — | R2 credentials |
| `R2_BUCKET_NAME` | Yes | — | Target R2 bucket for uploads |
| `R2_PUBLIC_URL` | Yes | — | Public CDN URL prefix for media assets |
| `R2_ENDPOINT` | No | — | Override for S3-compatible endpoint; leave empty for Cloudflare R2 default |
| `PORT` | No | `4000` | API HTTP port |

---

## 3. Authentication

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `AUTH_MODE` | No | `local` | `local` = env-based identities; `db` = database identities. **Staging/production must use `db`** |
| `JWT_EXPIRY` | No | `4h` | Access token lifetime; increase with care (affects session security) |
| `CREDENTIAL_ENCRYPTION_KEY_V2` | No | — | Second key version for rotation; only set when rotating |
| `AUTH_EMAIL_PROVIDER` | No | `file` | `console` = log to stdout; `file` = write to outbox dir; `resend` = Resend API |
| `AUTH_EMAIL_FROM` | No | — | Sender address for auth emails |
| `AUTH_EMAIL_REPLY_TO` | No | — | Reply-to for auth emails |
| `AUTH_EMAIL_RESEND_API_KEY` | No | — | Required when `AUTH_EMAIL_PROVIDER=resend` |
| `AUTH_EMAIL_OUTBOX_DIR` | No | — | Required when `AUTH_EMAIL_PROVIDER=file` |
| `PIM_AUTH_IDENTITIES_JSON` | No | — | Local mode only — JSON user list; leave empty when `AUTH_MODE=db` |
| `PIM_AUTH_WORKSPACES_JSON` | No | — | Local mode only — JSON workspace list |

**Warning:** Do not start the API with `source .env` in bash — bash silently discards values containing `{`. Use `npm run dev:api` which uses `dotenv-cli`.

---

## 4. Commercial & Billing

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `PIM_COMMERCIAL_OPS_TOKEN` | Staging/Prod | — | Bearer token for internal billing ops endpoints (`/billing/internal/*`). Required to set plan tiers manually |
| `PIM_COMMERCIAL_CONTACT_URL` | No | — | URL shown to sellers when plan limit is exceeded or workspace is suspended |
| `PIM_COMMERCIAL_CONTACT_EMAIL` | No | — | Fallback email for commercial contact when URL is not set |
| `PIM_COMMERCIAL_TRIAL_DAYS` | No | `14` | Default trial length when creating a new tenant |
| `PIM_PLAN_TIER_OVERRIDE` | No | — | **Dev only** — set to `ENTERPRISE` to bypass quota checks in load tests. Ignored in staging/production |

### Email Brand Assets

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `PIM_EMAIL_LOGO_URL` | Recommended (staging/prod) | — | HTTPS URL to Vexa logo image displayed at top of all HTML emails. Email renders cleanly if missing. Must be HTTPS in staging/production |
| `PIM_EMAIL_BANNER_URL` | No | — | HTTPS URL to optional banner image for signup/commercial emails. Must be HTTPS in staging/production |
| `PIM_EMAIL_SUPPORT_URL` | No | — | Support page URL shown in email footer/signature |
| `PIM_EMAIL_SUPPORT_EMAIL` | No | — | Support email shown in email footer/signature when support URL is not set |

**Production requirement:** At least one commercial contact path (`PIM_COMMERCIAL_CONTACT_URL` or `PIM_COMMERCIAL_CONTACT_EMAIL`) must be configured. Commercial emails will not send without a valid contact path.

---

## 5. Feature Flags

| Variable | Required | Default | Controls |
|----------|----------|---------|---------|
| `FEATURE_PUBLIC_SIGNUP_ENABLED` | No | `false` | Enables `POST /signup/workspace` endpoint and web signup pages |
| `NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED` | No | `false` | Mirror for web — must match API value |
| `FEATURE_ONDC_ENABLED` | No | `false` | Shows ONDC connector in seller surfaces |
| `NEXT_PUBLIC_FEATURE_ONDC_ENABLED` | No | `false` | Mirror for web |
| `FEATURE_REAL_SPAPI_VALIDATION` | No | `false` | Enables live SP-API credential validation. Requires connector credentials below |
| `QUEUE_WORKER_ENABLED` | No | `true` | `false` disables background worker (do not disable in staging/production) |

---

## 6. Queue & Workers

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `QUEUE_BACKEND` | No | `memory` | `memory` for local dev; `bullmq` required in staging/production |

**Staging/production:** `QUEUE_BACKEND=bullmq` is enforced by env validation. In-memory queue loses jobs on restart.

---

## 7. Connector Credentials

Only required when `FEATURE_REAL_SPAPI_VALIDATION=true`:

| Variable | Connector |
|----------|-----------|
| `AMAZON_CLIENT_ID` | Amazon India (SP-API LWA client) |
| `AMAZON_CLIENT_SECRET` | Amazon India |
| `FLIPKART_CLIENT_ID` | Flipkart |
| `FLIPKART_CLIENT_SECRET` | Flipkart |
| `MEESHO_MERCHANT_ID` | Meesho (not yet live) |
| `MEESHO_SECRET_KEY` | Meesho (not yet live) |

---

## 8. Web App Variables

Web env vars are in `apps/web/.env` (or Railway env for the web service):

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_API_URL` or `PIM_API_BASE_URL` | Yes | Points web to the API; e.g. `https://api.yourvexa.com/api/v1` |
| `NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED` | No | Show signup link on login page |
| `PIM_COMMERCIAL_CONTACT_URL` | No | Contact CTA on suspension/plan-limit pages (server-side only) |
| `PIM_COMMERCIAL_CONTACT_EMAIL` | No | Fallback email for suspension page |
| `CONNECTOR_STUB_SLUGS` | No | Comma-separated connector slugs to hide from seller surfaces |
| `NEXT_PUBLIC_CONNECTOR_STUB_SLUGS` | No | Mirror for client-side channel surfaces |

---

## 9. Observability (optional)

| Variable | Notes |
|----------|-------|
| `SENTRY_DSN` | Activates Sentry error tracking; leave empty to disable |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry collector endpoint for traces |

---

## 10. Account Export Storage

| Variable | Default | Notes |
|----------|---------|-------|
| `ACCOUNT_EXPORT_STORAGE_MODE` | `auto` | `auto` = use R2 if configured, else filesystem; `filesystem` = local dir; `object_storage` = R2 always |
| `ACCOUNT_EXPORT_STORAGE_DIR` | — | Writable directory path; required when `ACCOUNT_EXPORT_STORAGE_MODE=filesystem` |

---

## 11. Validation at Startup

The API validates all env vars at boot via `validateEnv()` in `apps/api/src/common/env-validation.ts`. If required vars are missing or invalid, the process prints all issues and exits. To test your env before deploying:

```bash
npm run dev:api  # will print [ENV VALIDATION FAILED] and list all issues
```

To check staging/production constraints locally:

```bash
APP_ENV=staging npm run dev:api  # will fail unless AUTH_MODE=db and QUEUE_BACKEND=bullmq
```
