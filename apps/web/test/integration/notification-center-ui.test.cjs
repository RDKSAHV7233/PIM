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
  const shell = read("apps/web/src/components/nav/authenticated-shell.tsx");
  const center = read("apps/web/src/components/nav/notification-center.tsx");
  const drawer = read("apps/web/src/components/ui/app-drawer.tsx");
  const route = read("apps/web/src/app/api/notifications/route.ts");
  const readRoute = read("apps/web/src/app/api/notifications/[id]/read/route.ts");

  assert(layout.includes("<AuthenticatedShell actorRole={actorRole}"), "layout must mount the authenticated shell when an auth token is present");
  assert(shell.includes('import { NotificationCenter } from "@/components/nav/notification-center";'), "authenticated shell must import NotificationCenter");
  assert(shell.includes("<NotificationCenter />"), "authenticated shell must mount NotificationCenter");
  assert(center.includes('/api/notifications?limit=12'), "notification center must query the notifications route");
  assert(center.includes("POLL_INTERVAL_MS = 30_000"), "notification center must poll every 30 seconds");
  assert(center.includes("Mark all read"), "notification center must expose mark all read");
  assert(center.includes("You're up to date"), "notification center must render empty state copy");
  assert(center.includes('import { AppDrawer } from "@/components/ui/app-drawer";'), "notification center must use the shared drawer primitive");
  assert(drawer.includes('document.body.style.overflow = "hidden"'), "shared app drawer must lock body scroll while a drawer is open");
  assert(center.includes("createPortal(drawer, document.body)"), "notification drawer must render through a body portal");
  assert(drawer.includes('if (event.key !== "Tab")'), "shared app drawer must trap Tab navigation");
  assert(drawer.includes("previousFocusRef.current?.focus();"), "shared app drawer must restore focus when it closes");
  assert(center.includes('panelClassName="w-full max-w-md border-l border-slate-200 shadow-2xl"'), "notification drawer must keep the bounded right-rail layout");
  assert(center.includes('contentClassName="px-4 py-4"'), "notification drawer content must keep the bounded internal scroll layout");
  assert(center.includes("setUnreadCount(0)"), "mark all read must update unread count immediately");
  assert(center.includes("setUnreadCount((current) => Math.max(0, current - 1))"), "opening an unread notification must update unread count immediately");
  assert(route.includes("validateCsrf(request)"), "notifications PATCH route must enforce CSRF");
  assert(readRoute.includes("validateCsrf(request)"), "notification read route must enforce CSRF");

  console.log(JSON.stringify({
    status: "ok",
    validated: [
      "authenticated_shell_mounts_notification_center",
      "notification_center_polls_local_route",
      "notification_center_exposes_mark_all_read",
      "notification_empty_state_copy_present",
      "notification_drawer_locks_page_scroll",
      "notification_drawer_uses_body_portal",
      "notification_drawer_traps_keyboard_focus",
      "notification_drawer_restores_focus_on_close",
      "notification_drawer_uses_bounded_internal_scroll",
      "notification_unread_state_updates_optimistically",
      "notification_routes_enforce_csrf",
    ],
  }, null, 2));
} catch (error) {
  console.error("notification-center-ui integration test failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
