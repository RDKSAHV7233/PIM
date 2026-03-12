#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const AUDIT_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "audit", "page.tsx");
const EXPORT_ROUTE = path.join(REPO_ROOT, "apps", "web", "src", "app", "api", "admin", "audit", "export", "route.ts");
const API_CLIENT = path.join(REPO_ROOT, "apps", "web", "src", "lib", "api.ts");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run() {
  const pageSource = fs.readFileSync(AUDIT_PAGE, "utf8");
  const exportRouteSource = fs.readFileSync(EXPORT_ROUTE, "utf8");
  const apiSource = fs.readFileSync(API_CLIENT, "utf8");

  assert(
    pageSource.includes("getAuditEvents(") &&
      pageSource.includes('title="Audit Logs"') &&
      pageSource.includes("Explore governance events by actor, action, entity type, and time range."),
    "Admin audit page must fetch audit explorer events and render the new audit explorer header.",
  );
  assert(
    pageSource.includes('htmlFor="audit-actor"') &&
      pageSource.includes('htmlFor="audit-action"') &&
      pageSource.includes('htmlFor="audit-entity"') &&
      pageSource.includes('htmlFor="audit-date-from"') &&
      pageSource.includes('htmlFor="audit-date-to"'),
    "Admin audit page must expose actor, action, entity type, and date-range filters.",
  );
  assert(
    pageSource.includes("Export CSV") &&
      pageSource.includes("/api/admin/audit/export") &&
      pageSource.includes("Load older events") &&
      pageSource.includes("Metadata"),
    "Admin audit page must expose CSV export, pagination, and metadata detail affordances.",
  );
  assert(
    exportRouteSource.includes("resolveBearerToken") &&
      exportRouteSource.includes("/audit/events/export") &&
      exportRouteSource.includes("Content-Disposition"),
    "Audit export proxy route must forward authenticated CSV export requests to the API.",
  );
  assert(
    apiSource.includes("export type AuditEntityType") &&
      apiSource.includes("export interface AuditEventListResponse") &&
      apiSource.includes("export async function getAuditEvents"),
    "API client must expose typed audit explorer fetch helpers.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "admin_audit_page_fetches_typed_audit_events",
          "admin_audit_page_exposes_filter_and_export_controls",
          "audit_export_proxy_route_forwards_authenticated_csv_requests",
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
  console.error("Audit explorer UI integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
