#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");

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

function prepareEnv() {
  readEnvFile(path.join(REPO_ROOT, ".env"));
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    setDefaultEnv("DATABASE_URL_POOLED", databaseUrl);
    setDefaultEnv("DATABASE_URL_DIRECT", databaseUrl);
  }

  setDefaultEnv("JWT_SECRET", "pim1-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "pim1-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V2", "pim1-local-encryption-key-v2-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "pim1-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/pim1-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("PIM_DEFAULT_ROLE", "admin");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, { method: "GET" });
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }
    await sleep(400);
  }
  throw new Error(`API did not become healthy at ${baseUrl}/health within ${timeoutMs}ms`);
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const port = 5400 + Math.floor(Math.random() * 100);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const tenantKey = `rotate-tenant-${runId}`;
  const installationId = `inst_${runId}`;
  const credentialType = "refresh_token";
  const plainSecret = `secret-${runId}`;

  const env = {
    ...process.env,
    PORT: String(port),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantKey,
  };

  const stdoutBuffer = [];
  const stderrBuffer = [];
  const apiProcess = spawn("node", [API_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  apiProcess.stdout.on("data", (chunk) => {
    stdoutBuffer.push(String(chunk));
    if (stdoutBuffer.length > 200) {
      stdoutBuffer.shift();
    }
  });
  apiProcess.stderr.on("data", (chunk) => {
    stderrBuffer.push(String(chunk));
    if (stderrBuffer.length > 200) {
      stderrBuffer.shift();
    }
  });

  let prismaDirect;
  try {
    await waitForHealth(baseUrl, 60_000);

    const { PrismaDirectService } = require(path.join(
      REPO_ROOT,
      "apps",
      "api",
      "dist",
      "prisma",
      "prisma-direct.service.js",
    ));
    const { LoggerService } = require(path.join(
      REPO_ROOT,
      "apps",
      "api",
      "dist",
      "common",
      "logging",
      "logger.service.js",
    ));
    const { ConnectorCredentialEncryptionService } = require(path.join(
      REPO_ROOT,
      "apps",
      "api",
      "dist",
      "connector-installer",
      "credential-encryption.service.js",
    ));

    prismaDirect = new PrismaDirectService();
    await prismaDirect.onModuleInit();
    const db = prismaDirect.getClient();
    const encryption = new ConnectorCredentialEncryptionService(prismaDirect, new LoggerService());

    // RLS-BYPASS: manual tenant filter
    await db.$executeRawUnsafe(
      `
      INSERT INTO connector_installations (
        id, tenant_key, connector_id, account_alias, status, metadata, installed_by, created_at, updated_at
      ) VALUES ($1, $2, 'cdef_amazon_in', 'primary', 'ACTIVE', '{}'::jsonb, $3, NOW(), NOW())
      ON CONFLICT (tenant_key, connector_id, account_alias)
      DO UPDATE SET updated_at = NOW()
      `,
      installationId,
      tenantKey,
      `user_${runId}`,
    );

    const stored = await encryption.storeCredential({
      tenantKey,
      installationId,
      credentialType,
      plainValue: plainSecret,
      metadata: { source: "integration-test" },
    });
    if (stored.keyVersion !== "v1") {
      throw new Error(`Expected stored keyVersion=v1, got ${stored.keyVersion}`);
    }

    // RLS-BYPASS: manual tenant filter
    const firstRows = await db.$queryRawUnsafe(
      `
      SELECT encrypted_value AS "encryptedValue", key_version AS "keyVersion"
      FROM connector_credentials
      WHERE installation_id = $1 AND credential_type = $2
      LIMIT 1
      `,
      installationId,
      credentialType,
    );
    const first = firstRows[0];
    if (!first) {
      throw new Error("Expected connector credential row to exist.");
    }
    if (String(first.keyVersion) !== "v1") {
      throw new Error(`Expected persisted key_version=v1, got ${String(first.keyVersion)}`);
    }
    const firstDecrypted = encryption.decrypt(String(first.encryptedValue), String(first.keyVersion));
    if (firstDecrypted !== plainSecret) {
      throw new Error("Decrypt with stored row key version failed for initial credential.");
    }

    const dryRunResult = await encryption.rotateKey({
      fromVersion: 1,
      toVersion: 2,
      dryRun: true,
      batchSize: 20,
    });
    if (dryRunResult.failed !== 0) {
      throw new Error(`Expected dry-run failures=0, got ${dryRunResult.failed}`);
    }
    if (dryRunResult.rotated < 1) {
      throw new Error("Expected dry-run to count at least one rotatable credential.");
    }

    // RLS-BYPASS: manual tenant filter
    const afterDryRunRows = await db.$queryRawUnsafe(
      `
      SELECT encrypted_value AS "encryptedValue", key_version AS "keyVersion"
      FROM connector_credentials
      WHERE installation_id = $1 AND credential_type = $2
      LIMIT 1
      `,
      installationId,
      credentialType,
    );
    const afterDryRun = afterDryRunRows[0];
    if (!afterDryRun) {
      throw new Error("Expected credential row after dry-run.");
    }
    if (String(afterDryRun.keyVersion) !== "v1") {
      throw new Error("Dry-run should not update key_version.");
    }
    if (String(afterDryRun.encryptedValue) !== String(first.encryptedValue)) {
      throw new Error("Dry-run should not update encrypted payload.");
    }

    const executeResult = await encryption.rotateKey({
      fromVersion: 1,
      toVersion: 2,
      dryRun: false,
      batchSize: 20,
    });
    if (executeResult.failed !== 0) {
      throw new Error(`Expected execute failures=0, got ${executeResult.failed}`);
    }
    if (executeResult.rotated < 1) {
      throw new Error("Expected execute mode to rotate at least one credential.");
    }

    // RLS-BYPASS: manual tenant filter
    const afterExecuteRows = await db.$queryRawUnsafe(
      `
      SELECT encrypted_value AS "encryptedValue", key_version AS "keyVersion"
      FROM connector_credentials
      WHERE installation_id = $1 AND credential_type = $2
      LIMIT 1
      `,
      installationId,
      credentialType,
    );
    const afterExecute = afterExecuteRows[0];
    if (!afterExecute) {
      throw new Error("Expected credential row after execute.");
    }
    if (String(afterExecute.keyVersion) !== "v2") {
      throw new Error(`Expected key_version=v2 after execute, got ${String(afterExecute.keyVersion)}`);
    }
    const secondDecrypted = encryption.decrypt(
      String(afterExecute.encryptedValue),
      String(afterExecute.keyVersion),
    );
    if (secondDecrypted !== plainSecret) {
      throw new Error("Decrypt with rotated row key version failed.");
    }

    // Cleanup row to avoid polluting later runs.
    // RLS-BYPASS: manual tenant filter
    await db.$executeRawUnsafe(
      `DELETE FROM connector_installations WHERE id = $1 AND tenant_key = $2`,
      installationId,
      tenantKey,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantKey,
          installationId,
          validated: [
            "encrypt_uses_current_key_version",
          "decrypt_uses_row_key_version",
          "rotate_dry_run_no_write",
          "rotate_execute_updates_key_version",
        ],
        checkedAt: new Date().toISOString(),
      },
        null,
        2,
      ),
    );
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const stdout = stdoutBuffer.join("").slice(-4000);
    const stderr = stderrBuffer.join("").slice(-4000);
    console.error("Credential rotation integration test failed:");
    console.error(details);
    if (stdout) {
      console.error("--- API stdout tail ---");
      console.error(stdout);
    }
    if (stderr) {
      console.error("--- API stderr tail ---");
      console.error(stderr);
    }
    process.exitCode = 1;
  } finally {
    if (prismaDirect) {
      try {
        await prismaDirect.onModuleDestroy();
      } catch {
        // Ignore cleanup errors.
      }
    }
    if (!apiProcess.killed && apiProcess.pid) {
      if (process.platform === "win32") {
        try {
          execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], {
            stdio: "ignore",
          });
        } catch {
          // Ignore cleanup failures.
        }
      } else {
        apiProcess.kill("SIGTERM");
        await sleep(500);
        if (!apiProcess.killed) {
          apiProcess.kill("SIGKILL");
        }
      }
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
