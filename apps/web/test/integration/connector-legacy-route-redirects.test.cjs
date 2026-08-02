#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(REPO_ROOT, relativePath));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const nextConfig = read("apps/web/next.config.ts");
  const connectorDetailPage = read("apps/web/src/app/channels/connectors/[installationId]/page.tsx");

  assert(
    nextConfig.includes('{ source: "/connectors", destination: "/channels/connectors", permanent: true }'),
    "next.config.ts must preserve the exact legacy /connectors redirect to /channels/connectors.",
  );
  assert(
    !nextConfig.includes('{ source: "/connectors/:path*", destination: "/channels/connectors/:path*", permanent: true }'),
    "next.config.ts must not wildcard-redirect /connectors/:path* because /connectors/[installationId]/mapping is an active route.",
  );
  assert(
    exists("apps/web/src/app/connectors/[installationId]/mapping/page.tsx"),
    "The connector mapping redirect route must remain mounted at /connectors/[installationId]/mapping.",
  );
  assert(
    exists("apps/web/src/app/connectors/setup/page.tsx"),
    "The connector setup route must remain mounted at /connectors/setup.",
  );
  assert(
    connectorDetailPage.includes('href={`/connectors/${encodeURIComponent(installation.id)}/mapping`}') &&
      connectorDetailPage.includes("Open mapping workspace"),
    "Connector detail page must keep linking to the valid connector mapping workspace route.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "legacy_connectors_exact_redirect_preserved",
          "legacy_connectors_wildcard_redirect_removed",
          "connector_mapping_workspace_route_remains_mounted",
          "connector_setup_route_remains_mounted",
          "connector_detail_links_to_mapping_workspace_route",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("connector legacy route redirect test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
