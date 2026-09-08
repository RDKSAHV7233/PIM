#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "auth-policy", "oidc", "page.tsx");
const SYSTEM_ADMIN_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "oidc", "page.tsx");
const ACTIONS = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "auth-policy", "oidc", "actions.ts");
const PARENT_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "auth-policy", "page.tsx");
const ADMIN_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "page.tsx");
const API_CLIENT = path.join(REPO_ROOT, "apps", "web", "src", "lib", "api", "admin.ts");
const OIDC_CONTROLLER = path.join(REPO_ROOT, "apps", "api", "src", "auth", "oidc.controller.ts");
const STEP_UP_DTO = path.join(REPO_ROOT, "apps", "api", "src", "auth", "dto", "step-up.dto.ts");
const JWT = path.join(REPO_ROOT, "apps", "api", "src", "auth", "jwt.ts");

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
  const systemAdminPage = read(SYSTEM_ADMIN_PAGE);
  const actions = read(ACTIONS);
  const parentPage = read(PARENT_PAGE);
  const adminPage = read(ADMIN_PAGE);
  const apiClient = read(API_CLIENT);
  const oidcController = read(OIDC_CONTROLLER);
  const stepUpDto = read(STEP_UP_DTO);
  const jwt = read(JWT);

  // ── Page derives shared server auth/session context ────────────────────────
  assert(
      page.includes('redirect(buildLoginRedirect("/admin/auth-policy/oidc", 401));') &&
      page.includes("await getServerSession();"),
    "OIDC admin page must derive shared server auth/session context and redirect anonymous visitors to login.",
  );

  // ── Page explains admin-only boundary ──────────────────────────────────────
  assert(
    page.includes('actorRole !== "admin"') &&
      page.includes("Restricted") &&
      page.includes("workspace administrators can view or change OIDC SSO configuration"),
    "OIDC admin page must explain the admin-only boundary for non-admin viewers instead of pretending the route is universally writable.",
  );

  // ── Page surfaces status banners ────────────────────────────────────────────
  assert(
    page.includes('status === "oidc-saved"') &&
      page.includes('status === "oidc-deleted"') &&
      page.includes('status === "oidc-error"'),
    "OIDC admin page must surface inline success, info, and failure feedback via the status query parameter.",
  );

  assert(
    page.includes("OidcUnavailableState") &&
      page.includes("OIDC configuration is temporarily unavailable") &&
      page.includes("Retry OIDC settings"),
    "OIDC admin page must expose a dedicated unavailable state instead of guessing config or plan truth when upstream reads fail.",
  );

  // ── Page exposes upsert form with required fields ──────────────────────────
  assert(
    page.includes("form action={upsertOidcConfigAction}") &&
      page.includes('name="issuer"') &&
      page.includes('name="clientId"') &&
      page.includes('name="clientSecret"') &&
      page.includes('name="callbackUrl"') &&
      page.includes('name="scopes"') &&
      page.includes('name="claimsMapping"'),
    "OIDC admin page must expose the upsert form with all required IdP fields (issuer, clientId, clientSecret, callbackUrl, scopes, claimsMapping).",
  );

  // ── Page surfaces delete form when config exists ───────────────────────────
  assert(
    page.includes("form action={deleteOidcConfigAction}") &&
      page.includes("Disconnect identity provider") &&
      page.includes("Remove OIDC configuration"),
    "OIDC admin page must expose a disconnect form rendered only when configuration exists.",
  );

  // ── Page discloses the pilot-period boundary on enforcement ────────────────
  assert(
    page.includes("Pilot note") &&
      page.includes("requires step-up password") &&
      page.includes("confirmation on every mutation") &&
      page.includes("Full OIDC enforcement claims remain gated until Gate C is complete"),
    "OIDC admin page must disclose both the step-up requirement and the Gate-C enforcement boundary so admins understand what is now safe and what remains gated.",
  );

  // ── Server actions are admin-gated and use the shared API layer ────────────
  assert(
    actions.includes("await upsertOidcConfig(") &&
      actions.includes("await deleteOidcConfig(") &&
      actions.includes('if (actorRole !== "admin") {') &&
      actions.includes("Authenticated session is required.") &&
      actions.includes("Admin role is required."),
    "OIDC server actions must enforce admin-role gating and use the shared upsertOidcConfig / deleteOidcConfig API layer.",
  );

  // ── Server actions validate required inputs ────────────────────────────────
  assert(
    actions.includes("Issuer, client ID, client secret, and callback URL are required.") &&
      actions.includes("parseScopes(") &&
      actions.includes("parseClaimsMapping("),
    "OIDC server actions must validate required inputs and parse scopes/claims-mapping before calling the API.",
  );

  // ── Server actions enforce step-up auth on every mutation ──────────────────
  assert(
    actions.includes("STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK") &&
      actions.includes("issueAuthConfigStepUpToken") &&
      actions.includes("issueStepUp(") &&
      actions.includes("STEP_UP_TOKEN_HEADER"),
    "OIDC server actions must issue a step-up token with the auth_config_high_risk scope on every mutation and pass it via the x-pim-step-up-token header.",
  );

  // ── Step-up password prompt appears on both upsert and delete forms ────────
  assert(
    page.includes('name="stepUpPassword"') &&
      page.includes("Step-up authentication is required for auth-config changes") &&
      page.includes("Step-up authentication is required to remove OIDC sign-in"),
    "OIDC admin page must render a password prompt on both the upsert and delete forms so the user can satisfy the step-up requirement.",
  );

  // ── Backend: jwt.ts declares the new step-up scope constant ────────────────
  assert(
    jwt.includes("STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK") &&
      jwt.includes('"auth_config_high_risk"'),
    "apps/api/src/auth/jwt.ts must declare STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK = 'auth_config_high_risk' so the scope is recognized end-to-end.",
  );

  // ── Backend: step-up DTO accepts the new scope ─────────────────────────────
  assert(
    stepUpDto.includes("STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK") &&
      stepUpDto.includes("STEP_UP_SCOPE_MAPPING_HIGH_RISK") &&
      stepUpDto.includes("STEP_UP_SCOPE_CONNECTOR_CREDENTIALS_HIGH_RISK") &&
      stepUpDto.includes("@IsIn(["),
    "apps/api/src/auth/dto/step-up.dto.ts must accept the auth_config_high_risk scope so /auth/step-up will mint tokens with the new scope.",
  );

  // ── Backend: OIDC controller requires step-up on mutations ─────────────────
  assert(
    oidcController.includes("@RequireStepUp(STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK") &&
      oidcController.includes('"auth.oidc_config.upsert"') &&
      oidcController.includes('"auth.oidc_config.delete"') &&
      oidcController.includes("@UseGuards(StepUpGuard)"),
    "apps/api/src/auth/oidc.controller.ts must apply @RequireStepUp with the auth_config_high_risk scope to both upsertConfig and deleteConfig, guarded by StepUpGuard.",
  );

  // ── Server actions redirect with consistent status keys ────────────────────
  assert(
    actions.includes('buildRedirect("oidc-saved")') &&
      actions.includes('buildRedirect("oidc-deleted")') &&
      actions.includes('buildRedirect("oidc-error"'),
    "OIDC server actions must redirect with the canonical oidc-saved / oidc-deleted / oidc-error status keys the page reads.",
  );

  // ── API client exposes the three required functions ────────────────────────
  assert(
    apiClient.includes("export async function getOidcConfig(") &&
      apiClient.includes("export async function upsertOidcConfig(") &&
      apiClient.includes("export async function deleteOidcConfig(") &&
      apiClient.includes('"/auth/oidc-config"'),
    "Admin API client must expose getOidcConfig / upsertOidcConfig / deleteOidcConfig targeting the /auth/oidc-config endpoint.",
  );

  // ── OIDC config is discoverable from admin hub and from auth-policy ────────
  assert(
    adminPage.includes('href: "/admin/auth-policy/oidc"'),
    "OIDC admin page must be listed on the admin hub for discoverability.",
  );
  assert(
    parentPage.includes('href="/admin/auth-policy/oidc"'),
    "Parent auth-policy page must link to the OIDC configuration page next to the OIDC sign-in toggle.",
  );

  assert(
    systemAdminPage.includes("isSystemAdminBoundary(adminBoundaryRoles)") &&
      systemAdminPage.includes("SystemAdminRequiredCard") &&
      systemAdminPage.includes('redirect(buildLoginRedirect("/admin/oidc", 401));'),
    "/admin/oidc must remain a system-admin-gated OIDC operational surface, separate from the tenant auth-policy OIDC configuration route.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "oidc_admin_route_uses_shared_server_auth_context",
          "oidc_admin_route_explains_admin_only_boundary",
          "oidc_admin_route_surfaces_inline_status_feedback",
          "oidc_admin_route_exposes_upsert_form_fields",
          "oidc_admin_route_exposes_delete_form_when_configured",
          "oidc_admin_route_discloses_pilot_enforcement_boundary",
          "oidc_admin_server_action_is_admin_only",
          "oidc_admin_server_action_validates_required_inputs",
          "oidc_admin_server_action_enforces_step_up_on_mutations",
          "oidc_admin_page_renders_step_up_password_prompts",
          "oidc_admin_backend_declares_auth_config_step_up_scope",
          "oidc_admin_backend_dto_accepts_new_step_up_scope",
          "oidc_admin_backend_controller_requires_step_up_on_mutations",
          "oidc_admin_server_action_redirects_with_canonical_status_keys",
          "oidc_admin_api_client_exposes_required_functions",
          "oidc_admin_navigation_links_are_present",
          "oidc_system_admin_surface_is_boundary_gated",
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
  console.error("Admin OIDC config route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
