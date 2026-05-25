#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PRODUCTS_INDEX_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PRODUCTS_INDEX_PAGE, "utf8");

  assert(
    source.includes('import { redirect } from "next/navigation";') &&
      source.includes('export const dynamic = "force-dynamic";'),
    "Products index alias must stay a lightweight force-dynamic redirect page.",
  );
  assert(
    source.includes("searchParams?: Promise<Record<string, string | string[] | undefined>>;") &&
      source.includes("const resolvedSearchParams = searchParams ? await searchParams : undefined;") &&
      source.includes("const nextSearch = new URLSearchParams();"),
    "Products index alias must resolve incoming search params before redirecting.",
  );
  assert(
    source.includes("if (Array.isArray(value)) {") &&
      source.includes("nextSearch.append(key, entry);") &&
      source.includes('if (typeof value === "string") {') &&
      source.includes("nextSearch.set(key, value);"),
    "Products index alias must preserve both single and repeated query parameters.",
  );
  assert(
    source.includes('const target = nextSearch.size > 0 ? `/catalog/products?${nextSearch.toString()}` : "/catalog/products";') &&
      source.includes("redirect(target);"),
    "Products index alias must preserve filter state when redirecting to the catalog products workspace.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "products_index_alias_is_force_dynamic",
          "products_index_alias_reads_incoming_search_params",
          "products_index_alias_preserves_single_and_repeated_query_values",
          "products_index_alias_redirects_to_catalog_products_with_filter_state",
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
  console.error("Products index route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
