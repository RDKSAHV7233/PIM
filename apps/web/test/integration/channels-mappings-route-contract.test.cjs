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
