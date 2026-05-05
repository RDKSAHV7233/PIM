#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const API_SRC_ROOT = path.join(REPO_ROOT, "apps", "api", "src");
const CONTROLLER_SUFFIX = ".controller.ts";
const HTTP_DECORATORS = ["Get", "Head", "Post", "Patch", "Put", "Delete"];
const AUTHENTICATED_READ_METHODS = new Set(["GET", "HEAD"]);
const READ_CLASSIFICATIONS = new Set([
  "public_safe",
  "self_service",
  "admin_only",
  "admin_editor",
  "role_redacted",
  "scope_filtered",
  "human_only",
  "api_client_allowed",
  "deprecated_or_blocked",
]);
const API_CLIENT_POLICIES = new Set([
  "denied_human_only",
  "allowed_with_api_scope",
  "allowed_service_internal",
  "not_applicable",
]);
const API_CLIENT_SCOPES = new Set([
  "catalog.read",
  "catalog.write",
  "bulk_import.read",
  "media.read",
  "compliance.read",
  "issues.read",
  "rejection_intelligence.read",
  "auto_suggestions.read",
  "taxonomy.read",
]);
const ADMIN_BOUNDARY_EXPECTATIONS = {
  "GET /admin/workspace/users": { capability: "manage_users" },
  "GET /admin/workspace/access-scopes": { capability: "manage_security" },
  "POST /admin/workspace/access-scopes": { allowedRoles: ["super_admin"], allowLegacyAdminFallback: true },
  "DELETE /admin/workspace/access-scopes/:assignmentId": { allowedRoles: ["super_admin"], allowLegacyAdminFallback: true },
  "GET /admin/api-keys": { capability: "manage_security" },
  "POST /admin/api-keys": { capability: "manage_security" },
  "POST /admin/api-keys/:id/revoke": { capability: "manage_security" },
  "GET /admin/webhooks": { capability: "manage_security" },
  "GET /admin/webhooks/deliveries": { capability: "manage_security" },
  "POST /admin/webhooks": { capability: "manage_security" },
  "PATCH /admin/webhooks/:id": { capability: "manage_security" },
  "POST /admin/webhooks/:id/test": { capability: "manage_security" },
  "DELETE /admin/webhooks/:id": { capability: "manage_security" },
  "GET /audit/logs": { capability: "manage_security" },
  "GET /audit/events": { capability: "manage_security" },
  "GET /audit/events/export": { capability: "manage_security" },
  "GET /health/internal": { capability: "manage_security" },
  "GET /billing/plan-profile": { allowedRoles: ["system_admin", "super_admin"] },
  "POST /billing/billing-contact": { allowedRoles: ["system_admin", "super_admin"] },
  "GET /billing/upgrade-request": { allowedRoles: ["system_admin", "super_admin"] },
  "POST /billing/upgrade-request": { allowedRoles: ["system_admin", "super_admin"] },
  "GET /dashboard/readiness": { capability: "manage_product_data" },
  "GET /dashboard/catalog-health": { capability: "manage_product_data" },
  "GET /dashboard/health": { capability: "manage_product_data" },
  "GET /dashboard/operations-summary": { capability: "manage_product_data" },
  "GET /metrics/kpi-trends": { capability: "manage_product_data" },
  "POST /taxonomy/categories": { capability: "manage_product_data" },
  "PATCH /taxonomy/categories/:id": { capability: "manage_product_data" },
  "DELETE /taxonomy/categories/:id": { capability: "manage_product_data" },
  "POST /taxonomy/categories/:id/attributes": { capability: "manage_product_data" },
  "PATCH /taxonomy/categories/attributes/:attributeId": { capability: "manage_product_data" },
  "DELETE /taxonomy/categories/attributes/:attributeId": { capability: "manage_product_data" },
  "GET /compliance/rules": { capability: "manage_product_data" },
  "POST /compliance/rules": { capability: "manage_product_data" },
  "PATCH /compliance/rules/:id": { capability: "manage_product_data" },
  "DELETE /compliance/rules/:id": { capability: "manage_product_data" },
  "GET /marketplace/products/:id/simulate": { capability: "manage_product_data" },
  "POST /marketplace/products/:id/simulate": { capability: "manage_product_data" },
  "POST /marketplace/connectors/:connectorSlug/mappings/versions/:versionId/archive": { capability: "manage_product_data" },
  "POST /marketplace/connectors/:connectorSlug/mappings/preflight": { capability: "manage_product_data" },
  "POST /marketplace/connectors/:connectorSlug/publish-readiness": { capability: "manage_product_data" },
  "GET /marketplace/export-jobs": { capability: "manage_product_data" },
  "GET /marketplace/export-jobs/:id": { capability: "manage_product_data" },
  "POST /marketplace/export-jobs/:id/process": { capability: "manage_product_data" },
  "POST /marketplace/export-jobs/:id/requeue": { capability: "manage_product_data" },
  "POST /marketplace/readiness/batch": { capability: "manage_product_data" },
  "DELETE /connectors/:slug/install/:id": { capability: "manage_security" },
  "GET /connectors/permissions": { capability: "manage_security" },
  "POST /connectors/permissions": { capability: "manage_security" },
  "DELETE /connectors/permissions/:id": { capability: "manage_security" },
};
const READ_POLICY_CONFIG = {
  account_privacy_self_service: {
    classification: "self_service",
    responseHandling: "none",
    apiClientPolicy: "denied_human_only",
  },
  account_export_download_self_service: {
    classification: "self_service",
    responseHandling: "none",
    apiClientPolicy: "denied_human_only",
  },
  catalog_stats_redacted: {
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "allowed_with_api_scope",
  },
  catalog_products_redacted: {
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "allowed_with_api_scope",
  },
  catalog_product_detail_redacted: {
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "allowed_with_api_scope",
  },
  catalog_search_redacted: {
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "allowed_with_api_scope",
  },
  catalog_variants_redacted: {
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "allowed_with_api_scope",
  },
  dashboard_health_redacted: {
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  workspace_users_governance_redacted: {
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  workspace_access_scopes_governance_redacted: {
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  api_keys_governance_redacted: {
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  connector_permissions_governance_redacted: {
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  billing_plan_profile_governance_redacted: {
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  billing_upgrade_request_governance_redacted: {
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  audit_events_governance_redacted: {
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  audit_logs_governance_redacted: {
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  outbound_webhooks_governance_redacted: {
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  outbound_webhook_deliveries_governance_redacted: {
    classification: "role_redacted",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  issue_inbox_scoped: {
    classification: "scope_filtered",
    responseHandling: "none",
    apiClientPolicy: "allowed_with_api_scope",
  },
  media_assets_scoped: {
    classification: "scope_filtered",
    responseHandling: "none",
    apiClientPolicy: "allowed_with_api_scope",
  },
  notification_self_service: {
    classification: "self_service",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  taxonomy_safe_metadata: {
    classification: "scope_filtered",
    responseHandling: "none",
    apiClientPolicy: "allowed_with_api_scope",
  },
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(relativePath) {
  const absolute = path.join(REPO_ROOT, relativePath);
  assert(fs.existsSync(absolute), `Missing file: ${relativePath}`);
  return fs.readFileSync(absolute, "utf8");
}

function collectControllerFiles(rootDir) {
  const files = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const absolute = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectControllerFiles(absolute));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(CONTROLLER_SUFFIX)) {
      files.push(absolute);
    }
  }
  return files.sort();
}

function parseControllerFile(absoluteFile) {
  const lines = fs.readFileSync(absoluteFile, "utf8").split(/\r?\n/);
  let pendingDecorators = [];
  let pendingDecoratorDepth = 0;
  let classDecorators = [];
  const methods = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("@")) {
      pendingDecorators.push(trimmed);
      pendingDecoratorDepth += countDecoratorParens(trimmed);
      continue;
    }
    if (/export\s+class\s+\w+/.test(trimmed)) {
      classDecorators = [...pendingDecorators];
      pendingDecorators = [];
      pendingDecoratorDepth = 0;
      continue;
    }
    if (
      pendingDecorators.length > 0 &&
      /^((public|private|protected)\s+)?(async\s+)?[A-Za-z0-9_]+\s*\(/.test(trimmed)
    ) {
      methods.push({
        decorators: [...pendingDecorators],
        signature: trimmed,
        line: index + 1,
      });
      pendingDecorators = [];
      pendingDecoratorDepth = 0;
      continue;
    }
    if (pendingDecorators.length > 0 && pendingDecoratorDepth > 0) {
      pendingDecoratorDepth += countDecoratorParens(trimmed);
      continue;
    }
    if (!trimmed.startsWith("//")) {
      pendingDecorators = [];
      pendingDecoratorDepth = 0;
    }
  }

  return {
    relativeFile: path.relative(REPO_ROOT, absoluteFile).replaceAll("\\", "/"),
    classDecorators,
    methods,
  };
}

function parseControllerPrefix(decorators) {
  const controllerLine = decorators.find((line) => line.includes("@Controller("));
  if (!controllerLine) {
    return "";
  }
  const match = controllerLine.match(/@Controller\((?:"([^"]*)"|'([^']*)')?\)/);
  return (match?.[1] ?? match?.[2] ?? "").trim();
}

function parseHttpDecorator(decorators) {
  for (const decorator of decorators) {
    for (const name of HTTP_DECORATORS) {
      if (decorator.startsWith(`@${name}(`) || decorator === `@${name}()`) {
        const match = decorator.match(new RegExp(`@${name}\\((?:"([^"]*)"|'([^']*)')?\\)`));
        return {
          method: name.toUpperCase(),
          route: (match?.[1] ?? match?.[2] ?? "").trim(),
        };
      }
    }
  }
  return null;
}

function hasDecorator(decorators, name) {
  return decorators.some((line) => line.startsWith(`@${name}(`) || line === `@${name}()`);
}

function parseAuthenticatedReadConfig(decorators) {
  const line = decorators.find((entry) => entry.includes("@AuthenticatedReadRoute("));
  if (!line) {
    return null;
  }
  const classification = captureQuotedValue(line, "classification");
  const responseHandling = captureQuotedValue(line, "responseHandling");
  const apiClientPolicy = captureQuotedValue(line, "apiClientPolicy");
  return {
    classification,
    responseHandling,
    apiClientPolicy,
  };
}

function parseReadAccessPolicyId(decorators) {
  const line = decorators.find((entry) => entry.includes("@ReadAccessPolicy("));
  if (!line) {
    return null;
  }
  const match = line.match(/@ReadAccessPolicy\((?:"([^"]+)"|'([^']+)')\)/);
  return match?.[1] ?? match?.[2] ?? null;
}

function parseApiClientPolicy(decorators) {
  const explicit = decorators.find((entry) => entry.includes("@ApiClientPolicy("));
  if (explicit) {
    const match = explicit.match(/@ApiClientPolicy\((?:"([^"]+)"|'([^']+)')\)/);
    return match?.[1] ?? match?.[2] ?? null;
  }
  if (decorators.some((entry) => entry.includes("@DisallowApiClient(") || entry === "@DisallowApiClient()")) {
    return "denied_human_only";
  }
  return null;
}

function parseApiClientScopes(decorators) {
  const line = decorators.find((entry) => entry.includes("@ApiClientScopes("));
  if (!line) {
    return [];
  }
  const matches = [...line.matchAll(/["']([^"']+)["']/g)];
  return matches.map((match) => match[1]).filter(Boolean);
}

function countDecoratorParens(line) {
  const openCount = (line.match(/\(/g) ?? []).length;
  const closeCount = (line.match(/\)/g) ?? []).length;
  return openCount - closeCount;
}

function parseAdminBoundaryConfig(decorators) {
  const line = decorators.find((entry) => entry.includes("@AdminBoundaryAccess("));
  if (!line) {
    return null;
  }
  const capability = captureQuotedValue(line, "capability");
  const allowLegacyAdminFallbackMatch = line.match(/allowLegacyAdminFallback\s*:\s*(true|false)/);
  const allowedRolesSection = line.match(/allowedRoles\s*:\s*\[([^\]]*)\]/);
  const allowedRoles = allowedRolesSection
    ? [...allowedRolesSection[1].matchAll(/["']([^"']+)["']/g)].map((match) => match[1])
    : [];
  return {
    capability,
    allowedRoles,
    allowLegacyAdminFallback: allowLegacyAdminFallbackMatch
      ? allowLegacyAdminFallbackMatch[1] === "true"
      : null,
  };
}

function captureQuotedValue(line, property) {
  const regex = new RegExp(`${property}\\s*:\\s*(?:"([^"]+)"|'([^']+)')`);
  const match = line.match(regex);
  return match?.[1] ?? match?.[2] ?? null;
}

function joinRoute(prefix, route) {
  const segments = [];
  if (prefix) {
    segments.push(prefix.replace(/^\/+|\/+$/g, ""));
  }
  if (route) {
    segments.push(route.replace(/^\/+|\/+$/g, ""));
  }
  const joined = segments.filter(Boolean).join("/");
  return `/${joined}`.replace(/\/+/g, "/");
}

function analyzeRoutes() {
  const controllerFiles = collectControllerFiles(API_SRC_ROOT);
  const authenticatedReads = [];
  const authenticatedRoutes = [];
  const publicRoutes = [];
  const classificationCounts = new Map();
  const apiPolicyCounts = new Map();
  const adminBoundaryCoverage = new Map();
  const errors = [];

  for (const absoluteFile of controllerFiles) {
    const { relativeFile, classDecorators, methods } = parseControllerFile(absoluteFile);
    const controllerPrefix = parseControllerPrefix(classDecorators);
    const classIsPublic = hasDecorator(classDecorators, "Public");
    const classReadConfig = parseAuthenticatedReadConfig(classDecorators);
    const classReadPolicyId = parseReadAccessPolicyId(classDecorators);
    const classApiClientPolicy = parseApiClientPolicy(classDecorators);
    const classApiClientScopes = parseApiClientScopes(classDecorators);
    const classAdminBoundaryConfig = parseAdminBoundaryConfig(classDecorators);

    for (const methodEntry of methods) {
      const http = parseHttpDecorator(methodEntry.decorators);
      if (!http) {
        continue;
      }
      const methodIsPublic = hasDecorator(methodEntry.decorators, "Public");
      const isPublicRoute = classIsPublic || methodIsPublic;
      const routePath = joinRoute(controllerPrefix, http.route);
      const descriptor = `${http.method} ${routePath} (${relativeFile}:${methodEntry.line})`;
      if (isPublicRoute) {
        publicRoutes.push(descriptor);
        continue;
      }

      const methodReadPolicyId = parseReadAccessPolicyId(methodEntry.decorators);
      const readPolicyId = methodReadPolicyId ?? classReadPolicyId;
      const readPolicyConfig = readPolicyId ? READ_POLICY_CONFIG[readPolicyId] ?? null : null;
      const methodReadConfig = parseAuthenticatedReadConfig(methodEntry.decorators);
      const readConfig = methodReadConfig ?? classReadConfig ?? readPolicyConfig;
      const methodApiClientPolicy = parseApiClientPolicy(methodEntry.decorators);
      const apiClientPolicy =
        methodApiClientPolicy ??
        methodReadConfig?.apiClientPolicy ??
        readPolicyConfig?.apiClientPolicy ??
        classApiClientPolicy ??
        classReadConfig?.apiClientPolicy ??
        null;
      const apiClientScopes = parseApiClientScopes(methodEntry.decorators).length
        ? parseApiClientScopes(methodEntry.decorators)
        : classApiClientScopes;
      const adminBoundaryConfig = parseAdminBoundaryConfig(methodEntry.decorators) ?? classAdminBoundaryConfig;

      authenticatedRoutes.push(descriptor);
      adminBoundaryCoverage.set(`${http.method} ${routePath}`, adminBoundaryConfig);

      if (!apiClientPolicy || !API_CLIENT_POLICIES.has(apiClientPolicy)) {
        errors.push(`${descriptor} is missing explicit API-client policy coverage`);
      } else {
        apiPolicyCounts.set(apiClientPolicy, (apiPolicyCounts.get(apiClientPolicy) ?? 0) + 1);
      }
      if (apiClientPolicy === "allowed_with_api_scope") {
        if (apiClientScopes.length === 0) {
          errors.push(`${descriptor} allows API clients but does not declare required API-client scopes`);
        }
        for (const scope of apiClientScopes) {
          if (!API_CLIENT_SCOPES.has(scope)) {
            errors.push(`${descriptor} declares unsupported API-client scope '${scope}'`);
          }
        }
      } else if (apiClientScopes.length > 0) {
        errors.push(`${descriptor} declares API-client scopes without allowed_with_api_scope policy`);
      }

      if (!AUTHENTICATED_READ_METHODS.has(http.method)) {
        continue;
      }

      authenticatedReads.push(descriptor);
      const classification = readConfig?.classification ?? null;
      const responseHandling = readConfig?.responseHandling ?? null;
      if (!classification || !READ_CLASSIFICATIONS.has(classification)) {
        errors.push(`${descriptor} is missing authenticated read classification`);
        continue;
      }
      if (responseHandling !== "none" && responseHandling !== "redact") {
        errors.push(`${descriptor} is missing read response handling declaration`);
      }
      classificationCounts.set(classification, (classificationCounts.get(classification) ?? 0) + 1);
    }
  }

  for (const [routeKey, expectation] of Object.entries(ADMIN_BOUNDARY_EXPECTATIONS)) {
    const actual = adminBoundaryCoverage.get(routeKey);
    if (!actual) {
      errors.push(`${routeKey} is missing AdminBoundaryAccess coverage`);
      continue;
    }
    if (expectation.capability && actual.capability !== expectation.capability) {
      errors.push(`${routeKey} expected admin-boundary capability '${expectation.capability}', got '${String(actual.capability)}'`);
    }
    if (expectation.allowedRoles) {
      const actualRoles = Array.isArray(actual.allowedRoles) ? actual.allowedRoles : [];
      if (actualRoles.join(",") !== expectation.allowedRoles.join(",")) {
        errors.push(`${routeKey} expected admin-boundary roles [${expectation.allowedRoles.join(", ")}], got [${actualRoles.join(", ")}]`);
      }
    }
    if (typeof expectation.allowLegacyAdminFallback === "boolean" &&
      actual.allowLegacyAdminFallback !== expectation.allowLegacyAdminFallback) {
      errors.push(
        `${routeKey} expected allowLegacyAdminFallback=${String(expectation.allowLegacyAdminFallback)}, got ${String(actual.allowLegacyAdminFallback)}`,
      );
    }
  }

  return {
    authenticatedReads,
    authenticatedRoutes,
    publicRoutes,
    classificationCounts,
    apiPolicyCounts,
    adminBoundaryCoverage,
    errors,
  };
}

function validateRedactionHandlers() {
  const accessPolicySource = read("apps/api/src/common/access-policy/access-policy.service.ts");
  const errors = [];
  for (const [policy, config] of Object.entries(READ_POLICY_CONFIG)) {
    if (config.responseHandling !== "redact") {
      continue;
    }
    if (!accessPolicySource.includes(`case "${policy}"`)) {
      errors.push(`Read policy ${policy} requires central redaction but has no applyReadResponsePolicy handler`);
    }
  }
  return errors;
}

function main() {
  const routeAnalysis = analyzeRoutes();
  const errors = [...routeAnalysis.errors, ...validateRedactionHandlers()];
  assert(errors.length === 0, errors.join("\n"));
  console.log(
    JSON.stringify(
      {
        status: "ok",
        suite: "SENSITIVE_GET_POLICY_GUARD",
        authenticatedReadRoutes: routeAnalysis.authenticatedReads.length,
        authenticatedRoutes: routeAnalysis.authenticatedRoutes.length,
        publicRoutes: routeAnalysis.publicRoutes.length,
        classificationCoverage: Object.fromEntries(routeAnalysis.classificationCounts),
        apiClientPolicyCoverage: Object.fromEntries(routeAnalysis.apiPolicyCounts),
        adminBoundaryCheckedRoutes: Object.keys(ADMIN_BOUNDARY_EXPECTATIONS).length,
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
