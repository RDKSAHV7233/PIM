#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require("node:assert/strict");
const { assertNoLegacyServiceNames, normalizeBoolean, parseUrl } = require("./validate-staging-deploy-config.cjs");

function main() {
  assert.equal(normalizeBoolean("true"), true);
  assert.equal(normalizeBoolean("false"), false);
  assert.equal(normalizeBoolean(""), null);
  assert.throws(() => normalizeBoolean("yes"), /expected true or false/i);

  const parsed = parseUrl("STAGING_BASE_URL", "https://api-staging.up.railway.app", { requireRootPath: true });
  assert.equal(parsed.origin, "https://api-staging.up.railway.app");
  assert.throws(
    () => parseUrl("STAGING_BASE_URL", "https://api-staging.up.railway.app/api/v1", { requireRootPath: true }),
    /service root/i,
  );

  assert.doesNotThrow(() =>
    assertNoLegacyServiceNames({
      RAILWAY_API_SERVICE: "Vexa API",
      RAILWAY_WEB_SERVICE: "App Vexa",
    }),
  );
  assert.throws(
    () =>
      assertNoLegacyServiceNames({
        RAILWAY_API_SERVICE: "PIM1",
      }),
    /blocked legacy Railway service name/i,
  );

  console.log("validate-staging-deploy-config.test.cjs: PASS");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
