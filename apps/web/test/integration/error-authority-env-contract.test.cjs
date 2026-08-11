#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const WEB_SRC = path.join(REPO_ROOT, "apps", "web", "src");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function walkFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

try {
  const serverHelper = read("apps/web/src/lib/server/error-authority-env.ts");
  const instrumentation = read("apps/web/src/instrumentation.ts");
  const packageScript = read("scripts/prepare-railway-web-package.cjs");
  const deployScript = read("scripts/railway-deploy.cjs");
  const webFiles = walkFiles(WEB_SRC).filter((file) => /\.(ts|tsx|js|jsx)$/.test(file));
  const ingestTokenUsers = webFiles.filter((file) => fs.readFileSync(file, "utf8").includes("ERROR_AUTHORITY_INGEST_TOKEN"));
  const allowedServerTokenUsers = new Set([
    "apps/web/src/lib/server/error-authority-env.ts",
    "apps/web/src/lib/server/next-server-error-capture.ts",
    "apps/web/src/instrumentation.ts",
  ]);
  const clientIngestTokenUsers = ingestTokenUsers.filter((file) => {
    const source = fs.readFileSync(file, "utf8");
    return /^\s*["']use client["'];?/m.test(source);
  });

  assert(
    serverHelper.includes("resolveErrorAuthorityRelease") &&
      serverHelper.includes("assertTrustedErrorAuthorityServerIngestionConfig") &&
      serverHelper.includes("ERROR_AUTHORITY_LOCAL_RELEASE"),
    "Web must expose a server-side Error Authority release/config accessor before Next server ingestion is implemented.",
  );
  assert(
    instrumentation.includes("assertTrustedErrorAuthorityServerIngestionConfig") &&
      instrumentation.includes("NEXT_RUNTIME") &&
      instrumentation.includes('NEXT_RUNTIME !== "nodejs"') === false &&
      instrumentation.includes('NEXT_RUNTIME === "edge"'),
    "Next instrumentation must validate trusted Error Authority server-ingestion config when NEXT_RUNTIME is unset or Node.js, and skip only Edge runtime.",
  );
  assert(
    !read("apps/web/src/lib/server/error-authority-env.ts").includes("NEXT_PUBLIC_ERROR_AUTHORITY_INGEST_TOKEN") &&
      !read("apps/web/src/instrumentation.ts").includes("NEXT_PUBLIC_ERROR_AUTHORITY_INGEST_TOKEN") &&
      !packageScript.includes("ERROR_AUTHORITY_INGEST_TOKEN") &&
      !packageScript.includes("NEXT_PUBLIC_ERROR_AUTHORITY"),
    "Trusted Error Authority ingest token must not be projected to public web env, generated .env.production files, or NEXT_PUBLIC variables.",
  );
  assert(
    deployScript.includes("resolveErrorAuthorityServiceVariables") &&
      deployScript.includes("ERROR_AUTHORITY_RELEASE") &&
      deployScript.includes("ERROR_AUTHORITY_INGEST_TOKEN") &&
      deployScript.includes("safeKeys") &&
      !deployScript.includes("ERROR_AUTHORITY_INGEST_TOKEN=${") &&
      !deployScript.includes("ingestToken}`"),
    "Railway deploy may sync the server-only ingest token, but logs must describe only variable names and not print token values.",
  );
  assert(
    clientIngestTokenUsers.length === 0,
    `Trusted Error Authority ingest token must not be referenced from client components. Offenders: ${clientIngestTokenUsers
      .map((file) => path.relative(REPO_ROOT, file))
      .join(", ")}`,
  );
  assert(
    ingestTokenUsers.every((file) =>
      allowedServerTokenUsers.has(path.relative(REPO_ROOT, file)),
    ),
    `Trusted Error Authority ingest token must stay in the server config boundary. Users: ${ingestTokenUsers
      .map((file) => path.relative(REPO_ROOT, file))
      .join(", ")}`,
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "web_has_server_error_authority_release_accessor",
          "next_instrumentation_validates_trusted_server_ingestion_config",
          "ingest_token_not_projected_to_public_env_or_web_package",
          "railway_deploy_syncs_error_authority_vars_without_logging_token_values",
          "ingest_token_not_referenced_by_client_components",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("Error Authority web env contract test failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
