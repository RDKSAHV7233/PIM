#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "notifications", "page.tsx");
const AUTH_API = path.join(REPO_ROOT, "apps", "web", "src", "lib", "api", "auth.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PAGE, "utf8");

  assert(
    source.includes('type NotificationFeedState = "loading" | "available" | "restricted" | "unavailable";') &&
      source.includes("type NotificationFetchResult =") &&
      source.includes("const [feedState, setFeedState] = useState<NotificationFeedState>(\"loading\");") &&
      source.includes("const [actionNotice, setActionNotice] = useState<NotificationFailure | null>(null);"),
    "Notifications page must track explicit feed and action state instead of collapsing failures into a generic empty state.",
  );
  assert(
    source.includes("buildLoginRedirect(\"/notifications\", failure)") &&
      source.includes('if (response.status === 401)') &&
      source.includes('if (response.status === 403)') &&
      !source.includes("if (!response.ok) return null;"),
    "Notifications page must handle 401, 403, and non-OK feed responses explicitly instead of treating every failure as empty data.",
  );
  assert(
    source.includes("Notifications are restricted") &&
      source.includes("Notifications are temporarily unavailable") &&
      source.includes("false empty inbox") &&
      source.includes("Notification updates are restricted") &&
      source.includes("Notification updates are temporarily unavailable"),
    "Notifications page must distinguish restricted and unavailable feed/action failures instead of rendering a fake up-to-date inbox.",
  );
  assert(
    source.includes("You're up to date") &&
      source.includes("New import, publish, connector, mapping, and approval updates will appear here.") &&
      source.includes("feedState === \"available\" && !hasItems"),
    "Notifications page must preserve the real empty-state copy only when the feed loaded successfully.",
  );
  assert(
    source.includes("setItems(previousItems);") &&
      source.includes("setUnreadCount(previousUnread);") &&
      source.includes("setUnreadCount((current) => Math.max(0, current - 1));") &&
      source.includes("router.push(item.actionUrl);"),
    "Notifications page must preserve optimistic unread behavior while reverting failed update actions honestly.",
  );
  assert(
    source.includes(
      'const params = new URLSearchParams({ limit: String(PAGE_SIZE), pagination: "cursor" });',
    ),
    // F-009: pagination=cursor was previously only added inside `if (cursor) {...}`,
    // but the very first request has no cursor yet, so the API's non-cursor fallback
    // (hardcoded nextCursor: null) always answered it — permanently capping this page
    // at its first PAGE_SIZE items regardless of how many notifications existed.
    // Confirmed live: unreadCount was 1,853 while this page could only ever render its
    // most recent 20.
    "Notifications page must request cursor-mode pagination unconditionally, including on the cursor-less first request — gating it on an already-present cursor value means the page can never advance past page one.",
  );

  const authSource = fs.readFileSync(AUTH_API, "utf8");
  assert(
    authSource.includes("export async function getNotifications(") &&
      authSource.includes('const params = new URLSearchParams({ pagination: "cursor" });'),
    // F-009 (same bug, second file): getNotifications() must build its base params
    // with pagination=cursor already set, not add it only once `input?.cursor` is
    // truthy — the proxy route (apps/web/src/app/api/notifications/route.ts) forwards
    // straight through to this function with no cursor on the first call.
    "getNotifications() in auth.ts must set pagination=cursor in its base params unconditionally, not only once a cursor value is already present.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "notifications_page_tracks_explicit_feed_and_action_states",
          "notifications_page_handles_session_restricted_and_unavailable_responses_explicitly",
          "notifications_page_distinguishes_restricted_and_unavailable_truth",
          "notifications_page_preserves_empty_state_only_for_successful_empty_feeds",
          "notifications_page_reverts_failed_optimistic_updates_honestly",
          "notifications_page_requests_cursor_pagination_unconditionally",
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
  console.error("Notifications page route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
