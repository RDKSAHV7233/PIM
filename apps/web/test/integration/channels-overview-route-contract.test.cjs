#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CHANNELS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "channels", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(CHANNELS_PAGE, "utf8");

  assert(
    source.includes("const authHeader = await getServerAuthHeader();") &&
      source.includes("const actorRole = await getServerActorRole();"),
    "Channels overview must derive its server auth context from the shared auth/session helpers.",
  );
  assert(
    source.includes("Promise.all([") &&
      source.includes("getInstalledConnectors({ role: actorRole, authHeader })") &&
      source.includes("getSubmissions({ limit: 100 }, { role: actorRole, authHeader })") &&
      source.includes("getDashboardHealth({ role: actorRole, authHeader })"),
    "Channels overview must load connectors, submissions, and dashboard health together from the shared auth context.",
  );
  assert(
    source.includes("function toItems<T>(value: T[] | { items: T[] } | null | undefined): T[]") &&
      source.includes("return Array.isArray(value.items) ? value.items : [];"),
    "Channels overview must normalize list-or-paginated submission responses through a shared toItems helper.",
  );
  assert(
    source.includes('item.status === "ACTIVE"') &&
      source.includes('submission.status === "REJECTED" || submission.status === "ERROR"') &&
      source.includes('submission.status === "PENDING"') &&
      source.includes("Object.values(health.snapshot.blockedByConnector).reduce((sum, count) => sum + count, 0)"),
    "Channels overview must derive connector, submission, and blocked-listing KPIs from live backend data rather than static copy.",
  );
  assert(
    source.includes('label="Installed Connectors"') &&
      source.includes('label="Submission Jobs"') &&
      source.includes('label="Ready for Publish"') &&
      source.includes('label="Blocked Listings"'),
    "Channels overview must surface the core publishing KPIs for connectors, submissions, readiness, and blocked listings.",
  );
  assert(
    source.includes('href="/channels/connectors"') &&
      source.includes('href="/channels/mappings"') &&
      source.includes('href="/channels/submissions"') &&
      source.includes('href="/channels/health"') &&
      source.includes('href="/admin/connectors"'),
    "Channels overview must deep-link operators into connectors, mappings, submissions, health, and access-management workspaces.",
  );
  assert(
    source.includes('redirect(buildLoginRedirect("/channels", error));'),
    "Channels overview must redirect expired or forbidden sessions through the centralized login redirect helper.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "channels_overview_route_uses_shared_server_auth_context",
          "channels_overview_route_fetches_connectors_submissions_and_health_in_parallel",
          "channels_overview_route_normalizes_submission_list_shapes",
          "channels_overview_route_derives_live_publishing_kpis",
          "channels_overview_route_links_to_core_channel_workspaces",
          "channels_overview_route_redirects_auth_failures",
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
  console.error("Channels overview route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
