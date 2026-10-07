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
  const observabilityPackageJson = JSON.parse(
    fs.readFileSync(path.join(outputDir, "packages", "observability-db", "package.json"), "utf8"),
  );
  const migrateScript = fs.readFileSync(path.join(outputDir, "scripts", "prisma-migrate-deploy.cjs"), "utf8");
  const observabilityGeneratedClientSyncScript = fs.readFileSync(
    path.join(outputDir, "scripts", "sync-observability-generated-client.cjs"),
    "utf8",
  );

  assert.match(railwayToml, /buildCommand = "npm install && npm run build"/, "API package must use standalone build command");
  assert.doesNotMatch(railwayToml, /--workspace/, "API package railway.toml must not use monorepo workspace flags");
  // Migrations are applied during CI (promote-stage3 workflow Apply-migrations step)
  // not via startCommand. PR #80 removed preDeployCommand; startCommand boots directly.
  assert.match(
    railwayToml,
    /startCommand = "node --max-old-space-size=400 dist\/main\.js"/,
    "API package must start from the packaged dist output with heap cap to prevent OOM on Railway Hobby",
  );
  assert.match(
    railwayToml,
    /healthcheckPath = "\/api\/v1\/health\/ready"/,
    "API package must gate deploy cutover on the readiness check, not bare liveness",
  );
  assert.equal(
    packageJson.dependencies["@pim1/observability-db"],
    "file:packages/observability-db",
    "API package must include the observability DB workspace as a local runtime dependency",
  );
  assert.equal(
    packageJson.scripts.prebuild,
    "prisma generate --schema prisma/schema.prisma && prisma generate --schema packages/observability-db/prisma/schema.prisma && node scripts/sync-observability-generated-client.cjs",
  );
  assert.match(
    observabilityGeneratedClientSyncScript,
    /node_modules['"], ['"]@pim1['"], ['"]observability-db['"], ['"]generated/,
    "Packaged API build must sync the generated observability Prisma client into the installed runtime dependency",
  );
  assert.match(
    observabilityGeneratedClientSyncScript,
    /generatedSources = \[/,
    "Packaged API build must allow multiple generated observability client locations",
  );
  assert.match(
    observabilityGeneratedClientSyncScript,
    /observability generated client already present/,
    "Packaged API build must not fail when npm has already generated the client in the installed dependency",
  );
  assert.match(
    observabilityGeneratedClientSyncScript,
    /fs\.realpathSync\(generatedSource\)/,
    "Packaged API build must compare real paths before deleting a possibly symlinked target",
  );
  const generatedSource = path.join(outputDir, "packages", "observability-db", "generated");
  const generatedTarget = path.join(outputDir, "node_modules", "@pim1", "observability-db", "generated");
  const generatedModuleTarget = path.dirname(generatedTarget);
  fs.rmSync(generatedModuleTarget, { recursive: true, force: true });
  fs.mkdirSync(generatedSource, { recursive: true });
  fs.writeFileSync(path.join(generatedSource, "client.js"), "module.exports = {};\n", "utf8");
  fs.mkdirSync(path.dirname(generatedModuleTarget), { recursive: true });
  fs.symlinkSync(path.join(outputDir, "packages", "observability-db"), generatedModuleTarget, "dir");
  const symlinkedSyncResult = spawnSync(
    process.execPath,
    [path.join(outputDir, "scripts", "sync-observability-generated-client.cjs")],
    {
      cwd: outputDir,
      encoding: "utf8",
    },
  );
  assert.equal(
    symlinkedSyncResult.status,
    0,
    symlinkedSyncResult.stderr || symlinkedSyncResult.stdout || "generated observability client symlink sync failed",
  );
  assert.ok(
    fs.existsSync(path.join(generatedSource, "client.js")),
    "Generated observability client source must survive symlinked dependency sync",
  );

  fs.rmSync(generatedModuleTarget, { recursive: true, force: true });
  fs.rmSync(generatedSource, { recursive: true, force: true });
  fs.mkdirSync(generatedTarget, { recursive: true });
  fs.writeFileSync(path.join(generatedTarget, "client.js"), "module.exports = {};\n", "utf8");
  const noOpSyncResult = spawnSync(process.execPath, [path.join(outputDir, "scripts", "sync-observability-generated-client.cjs")], {
    cwd: outputDir,
    encoding: "utf8",
  });
  assert.equal(
    noOpSyncResult.status,
    0,
    noOpSyncResult.stderr || noOpSyncResult.stdout || "generated observability client no-op sync failed",
  );
  assert.equal(
    observabilityPackageJson.dependencies.prisma,
    observabilityPackageJson.devDependencies.prisma,
    "Packaged observability DB dependency must be able to run its postinstall Prisma generation",
  );
  assert.ok(
    fs.existsSync(path.join(outputDir, "packages", "observability-db", "prisma", "schema.prisma")),
    "API package must include the observability DB Prisma schema",
  );
  assert.match(migrateScript, /prisma\/schema\.prisma/, "Packaged migrate helper must target the packaged Prisma schema");
  assert.doesNotMatch(
    migrateScript,
    /packages\/db\/prisma\/schema\.prisma/,
    "Packaged migrate helper must not reference the monorepo schema path",
  );

  // SEC-DB-RLS-001 7.9a: the packaged runner can find the grants tool and the manifest it needs when MIGRATION_DATABASE_URL is set.
  const packagedRunner = require(path.join(outputDir, "scripts", "prisma-migrate-deploy.cjs"));
  assert.ok(fs.existsSync(packagedRunner.GRANTS_TOOL), "the packaged runner's grants tool must exist at the path the runner resolves");
  assert.ok(fs.existsSync(path.join(outputDir, "scripts", "db-identity", "lib.cjs")), "the grants tool's library must travel with it");
  const packagedModelPath = path.join(outputDir, "packages", "db", "identity", "identity-model.v1.json");
  assert.ok(fs.existsSync(packagedModelPath), "the grants manifest must be where the packaged tool resolves it");
  assert.ok(JSON.parse(fs.readFileSync(packagedModelPath, "utf8")).runtime.tables, "the packaged manifest must be the real manifest");

  console.log("railway api package contract OK");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
