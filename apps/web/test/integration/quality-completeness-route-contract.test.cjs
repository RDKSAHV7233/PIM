#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "quality", "completeness", "page.tsx");
const ROLE_CAPABILITIES = path.join(REPO_ROOT, "apps", "web", "src", "lib", "role-capabilities.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PAGE, "utf8");
  const roleCapabilitiesSource = fs.readFileSync(ROLE_CAPABILITIES, "utf8");

  assert(
    source.includes("await getServerSession();") &&
      source.includes("const canViewPricingCoverage = canEditWorkspace(actorRole);"),
    "Completeness page must derive shared auth/session context and pricing visibility from the server helpers.",
  );
  assert(
    source.includes('type SharedReadState = "available" | "restricted" | "unavailable";') &&
      source.includes('type PricingDisplayState = SharedReadState | "not_configured";') &&
      source.includes("async function loadSharedRead<T>(promise: Promise<T>): Promise<SharedReadResult<T>>") &&
      source.includes("const [healthResult, statsResult, pricingCoverageResult] = await Promise.all([") &&
      source.includes("loadSharedRead(getDashboardHealth({ role: actorRole, authHeader }))") &&
      source.includes("loadSharedRead(getStats({ role: actorRole, authHeader }))") &&
      source.includes("loadSharedRead(getPricingCoverage({ role: actorRole, authHeader }))"),
    "Completeness page must load quality health, catalog stats, and pricing coverage through explicit shared-read wrappers.",
  );
  assert(
    roleCapabilitiesSource.includes('return role === "admin" || role === "editor";') &&
      source.includes('Promise.resolve({ state: "restricted" } as const)'),
    "Completeness page must redact pricing coverage for roles without editor/admin access instead of faking an empty configuration.",
  );
  assert(
    source.includes("Some completeness data is temporarily unavailable") &&
      source.includes("Some completeness data is restricted") &&
      source.includes("Catalog totals are limited for your role.") &&
      source.includes("Completeness score is temporarily unavailable.") &&
      source.includes("Pricing coverage is limited for your role.") &&
      source.includes("Pricing coverage is temporarily unavailable.") &&
      source.includes("No active price lists configured."),
    "Completeness page must distinguish restricted, unavailable, and not-configured states across catalog and pricing reads.",
  );
  assert(
    source.includes('label="Total Products"') &&
      source.includes('label="Complete Products"') &&
      source.includes('label="Incomplete Products"') &&
      source.includes('label="Completeness %"') &&
      source.includes('href="/quality/issues"') &&
      source.includes('href="/quality/validation"') &&
      source.includes('href="/settings/pricing"'),
    "Completeness page must preserve the core KPI and follow-up navigation contract.",
  );
  assert(
    source.includes('if (error instanceof ApiHttpError && error.status === 401)') &&
      source.includes('redirect(buildLoginRedirect("/quality/completeness", error));'),
    "Completeness page must redirect only expired sessions while preserving restricted shared-read states in-page.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "quality_completeness_route_uses_shared_server_auth_context_and_role_gated_pricing_visibility",
          "quality_completeness_route_fetches_health_stats_and_pricing_with_explicit_shared_read_states",
          "quality_completeness_route_redacts_pricing_for_read_only_roles",
          "quality_completeness_route_distinguishes_restricted_unavailable_and_not_configured_truth",
          "quality_completeness_route_preserves_core_completeness_kpis_and_drilldowns",
          "quality_completeness_route_redirects_only_expired_sessions",
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
  console.error("Quality completeness route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
