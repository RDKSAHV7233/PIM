#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const WEBHOOKS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "webhooks", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(WEBHOOKS_PAGE, "utf8");
  assert(
    source.includes('delivery.errorMessage ? ` - ${delivery.errorMessage}` : ""'),
    "Webhook deliveries table must join response status and error message with a plain ASCII separator.",
  );
  assert(
    !source.includes("Â·"),
    "Webhook deliveries UI must not contain mojibake separators.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "webhook_deliveries_use_ascii_error_separator",
          "webhook_deliveries_avoid_mojibake_copy",
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
  console.error("Webhook deliveries copy UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
