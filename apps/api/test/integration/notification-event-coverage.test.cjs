#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const EVENT_TYPES = path.join(REPO_ROOT, "apps", "api", "src", "notifications", "notification-event.types.ts");
const SERVICE = path.join(REPO_ROOT, "apps", "api", "src", "notifications", "notifications.service.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const eventSource = fs.readFileSync(EVENT_TYPES, "utf8");
  const serviceSource = fs.readFileSync(SERVICE, "utf8");

  const requiredEvents = [
    "connector_down",
    "connector_credentials_expired",
    "scheduled_export_failed",
    "import_repair_required",
    "readiness_blocker_detected",
    "mapping_validation_failed",
    "queue_dlq_threshold_exceeded",
  ];
  for (const eventType of requiredEvents) {
    assert(eventSource.includes(`"${eventType}"`), `Notification event type '${eventType}' must be registered.`);
  }
  assert(
    serviceSource.includes("async emitConnectorDown(") &&
      serviceSource.includes("async emitConnectorCredentialsExpired(") &&
      serviceSource.includes("async emitScheduledExportFailed(") &&
      serviceSource.includes("async emitReadinessBlockerDetected(") &&
      serviceSource.includes("async emitMappingValidationFailed(") &&
      serviceSource.includes("async emitQueueDlqThresholdExceeded("),
    "Notifications service must expose emitters for connector, readiness, mapping, scheduled-export, and DLQ alerts.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "notification_event_catalog_expanded",
          "notifications_service_exposes_operational_alert_emitters",
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
  console.error("Notification event coverage test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
