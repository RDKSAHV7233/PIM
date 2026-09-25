#!/usr/bin/env node
/* eslint-disable no-console */
// Regression coverage for F-011 (2026-09-19 production launch QA pass): the
// "Hide test data" checkbox on Products/Categories/Attributes/Channel
// Mappings/Connectors/Media/ONDC/Bulk Edit/Imports/Issue Inbox/Rejection
// Insights (12 pages share this one util) read as checked but left the vast
// majority of this project's actual QA/E2E fixture data visible anyway,
// because TEST_PREFIXES in apps/web/src/lib/test-data-filter.ts hadn't
// tracked this project's own current fixture-naming conventions. Every
// title/category string asserted below was observed live in production
// still passing through a checked filter, before the prefix list was
// extended to cover them.
//
// Runs the real TypeScript module directly (Node 24's native type-stripping
// require() support), not a source-text grep, so this proves runtime
// behavior, not just that some string exists in the file.
const path = require("node:path");
const { isTestData, filterTestData } = require(
  path.join(__dirname, "..", "..", "src", "lib", "test-data-filter.ts"),
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const KNOWN_TEST_LABELS = [
  "@SUM(A1:A10)",
  "+VEXA-QA-SEC-004",
  "=1+1",
  "QA-RETEST-0919 <script>alert(1)</script> XSS",
  "QA-RETEST-0919 GST Uncommon Rate",
  "QA-RETEST-0919 SRE Watch Row 100",
  "QA-STAGE-500-1782464225491-8396-0001",
  "QA-STAGE-500-BRAND-1782464225491-8396",
  "QA-STAGE-E2E-1782449473146",
  "VEXA-QA-BADATTR-001",
  "VEXA-QA-IMPORT-20260918-CLEAN-002",
  "VEXA-QA-SEC-HTML-001",
  "VEXA-QA-SEC-SCRIPT-001",
  "VEXA-QA-UTF8-Tシャツ-日本語-Café",
  "VEXA-QA-P594-REPRO-2",
  "PIM594-ClickRace-Test2",
  "QAPILOT-20260824-001 Production Readiness Fixture",
  "QAPILOT-20260824-002 Multi-Variant Fixture",
  "RES-02 Approved Candidate 1787720001100-77",
  "RES-02 Bulk Ready 1787720001100-77",
  "E2E Editor Role Product 1787749428967-3310",
  "Vexa QA",
  "E2EBrand",
  "StageQA",
  "QAPilot",
  "VexaQA",
  // 2026-09-25 additions (F-004 live-verification follow-up): found live by paginating
  // through the full 265-product "still showing after Hide test data" list on
  // /catalog/products, after the description-marker fix (F-004) removed the ~19,800-product
  // bulk-import batch. None of these matched any prefix above.
  "QA-Alpha T-Shirt Black QA0211",
  "QA-Beta Audio Black QA0187",
  "QA-Gamma Toy Blue QA0153",
  "QA-Delta Stationery Blue QA0249",
  "QA-Echo Kitchenware Black QA0155",
  "QA-CODEX-20260728122450 Bulk Edit Product 1",
  "QA-E2E Destructive Prod Cap",
  "QA Mouse-Click Investigation Draft",
  "PIM585-LiveVerify-VX3",
  "QAv2 Shopify Fixture Tee VX-QA260814",
];

const PLAUSIBLE_REAL_LABELS = [
  "UrbanNest Mandarin Collar Shirt Cream VX0109897",
  "T-Shirt",
  "Men's Slim Fit Kurta",
  "Reserved Stock SKU 4471",
  "Vexa Lifestyle Pvt Ltd",
  "Premium Cotton Blend",
  // 2026-09-25 (F-004 live-verification follow-up): found in the same 265-product leftover
  // list as the KNOWN_TEST_LABELS additions above, but deliberately left unfiltered — unlike
  // "QA-"/"PIM585-"/"QAv2 ", these two have no distinctive, safe-to-match prefix ("Vex"/"Vexa"
  // is this tenant's own brand, used throughout the app's own name, so a broad match would
  // risk hiding genuinely real products). Manually inspected both: "Vex T" (brand "Vex",
  // description "Vex T for men") and "Vexapim Trial" (brand "Vexa", description "Vexa Pim
  // risk") are minimal/generic enough to plausibly be early manual test entries, but neither
  // carries a self-declared test marker the way the bulk-import batch's descriptions did for
  // F-004's main fix — left for a human call rather than guessed at.
  "Vex T",
  "Vexapim Trial",
];

// Regression guard: a bare "e2e " prefix was tried for F-011 and reverted
// because it also matched this repo's OWN CI e2e-journey fixture titles
// (apps/web/test/e2e/journey-bulk-import-to-mapping.spec.js), hiding a
// journey test's just-imported products from its own catalog assertion and
// failing PR #909's e2e CI job. These must never classify as test data via
// a generic "e2e " match — only the specific "E2E Editor Role Product"
// phrase observed leaking in production should.
const CI_OWN_E2E_FIXTURE_LABELS = [
  "E2E Journey Product A some-category",
  "E2E Journey Product B some-category",
  "E2E Journey Product C some-category",
];

function run() {
  for (const label of KNOWN_TEST_LABELS) {
    assert(
      isTestData(label) === true,
      `isTestData("${label}") should be true — this exact fixture string was observed leaking through the "Hide test data" filter in production before the fix.`,
    );
  }

  assert(
    isTestData("  vexa-qa-lowercase-001  ") === true,
    "isTestData must be case-insensitive and tolerant of surrounding whitespace.",
  );
  assert(
    isTestData("VEXA-QA-UPPERCASE-001") === true,
    "isTestData must match regardless of input casing.",
  );

  for (const label of PLAUSIBLE_REAL_LABELS) {
    assert(
      isTestData(label) === false,
      `isTestData("${label}") should be false — this must not false-positive on a plausible real customer product/category name.`,
    );
  }

  // F-004 (2026-09-25 follow-up): a ~19,800-product bulk-import load-test batch used
  // generated titles/brands designed to look plausible ("EcoMotive Athletic Dry-Fit Tee
  // Maroon VX0500001"), so it passed every check above — but its own description
  // self-declares its purpose, which must be caught via substring match.
  assert(
    isTestData("Lightweight Casual t-shirt for bulk import testing with realistic catalog attributes.") === true,
    "isTestData must catch the bulk-import load-test description marker even when the title/brand looks like a plausible real product.",
  );
  assert(
    isTestData("AeroLite Formal Flat Front Trousers Navy VX0109940") === false,
    "isTestData must not false-positive on the VX-style SKU/brand pattern by title alone — only the description marker identifies these as test data.",
  );

  for (const label of CI_OWN_E2E_FIXTURE_LABELS) {
    assert(
      isTestData(label) === false,
      `isTestData("${label}") should be false — a generic "e2e " prefix must not swallow this repo's own CI e2e-journey fixture titles (see journey-bulk-import-to-mapping.spec.js step 2).`,
    );
  }

  const filteredByTitle = filterTestData(
    [{ title: "@SUM(A1:A10)" }, { title: "UrbanNest Mandarin Collar Shirt" }],
    true,
  );
  assert(
    filteredByTitle.length === 1 && filteredByTitle[0].title === "UrbanNest Mandarin Collar Shirt",
    "filterTestData(hide=true) must exclude a test-titled item and keep the real one.",
  );

  const filteredByCategory = filterTestData(
    [
      { title: "Some Product", category: { name: "Vexa QA" } },
      { title: "Another Product", category: { name: "Apparel" } },
    ],
    true,
  );
  assert(
    filteredByCategory.length === 1 && filteredByCategory[0].title === "Another Product",
    "filterTestData(hide=true) must exclude an item via its category name alone, even with a clean title.",
  );

  const unfiltered = filterTestData([{ title: "@SUM(A1:A10)" }, { title: "Real Product" }], false);
  assert(
    unfiltered.length === 2,
    "filterTestData(hide=false) must return every item unfiltered.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "test_data_filter_flags_every_2026_09_fixture_pattern_found_in_production",
          "test_data_filter_is_case_and_whitespace_tolerant",
          "test_data_filter_does_not_false_positive_on_plausible_real_product_names",
          "test_data_filter_does_not_swallow_ci_own_e2e_journey_fixture_titles",
          "filter_test_data_excludes_by_title",
          "filter_test_data_excludes_by_category_name_alone",
          "filter_test_data_passthrough_when_hide_is_false",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error("test-data-filter fixture-pattern regression test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
