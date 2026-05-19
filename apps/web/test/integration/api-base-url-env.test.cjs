#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ROUTE_DIR = path.join(REPO_ROOT, "apps", "web", "src", "app", "api");
const DOCKERFILE_WEB = path.join(REPO_ROOT, "Dockerfile.web");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function walkFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

try {
  const helper = read("apps/web/src/lib/api-base-url.ts");
  const core = read("apps/web/src/lib/api/core.ts");
  const dockerfileWeb = fs.readFileSync(DOCKERFILE_WEB, "utf8");
  const runtimeStage = dockerfileWeb.split("FROM node:20-alpine AS runner")[1] ?? "";
  const apiRouteFiles = walkFiles(API_ROUTE_DIR).filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
  const inlineEnvUsers = apiRouteFiles.filter((file) =>
    fs.readFileSync(file, "utf8").includes("process.env.PIM_API_BASE_URL"),
  );

  assert(
    helper.includes("process.env.PIM_API_BASE_URL_FALLBACK") &&
      helper.includes("process.env.PIM_API_BASE_URL") &&
      helper.includes("process.env.NEXT_PUBLIC_API_URL") &&
      helper.includes("const configuredValues = ["),
    "Shared API base URL helper must support a packaged fallback API base URL after the canonical and legacy env vars for Railway web deployments.",
  );
  assert(
    helper.includes('parsed.pathname = !pathname || pathname === "/" ? "/api/v1" : pathname;'),
    "Shared API base URL helper must normalize root Railway URLs to the canonical /api/v1 base path.",
  );
  assert(
    helper.includes('if (hostname.endsWith(".railway.internal"))') &&
      helper.includes('return hostname.includes(".");'),
    "Shared API base URL helper must reject malformed shorthand hosts like `api` while preserving localhost and railway.internal private-network URLs.",
  );
  assert(
    core.includes('import { getApiBaseUrl } from "../api-base-url";') &&
      core.includes("const API_BASE_URL = getApiBaseUrl();"),
    "SSR API client must resolve its upstream base URL through the shared helper.",
  );
  assert(
    inlineEnvUsers.length === 0,
    `API route proxies must use the shared helper instead of inline PIM_API_BASE_URL lookups. Remaining files: ${inlineEnvUsers
      .map((file) => path.relative(REPO_ROOT, file))
      .join(", ")}`,
  );
  assert(
    runtimeStage.includes("ENV NODE_ENV=production") &&
      runtimeStage.includes("ARG PIM_API_BASE_URL") &&
      runtimeStage.includes("ENV PIM_API_BASE_URL=${PIM_API_BASE_URL}") &&
      runtimeStage.includes("ARG NEXT_PUBLIC_API_URL") &&
      runtimeStage.includes("ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}") &&
      runtimeStage.includes("ARG PIM_API_BASE_URL_FALLBACK") &&
      runtimeStage.includes("ENV PIM_API_BASE_URL_FALLBACK=${PIM_API_BASE_URL_FALLBACK}"),
    "Dockerfile.web must preserve the canonical and fallback API upstream env vars in the final runtime stage, not only during build.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "api_base_url_helper_supports_packaged_fallback_api_base_url",
          "api_base_url_helper_normalizes_root_urls_to_api_v1",
          "api_base_url_helper_rejects_malformed_shorthand_hosts",
          "ssr_client_uses_shared_api_base_url_helper",
          "api_route_proxies_use_shared_api_base_url_helper",
          "dockerfile_web_supports_canonical_and_legacy_api_base_env_names",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("API base URL env integration test failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
