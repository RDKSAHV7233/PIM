#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const LAYOUT = path.join(REPO_ROOT, "apps", "web", "src", "app", "layout.tsx");
const AUTHENTICATED_SHELL = path.join(REPO_ROOT, "apps", "web", "src", "components", "nav", "authenticated-shell.tsx");
const SEARCH_COMPONENT = path.join(REPO_ROOT, "apps", "web", "src", "components", "nav", "global-search.tsx");
const SEARCH_ROUTE = path.join(REPO_ROOT, "apps", "web", "src", "app", "api", "catalog", "search", "route.ts");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run() {
  const layoutSource = fs.readFileSync(LAYOUT, "utf8");
  const shellSource = fs.readFileSync(AUTHENTICATED_SHELL, "utf8");
  const componentSource = fs.readFileSync(SEARCH_COMPONENT, "utf8");
  const routeSource = fs.readFileSync(SEARCH_ROUTE, "utf8");

  assert(
    layoutSource.includes("<AuthenticatedShell actorRole={actorRole}") &&
      shellSource.includes('import { GlobalSearch } from "@/components/nav/global-search";') &&
      shellSource.includes("<GlobalSearch />"),
    "Authenticated shell must mount the global search in the header only when auth is present.",
  );
  assert(
    componentSource.includes('placeholder="Search products by title or SKU"') &&
      componentSource.includes("/api/catalog/search?q=") &&
      componentSource.includes('if (!query.trim()) {') &&
      componentSource.includes('event.key === "ArrowDown"') &&
      componentSource.includes('event.key === "Escape"'),
    "Global search component must debounce same-origin product search with empty-query guard and keyboard navigation.",
  );
  assert(
    routeSource.includes("searchCatalogProducts") && routeSource.includes("if (!query) {") && routeSource.includes("return NextResponse.json([]);"),
    "Catalog search proxy route must short-circuit empty queries and delegate tenant-scoped lookup to the API helper.",
  );

  console.log(JSON.stringify({
    status: "ok",
    validated: [
      "authenticated_shell_mounts_global_search",
      "global_search_component_handles_empty_query_and_keyboard_nav",
      "catalog_search_proxy_short_circuits_empty_queries"
    ],
    checkedAt: new Date().toISOString()
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error("Global search UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
