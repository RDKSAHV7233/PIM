#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "channels",
  "connectors",
  "[installationId]",
  "recovery",
  "page.tsx",
);

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
      page.includes("getInstalledConnectors") &&
      page.includes("getConnectorRecoveryGroups") &&
      page.includes("buildLoginRedirect"),
    "Recovery page must derive shared server auth context, load installations and recovery groups, and redirect expired sessions.",
  );

  assert(
    page.includes("notFound()"),
    "Recovery page must call notFound() when the installation is not found rather than rendering a broken UI.",
  );

  assert(
    page.includes("Recovery data unavailable") &&
      page.includes("Sync failure data could not be loaded"),
    "Recovery page must show an explicit unavailable state on non-auth backend failures instead of throwing a 500.",
  );

  assert(
    page.includes('"retry-queued"') &&
      page.includes('"retry-failed"') &&
      page.includes("Retry queued"),
    "Recovery page must surface retry-queued and retry-failed banner states from the action status query param.",
  );

  assert(
    page.includes("RecoveryRetryButton") &&
      page.includes("errorFamily") &&
      page.includes("affectedCount"),
    "Recovery page must render error groups with affected counts and a retry action per group.",
  );

  assert(
    page.includes("exampleMessage"),
    "Recovery page must show an example message per error family to help users diagnose the root cause.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "connector_recovery_route_uses_shared_server_auth_context",
          "connector_recovery_route_calls_not_found_for_unknown_installation",
          "connector_recovery_route_renders_unavailable_state_on_backend_failure",
          "connector_recovery_route_surfaces_retry_status_banners",
          "connector_recovery_route_renders_error_groups_with_retry_actions",
          "connector_recovery_route_shows_example_message_per_error_family",
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
  console.error("Connector recovery route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
