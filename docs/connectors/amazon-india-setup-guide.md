---
title: Amazon India Connector Setup Guide
audience: sellers
status: active
last_updated: 2026-05-26
owner: Product / Connector team
---

Use this guide to connect your Amazon India Seller Central account to Vexa PIM. This connector lets you map your product catalog to Amazon India and queue products for submission.

> **Current status:** Amazon India connector is in limited availability. Credential entry and channel mapping work. Full SP-API publish requires `FEATURE_REAL_SPAPI_VALIDATION=true` on your workspace, which is not enabled for all pilot accounts. Confirm with Vexa before expecting live publish.

---

## 1. Prerequisites

Before starting setup, collect these from Amazon Seller Central:

- [ ] Active Amazon India Seller Central account
- [ ] SP-API application approved (see [Amazon SP-API developer docs](https://developer-docs.amazon.com/sp-api/))
- [ ] LWA (Login with Amazon) credentials:
  - LWA Client ID
  - LWA Client Secret
  - LWA Refresh Token (from OAuth authorization flow)
- [ ] Seller ID (found in Seller Central → Account info)
- [ ] Marketplace ID for India: `A21TJRUUN4KGV`

If you do not have an SP-API application, you must create one through Amazon Developer Console and request data access approval before proceeding.

---

## 2. Install the connector in Vexa

1. Go to **Channels → Connectors** in the Vexa PIM sidebar
2. Find the **Amazon India** tile and click **Set up**
3. Enter your credentials:
   - **LWA Client ID**: from your SP-API application
   - **LWA Client Secret**: from your SP-API application
   - **Refresh Token**: generated during the OAuth authorization step
   - **Seller ID**: your Amazon Seller Central seller ID
4. Click **Save credentials**
5. Vexa runs a health check. Wait for the status to show **Connected** or **Credentials saved**

Only `connector_admin` and `admin` roles can install and configure connectors.

---

## 3. Map your categories

After installation, map your Vexa categories to Amazon India browse nodes:

1. Go to **Channels → Connectors → Amazon India → Mappings**
2. For each Vexa category that contains products to publish, select the matching Amazon browse node
3. Save the mapping

Unmapped categories will not be eligible for Amazon India submission.

---

## 4. Verify readiness before submitting

Before queuing products for Amazon India, check:

- [ ] All products in the target category have a valid SKU, title, category, HSN code, and GST rate
- [ ] All required Amazon India fields are mapped (check **Channels → Readiness** for field-level warnings)
- [ ] Connector status shows as connected in **Channels → Connectors**
- [ ] No open blocking validation issues in **Quality → Validation**

---

## 5. Queue products for submission

Once the connector is set up and products pass readiness checks:

1. Go to **Catalog → Products**
2. Select approved products (status: `approved`)
3. Click **Publish to channel → Amazon India**
4. Monitor progress in **Operations → Submission Jobs**

Only `publisher`, `channel_manager`, and `admin` roles can queue channel submissions.

---

## 6. Known limitations

| Limitation | Detail |
|------------|--------|
| Publish not live for all accounts | Full SP-API publish is feature-flagged. Confirm with Vexa before expecting live submissions to appear in Seller Central. |
| Credential validation is a healthcheck only | The current install flow checks that credentials are structurally valid, not that they have sufficient SP-API permissions. Amazon may still reject submissions if scopes are missing. |
| ASIN sync not implemented | Existing ASINs are not synced back from Amazon. Vexa is used for outbound product data only. |
| No variant publish | Variant-level publish to Amazon India is not yet implemented. Parent products only. |

---

## 7. Troubleshooting

| Symptom | Check |
|---------|-------|
| Connector shows "Credential error" | Verify your LWA credentials have not expired. Refresh tokens expire if not used or if the SP-API application is modified. |
| Submission jobs stuck in `pending` | Check **Operations → Submission Jobs** for error messages. Ensure the worker service is running. |
| Products rejected after submission | Check the Amazon submission response in the job detail. Common causes: missing required fields, category mismatch, or SP-API permission scope too narrow. |
