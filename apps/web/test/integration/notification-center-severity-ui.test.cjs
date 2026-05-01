#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CENTER = path.join(REPO_ROOT, "apps", "web", "src", "components", "nav", "notification-center.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(CENTER, "utf8");

  assert(
    source.includes("function eventSeverity(") &&
      source.includes("connector_down") &&
      source.includes("queue_dlq_threshold_exceeded"),
    "Notification center must map new operational event types into severity handling.",
  );
  assert(
    source.includes("severityClasses(severity, item.readAt)") &&
      source.includes("{severity}") &&
      source.includes("connector, mapping, and approval updates will appear here"),
    "Notification center must expose severity styling and broaden empty-state messaging for the new alert classes.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "notification_center_maps_operational_event_severity",
          "notification_center_surfaces_severity_labels_and_empty_state_copy",
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
  console.error("Notification center severity UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
