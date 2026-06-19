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
    source.includes("await getServerSession();") &&
      source.includes('type SharedReadState = "available" | "restricted" | "unavailable";') &&
      source.includes("async function loadSharedRead<T>(promise: Promise<T>): Promise<SharedReadResult<T>>"),
    "Rejection insights must derive shared auth context and explicit shared-read helpers before loading quality and product data.",
  );
  assert(
    source.includes("const [productsResult, healthResult] = await Promise.all([") &&
      source.includes("loadSharedRead(getProductList({ slim: true }, { role: actorRole, authHeader }))") &&
      source.includes("loadSharedRead(getDashboardHealth({ role: actorRole, authHeader }))"),
    "Rejection insights must load product scope and dashboard health through explicit shared-read wrappers.",
  );
  assert(
    source.includes("const scoreResult =") &&
      source.includes("loadSharedRead(getRejectionIntelligenceScore(productId, channel, { role: actorRole, authHeader }))") &&
      source.includes("Rejection scoring is restricted for your role.") &&
      source.includes("Rejection scoring is temporarily unavailable."),
    "Rejection insights must treat the product risk score as a supporting shared read with explicit degraded states.",
  );
  assert(
    source.includes("Some rejection insight data is temporarily unavailable") &&
      source.includes("Some rejection insight data is restricted") &&
      source.includes("Unavailable health or product feeds are held back instead of defaulting to low rejection risk or an empty product selector.") &&
      source.includes("Product selection is limited for your role.") &&
      source.includes("Product selection is temporarily unavailable."),
    "Rejection insights must distinguish restricted and unavailable product/health truth instead of showing fake low-risk or empty selector states.",
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
    source.includes('if (error instanceof ApiHttpError && error.status === 401)') &&
      source.includes('redirect(buildLoginRedirect("/rejection", error));'),
    "Rejection insights must redirect only expired sessions while preserving restricted shared reads in-page.",
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
