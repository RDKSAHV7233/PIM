#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const WEB_FILTER = path.join(REPO_ROOT, "apps", "web", "src", "lib", "test-data-filter.ts");
const PURGE_SCRIPT = path.join(REPO_ROOT, "tools", "dev", "purge-test-data.cjs");
const API_EXCLUSION = path.join(REPO_ROOT, "apps", "api", "src", "catalog", "test-data-exclusion.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

// Extracts every double-quoted string literal from a `const NAME = [ ... ];` array block —
// used to compare the web filter's TEST_PREFIXES against the API's TEST_DATA_PREFIXES (F-004:
// the search endpoint now excludes test data server-side too, using its own copy of this list —
// see apps/api/src/catalog/test-data-exclusion.ts — which must not drift from the web one).
function extractPrefixArray(source, constName) {
  const match = source.match(new RegExp(`const ${constName}[^=]*=\\s*\\[([\\s\\S]*?)\\];`));
  assert(match, `could not find a "const ${constName} = [...]" array in the given source`);
  // Strip `//` line comments first — this array is annotated with prose explaining *why* a
  // prefix was chosen, which can itself contain quoted example strings (e.g. mentioning a
  // rejected "e2e " prefix) that aren't actual array entries.
  const body = match[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
  return body.match(/"(?:[^"\\]|\\.)*"/g).map((entry) => JSON.parse(entry));
}

try {
  const webFilterSource = read(WEB_FILTER);
  const purgeScriptSource = read(PURGE_SCRIPT);
  const apiExclusionSource = read(API_EXCLUSION);
  const requiredPrefixes = ['"e2e-"', '"qa flow "', '"pim1 qa flow "', '"ui-reality-"', '"manual cat "'];

  for (const prefix of requiredPrefixes) {
    assert(webFilterSource.includes(prefix), `web test-data filter is missing prefix ${prefix}`);
    assert(purgeScriptSource.includes(prefix), `purge script is missing prefix ${prefix}`);
  }

  assert(
    webFilterSource.includes("toLowerCase()"),
    "web test-data filter must normalize labels to lowercase before prefix matching",
  );
  assert(
    purgeScriptSource.includes("LOWER("),
    "purge script must normalize SQL comparisons to lowercase before prefix matching",
  );
  assert(
    purgeScriptSource.includes('WHERE (p."tenantKey" =') &&
      purgeScriptSource.includes('OR p."categoryId" IN (SELECT id FROM matched_categories)'),
    "purge script must include category-linked products even when they belong to a different tenant",
  );
  assert(
    purgeScriptSource.includes('DELETE FROM "Product"') &&
      purgeScriptSource.includes('WHERE id IN (SELECT id FROM matched_products)'),
    "purge script must delete the matched product ids directly after broadening category-linked matches",
  );

  const webPrefixes = extractPrefixArray(webFilterSource, "TEST_PREFIXES").sort();
  const apiPrefixes = extractPrefixArray(apiExclusionSource, "TEST_DATA_PREFIXES").sort();
  assert(
    JSON.stringify(webPrefixes) === JSON.stringify(apiPrefixes),
    `API test-data-exclusion.ts prefix list has drifted from the web filter's TEST_PREFIXES.\n` +
      `  Web-only:  ${JSON.stringify(webPrefixes.filter((p) => !apiPrefixes.includes(p)))}\n` +
      `  API-only:  ${JSON.stringify(apiPrefixes.filter((p) => !webPrefixes.includes(p)))}`,
  );
  assert(
    apiExclusionSource.includes('mode: "insensitive"'),
    "API test-data exclusion must match case-insensitively, same as the web filter",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "web_filter_covers_current_e2e_prefixes",
          "purge_script_covers_current_e2e_prefixes",
          "matcher_is_case_insensitive_in_web_and_sql",
          "purge_script_cleans_cross_tenant_products_attached_to_test_categories",
          "api_search_exclusion_list_matches_web_filter_exactly",
        ],
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("Test data governance patterns integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
