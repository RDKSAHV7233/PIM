# Shopify Direct-Token Onboarding Guide

Last reviewed: 2026-09-04

Status: INTERNAL PILOT USE ONLY — not approved for public distribution

Owner: Product / Connector Engineering / CTO

Audience: Vexa operator and first-tenant pilot customer (ENTERPRISE tier,
operator-supervised onboarding)

Governing claim authority:
`docs/readiness/CONNECTOR_CLAIM_AUDIT_2026-09-03.md`

---

## 1. Prerequisites

Before starting, confirm:

- [ ] Vexa PIM workspace provisioned (ENTERPRISE plan, active paid)
- [ ] User account with **admin** or **connector_admin** role
- [ ] Shopify store with a Shopify plan that supports custom apps (Basic
      Shopify or higher)
- [ ] Access to Shopify Admin for the target store
- [ ] Products in Vexa PIM catalog with status **Approved** and channel
      readiness passing for Shopify

---

## 2. Create a Shopify Custom App

Vexa connects to your Shopify store using a custom app's Admin API access
token. This is a direct-token integration — no OAuth redirect flow is
involved.

### Step-by-step

1. Log in to your **Shopify Admin** (e.g. `https://your-store.myshopify.com/admin`).
2. Go to **Settings → Apps and sales channels → Develop apps**.
3. If custom app development is not enabled, click **Allow custom app
   development** and confirm. This requires the store owner account.
4. Click **Create an app**. Name it something like `Vexa PIM Connector`.
5. Click **Configure Admin API scopes**. Grant these scopes:
   - `write_products` (required — Vexa creates and updates products)
   - `read_products` (required — Vexa reads product data for validation)
   - `read_locations` (recommended — for inventory location awareness)
6. Click **Save** and then **Install app**.
7. After install, go to the **API credentials** tab. Copy the **Admin API
   access token**. You will only see it once — store it securely.
8. Note your store's **myshopify.com domain** (e.g.
   `your-store.myshopify.com`). This is shown at the top of your Shopify
   Admin or in your browser URL bar.

**Security note:** The access token grants write access to your Shopify
product catalog. Vexa encrypts it at rest using AES-256-GCM with versioned
keys. The token is never displayed in the Vexa UI after initial entry and is
redacted from API responses and error payloads.

---

## 3. Install the Shopify Connector in Vexa

1. Log in to **Vexa PIM** (`app.vexapim.com`) with your admin account.
2. In the sidebar, go to **Connections → Connections**.
3. Find **Shopify** in the connector list and click **Install**.
4. Fill in the install form:
   - **Account alias** (optional): a friendly name like `My Main Store`
   - **Shop domain**: your `*.myshopify.com` domain (e.g.
     `your-store.myshopify.com`)
   - **Access token**: paste the Admin API access token from step 2.7
5. Click **Install**. Vexa will validate the token against your store.
6. On success, the connector status changes to **Connected** and appears in
   the Connections action rail.

If installation fails:
- Verify the access token was copied completely (no leading/trailing spaces).
- Confirm the custom app is installed in Shopify (not just created).
- Check that the required API scopes (`write_products`, `read_products`) are
  granted.
- Contact the Vexa operator for assistance.

---

## 4. Prepare Products for Publishing

Products must meet these conditions before they can be published to Shopify:

1. **Status: Approved** — products must pass through the review/approval
   workflow. Draft or In Review products cannot be published.
2. **Channel readiness: Passing** — the product's Channel Readiness column in
   the catalog shows whether all required fields for Shopify are mapped.
3. **Field mapping configured** — go to **Mappings** in the sidebar to review
   how Vexa fields map to Shopify product fields. The default mapping covers:
   - Title → Shopify title
   - Description → Shopify body HTML
   - Price → Shopify variant price
   - SKU → Shopify variant SKU
   - Main image (single HTTPS URL) → Shopify product image

### What is NOT mapped in the current scope

- Multiple images (only the main image is synced)
- Multi-dimensional variants (e.g. size × color matrix — only single-variant
  products are verified)
- Metafields beyond the default mapping
- Inventory quantities (location-aware inventory sync is not in scope)
- Collections/tags

---

## 5. Publish Products

### Single product publish

1. Open a product from **Products** in the catalog.
2. Confirm it shows **Approved** status and Shopify channel readiness is
   passing.
3. Click **Publish** (or the publish action in the product detail view).
4. Select the Shopify connector/account.
5. Confirm and submit. The product enters the submission queue.
6. Monitor the result in **Submission Log** — the status should move from
   queued → submitted → accepted (or rejected with an error message).

### Bulk publish (up to 50 per batch)

1. Go to **Products** in the catalog.
2. The **Bulk publish to a channel** panel appears above the product list.
3. Select **Shopify** as the channel.
4. Check the products you want to publish (only approved, channel-ready
   products are eligible). Or click **Select all N eligible on this page**.
5. Click **Publish selected**. Up to 50 products per batch.
6. Monitor results in the **Submission Log**.

### Edit and republish

If you need to correct a live Shopify listing:

1. Edit the product in Vexa PIM (update title, description, price, etc.).
2. Re-approve if required by your workflow.
3. Publish again — Vexa detects the existing Shopify product link and updates
   it rather than creating a duplicate.
4. Verify the change in **Submission Log** (status: accepted) and confirm in
   Shopify Admin.

---

## 6. Monitor Submissions

The **Submission Log** (sidebar → Submission Log) shows every publish
attempt:

| Column | Meaning |
| --- | --- |
| Total Submissions | All publish attempts for this workspace |
| Pending | Currently queued — should be 0 under normal operation |
| Accepted | Successfully published to the channel |
| Rejected/Error | Failed — click through for error details |

The **Latest Submission Timeline** shows the most recent submission with
timestamps and status transitions.

If a submission is rejected:
- Open the submission detail to see the Shopify API error.
- Common issues: missing required fields, invalid image URL, API rate limit.
- Fix the product data in Vexa, re-approve, and republish.

**Alert:** If the Pending count is non-zero for more than a few minutes,
contact the Vexa operator. Stuck submissions are a P0 issue.

---

## 7. Reconnect or Update Credentials

If your Shopify access token is rotated or revoked:

1. Go to **Connections** in the sidebar.
2. Find your Shopify connector account.
3. Click the account to open the detail view.
4. Use the **Update credentials** action (requires admin or connector_admin
   role; may require step-up authentication).
5. Paste the new access token.
6. Vexa re-validates against your store on save.

---

## 8. Known Limitations

| Area | Limitation |
| --- | --- |
| Images | Single main image only. Multi-image sync is not available. |
| Variants | Single-variant products verified. Multi-dimensional variant matrices (size × color) are not verified with production data. |
| OAuth | Managed OAuth is not available. Direct-token (custom app) only. |
| Webhooks | Shopify webhook subscriptions are not created. There is no automatic inbound sync from Shopify to Vexa. |
| Inventory | Inventory quantity sync is not in scope. |
| Collections | Shopify collections/tags are not managed by Vexa. |
| Batch size | Bulk publish is limited to 50 products per batch. |
| Automatic sync | There is no scheduled or automatic push. All publishes are user-initiated. |

For the full list of platform limitations, see the Known Limitations page in
Vexa PIM documentation.

---

## 9. Support and Escalation

During the controlled pilot:

- **Primary contact:** Vexa operator (CTO) — provided during onboarding.
- **Response time:** Best-effort during business hours. No formal SLA during
  pilot evaluation.
- **Escalation:** Contact the operator directly. There is no self-serve
  support portal during pilot.

Report any of the following immediately:
- Submissions stuck in Pending state
- Connector showing "Needs Attention" in the action rail
- Access token validation failures after a successful install
- Products appearing duplicated in Shopify after republish

---

## 10. Scope Boundary

This guide covers only the verified direct-token Shopify connector scope for
the controlled pilot. It does not cover or imply:

- Production-ready or GA status
- SLA-backed availability
- Managed OAuth or app-store distribution
- Webhook-based automatic sync
- Multi-image or multi-variant support
- Public pricing or plan commitments

All claims in this guide are bounded by the connector claim audit at
`docs/readiness/CONNECTOR_CLAIM_AUDIT_2026-09-03.md`. No claim in this
guide may exceed the verdict in that audit without a fresh audit refresh
and CTO/PO sign-off.
