---
title: Seller Quick-Start Guide
audience: sellers
status: active
last_updated: 2026-05-25
owner: Product
---

Use this guide if you have just received access to Vexa PIM and want to get your first products imported and published to a marketplace.

## 1. Before You Start

You will need:
- Your login credentials (email and password from your welcome email)
- Your workspace URL: `https://app.vexapim.com` — use the subdomain your account team provided
- A product data file in CSV format (see [Import Template Guide](import-template-guide.md))
- API credentials from your marketplace (Amazon Seller Central or Flipkart Seller Hub)

Estimated setup time: 30–60 minutes for first import, 15 minutes for marketplace connection.

## 2. Log In and Orient Yourself

1. Go to your workspace URL.
2. Enter your email address and password.
3. On first login you land on the **Dashboard**. The left sidebar is your main navigation:
   - **Catalog** — all your products
   - **Channels** — marketplace connections
   - **Imports** — upload history
   - **Settings** — workspace preferences

## 3. Prepare Your Product CSV

Download the template:

```
https://app.vexapim.com/import-template.csv
```

Required columns: `title`, `category`, `hsn_code`, `gst_rate`

Optional but strongly recommended: `brand`, `description`, `sku`, `mrp`, `selling_price`

Rules:
- Save as `.csv` (UTF-8). Excel `.xlsx` is not supported.
- Maximum 30,000 rows per file.
- Do not leave the header row blank.

See [Import Template Guide](import-template-guide.md) for the full column reference and common validation errors.

## 4. Import Your Products

1. Click **Imports** in the sidebar.
2. Click **New Import**.
3. Select your CSV file.
4. Click **Upload**. The import starts immediately.
5. Watch the progress bar. Errors appear inline — each row shows what needs fixing.
6. When the import completes, the status changes to **Completed**. Click it to see how many products were created.

If rows were rejected, download the error report, fix the values in your CSV, and re-upload. Duplicate SKUs from a previous import are merged, not duplicated.

## 5. Review Your Products

1. Click **Catalog** in the sidebar.
2. Your imported products appear as **Draft** status.
3. Click any product to open the detail view.
4. Fill in any missing required fields flagged in red.
5. Save changes.

The status lifecycle is: **Draft → In Review → Approved → Published**

For a full explanation of each stage and who can approve, see [Product Workflow Explainer](workflow-guide.md).

## 6. Connect a Marketplace Channel

### Amazon India

1. Go to **Channels → Add Channel → Amazon India**.
2. Paste your LWA Client ID, LWA Client Secret, and Seller ID from Amazon Seller Central.
3. Click **Validate**. Vexa verifies the credentials with Amazon.
4. On success, the channel status changes to **Connected**.

Full prerequisites: [Amazon India Connector Setup Guide](../connectors/amazon-india-setup-guide.md)

### Flipkart

1. Go to **Channels → Add Channel → Flipkart**.
2. Paste your API Key and API Secret from Flipkart Seller Hub.
3. Click **Validate**.

Full prerequisites: [Flipkart Connector Setup Guide](../connectors/flipkart-setup-guide.md)

## 7. Publish Products

1. Navigate to **Catalog**.
2. Select the products you want to publish (tick the checkboxes).
3. Click **Publish to Channel** and choose your connected channel.
4. Confirm. Vexa submits the products to the marketplace.

You can track submission status per product under **Channels → Submissions**.

Note: Amazon submissions require your SP-API application to be approved for the `ASIN_CREATION` scope before new ASINs can be created. Existing ASIN updates work immediately after connection.

## 8. Fix Common Issues

| Problem | Likely cause | Fix |
|---------|-------------|-----|
| Import fails: "HSN code invalid" | HSN code not in allowed list | Check HSN against the [GST HSN master list](https://www.cbic.gov.in) |
| Import fails: "GST rate not valid" | Rate must be 0, 5, 12, 18, or 28 | Correct the `gst_rate` column |
| Channel status: "Credentials invalid" | Key or secret incorrect | Re-copy from Seller Central / Seller Hub — avoid trailing spaces |
| Product stuck in "Draft" | Required fields missing | Open the product, fix fields flagged red, save |
| Publish error: "ASIN scope not approved" | SP-API scopes pending Amazon review | Wait for Amazon approval; update submissions once approved |

## 9. Get Help

For issues not covered here:
- Check [Known Limitations](known-limitations.md) — some features are not yet available
- Contact your account team at the email in your welcome message
- For API integration questions, see [API & Webhook Integration Guide](../api-integration-guide.md)
