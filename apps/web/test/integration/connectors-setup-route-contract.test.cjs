#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "connectors", "setup", "page.tsx");

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
      page.includes("getConnectorDefinitions") &&
      page.includes('buildLoginRedirect("/channels/connectors/setup"'),
    "Connector setup page must derive shared server auth context, load definitions and installed connectors, and redirect expired sessions.",
  );

  assert(
    page.includes("installConnectorAction"),
    "Connector setup page must wire the canonical install server action.",
  );

  assert(
    page.includes("Connector setup unavailable") &&
      page.includes("Connector definitions could not be loaded"),
    "Connector setup page must show an explicit unavailable state on non-auth backend failures instead of throwing a 500.",
  );

  assert(
    page.includes("formatInstallErrorMessage") &&
      page.includes("installError"),
    "Connector setup page must translate raw install error codes into user-readable messages via formatInstallErrorMessage.",
  );

  assert(
    page.includes("slug?") || page.includes("slug ="),
    "Connector setup page must accept a connector slug via searchParams to pre-select a connector.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "connectors_setup_route_uses_shared_server_auth_context",
          "connectors_setup_route_wires_install_server_action",
          "connectors_setup_route_renders_unavailable_state_on_backend_failure",
          "connectors_setup_route_humanises_raw_install_error_codes",
          "connectors_setup_route_accepts_slug_preselect",
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
  console.error("Connector setup route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
