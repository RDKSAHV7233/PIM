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

  removeDir(outputDir);
  copyDir(sourceDir, appOutputDir);

  fs.copyFileSync(tsconfigBaseSource, path.join(outputDir, "tsconfig.base.json"));

  const rootPackageJsonPath = path.join(outputDir, "package.json");
  fs.writeFileSync(
    rootPackageJsonPath,
    `${JSON.stringify(
      {
        name: "pim1-railway-web-service",
        private: true,
        workspaces: ["apps/*"],
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

  // Use --include=dev in the npm install so devDependencies are installed even when
  // Railway's Railpack builder sets NODE_ENV=production (which causes plain `npm install`
  // to omit devDependencies). The web app's build tools – tailwindcss, postcss,
  // autoprefixer, typescript – live in devDependencies and are required by `next build`.
  // Without them, next build crashes silently (SIGKILL before any output is produced)
  // because the PostCSS/Tailwind CSS pipeline fails to initialise.
  //
  // NOTE: changing this string invalidates the Railpack build cache (the cache key includes
  // the buildCommand). That is intentional here – the cached node_modules from earlier runs
  // was missing the devDependency build tools, so we *want* a fresh install that now
  // includes them. After the first successful build the cache will be warm for all future
  // deploys (as long as this string stays the same).
  const railwayTomlContents = [
    "[build]",
    'buildCommand = "npm install --include=dev && npm run build"',
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
  // Problem 1 – devDependencies are skipped in production mode:
  //   Railway's Railpack builder runs `npm install` with NODE_ENV=production, which causes
  //   npm to omit devDependencies. The web app's build tools (tailwindcss, postcss,
  //   autoprefixer, typescript) are all in devDependencies and would not be installed,
  //   breaking `next build` silently (SIGKILL before any error is printed).
  //   Fix: merge devDependencies into dependencies in the Railway package output so that
  //   all build tools are installed regardless of NODE_ENV.
  //
  // Problem 2 – OOM kill during next build:
  //   Railway's Metal builder containers enforce a cgroup memory limit. Node.js 20's
  //   default V8 old-generation heap ceiling (≈2 GB) can cause the process to be
  //   SIGKILL-ed before it prints anything. Setting --max-old-space-size=1024 caps the
  //   old heap at 1 GB, giving the rest of the address space to webpack, SWC, and OS
  //   overhead while still being well above what next build actually needs (~300–700 MB).
  const webPackageJsonPath = path.join(appOutputDir, "package.json");
  const webPackageJson = JSON.parse(fs.readFileSync(webPackageJsonPath, "utf8"));

  // Merge devDependencies into dependencies so Railway's production npm install includes
  // all build tools. Source devDependencies come first so production deps take precedence
  // if any name collision exists (none expected here).
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
