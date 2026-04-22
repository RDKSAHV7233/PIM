#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "connectors", "page.tsx");
const FORM = path.join(REPO_ROOT, "apps", "web", "src", "components", "settings", "connector-permission-form.tsx");
const ACTIONS = path.join(REPO_ROOT, "apps", "web", "src", "app", "actions.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const pageSource = fs.readFileSync(PAGE, "utf8");
  const formSource = fs.readFileSync(FORM, "utf8");
  const actionsSource = fs.readFileSync(ACTIONS, "utf8");

  assert(
    pageSource.includes("ConnectorPermissionForm") &&
      pageSource.includes("Create one access policy row per role or user") &&
      pageSource.includes("Review who gets access, which aliases are covered") &&
      pageSource.includes("permission-user-not-found"),
    "Connector Access page must explain the one-row-per-principal model and surface user-not-found grant errors.",
  );
  assert(
    formSource.includes('const ROLE_OPTIONS: readonly AppRole[] = ["admin", "editor", "reviewer", "viewer"]') &&
      formSource.includes("Policy sentence") &&
      formSource.includes("Leave blank to apply this policy to all aliases") &&
      formSource.includes("Use role rules for broad access, and reserve user-specific rules for named exceptions") &&
      formSource.includes("Grant access to one specific user in this workspace so the exception stays explicit and auditable."),
    "Connector Access form must provide explicit role options, wildcard alias guidance, and user-scoped helper copy.",
  );
  assert(
    actionsSource.includes("CONNECTOR_PERMISSION_ROLE_IDS") &&
      actionsSource.includes("resolveConnectorPermissionGrantStatus") &&
      actionsSource.includes("permission-invalid-role") &&
      actionsSource.includes("permission-user-not-found"),
    "Connector permission actions must validate role identifiers and redirect grant failures into admin-friendly status banners.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "connector_access_form_exposes_role_dropdown_and_helper_copy",
          "connector_access_page_surfaces_targeted_grant_failure_banners",
          "grant_action_maps_invalid_role_and_missing_user_errors",
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
  console.error("Connector access admin form test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
