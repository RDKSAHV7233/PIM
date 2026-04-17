#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PRIVACY_CLIENT = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "components",
  "settings",
  "data-privacy-page-client.tsx",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PRIVACY_CLIENT, "utf8");

  assert(
    source.includes("commercialState") &&
      source.includes('status?.commercialState?.accessStatus === "suspended"') &&
      source.includes("Workspace access is suspended."),
    "Privacy page must surface suspended commercial state with a dedicated banner.",
  );
  assert(
    source.includes("Manage the signed-in account&apos;s privacy status and deletion workflow.") &&
      source.includes("This page applies only to your signed-in account.") &&
      source.includes("Current account privacy status") &&
      source.includes("Delete this account"),
    "Privacy page must be honest that these controls apply to the signed-in account, not the whole workspace.",
  );
  assert(
    source.includes('payload.error === "TENANT_SUSPENDED"') &&
      source.includes("New export requests are paused while the workspace is suspended."),
    "Privacy page must translate suspended export 403 responses into suspension-specific guidance.",
  );
  assert(
    source.includes("const exportBlockedBySuspension = status?.commercialState?.accessStatus === \"suspended\";") &&
      source.includes("disabled={working !== null || exportBlockedBySuspension}") &&
      source.includes("Export requests paused during suspension"),
    "Privacy page must disable new export requests while the workspace is suspended.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "privacy_page_reads_commercial_state",
          "privacy_page_scopes_controls_to_signed_in_account",
          "privacy_page_shows_suspension_banner",
          "privacy_page_handles_tenant_suspended_export_errors",
          "privacy_page_disables_export_requests_while_suspended",
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
  console.error("Admin privacy UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
