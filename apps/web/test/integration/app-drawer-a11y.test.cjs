#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DRAWER_FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "ui", "app-drawer.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(DRAWER_FILE, "utf8");

  assert(
    source.includes("previousFocusRef") &&
      source.includes("document.activeElement instanceof HTMLElement") &&
      source.includes("previousFocusRef.current?.focus();"),
    "AppDrawer must preserve and restore focus when the drawer opens and closes.",
  );
  assert(
    source.includes("getFocusableElements(drawerRef.current)") &&
      source.includes('if (event.key !== "Tab")') &&
      source.includes("first?.focus();") &&
      source.includes("last?.focus();"),
    "AppDrawer must trap keyboard focus while the drawer is open.",
  );
  assert(
    source.includes('if (event.key === "Escape")') &&
      source.includes("event.preventDefault();") &&
      source.includes("onClose();"),
    "AppDrawer must support Escape close behavior.",
  );
  assert(
    source.includes("focusFirstElement(drawerRef.current)") &&
      source.includes("closeButtonRef.current?.focus();"),
    "AppDrawer must land initial focus inside the drawer when it opens.",
  );
  assert(
    source.includes('role="dialog"') &&
      source.includes('aria-modal="true"') &&
      source.includes("aria-labelledby={titleId}"),
    "AppDrawer must expose dialog semantics with a stable accessible title.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "app_drawer_restores_focus",
          "app_drawer_traps_tab_navigation",
          "app_drawer_supports_escape_close",
          "app_drawer_lands_initial_focus",
          "app_drawer_exposes_dialog_labels",
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
  console.error("App drawer accessibility test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
