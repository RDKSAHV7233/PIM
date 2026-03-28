#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DETAIL_PAGE = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "channels",
  "connectors",
  "[installationId]",
  "page.tsx",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(DETAIL_PAGE, "utf8");

  assert(
    source.includes("const { installationId } = await params;") &&
      source.includes("const authHeader = await getServerAuthHeader();") &&
      source.includes("const actorRole = await getServerActorRole();"),
    "Channel connector detail must derive the route param plus shared server auth/session context.",
  );
  assert(
    source.includes("const installations = await getInstalledConnectors({ role: actorRole, authHeader });") &&
      source.includes("const installation = installations.find((item) => item.id === installationId);") &&
      source.includes("if (!installation) {") &&
      source.includes("notFound();"),
    "Channel connector detail must resolve the installation from the shared connectors list and 404 missing installations.",
  );
  assert(
    source.includes("const [permissions, submissionsRaw] = await Promise.all([") &&
      source.includes("getConnectorPermissions(installation.slug, { role: actorRole, authHeader })") &&
      source.includes("getSubmissions({ connectorSlug: installation.slug, limit: 100 }, { role: actorRole, authHeader })"),
    "Channel connector detail must load permissions and submissions together from the selected installation slug.",
  );
  assert(
    source.includes("function toItems<T>(value: T[] | { items: T[] } | null | undefined): T[]") &&
      source.includes("return Array.isArray(value.items) ? value.items : [];") &&
      source.includes('item.status === "ERROR" || item.status === "REJECTED" || item.status === "SUPPRESSED"'),
    "Channel connector detail must normalize submission payload shapes and derive failed submission counts from live statuses.",
  );
  assert(
    source.includes('label="Capabilities"') &&
      source.includes('label="Submissions"') &&
      source.includes('label="Errors / Rejections"') &&
      source.includes('label="Permission Rules"'),
    "Channel connector detail must surface installation capabilities, submission volume, failure load, and permission rule KPIs.",
  );
  assert(
    source.includes('href={`/connectors/${encodeURIComponent(installation.id)}/mapping`}') &&
      source.includes('href="/admin/connectors"') &&
      source.includes('No connector-specific permission overrides.') &&
      source.includes('No submissions recorded for this connector yet.'),
    "Channel connector detail must expose mapping/access-management deep links and honest empty states for permissions and submissions.",
  );
  assert(
    source.includes("new Date(installation.installedAt).toLocaleString()") &&
      source.includes("installation.lastSyncAt ? new Date(installation.lastSyncAt).toLocaleString() : \"-\"") &&
      source.includes("new Date(submission.submittedAt).toLocaleString()"),
    "Channel connector detail must surface installation and submission timing data from backend timestamps.",
  );
  assert(
    source.includes('redirect(buildLoginRedirect(`/channels/connectors/${encodeURIComponent(installationId)}`, error));'),
    "Channel connector detail must redirect expired or forbidden sessions through the shared login helper with the detail return path.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "channel_connector_detail_route_uses_params_and_shared_server_auth_context",
          "channel_connector_detail_route_resolves_installation_and_404s_missing_records",
          "channel_connector_detail_route_fetches_permissions_and_submissions_in_parallel",
          "channel_connector_detail_route_normalizes_submission_shape_and_failure_counts",
          "channel_connector_detail_route_surfaces_installation_and_permission_kpis",
          "channel_connector_detail_route_links_to_mapping_and_access_management",
          "channel_connector_detail_route_surfaces_timestamp_fields",
          "channel_connector_detail_route_redirects_auth_failures",
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
  console.error("Channel connector detail route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
