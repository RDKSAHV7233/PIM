#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const sourceDir = path.join(repoRoot, "apps", "api");
const schemaSource = path.join(repoRoot, "packages", "db", "prisma", "schema.prisma");
const observabilityPackageSource = path.join(repoRoot, "packages", "observability-db");
const migrateScriptSource = path.join(repoRoot, "scripts", "prisma-migrate-deploy.cjs");
const tsconfigBaseSource = path.join(repoRoot, "tsconfig.base.json");
const outputDir = path.join(repoRoot, ".tmp", "railway-api-service");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

function copyDir(source, target) {
  const entries = fs.readdirSync(source, { withFileTypes: true });
  ensureDir(target);
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules") {
        continue;
      }
      copyDir(sourcePath, targetPath);
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function main() {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`API source directory not found: ${sourceDir}`);
  }
  if (!fs.existsSync(schemaSource)) {
    throw new Error(`Prisma schema not found: ${schemaSource}`);
  }
  if (!fs.existsSync(observabilityPackageSource)) {
    throw new Error(`Observability DB package not found: ${observabilityPackageSource}`);
  }
  if (!fs.existsSync(tsconfigBaseSource)) {
    throw new Error(`Root tsconfig.base.json not found: ${tsconfigBaseSource}`);
  }
  if (!fs.existsSync(migrateScriptSource)) {
    throw new Error(`Prisma migrate helper not found: ${migrateScriptSource}`);
  }

  removeDir(outputDir);
  copyDir(sourceDir, outputDir);

  fs.copyFileSync(tsconfigBaseSource, path.join(outputDir, "tsconfig.base.json"));

  const tsconfigPath = path.join(outputDir, "tsconfig.json");
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf8"));
  tsconfig.extends = "./tsconfig.base.json";
  fs.writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`, "utf8");

  const prismaDir = path.join(outputDir, "prisma");
  ensureDir(prismaDir);
  fs.copyFileSync(schemaSource, path.join(prismaDir, "schema.prisma"));

  const packageJsonPath = path.join(outputDir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

  const observabilityPackageTarget = path.join(outputDir, "packages", "observability-db");
  copyDir(observabilityPackageSource, observabilityPackageTarget);
  const observabilityPackageJsonPath = path.join(observabilityPackageTarget, "package.json");
  const observabilityPackageJson = JSON.parse(fs.readFileSync(observabilityPackageJsonPath, "utf8"));
  const prismaVersion = observabilityPackageJson.devDependencies?.prisma ?? packageJson?.devDependencies?.prisma ?? "6.19.3";
  observabilityPackageJson.dependencies = {
    ...(observabilityPackageJson.dependencies ?? {}),
    prisma: observabilityPackageJson.dependencies?.prisma ?? prismaVersion,
  };
  fs.writeFileSync(observabilityPackageJsonPath, `${JSON.stringify(observabilityPackageJson, null, 2)}\n`, "utf8");

  const outputScriptsDir = path.join(outputDir, "scripts");
  ensureDir(outputScriptsDir);
  const migrateScriptContents = fs
    .readFileSync(migrateScriptSource, "utf8")
    .replaceAll("packages/db/prisma/schema.prisma", "prisma/schema.prisma");
  const migrateScriptPath = path.join(outputScriptsDir, "prisma-migrate-deploy.cjs");
  fs.writeFileSync(migrateScriptPath, migrateScriptContents, "utf8");
  const syncObservabilityClientScript = [
    "#!/usr/bin/env node",
    "/* eslint-disable no-console */",
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    "",
    "const packageRoot = path.resolve(__dirname, '..');",
    "const generatedSource = path.join(packageRoot, 'packages', 'observability-db', 'generated');",
    "const generatedTarget = path.join(packageRoot, 'node_modules', '@pim1', 'observability-db', 'generated');",
    "",
    "if (!fs.existsSync(generatedSource)) {",
    "  throw new Error(`Observability Prisma generated client not found: ${generatedSource}`);",
    "}",
    "fs.rmSync(generatedTarget, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });",
    "fs.mkdirSync(path.dirname(generatedTarget), { recursive: true });",
    "fs.cpSync(generatedSource, generatedTarget, { recursive: true });",
    "console.log('observability generated client synced');",
    "",
  ].join("\n");
  const syncObservabilityClientScriptPath = path.join(outputScriptsDir, "sync-observability-generated-client.cjs");
  fs.writeFileSync(syncObservabilityClientScriptPath, syncObservabilityClientScript, "utf8");

  packageJson.dependencies = {
    ...(packageJson.dependencies ?? {}),
    "@pim1/observability-db": "file:packages/observability-db",
  };
  packageJson.devDependencies = {
    ...(packageJson.devDependencies ?? {}),
    prisma: packageJson.devDependencies?.prisma ?? "^6.16.3",
  };
  packageJson.scripts = {
    ...(packageJson.scripts ?? {}),
    prebuild:
      "prisma generate --schema prisma/schema.prisma && prisma generate --schema packages/observability-db/prisma/schema.prisma && node scripts/sync-observability-generated-client.cjs",
  };
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

  // Generate railway.toml for the packaged output.
  // Paths differ from apps/api/railway.toml because the package root is the
  // api directory itself (dist/ and scripts/ are at root, not apps/api/).
  //
  // preDeployCommand is intentionally omitted here. The CI workflow runs
  // migrations against the staging database in the "Apply migrations" step
  // before this deploy runs, so Railway-side migration is redundant.
  // preDeployCommand requires DATABASE_URL to be injected into a separate
  // Railway container — if that env var is missing the whole deploy fails.
  //
  // startCommand boots directly to "node dist/main.js" (no migration blocking
  // startup), so in the healthy case the healthcheck passes in ~5s.
  //
  // IMPORTANT (INCIDENT-CREDENTIAL-KEY-BOOT-001, #480/#473): that fast-happy-path
  // timing says nothing about the failure case. When the process can't boot at all
  // (e.g. env validation failing before the HTTP listener opens), the healthcheck
  // never returns 200 — see TECH-DEPLOY-READINESS-001 (#473) for evidence that this
  // service's old instance was observed torn down before a failed replacement ever
  // attempted its first boot, not gated on a health signal. Do not assume "healthcheck
  // passes fast when things work" implies "old instance survives when things don't."
  // healthcheckPath below points at a real readiness check (DB reachability), not bare
  // liveness, specifically so a boot failure has something meaningful to fail against.
  const railwayTomlContents = [
    "[build]",
    'buildCommand = "npm install && npm run build"',
    "",
    "[deploy]",
    // Cap heap to 400 MB — stays within Railway Hobby's billing model and
    // prevents Node from attempting to allocate beyond available container memory.
    'startCommand = "node --max-old-space-size=400 dist/main.js"',
    'healthcheckPath = "/api/v1/health/ready"',
    "healthcheckTimeout = 300",
    'restartPolicyType = "ON_FAILURE"',
    "restartPolicyMaxRetries = 10",
    "",
  ].join("\n");

  // Write to package root (used when Railway reads config with --path-as-root).
  const railwayTomlPath = path.join(outputDir, "railway.toml");
  fs.writeFileSync(railwayTomlPath, railwayTomlContents, "utf8");

  // Also write to apps/api/railway.toml within the package so Railway can find
  // it if the service dashboard has the config file path set to that location.
  const railwayTomlMirrorDir = path.join(outputDir, "apps", "api");
  ensureDir(railwayTomlMirrorDir);
  const railwayTomlMirrorPath = path.join(railwayTomlMirrorDir, "railway.toml");
  fs.writeFileSync(railwayTomlMirrorPath, railwayTomlContents, "utf8");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        outputDir: path.relative(repoRoot, outputDir),
        tsconfig: path.relative(repoRoot, tsconfigPath),
        schema: path.relative(repoRoot, path.join(prismaDir, "schema.prisma")),
        packageJson: path.relative(repoRoot, packageJsonPath),
        observabilityPackage: path.relative(repoRoot, observabilityPackageTarget),
        railwayToml: path.relative(repoRoot, railwayTomlPath),
        railwayTomlMirror: path.relative(repoRoot, railwayTomlMirrorPath),
        migrateScript: path.relative(repoRoot, migrateScriptPath),
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
