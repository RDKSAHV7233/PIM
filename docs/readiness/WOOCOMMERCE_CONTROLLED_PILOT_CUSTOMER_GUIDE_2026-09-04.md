# WooCommerce Controlled-Pilot Onboarding Guide

Last reviewed: 2026-09-04

Status: DRAFT ON HOLD — not approved for customer onboarding or public distribution

Owner: Product / PO / Connector Engineering / QA / CTO / Support

Reviewed by: Connector Engineering/QA, Product/Claims Governance, Security
(2026-09-04) — see review notes at the end of this document. Superseded for
onboarding by the P1 blocker-closure hold until re-signed.

Audience: Vexa operator and first-tenant pilot customer (ENTERPRISE tier,
operator-supervised onboarding)

Governing claim authority:
`docs/readiness/CONNECTOR_CLAIM_AUDIT_2026-09-03.md`

**WooCommerce is on P1 blocker-closure hold, not GA and not customer-ready.**
This guide is a draft operator/customer playbook for after the hold is lifted.
Do not use it to onboard a tenant until P1-2 auth revocation disposition,
P1-1 Woo app-auth credential write/read verification, CI, staging runtime proof,
and fresh CTO/PO/Security/QA/SRE signoff are complete.

Shopify's own verdict in
the governing audit is "Conditional — live only for the bounded
direct-token, single-variant pilot scope," not an unqualified GA claim
either. WooCommerce sits behind that: publish/validate/status-sync are
verified only at the single-product level under operator supervision, and
several capabilities Shopify has real evidence for (bulk batch behavior,
credential-update live evidence) remain code-only or single-instance for
WooCommerce. Do not present this connector to a pilot customer as
production-ready or as equivalent in verified scope to Shopify.

---

## 1. Prerequisites

Before starting, confirm the P1 hold has been lifted and then confirm:

- [ ] Vexa PIM workspace provisioned (ENTERPRISE plan, active paid)
- [ ] User account with **admin** or **connector_admin** role
- [ ] A WooCommerce store (WordPress + WooCommerce plugin) with admin access
- [ ] Store URL reachable over **HTTPS** (Vexa rejects non-HTTPS site URLs)
- [ ] Products in Vexa PIM catalog with status **Approved** and channel
      readiness passing for WooCommerce
- [ ] Operator present for the first publish — this is a supervised pilot,
      not self-service onboarding
- [ ] P1-2 auth revocation disposition signed by Security/SRE/CTO
- [ ] P1-1 Woo app-auth credential write/read fix reviewed, CI-green, staged,
      and runtime-verified

---

## 2. Generate WooCommerce REST API Credentials

Vexa connects to WooCommerce using REST API v3 with a Consumer Key/Secret
pair (HTTP Basic Auth). There is no OAuth flow in this guide's scope.

### Step-by-step

1. Log in to your **WordPress Admin** for the store.
2. Go to **WooCommerce → Settings → Advanced → REST API**.
3. Click **Add key**.
4. Description: `Vexa PIM Connector`.
5. User: select an administrator account.
6. Permissions: **Read/Write** (required — Vexa creates and updates
   products).
7. Click **Generate API key**.
8. Copy the **Consumer key** (`ck_...`) and **Consumer secret** (`cs_...`).
   The secret is shown only once — store it securely.
9. Note your store's full HTTPS URL (e.g. `https://store.example.com`).

**Security note:** These keys grant read/write access to your WooCommerce
product catalog. Vexa applies encryption-at-rest and credential-redaction
controls as part of its security architecture: the secret is never displayed
in the Vexa UI after initial entry. Do not share these keys over email or
chat — enter them only into the Vexa install form (Section 3).

---

## 3. Install the WooCommerce Connector in Vexa

1. Log in to **Vexa PIM** (`app.vexapim.com`) with your admin account.
2. In the sidebar, go to **Connections → Connections**.
3. Find **WooCommerce** in the connector list and click **Install**.
4. Fill in the install form:
   - **Account alias** (optional): a friendly name like `My Main Store`
   - **Site URL** (required): your store's full HTTPS URL, e.g.
     `https://store.example.com`
   - **Consumer Key** (required): the `ck_...` value from step 2.8
   - **Consumer Secret** (required): the `cs_...` value from step 2.8
5. Click **Install**. Vexa checks that all three required fields are
   present and that the Site URL uses HTTPS before saving. This is a
   **format check, not a live check against your store** — Vexa does not
   call your WooCommerce store during install to confirm the keys actually
   work. The first real test of the credentials is your first publish
   (Section 5) or a manual reconnect (Section 7).
6. On success, the connector status changes to **Connected**.

If installation fails, the error message tells you which check failed:
- **Site URL, Consumer Key, and Consumer Secret together** — one or more
  required fields is missing.
- **Site URL must use HTTPS** — an `http://` URL was entered; switch to
  HTTPS.
- Contact the Vexa operator if the issue persists.

If installation succeeds but your keys are actually wrong (typo, wrong
permission level, revoked key), you won't find out until your first publish
attempt or reconnect — at that point you may see **"Credentials could not
be validated"** (Section 7 covers this). Double-check the Site URL,
Consumer Key, and Consumer Secret in **WooCommerce → Settings → Advanced
→ REST API** if that happens.

Note: a **Webhook Secret** field exists in Vexa's credentials-edit screen,
but is not part of the install form and is not required for publish to
work. See Section 8 — webhook receive is not customer-verified in this
pilot; do not rely on it.

---

## 4. Prepare Products for Publishing

Products must meet these conditions before they can be published to
WooCommerce:

1. **Status: Approved** — products must pass through the review/approval
   workflow. Draft or In Review products cannot be published.
2. **Channel readiness: Passing** — the product's Channel Readiness column
   in the catalog shows whether all required fields for WooCommerce are
   mapped.
3. **Field mapping configured** — go to **Mappings** in the sidebar to
   review how Vexa fields map to WooCommerce product fields. The default
   mapping covers:
   - Title → WooCommerce product name
   - Description → WooCommerce description
   - Price → WooCommerce regular/sale price
   - SKU → WooCommerce SKU (this is also the idempotency key, see below —
     do not change a product's WooCommerce SKU after Vexa has published it)
   - Main image → WooCommerce product image
   - HSN code / GST rate (if set on the product) → `_vexa_hsn_code` /
     `_vexa_gst_rate` custom fields (see note below)

### Idempotency and re-publish safety

Before every publish, Vexa looks up WooCommerce's own **native SKU field**
(a `GET /products?sku=...` query) to check whether a product with that SKU
already exists. If it finds one, it updates that product in place instead
of creating a new one. This is how edit/republish avoids duplicate listings
for products Vexa has already published.

**Important:** this lookup is by the WooCommerce SKU field itself — **not**
by any custom meta field. Vexa also writes a `_vexa_pim_product_id` field to
every product for reference, but that field is not read back for matching.
If you (or a plugin) change a product's SKU directly in WooCommerce after
Vexa has published it, Vexa's next publish will no longer recognize it as
the same product and may create a duplicate. Do not edit the SKU of a
Vexa-managed product directly in WooCommerce.

### What exists in code but is NOT customer-verified — use with caution

- **Additional images (up to 8):** the connector can send up to 8
  additional image URLs beyond the main image, but this path has not been
  verified with a real customer catalog. Treat multi-image publish as
  experimental during the pilot — confirm the result in WooCommerce Admin
  after every publish that uses it.
- **Multi-variant (variable) products:** the connector has code to publish
  variable products with variation attributes, but there is no verified
  multi-variant test data behind this path. **Use single-variant (simple)
  products for this pilot.** Do not publish variable products until this
  is explicitly re-verified and the operator confirms it's safe to try.
- **GST/HSN custom fields:** `_vexa_hsn_code` and `_vexa_gst_rate` are
  written when set on the product, and are documented for two third-party
  GST plugins in `docs/connectors/woocommerce-vexa-meta-schema.md`. This
  is code-level reference material, not a verified production tax
  workflow — do not treat GST/HSN sync as automatic or compliance-ready
  without your own reconciliation.

---

## 5. Publish Products

Claim reference: `CLM-WOO-PUBLISH-001`, `CLM-WOO-EDIT-001`,
`CLM-WOO-BULK-001` in `docs/product/claim-register.md`.

**During this pilot, publish products one at a time and confirm each result
in WooCommerce Admin before moving to the next.** WooCommerce publish is
verified at the single-product level; the bulk-publish UI accepts
WooCommerce as a channel, but batch-level behavior is not independently
verified for WooCommerce the way it is for Shopify. Do not rely on
bulk publish for WooCommerce as a production workflow during the pilot.

### Single product publish

1. Open a product from **Products** in the catalog.
2. Confirm it shows **Approved** status and WooCommerce channel readiness
   is passing.
3. Click **Publish** (or the publish action in the product detail view).
4. Select the WooCommerce connector/account.
5. Confirm and submit. The product enters the submission queue.
6. Monitor the result in **Submission Log** — the status should move from
   queued → submitted → accepted (or rejected with an error message).
7. Open the product in WooCommerce Admin and visually confirm the title,
   price, SKU, and image match what you expect.

### Edit and republish

If you need to correct a live WooCommerce listing:

1. Edit the product in Vexa PIM (update title, description, price, etc.).
2. Re-approve if required by your workflow.
3. Publish again. Vexa's idempotency check (Section 4) finds the existing
   WooCommerce product by its **SKU** and updates it in place rather than
   creating a new listing.
4. Verify the change in **Submission Log** (status: accepted) and confirm
   in WooCommerce Admin.
5. If a manual edit was made directly in WooCommerce (bypassing Vexa) and
   changed the product's **SKU field**, the next Vexa publish will no
   longer recognize it as the same product and may create a duplicate
   listing. If you see an unexpected duplicate, stop and contact the
   operator (Section 9) rather than continuing to publish.

---

## 6. Monitor Submissions

The **Submission Log** (sidebar → Submission Log) shows every publish
attempt across all connected channels, including WooCommerce:

| Column | Meaning |
| --- | --- |
| Total Submissions | All publish attempts for this workspace |
| Pending | Currently queued — should be 0 under normal operation |
| Accepted | Successfully published to the channel |
| Rejected/Error | Failed — click through for error details |

If a submission is rejected:
- Open the submission detail to see the WooCommerce API error.
- Common issues: missing required fields, invalid image URL, unreachable
  store, expired/revoked API keys.
- Fix the product data or connector credentials, re-approve, and republish.

**Alert:** If the Pending count is non-zero for more than a few minutes,
contact the Vexa operator. Stuck submissions are a P0 issue.

---

## 7. Reconnect or Update Credentials

Unlike Shopify, WooCommerce **does** support in-product credential
replacement. This flow is code-implemented with local regression-test
coverage; it has not been exercised against a live pilot store under the
same evidence bar as single-product publish (Section 5). Treat the first
credential update on a real pilot tenant as a supervised action — confirm
the result immediately.

1. Go to **Connections** in the sidebar.
2. Find your WooCommerce connector account.
3. Click the account to open the detail view.
4. Use the **Update credentials** action (requires admin or
   connector_admin role; step-up authentication is required for this
   action).
5. Re-enter:
   - **Site URL** (required — must be re-entered even if unchanged)
   - **Consumer Key** (required — stored secrets cannot be redisplayed, so
     you must re-enter the current or new key)
   - **Consumer Secret** (required, same reason)
   - **Webhook Secret** (optional — leave blank to keep the existing value)
6. Vexa validates the required fields against your store before saving.

If your WooCommerce keys are revoked or rotated, generate new ones in
**WooCommerce → Settings → Advanced → REST API** (Section 2) and use this
flow to update them — do not create a second connector installation.

---

## 8. Known Limitations

**Read the "Automatic background reconciliation" row below before your
first publish — it describes a background job that can automatically
rewrite WooCommerce products without you clicking Publish.**

| Area | Limitation |
| --- | --- |
| Overall status | P1 blocker-closure hold — not customer-ready, not GA, not production-ready, not SLA-backed. Historical single-product evidence exists, but onboarding is paused until fresh signoff. |
| Bulk publish | The bulk-publish UI has historical WooCommerce evidence at single-product level only. Do not use WooCommerce bulk publish for a tenant while the P1 hold is open. |
| Variants | Variable-product code exists but has no verified multi-variant test data. Use single-variant (simple) products only. |
| Images | Main image is included in the verified single-product publish path. Additional images (up to 8) exist in code but are not customer-verified — treat as experimental. |
| Webhooks | Webhook-receive code with HMAC signature verification exists, but no live webhook has been accepted end-to-end in this pilot. Do not rely on inbound sync from WooCommerce to Vexa. |
| **Automatic background reconciliation** | **This is automatic, not optional, unless the operator disables it.** A background job checks every connected WooCommerce store on a fixed schedule (roughly every 4 hours) and, if it finds the WooCommerce listing has drifted from what Vexa expects, automatically pushes an update back to WooCommerce — with no publish click from you. If you or anyone on your team edits a Vexa-managed product directly in WooCommerce Admin between Vexa publishes, this job may silently overwrite that edit within a few hours. This behavior itself is not production-verified (no live pilot evidence yet), but it is running by default. Ask the operator whether this job is enabled for your tenant before making any direct WooCommerce-side edits you want to keep. |
| GST/HSN tax fields | Custom fields are written when set, documented for two third-party GST plugins, but this is code-level reference material, not a verified compliance workflow. |

This table is authoritative for WooCommerce specifics while preparing for a
possible future pilot restart. The platform-wide Known Limitations page carries
a single summarized WooCommerce row and is not a superset of this table.

---

## 9. Support and Escalation

During any controlled pilot after the P1 hold is lifted:

- **Primary contact:** Vexa operator (CTO) — provided during onboarding.
- **Response time:** Best-effort during business hours. No formal SLA
  during pilot evaluation.
- **Escalation:** Contact the operator directly. There is no self-serve
  support portal during pilot.

Report any of the following immediately:
- Submissions stuck in Pending state
- Connector showing "Needs Attention" in the action rail
- Credential validation failures after a successful install
- Products appearing duplicated in WooCommerce after republish
- Any attempt to publish a variable (multi-variant) product — this is out
  of verified scope for the pilot; stop and contact the operator first
- A direct WooCommerce-side edit that keeps getting reverted within a few
  hours — this is likely the automatic background reconciliation job
  (Section 8) overwriting it; ask the operator whether it should be
  disabled for your tenant

**Report as a possible security incident (not a sync issue) if you see:**
- Products appearing in WooCommerce that you did not publish from Vexa
- Any connector or account activity you don't recognize

Treat these differently from an ordinary sync bug — flag them to the
operator explicitly as a suspected security incident so they're triaged
with the correct urgency.

---

## 10. Scope Boundary

After the P1 hold is lifted, this guide covers only the bounded WooCommerce
connector scope: operator-supervised, single-product publish/validate/status-
sync, credential install and update, and idempotent re-publish for single-
variant products. It does not cover or imply:

- Production-ready or GA status
- SLA-backed availability
- Verified bulk publish (batch-level) behavior
- Multi-variant / variable product support
- Multi-image support as a verified customer-facing capability
- Automatic webhook-based sync from WooCommerce to Vexa
- Production-verified drift correction — the background reconciliation job
  (Section 8) does run automatically by default, but its behavior is not
  yet verified against a live pilot store; it is a real operational fact
  for the pilot, not a marketable capability
- GST/HSN as a verified compliance workflow
- Public pricing or plan commitments

All claims in this guide are bounded by the connector claim audit at
`docs/readiness/CONNECTOR_CLAIM_AUDIT_2026-09-03.md` and by the P1
blocker-closure hold. No claim in this guide may exceed those authorities
without a fresh evidence update and Product / CTO / Security / QA / SRE
approval.

---

## Review Notes (2026-09-04)

This guide was reviewed by three required-team perspectives before pilot
use, per the readiness pack's Team Review Rule
(`docs/readiness/README.md`), mirroring the process applied to the Shopify
onboarding guide.

- **Connector Engineering / QA** — verified all technical claims against
  source code. Found two factually wrong claims: (1) the idempotency
  lookup was described as matching on a `_vexa_pim_product_id` meta field,
  when the code actually matches on WooCommerce's native SKU field only
  (the meta field is written but never read back for lookup); (2) the
  guide claimed "no automatic push exists," when a background
  reconciliation job actually runs on a ~4-hour schedule by default and
  can automatically push updates to WooCommerce with no user action —
  this is a real operational-safety gap for a pilot customer, not a minor
  wording issue. Also found the install-time validation claim overstated
  (install checks field format/HTTPS only, not live store credentials).
  **Fixed.**
- **Product / Claims Governance** — checked every claim against
  `CONNECTOR_CLAIM_AUDIT_2026-09-03.md`'s WooCommerce-specific verdicts
  (more restrictive than Shopify's). Found an unqualified "(Live)" label
  applied to Shopify in the banner, an overconfident images-row claim, an
  unhedged credential-update claim, and missing claim-register
  traceability (`CLM-WOO-PUBLISH-001` uncited; `CLM-WOO-EDIT-001` and
  `CLM-WOO-BULK-001` did not yet exist in the register). Also flagged
  that `docs/product/known-limitations.md`'s WooCommerce row was stale
  (predated the 2026-09-03 audit) and that the register's
  `CLM-WOO-OAUTH-001` entry was mislabeled (its content was actually
  about Shopify OAuth). **Fixed** — claim register updated with the two
  new IDs and the mislabeled entry renamed to `CLM-SHP-OAUTH-001`;
  `known-limitations.md` WooCommerce row refreshed before the P1
  blocker-closure hold superseded onboarding approval.
- **Security** — verified credential-handling accuracy: encryption
  claims, REST API permission scope (Read/Write is genuinely required, not
  over-broad), step-up enforcement, HTTPS rejection, and escalation
  coverage. Result: **Approve as-is** — no defects found; the guide was
  found to under-claim rather than over-claim throughout.

All required edits from all three reviews have been applied, but the P1
blocker-closure review now supersedes onboarding approval. This guide is not
approved for pilot onboarding use until P1-2 implementation review, P1-1
verification, and fresh required-team signoff are complete.
