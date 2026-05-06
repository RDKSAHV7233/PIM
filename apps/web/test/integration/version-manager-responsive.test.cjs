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
    source.includes("sm:hidden") || source.includes("sm:block"),
    "version-manager.tsx must use sm: breakpoint classes to toggle between mobile and desktop layouts.",
  );

  assert(
    source.includes("flex-col") && source.includes("space-y-"),
    "version-manager.tsx must use flex-col and space-y-* for the mobile stacked layout.",
  );

  assert(
    !source.includes("min-w-[980px]") || source.includes("sm:block"),
    "version-manager.tsx must not expose min-w-[980px] without a responsive sm:block wrapper to prevent mobile overflow.",
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
