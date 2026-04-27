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
    source.includes("const authHeader = await getServerAuthHeader();") &&
      source.includes("const actorRole = await getServerActorRole();"),
    "Channels health must derive server auth context from the shared auth/session helpers.",
  );
  assert(
    source.includes("const health = await getDashboardHealth({ role: actorRole, authHeader });"),
    "Channels health must load dashboard health through the shared API client and server auth context.",
  );
  assert(
    source.includes("const connectorEntries = Object.entries(health.snapshot.publishReadyByConnector);") &&
      source.includes("const totalReady = connectorEntries.reduce((sum, [, count]) => sum + count, 0);") &&
      source.includes("const totalBlocked = Object.values(health.snapshot.blockedByConnector).reduce((sum, count) => sum + count, 0);") &&
      source.includes('const readyListings = typeof health.publishReadyTotal === "number" ? health.publishReadyTotal : totalReady;') &&
      source.includes('const blockedListings = typeof health.blockedTotal === "number" ? health.blockedTotal : totalBlocked;') &&
      source.includes('const connectorBreakdownRedacted = health.redactedSections?.includes("connector_breakdown") ?? false;'),
    "Channels health must derive ready and blocked listing totals from the live dashboard health snapshot while honoring redacted aggregate fallbacks.",
  );
  assert(
    source.includes('label="Ready Listings"') &&
      source.includes('label="Blocked Listings"') &&
      source.includes('label="Blocking Issues"') &&
      source.includes('label="Warning Issues"'),
    "Channels health must surface the core readiness and blocking KPI cards.",
  );
  assert(
    source.includes("Per-channel connector breakdown is limited to editor and admin roles.") &&
      source.includes("The aggregate readiness and blocking") &&
      source.includes("totals above remain available for read-only quality review.") &&
      source.includes('title="No channel readiness records yet"') &&
      source.includes('description="Install and configure connectors to start collecting readiness and blocked listing signals."') &&
      source.includes('action={{ label: "Open Connectors", href: "/channels/connectors" }}'),
    "Channels health must provide an honest restricted fallback and empty state that send operators to the right next step.",
  );
  assert(
    source.includes('const healthTone = blocked > 0 ? "warning" : ready > 0 ? "success" : "neutral";') &&
      source.includes('const healthLabel = blocked > 0 ? "Attention" : ready > 0 ? "Healthy" : "No activity";') &&
      source.includes("StatusChip label={healthLabel} tone={healthTone}"),
    "Channels health must derive per-channel health labels and tones from live ready and blocked counts.",
  );
  assert(
    source.includes('href="/channels/submissions"') &&
      source.includes('href="/operations/jobs"') &&
      source.includes('redirect(buildLoginRedirect("/channels/health", error));'),
    "Channels health must deep-link operators into submissions/jobs and redirect auth failures through the shared login helper.",
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
          "channels_health_route_handles_empty_state_honestly",
          "channels_health_route_derives_per_channel_health_labels",
          "channels_health_route_links_and_redirects_auth_failures",
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
