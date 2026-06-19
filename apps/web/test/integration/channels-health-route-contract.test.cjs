#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const HEALTH_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "channels", "health", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(HEALTH_PAGE, "utf8");

  assert(
      source.includes("await getServerSession();") &&
      source.includes('type SharedReadState = "available" | "restricted" | "unavailable";') &&
      source.includes("async function loadSharedRead<T>(promise: Promise<T>): Promise<SharedReadResult<T>>"),
    "Channels health must derive server auth context from the shared auth/session helpers.",
  );
  assert(
    source.includes("loadSharedRead(getDashboardHealth({ role: actorRole, authHeader }))") &&
      source.includes("loadSharedRead(getConnectorInstallationsHealth({ role: actorRole, authHeader }))") &&
      source.includes("loadSharedRead(getConnectorSummary({ role: actorRole, authHeader }))") &&
      source.includes("loadSharedRead(getInstalledConnectors({ role: actorRole, authHeader }))"),
    "Channels health must load dashboard health plus installation-scoped connector truth through the shared API client and server auth context.",
  );
  assert(
    source.includes("const connectorEntries = connectorHealth?.connectors ?? [];") &&
      source.includes("const installationEntries = connectorHealth?.installations ?? [];") &&
      source.includes("const readyListings =") &&
      source.includes("const blockedListings =") &&
      source.includes('connectorSummaryResult.value.totals.ready') &&
      source.includes('connectorSummaryResult.value.totals.blocked') &&
      source.includes('const connectorBreakdownRedacted = health?.redactedSections?.includes("connector_breakdown") ?? false;'),
    "Channels health must derive ready and blocked listing totals from the connector summary truth while honoring redacted aggregate fallbacks.",
  );
  assert(
    source.includes('label="Ready Listings"') &&
      source.includes('label="Blocked Listings"') &&
      source.includes('label="Blocking Issues"') &&
      source.includes('label="Warning Issues"'),
    "Channels health must surface the core readiness and blocking KPI cards.",
  );
  assert(
    source.includes("Health triage guide") &&
      source.includes("Fix content blockers first") &&
      source.includes("Check mappings next") &&
      source.includes("Use Jobs for delivery failures") &&
      source.includes("incomplete product data prevents publishable payloads from forming at all.") &&
      source.includes("connector or downstream system still rejected the submission or needs a retry."),
    "Channels health must guide operators toward the right follow-up workspace for content, mapping, and delivery problems.",
  );
  assert(
    source.includes("Per-channel connector breakdown is limited to editor and admin roles.") &&
      source.includes("Per-channel connector breakdown is temporarily unavailable.") &&
      source.includes("The aggregate readiness and blocking") &&
      source.includes("totals above remain available for read-only quality review.") &&
      source.includes("Store account labels are limited for your role.") &&
      source.includes("Store account labels are temporarily unavailable.") &&
      source.includes('title="No channel readiness records yet"') &&
      source.includes('description="Install and configure connectors to start collecting readiness and blocked listing signals."') &&
      source.includes('action={{ label: "Open Connectors", href: "/channels/connectors" }}'),
    "Channels health must provide an honest restricted fallback and empty state that send operators to the right next step.",
  );
  assert(
    source.includes('const healthTone = blocked > 0 ? "warning" : ready > 0 ? "success" : "neutral";') &&
      source.includes('installationEntries.map((inst) => {') &&
      source.includes('const ready = inst.ready;') &&
      source.includes('const blocked = inst.blocked;') &&
      source.includes('const healthLabel = blocked > 0 ? "Attention" : ready > 0 ? "Healthy" : pending > 0 ? "Pending" : "No activity";') &&
      source.includes("StatusChip label={healthLabel} tone={healthTone}"),
    "Channels health must derive per-store health labels and tones from installation-scoped ready and blocked counts, not connector aggregates.",
  );
  assert(
    source.includes('href="/channels/submissions"') &&
      source.includes('href="/operations/jobs"') &&
      source.includes('if (error instanceof ApiHttpError && error.status === 401)') &&
      source.includes('redirect(buildLoginRedirect("/channels/health", error));'),
    "Channels health must deep-link operators into submissions/jobs and redirect only expired sessions through the shared login helper.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "channels_health_route_uses_shared_server_auth_context",
          "channels_health_route_fetches_dashboard_health",
          "channels_health_route_derives_kpis_from_live_snapshot",
          "channels_health_route_surfaces_core_readiness_cards",
          "channels_health_route_guides_triage_follow_up",
          "channels_health_route_handles_empty_state_honestly",
          "channels_health_route_derives_per_channel_health_labels",
          "channels_health_route_preserves_store_metadata_degraded_states",
          "channels_health_route_redirects_only_expired_sessions",
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
  console.error("Channels health route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
