#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "auth-policy", "page.tsx");
const ACTIONS = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "auth-policy", "actions.ts");
const ADMIN_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "page.tsx");
const WORKSPACE_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "workspace", "page.tsx");
const SIDEBAR = path.join(REPO_ROOT, "apps", "web", "src", "components", "nav", "app-sidebar.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function run() {
  const page = read(PAGE);
  const actions = read(ACTIONS);
  const adminPage = read(ADMIN_PAGE);
  const workspacePage = read(WORKSPACE_PAGE);
  const sidebar = read(SIDEBAR);

  assert(
    page.includes("await getServerSession();") &&
      page.includes('redirect(buildLoginRedirect("/admin/auth-policy", 401));') &&
      page.includes("const [policy, planProfile] = await Promise.all([") &&
      page.includes("getTenantAuthPolicy({ role: actorRole, authHeader })"),
    "Admin auth policy page must derive shared server auth/session context and load the tenant auth policy from the API.",
  );

  assert(
    page.includes('actorRole !== "admin"') &&
      page.includes("Admin Role Required") &&
      page.includes("tenant auth policy changes stay admin-only"),
    "Admin auth policy page must explain the admin-only boundary for non-admin viewers instead of pretending the route is universally writable.",
  );

  assert(
    page.includes('status === "auth-policy-error"') &&
      page.includes('status === "auth-policy-updated"') &&
      page.includes('message={errorMessage || "Unable to update tenant auth policy."}'),
    "Admin auth policy page must surface inline success and failure feedback.",
  );

  assert(
    page.includes("runtimeApplied.sessionTimeout") &&
      page.includes("runtimeApplied.mfaEnrollment") &&
      page.includes("runtimeApplied.externalIdentity") &&
      page.includes("Session timeout takes effect now.") &&
      (page.includes("persisted and audited for follow-on enforcement") || page.includes('href="/admin/oidc"') || page.includes('href="/admin/auth-policy/oidc"')),
    "Admin auth policy page must keep runtime truth honest by separating active session-timeout enforcement from stored-only MFA and OIDC intent.",
  );

  assert(
    page.includes("form action={updateTenantAuthPolicyAction}") &&
      page.includes('name="externalIdentityMode"') &&
      page.includes('name="mfaRequired"') &&
      page.includes('name="mfaGracePeriodDays"') &&
      page.includes('name="sessionTimeoutMinutes"') &&
      page.includes('name="allowedAuthMethods"') &&
      page.includes('href="/admin/audit"'),
    "Admin auth policy page must expose the tenant auth policy form, the supported fields, and the audit follow-up path.",
  );

  assert(
    actions.includes("await updateTenantAuthPolicy(") &&
      actions.includes('if (actorRole !== "admin") {') &&
      actions.includes('redirect("/admin/auth-policy?status=auth-policy-updated");') &&
      actions.includes('redirectWithError(error instanceof Error ? error.message : "Unable to update tenant auth policy."'),
    "Admin auth policy server actions must stay admin-only, patch through the shared API layer, and keep failures inline.",
  );

  assert(
    adminPage.includes('href: "/admin/auth-policy"') &&
      workspacePage.includes('href: "/admin/auth-policy"') &&
      sidebar.includes('href: "/admin/auth-policy"'),
    "Admin auth policy must be discoverable from the admin hub, admin workspace handoff, and main sidebar.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "admin_auth_policy_route_uses_shared_server_auth_context",
          "admin_auth_policy_route_explains_admin_only_boundary",
          "admin_auth_policy_route_surfaces_inline_status_feedback",
          "admin_auth_policy_route_keeps_runtime_truth_honest",
          "admin_auth_policy_route_exposes_form_and_audit_followup",
          "admin_auth_policy_server_action_is_admin_only",
          "admin_auth_policy_navigation_links_are_present",
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
  console.error("Admin auth policy route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
