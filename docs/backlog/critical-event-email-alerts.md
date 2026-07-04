---
title: Critical Event Email Alerts
status: backlog
priority: high
depends_on: email-production-readiness (branded template wrapper)
---

## Purpose

Notify workspace admins when critical system events occur that require immediate attention or awareness. These are operational/security alerts, not marketing emails.

## Candidate events

| Event | Trigger | Urgency |
|-------|---------|---------|
| Workspace suspended | `CommercialNotificationsService.notifySuspension()` already sends; this covers additional admin recipients | High |
| Grace period final warning | 48h before grace expiry (cron or queue job) | High |
| Bulk import failure | Import job fails after retries exhausted | Medium |
| Connector credential expiry | Credential refresh fails N times in a row | Medium |
| Account export ready | Already implemented in `processAuthEmailJob()` | Done |
| Unusual login activity | Login from new IP/device after extended inactivity | Low (future) |

## Design constraints

- Must use the shared `renderEmailHtml` / `renderEmailText` wrapper
- Signature type: `security` for auth-related alerts, `commercial` for billing alerts, `support` for operational alerts
- No unsubscribe link on security/auth alerts
- Plain text body must be complete and actionable
- Rate-limit alerts per workspace to avoid flooding (e.g., max 1 connector-expiry alert per connector per 24h)
- Do not expose internal error details or stack traces in alert emails

## Implementation notes

- Add new categories to `AuthEmailMessage.category` union as needed
- Grace period warning requires a scheduled job (cron or BullMQ delayed job)
- Consider an `email_alert_log` table or Redis key to deduplicate and rate-limit
- Connector expiry detection may need a health-check sweep job that runs daily
- All alert emails should include: what happened, what the admin should do, and a link to the relevant page in the dashboard
