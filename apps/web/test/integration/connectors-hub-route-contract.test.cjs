#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "connectors", "page.tsx");

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
      page.includes('buildLoginRedirect("/channels/connectors"'),
    "Connectors hub must derive shared server auth context, load installed connectors and definitions, and redirect expired sessions.",
  );

  // NOTE: this previously checked page.includes("installConnectorAction"), which
  // isn't a real exported action anywhere in the codebase — it only ever passed
  // because that string is a substring of "uninstallConnectorAction". The real
  // install flow is initiateOAuthAction (see the import list above). Corrected
  // here rather than left silently green.
  assert(
    page.includes("initiateOAuthAction") &&
      page.includes("reconnectConnectorAction") &&
      page.includes("deleteConnectorInstallationAction"),
    "Connectors hub must wire the canonical install, reconnect, and delete server actions.",
  );

  // Disable pilot: native URL-form + POST/303 containment path, not a Server
  // Action — see apps/web/src/app/connector-operations/[installationId]/disable/route.ts
  // and the PR416 hydration-race investigation for why this one action differs
  // from the others above.
  assert(
    page.includes('method="post"') &&
      page.includes("/connector-operations/") &&
      page.includes('name="csrfToken"') &&
      !page.includes("uninstallConnectorAction"),
    "Connectors hub's Disable action must use the native-form POST/303 containment path, not a Server Action.",
  );

  assert(
    page.includes("Connectors unavailable") &&
      page.includes("Connector marketplace and installation data could not be loaded"),
    "Connectors hub must show an explicit unavailable state on non-auth backend failures instead of throwing a 500.",
  );

  assert(
    page.includes("isPlanBlockedReason") &&
      page.includes("PLAN_CONNECTOR_INSTALLATIONS_LIMIT_EXCEEDED") &&
      page.includes("PLAN_CONNECTOR_ACCOUNTS_LIMIT_EXCEEDED"),
    "Connectors hub must detect and surface plan limit violations on connector install actions.",
  );

  assert(
    page.includes("installationStatusTone") &&
      page.includes('"CREDENTIAL_EXPIRED"') &&
      page.includes('"ACTIVE"'),
    "Connectors hub must tone-code installation status (active, credential expired, paused) to make health state visually distinct.",
  );

  assert(
    page.includes("formatInstallErrorMessage") &&
      page.includes("FLIPKART_CREDENTIALS_INCOMPLETE") &&
      page.includes("WOOCOMMERCE_CREDENTIALS_INVALID"),
    "Connectors hub must translate raw install error codes into user-readable connector-specific messages.",
  );

  assert(
    page.includes("filterTestData") &&
      page.includes("getProductList"),
    "Connectors hub must filter test-mode products from the product list shown during connector setup.",
  );

  assert(
    page.includes("isInstallationAttentionStatus(installation.status)") &&
      page.includes("credentials may be expired") &&
      page.includes("Review recovery"),
    "Connectors hub must show a prominent recovery CTA on cards where credentials are expired or the connection has errors.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "connectors_hub_uses_shared_server_auth_context",
          "connectors_hub_wires_canonical_install_reconnect_delete_actions",
          "connectors_hub_disable_uses_native_post_303_containment_path",
          "connectors_hub_renders_unavailable_state_on_backend_failure",
          "connectors_hub_detects_plan_limit_violations",
          "connectors_hub_tone_codes_installation_health",
          "connectors_hub_humanises_raw_install_error_codes",
          "connectors_hub_filters_test_mode_products",
          "connectors_hub_shows_credential_expiry_recovery_cta",
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
  console.error("Connectors hub route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
