#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const REPO_ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function requireStep(steps, name) {
  const step = steps.find((item) => String(item?.name ?? "").trim() === name);
  assert(step, `Missing workflow step: ${name}`);
  return step;
}

function requireStepOrder(steps, firstName, secondName) {
  const firstIndex = steps.findIndex((item) => String(item?.name ?? "").trim() === firstName);
  const secondIndex = steps.findIndex((item) => String(item?.name ?? "").trim() === secondName);
  assert(firstIndex !== -1, `Missing workflow step: ${firstName}`);
  assert(secondIndex !== -1, `Missing workflow step: ${secondName}`);
  assert(firstIndex < secondIndex, `${firstName} must appear before ${secondName}`);
}

function requireEnvVar(step, name, label) {
  assert(Object.prototype.hasOwnProperty.call(step?.env ?? {}, name), `${label} missing env var ${name}`);
}

function requireRunContains(step, fragment, label) {
  assert(String(step?.run ?? "").includes(fragment), `${label} missing run fragment: ${fragment}`);
}

function main() {
  const workflow = YAML.parse(read(".github/workflows/deploy-staging.yml"));
  const steps = workflow.jobs["deploy-staging"].steps;
  const script = read("scripts/staging-internal-ops-summary-acceptance.cjs");
  const ci = read(".github/workflows/ci.yml");

  const acceptance = requireStep(steps, "Internal Ops Summary staging acceptance");
  requireEnvVar(acceptance, "STAGING_BASE_URL", "Internal Ops Summary staging acceptance");
  requireEnvVar(acceptance, "STAGING_WEB_URL", "Internal Ops Summary staging acceptance");
  requireEnvVar(acceptance, "STAGING_SMOKE_WORKSPACE", "Internal Ops Summary staging acceptance");
  requireEnvVar(acceptance, "STAGING_SMOKE_USER", "Internal Ops Summary staging acceptance");
  requireEnvVar(acceptance, "STAGING_SMOKE_PASSWORD", "Internal Ops Summary staging acceptance");
  requireEnvVar(acceptance, "OPS_SUMMARY_ACCEPTANCE_OUTPUT", "Internal Ops Summary staging acceptance");
  requireRunContains(acceptance, "node scripts/staging-internal-ops-summary-acceptance.cjs", "Internal Ops Summary staging acceptance");
  requireStepOrder(steps, "Staging post-deploy verification (auth + trust boundary)", "Internal Ops Summary staging acceptance");
  requireStepOrder(steps, "Internal Ops Summary staging acceptance", "Internal Ops Errors staging acceptance");

  const upload = requireStep(steps, "Upload gate + rollout + smoke artifacts");
  assert(
    String(upload.with?.path ?? "").includes(".run-logs/internal-ops-summary-acceptance-*.json"),
    "Upload artifacts step must include internal ops summary acceptance evidence.",
  );

  assert(script.includes("/api/v1/internal/ops/summary"), "Acceptance script must verify the summary API endpoint.");
  assert(script.includes("/internal/ops"), "Acceptance script must verify the Web console route.");
  assert(script.includes("createTemporaryViewer"), "Acceptance script must verify viewer denial with a real temporary viewer.");
  assert(script.includes("viewer_summary_api_denied"), "Acceptance script must record viewer API denial.");
  assert(script.includes("viewer_web_internal_ops_denied_no_leakage"), "Acceptance script must record viewer Web denial without leakage.");
  assert(script.includes("unauthenticated_summary_api_denied"), "Acceptance script must record unauthenticated API denial.");
  assert(script.includes("findProhibitedKeys"), "Acceptance script must inspect summary payload for prohibited keys.");
  assert(script.includes("findProhibitedText"), "Acceptance script must inspect rendered page for prohibited text.");
  assert(script.includes("assertReadinessShape"), "Acceptance script must explicitly validate readiness shape.");
  assert(script.includes("assertMediaIntegrityLatestRun"), "Acceptance script must validate latest media integrity scan shape.");
  assert(script.includes("mediaIntegrity.latestRun"), "Acceptance script must require latest media integrity scan field.");
  for (const metric of ["missing", "invalidPath", "unverifiable", "storageErrors", "affectedTenantCount", "activeProductImpactCount"]) {
    assert(script.includes(metric), `Acceptance script must validate media integrity scan metric ${metric}.`);
  }
  assert(script.includes("READINESS_AVAILABILITY"), "Acceptance script must validate readiness aggregate availability.");
  assert(script.includes("assertIsoDate(readiness.asOf"), "Acceptance script must validate readiness.asOf.");
  assert(script.includes("readiness.productData"), "Acceptance script must validate readiness productData source.");
  assert(script.includes("readiness.mapping"), "Acceptance script must validate readiness mapping source.");
  assert(script.includes("readiness.connector"), "Acceptance script must validate readiness connector source.");
  assert(script.includes("readiness_backend_contract_present"), "Acceptance script must record readiness runtime evidence.");
  for (const metric of [
    "blockedProducts",
    "blockingIssues",
    "warningIssues",
    "affectedTenants",
    "topRuleFamilies",
    "blockingMappings",
    "warningMappings",
    "compatibilityBlocked",
    "remapRequired",
    "fallbackAckRequired",
    "deprecated",
    "blockingInstallations",
    "warningInstallations",
    "byStatus",
  ]) {
    assert(script.includes(metric), `Acceptance script must validate readiness metric ${metric}.`);
  }
  for (const ruleFamily of [
    "GST_HSN_REQUIRED",
    "GST_HSN_FORMAT",
    "GST_RATE_REQUIRED",
    "GST_RATE_UNCOMMON",
    "PRICING_NO_DEFAULT_PRICES",
    "PRICING_INCOMPLETE",
    "ATTR_REQUIRED_*",
    "ATTR_TYPE_*",
    "ATTR_ALLOWED_*",
    "CUSTOM_RULE",
  ]) {
    assert(script.includes(ruleFamily), `Acceptance script must allowlist readiness rule family ${ruleFamily}.`);
  }
  assert(script.includes("RULE_FAMILY_LIMIT = 10"), "Acceptance script must bound readiness top rule families.");
  assert(script.includes("assertRuleFamilies"), "Acceptance script must validate rule-family safety.");
  assert(script.includes("raw custom rule code"), "Acceptance script must reject raw custom rule-code leakage.");
  for (const mapping of [
    'ACTIVE: "STATUS"',
    'PAUSED: "WARNING"',
    'CREDENTIAL_EXPIRED: "BLOCKER"',
    'DISABLED: "STATUS"',
  ]) {
    assert(script.includes(mapping), `Acceptance script must validate connector status impact mapping ${mapping}.`);
  }
  for (const card of ["jobs", "imports", "publishing", "connectors", "errors", "mediaIntegrity"]) {
    assert(script.includes(`"${card}"`), `Acceptance script must validate ${card} card.`);
  }
  for (const label of ["Jobs", "Imports", "Publishing", "Connectors", "Readiness Health", "Errors", "Media Integrity"]) {
    assert(script.includes(`"${label}"`), `Acceptance script must validate ${label} rendered card.`);
  }
  assert(!script.includes("ERROR_AUTHORITY_INGEST_TOKEN"), "Summary acceptance must not require Error Authority ingest token.");
  assert(!script.includes("OBSERVABILITY_DATABASE_URL"), "Summary acceptance must not receive or print observability DB URL.");
  assert(!script.includes("DATABASE_URL"), "Summary acceptance must not receive or print database URLs.");
  for (const prohibited of [
    '"mappingRules"',
    '"metadata"',
    '"tenantKey"',
    '"tenantName"',
    '"customerName"',
    '"requestBody"',
    '"responseBody"',
    '"payload"',
    '"headers"',
    '"cookies"',
    '"token"',
    '"credential"',
  ]) {
    assert(script.includes(prohibited), `Acceptance script prohibited-key inspection must include ${prohibited}.`);
  }

  assert(
    ci.includes("node scripts/staging-internal-ops-summary-acceptance.test.cjs"),
    "CI DevOps contract tests must include Internal Ops Summary acceptance contract.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "summary_acceptance_runs_after_postdeploy",
          "summary_acceptance_runs_before_errors_regression",
          "summary_acceptance_uses_staging_api_and_web_urls",
          "summary_acceptance_uses_existing_smoke_auth",
          "summary_acceptance_checks_admin_api_and_web",
          "summary_acceptance_checks_viewer_and_unauth_denial",
          "summary_acceptance_checks_readiness_ui_card",
          "summary_acceptance_checks_readiness_backend_contract",
          "summary_acceptance_checks_readiness_safe_rule_families",
          "summary_acceptance_checks_readiness_connector_status_impacts",
          "summary_acceptance_checks_safe_fields",
          "summary_acceptance_artifact_uploaded",
          "summary_acceptance_does_not_use_db_or_ingest_secrets",
        ],
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error("Internal Ops Summary staging acceptance contract failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
