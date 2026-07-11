#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "operations", "bulk-edit", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PAGE, "utf8");

  // 1. Billing failure must NOT default to TRIAL — planTier must be null on error
  assert(
    source.includes("let planTier: string | null = null;"),
    "planTier must be typed as string | null, initialized to null.",
  );
  assert(
    source.includes("planTier = null;") &&
      !source.match(/catch\s*\{[^}]*planTier\s*=\s*["']TRIAL["']/),
    "Billing catch block must set planTier to null, never default to TRIAL.",
  );

  // 2. Null planTier must show an honest warning, not the upgrade gate
  assert(
    source.includes("if (planTier === null)") &&
      source.includes("Unable to verify your plan"),
    "When billing is unreachable (planTier === null), page must show an honest warning.",
  );
  assert(
    source.includes('tone="warning"') &&
      source.includes("billing service is temporarily unavailable"),
    "Billing failure warning must use warning tone and explain the service is temporarily unavailable.",
  );

  // 3. Upgrade gate must only trigger when billing CONFIRMED the tier
  const upgradeGateMatch = source.match(
    /if\s*\(\s*planTier\s*===\s*["']TRIAL["']\s*\|\|\s*planTier\s*===\s*["']STARTER["']\s*\)/,
  );
  assert(
    upgradeGateMatch,
    "Upgrade gate must check for TRIAL or STARTER tier.",
  );
  const nullCheckMatch = source.match(/if\s*\(\s*planTier\s*===\s*null\s*\)/);
  assert(
    nullCheckMatch,
    "Null planTier check must exist.",
  );
  const nullCheckPos = source.indexOf("planTier === null");
  const upgradeGatePos = source.indexOf('planTier === "TRIAL"');
  assert(
    nullCheckPos < upgradeGatePos,
    "Null planTier check must come BEFORE the upgrade gate to prevent billing failures from triggering the upgrade UI.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "billing_failure_does_not_default_to_trial",
          "billing_failure_shows_honest_warning",
          "upgrade_gate_only_on_confirmed_tier",
          "null_check_precedes_upgrade_gate",
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
  console.error("Bulk edit billing fallback test FAILED:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
