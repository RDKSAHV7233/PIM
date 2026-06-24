#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "ondc", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PAGE, "utf8");

  assert(
    source.includes("notFound();") &&
      source.includes('process.env.APP_ENV === "production"') &&
      source.includes("FEATURE_ONDC_ENABLED"),
    "ONDC must preserve the internal-only gate while truth hardening lands.",
  );
  assert(
    source.includes('type SharedReadState = "available" | "restricted" | "unavailable";') &&
      source.includes("async function loadSharedRead<T>(promise: Promise<T>): Promise<SharedReadResult<T>>") &&
      source.includes("await getServerSession();"),
    "ONDC must derive server auth context and shared-read helpers before loading admin feeds.",
  );
  assert(
    source.includes(
      "loadSharedRead(getCategoryTree({ all: true }, { role: actorRole, authHeader, revalidateSeconds: 60 }))",
    ) &&
      source.includes("loadSharedRead(getProductList({ slim: true }, { role: actorRole, authHeader }))") &&
      source.includes("loadSharedRead(getOndcVersions({ role: actorRole, authHeader }))") &&
      source.includes("loadSharedRead(") &&
      source.includes("getOndcMappings("),
    "ONDC must wrap categories, products, versions, and mappings in shared-read truth contracts.",
  );
  assert(
    source.includes("await loadSharedRead(") &&
      source.includes("getOndcSimulation(productId, nodeType, version, mappingId || undefined") &&
      source.includes("ONDC simulation is restricted for your role.") &&
      source.includes("ONDC simulation is temporarily unavailable."),
    "ONDC simulation must treat supporting reads as restricted or unavailable instead of silently collapsing to null.",
  );
  assert(
    source.includes("Some ONDC admin data is temporarily unavailable") &&
      source.includes("Some ONDC admin data is restricted") &&
      source.includes(
        "Unavailable mapping, category, product, or version feeds are held back instead of defaulting",
      ) &&
      source.includes("Category selection is limited for your role.") &&
      source.includes("Category selection is temporarily unavailable.") &&
      source.includes("Version selection is limited for your role.") &&
      source.includes("Version selection is temporarily unavailable.") &&
      source.includes("Product selection is limited for your role.") &&
      source.includes("Product selection is temporarily unavailable.") &&
      source.includes("ONDC mappings are restricted for your role.") &&
      source.includes("ONDC mappings are temporarily unavailable."),
    "ONDC must distinguish restricted and unavailable admin feeds instead of rendering false empty mapping or selector states.",
  );
  assert(
    source.includes('if (error instanceof ApiHttpError && error.status === 401)') &&
      source.includes('redirect(buildLoginRedirect("/ondc", error));') &&
      source.includes('href={`/`}') &&
      source.includes('href={`/media`}') &&
      source.includes('href={`/rejection`}') &&
      source.includes('href={`/ai`}'),
    "ONDC must redirect only expired sessions and preserve the internal navigation contract.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "ondc_route_preserves_internal_gate",
          "ondc_route_uses_shared_server_auth_context",
          "ondc_route_wraps_core_admin_feeds",
          "ondc_route_keeps_simulation_degraded_states_explicit",
          "ondc_route_distinguishes_restricted_and_unavailable_truth",
          "ondc_route_redirects_only_expired_sessions",
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
  console.error("ONDC route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
