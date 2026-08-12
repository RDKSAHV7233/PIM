#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function main() {
  const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
  const railwayToml = fs.readFileSync(path.join(repoRoot, "apps", "api", "railway.toml"), "utf8");

  assert.match(
    railwayToml,
    /npm ci --workspace @pim1\/api --workspace @pim1\/db --workspace @pim1\/observability-db/,
    "Direct Railway API build must install the observability DB workspace used by Error Authority storage",
  );
  assert.match(
    railwayToml,
    /npm run prisma:generate --workspace @pim1\/observability-db/,
    "Direct Railway API build must generate the observability Prisma client before the API build",
  );
  assert.match(
    railwayToml,
    /npm run prisma:generate --workspace @pim1\/db/,
    "Direct Railway API build must keep generating the primary application Prisma client",
  );
  assert.match(
    railwayToml,
    /npm run build --workspace @pim1\/api/,
    "Direct Railway API build must still compile the API workspace",
  );
  assert.match(
    railwayToml,
    /startCommand = "node --max-old-space-size=400 apps\/api\/dist\/main\.js"/,
    "Direct Railway API service must still start from the monorepo API dist output",
  );
  assert.match(
    railwayToml,
    /healthcheckPath = "\/api\/v1\/health\/ready"/,
    "Direct Railway API service must continue to gate cutover on API readiness",
  );

  console.log("railway api direct service contract OK");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
