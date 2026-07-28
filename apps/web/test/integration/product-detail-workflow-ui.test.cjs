#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PRODUCT_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "page.tsx");
const OVERVIEW_TAB = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "_components", "overview-tab.tsx");
const CHANNELS_TAB = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "_components", "channels-tab.tsx");
const QUALITY_TAB = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "_components", "quality-tab.tsx");
const SIDE_RAIL = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "_components", "product-detail-side-rail.tsx");
const STATUS_ALERTS = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "_components", "product-detail-status-alerts.tsx");
const STATUS_TOAST = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "_components", "status-toast-effect.tsx");
const READINESS_BAR = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "product-readiness-summary-bar.tsx");
const REFRESH_ON_INTERVAL = path.join(REPO_ROOT, "apps", "web", "src", "components", "ui", "refresh-on-interval.tsx");
const EXPORT_WITH_PREVIEW_FORM = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "_components", "export-with-preview-form.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const pageSource = fs.readFileSync(PRODUCT_PAGE, "utf8");
  const overviewSource = fs.readFileSync(OVERVIEW_TAB, "utf8");
  const channelsSource = fs.readFileSync(CHANNELS_TAB, "utf8");
  const qualitySource = fs.readFileSync(QUALITY_TAB, "utf8");
  const sideRailSource = fs.readFileSync(SIDE_RAIL, "utf8");
  const statusAlertsSource = fs.readFileSync(STATUS_ALERTS, "utf8");
  const statusToastSource = fs.readFileSync(STATUS_TOAST, "utf8");
  const readinessBarSource = fs.readFileSync(READINESS_BAR, "utf8");
  const refreshOnIntervalSource = fs.readFileSync(REFRESH_ON_INTERVAL, "utf8");
  const exportWithPreviewSource = fs.readFileSync(EXPORT_WITH_PREVIEW_FORM, "utf8");

  assert(
    overviewSource.includes("<CardTitle>Product overview</CardTitle>"),
    "Product detail must lead with a product overview section.",
  );
  assert(
    overviewSource.includes("<CardTitle>Fix blockers before publish</CardTitle>") &&
      overviewSource.includes("Open channel readiness"),
    "Product detail must expose a fix-blockers section with direct readiness action.",
  );
  assert(
    channelsSource.includes("<CardTitle>Channel readiness and queued exports</CardTitle>") &&
      channelsSource.includes("Export confirmation") &&
      channelsSource.includes("Latest export result summary") &&
      channelsSource.includes('name="channel" value={data.selectedChannel}') &&
      channelsSource.includes("<RefreshOnInterval enabled={data.activeTab === \"channels\" && hasInFlightExportJobs} intervalMs={15_000} />") &&
      channelsSource.includes("Auto-refreshing every 15s while queued, processing, or retrying export jobs are still in flight.") &&
      !channelsSource.includes("Publish to a channel"),
    "Product detail must use truthful queued-export language, keep recovery actions pinned to the active product/channel context, and visibly auto-refresh while export jobs remain in flight.",
  );
  assert(
    exportWithPreviewSource.includes("Queue channel export") &&
      exportWithPreviewSource.includes('name="templateId"') &&
      exportWithPreviewSource.includes('defaultValue={selectedTemplateId ?? ""}'),
    "The single queued-export form must keep the truthful action label and stay aligned to the selected mapping template context.",
  );
  assert(
    pageSource.includes(">Open publish & export</Link>") &&
      !pageSource.includes(">Submit</Link>"),
    "Product detail header must use publish/export terminology instead of generic submit wording.",
  );
  assert(
    pageSource.includes('const showSaveAction = canWrite && (activeTab === "content" || activeTab === "attributes");') &&
      pageSource.includes('const showValidateAction = canWrite && activeTab === "quality";') &&
      pageSource.includes(">Run validation</button>"),
    "Product detail header must only expose save on edit tabs and must keep validation scoped to the quality workflow.",
  );
  assert(
    pageSource.includes('title: "Product readiness"') &&
      pageSource.includes('title: "Mapping readiness"') &&
      pageSource.includes('title: "Media readiness"') &&
      pageSource.includes('title: "Connector readiness"') &&
      pageSource.includes('title: "Approval status"') &&
      pageSource.includes('title: "Last export attempt"'),
    "Product detail readiness header must expose product, mapping, media, connector, approval, and last export attempt status cards.",
  );
  assert(
    readinessBarSource.includes("Top blockers for") &&
      readinessBarSource.includes("Open the exact fix path before you queue an export or review publish readiness.") &&
      readinessBarSource.includes('if (selectedTemplateId) {') &&
      readinessBarSource.includes("refreshSignal?: string;") &&
      readinessBarSource.includes("}, [buildResults, productId, role, selectedTemplateId, refreshSignal]);") &&
      readinessBarSource.includes('href={channelLinks?.[channel]}'),
    "Product detail readiness header must expose direct blocker recovery links, keep the readiness fetch aligned to the selected template context, and rerun on explicit same-page action refresh signals.",
  );
  assert(
    refreshOnIntervalSource.includes("enabled?: boolean;") &&
      refreshOnIntervalSource.includes("if (!enabled) {") &&
      refreshOnIntervalSource.includes('if (document.visibilityState !== "visible") {') &&
      refreshOnIntervalSource.includes("}, [enabled, intervalMs, router]);"),
    "Interval refresh utility must support explicit enablement and avoid background-tab refresh churn.",
  );
  assert(
    channelsSource.includes("Advanced channel diagnostics") &&
      channelsSource.includes("View queued export attempts and recovery actions") &&
      channelsSource.includes('id="channel-simulator-section"') &&
      channelsSource.includes('open={data.showChannelDiagnostics}') &&
      channelsSource.includes('<input type="hidden" name="tab" value="channels" />') &&
      channelsSource.includes('<input type="hidden" name="focus" value="simulator" />') &&
      channelsSource.includes('{data.showChannelDiagnostics ? <input type="hidden" name="focus" value="simulator" /> : null}') &&
      channelsSource.includes('{data.returnTo ? <input type="hidden" name="returnTo" value={data.returnTo} /> : null}'),
    "Technical channel diagnostics must stay collapsible, and both drilldowns and recovery actions must preserve diagnostics/return context.",
  );
  assert(
    qualitySource.includes('<input type="hidden" name="currentTab" value="quality" />') &&
      qualitySource.includes('<input type="hidden" name="returnTo" value={data.returnTo} />') &&
      statusAlertsSource.includes('updateStatus === "validated"') &&
      statusAlertsSource.includes("Validation finished. Review any updated blockers before publishing.") &&
      statusAlertsSource.includes('updateStatus === "validate-error"') &&
      statusToastSource.includes('if (updateStatus === "validated") {') &&
      statusToastSource.includes('toast.success("Validation complete")') &&
      statusToastSource.includes('if (updateStatus === "validate-error") {') &&
      statusToastSource.includes('toast.error("Validation failed")'),
    "Product detail validation must preserve product context and give explicit success and failure feedback after the action completes.",
  );
  assert(
    sideRailSource.includes("<SideRailCard title=\"Next actions\">") &&
      !sideRailSource.includes("<SideRailCard title=\"Workflow\">"),
    "Product detail side rail must expose next actions instead of raw workflow metadata.",
  );
  assert(
    !pageSource.includes("<CardTitle>Pre-Export Jobs</CardTitle>") &&
      !channelsSource.includes("<CardTitle>Pre-Export Jobs</CardTitle>"),
    "Product detail must not foreground pre-export jobs as a primary merchandiser panel.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "product_detail_leads_with_overview_and_fix_blockers",
          "product_detail_uses_truthful_queued_export_language",
          "product_detail_demotes_diagnostics_and_workflow_metadata",
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
  console.error("Product detail workflow UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
