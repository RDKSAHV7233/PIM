#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DIALOG_FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "ui", "app-dialog.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(DIALOG_FILE, "utf8");

  assert(
    source.includes("previousFocusRef") &&
      source.includes("document.activeElement instanceof HTMLElement") &&
      source.includes("previousFocusRef.current?.focus();"),
    "AppDialog must preserve and restore focus when it closes.",
  );
  assert(
    source.includes("dialog.showModal()") &&
      source.includes("focusFirstElement(dialog);"),
    "AppDialog must use the native dialog element and land focus inside it on open.",
  );
  assert(
    source.includes("aria-labelledby={titleId}") &&
      source.includes("aria-describedby={description ? descriptionId : undefined}") &&
      source.includes("tabIndex={-1}"),
    "AppDialog must expose title/description semantics and a predictable focus target.",
  );
  assert(
    source.includes("onCancel={(e) => {") &&
      source.includes("e.preventDefault();") &&
      source.includes("onClose();"),
    "AppDialog must route native Escape/cancel behavior through the shared close handler.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "app_dialog_restores_focus",
          "app_dialog_uses_native_modal_focus_landing",
          "app_dialog_exposes_aria_labelling",
          "app_dialog_routes_native_cancel_to_onClose",
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
  console.error("App dialog focus-return test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
