#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const BULK_EDIT_DIFF = path.join(REPO_ROOT, "apps", "web", "src", "components", "bulk-edit", "bulk-edit-diff-preview.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(BULK_EDIT_DIFF, "utf8");

  assert(
    source.includes("sm:hidden") || source.includes("sm:block"),
    "bulk-edit-diff-preview.tsx must use sm: breakpoint classes to toggle between mobile and desktop layouts.",
  );

  assert(
    source.includes("flex-col") && source.includes("space-y-"),
    "bulk-edit-diff-preview.tsx must use flex-col and space-y-* for the mobile stacked card layout.",
  );

  assert(
    !source.includes("min-w-[900px]") || source.includes("sm:block") || source.includes("hidden sm:block"),
    "bulk-edit-diff-preview.tsx must guard the min-w-[900px] constraint at sm breakpoint to avoid mobile overflow.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "bulk_edit_diff_uses_sm_breakpoint_classes",
          "bulk_edit_diff_mobile_layout_uses_flex_col",
          "bulk_edit_diff_min_width_is_responsive_guarded",
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
  console.error("Bulk edit diff preview responsive test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
