# Shopify Connector — E2E Browser Journey QA Plan

**Role:** QA Lead + End-User Pilot Tester  
**Scope:** All 5 Vexa plan tiers (TRIAL, STARTER, GROWTH, BUSINESS, ENTERPRISE)  
**Goal:** Validate every page, gate, limit, and UX flow a real customer encounters from signup through Shopify product publication  

---

## Plan Tier Reference

| Tier | SKUs | Connectors | Accounts/Conn | Import Rows | Users | API Keys | Webhooks |
|------|------|-----------|---------------|-------------|-------|----------|----------|
| TRIAL | 100 | 1 | 1 | 500 | 2 | 0 | 0 |
| STARTER | 500 | 2 | 1 | 2,000 | 3 | 0 | 0 |
| GROWTH | 10K | 10 | 3 | 10K | 20 | 3 | 3 |
| BUSINESS | 50K | 50 | 10 | 20K | 100 | 20 | 20 |
| ENTERPRISE | 100K | 100 | 20 | 30K | 999 | 50 | 50 |

---

## Import Test Files (in `test-fixtures/shopify-import/`)

| File | Rows | Plan Target | Purpose |
|------|------|-------------|---------|
| `trial-basic-50.csv` | 50 | TRIAL | Happy-path import under limit |
| `trial-over-limit-501.csv` | 501 | TRIAL | Exceeds 500-row limit → expect block |
| `starter-mixed-quality-200.csv` | 200 | STARTER | Mix of valid, warning, and error rows |
| `growth-shopify-ready-500.csv` | 500 | GROWTH | All Shopify-required fields populated |
| `growth-tax-codes-international.csv` | 100 | GROWTH | Flat-column international tax codes (GB, AE, US, AU) |
| `business-large-5000.csv` | 5,000 | BUSINESS | Stress test for large import |
| `enterprise-edge-cases.csv` | 40 | ENTERPRISE | Edge cases: Unicode, long descriptions, special chars, XSS, RTL |
| `missing-required-fields.csv` | 20 | ANY | Missing title/description/image → expect validation errors |
| `duplicate-skus.csv` | 10 | ANY | Duplicate SKU codes → expect preflight block |

---

## JOURNEY 1: TRIAL PLAN — First-Time Pilot Customer

**Persona:** Small DTC brand owner, first PIM, 30 products, one Shopify store.

### Page 1: `/signup`
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| 1.1 | Navigate to `/signup` | Sign-up form renders: name, email, password, company | |
| 1.2 | Submit with valid data | Account created, redirect to `/signup/verify` | |
| 1.3 | Verify email | Verification page shows success, redirect to `/login` | |

### Page 2: `/login`
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| 2.1 | Enter credentials, submit | Authenticated, redirect to `/dashboard` | |
| 2.2 | Check billing status banner | "Trial — 90 days remaining" or similar banner visible | |

### Page 3: `/dashboard`
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| 3.1 | Dashboard loads | Workspace hub with onboarding cards visible | |
| 3.2 | Sidebar visible | All sections: Workspace, Catalog, Connections, Quality, Operate, Settings | |
| 3.3 | Plan badge | "TRIAL" badge visible in header or sidebar | |

### Page 4: `/operations/imports` — Bulk Import (Happy Path)
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| 4.1 | Navigate Operate → Imports | Import page loads, "New Import" button visible | |
| 4.2 | Upload `trial-basic-50.csv` | File accepted (CSV, <8MB), preview shows 50 rows | |
| 4.3 | Column mapping screen | Auto-maps: title→title, description→description, brand→brand | |
| 4.4 | Preflight validation | No blocking errors, green "Ready to import" | |
| 4.5 | Run import | Job starts, progress indicator, all 50 rows succeed | |
| 4.6 | Navigate to `/catalog/products` | 50 products listed, status = "draft" | |

### Page 5: `/operations/imports` — Over-Limit Import (Error Path)
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| 5.1 | Upload `trial-over-limit-501.csv` | Import blocked: "Your TRIAL plan allows 500 rows per job" | |
| 5.2 | Verify no partial import | Product count unchanged (still 50) | |
| 5.3 | Upgrade CTA | "Upgrade to Starter" link/button visible | |

### Page 6: `/channels/connectors/setup?slug=shopify` — Shopify Setup
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| 6.1 | Navigate Connections → Connectors | Connector portfolio page, "Setup new connection" button | |
| 6.2 | Click setup, filter to Shopify | Shopify card with capabilities: Publish, Validate, Status Sync, Webhook | |
| 6.3 | Enter Account Alias: "primary" | Text input accepts value | |
| 6.4 | Enter Store Domain: `demo-store.myshopify.com` | Domain validated (must end with `.myshopify.com`) | |
| 6.5 | Enter invalid domain: `not-a-shop.com` | Validation error: domain must be `*.myshopify.com` | |
| 6.6 | Enter SHPAT token: `shpat_xxxxxxxxxxxxxxxxxxxx` | Token field accepts input (masked) | |
| 6.7 | Click "Create Shopify connector" | Installation created, redirect with `?status=installed` | |
| 6.8 | Success toast/banner | "Connector installed successfully" message | |

### Page 7: `/channels/connectors/[id]` — Connector Detail (Overview Tab)
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| 7.1 | Navigate to connector detail | 10-tab layout: Overview, Credentials, Catalog, Mappings, Sync, Schedule, Catalog Link, Issues, Logs, Access | |
| 7.2 | Overview tab | Account alias "primary", store domain, connection status | |
| 7.3 | KPI cards | Show 0 published, 0 synced, 0 errors | |

### Page 8: `/channels/connectors/[id]?tab=catalog-link` — Catalog Link
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| 8.1 | Switch to Catalog Link tab | Product catalog selection UI | |
| 8.2 | Link PIM catalog to Shopify | "Confirm Links" button, dirty navigation guard warns on exit | |

### Page 9: `/channels/connectors/[id]?tab=mappings` — Field Mappings
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| 9.1 | Switch to Mappings tab | Field mapping UI: PIM field → Shopify field | |
| 9.2 | Verify defaults | title→title, description→body_html, mainImageUrl→images, sku→sku | |
| 9.3 | Verify required field indicators | SKU, title, description, mainImageUrl marked as required | |

### Page 10: `/quality/issues` — Pre-Publish Validation
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| 10.1 | Navigate Quality → Issue Inbox | Issues list, sorted by severity (errors first) | |
| 10.2 | Check for Shopify validation warnings | BRAND_RECOMMENDED, PRODUCT_TYPE_RECOMMENDED, SELLING_PRICE_ZERO_OR_MISSING | |
| 10.3 | Click issue → navigate to product | Deep link to product detail page works | |

### Page 11: `/products/[id]` — Fix Product for Shopify
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| 11.1 | Open a product missing required fields | Product detail page loads with validation errors | |
| 11.2 | Add mainImageUrl (HTTPS) | Image preview appears | |
| 11.3 | Set selling price > 0 | Price field validates positive number | |
| 11.4 | Add brand, product type | Fields save without error | |
| 11.5 | Save | Dirty navigation guard clears, toast "Saved" | |
| 11.6 | Validation re-runs | Warnings/errors clear for this product | |

### Page 12: Submit to Shopify (Publish)
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| 12.1 | Go to connector detail → Sync tab | Publish/sync controls visible | |
| 12.2 | Select products to publish | Checkbox selection, bulk action "Publish to Shopify" | |
| 12.3 | Submit | Submission job created, redirect or toast | |

### Page 13: `/channels/submissions` — Submission Status
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| 13.1 | Navigate Connections → Submission Log | Submissions grid loads | |
| 13.2 | Find submission | Status shows: pending → processing → completed/failed | |
| 13.3 | Click submission detail | `/channels/submissions/[id]` — per-product status breakdown | |

### Page 14: Connector Limit Gate (TRIAL = 1 connector)
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| 14.1 | Try to install a second connector | Blocked: "TRIAL plan allows 1 connector installation" | |
| 14.2 | Upgrade CTA | "Upgrade to Starter for 2 connectors" | |

### Page 15: `/settings/plan` — Plan & Usage
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| 15.1 | Navigate Settings → Plan & Usage | Current plan "TRIAL", usage meters visible | |
| 15.2 | SKU meter | Shows 50/100 used | |
| 15.3 | Connector meter | Shows 1/1 used | |
| 15.4 | Import rows | Shows job history | |
| 15.5 | Trial countdown | "X days remaining" with expiration date | |

### Page 16: `/settings/pricing` — Upgrade Flow
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| 16.1 | Navigate Settings → Pricing | Plan comparison card with all 5 tiers | |
| 16.2 | Feature matrix | Each plan shows SKU limit, connector limit, import limit | |
| 16.3 | Click "Upgrade to Starter" | Stripe checkout or upgrade modal | |

---

## JOURNEY 2: STARTER PLAN — Growing Small Business

**Persona:** Shopify store + exploring Amazon/Flipkart. 200 products, needs quality checks.

### Import with Mixed Quality (`starter-mixed-quality-200.csv`)
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| S-1 | Upload `starter-mixed-quality-200.csv` (200 rows) | Accepted (under 2,000 limit) | |
| S-2 | Mapping screen | Auto-maps canonical fields + recognises aliases (`product_name`→title) | |
| S-3 | Preflight validation | Warns: 20 rows missing `mainImageUrl`, 15 missing `description` | |
| S-4 | Run import | 200 rows process, ~165 success, ~35 with warnings | |
| S-5 | Quality inbox | 35+ issues for incomplete products | |

### Second Connector Install
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| S-6 | Install Shopify connector #1 | Success | |
| S-7 | Install Shopify connector #2 | Success (STARTER allows 2) | |
| S-8 | Attempt connector #3 | Blocked: "STARTER plan allows 2 connectors" | |

### RBAC Verification (STARTER: admin, editor, viewer)
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| S-9 | Admin invites editor user | User created with editor role | |
| S-10 | Editor logs in | Can edit products, CANNOT access Settings/Admin | |
| S-11 | Editor tries connector setup | Access denied or hidden nav | |
| S-12 | Admin invites viewer | Viewer can browse, CANNOT edit/create | |
| S-13 | Try assigning "approver" role | Blocked: "Upgrade to Growth for approval workflow" | |

---

## JOURNEY 3: GROWTH PLAN — Multi-Store Brand

**Persona:** 3 Shopify stores (US, UK, AU), needs international tax codes, approval workflow.

### International Tax Code Import (`growth-tax-codes-international.csv`)
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| G-1 | Upload `growth-tax-codes-international.csv` | Accepted (100 rows, under 10K) | |
| G-2 | Mapping recognises tax columns | `gb_commodity_code`, `ae_hs_code`, `us_tax_category`, `au_commodity_code` auto-mapped | |
| G-3 | Import runs | All 100 rows succeed with tax codes persisted | |
| G-4 | View product → International Tax Codes section | GB commodity code, AE HS code, US tax category, AU commodity code visible | |
| G-5 | Shopify validation | No HS_CODE_MISSING warning for products with tax codes | |

### Shopify-Ready Import (`growth-shopify-ready-500.csv`)
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| G-6 | Upload `growth-shopify-ready-500.csv` | Accepted, all required Shopify fields present | |
| G-7 | Preflight: 0 blocking errors | Green "Ready to import" | |
| G-8 | Import completes | 500/500 success | |
| G-9 | Navigate `/quality/issues` | Minimal warnings (maybe PRODUCT_TYPE_RECOMMENDED) | |

### Multi-Account Connectors (GROWTH: 3 accounts/connector)
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| G-10 | Install Shopify connector → account "US Store" | Success | |
| G-11 | Same connector → account "UK Store" | Success (2/3) | |
| G-12 | Same connector → account "AU Store" | Success (3/3) | |
| G-13 | Same connector → account "JP Store" | Blocked: "GROWTH plan allows 3 accounts per connector" | |

### Approval Workflow (GROWTH+ feature)
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| G-14 | Assign "approver" role to team member | Success (GROWTH unlocks 6 roles) | |
| G-15 | Editor submits product for approval | Product moves to "pending_approval" status | |
| G-16 | Navigate `/quality/approvals` | Approval queue shows pending product | |
| G-17 | Approver reviews and approves | Product status → "approved", ready for publish | |
| G-18 | Approver rejects with reason | Product status → "rejected", reason visible in evidence drawer | |

### API Keys (GROWTH: 3 keys)
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| G-19 | Navigate `/admin/api-keys` | API key management page | |
| G-20 | Create API key #1, #2, #3 | All succeed | |
| G-21 | Create API key #4 | Blocked: "GROWTH plan allows 3 API keys" | |

### Publication Targets
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| G-22 | Connector detail → configure publication targets | Available targets listed (Online Store, app catalogs) | |
| G-23 | Select "Online Store" | Target saved in connector metadata | |
| G-24 | Publish product | Product published to selected targets | |
| G-25 | Status sync | Status correctly reflects published state across all targets | |

---

## JOURNEY 4: BUSINESS PLAN — Mid-Market Enterprise

**Persona:** 20K+ SKUs, 10 team members, multi-channel (Shopify + Amazon + Flipkart).

### Large Import (`business-large-5000.csv`)
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| B-1 | Upload `business-large-5000.csv` (5,000 rows) | Accepted (under 20K limit) | |
| B-2 | Progress indicator | Shows row-by-row progress or percentage | |
| B-3 | Import completes | 5,000 rows processed (may take 2-5 minutes) | |
| B-4 | Navigate `/operations/jobs` | Job visible with completion status | |

### Full RBAC (BUSINESS: all 8 roles)
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| B-5 | Assign `channel_manager` role | Success | |
| B-6 | Channel manager logs in | Can manage connectors, mappings, submissions | |
| B-7 | Channel manager CANNOT access admin settings | Admin nav items hidden | |
| B-8 | Assign `connector_admin` role | Success | |
| B-9 | Connector admin manages connector credentials | Can update tokens, cannot manage users | |

### Multi-Connector Portfolio
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| B-10 | Navigate `/channels/connectors` | Portfolio with multiple installed connectors | |
| B-11 | Health dashboard `/channels/health` | All connectors show health status | |
| B-12 | Connector governance `/channels/governance` | Publication rules and governance visible | |

### Webhooks (BUSINESS: 20 webhooks)
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| B-13 | Navigate `/admin/webhooks` | Webhook management page | |
| B-14 | Create outbound webhook | Endpoint URL, events, delivery logs | |
| B-15 | Webhook fires on product publish | Delivery log shows successful POST | |

### Bulk Edit
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| B-16 | Navigate `/operations/bulk-edit` | Bulk edit interface | |
| B-17 | Select 100 products, update brand | All 100 updated, job completes | |
| B-18 | Verify changes in `/catalog/products` | Brand updated across selected products | |

---

## JOURNEY 5: ENTERPRISE PLAN — Global Retailer

**Persona:** 50K+ SKUs, SSO/OIDC, custom SLA, white-glove migration.

### Edge Case Import (`enterprise-edge-cases.csv`)
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| E-1 | Upload `enterprise-edge-cases.csv` | Accepted | |
| E-2 | Unicode characters in titles | Correctly displayed: Japanese, Arabic, emoji | |
| E-3 | Long descriptions (5000+ chars) | No truncation, saved fully | |
| E-4 | Special chars in brand (Levi's, M&M's) | Properly escaped and saved | |
| E-5 | HSN codes with leading zeros | Preserved: "01012100" not "1012100" | |

### SSO/OIDC Configuration (ENTERPRISE only)
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| E-6 | Navigate `/admin/auth-policy` | Auth policy page with OIDC option | |
| E-7 | Click OIDC configuration | `/admin/auth-policy/oidc` — provider setup form | |
| E-8 | Configure OIDC provider | Client ID, issuer, callback URL fields | |

### Audit Logs (All plans but critical for Enterprise)
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| E-9 | Navigate `/admin/audit` | Audit log viewer | |
| E-10 | Filter by "connector" events | Shows install, publish, credential updates | |
| E-11 | Filter by user | Shows actions by specific team member | |

### Max-Scale Connector Test
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| E-12 | Install 20+ Shopify accounts on one connector | All succeed (ENTERPRISE: 20 accounts/connector) | |
| E-13 | 100 connector installations | All allowed | |
| E-14 | Attempt #101 | Blocked: "ENTERPRISE plan allows 100 connectors" | |

---

## JOURNEY 6: CROSS-PLAN — Error & Edge Case Scenarios

### Missing Required Fields (`missing-required-fields.csv`)
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| X-1 | Upload `missing-required-fields.csv` | Accepted by import | |
| X-2 | Import runs | Rows create products in draft status | |
| X-3 | Navigate to quality inbox | Errors: REQUIRED_FIELD_MISSING for title, description, mainImageUrl | |
| X-4 | Attempt Shopify publish | Blocked per-product: "Add a stable SKU before syncing" | |
| X-5 | Fix products and re-validate | Errors clear as fields are populated | |

### Duplicate SKUs (`duplicate-skus.csv`)
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| X-6 | Upload `duplicate-skus.csv` | Accepted | |
| X-7 | Preflight validation | Blocking error: "Duplicate SKU codes found in rows X, Y" | |
| X-8 | Cannot proceed with import | Import button disabled | |

### Image URL Validation
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| X-9 | Product with `http://` image URL | Error: IMAGE_URL_NOT_HTTPS | |
| X-10 | Product with `https://` image URL | Valid, no error | |
| X-11 | Product with empty image URL | Error: REQUIRED_FIELD_MISSING (mainImageUrl) | |

### Billing Status Transitions
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| X-12 | Trial expires (90 days) | Status → "expired", access hard-blocked | |
| X-13 | Navigate to any page | Redirect to `/account-suspended` or billing banner | |
| X-14 | Payment fails on paid plan | Status → "past_due", 7-day grace period starts | |
| X-15 | Grace period banner | "Payment failed. Update payment method within X days" | |
| X-16 | Grace period expires | Status → suspended, access blocked | |

### Shopify-Specific Validation Warnings
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| X-17 | Product with sellingPrice = 0 | Warning: SELLING_PRICE_ZERO_OR_MISSING | |
| X-18 | Product with whitespace-only description | Warning: DESCRIPTION_WHITESPACE_ONLY | |
| X-19 | Product without brand | Warning: BRAND_RECOMMENDED | |
| X-20 | Product without productType | Warning: PRODUCT_TYPE_RECOMMENDED | |
| X-21 | Product without HS/commodity code | Warning: HS_CODE_MISSING | |

### Recovery Flow
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| X-22 | Navigate `/channels/connectors/[id]/recovery` | Recovery page loads | |
| X-23 | Failed submission → retry | Recovery retry button triggers re-publish | |
| X-24 | Navigate `/operations/repair` | Repair center shows fixable issues | |

---

## JOURNEY 7: UX & ACCESSIBILITY CHECKS (All Plans)

### Navigation & Responsiveness
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| U-1 | Sidebar collapse (mobile) | Hamburger menu, drawer nav works | |
| U-2 | Breadcrumb navigation | Every page shows breadcrumbs, clickable | |
| U-3 | Skip-to-main-content link | Tab focus reveals skip link (a11y) | |
| U-4 | Page loading states | Skeleton/spinner on every data-fetching page | |
| U-5 | Error boundary | Broken page shows error.tsx, not white screen | |
| U-6 | 404 page | Invalid route shows not-found.tsx | |

### Dirty Navigation Guards
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| U-7 | Edit product, navigate away without saving | "Unsaved changes" confirmation dialog | |
| U-8 | Edit connector mappings, navigate away | Mapping dirty navigation guard fires | |
| U-9 | Confirm leave | Changes discarded, navigates | |
| U-10 | Cancel leave | Stays on page, changes preserved | |

### Toast Notifications
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| U-11 | Successful save | Green toast: "Saved" | |
| U-12 | Validation error | Red toast or inline error with specific message | |
| U-13 | Connector installed | Success toast with connector name | |
| U-14 | Import completed | Toast or notification with row count summary | |

### Search & Filtering
| # | Step | Expected | Pass? |
|---|------|----------|-------|
| U-15 | Global search (header) | `/search` results page, fuzzy match | |
| U-16 | Product list filtering | Filter by status, brand, category | |
| U-17 | Connector setup search | `?q=shopify` filters connector cards | |
| U-18 | Submission log filtering | Filter by connector, status, date range | |

---

## Regression Checklist

After completing all journeys, verify no regressions in:

- [ ] Login/signup flow works for new users
- [ ] Dashboard loads without JS errors
- [ ] Sidebar badges update in real-time (quality issues count, operations count)
- [ ] Plan upgrade flow completes without errors
- [ ] All 5 existing Shopify E2E specs still pass:
  - `shopify-connector-managed-install.spec.js`
  - `shopify-publish-journey.spec.js`
  - `shopify-account-mismatch.spec.js`
  - `shopify-field-mapping.spec.js`
  - `shopify-publication-targets.spec.js`
- [ ] No hydration errors in browser console
- [ ] No 500 errors in network tab during any flow
- [ ] Billing status banner appears/disappears correctly per state
- [ ] Role-based nav items hide/show correctly per role and plan

---

## Test Environment Checklist

Before starting:
- [ ] Test tenant with each plan tier provisioned
- [ ] Shopify dev store with Admin API access token
- [ ] SHPAT token for test store: `shpat_xxxxxxxxxxxxxxxxxxxx`
- [ ] Test store domain: `your-test-store.myshopify.com`
- [ ] All import CSV files from `test-fixtures/shopify-import/` ready
- [ ] Clean browser (incognito) for each journey
- [ ] Network tab open to monitor API calls
- [ ] Console open to catch JS errors
