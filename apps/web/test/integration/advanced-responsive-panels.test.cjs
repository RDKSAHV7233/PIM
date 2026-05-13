#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const VERSION_MANAGER = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "version-manager.tsx");
const VALIDATION_PANEL = path.join(REPO_ROOT, "apps", "web", "src", "components", "ui", "validation-issue-panel.tsx");
const BULK_EDIT_DIFF = path.join(REPO_ROOT, "apps", "web", "src", "components", "bulk-edit", "bulk-edit-diff-preview.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const versionSource = fs.readFileSync(VERSION_MANAGER, "utf8");
  const validationSource = fs.readFileSync(VALIDATION_PANEL, "utf8");
  const bulkEditSource = fs.readFileSync(BULK_EDIT_DIFF, "utf8");

  assert(
    versionSource.includes("md:hidden") &&
      versionSource.includes("mobileHide: true") &&
      versionSource.includes("presentLifecycleState(version.lifecycleState)") &&
      versionSource.includes("presentCompatibilityState(version.compatibilityState)") &&
      versionSource.includes("no version action depends on horizontal scroll"),
    "Version manager must surface lifecycle and compatibility state inside the mobile summary while hiding redundant desktop-only columns on small screens.",
  );
  assert(
    validationSource.includes("mobileHide: true") &&
      validationSource.includes("`${issue.fieldPath}: ${issue.message}`") &&
      validationSource.includes("Tap the message to jump to the affected field."),
    "Validation issue panel must fold field context into the mobile message action so the field column can be safely hidden on smaller screens.",
  );
  assert(
    bulkEditSource.includes("Mobile and tablet views keep the changed values stacked") &&
      bulkEditSource.includes("overflow-y-auto overflow-x-hidden") &&
      bulkEditSource.includes("Review the full preview list in a stacked mobile-safe layout"),
    "Bulk edit diff preview must use stacked mobile-safe copy and bounded vertical scrolling instead of relying on horizontal overflow for preview review.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "version_manager_mobile_summary_surfaces_key_status",
          "validation_issue_panel_mobile_message_preserves_field_context",
          "bulk_edit_diff_preview_uses_mobile_safe_stacked_layout",
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
  console.error("Advanced responsive panels test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
