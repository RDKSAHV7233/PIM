#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "catalog", "attributes", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PAGE, "utf8");

  assert(
    source.includes("await getServerSession();") &&
      source.includes('type SharedReadState = "available" | "restricted" | "unavailable";') &&
      source.includes("async function loadSharedRead<T>(promise: Promise<T>): Promise<SharedReadResult<T>>"),
    "Catalog attributes must derive shared auth context and explicit shared-read helpers before loading taxonomy data.",
  );
  assert(
    source.includes("const categoriesResult = await loadSharedRead(") &&
      source.includes("getCategoryTree({ all: true }, { role: actorRole, authHeader, revalidateSeconds: 60 })") &&
      source.includes("if (categoriesResult.state === \"restricted\") {") &&
      source.includes("if (categoriesResult.state === \"unavailable\") {"),
    "Catalog attributes must treat category scope as the authoritative shared read and render restricted/unavailable page states when it fails.",
  );
  assert(
    source.includes("const definitionsResult: SharedReadResult<AttributeDefinition[]> = selectedCategoryId") &&
      source.includes("loadSharedRead(getCategoryAttributes(selectedCategoryId, { role: actorRole, authHeader, revalidateSeconds: 60 }))") &&
      source.includes("Attribute definitions are restricted for your role.") &&
      source.includes("Attribute definitions are temporarily unavailable."),
    "Catalog attributes must treat attribute definitions as a supporting shared read and keep its degraded states explicit.",
  );
  assert(
    source.includes("Attribute scope is restricted") &&
      source.includes("Attribute scope is temporarily unavailable") &&
      source.includes("false empty attribute catalog") &&
      source.includes("Attribute governance controls remain disabled while definition scope reconnects."),
    "Catalog attributes must distinguish restricted and unavailable taxonomy truth instead of falling back to empty categories or empty definitions.",
  );
  assert(
    source.includes('href="/catalog/categories"') &&
      source.includes('href="/catalog/products"') &&
      source.includes("No attribute definitions found for this category."),
    "Catalog attributes must preserve related workspace links and only show the empty definition state when the definition feed loaded successfully.",
  );
  assert(
    source.includes('if (error instanceof ApiHttpError && error.status === 401)') &&
      source.includes('redirect(buildLoginRedirect("/catalog/attributes", error));'),
    "Catalog attributes must redirect only expired sessions while preserving restricted taxonomy reads in-page.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "catalog_attributes_route_uses_shared_server_auth_context",
          "catalog_attributes_route_gates_category_scope_as_authoritative_shared_read",
          "catalog_attributes_route_keeps_attribute_definition_degraded_states_explicit",
          "catalog_attributes_route_distinguishes_restricted_and_unavailable_truth",
          "catalog_attributes_route_preserves_empty_state_and_related_workspace_links",
          "catalog_attributes_route_redirects_only_expired_sessions",
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
  console.error("Catalog attributes route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
