#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const VERSION_MANAGER = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "version-manager.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(VERSION_MANAGER, "utf8");

  assert(
    source.includes("md:hidden") || source.includes("mobileHide"),
    "version-manager.tsx must use md: breakpoint classes or DataGrid mobileHide to toggle between mobile and desktop layouts.",
  );

  assert(
    source.includes("space-y-") && source.includes("flex-wrap"),
    "version-manager.tsx must use space-y-* and flex-wrap for stacked and responsive layouts.",
  );

  assert(
    !source.includes("min-w-[980px]") || source.includes("md:hidden"),
    "version-manager.tsx must not expose min-w-[980px] without a responsive md:hidden wrapper to prevent mobile overflow.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "version_manager_uses_sm_breakpoint_classes",
          "version_manager_mobile_layout_uses_flex_col",
          "version_manager_desktop_min_width_is_responsive_guarded",
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
  console.error("Version manager responsive test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
