#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const MAIN = path.join(REPO_ROOT, "apps", "api", "src", "main.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const source = fs.readFileSync(MAIN, "utf8");

  assert(
    source.includes('app.getHttpAdapter().getInstance().get("/",') &&
      source.includes('service: "Vexa PIM API"') &&
      source.includes('message: "Vexa PIM API is running."'),
    "API bootstrap must expose a friendly root status route instead of a bare Cannot GET / response.",
  );
  assert(
    source.includes('health: "/api/v1/health"') &&
      source.includes('docs: env.APP_ENV !== "production" ? "/api/v1/docs" : null'),
    "Root status route must point operators to the canonical health and docs endpoints.",
  );
  assert(
    source.includes('app.setGlobalPrefix("api/v1");'),
    "API bootstrap must retain the canonical /api/v1 prefix while exposing the friendly root status route.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "api_root_route_returns_friendly_status_payload",
          "api_root_route_points_to_health_and_docs",
          "api_v1_prefix_remains_canonical",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("API root status route integration test failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
