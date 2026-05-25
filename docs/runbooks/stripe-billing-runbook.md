---
title: Stripe Billing Runbook
audience: internal-ops
status: active
last_updated: 2026-05-25
owner: Engineering
---

Use this guide if you need to:
- manually set a tenant's plan tier or billing status
- check or repair a Stripe subscription
- handle a failed or missed webhook
- issue a refund
- suspend or unsuspend a tenant

Prerequisites: `PIM_COMMERCIAL_OPS_TOKEN` (internal ops token), Stripe dashboard access.

## 1. Check a Tenant's Current Billing State

```bash
curl -s https://app.vexapim.com/api/v1/billing/internal/commercial-state/<tenantKey> \
  -H "x-pim-ops-token: $PIM_COMMERCIAL_OPS_TOKEN"
```

Expected response shape:

```json
{
  "tenantKey": "acme-workspace",
  "planTier": "STARTER",
  "billingStatus": "trial",
  "accessStatus": "active",
  "trialEndsAt": "2026-06-08T00:00:00.000Z",
  "paidThroughAt": null,
  "externalCustomerId": "cus_abc123",
  "externalSubscriptionId": "sub_xyz789"
}
```

If `externalCustomerId` or `externalSubscriptionId` is `null`, the Stripe records were not created (check signup logs).

## 2. Manually Set Plan Tier

Use this when a pilot tenant should be moved to a different tier by operator action (e.g., upgrade from STARTER to GROWTH after a sales conversation).

```bash
curl -s -X POST https://app.vexapim.com/api/v1/billing/internal/plan-tier \
  -H "x-pim-ops-token: $PIM_COMMERCIAL_OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantKey": "acme-workspace",
    "planTier": "GROWTH",
    "actor": "ops:manual-upgrade-2026-05-25"
  }'
```

Verify by re-checking billing state. This does **not** change the Stripe subscription — update Stripe separately if billing needs to match.

## 3. Manually Set Billing Status

Use this to override `billingStatus` directly (e.g., set a trial tenant to `active_paid` after a manual payment confirmation).

```bash
curl -s -X POST https://app.vexapim.com/api/v1/billing/internal/commercial-state \
  -H "x-pim-ops-token: $PIM_COMMERCIAL_OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantKey": "acme-workspace",
    "billingStatus": "active_paid",
    "paidThroughAt": "2026-06-25T00:00:00.000Z",
    "actor": "ops:manual-payment-confirmed-2026-05-25"
  }'
```

Valid values for `billingStatus`: `trial`, `active_paid`, `past_due`, `cancelled`

All changes are recorded in the audit log with the `actor` field.

## 4. Check a Stripe Subscription

1. Go to [Stripe Dashboard → Subscriptions](https://dashboard.stripe.com/subscriptions).
2. Search by the `externalSubscriptionId` value from step 1.
3. The subscription shows current status, next billing date, and payment history.

Common statuses and their meaning in Vexa:

| Stripe status | Vexa `billingStatus` |
|--------------|----------------------|
| `active` | `active_paid` |
| `trialing` | `trial` |
| `past_due` | `past_due` |
| `canceled` | `cancelled` |
| `unpaid` | `past_due` |

## 5. Handle a Failed or Missed Webhook

Stripe webhooks can fail if the API was down or the signature check failed. To replay a missed event:

1. Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks).
2. Find the failed event in the event list.
3. Click **Resend**.

Alternatively, replay via Stripe CLI:

```bash
stripe events resend evt_xxxxxxxxxxxxxxxx
```

To verify the webhook endpoint is reachable:

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST \
  https://app.vexapim.com/api/v1/billing/stripe/webhook \
  -H "Content-Type: application/json" \
  -d '{}'
# Expected: 200 (with {"received":false} — signature will fail on empty payload)
```

If the endpoint returns 404, check that `StripeWebhookController` is registered in `BillingModule`.

Check webhook logs in Railway for delivery failures:

```
[StripeWebhookController] Stripe webhook signature verification failed: ...
[StripeWebhookController] Stripe webhook dispatch failed for event evt_xxx type=invoice.paid: ...
```

## 6. Manually Sync a Subscription State

If a Stripe subscription was updated but the webhook missed (or the DB state is wrong), use the Stripe CLI to retrieve the current state and then manually set billing status in Vexa:

```bash
# Get current Stripe subscription state
stripe subscriptions retrieve sub_xyz789

# Then set in Vexa using step 3 above, matching the Stripe status
```

## 7. Issue a Refund

Refunds are issued through the Stripe Dashboard — Vexa does not initiate refunds programmatically.

1. Go to [Stripe Dashboard → Payments](https://dashboard.stripe.com/payments).
2. Find the charge (search by customer ID or amount).
3. Click the charge.
4. Click **Refund**.
5. Enter the amount and reason.
6. Click **Refund**.

After the refund, update the tenant's billing status in Vexa manually if needed (e.g., set `billingStatus` back to `trial` if the subscription is being cancelled along with the refund).

## 8. Suspend a Tenant

Suspension sets `accessStatus = suspended`. All logins, API key requests, and JWT-authenticated requests are rejected with `TENANT_SUSPENDED`.

```bash
curl -s -X POST https://app.vexapim.com/api/v1/billing/internal/commercial-state \
  -H "x-pim-ops-token: $PIM_COMMERCIAL_OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantKey": "acme-workspace",
    "accessStatus": "suspended",
    "actor": "ops:suspend-non-payment-2026-05-25"
  }'
```

Verify: attempt to log in to the tenant's workspace — you should be redirected to `/account-suspended`.

## 9. Unsuspend a Tenant

```bash
curl -s -X POST https://app.vexapim.com/api/v1/billing/internal/commercial-state \
  -H "x-pim-ops-token: $PIM_COMMERCIAL_OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantKey": "acme-workspace",
    "accessStatus": "active",
    "billingStatus": "active_paid",
    "paidThroughAt": "2026-07-25T00:00:00.000Z",
    "actor": "ops:unsuspend-payment-received-2026-05-25"
  }'
```

Verify: tenant can log in successfully.

## 10. Configure Stripe Webhook Endpoint

When first setting up or after rotating the webhook secret:

1. Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks).
2. Click **Add endpoint**.
3. URL: `https://app.vexapim.com/api/v1/billing/stripe/webhook`
4. Select events:
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Copy the signing secret.
6. Update `STRIPE_WEBHOOK_SECRET` in Railway Variables.
7. Re-deploy the API service.

## 11. Required Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FEATURE_STRIPE_BILLING_ENABLED` | Yes (set to `true`) | Gates all Stripe functionality |
| `STRIPE_SECRET_KEY` | Yes | Stripe secret key (`sk_live_...` or `sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Yes | From Stripe webhook endpoint settings |
| `STRIPE_PRICE_ID_STARTER` | Yes | Stripe Price ID for STARTER plan |
| `STRIPE_PRICE_ID_GROWTH` | Yes | Stripe Price ID for GROWTH plan |
| `STRIPE_PRICE_ID_ENTERPRISE` | Yes | Stripe Price ID for ENTERPRISE plan |

See [Feature Flag Management Guide](feature-flag-management.md) for how to safely toggle `FEATURE_STRIPE_BILLING_ENABLED`.
