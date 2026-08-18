#!/usr/bin/env node
/* eslint-disable no-console */
//
// Regression test for PIM#613: a zero-match product search rendered the first-time-user
// "Your catalog is empty — Import your CSV/JSON" onboarding state instead of "No products
// match your search" — even on a tenant with 21,498 real products.
//
// Root cause: the empty-state branch decided "is the catalog empty?" from
// `filteredProducts.length === 0`, where `filteredProducts` is derived from the `products`
// prop. On a URL-driven load (bookmark, shared link, refresh), the server pre-narrows that
// prop to the search term via `getAdvancedSearchProducts({ q: initialSearch })` — so a
// zero-match search makes `filteredProducts` empty too, indistinguishable from a genuinely
// empty catalog.
//
// Fix: judge catalog emptiness from `stats.products` — a separate, always-unfiltered
// tenant-wide count (apps/api/src/catalog/catalog.service.ts stats()) that a search term,
// interactive or URL-driven, never narrows.
//
// Invariant (PIM#613):
//   Onboarding empty state is determined by existence of catalog data, not by the
//   cardinality of the current search result.
//
// This test extracts and executes the real `trulyEmptyCatalog` expression out of the actual
// source file (via the TypeScript compiler, not a hand-reimplementation), then walks the
// exact test matrix from the fix discussion against it plus the (unchanged, already-correct)
// downstream branch conditions.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PRODUCTS_TAB_FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "product", "products-tab.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function loadRealTrulyEmptyCatalog() {
  const source = fs.readFileSync(PRODUCTS_TAB_FILE, "utf8");
  const match = source.match(/const trulyEmptyCatalog = (stats[^;]*);/);
  assert(match, "Could not find the trulyEmptyCatalog expression in products-tab.tsx.");

  const fnSource = `function computeTrulyEmptyCatalog(stats, filteredProducts) { return ${match[1]}; }`;
  const transpiled = ts.transpileModule(fnSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const factory = new Function(`${transpiled}\nreturn computeTrulyEmptyCatalog;`);
  return factory();
}

// Mirrors the (unmodified) EmptyState branch chain in products-tab.tsx: BOX branch first,
// then SEARCH branch, then the real DataGrid. Returns which branch would render.
function resolveEmptyStateBranch({ trulyEmptyCatalog, visibleProductsLength, searchQueryTrim }) {
  if (trulyEmptyCatalog) return { branch: "onboarding_empty_catalog", icon: "BOX", title: "Your catalog is empty" };
  if (visibleProductsLength === 0) {
    return {
      branch: "no_results",
      icon: "SEARCH",
      title: searchQueryTrim.length > 0 ? "No products match your search" : "No products match this view",
    };
  }
  return { branch: "product_grid" };
}

function run() {
  const computeTrulyEmptyCatalog = loadRealTrulyEmptyCatalog();

  // The fix must not have regressed the empty-state branch to still read filteredProducts:
  const source = fs.readFileSync(PRODUCTS_TAB_FILE, "utf8");
  assert(
    /\)\s*:\s*trulyEmptyCatalog\s*\?\s*\(\s*<EmptyState\s+icon="BOX"\s+title="Your catalog is empty"/.test(source),
    'The "Your catalog is empty" EmptyState must be gated on trulyEmptyCatalog, not filteredProducts.length === 0 ' +
      "— gating on the search-narrowed list is exactly the PIM#613 defect.",
  );
  assert(
    !/filteredProducts\.length === 0 \? \(\s*<EmptyState\s+icon="BOX"/.test(source),
    'The BOX EmptyState must not have regressed back to gating on filteredProducts.length === 0.',
  );

  // --- Core invariant: stats.products, never filteredProducts.length, decides emptiness ---
  const list = (n) => ({ length: n });

  assert(
    computeTrulyEmptyCatalog({ products: 0 }, list(0)) === true,
    "A tenant with 0 real products (stats.products === 0) must be judged truly empty.",
  );
  assert(
    computeTrulyEmptyCatalog({ products: 21498 }, list(0)) === false,
    "A tenant with 21,498 real products must NOT be judged truly empty, even when the current " +
      "(possibly search-narrowed) filteredProducts list happens to be 0 — this is the exact PIM#613 case: " +
      "a URL-driven search whose server-side query pre-narrows `products` to an empty array.",
  );
  assert(
    computeTrulyEmptyCatalog({ products: 21498 }, list(21498)) === false,
    "A non-empty, unfiltered browse (no search) must not be judged empty.",
  );
  assert(
    computeTrulyEmptyCatalog(null, list(0)) === true && computeTrulyEmptyCatalog(null, list(5)) === false,
    "When stats is unavailable, fall back to filteredProducts.length as the best available signal " +
      "(degraded, but no worse than pre-fix behavior).",
  );

  // --- Full test matrix from the fix discussion ---

  // 1. true catalog 0 + no search -> onboarding empty state
  let result = resolveEmptyStateBranch({
    trulyEmptyCatalog: computeTrulyEmptyCatalog({ products: 0 }, list(0)),
    visibleProductsLength: 0,
    searchQueryTrim: "",
  });
  assert(result.branch === "onboarding_empty_catalog", `Case 1 (empty catalog, no search) must show onboarding empty state, got "${result.branch}".`);

  // 2. true catalog >0 + URL search + 0 matches -> no-search-results state
  //    (URL-driven: server pre-narrows `products`, so filteredProducts is 0 too — but stats.products isn't)
  result = resolveEmptyStateBranch({
    trulyEmptyCatalog: computeTrulyEmptyCatalog({ products: 21498 }, list(0)),
    visibleProductsLength: 0,
    searchQueryTrim: "zzznomatchxyz123",
  });
  assert(
    result.branch === "no_results" && result.title === "No products match your search",
    `Case 2 (non-empty catalog, URL search, 0 matches) must show "No products match your search", got ${JSON.stringify(result)}.`,
  );

  // 3. true catalog >0 + URL search + matches -> matching products
  result = resolveEmptyStateBranch({
    trulyEmptyCatalog: computeTrulyEmptyCatalog({ products: 21498 }, list(1)),
    visibleProductsLength: 1,
    searchQueryTrim: "VEXA-QA-VARIANTS",
  });
  assert(result.branch === "product_grid", `Case 3 (non-empty catalog, URL search, matches) must render the product grid, got "${result.branch}".`);

  // 4. true catalog >0 + interactive search + 0 matches -> no-search-results state
  //    (interactive: `products`/filteredProducts stay the full unfiltered list; only
  //    visibleProducts narrows client-side)
  result = resolveEmptyStateBranch({
    trulyEmptyCatalog: computeTrulyEmptyCatalog({ products: 21498 }, list(21498)),
    visibleProductsLength: 0,
    searchQueryTrim: "zzznomatchxyz123",
  });
  assert(
    result.branch === "no_results" && result.title === "No products match your search",
    `Case 4 (non-empty catalog, interactive search, 0 matches) must show "No products match your search", got ${JSON.stringify(result)}.`,
  );

  // 5. clear search -> catalog restored (equivalent to case 3/4's "matches" branch once
  //    searchQuery is cleared and the full list is visible again)
  result = resolveEmptyStateBranch({
    trulyEmptyCatalog: computeTrulyEmptyCatalog({ products: 21498 }, list(21498)),
    visibleProductsLength: 21498,
    searchQueryTrim: "",
  });
  assert(result.branch === "product_grid", `Case 5 (search cleared) must restore the product grid, got "${result.branch}".`);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "empty_state_gated_on_truly_empty_catalog_not_filtered_products_length",
          "stats_products_zero_is_truly_empty",
          "stats_products_nonzero_with_zero_filtered_products_is_not_truly_empty",
          "stats_unavailable_falls_back_to_filtered_products_length",
          "matrix_case_1_empty_catalog_no_search",
          "matrix_case_2_url_search_zero_matches",
          "matrix_case_3_url_search_with_matches",
          "matrix_case_4_interactive_search_zero_matches",
          "matrix_case_5_clear_search_restores_grid",
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
  console.error("Products empty-search-state test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
