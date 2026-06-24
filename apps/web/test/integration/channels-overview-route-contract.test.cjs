#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CHANNELS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "channels", "page.tsx");
const ROLE_CAPABILITIES = path.join(REPO_ROOT, "apps", "web", "src", "lib", "role-capabilities.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(CHANNELS_PAGE, "utf8");
  const roleCapabilitiesSource = fs.readFileSync(ROLE_CAPABILITIES, "utf8");

  assert(
      source.includes("await getServerSession();"),
    "Connections overview must derive its server auth context from the shared auth/session helpers.",
  );
  assert(
    source.includes('type SharedReadState = "available" | "restricted" | "unavailable";') &&
      source.includes("async function loadSharedRead<T>(promise: Promise<T>): Promise<SharedReadResult<T>>") &&
      source.includes("Promise.all([") &&
      source.includes("loadSharedRead(getInstalledConnectors({ role: actorRole, authHeader }))") &&
      source.includes("loadSharedRead(getSubmissions({ limit: 100 }, { role: actorRole, authHeader }))") &&
      source.includes("loadSharedRead(getDashboardHealth({ role: actorRole, authHeader }))"),
    "Connections overview must wrap connector, submission, and health reads so restricted and unavailable states stay explicit.",
  );
  assert(
    source.includes("function toItems<T>(value: T[] | { items: T[] } | null | undefined): T[]") &&
      source.includes("return Array.isArray(value.items) ? value.items : [];"),
    "Connections overview must normalize list-or-paginated submission responses through a shared toItems helper.",
  );
  assert(
    !source.includes(".catch(() => [] as Awaited<ReturnType<typeof getInstalledConnectors>>)"),
    "Connections overview must not hide connector read failures behind an empty connector list fallback.",
  );
  assert(
    source.includes('item.status === "ACTIVE"') &&
      source.includes('submission.status === "REJECTED" || submission.status === "ERROR"') &&
      source.includes('submission.status === "PENDING"') &&
      source.includes("Object.values(health.snapshot.blockedByConnector).reduce((sum, count) => sum + count, 0)"),
    "Connections overview must derive connector, submission, and blocked-listing KPIs from live backend data rather than static copy.",
  );
  assert(
    source.includes("Some connection data is temporarily unavailable") &&
      source.includes("Some connection data is restricted") &&
      source.includes("Connector installation totals are limited for your role.") &&
      source.includes("Connector installation totals are temporarily unavailable.") &&
      source.includes("Connection health is temporarily unavailable.") &&
      source.includes("Connector status restricted") &&
      source.includes("Connection health unavailable"),
    "Connections overview must distinguish restricted and unavailable shared reads instead of defaulting to healthy zero states.",
  );
  assert(
    source.includes('label="Installed Connections"') &&
      source.includes('label="Submission Jobs"') &&
      source.includes('label="Ready for Publish"') &&
      source.includes('label="Blocked Listings"'),
    "Connections overview must surface the core publishing KPIs for connectors, submissions, readiness, and blocked listings.",
  );
  assert(
    source.includes('href="/channels/connectors"') &&
      source.includes('href="/channels/mappings"') &&
      source.includes('href="/channels/submissions"') &&
      source.includes('href="/channels/health"') &&
      source.includes('href="/admin/connectors"'),
    "Connections overview must deep-link operators into connections, mappings, issues, submissions, and governance workspaces.",
  );
  assert(
    roleCapabilitiesSource.includes('return role === "admin" || role === "editor" || role === "channel_manager";') &&
      source.includes("const canEditChannelSetup = canManageChannels(actorRole);") &&
      source.includes('const canManageConnectorAccess = actorRole === "admin";') &&
      source.includes("Workspace editors and admins apply mapping changes.") &&
      source.includes("Workspace admins manage connector permissions and plan-based access.") &&
      source.includes('{canManageConnectorAccess ? "Open governance" : "Review governance rules"}'),
    "Connections overview must describe connection setup, mappings, and governance honestly for read-only roles.",
  );
  assert(
    source.includes('if (error instanceof ApiHttpError && error.status === 401)') &&
      source.includes('redirect(buildLoginRedirect("/channels", error));'),
    "Connections overview must redirect only expired sessions while preserving restricted shared-read states in-page.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "connections_overview_route_uses_shared_server_auth_context",
          "connections_overview_route_fetches_connectors_submissions_and_health_with_explicit_shared_read_states",
          "connections_overview_route_normalizes_submission_list_shapes",
          "connections_overview_route_does_not_hide_connector_failures_as_empty_lists",
          "connections_overview_route_derives_live_publishing_kpis",
          "connections_overview_route_distinguishes_restricted_and_unavailable_truth",
          "connections_overview_route_links_to_core_connection_workspaces",
          "connections_overview_route_adjusts_setup_copy_for_read_only_roles",
          "connections_overview_route_redirects_only_expired_sessions",
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
  console.error("Connections overview route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
