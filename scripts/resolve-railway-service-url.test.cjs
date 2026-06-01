#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require("node:assert/strict");
const { resolveServiceTarget } = require("./resolve-railway-service-url.cjs");

function main() {
  assert.equal(
    resolveServiceTarget({
      RAILWAY_SERVICE_ID: "svc-generic-id",
      RAILWAY_SERVICE: "Generic Service",
      RAILWAY_WEB_SERVICE_ID: "svc-web-id",
      RAILWAY_WEB_SERVICE: "App Vexa",
    }),
    "svc-generic-id",
    "Generic service id should take precedence when provided.",
  );

  assert.equal(
    resolveServiceTarget({
      RAILWAY_SERVICE: "Vexa API",
      RAILWAY_WEB_SERVICE_ID: "svc-web-id",
      RAILWAY_WEB_SERVICE: "App Vexa",
    }),
    "Vexa API",
    "Generic service name should be accepted for non-web URL resolution.",
  );

  assert.equal(
    resolveServiceTarget({
      RAILWAY_WEB_SERVICE_ID: "svc-web-id",
      RAILWAY_WEB_SERVICE: "App Vexa",
    }),
    "svc-web-id",
    "Existing web-service env fallback should remain intact.",
  );

  assert.equal(
    resolveServiceTarget({
      RAILWAY_WEB_SERVICE: "App Vexa",
    }),
    "App Vexa",
    "Web service name should remain the final fallback for current workflows.",
  );

  assert.throws(
    () => resolveServiceTarget({}),
    /RAILWAY_WEB_SERVICE/i,
    "Resolver should fail loudly when no Railway service target is provided.",
  );

  console.log("resolve-railway-service-url.test.cjs: PASS");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
