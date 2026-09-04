> **Restricted evidence notice, 2026-08-29:** This schema note is technical
> reference only. WooCommerce is code-complete but not GA/public-sellable, and
> WooCommerce production-readiness QA currently failed. Do not use this file as
> customer-facing idempotency or production-publish proof. Use
> `docs/readiness/WOOCOMMERCE_REMEDIATION_EVIDENCE_PACK_2026-08-29.md`.

# WooCommerce — Vexa `_vexa_*` meta_data schema

Vexa PIM writes the following `meta_data` keys to every WooCommerce product and variation it manages. These keys serve as idempotency anchors, sync timestamps, and structured GST/HSN fields that Indian tax plugins can read.

## Key definitions

| Key | Type | Written on | Description |
|-----|------|-----------|-------------|
| `_vexa_pim_product_id` | string | product + variation | Vexa internal SKU. **Idempotency anchor.** Used by `findExistingProductId` to detect re-publishes and perform PUT instead of POST. Never changes for a given SKU. |
| `_vexa_pim_sync_ts` | ISO-8601 string | product + variation | UTC timestamp of the last Vexa sync. Updated on every publishProduct / updateProduct call. |
| `_vexa_hsn_code` | string (digits) | product only | 6–8 digit HSN (Harmonised System of Nomenclature) code. Written when `product.hsnCode` is set. Absent when not provided. |
| `_vexa_gst_rate` | string (number) | product only | GST rate percentage as a string (e.g. `"18"`, `"5"`, `"0"`). Written when `product.gstRate` is set. Absent when not provided. |
| `_vexa_gst_applicable` | `"yes"` | product + variation | Written as `"yes"` whenever `gstRate` is set (including 0% GST-exempt). Absent when `gstRate` is not provided (non-India context). Never set to `"no"` — absence means unknown. |

## GST plugin configuration notes

### Woo GST India (WPBrigade)

Plugin: `woo-gst-india` — free, 10k+ active installs.

Vexa does not conflict with this plugin. To surface Vexa's GST values in the plugin UI:
- Set `_wgsti_gst_enabled` to `1` on each product via a one-time migration script if you want the plugin's own checkbox to show as "enabled."
- The plugin reads its own `_wgsti_hsn_code` and `_wgsti_gst_rate` keys. If you want the plugin to display the same values as Vexa, map them in a `woocommerce_product_after_variable_attributes` hook (read `_vexa_hsn_code` → write `_wgsti_hsn_code`).
- Vexa's `_vexa_gst_rate` stores a numeric percentage. `_wgsti_gst_rate` expects the same format.

### WooCommerce GST Suite (Webkul)

Plugin: `woo-gst-suite` — paid, widely used in India.

- The plugin reads `_wc_gst_status` (`applicable` / `not_applicable`) and `_wc_hsn_code`.
- Vexa's `_vexa_gst_applicable = 'yes'` maps to `_wc_gst_status = 'applicable'`. Sync via a `save_post_product` hook or a migration script.
- Webkul also stores per-slab rates. Vexa's flat `_vexa_gst_rate` maps to the base rate slab.

### WooTax (TaxJar / WooTax plugin)

Designed primarily for US sales-tax; not recommended for India. Use one of the plugins above for Indian GST compliance.

### YITH WooCommerce Points and Rewards / custom tax plugins

Any plugin that reads `meta_data` from the WooCommerce REST API response will see all `_vexa_*` keys. They are safe to ignore — WooCommerce does not act on unknown `meta_data` keys.

## Reconciliation and idempotency guarantees

**Corrected 2026-09-04:** the meta_key/meta_value lookup described below was
the original design but was found broken against a real store (it returned
the same product for every distinct SKU) and was deliberately abandoned.
See `apps/api/src/connectors/woocommerce/woocommerce.connector.ts:304-335`
and the regression test at `woocommerce.connector.spec.ts:284-311`.

- **Re-publish safety:** `findExistingProductId` queries WooCommerce's
  **native `sku` query parameter** (`GET /products?sku={sku}`) before every
  publish — **not** `_vexa_pim_product_id` meta_data. If a product with
  that SKU exists, Vexa performs `PUT /products/{id}` instead of
  `POST /products`. The `_vexa_pim_product_id` meta_data key is still
  written to every product for reference/traceability, but it is never
  read back for matching. Changing a Vexa-managed product's WooCommerce SKU
  directly (bypassing Vexa) will break re-publish matching; stripping the
  `_vexa_pim_product_id` meta field has no effect on idempotency.
- **Timestamp freshness:** `_vexa_pim_sync_ts` is always updated, even on
  idempotent re-publishes, so merchants can tell when Vexa last touched the
  product.
- **GST flag stability:** `_vexa_gst_applicable` is written on every
  publish; it will be absent after a manual WooCommerce edit that strips
  meta_data. A background reconciliation job
  (`woocommerce-reconciliation.service.ts`) runs on a schedule (roughly
  every 4 hours, enabled by default) and can automatically re-publish
  drifted products — this is not verified as production-ready against a
  live pilot store. See
  `docs/readiness/WOOCOMMERCE_CONTROLLED_PILOT_CUSTOMER_GUIDE_2026-09-04.md`
  Section 8 for the customer-facing operational warning.
