#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const sourceDir = path.join(repoRoot, "apps", "api");
const schemaSource = path.join(repoRoot, "packages", "db", "prisma", "schema.prisma");
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

  const outputScriptsDir = path.join(outputDir, "scripts");
  ensureDir(outputScriptsDir);
  const migrateScriptContents = fs
    .readFileSync(migrateScriptSource, "utf8")
    .replaceAll("packages/db/prisma/schema.prisma", "prisma/schema.prisma");
  const migrateScriptPath = path.join(outputScriptsDir, "prisma-migrate-deploy.cjs");
  fs.writeFileSync(migrateScriptPath, migrateScriptContents, "utf8");

  const packageJsonPath = path.join(outputDir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  packageJson.devDependencies = {
    ...(packageJson.devDependencies ?? {}),
    prisma: packageJson.devDependencies?.prisma ?? "^6.16.3",
  };
  packageJson.scripts = {
    ...(packageJson.scripts ?? {}),
    prebuild: "prisma generate --schema prisma/schema.prisma",
  };
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

  // Generate railway.toml for the packaged output.
  // Paths differ from apps/api/railway.toml because the package root is the
  // api directory itself (dist/ and scripts/ are at root, not apps/api/).
  // preDeployCommand runs migrations in a separate Railway container while the
  // old app container keeps serving traffic — zero-downtime on single replica.
  const railwayTomlContents = [
    "[build]",
    'buildCommand = "npm install && npm run build"',
    "",
    "[deploy]",
    'preDeployCommand = ["node scripts/prisma-migrate-deploy.cjs"]',
    'startCommand = "node dist/main.js"',
    'healthcheckPath = "/api/v1/health"',
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
