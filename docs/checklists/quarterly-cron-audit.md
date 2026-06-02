# Quarterly Cron/Job Audit Checklist

Run every quarter. For every date/time field in the database that implies a future action, verify a job or mechanism exists to act on it.

## Time-Dependent Fields

| Field | Table | Job/Mechanism | Schedule | What happens if it fails? |
|-------|-------|---------------|----------|---------------------------|
| `graceEndsAt` | TenantPlanProfile | `GracePeriodEscalationService` | Every 6 hours | Unpaid tenants keep access indefinitely |
| `paidThroughAt` | TenantPlanProfile | Stripe `customer.subscription.updated` webhook | Event-driven | Tenant stays on old plan tier |
| `trialEndsAt` | TenantPlanProfile | `CommercialRemindersService` (warnings at 7d and 1d) | Every 24 hours | No trial expiry warning, tenant may churn |
| `suspendedAt` | TenantPlanProfile | `JwtAuthGuard.assertTenantAccessActive()` (enforcement) | Per-request | Suspended tenant blocked at login |
| `cancelledAt` | TenantPlanProfile | Stripe `customer.subscription.deleted` webhook | Event-driven | Cancelled subscription not recorded |
| `tokenExpiresAt` | ConnectorCredential | Flipkart token expiry alerting service | Connector heartbeat | Expired credentials break sync silently |
| `credentialExpiresAt` | ConnectorCredential | Credential expiry warning UI banner | Per-page-load check | Seller doesn't know credentials need renewal |
| `expiresAt` | ApiAccessKey | JWT validation at `JwtAuthGuard` | Per-request | Expired API key rejected at auth layer |
| `lockedUntil` | AuthIdentity | Login attempt check in `AuthService` | Per-login | Locked user stays locked past cooldown |

## Audit Steps

1. For each row above, verify the "Job/Mechanism" column is still accurate:
   - Is the service still registered in its module?
   - Is the `QUEUE_WORKER_ENABLED` gate correct?
   - Has the interval/schedule changed?

2. Check for NEW time-dependent fields added since last audit:
   ```bash
   grep -rn "Date\|DateTime\|timestamp\|expiresAt\|endsAt\|Until" packages/db/prisma/schema.prisma
   ```

3. For each new field: does it have a corresponding action/trigger? If not, file a ticket.

4. Check job health:
   - Are there failed job entries in the BullMQ dashboard?
   - Are timer-based services logging their periodic runs?
   - Any `error` or `warn` logs from escalation/reminder services?

## Last Audit

| Date | Auditor | New fields found | Issues filed |
|------|---------|-----------------|--------------|
| 2026-06-02 | CTO | 0 (initial audit) | A-3 grace-period job created |
