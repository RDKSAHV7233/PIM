#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function main() {
  const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
  const prepareScript = path.join(repoRoot, "scripts", "prepare-railway-api-package.cjs");
  const result = spawnSync(process.execPath, [prepareScript], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout || "prepare-railway-api-package failed");

  const outputDir = path.join(repoRoot, ".tmp", "railway-api-service");
  const railwayToml = fs.readFileSync(path.join(outputDir, "railway.toml"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(outputDir, "package.json"), "utf8"));
  const migrateScript = fs.readFileSync(path.join(outputDir, "scripts", "prisma-migrate-deploy.cjs"), "utf8");

  assert.match(railwayToml, /buildCommand = "npm install && npm run build"/, "API package must use standalone build command");
  assert.doesNotMatch(railwayToml, /--workspace/, "API package railway.toml must not use monorepo workspace flags");
  // Migrations are applied during CI (promote-stage3 workflow Apply-migrations step)
  // not via startCommand. PR #80 removed preDeployCommand; startCommand boots directly.
  assert.match(
    railwayToml,
    /startCommand = "node --max-old-space-size=400 dist\/main\.js"/,
    "API package must start from the packaged dist output with heap cap to prevent OOM on Railway Hobby",
  );
  assert.match(railwayToml, /healthcheckPath = "\/api\/v1\/health"/, "API package must expose the staging health path");
  assert.equal(packageJson.scripts.prebuild, "prisma generate --schema prisma/schema.prisma");
  assert.match(migrateScript, /prisma\/schema\.prisma/, "Packaged migrate helper must target the packaged Prisma schema");
  assert.doesNotMatch(
    migrateScript,
    /packages\/db\/prisma\/schema\.prisma/,
    "Packaged migrate helper must not reference the monorepo schema path",
  );

  console.log("railway api package contract OK");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
