#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "channels", "mappings", "page.tsx");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function run() {
  const page = read(PAGE);

  assert(
    page.includes("await getServerSession()") &&
      page.includes("canManageChannels(actorRole)") &&
      page.includes('redirect(buildLoginRedirect("/channels/mappings"'),
    "Mapping workbench must derive shared server auth context, check channel-management capability, and redirect expired sessions.",
  );

  assert(
    page.includes("evaluateConnectorPublishReadiness") &&
      page.includes("PublishReadinessCard") &&
      page.includes("preflight") &&
      page.includes("readiness"),
    "Mapping workbench must evaluate publish readiness via the canonical API and surface blockers in PublishReadinessCard.",
  );

  assert(
    page.includes("MappingStepUpAlert") &&
      page.includes("stepUpAction") &&
      page.includes("stepUpError"),
    "Mapping workbench must gate high-risk actions behind step-up auth and surface the step-up message inline.",
  );

  assert(
    page.includes("WorkflowStepper") &&
      page.includes("MappingEditorCard") &&
      page.includes("VersionManagerCard") &&
      page.includes("parseMappingWizardState") &&
      page.includes("buildMappingRoute"),
    "Mapping workbench must present the 3-step workflow stepper with editor/version-manager cards and normalized wizard routing.",
  );

  assert(
    page.includes("connectorHealthTone") &&
      page.includes("connectorHealthLabel") &&
      page.includes("connectorHealthHref"),
    "Mapping workbench must derive connector health from installation status rather than assuming a healthy state.",
  );

  assert(
    page.includes("selectedInstallationId") &&
      page.includes("getInstalledConnectors") &&
      page.includes("installationId"),
    "Mapping workbench must scope readiness evaluation to the selected connector installation.",
  );

  assert(
    page.includes("productWarning") &&
      page.includes("error.status === 401 || error.status === 403") &&
      page.includes("The wizard will continue without product-specific sample values."),
    "Mapping workbench must degrade optional product context errors without taking down the wizard, while still rethrowing auth failures.",
  );

  assert(
    page.includes("fallbackAcknowledged") &&
      page.includes("fallbackAckVersionId") &&
      page.includes("fallbackPolicyDefault"),
    "Mapping workbench must carry fallback acknowledgement state through the publish readiness and editor flows.",
  );

  assert(
    page.includes("!requestedInstallationId && matchingInstallations.length === 1"),
    "The sole-matching-installation auto-select must only fire when no installationId was explicitly requested -- " +
      "an explicit-but-invalid installationId must never be silently swapped for a different installation " +
      "(regression: previously any single match was auto-selected even when the requested id didn't match it).",
  );

  assert(
    page.includes("invalidInstallationAlert") &&
      /<MappingStepUpAlert\s+message=\{invalidInstallationAlert\}\s*\/>/.test(page) &&
      /currentStep === "scope"[\s\S]{0,80}invalidInstallationAlert/.test(page) === false,
    "The 'connector account no longer valid' warning must render on every wizard step (via a top-level alert), " +
      "not only be wired into the scope-step filter card " +
      "(regression: an invalid installationId on Map/Review previously showed no warning at all).",
  );

  assert(
    /const connectorAccountLabel = selectedInstallation[\s\S]{0,260}invalidInstallation/.test(page) &&
      /const connectorAccountDetail = selectedInstallation[\s\S]{0,300}invalidInstallation/.test(page),
    "The Current Scope 'Connector account' label and detail text must branch on invalidInstallation with distinct, " +
      "accurate copy for the invalid-request case, not silently fall through to installation-count-only logic " +
      "(regression: the scope pill kept showing the real installation, or falsely claimed none was installed, " +
      "while the invalid-installation warning banner said otherwise).",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "mappings_route_uses_shared_server_auth_context",
          "mappings_route_gates_publish_on_canonical_readiness",
          "mappings_route_requires_step_up_for_high_risk_actions",
          "mappings_route_renders_3_step_workflow",
          "mappings_route_derives_connector_health_from_installation",
          "mappings_route_scopes_readiness_to_selected_installation",
          "mappings_route_carries_fallback_acknowledgement_state",
          "mappings_route_does_not_auto_select_on_invalid_installation_id",
          "mappings_route_surfaces_invalid_installation_warning_on_every_step",
          "mappings_route_scope_pill_copy_is_accurate_for_invalid_installation",
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
  console.error("Channels mappings route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
