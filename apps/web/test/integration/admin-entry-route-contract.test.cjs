#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ADMIN_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "page.tsx");
const ADMIN_WORKSPACE_PAGE = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "admin",
  "workspace",
  "page.tsx",
);
const ADMIN_PRIVACY_PAGE = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "admin",
  "privacy",
  "page.tsx",
);
const ADMIN_NAVIGATION = path.join(REPO_ROOT, "apps", "web", "src", "lib", "admin-navigation.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function run() {
  const adminSource = read(ADMIN_PAGE);
  const workspaceSource = read(ADMIN_WORKSPACE_PAGE);
  const privacySource = read(ADMIN_PRIVACY_PAGE);
  const navigationSource = read(ADMIN_NAVIGATION);

  assert(
    adminSource.includes('import { redirect } from "next/navigation";') &&
      adminSource.includes('import { buildLoginRedirect } from "@/lib/auth-redirect";') &&
      adminSource.includes('import { getServerAuthHeader } from "@/lib/server-auth";') &&
      adminSource.includes('import { getServerActorRole } from "@/lib/server-session";') &&
      adminSource.includes('import { canViewAdminNavigationItem, type AdminNavigationAudience } from "@/lib/admin-navigation";') &&
      adminSource.includes("const authHeader = await getServerAuthHeader();") &&
      adminSource.includes("if (!authHeader) {") &&
      adminSource.includes('redirect(buildLoginRedirect("/admin", 401));') &&
      adminSource.includes("const actorRole = await getServerActorRole();") &&
      adminSource.includes("const visibleAdminLinks = adminLinks.filter((item) => canViewAdminNavigationItem(actorRole, item.visibility));") &&
      adminSource.includes('visibility: "admin" as AdminNavigationAudience') &&
      adminSource.includes('visibility: "editor_plus" as AdminNavigationAudience') &&
      adminSource.includes("View consent, export, and deletion status for the signed-in account."),
    "Admin hub must require auth, describe privacy scope honestly, and filter cards to the current role.",
  );

  assert(
    workspaceSource.includes('import { redirect } from "next/navigation";') &&
      workspaceSource.includes('import { buildLoginRedirect } from "@/lib/auth-redirect";') &&
      workspaceSource.includes('import { getServerAuthHeader } from "@/lib/server-auth";') &&
      workspaceSource.includes('import { getServerActorRole } from "@/lib/server-session";') &&
      workspaceSource.includes('import { canViewAdminNavigationItem, type AdminNavigationAudience } from "@/lib/admin-navigation";') &&
      workspaceSource.includes("const authHeader = await getServerAuthHeader();") &&
      workspaceSource.includes("if (!authHeader) {") &&
      workspaceSource.includes('redirect(buildLoginRedirect("/admin/workspace", 401));') &&
      workspaceSource.includes("const actorRole = await getServerActorRole();") &&
      workspaceSource.includes("const visibleWorkspaceAdminModules = workspaceAdminModules.filter((item) =>") &&
      workspaceSource.includes("canViewAdminNavigationItem(actorRole, item.visibility)") &&
      workspaceSource.includes("Workspace Admin Guide") &&
      workspaceSource.includes("This route is a compatibility handoff for older bookmarks.") &&
      workspaceSource.includes('href: "/admin/api-keys"') &&
      workspaceSource.includes('href: "/admin/webhooks"') &&
      workspaceSource.includes("View export and deletion status for the signed-in account."),
    "Admin workspace handoff must require auth, stay honest about its scope, and point legacy bookmarks to the role-appropriate admin module set.",
  );

  assert(
    privacySource.includes('import { redirect } from "next/navigation";') &&
      privacySource.includes('import { buildLoginRedirect } from "@/lib/auth-redirect";') &&
      privacySource.includes('import { getServerAuthHeader } from "@/lib/server-auth";') &&
      privacySource.includes("const authHeader = await getServerAuthHeader();") &&
      privacySource.includes("if (!authHeader) {") &&
      privacySource.includes('redirect(buildLoginRedirect("/admin/privacy", 401));') &&
      privacySource.includes("const actorRole = await getServerActorRole();"),
    "Admin privacy route must require auth before mounting the privacy client.",
  );

  assert(
    navigationSource.includes('export type AdminNavigationAudience = "all" | "editor_plus" | "admin";') &&
      navigationSource.includes('if (audience === "editor_plus") {') &&
      navigationSource.includes('return role === "admin" || role === "editor";') &&
      navigationSource.includes('return role === "admin";'),
    "Admin navigation visibility must distinguish shared, editor-plus, and admin-only surfaces.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "admin_hub_requires_auth_before_render",
          "admin_hub_describes_privacy_as_signed_in_account_scope",
          "admin_hub_filters_cards_by_current_role",
          "admin_workspace_handoff_requires_auth_before_render",
          "admin_workspace_handoff_routes_bookmarks_to_real_admin_modules",
          "admin_privacy_route_requires_auth_before_mounting_client",
          "admin_navigation_visibility_rules_are_shared",
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
  console.error("Admin entry route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
