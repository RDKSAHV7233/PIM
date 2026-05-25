---
title: Feature Flag Management Guide
audience: internal-ops
status: active
last_updated: 2026-05-25
owner: Engineering
---

Use this guide if you need to enable or disable a feature flag in production or staging.

## 1. Overview

Feature flags in Vexa PIM are environment variables prefixed with `FEATURE_`. They are evaluated at startup via [`apps/api/src/common/env-validation.ts`](../apps/api/src/common/env-validation.ts). All flags default to `"false"`.

There are currently 4 feature flags:

| Flag | Default | What it controls |
|------|---------|-----------------|
| `FEATURE_PUBLIC_SIGNUP_ENABLED` | `false` | Self-serve workspace signup at `POST /api/v1/signup/workspace` |
| `FEATURE_STRIPE_BILLING_ENABLED` | `false` | Stripe customer creation, subscription management, and webhook processing |
| `FEATURE_REAL_SPAPI_VALIDATION` | `false` | Amazon SP-API credential validation against live Amazon endpoints on connector install |
| `FEATURE_ONDC_ENABLED` | `false` | ONDC connector and submission routes |

## 2. Constraints

### `FEATURE_PUBLIC_SIGNUP_ENABLED`

Requires `AUTH_MODE=db`. If you set this to `true` without `AUTH_MODE=db`, the API refuses to start with:

```
AUTH_MODE: FEATURE_PUBLIC_SIGNUP_ENABLED=true requires AUTH_MODE=db
```

Do not enable on any environment that uses `AUTH_MODE=identities` (JSON-based identity config).

### `FEATURE_STRIPE_BILLING_ENABLED`

Requires `STRIPE_SECRET_KEY` to be non-empty. Without it, the flag is effectively ignored — `StripeService.isEnabled()` returns false even if the flag is `true`.

Enabling this flag causes:
- New workspace verifications to create a Stripe customer and subscription
- Stripe webhook events to update `TenantPlanProfile.billingStatus`
- `POST /api/v1/billing/checkout-session` to become available

Do not enable without configuring all Stripe env vars:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID_STARTER`
- `STRIPE_PRICE_ID_GROWTH`
- `STRIPE_PRICE_ID_ENTERPRISE`

See [Stripe Billing Runbook](stripe-billing-runbook.md) for full Stripe setup.

### `FEATURE_REAL_SPAPI_VALIDATION`

When `false`, Amazon SP-API credential installs succeed without contacting Amazon. Use this for staging and demo environments where sellers provide real credentials but you don't want Amazon validation to block setup.

When `true`, credentials are validated live against Amazon. Any SP-API API call failure during install is surfaced as an error to the user.

### `FEATURE_ONDC_ENABLED`

ONDC support is not production-ready (see [Known Limitations](../product/known-limitations.md)). Do not enable in production.

## 3. How to Change a Flag in Production (Railway)

1. Go to the [Railway dashboard](https://railway.app) and open the `pim1-api` service.
2. Click **Variables**.
3. Find the flag (e.g., `FEATURE_PUBLIC_SIGNUP_ENABLED`) or click **New Variable** if it is not yet set.
4. Set the value to `"true"` or `"false"`.
5. Click **Save**.
6. Railway automatically triggers a re-deploy. Watch the deploy log — the API will restart with the new value.

## 4. Verify After Toggle

### Verify `FEATURE_PUBLIC_SIGNUP_ENABLED=true`

```bash
# Availability check endpoint should return without auth
curl -s https://app.vexapim.com/api/v1/signup/workspace/availability?workspaceSlug=test-slug
# Expected: {"available":true} or {"available":false}
```

```bash
# Login page should show "Sign up" link — verify visually in browser
open https://app.vexapim.com/login
```

### Verify `FEATURE_STRIPE_BILLING_ENABLED=true`

```bash
# Stripe webhook endpoint should return 200 (not 404)
curl -s -o /dev/null -w "%{http_code}" -X POST https://app.vexapim.com/api/v1/billing/stripe/webhook
# Expected: 200 (with {"received":false} — signature will fail without valid payload)
```

Check Railway logs for:
```
StripeService: Stripe billing is enabled
```

### Verify `FEATURE_REAL_SPAPI_VALIDATION=true`

Install an Amazon connector with known-valid SP-API credentials. The install should succeed immediately. Install with invalid credentials should fail with a credential error (not succeed silently).

### Verify `FEATURE_ONDC_ENABLED=true`

ONDC routes become available at `/api/v1/connectors/ondc`. Do not enable in production.

## 5. Rollback

To disable a flag:
1. Set the value back to `"false"` in Railway Variables.
2. Save — re-deploy triggers automatically.

Data created while a flag was enabled is not automatically reverted. For example:
- Stripe customers created while `FEATURE_STRIPE_BILLING_ENABLED=true` remain in Stripe
- Workspaces created while `FEATURE_PUBLIC_SIGNUP_ENABLED=true` remain active

Contact engineering if data cleanup is needed after a rollback.

## 6. Staging vs Production

Always enable a flag in staging first and verify for at least 24 hours before enabling in production.

| Environment | Variable source |
|-------------|----------------|
| Local dev | `.env` file at repo root |
| Staging | Railway `pim1-api-staging` service variables |
| Production | Railway `pim1-api` service variables |
