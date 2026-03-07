#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ACTIONS_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "actions.ts");
const API_FILE = path.join(REPO_ROOT, "apps", "web", "src", "lib", "api.ts");
const MAPPINGS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "channels", "mappings", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const actionsSource = fs.readFileSync(ACTIONS_FILE, "utf8");
  const apiSource = fs.readFileSync(API_FILE, "utf8");
  const mappingsSource = fs.readFileSync(MAPPINGS_PAGE, "utf8");

  assert(
    actionsSource.includes('scope: STEP_UP_SCOPE_MAPPING_HIGH_RISK'),
    "Mapping actions must request step-up re-authentication before protected actions.",
  );
  assert(
    actionsSource.includes("STEP_UP_TOKEN_HEADER") &&
      actionsSource.includes('withStepUpErrorQuery(redirectTo, "publish"') &&
      actionsSource.includes('withStepUpErrorQuery(redirectTo, "archive"') &&
      actionsSource.includes('withStepUpErrorQuery(redirectTo, "rollback"'),
    "Mapping actions must propagate step-up token headers and handle step-up errors for publish/archive/rollback.",
  );
  assert(
    apiSource.includes("headers?: Record<string, string>;") &&
      actionsSource.includes('const STEP_UP_TOKEN_HEADER = "x-pim-step-up-token";'),
    "Web API client must support protected action headers and mapping actions must define x-pim-step-up-token.",
  );
  assert(
    mappingsSource.includes("Step-up re-authentication") &&
      mappingsSource.includes("rollbackConnectorMappingVersionAction") &&
      mappingsSource.includes("Rollback restores this prior published mapping as a new published version."),
    "Mappings page must expose step-up re-authentication UX for publish/archive/rollback flows.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "mapping_actions_request_step_up_reauth",
          "mapping_actions_send_step_up_header",
          "mappings_page_surfaces_step_up_ui_for_publish_archive_rollback",
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
  console.error("Mapping step-up UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
