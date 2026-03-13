#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const sourceDir = path.join(repoRoot, "apps", "api");
const schemaSource = path.join(repoRoot, "packages", "db", "prisma", "schema.prisma");
const outputDir = path.join(repoRoot, ".tmp", "railway-api-service");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
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

  removeDir(outputDir);
  copyDir(sourceDir, outputDir);

  const prismaDir = path.join(outputDir, "prisma");
  ensureDir(prismaDir);
  fs.copyFileSync(schemaSource, path.join(prismaDir, "schema.prisma"));

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

  console.log(
    JSON.stringify(
      {
        status: "ok",
        outputDir: path.relative(repoRoot, outputDir),
        schema: path.relative(repoRoot, path.join(prismaDir, "schema.prisma")),
        packageJson: path.relative(repoRoot, packageJsonPath),
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
