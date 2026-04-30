#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CHANNELS_TAB = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "products",
  "[id]",
  "_components",
  "channels-tab.tsx",
);
const DEFERRED_SECTION = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "products",
  "[id]",
  "_components",
  "product-detail-deferred-section.tsx",
);
const ACTIONS = path.join(REPO_ROOT, "apps", "web", "src", "app", "actions.ts");
const SUBMISSIONS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "channels", "submissions", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const channelsSource = fs.readFileSync(CHANNELS_TAB, "utf8");
  const deferredSource = fs.readFileSync(DEFERRED_SECTION, "utf8");
  const actionsSource = fs.readFileSync(ACTIONS, "utf8");
  const submissionsSource = fs.readFileSync(SUBMISSIONS_PAGE, "utf8");

  assert(
    deferredSource.includes("evaluateConnectorPublishReadiness(") &&
      deferredSource.includes("fallbackAcknowledged: false") &&
      deferredSource.includes('connector.status === "ACTIVE"') &&
      deferredSource.includes('connector.capabilities.some((capability) => capability === "PUBLISH")') &&
      deferredSource.includes("const publishableChannels = channels.filter"),
    "Product detail must derive publishable channels from active connectors with PUBLISH capability and run readiness preflight.",
  );
  assert(
    channelsSource.includes("<CardTitle>Channel readiness and queued exports</CardTitle>") &&
      channelsSource.includes("Queue readiness") &&
      channelsSource.includes("Ready to queue export") &&
      channelsSource.includes("Blocked until fixes are complete") &&
      channelsSource.includes("No preflight blockers for queued export."),
    "Channels tab must show the readiness/preflight state before queueing export work.",
  );
  assert(
    channelsSource.includes("data.canWrite && data.publishableChannels.length > 0") &&
      channelsSource.includes('name="fallbackAcknowledged"') &&
      channelsSource.includes("disabled={!data.canQueueExportWithAck}") &&
      channelsSource.includes('idleLabel="Queue channel export"') &&
      !channelsSource.includes("Publish to a channel"),
    "Channels tab must expose a write-role-gated queued-export action with fallback acknowledgment and honest copy.",
  );
  assert(
    channelsSource.includes("Advanced channel diagnostics") &&
      channelsSource.includes("Mapped Payload Preview") &&
      channelsSource.includes("Missing Fields") &&
      channelsSource.includes("Export Ready") &&
      channelsSource.includes("Risk Score"),
    "Channels tab must expose bounded preview/readiness diagnostics before pilot export attempts.",
  );
  assert(
    actionsSource.includes("export async function createExportJobAction") &&
      actionsSource.includes("/marketplace/products/${productId}/export-jobs") &&
      actionsSource.includes("export async function processExportJobAction") &&
      actionsSource.includes("/marketplace/export-jobs/${jobId}/process") &&
      actionsSource.includes("export async function requeueExportJobAction") &&
      actionsSource.includes("/marketplace/export-jobs/${jobId}/requeue"),
    "Web server actions must use queued export, process, and requeue backend contracts.",
  );
  assert(
    channelsSource.includes("<CardTitle>Queued export attempts and recovery</CardTitle>") &&
      channelsSource.includes("translateExportStatus(job.status)") &&
      channelsSource.includes("job.failureReason") &&
      channelsSource.includes('idleLabel="Process"') &&
      channelsSource.includes('idleLabel="Requeue"'),
    "Channels tab must expose status, failure state, process, and requeue recovery for queued export attempts.",
  );
  assert(
    submissionsSource.includes("StatusChip label={normalizeStatus(submission.status)} tone={statusTone(submission.status)}") &&
      submissionsSource.includes('href={`/products/${encodeURIComponent(submission.productId)}`}') &&
      submissionsSource.includes("new Date(submission.submittedAt).toLocaleString()"),
    "Submissions workspace must preserve operator status, product drilldown, and submitted timestamp review.",
  );
  assert(
    !channelsSource.includes("clientSecret") &&
      !channelsSource.includes("refreshToken") &&
      !channelsSource.includes("apiKey") &&
      !channelsSource.includes("credential"),
    "Product channel export UI must not surface connector secrets or credential fields.",
  );
  assert(
    channelsSource.includes("Your role cannot queue export jobs.") &&
      channelsSource.includes("No installed connector with publish capability is available for this tenant."),
    "Channels tab must provide useful role-aware and connector-missing fallback states.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "publishable_channels_are_active_publish_capable_connectors",
          "queued_export_readiness_preflight_is_visible",
          "queued_export_action_is_write_role_gated_and_honest",
          "payload_preview_and_diagnostics_are_available",
          "export_job_process_and_requeue_contracts_are_wired",
          "queued_export_status_failure_and_recovery_are_visible",
          "submissions_workspace_preserves_operator_drilldown",
          "connector_secrets_are_not_exposed_on_product_export_ui",
          "role_and_connector_fallbacks_are_visible",
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
  console.error("Publish/export pilot proof UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
