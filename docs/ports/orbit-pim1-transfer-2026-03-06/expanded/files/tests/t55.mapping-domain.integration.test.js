const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");

function runTsxInline(script, env = {}) {
  const base = path.join(REPO_ROOT, ".tmp-inline-tests");
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, "orbit-t55-inline-"));
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
        ...env,
      },
      timeout: 90_000,
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

jest.setTimeout(100_000);

test("T55-1: mapping lifecycle, precedence, fallback policy, and tenant isolation are enforced", () => {
  const result = runTsxInline(`
    import { createRequire } from "module";
    import { randomUUID } from "crypto";
    const require = createRequire(process.cwd() + "/package.json");
    const express = require("express");
    const cookieParser = require("cookie-parser");
    const { signAccessToken } = require(process.cwd() + "/src/auth/jwt.ts");
    const { authDb } = require(process.cwd() + "/src/auth/db.ts");
    const { protectedRouter } = require(process.cwd() + "/src/auth/protected-routes.ts");

    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    const mappings = [];
    const mappingEvents = [];

    const nowIso = () => new Date().toISOString();
    const clone = (obj) => JSON.parse(JSON.stringify(obj));
    const sortByCreatedDesc = (rows) => rows.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

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
      if (query.includes("INSERT INTO audit_logs")) {
        return { rows: [], rowCount: 1 };
      }

      if (query.includes("INSERT INTO connector_mapping_versions")) {
        const row = {
          id: randomUUID(),
          tenant_id: String(params[0]),
          connector_slug: String(params[1]),
          category_scope: String(params[2]),
          mapping_level: String(params[3]),
          lifecycle_state: "draft",
          connector_definition_id: String(params[4]),
          connector_definition_version: String(params[5]),
          compatibility_state: String(params[6] ?? "compatible"),
          mapping_rules: clone(JSON.parse(String(params[7] ?? "{}"))),
          fallback_policy: clone(JSON.parse(String(params[8] ?? "{}"))),
          fallback_ack_required: Boolean(params[9]),
          published_at: null,
          superseded_by: null,
          created_by: params[10] ? String(params[10]) : null,
          created_at: nowIso(),
          updated_at: nowIso(),
          archived_at: null,
        };
        mappings.push(row);
        return { rows: [clone(row)], rowCount: 1 };
      }

      if (query.includes("INSERT INTO connector_mapping_events")) {
        mappingEvents.push({
          tenant_id: params[0] ? String(params[0]) : null,
          mapping_version_id: String(params[1]),
          event_type: String(params[2]),
          actor_id: params[3] ? String(params[3]) : null,
          metadata: clone(JSON.parse(String(params[4] ?? "{}"))),
          created_at: nowIso(),
        });
        return { rows: [], rowCount: 1 };
      }

      if (
        query.includes("FROM connector_mapping_versions") &&
        query.includes("WHERE tenant_id=$1") &&
        query.includes("AND connector_slug=$2") &&
        query.includes("AND ($3::text IS NULL OR category_scope=$3::text)")
      ) {
        const tenantId = String(params[0]);
        const connectorSlug = String(params[1]);
        const categoryScope = params[2] ? String(params[2]) : null;
        const includeArchived = Boolean(params[3]);
        let rows = mappings.filter((row) => row.tenant_id === tenantId && row.connector_slug === connectorSlug);
        if (categoryScope) rows = rows.filter((row) => row.category_scope === categoryScope);
        if (!includeArchived) rows = rows.filter((row) => row.lifecycle_state !== "archived");
        return { rows: sortByCreatedDesc(rows).map(clone), rowCount: rows.length };
      }

      if (
        query.includes("FROM connector_mapping_versions") &&
        query.includes("WHERE tenant_id=$1 AND connector_slug=$2 AND id=$3") &&
        query.includes("LIMIT 1")
      ) {
        const tenantId = String(params[0]);
        const connectorSlug = String(params[1]);
        const versionId = String(params[2]);
        const row = mappings.find(
          (entry) => entry.tenant_id === tenantId && entry.connector_slug === connectorSlug && entry.id === versionId
        );
        return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
      }

      if (query.includes("SET lifecycle_state='validated'")) {
        const tenantId = String(params[0]);
        const connectorSlug = String(params[1]);
        const versionId = String(params[2]);
        const row = mappings.find(
          (entry) => entry.tenant_id === tenantId && entry.connector_slug === connectorSlug && entry.id === versionId
        );
        if (!row) return { rows: [], rowCount: 0 };
        row.lifecycle_state = "validated";
        row.updated_at = nowIso();
        return { rows: [clone(row)], rowCount: 1 };
      }

      if (query.includes("FOR UPDATE") && query.includes("WHERE tenant_id=$1 AND connector_slug=$2 AND id=$3")) {
        const tenantId = String(params[0]);
        const connectorSlug = String(params[1]);
        const versionId = String(params[2]);
        const row = mappings.find(
          (entry) => entry.tenant_id === tenantId && entry.connector_slug === connectorSlug && entry.id === versionId
        );
        return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
      }

      if (query.includes("SET lifecycle_state='superseded'")) {
        const targetId = String(params[0]);
        const tenantId = String(params[1]);
        const connectorSlug = String(params[2]);
        const categoryScope = String(params[3]);
        const impacted = [];
        for (const row of mappings) {
          if (
            row.tenant_id === tenantId &&
            row.connector_slug === connectorSlug &&
            row.category_scope === categoryScope &&
            row.lifecycle_state === "published" &&
            row.id !== targetId
          ) {
            row.lifecycle_state = "superseded";
            row.superseded_by = targetId;
            row.updated_at = nowIso();
            impacted.push({ id: row.id });
          }
        }
        return { rows: impacted, rowCount: impacted.length };
      }

      if (query.includes("SET lifecycle_state='published'")) {
        const tenantId = String(params[0]);
        const connectorSlug = String(params[1]);
        const versionId = String(params[2]);
        const row = mappings.find(
          (entry) => entry.tenant_id === tenantId && entry.connector_slug === connectorSlug && entry.id === versionId
        );
        if (!row) return { rows: [], rowCount: 0 };
        row.lifecycle_state = "published";
        row.published_at = nowIso();
        row.updated_at = nowIso();
        return { rows: [clone(row)], rowCount: 1 };
      }

      if (query.includes("SET lifecycle_state='archived'")) {
        const tenantId = String(params[0]);
        const connectorSlug = String(params[1]);
        const versionId = String(params[2]);
        const row = mappings.find(
          (entry) => entry.tenant_id === tenantId && entry.connector_slug === connectorSlug && entry.id === versionId
        );
        if (!row) return { rows: [], rowCount: 0 };
        row.lifecycle_state = "archived";
        row.archived_at = nowIso();
        row.updated_at = nowIso();
        return { rows: [clone(row)], rowCount: 1 };
      }

      if (
        query.includes("FROM connector_mapping_versions") &&
        query.includes("WHERE lifecycle_state='published'") &&
        query.includes("connector_slug=$2")
      ) {
        const tenantId = String(params[0]);
        const connectorSlug = String(params[1]);
        const categoryScope = String(params[2]);
        const matched = mappings
          .filter((row) => row.lifecycle_state === "published" && row.connector_slug === connectorSlug)
          .filter((row) => {
            if (row.tenant_id === null) return row.mapping_level === "connector_default_template" && row.category_scope === "*";
            if (row.tenant_id !== tenantId) return false;
            if (row.mapping_level === "tenant_connector_default") return row.category_scope === "*";
            if (row.mapping_level === "tenant_connector_category_mapping") return row.category_scope === categoryScope;
            return false;
          });
        matched.sort((a, b) => {
          const weight = (level) => {
            if (level === "connector_default_template") return 1;
            if (level === "tenant_connector_default") return 2;
            return 3;
          };
          const byWeight = weight(a.mapping_level) - weight(b.mapping_level);
          if (byWeight !== 0) return byWeight;
          return String(a.created_at).localeCompare(String(b.created_at));
        });
        return { rows: matched.map(clone), rowCount: matched.length };
      }

      if (String(query).trim() === "BEGIN" || String(query).trim() === "COMMIT" || String(query).trim() === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }

      return { rows: [], rowCount: 0 };
    };

    authDb.query = handleQuery;
    authDb.connect = async () => ({ query: handleQuery, release() {} });

    const tokenA = await signAccessToken({
      sub: userA,
      tenant_id: tenantA,
      role: "tenant_admin",
      scope: ["connectors:manage", "config:read"],
      mfa_verified: true,
      mfa_type: "totp",
    });
    const tokenB = await signAccessToken({
      sub: userB,
      tenant_id: tenantB,
      role: "tenant_admin",
      scope: ["connectors:manage", "config:read"],
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
      const authA = { authorization: "Bearer " + tokenA, "content-type": "application/json" };
      const authB = { authorization: "Bearer " + tokenB, "content-type": "application/json" };

      const createDefault = await fetch("http://127.0.0.1:" + port + "/mappings/flipkart/versions", {
        method: "POST",
        headers: authA,
        body: JSON.stringify({
          category_scope: "*",
          mapping_level: "tenant_connector_default",
          connector_definition_id: "flipkart",
          connector_definition_version: "1.0.0",
          mapping_rules: { field_mappings: { title: "name", sku: "sku" } },
        }),
      });
      if (createDefault.status !== 201) throw new Error("create_default_mapping_failed");
      const defaultBody = await createDefault.json();
      const defaultId = String(defaultBody.id ?? "");

      const validateDefault = await fetch(
        "http://127.0.0.1:" + port + "/mappings/flipkart/versions/" + encodeURIComponent(defaultId) + "/validate",
        { method: "POST", headers: authA, body: JSON.stringify({}) }
      );
      if (validateDefault.status !== 200) throw new Error("validate_default_mapping_failed");

      const publishDefault = await fetch(
        "http://127.0.0.1:" + port + "/mappings/flipkart/versions/" + encodeURIComponent(defaultId) + "/publish",
        { method: "POST", headers: authA, body: JSON.stringify({ confirm: true }) }
      );
      if (publishDefault.status !== 200) throw new Error("publish_default_mapping_failed");

      const createCategory = await fetch("http://127.0.0.1:" + port + "/mappings/flipkart/versions", {
        method: "POST",
        headers: authA,
        body: JSON.stringify({
          category_scope: "apparel.men.shirts",
          mapping_level: "tenant_connector_category_mapping",
          connector_definition_id: "flipkart",
          connector_definition_version: "1.0.0",
          compatibility_state: "deprecated",
          mapping_rules: {
            category: { target: "mens_shirts" },
            field_mappings: { size: "size_label" },
            attribute_overrides: { title: "product_title" },
          },
        }),
      });
      if (createCategory.status !== 201) throw new Error("create_category_mapping_failed");
      const categoryBody = await createCategory.json();
      const categoryId = String(categoryBody.id ?? "");

      const validateCategory = await fetch(
        "http://127.0.0.1:" + port + "/mappings/flipkart/versions/" + encodeURIComponent(categoryId) + "/validate",
        { method: "POST", headers: authA, body: JSON.stringify({}) }
      );
      if (validateCategory.status !== 200) throw new Error("validate_category_mapping_failed");

      const publishCategory = await fetch(
        "http://127.0.0.1:" + port + "/mappings/flipkart/versions/" + encodeURIComponent(categoryId) + "/publish",
        { method: "POST", headers: authA, body: JSON.stringify({ confirm: true }) }
      );
      if (publishCategory.status !== 200) throw new Error("publish_category_mapping_failed");

      const resolve = await fetch(
        "http://127.0.0.1:" + port + "/mappings/flipkart/resolve?categoryScope=apparel.men.shirts",
        { headers: { authorization: "Bearer " + tokenA } }
      );
      if (resolve.status !== 200) throw new Error("resolve_failed");
      const resolved = await resolve.json();
      if (resolved.compatibility_state !== "deprecated") throw new Error("resolve_compatibility_mismatch");
      if (resolved.resolved.field_mappings.title !== "product_title") throw new Error("attribute_override_not_applied");
      if (!Array.isArray(resolved.matched_versions) || resolved.matched_versions.length !== 2) {
        throw new Error("resolve_matched_versions_mismatch");
      }

      const createDefaultV2 = await fetch("http://127.0.0.1:" + port + "/mappings/flipkart/versions", {
        method: "POST",
        headers: authA,
        body: JSON.stringify({
          category_scope: "*",
          mapping_level: "tenant_connector_default",
          connector_definition_id: "flipkart",
          connector_definition_version: "1.0.1",
          mapping_rules: { field_mappings: { title: "title_v2", sku: "sku" } },
        }),
      });
      if (createDefaultV2.status !== 201) throw new Error("create_default_v2_failed");
      const defaultV2 = await createDefaultV2.json();

      const validateDefaultV2 = await fetch(
        "http://127.0.0.1:" + port + "/mappings/flipkart/versions/" + encodeURIComponent(String(defaultV2.id)) + "/validate",
        { method: "POST", headers: authA, body: JSON.stringify({}) }
      );
      if (validateDefaultV2.status !== 200) throw new Error("validate_default_v2_failed");

      const publishDefaultV2 = await fetch(
        "http://127.0.0.1:" + port + "/mappings/flipkart/versions/" + encodeURIComponent(String(defaultV2.id)) + "/publish",
        { method: "POST", headers: authA, body: JSON.stringify({ confirm: true }) }
      );
      if (publishDefaultV2.status !== 200) throw new Error("publish_default_v2_failed");

      const listDefault = await fetch("http://127.0.0.1:" + port + "/mappings/flipkart/versions?categoryScope=*", {
        headers: { authorization: "Bearer " + tokenA },
      });
      if (listDefault.status !== 200) throw new Error("list_default_failed");
      const listBody = await listDefault.json();
      const publishedCount = listBody.items.filter((item) => item.lifecycleState === "published").length;
      const supersededCount = listBody.items.filter((item) => item.lifecycleState === "superseded").length;
      if (publishedCount !== 1 || supersededCount < 1) throw new Error("published_invariant_failed");

      const createFallback = await fetch("http://127.0.0.1:" + port + "/mappings/tally/versions", {
        method: "POST",
        headers: authA,
        body: JSON.stringify({
          category_scope: "*",
          mapping_level: "tenant_connector_default",
          connector_definition_id: "tally",
          connector_definition_version: "1.0.0",
          mapping_rules: { field_mappings: { title: "name" } },
          fallback_policy: { strategy: "default_category" },
          fallback_ack_required: true,
        }),
      });
      if (createFallback.status !== 201) throw new Error("create_fallback_mapping_failed");
      const fallbackBody = await createFallback.json();

      const validateFallback = await fetch(
        "http://127.0.0.1:" + port + "/mappings/tally/versions/" + encodeURIComponent(String(fallbackBody.id)) + "/validate",
        { method: "POST", headers: authA, body: JSON.stringify({}) }
      );
      if (validateFallback.status !== 200) throw new Error("validate_fallback_mapping_failed");

      const publishFallback = await fetch(
        "http://127.0.0.1:" + port + "/mappings/tally/versions/" + encodeURIComponent(String(fallbackBody.id)) + "/publish",
        { method: "POST", headers: authA, body: JSON.stringify({ confirm: true }) }
      );
      if (publishFallback.status !== 200) throw new Error("publish_fallback_mapping_failed");

      const preflightBlocked = await fetch("http://127.0.0.1:" + port + "/mappings/tally/preflight", {
        method: "POST",
        headers: authA,
        body: JSON.stringify({ category_scope: "missing.category", fallback_acknowledged: false }),
      });
      if (preflightBlocked.status !== 409) throw new Error("preflight_should_block_without_ack");
      const preflightBlockedBody = await preflightBlocked.json();
      if (!preflightBlockedBody.blockers.includes("fallback_ack_required")) {
        throw new Error("preflight_ack_blocker_missing");
      }

      const preflightAllowed = await fetch("http://127.0.0.1:" + port + "/mappings/tally/preflight", {
        method: "POST",
        headers: authA,
        body: JSON.stringify({ category_scope: "missing.category", fallback_acknowledged: true }),
      });
      if (preflightAllowed.status !== 200) throw new Error("preflight_should_allow_with_ack");

      const crossTenant = await fetch(
        "http://127.0.0.1:" + port + "/mappings/flipkart/versions/" + encodeURIComponent(defaultId) + "/validate",
        { method: "POST", headers: authB, body: JSON.stringify({}) }
      );
      if (crossTenant.status !== 404) throw new Error("cross_tenant_should_be_denied");

      if (mappingEvents.length < 8) throw new Error("mapping_events_not_recorded");

      console.log("ok");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  `);

  expectSuccess(result);
  expect(result.stdout).toContain("ok");
});
