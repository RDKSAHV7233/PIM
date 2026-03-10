#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const layout = read("apps/web/src/app/layout.tsx");
  const center = read("apps/web/src/components/nav/notification-center.tsx");
  const route = read("apps/web/src/app/api/notifications/route.ts");
  const readRoute = read("apps/web/src/app/api/notifications/[id]/read/route.ts");

  assert(layout.includes('import { NotificationCenter } from "@/components/nav/notification-center";'), "layout must import NotificationCenter");
  assert(layout.includes('{hasAuthToken ? <NotificationCenter /> : null}'), "layout must mount NotificationCenter only for authenticated shell");
  assert(center.includes('/api/notifications?limit=12'), "notification center must query the notifications route");
  assert(center.includes("POLL_INTERVAL_MS = 30_000"), "notification center must poll every 30 seconds");
  assert(center.includes("Mark all read"), "notification center must expose mark all read");
  assert(center.includes("You're up to date"), "notification center must render empty state copy");
  assert(route.includes("validateCsrf(request)"), "notifications PATCH route must enforce CSRF");
  assert(readRoute.includes("validateCsrf(request)"), "notification read route must enforce CSRF");

  console.log(JSON.stringify({
    status: "ok",
    validated: [
      "layout_mounts_notification_center",
      "notification_center_polls_local_route",
      "notification_center_exposes_mark_all_read",
      "notification_empty_state_copy_present",
      "notification_routes_enforce_csrf",
    ],
  }, null, 2));
} catch (error) {
  console.error("notification-center-ui integration test failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
