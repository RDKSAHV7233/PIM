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
const EXPORT_WITH_PREVIEW_FORM = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "products",
  "[id]",
  "_components",
  "export-with-preview-form.tsx",
);
const STATUS_TOAST_EFFECT = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "products",
  "[id]",
  "_components",
  "status-toast-effect.tsx",
);
const REFRESH_ON_INTERVAL = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "components",
  "ui",
  "refresh-on-interval.tsx",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const pageSource = fs.readFileSync(
    path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "page.tsx"),
    "utf8",
  );
  const channelsSource = fs.readFileSync(CHANNELS_TAB, "utf8");
  const deferredSource = fs.readFileSync(DEFERRED_SECTION, "utf8");
  const actionsSource = fs.readFileSync(ACTIONS, "utf8");
  const submissionsSource = fs.readFileSync(SUBMISSIONS_PAGE, "utf8");
  const exportWithPreviewSource = fs.readFileSync(EXPORT_WITH_PREVIEW_FORM, "utf8");
  const statusToastSource = fs.readFileSync(STATUS_TOAST_EFFECT, "utf8");
  const refreshOnIntervalSource = fs.readFileSync(REFRESH_ON_INTERVAL, "utf8");

  assert(
    pageSource.includes("evaluateConnectorPublishReadiness(") &&
      pageSource.includes("fallbackAcknowledged: false") &&
      deferredSource.includes('connector.status === "ACTIVE"') &&
      deferredSource.includes('connector.capabilities.some((capability) => capability === "PUBLISH")') &&
      deferredSource.includes("const publishableChannels = channels.filter"),
    "Product detail must derive publishable channels from active connectors with PUBLISH capability and run readiness preflight.",
  );
  assert(
    channelsSource.includes("<CardTitle>Channel readiness and queued exports</CardTitle>") &&
      channelsSource.includes("Queue readiness") &&
      channelsSource.includes("Export confirmation") &&
      channelsSource.includes("Latest export result summary") &&
      channelsSource.includes("Ready to queue export") &&
      channelsSource.includes("Blocked until fixes are complete") &&
      channelsSource.includes("No preflight blockers for queued export."),
    "Channels tab must show the readiness/preflight state before queueing export work.",
  );
  assert(
    channelsSource.includes("data.canPublish && data.publishableChannels.length > 0") &&
      channelsSource.includes("<ExportWithPreviewForm") &&
      !channelsSource.includes("Publish to a channel"),
    "Channels tab must expose a single write-role-gated queued-export action (not a duplicate legacy form) with honest copy.",
  );
  assert(
    exportWithPreviewSource.includes('name="fallbackAcknowledged"') &&
      exportWithPreviewSource.includes('name="templateId"') &&
      exportWithPreviewSource.includes("disabled={isLoading || !canQueueExportWithAck}") &&
      exportWithPreviewSource.includes('"Queue channel export"') &&
      exportWithPreviewSource.includes('confirmMode === "simple"') &&
      exportWithPreviewSource.includes('confirmMode === "preview"'),
    "Export form must carry fallback acknowledgment and current mapping context, gate submission on write permission, and always show a confirmation step before queuing — not just for Shopify.",
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
      actionsSource.includes('const returnToRaw = String(formData.get("returnTo") ?? "").trim();') &&
      actionsSource.includes('const returnTo = /^\\/(?!\\/)/.test(returnToRaw) ? returnToRaw : undefined;') &&
      actionsSource.includes('const statusAt = Date.now().toString();') &&
      actionsSource.includes("/marketplace/products/${productId}/export-jobs") &&
      actionsSource.includes("templateId: templateId || undefined,") &&
      actionsSource.includes('templateId: templateId || null,') &&
      actionsSource.includes('returnTo: returnTo || null,') &&
      actionsSource.includes('updateStatus: "export-queued",') &&
      actionsSource.includes("statusAt,") &&
      actionsSource.includes("export async function processExportJobAction") &&
      actionsSource.includes('updateStatus: "export-processed",') &&
      actionsSource.includes("/marketplace/export-jobs/${jobId}/process") &&
      actionsSource.includes("export async function requeueExportJobAction") &&
      actionsSource.includes('updateStatus: "export-requeued",') &&
      actionsSource.includes("/marketplace/export-jobs/${jobId}/requeue"),
    "Web server actions must use queued export, process, and requeue backend contracts while preserving current mapping/return context and emitting explicit same-page refresh/status stamps.",
  );
  assert(
    exportWithPreviewSource.includes("returnTo: string;") &&
      exportWithPreviewSource.includes('{returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}') &&
      statusToastSource.includes('"statusAt",') &&
      statusToastSource.includes('if (updateStatus === "export-processed") {') &&
      statusToastSource.includes('if (updateStatus === "export-requeued") {') &&
      refreshOnIntervalSource.includes('if (document.visibilityState !== "visible") {'),
    "Preview export form, status-toast cleanup, and interval refresh utility must carry, strip, acknowledge, and efficiently refresh the one-shot return/refresh context used by queued export and recovery redirects.",
  );
  assert(
    channelsSource.includes("<CardTitle>Queued export attempts and recovery</CardTitle>") &&
      channelsSource.includes("translateExportStatus(job.status)") &&
      channelsSource.includes("const hasInFlightExportJobs = data.exportJobs.some") &&
      channelsSource.includes("Auto-refreshing every 15s while queued, processing, or retrying export jobs are still in flight.") &&
      channelsSource.includes("job.failureReason") &&
      channelsSource.includes('idleLabel="Process"') &&
      channelsSource.includes('idleLabel="Requeue"'),
    "Channels tab must expose status, failure state, process, requeue recovery, a live in-flight refresh cue, and a latest export result summary for queued export attempts.",
  );
  assert(
    submissionsSource.includes("StatusChip label={normalizeStatus(submission.status)} tone={statusTone(submission.status)}") &&
      submissionsSource.includes('href={`/products/${encodeURIComponent(submission.productId)}`}') &&
      submissionsSource.includes("submission.submittedAt") &&
      submissionsSource.includes("formatDateTime"),
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
