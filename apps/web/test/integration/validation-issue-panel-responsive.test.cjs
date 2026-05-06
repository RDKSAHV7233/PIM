#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const VALIDATION_PANEL = path.join(REPO_ROOT, "apps", "web", "src", "components", "ui", "validation-issue-panel.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(VALIDATION_PANEL, "utf8");

  assert(
    source.includes("sm:hidden") || source.includes("sm:block"),
    "validation-issue-panel.tsx must use sm: breakpoint classes to toggle between mobile and desktop layouts.",
  );

  assert(
    source.includes("w-full") && source.includes("max-w-full"),
    "validation-issue-panel.tsx must use w-full and max-w-full to prevent horizontal overflow on small screens.",
  );

  assert(
    !source.includes("min-w-[760px]") || source.includes("sm:block") || source.includes("hidden sm:block"),
    "validation-issue-panel.tsx must guard any min-w- constraint at sm breakpoint to avoid mobile overflow.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "validation_panel_uses_sm_breakpoint_classes",
          "validation_panel_uses_w_full_max_w_full",
          "validation_panel_min_width_is_responsive_guarded",
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
  console.error("Validation issue panel responsive test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
