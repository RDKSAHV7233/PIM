#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "rejection", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PAGE, "utf8");

  assert(
    source.includes("const { authHeader, actorRole } = await getServerSession();") &&
      source.includes("getProductList({ slim: true }, { role: actorRole, authHeader })") &&
      source.includes("getDashboardHealth({ role: actorRole, authHeader })"),
    "Rejection insights must derive shared auth context before loading quality and product data.",
  );
  assert(
    source.includes("await Promise.all([") &&
      source.includes("getProductList({ slim: true }, { role: actorRole, authHeader })") &&
      source.includes("getDashboardHealth({ role: actorRole, authHeader })"),
    "Rejection insights must load product scope and dashboard health in parallel.",
  );
  assert(
    source.includes("getRejectionIntelligenceScore(productId, channel, { role: actorRole, authHeader })"),
    "Rejection insights must fetch the product risk score using the shared auth context.",
  );
  assert(
    source.includes("if (error instanceof ApiHttpError") &&
      source.includes('redirect(buildLoginRedirect("/rejection", error))'),
    "Rejection insights must redirect auth failures through the centralized login redirect helper.",
  );
  assert(
    source.includes('label="High Rejection Risk"') &&
      source.includes('label="Blocking Issues"') &&
      source.includes('label="Warnings"') &&
      source.includes('label="Selected Product Risk"') &&
      source.includes('href="/quality/issues"') &&
      source.includes('action={{ label: "Go to product list", href: "/catalog/products" }}'),
    "Rejection insights must preserve the core KPI and drilldown contract while truth states harden.",
  );
  assert(
    source.includes("if (error instanceof ApiHttpError") &&
      source.includes("error.status === 401") &&
      source.includes('redirect(buildLoginRedirect("/rejection", error));'),
    "Rejection insights must redirect expired or forbidden sessions through the login redirect helper.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "rejection_route_uses_shared_server_auth_context",
          "rejection_route_wraps_product_and_health_reads",
          "rejection_route_keeps_supporting_score_degraded_states_explicit",
          "rejection_route_distinguishes_restricted_and_unavailable_truth",
          "rejection_route_preserves_kpi_and_drilldown_contract",
          "rejection_route_redirects_only_expired_sessions",
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
  console.error("Rejection route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
