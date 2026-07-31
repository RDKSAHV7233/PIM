#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Candidate A source contract: AppSidebar's navigation <Link> elements must
 * not auto-prefetch on viewport visibility. This isn't a naive string
 * search for "prefetch={false}" anywhere in the file — it locates the
 * specific <Link> element that renders sidebar nav items (identified by
 * href={item.href}, the per-item href binding used inside the sections
 * map) and asserts prefetch={false} is an attribute on that exact element,
 * and that there is exactly one such render site (desktop and the mobile
 * drawer both instantiate the same AppSidebar component, so there should
 * only ever be one JSX render site to check).
 */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SIDEBAR_FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "nav", "app-sidebar.tsx");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run() {
  const source = fs.readFileSync(SIDEBAR_FILE, "utf8");

  // Locate every <Link ...> opening tag (non-greedy up to the closing '>').
  const linkTagPattern = /<Link\b[^>]*>/g;
  const linkTags = source.match(linkTagPattern) ?? [];
  assert(linkTags.length > 0, "AppSidebar must render at least one <Link> element.");

  const navItemLinks = linkTags.filter((tag) => tag.includes("href={item.href}"));
  assert(
    navItemLinks.length === 1,
    `Expected exactly one <Link href={item.href}> render site for sidebar nav items (the shared site used by both the desktop and mobile-drawer AppSidebar instances), found ${navItemLinks.length}. ` +
      "If a second render site was added, apply prefetch={false} there too and update this test's expected count.",
  );

  const navItemLink = navItemLinks[0];
  assert(
    /prefetch=\{false\}/.test(navItemLink),
    "AppSidebar's nav-item <Link href={item.href}> must set prefetch={false} — Candidate A (production hydration-race mitigation, see HANDOFF_PRODUCTION_BUILD_20260730.md) disables Next.js's automatic viewport-triggered prefetch on the sidebar's ~29 navigation links.",
  );

  // Sanity: the sections data structure this Link renders from should still
  // be present and non-trivial, so this test would fail loudly (not silently
  // pass on an empty sidebar) if SIDEBAR_SECTIONS were ever gutted.
  assert(
    /SIDEBAR_SECTIONS:\s*SidebarSection\[\]\s*=\s*\[/.test(source) && source.match(/label:\s*"/g)?.length >= 20,
    "AppSidebar's SIDEBAR_SECTIONS must still define a substantial navigation set (>= 20 items) — this test should exercise the real sidebar, not a stripped-down one.",
  );

  console.log("[app-sidebar-prefetch-disabled] PASS — sidebar nav-item Link has prefetch={false}, single render site confirmed.");
}

run();
