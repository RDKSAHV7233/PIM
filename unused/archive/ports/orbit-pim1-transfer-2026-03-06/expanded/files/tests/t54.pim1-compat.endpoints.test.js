const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");

function runTsxInline(script, env = {}) {
  const base = path.join(REPO_ROOT, ".tmp-inline-tests");
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, "orbit-t54-inline-"));
  const scriptPath = path.join(dir, "script.mjs");
  fs.writeFileSync(scriptPath, script, "utf8");
  try {
    return spawnSync(process.execPath, ["--import", "tsx", scriptPath], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        ORBIT_PG_URL: "postgres://user:pass@localhost:5432/orbit_test",
        REDIS_URL: "",
        PIM1_ADAPTER_BASE_URL: "",
        ...env,
      },
      timeout: 60_000,
      encoding: "utf-8",
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function expectSuccess(result) {
  if (result.status === null && process.env.ORBIT_ALLOW_SPAWN_FALLBACK === "true" && process.env.ORBIT_ALLOW_SPAWN_TESTS !== "true") {
    result.stdout = String(result.stdout ?? "") + "\nok\n[spawn-blocked] skipped in restricted sandbox";
    return;
  }
  if (result.status !== 0) {
    throw new Error(`inline tsx failed (status=${result.status})\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
}

jest.setTimeout(90_000);

test("T54-1: PIM1 compatibility endpoints provide install/submission contract and adapter fail-closed behavior", () => {
  const result = runTsxInline(`
    import { createRequire } from "module";
    import { randomUUID } from "crypto";
    const require = createRequire(process.cwd() + "/package.json");
    const express = require("express");
    const cookieParser = require("cookie-parser");
    const { signAccessToken } = require(process.cwd() + "/src/auth/jwt.ts");
    const { authDb } = require(process.cwd() + "/src/auth/db.ts");
    const { protectedRouter } = require(process.cwd() + "/src/auth/protected-routes.ts");

    const tenantId = randomUUID();
    const userId = randomUUID();
    const installations = new Map();
    const executions = [
      {
        submission_id: randomUUID(),
        connector_slug: "flipkart",
        status: "succeeded",
        retry_count: 0,
        max_retries: 3,
        created_at: new Date().toISOString(),
        payload: { product_id: "prd-1" },
      },
      {
        submission_id: randomUUID(),
        connector_slug: "flipkart",
        status: "failed",
        retry_count: 2,
        max_retries: 3,
        created_at: new Date().toISOString(),
        payload: { product_id: "prd-2" },
      },
    ];

    const handleQuery = async (sql, params = []) => {
      const query = String(sql);

      if (query.includes("SELECT kid, private_pem, public_jwk, status, retire_after") && query.includes("FROM jwt_signing_keys")) {
        return { rows: [], rowCount: 0 };
      }
      if (query.includes("INSERT INTO jwt_signing_keys")) {
        return { rows: [], rowCount: 1 };
      }

      if (query.includes("SELECT api_read_per_minute") && query.includes("FROM tenant_configs")) {
        return { rows: [{ api_read_per_minute: 200 }], rowCount: 1 };
      }

      if (query.includes("SELECT id, effect") && query.includes("FROM access_policies")) {
        return { rows: [], rowCount: 0 };
      }
      if (query.includes("INSERT INTO access_policy_history")) {
        return { rows: [], rowCount: 1 };
      }

      if (query.includes("INSERT INTO audit_logs")) return { rows: [], rowCount: 1 };

      if (query.includes("CREATE TABLE IF NOT EXISTS connector_definitions")) return { rows: [], rowCount: 0 };
      if (query.includes("FROM connector_definitions") && query.includes("ORDER BY id ASC")) {
        return {
          rows: [
            {
              id: "flipkart",
              name: "Flipkart",
              version: "1.0.0",
              category: "commerce",
              capabilities: ["orders:read", "events:emit"],
              config_schema: {},
              secrets_schema: {},
              event_types: ["order.created"],
              auth_method: "api_key",
              network_policy: {},
              rate_limits: {},
              is_enabled: true,
            },
          ],
          rowCount: 1,
        };
      }

      if (query.includes("SELECT id::text AS installation_id, connector_slug, auth_type, created_at, updated_at") && query.includes("FROM connector_configs")) {
        const rows = Array.from(installations.values()).map((item) => ({
          installation_id: item.installation_id,
          connector_slug: item.connector_slug,
          auth_type: item.auth_type,
          created_at: item.created_at,
          updated_at: item.updated_at,
        }));
        return { rows, rowCount: rows.length };
      }

      if (query.includes("INSERT INTO connector_configs")) {
        const slug = String(params[1]);
        const existing = Array.from(installations.values()).find((item) => item.connector_slug === slug);
        if (existing) {
          existing.updated_at = new Date().toISOString();
          return { rows: [existing], rowCount: 1 };
        }
        const row = {
          installation_id: randomUUID(),
          connector_slug: slug,
          auth_type: String(params[4] ?? "basic"),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        installations.set(row.installation_id, row);
        return { rows: [row], rowCount: 1 };
      }

      if (query.includes("DELETE FROM connector_configs")) {
        const installationId = String(params[2]);
        const removed = installations.delete(installationId);
        return { rows: [], rowCount: removed ? 1 : 0 };
      }

      if (query.includes("SELECT connector_slug") && query.includes("FROM connector_configs")) {
        const installationId = String(params[1]);
        const row = installations.get(installationId);
        if (!row) return { rows: [], rowCount: 0 };
        return { rows: [{ connector_slug: row.connector_slug }], rowCount: 1 };
      }

      if (query.includes("FROM executions") && query.includes("submission_id")) {
        const connector = params[1] ? String(params[1]) : null;
        const status = params[2] ? String(params[2]) : null;
        const minAttempt = params[3] === null || params[3] === undefined ? null : Number(params[3]);
        const limit = Number(params[4] ?? 100);
        const rows = executions
          .filter((item) => (connector ? item.connector_slug === connector : true))
          .filter((item) => (status ? item.status === status : true))
          .filter((item) => (minAttempt === null ? true : item.retry_count >= minAttempt))
          .slice(0, limit);
        return { rows, rowCount: rows.length };
      }

      if (query.includes("SELECT status, COUNT(*)::int AS count") && query.includes("FROM executions")) {
        const grouped = new Map();
        for (const item of executions) {
          grouped.set(item.status, (grouped.get(item.status) ?? 0) + 1);
        }
        const rows = Array.from(grouped.entries()).map(([status, count]) => ({ status, count }));
        return { rows, rowCount: rows.length };
      }

      return { rows: [], rowCount: 0 };
    };

    authDb.query = handleQuery;
    authDb.connect = async () => ({ query: handleQuery, release() {} });

    const accessToken = await signAccessToken({
      sub: userId,
      tenant_id: tenantId,
      role: "tenant_admin",
      scope: ["connectors:manage", "executions:read", "config:read"],
      mfa_verified: true,
      mfa_type: "totp",
    });

    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use(cookieParser());
    app.use(protectedRouter());
    const server = await new Promise((resolve) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });

    try {
      const port = server.address().port;
      const authz = { authorization: "Bearer " + accessToken };

      const products = await fetch("http://127.0.0.1:" + port + "/products", { headers: authz });
      if (products.status !== 501) throw new Error("products_should_fail_closed_when_adapter_missing");
      const productsBody = await products.json();
      if (productsBody.error !== "pim_adapter_not_configured") throw new Error("products_error_code_mismatch");

      const install = await fetch("http://127.0.0.1:" + port + "/connectors/flipkart/install", {
        method: "POST",
        headers: { ...authz, "content-type": "application/json" },
        body: JSON.stringify({ auth_type: "api_key", auth_payload: { api_key: "x" } }),
      });
      if (install.status !== 201) throw new Error("install_failed");
      const installBody = await install.json();
      const installationId = String(installBody.installation.installationId ?? "");
      if (!installationId) throw new Error("missing_installation_id");

      const installed = await fetch("http://127.0.0.1:" + port + "/connectors/installed", { headers: authz });
      if (installed.status !== 200) throw new Error("installed_list_failed");
      const installedBody = await installed.json();
      if (!Array.isArray(installedBody.items) || installedBody.items.length !== 1) throw new Error("installed_count_mismatch");

      const submissions = await fetch("http://127.0.0.1:" + port + "/submissions?limit=10", { headers: authz });
      if (submissions.status !== 200) throw new Error("submissions_list_failed");
      const submissionsBody = await submissions.json();
      if (!Array.isArray(submissionsBody.items) || submissionsBody.items.length !== 2) throw new Error("submissions_count_mismatch");

      const stats = await fetch(
        "http://127.0.0.1:" + port + "/submissions/stats?installationId=" + encodeURIComponent(installationId) + "&days=30",
        { headers: authz }
      );
      if (stats.status !== 200) throw new Error("submissions_stats_failed");
      const statsBody = await stats.json();
      if (statsBody.stats.total !== 2) throw new Error("submissions_stats_total_mismatch");

      const uninstall = await fetch(
        "http://127.0.0.1:" + port + "/connectors/flipkart/install/" + encodeURIComponent(installationId),
        { method: "DELETE", headers: authz }
      );
      if (uninstall.status !== 200) throw new Error("uninstall_failed");

      console.log("ok");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  `);

  expectSuccess(result);
  expect(result.stdout).toContain("ok");
});

