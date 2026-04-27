#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ROLE_UTILS_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "common", "rbac", "role-utils.js");
const ROLES_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "common", "rbac", "roles.js");
const RBAC_GUARD_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "common", "rbac", "rbac.guard.js");
const READ_POLICY_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "common", "rbac", "read-access-policy.decorator.js");
const API_CLIENT_POLICY_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "common", "rbac", "api-client-policy.decorator.js");
const PUBLIC_DECORATOR_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "auth", "public.decorator.js");
const SCHEMA_PATH = path.join(REPO_ROOT, "packages", "db", "prisma", "schema.prisma");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createReflector() {
  return {
    getAllAndOverride(key, targets) {
      for (const target of targets) {
        if (target && Object.prototype.hasOwnProperty.call(target, key)) {
          return target[key];
        }
      }
      return undefined;
    },
  };
}

function createExecutionContext(request, handler = {}, controller = {}) {
  return {
    getHandler() {
      return handler;
    },
    getClass() {
      return controller;
    },
    switchToHttp() {
      return {
        getRequest() {
          return request;
        },
      };
    },
  };
}

function main() {
  assert(fs.existsSync(ROLE_UTILS_ENTRY), `Build output missing: ${ROLE_UTILS_ENTRY}`);
  assert(fs.existsSync(ROLES_ENTRY), `Build output missing: ${ROLES_ENTRY}`);
  assert(fs.existsSync(RBAC_GUARD_ENTRY), `Build output missing: ${RBAC_GUARD_ENTRY}`);
  assert(fs.existsSync(READ_POLICY_ENTRY), `Build output missing: ${READ_POLICY_ENTRY}`);
  assert(fs.existsSync(API_CLIENT_POLICY_ENTRY), `Build output missing: ${API_CLIENT_POLICY_ENTRY}`);
  assert(fs.existsSync(PUBLIC_DECORATOR_ENTRY), `Build output missing: ${PUBLIC_DECORATOR_ENTRY}`);
  const roleUtils = require(ROLE_UTILS_ENTRY);
  const roles = require(ROLES_ENTRY);
  const { RbacGuard } = require(RBAC_GUARD_ENTRY);
  const { AUTHENTICATED_READ_ROUTE_KEY } = require(READ_POLICY_ENTRY);
  const { API_CLIENT_ROUTE_POLICY_KEY, API_CLIENT_REQUIRED_SCOPES_KEY } = require(API_CLIENT_POLICY_ENTRY);
  const { IS_PUBLIC_KEY } = require(PUBLIC_DECORATOR_ENTRY);
  const schema = fs.readFileSync(SCHEMA_PATH, "utf8");

  const singleRole = roleUtils.resolveEffectiveRoles({
    legacyRole: "viewer",
    principalType: "human",
  });
  assert(singleRole.primaryAppRole === "viewer", `expected single legacy role to resolve to viewer, got ${singleRole.primaryAppRole}`);

  const multiRole = roleUtils.resolveEffectiveRoles({
    legacyRole: "viewer",
    assignedRoles: ["reviewer", "editor", "product_admin"],
    principalType: "human",
  });
  assert(multiRole.primaryAppRole === "editor", `expected highest app role to resolve to editor, got ${multiRole.primaryAppRole}`);
  assert(multiRole.appRoles.includes("viewer") && multiRole.appRoles.includes("editor"), "expected multi-role app role union");
  assert(multiRole.adminBoundaryRoles.includes("product_admin"), "expected product_admin boundary role to be retained for human principal");

  const apiClientRole = roleUtils.resolveEffectiveRoles({
    legacyRole: "viewer",
    assignedRoles: ["admin", "system_admin", "product_admin"],
    principalType: "api_client",
  });
  assert(apiClientRole.primaryAppRole === "viewer", `expected api client to keep legacy least-privilege role, got ${apiClientRole.primaryAppRole}`);
  assert(apiClientRole.adminBoundaryRoles.length === 0, "expected api client to strip admin-boundary roles");
  assert(!apiClientRole.foundationRoles.includes("admin"), "expected api client not to inherit human-assigned admin role");

  assert(
    roleUtils.hasAdminBoundaryCapability(["product_admin"], "manage_product_data") === true,
    "expected product_admin to manage product data",
  );
  assert(
    roleUtils.hasAdminBoundaryCapability(["product_admin"], "manage_users") === false,
    "expected product_admin to be denied user management",
  );
  assert(
    roleUtils.hasAdminBoundaryCapability(["system_admin"], "manage_users") === true,
    "expected system_admin to manage users",
  );
  assert(
    roleUtils.hasAdminBoundaryCapability(["super_admin"], "manage_platform") === true,
    "expected super_admin to manage platform",
  );

  const expectedScopeTypes = ["vendor", "owner", "supplier", "locale", "market", "catalog", "team", "assignee"];
  for (const scopeType of expectedScopeTypes) {
    assert(schema.includes(`  ${scopeType}`), `expected AccessScopeType schema to include ${scopeType}`);
  }

  process.env.PIM_ENFORCE_READ_CLASSIFICATION = "true";
  process.env.PIM_ACCESS_POLICY_SHADOW_MODE = "false";
  const guard = new RbacGuard(
    createReflector(),
    {
      async record() {},
    },
    {
      can() {
        return {
          allowed: true,
          reasonCode: "TEST_POLICY_ALLOWED",
          actorType: "human",
          action: "GET /test",
          resource: "/test",
          tenantId: "default",
          context: {},
        };
      },
      async recordShadowMismatch() {},
    },
  );

  const publicRequest = { method: "GET", url: "/public/health" };
  const publicHandler = { [IS_PUBLIC_KEY]: true };
  const publicAllowed = guard.canActivate(createExecutionContext(publicRequest, publicHandler));

  const classifiedRequest = {
    method: "GET",
    url: "/account/privacy-status",
    pimTenant: "default",
    pimUserId: "viewer-1",
    pimRole: "viewer",
    pimAuthType: "user_jwt",
  };
  const classifiedHandler = {
    [AUTHENTICATED_READ_ROUTE_KEY]: {
      classification: "self_service",
      responseHandling: "none",
      apiClientPolicy: "denied_human_only",
    },
    [API_CLIENT_ROUTE_POLICY_KEY]: "denied_human_only",
  };
  const classifiedAllowed = guard.canActivate(createExecutionContext(classifiedRequest, classifiedHandler));

  const unclassifiedRequest = {
    method: "GET",
    url: "/internal/unclassified",
    pimTenant: "default",
    pimUserId: "viewer-2",
    pimRole: "viewer",
    pimAuthType: "user_jwt",
  };

  const apiClientRequest = {
    method: "GET",
    url: "/internal/api-client-default-deny",
    pimTenant: "default",
    pimUserId: "api-key-1",
    pimRole: "editor",
    pimAuthType: "api_key",
  };
  const apiClientHandler = {
    [AUTHENTICATED_READ_ROUTE_KEY]: {
      classification: "admin_editor",
      responseHandling: "none",
    },
  };

  const apiClientScopedAllowedRequest = {
    method: "GET",
    url: "/catalog/products",
    pimTenant: "default",
    pimUserId: "api-key-2",
    pimRole: "editor",
    pimAuthType: "api_key",
    pimApiScopes: ["catalog.read"],
  };
  const apiClientScopedAllowedHandler = {
    [AUTHENTICATED_READ_ROUTE_KEY]: {
      classification: "role_redacted",
      responseHandling: "redact",
      apiClientPolicy: "allowed_with_api_scope",
    },
    [API_CLIENT_ROUTE_POLICY_KEY]: "allowed_with_api_scope",
    [API_CLIENT_REQUIRED_SCOPES_KEY]: ["catalog.read"],
  };

  const apiClientScopedDeniedRequest = {
    method: "GET",
    url: "/catalog/products",
    pimTenant: "default",
    pimUserId: "api-key-3",
    pimRole: "editor",
    pimAuthType: "api_key",
    pimApiScopes: ["catalog.write"],
  };

  return Promise.all([
    publicAllowed,
    classifiedAllowed,
    guard.canActivate(createExecutionContext(apiClientScopedAllowedRequest, apiClientScopedAllowedHandler)),
    guard.canActivate(createExecutionContext(unclassifiedRequest)).then(
      () => {
        throw new Error("expected unclassified authenticated read to fail closed");
      },
      (error) => {
        const reason = error?.response?.reason ?? error?.response?.message ?? error?.message;
        assert(
          String(reason).includes("AUTHENTICATED_READ_CLASSIFICATION_REQUIRED"),
          `expected classification-required denial, got ${String(reason)}`,
        );
      },
    ),
    guard.canActivate(createExecutionContext(apiClientRequest, apiClientHandler)).then(
      () => {
        throw new Error("expected api client to be denied by default without explicit allow");
      },
      (error) => {
        const reason = error?.response?.reason ?? error?.response?.message ?? error?.message;
        assert(String(reason).includes("API_CLIENT_FORBIDDEN"), `expected API_CLIENT_FORBIDDEN, got ${String(reason)}`);
      },
    ),
    guard.canActivate(createExecutionContext(apiClientScopedDeniedRequest, apiClientScopedAllowedHandler)).then(
      () => {
        throw new Error("expected api client with unrelated scope to be denied");
      },
      (error) => {
        const reason = error?.response?.reason ?? error?.response?.message ?? error?.message;
        assert(
          String(reason).includes("API_CLIENT_SCOPE_FORBIDDEN"),
          `expected API_CLIENT_SCOPE_FORBIDDEN, got ${String(reason)}`,
        );
      },
    ),
  ])
    .then((results) => {
      assert(results[0] === true, "expected public route to bypass authenticated-read enforcement");
      assert(results[1] === true, "expected classified authenticated read to remain allowed");
      assert(results[2] === true, "expected api client with matching scope to remain allowed");
      console.log(
        JSON.stringify(
          {
            status: "ok",
            validated: [
              "single_role_resolution_preserves_current_behavior",
              "multi_role_resolution_uses_explicit_highest_app_role",
              "api_client_role_resolution_strips_human_multi_role_escalation",
              "admin_boundary_capabilities_distinguish_product_and_system_admin",
              "scope_schema_represents_future_dimensions",
              "classified_authenticated_reads_continue_to_pass_under_runtime_enforcement",
              "unclassified_authenticated_reads_fail_closed_at_runtime",
              "public_routes_bypass_authenticated_read_runtime_enforcement",
              "api_clients_remain_default_deny_without_explicit_route_allow",
              "api_clients_require_matching_declared_route_scopes",
            ],
            checkedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
    })
    .catch((error) => {
      throw error;
    });
}

try {
  const result = main();
  if (result && typeof result.then === "function") {
    result.catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
