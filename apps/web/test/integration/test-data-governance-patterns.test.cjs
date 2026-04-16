#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const WEB_FILTER = path.join(REPO_ROOT, "apps", "web", "src", "lib", "test-data-filter.ts");
const PURGE_SCRIPT = path.join(REPO_ROOT, "tools", "dev", "purge-test-data.cjs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

try {
  const webFilterSource = read(WEB_FILTER);
  const purgeScriptSource = read(PURGE_SCRIPT);
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

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "web_filter_covers_current_e2e_prefixes",
          "purge_script_covers_current_e2e_prefixes",
          "matcher_is_case_insensitive_in_web_and_sql",
          "purge_script_cleans_cross_tenant_products_attached_to_test_categories",
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
