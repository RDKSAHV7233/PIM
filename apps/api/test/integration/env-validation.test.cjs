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
  setDefaultEnv("JWT_SECRET", "tej-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "tej-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("QUEUE_BACKEND", "memory");
  setDefaultEnv("QUEUE_WORKER_ENABLED", "true");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "tej-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/tej-pim-local");
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

async function runCaseStagingRequiresBullmq(baseEnv) {
  const env = {
    ...baseEnv,
    PORT: String(5400 + Math.floor(Math.random() * 100)),
    APP_ENV: "staging",
    AUTH_MODE: "db",
    CORS_ORIGIN: "https://staging.example.com",
    AUTH_EMAIL_PROVIDER: "resend",
    AUTH_EMAIL_FROM: "noreply@example.com",
    AUTH_EMAIL_RESEND_API_KEY: "resend-test-key",
    QUEUE_BACKEND: "memory",
    PIM_AUTH_IDENTITIES_JSON: "",
  };

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
      `Expected staging startup to fail when QUEUE_BACKEND=memory, but process stayed alive. Output tail: ${mergedOutput.slice(-500)}`,
    );
  }

  const mergedOutput = `${stdout.join("")}\n${stderr.join("")}`;
  if (result.code === 0) {
    throw new Error("Expected staging startup to fail when QUEUE_BACKEND=memory, but process exited with code 0.");
  }
  if (!mergedOutput.includes("QUEUE_BACKEND")) {
    throw new Error(`Expected startup failure output to mention QUEUE_BACKEND. Output tail: ${mergedOutput.slice(-500)}`);
  }
}

async function runCaseStagingRequiresWorkerEnabled(baseEnv) {
  const env = {
    ...baseEnv,
    PORT: String(5450 + Math.floor(Math.random() * 100)),
    APP_ENV: "staging",
    AUTH_MODE: "db",
    CORS_ORIGIN: "https://staging.example.com",
    AUTH_EMAIL_PROVIDER: "resend",
    AUTH_EMAIL_FROM: "noreply@example.com",
    AUTH_EMAIL_RESEND_API_KEY: "resend-test-key",
    QUEUE_BACKEND: "bullmq",
    QUEUE_WORKER_ENABLED: "false",
    PIM_AUTH_IDENTITIES_JSON: "",
  };

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
      `Expected staging startup to fail when QUEUE_WORKER_ENABLED=false, but process stayed alive. Output tail: ${mergedOutput.slice(-500)}`,
    );
  }

  const mergedOutput = `${stdout.join("")}\n${stderr.join("")}`;
  if (result.code === 0) {
    throw new Error("Expected staging startup to fail when QUEUE_WORKER_ENABLED=false, but process exited with code 0.");
  }
  if (!mergedOutput.includes("QUEUE_WORKER_ENABLED")) {
    throw new Error(`Expected startup failure output to mention QUEUE_WORKER_ENABLED. Output tail: ${mergedOutput.slice(-500)}`);
  }
}

async function runCaseStagingRequiresRealEmailProvider(baseEnv) {
  const env = {
    ...baseEnv,
    PORT: String(5475 + Math.floor(Math.random() * 100)),
    APP_ENV: "staging",
    AUTH_MODE: "db",
    CORS_ORIGIN: "https://staging.example.com",
    AUTH_EMAIL_PROVIDER: "file",
    QUEUE_BACKEND: "bullmq",
    QUEUE_WORKER_ENABLED: "true",
    PIM_AUTH_IDENTITIES_JSON: "",
  };

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
      `Expected staging startup to fail when AUTH_EMAIL_PROVIDER=file, but process stayed alive. Output tail: ${mergedOutput.slice(-500)}`,
    );
  }

  const mergedOutput = `${stdout.join("")}\n${stderr.join("")}`;
  if (result.code === 0) {
    throw new Error("Expected staging startup to fail when AUTH_EMAIL_PROVIDER=file, but process exited with code 0.");
  }
  if (!mergedOutput.includes("AUTH_EMAIL_PROVIDER")) {
    throw new Error(`Expected startup failure output to mention AUTH_EMAIL_PROVIDER. Output tail: ${mergedOutput.slice(-500)}`);
  }
}

async function runCaseStagingAllowsConsoleEmailProvider(baseEnv) {
  const port = 5482 + Math.floor(Math.random() * 100);
  const env = {
    ...baseEnv,
    PORT: String(port),
    APP_ENV: "staging",
    AUTH_MODE: "db",
    CORS_ORIGIN: "https://staging.example.com",
    AUTH_EMAIL_PROVIDER: "console",
    QUEUE_BACKEND: "bullmq",
    QUEUE_WORKER_ENABLED: "true",
    PIM_AUTH_IDENTITIES_JSON: "",
    PIM_COMMERCIAL_CONTACT_URL: "https://example.com/contact-sales",
    PIM_COMMERCIAL_OPS_TOKEN: "staging-commercial-ops-token",
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
        `Expected staging startup to succeed when AUTH_EMAIL_PROVIDER=console. stdout tail=${stdout.join("").slice(-500)} stderr tail=${stderr.join("").slice(-500)}`,
      );
    }
  } finally {
    await killProcessTree(processHandle);
  }
}

async function runCaseStagingRequiresResendCredentials(baseEnv) {
  const env = {
    ...baseEnv,
    PORT: String(5490 + Math.floor(Math.random() * 100)),
    APP_ENV: "staging",
    AUTH_MODE: "db",
    CORS_ORIGIN: "https://staging.example.com",
    AUTH_EMAIL_PROVIDER: "resend",
    AUTH_EMAIL_FROM: "",
    AUTH_EMAIL_RESEND_API_KEY: "",
    QUEUE_BACKEND: "bullmq",
    QUEUE_WORKER_ENABLED: "true",
    PIM_AUTH_IDENTITIES_JSON: "",
    PIM_COMMERCIAL_CONTACT_URL: "https://example.com/contact-sales",
    PIM_COMMERCIAL_OPS_TOKEN: "staging-commercial-ops-token",
  };

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
      `Expected staging startup to fail when resend email env is incomplete, but process stayed alive. Output tail: ${mergedOutput.slice(-500)}`,
    );
  }

  const mergedOutput = `${stdout.join("")}\n${stderr.join("")}`;
  if (result.code === 0) {
    throw new Error("Expected staging startup to fail when resend email env is incomplete, but process exited with code 0.");
  }
  if (!mergedOutput.includes("AUTH_EMAIL_RESEND_API_KEY") || !mergedOutput.includes("AUTH_EMAIL_FROM")) {
    throw new Error(`Expected startup failure output to mention resend credentials. Output tail: ${mergedOutput.slice(-500)}`);
  }
}

async function runCaseProductionRejectsConsoleEmailProvider(baseEnv) {
  const env = {
    ...baseEnv,
    PORT: String(5495 + Math.floor(Math.random() * 100)),
    APP_ENV: "production",
    AUTH_MODE: "db",
    CORS_ORIGIN: "https://app.example.com",
    AUTH_EMAIL_PROVIDER: "console",
    QUEUE_BACKEND: "bullmq",
    QUEUE_WORKER_ENABLED: "true",
    PIM_AUTH_IDENTITIES_JSON: "",
    PIM_COMMERCIAL_CONTACT_URL: "https://example.com/contact-sales",
    PIM_COMMERCIAL_OPS_TOKEN: "production-commercial-ops-token",
  };

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
      `Expected production startup to fail when AUTH_EMAIL_PROVIDER=console, but process stayed alive. Output tail: ${mergedOutput.slice(-500)}`,
    );
  }

  const mergedOutput = `${stdout.join("")}\n${stderr.join("")}`;
  if (result.code === 0) {
    throw new Error("Expected production startup to fail when AUTH_EMAIL_PROVIDER=console, but process exited with code 0.");
  }
  if (!mergedOutput.includes("AUTH_EMAIL_PROVIDER")) {
    throw new Error(`Expected startup failure output to mention AUTH_EMAIL_PROVIDER. Output tail: ${mergedOutput.slice(-500)}`);
  }
}

async function runCaseStagingRequiresCommercialContact(baseEnv) {
  const env = {
    ...baseEnv,
    PORT: String(5498 + Math.floor(Math.random() * 100)),
    APP_ENV: "staging",
    AUTH_MODE: "db",
    CORS_ORIGIN: "https://staging.example.com",
    AUTH_EMAIL_PROVIDER: "console",
    QUEUE_BACKEND: "bullmq",
    QUEUE_WORKER_ENABLED: "true",
    PIM_AUTH_IDENTITIES_JSON: "",
    PIM_COMMERCIAL_CONTACT_URL: "",
    PIM_COMMERCIAL_CONTACT_EMAIL: "",
    PIM_COMMERCIAL_OPS_TOKEN: "staging-commercial-ops-token",
  };

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
      `Expected staging startup to fail without commercial contact config, but process stayed alive. Output tail: ${mergedOutput.slice(-500)}`,
    );
  }

  const mergedOutput = `${stdout.join("")}\n${stderr.join("")}`;
  if (result.code === 0) {
    throw new Error("Expected staging startup to fail without commercial contact config, but process exited with code 0.");
  }
  if (!mergedOutput.includes("PIM_COMMERCIAL_CONTACT_URL") && !mergedOutput.includes("PIM_COMMERCIAL_CONTACT_EMAIL")) {
    throw new Error(`Expected startup failure output to mention commercial contact config. Output tail: ${mergedOutput.slice(-500)}`);
  }
}

async function runCaseStagingRequiresCommercialOpsToken(baseEnv) {
  const env = {
    ...baseEnv,
    PORT: String(5502 + Math.floor(Math.random() * 100)),
    APP_ENV: "staging",
    AUTH_MODE: "db",
    CORS_ORIGIN: "https://staging.example.com",
    AUTH_EMAIL_PROVIDER: "console",
    QUEUE_BACKEND: "bullmq",
    QUEUE_WORKER_ENABLED: "true",
    PIM_AUTH_IDENTITIES_JSON: "",
    PIM_COMMERCIAL_CONTACT_URL: "https://example.com/contact-sales",
    PIM_COMMERCIAL_OPS_TOKEN: "",
  };

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
      `Expected staging startup to fail without commercial ops token, but process stayed alive. Output tail: ${mergedOutput.slice(-500)}`,
    );
  }

  const mergedOutput = `${stdout.join("")}\n${stderr.join("")}`;
  if (result.code === 0) {
    throw new Error("Expected staging startup to fail without commercial ops token, but process exited with code 0.");
  }
  if (!mergedOutput.includes("PIM_COMMERCIAL_OPS_TOKEN")) {
    throw new Error(`Expected startup failure output to mention PIM_COMMERCIAL_OPS_TOKEN. Output tail: ${mergedOutput.slice(-500)}`);
  }
}

async function run() {
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }
  const baseEnv = buildBaseEnv();

  await runCaseMissingJwtSecret(baseEnv);
  await runCaseStagingRequiresBullmq(baseEnv);
  await runCaseStagingRequiresWorkerEnabled(baseEnv);
  await runCaseStagingRequiresRealEmailProvider(baseEnv);
  await runCaseStagingAllowsConsoleEmailProvider(baseEnv);
  await runCaseStagingRequiresResendCredentials(baseEnv);
  await runCaseStagingRequiresCommercialContact(baseEnv);
  await runCaseStagingRequiresCommercialOpsToken(baseEnv);
  await runCaseProductionRejectsConsoleEmailProvider(baseEnv);
  await runCaseValidEnvStarts(baseEnv);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "missing_env_exits_with_error",
          "staging_requires_bullmq_queue_backend",
          "staging_requires_queue_worker_enabled",
          "staging_requires_real_email_provider",
          "staging_allows_console_email_provider",
          "staging_requires_resend_credentials",
          "staging_requires_commercial_contact_config",
          "staging_requires_commercial_ops_token",
          "production_requires_resend_email_provider",
          "valid_env_starts_api",
        ],
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
