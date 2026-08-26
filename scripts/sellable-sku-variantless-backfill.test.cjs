#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require("node:assert/strict");
const {
  deriveCanonicalVariantFields,
  isWriteAuthorized,
  assertNotTruncated,
  summarize,
  SELLABLE_STATUSES,
} = require("./sellable-sku-variantless-backfill.cjs");

assert.deepEqual(SELLABLE_STATUSES, ["approved", "active"]);

// deriveCanonicalVariantFields must mirror CatalogService.ensureCanonicalVariant
// field-for-field (apps/api/src/catalog/catalog.service.ts) so a backfilled row
// is indistinguishable from one the forward-fix would have created at approval
// time — not a parallel, potentially-drifting reimplementation.

// skuCode: attributes.sku (trimmed) when present, else the product's own id.
assert.equal(
  deriveCanonicalVariantFields({ id: "prod_1", status: "approved", attributes: { sku: "  ACME-001  " } }).skuCode,
  "ACME-001",
);
assert.equal(
  deriveCanonicalVariantFields({ id: "prod_2", status: "approved", attributes: {} }).skuCode,
  "prod_2",
);
assert.equal(
  deriveCanonicalVariantFields({ id: "prod_3", status: "approved", attributes: { sku: "   " } }).skuCode,
  "prod_3",
);

// mrp: attributes.mrp, else attributes.price, else null.
assert.equal(deriveCanonicalVariantFields({ id: "p", status: "active", attributes: { mrp: 999 } }).mrp, 999);
assert.equal(deriveCanonicalVariantFields({ id: "p", status: "active", attributes: { price: 499 } }).mrp, 499);
assert.equal(deriveCanonicalVariantFields({ id: "p", status: "active", attributes: {} }).mrp, null);
// mrp must prefer attributes.mrp over attributes.price when both are present.
assert.equal(
  deriveCanonicalVariantFields({ id: "p", status: "active", attributes: { mrp: 999, price: 499 } }).mrp,
  999,
);

// sellingPrice: attributes.sellingPrice, else attributes.selling_price, else mrp.
assert.equal(
  deriveCanonicalVariantFields({ id: "p", status: "active", attributes: { sellingPrice: 799 } }).sellingPrice,
  799,
);
assert.equal(
  deriveCanonicalVariantFields({ id: "p", status: "active", attributes: { selling_price: 649 } }).sellingPrice,
  649,
);
assert.equal(
  deriveCanonicalVariantFields({ id: "p", status: "active", attributes: { mrp: 999 } }).sellingPrice,
  999,
);
// A non-object attributes value (null, corrupt data) must not throw — treated
// as empty, falling through every branch to the safe default.
assert.doesNotThrow(() => deriveCanonicalVariantFields({ id: "p", status: "active", attributes: null }));
assert.equal(deriveCanonicalVariantFields({ id: "p", status: "active", attributes: null }).skuCode, "p");

// status: the product's own status, passed through unchanged.
assert.equal(deriveCanonicalVariantFields({ id: "p", status: "approved", attributes: {} }).status, "approved");
assert.equal(deriveCanonicalVariantFields({ id: "p", status: "active", attributes: {} }).status, "active");

// Write authorization requires BOTH the CLI flag and the env var — neither
// alone is sufficient, so a single mistaken flag or leftover env var can never
// trigger a real write.
assert.equal(isWriteAuthorized({ confirmFlag: true, confirmEnv: "true" }), true);
assert.equal(isWriteAuthorized({ confirmFlag: true, confirmEnv: "false" }), false);
assert.equal(isWriteAuthorized({ confirmFlag: true, confirmEnv: "" }), false);
assert.equal(isWriteAuthorized({ confirmFlag: true, confirmEnv: undefined }), false);
assert.equal(isWriteAuthorized({ confirmFlag: false, confirmEnv: "true" }), false);
assert.equal(isWriteAuthorized({ confirmFlag: false, confirmEnv: "false" }), false);
// Case-insensitive on the env var (workflow_dispatch boolean inputs render as
// lowercase "true"/"false" strings, but this must not be brittle to that).
assert.equal(isWriteAuthorized({ confirmFlag: true, confirmEnv: "TRUE" }), true);

// assertNotTruncated is the real cap enforcement — the upfront count() is a
// non-atomic, TOCTOU-vulnerable proxy for it (the population can grow between
// the count() and the findMany() that follows), so this must reject on the
// ACTUAL fetched row count, not just trust the earlier count matched.
assert.doesNotThrow(() => assertNotTruncated(63, 5000));
assert.doesNotThrow(() => assertNotTruncated(5000, 5000));
assert.throws(() => assertNotTruncated(5001, 5000), /grew past ROW_FETCH_CAP/);

// summarize must cover every possible outcome with a fixed shape, including
// "error" appearing as 0 rather than being silently absent when nothing failed.
assert.deepEqual(summarize([]), { created: 0, skipped_already_has_variant: 0, would_create: 0, error: 0 });
assert.deepEqual(
  summarize([
    { outcome: "created" },
    { outcome: "created" },
    { outcome: "skipped_already_has_variant" },
    { outcome: "error" },
  ]),
  { created: 2, skipped_already_has_variant: 1, would_create: 0, error: 1 },
);

console.log(
  JSON.stringify(
    {
      status: "ok",
      suite: "sellable-sku-variantless-backfill.test",
      validated: [
        "sellable_statuses_pinned",
        "sku_code_mirrors_ensure_canonical_variant",
        "mrp_prefers_attributes_mrp_over_price",
        "selling_price_falls_back_to_mrp",
        "non_object_attributes_does_not_throw",
        "status_passed_through_unchanged",
        "write_authorization_requires_both_flag_and_env_var",
        "write_authorization_env_var_case_insensitive",
        "assert_not_truncated_rejects_actual_overrun_not_just_upfront_count",
        "summarize_fixed_shape_including_error",
      ],
      checkedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
