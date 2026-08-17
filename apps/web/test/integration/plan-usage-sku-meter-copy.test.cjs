#!/usr/bin/env node
/* eslint-disable no-console */
// PIM#579: the SKUs meter is correct (counts variants, matching plan-limit enforcement —
// see the corresponding apps/api test), but showed a bare "2 / 100,000" with no
// indication that it counts variants rather than the 21,493 products visible one page
// over. Pins the clarifying description so it can't be silently dropped.
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const USAGE_METERS = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "plan", "_components", "usage-meters.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(USAGE_METERS, "utf8");

  assert(
    source.includes("description?: string") && source.includes("{description ? <p"),
    "Meter component must support an optional description line for clarifying what a count actually measures.",
  );
  assert(
    /label="SKUs"[\s\S]{0,200}description="[^"]*variant/i.test(source),
    "The SKUs Meter must carry a description clarifying it counts variants, not product records — otherwise a low SKU count next to a large product catalog reads as a billing bug.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: ["sku_meter_clarifies_it_counts_variants"],
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
  console.error("Plan usage SKU meter copy test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
