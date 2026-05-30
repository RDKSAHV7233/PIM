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
      adminSource.includes('import { getServerSession } from "@/lib/server-session";') &&
      adminSource.includes('import { canViewAdminNavigationItem, describeAdminAccess, type AdminNavigationAudience } from "@/lib/admin-navigation";') &&
      adminSource.includes("if (!authHeader) {") &&
      adminSource.includes('redirect(buildLoginRedirect("/admin", 401));') &&
      adminSource.includes("await getServerSession();") &&
      adminSource.includes("const visibleAdminLinks = adminLinks.filter((item) => canViewAdminNavigationItem(actorRole, item.visibility") &&
      adminSource.includes("const accessSummary = describeAdminAccess(actorRole") &&
      adminSource.includes('description={`Workspace settings and governance controls available for your current ${actorRole} role.`}') &&
      adminSource.includes("<CardTitle>{accessSummary.title}</CardTitle>") &&
      adminSource.includes('visibility: "system_admin_gated" as AdminNavigationAudience') &&
      adminSource.includes('visibility: "editor_plus" as AdminNavigationAudience') &&
      adminSource.includes('href: "/admin/auth-policy"') &&
      adminSource.includes("View consent, export, and deletion status for the signed-in account."),
    "Admin hub must require auth, describe privacy scope honestly, summarize current-role access, and filter cards to the current role.",
  );

  assert(
    workspaceSource.includes('import { redirect } from "next/navigation";') &&
      workspaceSource.includes('import { buildLoginRedirect } from "@/lib/auth-redirect";') &&
      workspaceSource.includes('import { getServerSession } from "@/lib/server-session";') &&
      workspaceSource.includes('import { canViewAdminNavigationItem, describeAdminAccess, type AdminNavigationAudience } from "@/lib/admin-navigation";') &&
      workspaceSource.includes("if (!authHeader) {") &&
      workspaceSource.includes('redirect(buildLoginRedirect("/admin/workspace", 401));') &&
      workspaceSource.includes("await getServerSession();") &&
      workspaceSource.includes("const visibleWorkspaceAdminModules = workspaceAdminModules.filter((item) =>") &&
      workspaceSource.includes("canViewAdminNavigationItem(actorRole, item.visibility") &&
      workspaceSource.includes("const accessSummary = describeAdminAccess(actorRole") &&
      workspaceSource.includes("Workspace Admin Guide") &&
      workspaceSource.includes("This route is a compatibility handoff for older bookmarks.") &&
      workspaceSource.includes("Use the admin modules available for your current") &&
      workspaceSource.includes('href: "/admin/api-keys"') &&
      workspaceSource.includes('href: "/admin/auth-policy"') &&
      workspaceSource.includes('href: "/admin/webhooks"') &&
      workspaceSource.includes("View export and deletion status for the signed-in account."),
    "Admin workspace handoff must require auth, explain current-role access honestly, and point legacy bookmarks to the role-appropriate admin module set.",
  );

  assert(
    privacySource.includes('import { redirect } from "next/navigation";') &&
      privacySource.includes('import { buildLoginRedirect } from "@/lib/auth-redirect";') &&
      privacySource.includes("if (!authHeader) {") &&
      privacySource.includes('redirect(buildLoginRedirect("/admin/privacy", 401));') &&
      privacySource.includes("await getServerSession();"),
    "Admin privacy route must require auth before mounting the privacy client.",
  );

  assert(
    navigationSource.includes('export type AdminNavigationAudience') &&
      navigationSource.includes('"editor_plus"') &&
      navigationSource.includes('"connector_admin_plus"') &&
      navigationSource.includes('"admin"') &&
      navigationSource.includes('if (audience === "editor_plus") {') &&
      navigationSource.includes('return role === "admin" || role === "editor"') &&
      navigationSource.includes('return role === "admin"') &&
      navigationSource.includes('title: "Full admin access"') &&
      navigationSource.includes('title: "Limited admin access"') &&
      navigationSource.includes('title: "Connector admin access"'),
    "Admin navigation helpers must distinguish shared, editor-plus, and admin-only surfaces and explain current-role access clearly.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "admin_hub_requires_auth_before_render",
          "admin_hub_describes_privacy_as_signed_in_account_scope",
          "admin_hub_filters_cards_by_current_role",
          "admin_hub_summarizes_current_role_access",
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
