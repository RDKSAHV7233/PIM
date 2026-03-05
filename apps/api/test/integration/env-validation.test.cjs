#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    const value = raw.replace(/^"|"$/g, "");
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function setDefaultEnv(name, value) {
  if (!process.env[name] || String(process.env[name]).trim().length === 0) {
    process.env[name] = value;
  }
}

function buildBaseEnv() {
  readEnvFile(path.join(REPO_ROOT, ".env"));
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    setDefaultEnv("DATABASE_URL_POOLED", databaseUrl);
    setDefaultEnv("DATABASE_URL_DIRECT", databaseUrl);
  }
  setDefaultEnv("JWT_SECRET", "pim1-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "pim1-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "pim1-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/pim1-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");

  return { ...process.env };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function killProcessTree(processHandle) {
  if (!processHandle || processHandle.killed || !processHandle.pid) {
    return;
  }
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(processHandle.pid), "/t", "/f"], {
        stdio: "ignore",
      });
    } catch {
      // Ignore cleanup failures.
    }
    return;
  }
  processHandle.kill("SIGTERM");
  await sleep(300);
  if (!processHandle.killed) {
    processHandle.kill("SIGKILL");
  }
}

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, { method: "GET" });
      if (response.ok) {
        return true;
      }
    } catch {
      // Retry until timeout.
    }
    await sleep(300);
  }
  return false;
}

async function runCaseMissingJwtSecret(baseEnv) {
  const env = {
    ...baseEnv,
    PORT: String(5200 + Math.floor(Math.random() * 100)),
  };
  env.JWT_SECRET = "short";
  env.PIM_JWT_SECRET = "short";

  const stderr = [];
  const stdout = [];
  const processHandle = spawn("node", [API_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  processHandle.stdout.on("data", (chunk) => stdout.push(String(chunk)));
  processHandle.stderr.on("data", (chunk) => stderr.push(String(chunk)));

  const result = await Promise.race([
    new Promise((resolve) => {
      processHandle.on("close", (code) => resolve({ code, timeout: false }));
    }),
    sleep(20_000).then(() => ({ code: null, timeout: true })),
  ]);

  if (result.timeout) {
    await killProcessTree(processHandle);
    const mergedOutput = `${stdout.join("")}\n${stderr.join("")}`;
    throw new Error(
      `Expected startup to fail when JWT_SECRET is invalid, but process stayed alive. Output tail: ${mergedOutput.slice(-500)}`,
    );
  }

  const mergedOutput = `${stdout.join("")}\n${stderr.join("")}`;
  if (result.code === 0) {
    throw new Error("Expected startup to fail when JWT_SECRET is invalid, but process exited with code 0.");
  }
  if (!mergedOutput.includes("STARTUP FAILED")) {
    throw new Error(`Expected startup failure output to include 'STARTUP FAILED'. Output tail: ${mergedOutput.slice(-500)}`);
  }
  if (!mergedOutput.includes("JWT_SECRET")) {
    throw new Error(`Expected startup failure output to mention JWT_SECRET. Output tail: ${mergedOutput.slice(-500)}`);
  }
}

async function runCaseValidEnvStarts(baseEnv) {
  const port = 5300 + Math.floor(Math.random() * 100);
  const env = {
    ...baseEnv,
    PORT: String(port),
  };
  const baseUrl = `http://localhost:${port}/api/v1`;
  const stdout = [];
  const stderr = [];

  const processHandle = spawn("node", [API_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  processHandle.stdout.on("data", (chunk) => stdout.push(String(chunk)));
  processHandle.stderr.on("data", (chunk) => stderr.push(String(chunk)));

  try {
    const healthy = await waitForHealth(baseUrl, 60_000);
    if (!healthy) {
      throw new Error(
        `Expected app to start with valid env. stdout tail=${stdout.join("").slice(-500)} stderr tail=${stderr.join("").slice(-500)}`,
      );
    }
  } finally {
    await killProcessTree(processHandle);
  }
}

async function run() {
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }
  const baseEnv = buildBaseEnv();

  await runCaseMissingJwtSecret(baseEnv);
  await runCaseValidEnvStarts(baseEnv);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: ["missing_env_exits_with_error", "valid_env_starts_api"],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error("Env validation integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
