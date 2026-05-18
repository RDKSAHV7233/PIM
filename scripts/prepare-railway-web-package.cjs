#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const sourceDir = path.join(repoRoot, "apps", "web");
const tsconfigBaseSource = path.join(repoRoot, "tsconfig.base.json");
const outputDir = path.join(repoRoot, ".tmp", "railway-web-service");
const appOutputDir = path.join(outputDir, "apps", "web");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function normalizeApiBaseUrl(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }
  try {
    const parsed = new URL(normalized);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.pathname = !pathname || pathname === "/" ? "/api/v1" : pathname;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return normalized.replace(/\/+$/, "");
  }
}

function resolveApiBaseUrl(env = process.env) {
  return normalizeApiBaseUrl(env.PIM_API_BASE_URL || env.NEXT_PUBLIC_API_URL || env.STAGING_BASE_URL || "");
}

function copyDir(source, target) {
  const entries = fs.readdirSync(source, { withFileTypes: true });
  ensureDir(target);
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".next" || entry.name === "node_modules" || entry.name === "test") {
        continue;
      }
      copyDir(sourcePath, targetPath);
      continue;
    }
    if (entry.name === "tsconfig.tsbuildinfo") {
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function main() {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Web source directory not found: ${sourceDir}`);
  }
  if (!fs.existsSync(tsconfigBaseSource)) {
    throw new Error(`Root tsconfig.base.json not found: ${tsconfigBaseSource}`);
  }

  // Read the web app's package.json from source before copying so we can extract
  // devDependencies to hoist into the root package.json.
  const sourcePkgJson = JSON.parse(fs.readFileSync(path.join(sourceDir, "package.json"), "utf8"));

  removeDir(outputDir);
  copyDir(sourceDir, appOutputDir);

  fs.copyFileSync(tsconfigBaseSource, path.join(outputDir, "tsconfig.base.json"));

  // Hoist web app devDependencies into the root package.json as regular `dependencies`.
  //
  // Why this matters:
  //   Railway's Railpack builder runs its own `npm install` step (separate from the
  //   user-defined buildCommand) with NODE_ENV=production. Under NODE_ENV=production npm
  //   omits devDependencies, so the web app's build tools — tailwindcss, postcss,
  //   autoprefixer, typescript — were never installed. This caused `next build` to crash
  //   silently (SIGKILL with no output) because the PostCSS/Tailwind pipeline cannot
  //   initialise.
  //
  //   Railpack's install-step cache key is derived from the ROOT package.json, not from
  //   workspace sub-package manifests. So changes to apps/web/package.json alone do not
  //   invalidate the cached node_modules. Listing the devDependencies here (root-level
  //   `dependencies`) guarantees:
  //     1. Cache invalidation – the root package.json is now different, forcing a fresh install.
  //     2. Correct installation – root-level `dependencies` are always installed regardless
  //        of NODE_ENV, so build tools are present when `next build` runs.
  //     3. Correct @next/swc binary – a fresh install fetches the SWC native binary for the
  //        active Node.js version (20, per .nvmrc) rather than reusing a stale cached binary
  //        compiled for the old Node.js 24 builder, which caused SIGKILL on load.
  //
  //   The apps/web/package.json devDep→dep merge (further below) is kept as a belt-and-
  //   suspenders complement; the root-level hoist is the primary mechanism.
  const rootPackageJsonPath = path.join(outputDir, "package.json");
  fs.writeFileSync(
    rootPackageJsonPath,
    `${JSON.stringify(
      {
        name: "pim1-railway-web-service",
        private: true,
        workspaces: ["apps/*"],
        // Hoisted from apps/web devDependencies – installed by Railpack's npm install step
        // even under NODE_ENV=production because they appear in root `dependencies`.
        dependencies: { ...(sourcePkgJson.devDependencies ?? {}) },
        scripts: {
          build: "npm run build --workspace @pim1/web",
          start: "npm run start --workspace @pim1/web",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  // buildCommand runs after Railpack's own install step, so all deps (including the
  // hoisted devDeps above) are already in node_modules. No extra `npm install` needed.
  const railwayTomlContents = [
    "[build]",
    'buildCommand = "npm run build"',
    "",
    "[deploy]",
    'startCommand = "npm run start"',
    'healthcheckPath = "/health"',
    "healthcheckTimeout = 300",
    'restartPolicyType = "ON_FAILURE"',
    "restartPolicyMaxRetries = 10",
    "",
  ].join("\n");

  const railwayTomlPath = path.join(outputDir, "railway.toml");
  fs.writeFileSync(railwayTomlPath, railwayTomlContents, "utf8");

  const appRailwayTomlPath = path.join(appOutputDir, "railway.toml");
  fs.writeFileSync(appRailwayTomlPath, railwayTomlContents, "utf8");

  // Override npm's production mode so devDependencies are installed during the Railpack
  // install step. Railpack's Metal builder sets NODE_ENV=production in the build container.
  // Even with devDependencies listed in the root package.json `dependencies` (above), npm
  // still reports "added 106 packages" (the production-only set) under NODE_ENV=production.
  // Writing `.npmrc` with `production=false` overrides this at the project level so ALL
  // workspace deps (tailwindcss, postcss, autoprefixer, typescript) are installed.
  //
  // This is the primary fix for the silent `next build` SIGKILL caused by missing
  // PostCSS/Tailwind packages. The root package.json `dependencies` hoist (above) remains
  // as a belt-and-suspenders cache-invalidation mechanism for future devDep version bumps.
  fs.writeFileSync(path.join(outputDir, ".npmrc"), "production=false\n", "utf8");

  // Pin Node.js to v20 (LTS). Railway's Railpack caches the previously-installed Node version;
  // the cached version (24.x as of May 2026) has a SWC native-binary incompatibility with
  // Next.js 15 that causes `next build` to crash silently (SIGKILL/SIGSEGV, no output).
  // Node.js 20 is the LTS release tested against Next.js 15.5.x and works reliably.
  fs.writeFileSync(path.join(outputDir, ".nvmrc"), "20\n", "utf8");

  // Convert next.config.ts → next.config.js so Next.js loads the config as a plain CommonJS
  // module rather than using its internal SWC transpiler. This avoids a second potential
  // SWC crash surface on Node.js 24 builders and is equivalent at runtime.
  const nextConfigTsPath = path.join(appOutputDir, "next.config.ts");
  if (fs.existsSync(nextConfigTsPath)) {
    const tsSource = fs.readFileSync(nextConfigTsPath, "utf8");
    const jsSource = tsSource
      // Remove TypeScript-only type import ("import type ..." line)
      .replace(/^import type \{[^}]+\} from ['"][^'"]+['"];\n?/m, "")
      // Convert ESM value imports to CJS require()
      .replace(/^import (\w+) from ['"](.+?)['"];/gm, "const $1 = require(\"$2\");")
      // Strip TypeScript type annotation from variable declarations (": TypeName")
      .replace(/^(const \w+): \w+ = \{/m, "$1 = {")
      // Convert default export to module.exports
      .replace(/^export default (\w+);/m, "module.exports = $1;");
    fs.writeFileSync(path.join(appOutputDir, "next.config.js"), jsSource, "utf8");
    fs.rmSync(nextConfigTsPath);
  }

  // Patch apps/web/package.json for Railway's build environment.
  //
  // Change 1 – devDeps→deps merge (belt-and-suspenders alongside root-level hoist above):
  //   Merging devDependencies into dependencies ensures the workspace sub-package manifest
  //   itself lists all build tools as production deps. The primary mechanism is the root
  //   package.json hoist; this is a redundant safety net.
  //
  // Change 2 – OOM kill during next build:
  //   Railway's Metal builder containers enforce a cgroup memory limit. Node.js 20's
  //   default V8 old-generation heap ceiling (≈2 GB) can cause the process to be
  //   SIGKILL-ed before it prints anything. Setting --max-old-space-size=1024 caps the
  //   old heap at 1 GB, giving the rest of the address space to webpack, SWC, and OS
  //   overhead while still being well above what next build actually needs (~300–700 MB).
  const webPackageJsonPath = path.join(appOutputDir, "package.json");
  const webPackageJson = JSON.parse(fs.readFileSync(webPackageJsonPath, "utf8"));

  // Merge devDependencies into dependencies (belt-and-suspenders; root hoist is primary).
  // devDependencies come first so production deps take precedence on any name collision.
  webPackageJson.dependencies = {
    ...(webPackageJson.devDependencies ?? {}),
    ...(webPackageJson.dependencies ?? {}),
  };
  delete webPackageJson.devDependencies;

  // Prepend the memory cap to the `next build` invocation inside the build script.
  // Only patch scripts that call `next build` and don't already have NODE_OPTIONS set.
  const origBuildScript = webPackageJson.scripts?.build ?? "";
  if (origBuildScript.includes("next build") && !origBuildScript.includes("NODE_OPTIONS")) {
    webPackageJson.scripts = {
      ...(webPackageJson.scripts ?? {}),
      build: origBuildScript.replace("next build", "NODE_OPTIONS='--max-old-space-size=1024' next build"),
    };
  }

  fs.writeFileSync(webPackageJsonPath, `${JSON.stringify(webPackageJson, null, 2)}\n`, "utf8");

  const apiBaseUrl = resolveApiBaseUrl(process.env);
  let appEnvFile = null;
  if (apiBaseUrl) {
    const envContents = [
      `PIM_API_BASE_URL=${apiBaseUrl}`,
      `NEXT_PUBLIC_API_URL=${apiBaseUrl}`,
      `PIM_API_BASE_URL_FALLBACK=${apiBaseUrl}`,
      "",
    ].join("\n");
    appEnvFile = path.join(appOutputDir, ".env.production");
    fs.writeFileSync(appEnvFile, envContents, "utf8");
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        outputDir: path.relative(repoRoot, outputDir),
        rootPackageJson: path.relative(repoRoot, rootPackageJsonPath),
        rootDepsHoisted: Object.keys(sourcePkgJson.devDependencies ?? {}),
        npmrc: path.relative(repoRoot, path.join(outputDir, ".npmrc")),
        appPackageJson: path.relative(repoRoot, path.join(appOutputDir, "package.json")),
        tsconfigBase: path.relative(repoRoot, path.join(outputDir, "tsconfig.base.json")),
        railwayToml: path.relative(repoRoot, railwayTomlPath),
        appRailwayToml: path.relative(repoRoot, appRailwayTomlPath),
        ...(appEnvFile
          ? {
              appEnvFile: path.relative(repoRoot, appEnvFile),
              apiBaseUrl,
            }
          : {}),
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
