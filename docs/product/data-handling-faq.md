---
title: Data Handling FAQ for Sellers
audience: sellers
status: active
last_updated: 2026-05-25
owner: Product
---

Use this guide if you have questions about where your data is stored, who can access it, and your rights as a Vexa PIM customer.

Reference documents: [Privacy Policy](../legal/privacy-policy.md), [Data Retention Policy](../legal/data-retention-policy.md)

---

## Where is my data stored?

Your data is stored in a cloud database hosted in the region specified in your service agreement. For Indian customers on the standard plan, data is stored using Neon (PostgreSQL), which operates on infrastructure in your contracted region. Media files (images and documents) are stored in Cloudflare R2.

Your product data, workspace configuration, connector credentials, and user accounts are all isolated within your workspace — other Vexa PIM customers cannot see your data.

---

## Who at Vexa can access my data?

Platform operators can access your data only:
- to diagnose a support issue you have reported
- to perform maintenance, migrations, or security patching
- when required by law or regulation

Operators do not access customer product data for their own commercial purposes. All operator access is logged in the audit trail.

---

## Can I export all my data?

Yes. You can export your account and profile data at any time:

1. Go to **Settings → Account**.
2. Click **Request Data Export**.
3. You will receive a download link by email once the export is ready.

For bulk product data exports, use the catalog export feature in **Catalog → Export** or the [Bulk Import API](../api-integration-guide.md).

---

## Can I delete my account and data?

Yes. To request deletion:
1. Go to **Settings → Account**.
2. Click **Delete Account**.
3. Confirm the deletion.

Workspace deletion is handled by your workspace Admin. To delete a full workspace, contact your account team.

After account deletion:
- Your login and personal data is removed within 30 days.
- Audit logs related to your actions may be retained for up to 365 days for compliance purposes (see [Data Retention Policy](../legal/data-retention-policy.md)).
- Encrypted credential material is purged as part of workspace offboarding.

---

## What happens to my data if I cancel my subscription?

Your workspace remains readable for 30 days after cancellation. During this window you can export your data.

After 30 days:
- The workspace is suspended (no new logins).
- You can request a data export during the 30-day window by contacting your account team.
- After the retention window the workspace data is scheduled for deletion.

---

## How are my marketplace credentials stored?

Connector credentials (Amazon SP-API keys, Flipkart API keys, etc.) are encrypted at rest using AES-256 before being written to the database. The encryption key is separate from the database and rotated on the schedule defined in the [Credential Rotation Runbook](../runbooks/credential-key-rotation.md).

Plain-text credentials are never written to logs or audit records.

---

## Do you use cookies?

Yes. Vexa PIM uses the following cookies:

| Cookie | Purpose | Duration |
|--------|---------|----------|
| `pim_session` | Keeps you logged in | Session (expires on browser close, or 30 days if "Remember me") |
| CSRF token | Prevents cross-site request forgery | Session |
| OIDC state/nonce | Used during SSO login flows | Short-lived (minutes) |

We do not use analytics cookies or advertising cookies. See [Cookie Policy](../legal/cookie-policy.md) for details.

---

## What are my rights under India's DPDP Act 2023?

As an individual user (data principal) you have the right to:

| Right | How to exercise it |
|-------|--------------------|
| Access your personal data | Request a data export — see above |
| Correct inaccurate data | Update your profile in Settings → Account |
| Erase your personal data | Request account deletion — see above |
| Withdraw consent | Delete your account; contact your account team for workspace-level consent withdrawal |
| Grievance redressal | Contact us at the email in your welcome message |

For enterprise data processing agreements (where your organization is the data controller), refer to the [Master Service Agreement](../legal/msa.md).

---

## How long is my product data retained?

Product data and catalog content is retained for the lifetime of your active workspace. When your workspace is deleted or offboarded, product data is deleted as part of the offboarding process.

Audit logs (who changed what, when) are retained for a minimum of 365 days even after workspace deletion, for security and compliance traceability.

---

## Is my data backed up?

Yes. Backups run daily using Neon's point-in-time recovery (PITR) feature, with additional daily snapshots exported to Cloudflare R2. The backup retention window is 7 days by default.

See [Backup & Restore Runbook](../runbooks/backup-restore.md) for the full backup schedule and restore procedure.

---

## Can Vexa sell my product data to third parties?

No. Your product data is not sold, shared, or used for any purpose other than operating the Vexa PIM service you have contracted for.

---

## Who do I contact for privacy questions?

Contact your account team at the email address in your welcome message, or send a written request to the address in the [Privacy Policy](../legal/privacy-policy.md).
