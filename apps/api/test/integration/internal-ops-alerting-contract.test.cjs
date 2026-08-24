#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const service = read("apps/api/src/internal-ops/internal-ops-alerts.service.ts");
  const errorCapture = read("apps/api/src/error-authority/error-capture.service.ts");
  const observabilityDb = read("apps/api/src/error-authority/observability-db.service.ts");
  const schema = read("packages/db/prisma/schema.prisma");
  const queueConstants = read("apps/api/src/queue/queue.constants.ts");

  assert(schema.includes("model OpsAlertState"), "OpsAlertState must be present.");
  assert(schema.includes("@@map(\"ops_alert_states\")"), "OpsAlertState must map to ops_alert_states.");
  assert(schema.includes("alertKey        String    @unique"), "OpsAlertState.alertKey must be unique.");
  assert(service.includes("ON CONFLICT (alert_key) DO NOTHING"), "Alert reservation must use persistent unique-key dedupe.");
  assert(service.includes("cooldown_until <= ${observedAt}"), "Stuck-job alerting must enforce cooldown in persistent state.");
  assert(service.includes("OPS_ALERT_WEBHOOK_URL"), "Alert delivery must use a dedicated internal ops webhook config.");
  assert(queueConstants.includes("INTERNAL_OPS_ALERT"), "Internal ops alert queue must be registered.");
  assert(service.includes("attempts: 3") === false, "Alert service must reuse QueueService bounded retry, not hand-roll attempts.");
  assert(errorCapture.includes("captureNewP0P1Issue"), "Error Authority capture must enqueue the narrow ops alert follow-up.");
  assert(errorCapture.includes("!result?.stored || !result.created"), "Error Authority alerts must only fire for newly-created issues.");
  assert(observabilityDb.includes("created: !existingIssue"), "Error Authority record result must expose new issue creation.");

  const forbiddenPayloadFragments = [
    "tenantKey:",
    "productId:",
    "productTitle",
    "connectorLabel",
    "credentials",
    "headers",
    "cookies",
    "requestBody",
    "responseBody",
    "stack",
  ];
  const envelopeType = service.slice(service.indexOf("export type InternalOpsAlertEnvelope"), service.indexOf("type OpsAlertQueuePayload"));
  for (const fragment of forbiddenPayloadFragments) {
    assert(!envelopeType.includes(fragment), `Alert envelope must not expose ${fragment}`);
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "persistent_dedupe_state",
          "stuck_cooldown_state",
          "dedicated_internal_destination",
          "queue_retry_reuse",
          "new_p0p1_issue_trigger_only",
          "safe_payload_allowlist",
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
  console.error("Internal ops alerting contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
