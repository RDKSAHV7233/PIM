#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const connectorsPage = read("apps/web/src/app/connectors/page.tsx");
  const connectorsSetupPage = read("apps/web/src/app/connectors/setup/page.tsx");
  const approvalsPage = read("apps/web/src/app/quality/approvals/page.tsx");
  const categoriesPage = read("apps/web/src/app/catalog/categories/page.tsx");
  const categoryDeleteButton = read("apps/web/src/components/catalog/category-delete-button.tsx");
  const channelsTab = read("apps/web/src/app/products/[id]/_components/channels-tab.tsx");
  const versionManager = read("apps/web/src/components/channel/version-manager.tsx");
  const connectorPermissionForm = read("apps/web/src/components/settings/connector-permission-form.tsx");
  const button = read("apps/web/src/components/ui/button.tsx");

  assert(
    button.includes("disabled:cursor-not-allowed disabled:opacity-60"),
    "Button component must expose disabled styling for pending actions",
  );

  assert(
    connectorsSetupPage.includes("Installing connector...") &&
      connectorsPage.includes('pendingLabel="Reconnecting..."') &&
      connectorsPage.includes('pendingLabel="Disabling..."') &&
      connectorsPage.includes('pendingLabel="Deleting record..."'),
    "connector setup and operations surfaces must add pending feedback to install/reconnect/disable/delete actions",
  );

  assert(
    approvalsPage.includes('pendingLabel="Approving..."') &&
      approvalsPage.includes('pendingLabel="Rejecting..."'),
    "quality approvals page must add pending feedback to decision actions",
  );

  assert(
    categoriesPage.includes('pendingLabel="Creating category..."') &&
      categoryDeleteButton.includes('pendingLabel="Deleting..."'),
    "catalog categories page must add pending feedback to create/delete actions",
  );

  assert(
    channelsTab.includes('pendingLabel="Queueing export..."') &&
      channelsTab.includes('pendingLabel="Running simulator..."') &&
      channelsTab.includes('pendingLabel="Saving template..."') &&
      channelsTab.includes('pendingLabel="Processing..."') &&
      channelsTab.includes('pendingLabel="Requeueing..."'),
    "product channels tab must add pending feedback to export, simulator, template, process, and requeue actions",
  );

  assert(
    versionManager.includes('pendingLabel="Validating..."') &&
      versionManager.includes('pendingLabel="Publishing..."') &&
      versionManager.includes('pendingLabel="Archiving..."') &&
      versionManager.includes('pendingLabel="Rolling back..."'),
    "version manager must add pending feedback to mapping lifecycle actions",
  );

  assert(
    connectorPermissionForm.includes('pendingLabel="Saving policy..."'),
    "connector permission form must add pending feedback to grant action",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "button_disabled_styles_present",
          "connectors_actions_use_pending_feedback",
          "approval_decisions_use_pending_feedback",
          "catalog_category_actions_use_pending_feedback",
          "channel_actions_use_pending_feedback",
          "mapping_manager_actions_use_pending_feedback",
          "connector_permission_form_uses_pending_feedback",
        ],
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("pending-feedback-rollout-ui integration test failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
