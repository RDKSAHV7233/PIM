#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const MARKETPLACE_SERVICE = path.join(REPO_ROOT, "apps", "api", "src", "marketplace", "marketplace.service.ts");
// Single-channel GET proxy route — the only remaining home of the summarization logic on the web side.
// The shared channel-readiness.ts export was removed; this is where the private copy lives now.
const WEB_READINESS_ROUTE = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "api",
  "marketplace",
  "readiness",
  "route.ts",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function assertDedupedReadinessSummary(source, label) {
  assert(
    source.includes("const missingFieldKeys = new Set("),
    `${label} must normalize missing field keys before counting channel errors.`,
  );
  assert(
    source.includes('issue.code === "CHANNEL_REQUIRED_FIELD"') &&
      source.includes("missingFieldKeys.has(fieldPath)"),
    `${label} must exclude CHANNEL_REQUIRED_FIELD issues that duplicate missingFields entries.`,
  );
  assert(
    source.includes("simulation.missingFields.length + simulation.complianceSummary.errorCount + channelErrorCount"),
    `${label} must still include missing fields, compliance errors, and non-duplicate channel errors in the final total.`,
  );
}

function run() {
  assertDedupedReadinessSummary(read(MARKETPLACE_SERVICE), "Marketplace service readiness summary");
  // The web-side summarization logic lives in the single-channel GET proxy route (not channel-readiness.ts).
  // It must stay algorithmically identical to the API's summarizeReadiness() to avoid divergence.
  assertDedupedReadinessSummary(read(WEB_READINESS_ROUTE), "Web single-channel readiness route");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "marketplace_service_dedupes_required_field_channel_errors",
          "web_single_channel_route_dedupes_required_field_channel_errors",
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
  console.error("Marketplace readiness summary contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
