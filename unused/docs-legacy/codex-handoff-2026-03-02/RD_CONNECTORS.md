# RD_CONNECTORS.md
# PIM1 — Connector R&D Requirements
**What Codex cannot implement autonomously — and what you must resolve first**

---

## HOW TO USE THIS FILE

Every section below is a **hard blocker**. Codex will hit a `throw new Error('Not implemented — requires R&D')` stub in the connector file if you attempt that sprint task without completing the R&D item first.

For each item:
1. Complete the research action listed
2. Fill in the `FINDING:` field below it
3. Only then feed that sprint task to Codex

---

## AMAZON

### RD-AMAZON-1 — Developer Application + Sandbox Credentials
**Blocks:** P5-S3 (OAuth, live validation)
**Lead time:** 3–7 days (Amazon review)

**Action required:**
- Go to developer.amazon.in → Register as developer → Create Public Developer Application
- Select Selling Partner API
- Fill: company details, data handling policy URL (you must have a privacy policy page live)
- Submit for review

**What you get back:**
- `AMAZON_CLIENT_ID`
- `AMAZON_CLIENT_SECRET`
- Sandbox seller credentials (Seller ID + MWS Auth Token for sandbox)

**Finding (fill in when received):**
```
AMAZON_CLIENT_ID=
AMAZON_CLIENT_SECRET=
AMAZON_SANDBOX_SELLER_ID=
AMAZON_SANDBOX_MARKETPLACE_ID=A21TJRUUN4KGV
```

---

### RD-AMAZON-2 — SP-API Listings Items Payload Structure
**Blocks:** P5-S4 (publishProduct)
**Lead time:** 1–2 days research (no approval needed — docs are public)

**Action required:**
Research the SP-API `PUT /listings/2021-08-01/items/{sellerId}/{sku}` payload format for Indian apparel:

1. Go to: https://developer-docs.amazon.com/sp-api/docs/listings-items-api-v2021-08-01-reference
2. Download a product type definition for `SHIRT` or `KURTA` for marketplace `A21TJRUUN4KGV`:
   ```
   GET /definitions/productTypes/2022-04-01/productTypes/SHIRT?marketplaceIds=A21TJRUUN4KGV
   ```
3. Identify: required attributes, attribute value formats (especially `color`, `size`, `fabric`, `pattern`)
4. Understand the `summaries[].status` field values and how they map to PENDING/SUCCESS/REJECTED

**Finding (fill in after research):**
```
Required attributes for SHIRT/A21TJRUUN4KGV:
- brand (string)
- item_name (string, max 200 chars)
- main_product_image_locator (object with media_location = HTTPS URL)
- color (list of objects: {value, language_tag})
- size (list of objects: {value, language_tag})
- material_composition
- country_of_origin

Async status polling:
- 202 on PUT = accepted (not complete)
- LISTINGS_ITEM_STATUS_CHANGE webhook carries final status
- Issues arrive via LISTINGS_ITEM_ISSUES_CHANGE

Attribute format example:
{
  "productType": "SHIRT",
  "requirements": "LISTING",
  "attributes": {
    "brand": [{"value": "TestBrand", "language_tag": "en_IN"}],
    "item_name": [{"value": "...", "language_tag": "en_IN"}],
    "color": [{"value": "Blue", "language_tag": "en_IN"}]
  }
}
```
*(replace with real findings)*

---

### RD-AMAZON-3 — Webhook Notification Subscription + Payload Schema
**Blocks:** P5-S5 (webhook receiver, parseWebhookEvent)
**Lead time:** 1–2 days research

**Action required:**
1. Read SP-API Notifications API docs: https://developer-docs.amazon.com/sp-api/docs/notifications-api-v1-reference
2. Understand how to create a destination (your webhook URL) and subscription
3. Document the exact payload shape of `LISTINGS_ITEM_ISSUES_CHANGE` and `LISTINGS_ITEM_STATUS_CHANGE` notifications
4. Document the HMAC-SHA256 signature header name and verification method

**Finding (fill in after research):**
```
Destination registration:
  POST /notifications/v1/destinations
  Body: { "resourceSpecification": { "sqs": { "arn": "..." } } }
  OR for HTTPS: { "resourceSpecification": { "eventBridge": {...} } }
  NOTE: Amazon uses SQS/EventBridge, not direct HTTPS POST. Confirm delivery method.

Signature header: x-amzn-signature (HMAC-SHA256 of raw body using client secret)

LISTINGS_ITEM_ISSUES_CHANGE payload shape:
{
  "notificationVersion": "1.0",
  "notificationType": "LISTINGS_ITEM_ISSUES_CHANGE",
  "payloadVersion": "1.0",
  "eventTime": "2026-03-01T00:00:00Z",
  "payload": {
    "issues": [
      {
        "code": "...",
        "message": "...",
        "severity": "ERROR",
        "attributeNames": ["color"]
      }
    ],
    "sku": "...",
    "marketplaceId": "A21TJRUUN4KGV"
  }
}
```
*(replace with real payload from sandbox test)*

**Critical research question:** Does Amazon deliver webhooks via direct HTTPS POST, SQS, or EventBridge? The architecture assumes direct HTTPS POST — if it uses SQS, the webhook-receiver endpoint design changes significantly.

---

### RD-AMAZON-4 — Webhook Public URL for Development
**Blocks:** P5-S5 (webhook testing in dev)
**Lead time:** 30 minutes

**Action required:**
- Install ngrok: `npm install -g ngrok`
- Run: `ngrok http 4000` (or your local port)
- Register the HTTPS ngrok URL as the Amazon notification destination
- Document the ngrok URL rotation procedure (ngrok free tier rotates URL on restart)

**Finding:**
```
Dev webhook URL: https://XXXX.ngrok.io/api/webhooks/amazon-in
Note: free ngrok rotates URL on restart — update Amazon destination on each dev session
Alternative: use staging URL for P5-S5 testing
```

---

## FLIPKART

### RD-FLIPKART-1 — Partner Portal Registration + Credentials
**Blocks:** P5-S3 (Flipkart OAuth)
**Lead time:** 3–10 days

**Action required:**
- Go to seller.flipkart.com/partner (NOT the seller dashboard — the developer partner portal)
- Apply as a technology partner
- Fill: company details, use case (listing management tool), data handling policy

**What you get back:**
- `FLIPKART_CLIENT_ID`
- `FLIPKART_CLIENT_SECRET`
- Sandbox/staging credentials

**Finding (fill in when received):**
```
FLIPKART_CLIENT_ID=
FLIPKART_CLIENT_SECRET=
FLIPKART_API_BASE_URL=https://api.flipkart.com (or sandbox equivalent)
FLIPKART_REFRESH_TOKEN_EXPIRY_DAYS=30
```

---

### RD-FLIPKART-2 — Listings API v3 Payload + Category Attribute Schema
**Blocks:** P5-S4 (Flipkart publishProduct)
**Lead time:** 2–3 days research

**Action required:**
1. Read Flipkart Partner API docs (requires Partner Portal login)
2. Understand `POST /sellers/listings/v3` payload format
3. Understand how to fetch category-specific required attributes
4. Document which categories return sync vs async responses
5. Map Flipkart error codes to human-readable messages (minimum 20 most common)

**Finding (fill in after research):**
```
Listing payload structure:
{
  "listings": [
    {
      "sku": "...",
      "productId": "...",  // Flipkart product ID from category lookup
      "mrp": 999,
      "sellingPrice": 799,
      "listingStatus": "ACTIVE",
      "attributes": {
        // category-specific — must fetch schema first
      }
    }
  ]
}

Category attribute schema endpoint:
GET /sellers/categories/{categoryId}/attributes

Sync vs async:
- Fashion categories: async (result via polling)
- Electronics: sync (result in response body)

Common error codes:
- INVALID_SKU: SKU already exists for another product
- PRICE_BELOW_COST: ...
(add full list)
```

---

### RD-FLIPKART-3 — Flipkart Error Code Catalogue
**Blocks:** P5-S3 (normaliseError implementation)
**Lead time:** 1 day research

**Action required:**
- From Flipkart Partner docs, extract all error codes returned by the listings API
- Map each to a seller-readable message in Indian English
- Focus on the 20 most common rejection reasons

**Finding (fill in):**
```typescript
// Paste into flipkart.connector.ts normaliseError()
const ERROR_MAP: Record<string, string> = {
  'INVALID_SKU': 'This SKU already exists for a different product. Use a unique SKU.',
  'IMAGE_QUALITY_LOW': 'Your product image does not meet minimum quality requirements (min 500x500px, white background).',
  'PRICE_BELOW_FLOOR': 'Your selling price is below Flipkart\'s minimum allowed price for this category.',
  // ... add all codes
};
```

---

## MEESHO

### RD-MEESHO-1 — API Credentials via Email
**Blocks:** P5-S3 (Meesho validateCredentials)
**Lead time:** 1–2 weeks (manual process)

**Action required — DO THIS TODAY:**
Send email to: `meesholink-integration@meesho.com`

**Subject:** Request for Meesho Supplier API Credentials

**Body:**
```
Dear Meesho Integration Team,

We are building PIM1, a product information management system for Indian
sellers. We require API credentials to integrate with the Meesho Supplier
platform to enable automated product catalog export for our seller clients.

Company: [Your company name]
GSTIN: [Your GSTIN]
Meesho Supplier Panel ID: [Your Supplier Panel ID]
Use case: Product catalog management and Excel template generation for
multi-category listing on Meesho.

Please provide:
1. Merchant ID
2. Secret Key / API Key
3. Sandbox/staging endpoint URL
4. API documentation link

Thank you.
```

**What you get back:**
- `MEESHO_MERCHANT_ID`
- `MEESHO_SECRET_KEY`
- `MEESHO_API_BASE_URL` (sandbox and production are different)
- API documentation PDF

**Finding (fill in when received):**
```
MEESHO_MERCHANT_ID=
MEESHO_SECRET_KEY=
MEESHO_SANDBOX_URL=
MEESHO_PRODUCTION_URL=
MEESHO_API_DOCS_URL=
```

---

### RD-MEESHO-2 — Supplier Excel Template per Category
**Blocks:** P5-S4 (generateExportFile)
**Lead time:** 1 day (download and analyse)
**This is the most critical Meesho R&D item**

**Action required:**
1. Log into Meesho Supplier Panel (supplier.meesho.com)
2. Go to: Catalog → Upload Catalog → Download Template
3. Download templates for EACH category you will support (start with: Kurtis, T-Shirts, Sarees, Casual Shoes)
4. For each template document:
   - Exact column names (row 1)
   - Which columns are mandatory (usually marked in red)
   - Allowed values for dropdown columns (color codes, size codes, fabric names)
   - Maximum character limits per column
   - Image URL requirements (square, min resolution, file size)
   - Template version number (bottom of sheet or in filename)

**Finding (fill in per category):**
```
KURTIS template (version downloaded: 2026-03-XX):
Column A: Product Name (mandatory, max 70 chars)
Column B: MRP (mandatory, number)
Column C: Selling Price (mandatory, number ≤ MRP)
Column D: SKU ID (mandatory, unique per seller)
Column E: Brand (mandatory)
Column F: Color (mandatory, must match allowed values: Red, Blue, Green, ...)
Column G: Size (mandatory, must match: XS, S, M, L, XL, XXL)
Column H: Fabric (mandatory, must match: Cotton, Polyester, Silk, ...)
Column I: Main Image URL (mandatory, HTTPS, 1:1 ratio, min 800x800px)
Column J: Image 2 URL (optional)
...

T-SHIRTS template (version downloaded: 2026-03-XX):
...

IMPORTANT FINDING: Meesho updates templates when they change category requirements.
The meesho-excel.generator.ts must have a TEMPLATE_VERSIONS map and warn when
the template may be outdated (check against a known version date).
```

---

### RD-MEESHO-3 — Error Code Catalogue
**Blocks:** P5-S3 (normaliseError for Meesho)
**Lead time:** 1 day

**Note:** Meesho does not return API errors in real-time. Errors surface in the Supplier Panel
after Excel upload processing (24–48 hours). This makes normaliseError() for Meesho different
from Amazon/Flipkart — it maps upload feedback codes that sellers paste in from the Supplier Panel.

**Action required:**
1. Upload test Excel files with intentional errors to Meesho Supplier Panel
2. Document the error messages that come back in the upload feedback
3. Map each to a seller-readable action item

**Finding (fill in):**
```typescript
// Meesho upload feedback error codes (from Supplier Panel feedback report)
const MEESHO_ERROR_MAP: Record<string, string> = {
  'INVALID_PRODUCT_NAME': 'Product name exceeds 70 characters or contains special characters.',
  'IMAGE_NOT_ACCESSIBLE': 'Image URL could not be accessed. Ensure it is a public HTTPS URL.',
  'INVALID_COLOR': 'Color value not in Meesho allowed list. Check the template dropdown values.',
  'DUPLICATE_SKU': 'This SKU already exists in your Meesho catalog.',
  // add from real upload feedback
};
```

---

## ONDC (Phase 7 — R&D required before sprint planning)

### RD-ONDC-1 — Architecture Session
**Blocks:** Phase 7 sprint planning entirely
**Deadline:** Before Phase 6 ends
**Lead time:** Schedule 2–4 weeks ahead

**Action required:**
1. Find an ONDC-registered seller-app developer (check: https://ondc.org/network-participants/)
2. Schedule a 2-hour architecture session
3. Agenda: (a) confirm integration model — channel adapter vs network participant, (b) payload signing (ED25519), (c) registry lookup flow, (d) realistic effort estimate for Beckn BPP implementation
4. Output: ADR-007 with chosen model + effort estimate

**Decision gate:** If effort > 6 weeks → Phase 7 becomes Shopify + WooCommerce + Hindi UI. ONDC moves to Phase 8.

**Key unknowns to resolve in session:**
- Does PIM1 register as a Seller App (BAP) or a Provider Platform (BPP)?
- What is the staging/sandbox environment for ONDC testing?
- Is ED25519 key pair generation and request signing straightforward with Node.js?
- What is the catalog sync model — push or pull?

**Finding (fill in after session):**
```
Integration model chosen: BAP | BPP (circle one)
Realistic effort estimate: X weeks
Decision: ONDC in Phase 7 | ONDC moves to Phase 8
ADR-007 location: docs/decisions/ADR-007-ondc-integration.md
```

---

## SUMMARY TABLE — R&D STATUS TRACKER

| ID | Connector | What | Blocks | Lead Time | Status |
|----|-----------|------|--------|-----------|--------|
| RD-AMAZON-1 | Amazon | Developer App + sandbox creds | P5-S3 | 3–7 days | ⬜ NOT STARTED |
| RD-AMAZON-2 | Amazon | SP-API payload structure | P5-S4 | 1–2 days | ⬜ NOT STARTED |
| RD-AMAZON-3 | Amazon | Webhook payload schema | P5-S5 | 1–2 days | ⬜ NOT STARTED |
| RD-AMAZON-4 | Amazon | Public webhook URL (ngrok) | P5-S5 | 30 min | ⬜ NOT STARTED |
| RD-FLIPKART-1 | Flipkart | Partner Portal + creds | P5-S3 | 3–10 days | ⬜ NOT STARTED |
| RD-FLIPKART-2 | Flipkart | Listings API v3 payload | P5-S4 | 2–3 days | ⬜ NOT STARTED |
| RD-FLIPKART-3 | Flipkart | Error code catalogue | P5-S3 | 1 day | ⬜ NOT STARTED |
| RD-MEESHO-1 | Meesho | API credentials (email) | P5-S3 | 1–2 weeks | ⬜ **SEND EMAIL TODAY** |
| RD-MEESHO-2 | Meesho | Excel template per category | P5-S4 | 1 day | ⬜ NOT STARTED |
| RD-MEESHO-3 | Meesho | Error code catalogue | P5-S3 | 1 day | ⬜ NOT STARTED |
| RD-ONDC-1 | ONDC | Architecture session + ADR-007 | Phase 7 | 2–4 weeks | ⬜ NOT STARTED |

**Update status to: ⬜ NOT STARTED → 🔄 IN PROGRESS → ✅ COMPLETE → ❌ BLOCKED**

---

## WHAT CODEX CAN DO WITHOUT R&D

These tasks have no external blockers and can start immediately:

| Sprint | Tasks |
|--------|-------|
| FOUNDATION | All 7 tasks (F-01 to F-07) — pure code, no external APIs |
| P5-S1 | All 9 tasks — R2/S3 SDK is public, no approval needed |
| P5-S2 | All 8 tasks — stubs only, no live API calls |
| P5-S3 | S3-01 (EncryptionService), S3-06 (getAccessToken), S3-08 (feature flag) |
| P5-S4 | S4-05 (publish worker), S4-06 (Meesho UI), S4-07 (structured logs) |
| P5-S5 | S5-01 (webhook controller — structure only), S5-04 (processor worker — structure only) |

---

## CRITICAL PATH (minimum to first revenue)

```
TODAY:        Send Meesho email (RD-MEESHO-1)
              Register Amazon Developer App (RD-AMAZON-1)
              Register Flipkart Partner Portal (RD-FLIPKART-1)

Week 1–2:     Run Foundation sprint (no external blockers)
Week 3–4:     Run P5-S1 — Cloud media (no external blockers)
Week 5–6:     Run P5-S2 — Connector framework stubs (no external blockers)
Week 6:       Meesho credentials arrive → complete RD-MEESHO-2 (download Excel template)
Week 7–8:     Amazon Developer App approved → complete RD-AMAZON-2
Week 7–10:    Run P5-S3 (OAuth + live validation) — all three credentials needed
Week 11–12:   Run P5-S4 (live publish + Meesho Excel)
Week 13–14:   Run P5-S5 (webhooks)

FIRST REVENUE UNLOCK:
  Week 3–4 (P5-S1 complete) → Meesho Excel export → Starter ₹999 plan
  Week 9–10 (P5-S3 complete) → Amazon live validation → Growth plan unlocked
```
