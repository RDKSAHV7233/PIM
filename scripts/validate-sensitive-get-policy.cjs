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
const API_CLIENT_SCOPES = new Set(["catalog.read", "catalog.write"]);
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
  issue_inbox_scoped: {
    classification: "scope_filtered",
    responseHandling: "none",
    apiClientPolicy: "denied_human_only",
  },
  media_assets_scoped: {
    classification: "scope_filtered",
    responseHandling: "none",
    apiClientPolicy: "denied_human_only",
  },
  notification_self_service: {
    classification: "self_service",
    responseHandling: "redact",
    apiClientPolicy: "denied_human_only",
  },
  taxonomy_safe_metadata: {
    classification: "human_only",
    responseHandling: "none",
    apiClientPolicy: "denied_human_only",
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
      continue;
    }
    if (/export\s+class\s+\w+/.test(trimmed)) {
      classDecorators = [...pendingDecorators];
      pendingDecorators = [];
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
      continue;
    }
    if (!trimmed.startsWith("//")) {
      pendingDecorators = [];
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
  const errors = [];

  for (const absoluteFile of controllerFiles) {
    const { relativeFile, classDecorators, methods } = parseControllerFile(absoluteFile);
    const controllerPrefix = parseControllerPrefix(classDecorators);
    const classIsPublic = hasDecorator(classDecorators, "Public");
    const classReadConfig = parseAuthenticatedReadConfig(classDecorators);
    const classReadPolicyId = parseReadAccessPolicyId(classDecorators);
    const classApiClientPolicy = parseApiClientPolicy(classDecorators);
    const classApiClientScopes = parseApiClientScopes(classDecorators);

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
      const apiClientPolicy =
        parseApiClientPolicy(methodEntry.decorators) ??
        classApiClientPolicy ??
        methodReadConfig?.apiClientPolicy ??
        classReadConfig?.apiClientPolicy ??
        readPolicyConfig?.apiClientPolicy ??
        null;
      const apiClientScopes = parseApiClientScopes(methodEntry.decorators).length
        ? parseApiClientScopes(methodEntry.decorators)
        : classApiClientScopes;

      authenticatedRoutes.push(descriptor);

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

  return {
    authenticatedReads,
    authenticatedRoutes,
    publicRoutes,
    classificationCounts,
    apiPolicyCounts,
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
