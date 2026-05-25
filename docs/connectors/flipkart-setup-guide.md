---
title: Flipkart Connector Setup Guide
audience: sellers
status: active
last_updated: 2026-05-26
owner: Product / Connector team
---

Use this guide to connect your Flipkart Seller Hub account to Vexa PIM.

---

## 1. Prerequisites

- [ ] Active Flipkart Seller Hub account
- [ ] API access enabled for your seller account (request via Flipkart Seller Support if not enabled)
- [ ] API Key from Flipkart Seller Hub → Account → API Keys
- [ ] API Secret from the same page
- [ ] Your Flipkart Seller ID

---

## 2. Install the connector in Vexa

1. Go to **Channels → Connectors** in the sidebar
2. Find **Flipkart** and click **Set up**
3. Enter:
   - **API Key**: from Flipkart Seller Hub
   - **API Secret**: from Flipkart Seller Hub
   - **Seller ID**: your Flipkart seller account ID
4. Click **Save credentials**
5. Vexa runs a credential health check. The tile shows **Connected** when successful

Only `connector_admin` and `admin` roles can install connectors.

---

## 3. Map your categories

After installation:

1. Go to **Channels → Connectors → Flipkart → Mappings**
2. Map each Vexa category to the matching Flipkart category path
3. For each mapping, select the required Flipkart attributes that Vexa should include in submissions
4. Save mappings

Products in unmapped categories cannot be submitted to Flipkart.

---

## 4. Publish readiness checklist

Before queuing a product for Flipkart:

- [ ] Product status is `approved`
- [ ] Title, SKU, HSN code, GST rate, and description are filled
- [ ] Category is mapped to a Flipkart category
- [ ] Required Flipkart attributes are populated (see **Quality → Validation** for Flipkart field errors)
- [ ] At least one product image is attached
- [ ] Connector shows as connected

---

## 5. Queue products for submission

1. Go to **Catalog → Products**
2. Select approved products
3. Click **Publish to channel → Flipkart**
4. Track progress in **Operations → Submission Jobs**

`publisher`, `channel_manager`, and `admin` roles can queue submissions.

---

## 6. Known limitations

| Limitation | Detail |
|------------|--------|
| Variant granularity | Flipkart FSN sync (inbound product matching) is not yet implemented. Submissions are outbound only. |
| Bulk listing updates | Updating existing Flipkart listings via Vexa requires the product to be submitted again with all fields. Partial field updates are not supported in MVP. |

---

## 7. Troubleshooting

| Symptom | Check |
|---------|-------|
| Connector shows "Authentication failed" | Verify API key/secret have not been rotated in Flipkart Seller Hub. Re-enter credentials in Vexa. |
| Submission fails with "Category not found" | The Flipkart category path in the mapping may have changed. Update the category mapping. |
| Products stuck in `pending` | Confirm the Vexa worker service is running. Check **Operations → Submission Jobs** for the error detail. |
