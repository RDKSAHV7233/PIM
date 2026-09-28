#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression coverage for the sidebar's "Overview" link staying highlighted on every
 * /channels/* sub-route (and the same class of bug for any other parent/child href pair,
 * e.g. /admin/connectors vs /admin/connectors/pipeline). The old per-item check
 * (`pathname === item.href || pathname.startsWith(item.href + "/")`) matched every sibling
 * independently, so a short parent href like "/channels" matched alongside a longer, more
 * specific sibling like "/channels/mappings" on the same route. The fix in
 * lib/nav-active-item.ts picks the single longest matching href across the whole nav, so only
 * the most specific item lights up. This exercises the real, import-free lib module as code
 * (via ts.transpileModule), not a text match, plus a source-contract check that AppSidebar
 * actually wires it in instead of reintroducing independent per-item matching.
 */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const NAV_ACTIVE_ITEM = path.join(REPO_ROOT, "apps", "web", "src", "lib", "nav-active-item.ts");
const SIDEBAR_FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "nav", "app-sidebar.tsx");

function loadNavActiveItemModule() {
  const ts = require("typescript");
  const Module = require("node:module");
  const { outputText } = ts.transpileModule(fs.readFileSync(NAV_ACTIVE_ITEM, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: "nav-active-item.ts",
  });
  const mod = new Module(NAV_ACTIVE_ITEM, module);
  mod.filename = NAV_ACTIVE_ITEM;
  mod._compile(outputText, NAV_ACTIVE_ITEM);
  return mod.exports;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run() {
  assert(fs.existsSync(NAV_ACTIVE_ITEM), "lib/nav-active-item.ts must exist.");
  const { selectActiveHref } = loadNavActiveItemModule();
  assert(typeof selectActiveHref === "function", "nav-active-item.ts must export selectActiveHref.");

  const connectionsHrefs = [
    "/channels",
    "/channels/connectors",
    "/channels/mappings",
    "/channels/health",
    "/channels/submissions",
    "/admin/connectors",
    "/admin/connectors/pipeline",
  ];

  assert(
    selectActiveHref("/channels/mappings", connectionsHrefs) === "/channels/mappings",
    "On /channels/mappings, the most specific href (Mappings) must win over the parent Overview href.",
  );
  assert(
    selectActiveHref("/channels/connectors/abc-123?tab=overview", connectionsHrefs) === "/channels/connectors",
    "On a nested connector detail route, Connections must win over Overview.",
  );
  assert(
    selectActiveHref("/channels/health", connectionsHrefs) === "/channels/health",
    "On /channels/health, Issues must win over Overview.",
  );
  assert(
    selectActiveHref("/channels", connectionsHrefs) === "/channels",
    "On /channels itself, Overview must still be the (only) active item.",
  );
  assert(
    selectActiveHref("/channels/", connectionsHrefs) === "/channels",
    "A trailing-slash /channels/ must still resolve Overview as active.",
  );
  assert(
    selectActiveHref("/admin/connectors/pipeline", connectionsHrefs) === "/admin/connectors/pipeline",
    "Pipeline must win over its own parent Governance href, the same bug class as Overview vs Mappings.",
  );
  assert(
    selectActiveHref("/admin/connectors", connectionsHrefs) === "/admin/connectors",
    "On /admin/connectors itself, Governance must be the (only) active item, not Pipeline.",
  );
  assert(
    selectActiveHref("/dashboard", connectionsHrefs) === null,
    "An unrelated route must not resolve any Connections-section href as active.",
  );

  const sidebar = fs.readFileSync(SIDEBAR_FILE, "utf8");
  assert(
    sidebar.includes('from "@/lib/nav-active-item"') && sidebar.includes("selectActiveHref("),
    "AppSidebar must compute the active item via lib/nav-active-item's selectActiveHref, not independent per-item prefix matching.",
  );
  assert(
    !/pathname\.startsWith\(`\$\{item\.href\}\/`\)/.test(sidebar),
    "AppSidebar must not reintroduce the old independent per-item startsWith(`${item.href}/`) check that let a parent and a specific sibling both render active.",
  );
  assert(
    sidebar.includes("const active = item.href === activeHref;"),
    "Each sidebar item's active state must come from the single resolved activeHref, so only one item can be active at a time.",
  );

  console.log("[app-sidebar-active-item] PASS — most-specific-href-wins active-item resolution verified as code and wired into AppSidebar.");
}

run();
