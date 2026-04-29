#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const http = require("node:http");
const { spawn, execFileSync, execSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const SCHEMA_PATH = path.join(REPO_ROOT, "packages", "db", "prisma", "schema.prisma");
const MIGRATION_FILES = [
  path.join(
    REPO_ROOT,
    "packages",
    "db",
    "prisma",
    "migrations",
    "20260425140949_add_access_scope_assignments",
    "migration.sql",
  ),
  path.join(
    REPO_ROOT,
    "packages",
    "db",
    "prisma",
    "migrations",
    "20260429113000_add_auth_identity_assigned_roles",
    "migration.sql",
  ),
  path.join(
    REPO_ROOT,
    "packages",
    "db",
    "prisma",
    "migrations",
    "20260427153000_expand_access_scope_dimensions",
    "migration.sql",
  ),
];

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) {
      continue;
    }
    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^"|"$/g, "");
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
  const localDatabaseUrl = "postgresql://postgres:postgres@localhost:5432/pim1?schema=public";
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl || /HOST:5432/i.test(databaseUrl)) {
    process.env.DATABASE_URL = localDatabaseUrl;
  }
  if (!process.env.DATABASE_URL_POOLED || /HOST:5432/i.test(String(process.env.DATABASE_URL_POOLED))) {
    process.env.DATABASE_URL_POOLED = process.env.DATABASE_URL;
  }
  if (!process.env.DATABASE_URL_DIRECT || /HOST:5432/i.test(String(process.env.DATABASE_URL_DIRECT))) {
    process.env.DATABASE_URL_DIRECT = process.env.DATABASE_URL;
  }
  setDefaultEnv("JWT_SECRET", "vexa-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "vexa-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("PIM_DEFAULT_ROLE", "admin");
}

function runMigrations() {
  const env = { ...process.env };
  for (const migrationFile of MIGRATION_FILES) {
    const command =
      process.platform === "win32"
        ? `npx prisma db execute --schema "${SCHEMA_PATH}" --file "${migrationFile}"`
        : `npx prisma db execute --schema '${SCHEMA_PATH}' --file '${migrationFile}'`;
    try {
      execSync(command, {
        cwd: REPO_ROOT,
        stdio: "pipe",
        encoding: "utf8",
        env,
      });
    } catch (error) {
      const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
      if (/already exists/i.test(output) || /already contains|duplicate/i.test(output)) {
        continue;
      }
      throw error;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire free TCP port")));
        return;
      }
      const selectedPort = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(selectedPort);
      });
    });
  });
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
      // retry
    }
    await sleep(400);
  }
  throw new Error(`API did not become healthy at ${baseUrl}/health within ${timeoutMs}ms`);
}

async function apiRequest(baseUrl, method, route, token, body) {
  const headers = { Accept: "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const options = {
    method,
    headers,
    signal: AbortSignal.timeout(15_000),
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${route}`, options);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, payload };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(`${context} failed: expected ${expected}, got ${result.status} payload=${JSON.stringify(result.payload)}`);
  }
}

function createShopifyGraphqlStub() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.method !== "POST" || req.url !== "/admin/api/2026-04/graphql.json") {
        res.statusCode = 404;
        res.end();
        return;
      }

      const chunks = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks).toString("utf8");
      const parsed = body ? JSON.parse(body) : {};
      const query = String(parsed.query || "");

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      if (query.includes("publications(first: 50)")) {
        res.end(
          JSON.stringify({
            data: {
              publications: {
                nodes: [
                  {
                    id: "gid://shopify/Publication/1",
                    name: "Online Store",
                    catalog: {
                      __typename: "AppCatalog",
                      id: "gid://shopify/AppCatalog/1",
                      title: "Online Store",
                      status: "ACTIVE",
                    },
                  },
                  {
                    id: "gid://shopify/Publication/2",
                    name: "Point of Sale",
                    catalog: {
                      __typename: "AppCatalog",
                      id: "gid://shopify/AppCatalog/2",
                      title: "Point of Sale",
                      status: "ACTIVE",
                    },
                  },
                  {
                    id: "gid://shopify/Publication/3",
                    name: "No Catalog Target",
                    catalog: null,
                  },
                ],
              },
            },
          }),
        );
        return;
      }

      res.end(JSON.stringify({ data: {} }));
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve Shopify GraphQL stub address."));
        return;
      }
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const tenantId = `shopify-publications-${runId}`;
  const workspaceSlug = `shopifypub-${runId}`.slice(0, 24);
  const userId = `shopify-publications-admin-${runId}`;
  const editorUserId = `shopify-publications-editor-${runId}`;
  const installationId = `inst_shopify_api_${runId}`;
  const stub = await createShopifyGraphqlStub();
  runMigrations();

  process.env.PIM_SHOPIFY_CLIENT_ID = "shopify-client-id";
  process.env.PIM_SHOPIFY_CLIENT_SECRET = "shopify-client-secret";
  process.env.PIM_SHOPIFY_ADMIN_API_BASE_URL = stub.baseUrl;
  process.env.PIM_SHOPIFY_ADMIN_API_VERSION = "2026-04";

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

  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL } },
  });
  const prismaDirect = new PrismaDirectService();
  await prismaDirect.onModuleInit();
  const logger = new LoggerService();
  const encryption = new ConnectorCredentialEncryptionService(prismaDirect, logger);

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const env = {
    ...process.env,
    PORT: String(port),
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
      [editorUserId]: { tenantId, role: "editor", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Shopify Publication Targets" },
    }),
    PIM_AUTH_PASSWORD: "vexa-pim-demo-password",
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
    if (stdoutBuffer.length > 200) stdoutBuffer.shift();
  });
  apiProcess.stderr.on("data", (chunk) => {
    stderrBuffer.push(String(chunk));
    if (stderrBuffer.length > 200) stderrBuffer.shift();
  });

  try {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO connector_installations (
        id, tenant_key, connector_id, account_alias, status, metadata, installed_by, created_at, updated_at
      ) VALUES ($1, $2, 'cdef_shopify', 'primary', 'ACTIVE', '{}'::jsonb, $3, NOW(), NOW())
      ON CONFLICT (tenant_key, connector_id, account_alias)
      DO UPDATE SET metadata = '{}'::jsonb, updated_at = NOW()
      `,
      installationId,
      tenantId,
      userId,
    );

    for (const [credentialType, plainValue] of [
      ["access_token", "shopify-access-token-live"],
      ["shop_domain", "demo-store.myshopify.com"],
      ["shop_id", "gid://shopify/Shop/9001"],
    ]) {
      await encryption.storeCredential({
        tenantKey: tenantId,
        installationId,
        credentialType,
        plainValue,
      });
    }

    await waitForHealth(baseUrl, 60_000);

    const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId,
      password: "vexa-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "admin login");
    const token = String(login.payload?.accessToken ?? "");
    assert(token.length > 10, "missing access token from login response");

    const createEditor = await apiRequest(baseUrl, "POST", "/admin/workspace/users", token, {
      userId: editorUserId,
      role: "editor",
    });
    assert([201, 409].includes(createEditor.status), `create editor user failed: ${createEditor.status}`);

    const editorLogin = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId: editorUserId,
      password: "vexa-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(editorLogin, 201, "editor login");
    const editorToken = String(editorLogin.payload?.accessToken ?? "");
    assert(editorToken.length > 10, "missing editor token from login response");

    const publications = await apiRequest(baseUrl, "GET", `/connectors/${installationId}/publications`, token);
    assertStatus(publications, 200, "list Shopify publications");
    assert(Array.isArray(publications.payload), "expected publications payload array");
    assert(publications.payload[0]?.selected === false, "expected no selected publication before update");

    const update = await apiRequest(
      baseUrl,
      "POST",
      `/connectors/${installationId}/publication-targets`,
      token,
      { publicationIds: ["gid://shopify/Publication/1"] },
    );
    assertStatus(update, 201, "update Shopify publication targets");
    assert(Array.isArray(update.payload?.publicationTargets), "expected updated publication target payload");
    assert(update.payload.publicationTargets[0]?.selected === true, "expected selected publication target in response");

    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT metadata
      FROM connector_installations
      WHERE tenant_key = $1
        AND id = $2
      LIMIT 1
      `,
      tenantId,
      installationId,
    );
    const metadata = rows[0]?.metadata || {};
    assert(
      Array.isArray(metadata.publicationTargetIds) && metadata.publicationTargetIds.includes("gid://shopify/Publication/1"),
      `expected publicationTargetIds metadata to persist, got ${JSON.stringify(metadata)}`,
    );

    const publicationsAfter = await apiRequest(baseUrl, "GET", `/connectors/${installationId}/publications`, token);
    assertStatus(publicationsAfter, 200, "list Shopify publications after update");
    assert(publicationsAfter.payload[0]?.selected === true, "expected selected publication after update");

    const grantEditorReconnect = await apiRequest(baseUrl, "POST", "/connectors/permissions", token, {
      principalType: "user",
      principalId: editorUserId,
      connectorSlug: "shopify",
      accountAlias: "primary",
      action: "reconnect",
    });
    assertStatus(grantEditorReconnect, 201, "grant editor reconnect permission");

    const assignConnectorScope = await apiRequest(baseUrl, "POST", "/admin/workspace/access-scopes", token, {
      subjectType: "user",
      subjectId: editorUserId,
      scopeType: "connector_account",
      connectorInstallationId: installationId,
      actions: ["manage_connector"],
    });
    assertStatus(assignConnectorScope, 201, "assign connector-account scope");

    const assignCatalogScope = await apiRequest(baseUrl, "POST", "/admin/workspace/access-scopes", token, {
      subjectType: "user",
      subjectId: editorUserId,
      scopeType: "catalog",
      scopeValue: "gid://shopify/AppCatalog/1",
      actions: ["manage_connector"],
    });
    assertStatus(assignCatalogScope, 201, "assign catalog scope");

    const scopedPublications = await apiRequest(baseUrl, "GET", `/connectors/${installationId}/publications`, editorToken);
    assertStatus(scopedPublications, 200, "catalog-scoped editor publication list");
    assert(Array.isArray(scopedPublications.payload), "expected scoped publications payload array");
    assert(scopedPublications.payload.length === 1, `expected 1 scoped publication, got ${scopedPublications.payload.length}`);
    assert(scopedPublications.payload[0]?.id === "gid://shopify/Publication/1", "expected only catalog-1 publication to remain visible");

    const scopedUpdateAllowed = await apiRequest(
      baseUrl,
      "POST",
      `/connectors/${installationId}/publication-targets`,
      editorToken,
      { publicationIds: ["gid://shopify/Publication/1"] },
    );
    assertStatus(scopedUpdateAllowed, 201, "catalog-scoped publication update allowed");

    const scopedUpdateDenied = await apiRequest(
      baseUrl,
      "POST",
      `/connectors/${installationId}/publication-targets`,
      editorToken,
      { publicationIds: ["gid://shopify/Publication/2"] },
    );
    assertStatus(scopedUpdateDenied, 403, "catalog-scoped publication update denied outside catalog");
    assert(
      String(scopedUpdateDenied.payload?.reason ?? "").includes("CATALOG_SCOPE_DENIED"),
      `expected CATALOG_SCOPE_DENIED for out-of-scope publication, got ${JSON.stringify(scopedUpdateDenied.payload)}`,
    );

    const scopedNullCatalogDenied = await apiRequest(
      baseUrl,
      "POST",
      `/connectors/${installationId}/publication-targets`,
      editorToken,
      { publicationIds: ["gid://shopify/Publication/3"] },
    );
    assertStatus(scopedNullCatalogDenied, 403, "catalog-scoped publication update denied when catalog cannot be proven");
    assert(
      String(scopedNullCatalogDenied.payload?.reason ?? "").includes("CATALOG_SCOPE_DENIED"),
      `expected CATALOG_SCOPE_DENIED for catalogless publication, got ${JSON.stringify(scopedNullCatalogDenied.payload)}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          installationId,
          validated: [
            "shopify_publication_targets_endpoint_lists_available_targets",
            "shopify_publication_targets_endpoint_persists_selection",
            "shopify_publication_targets_endpoint_reflects_selection_on_read",
            "catalog_scope_filters_publication_targets_to_allowed_catalog_ids",
            "catalog_scope_denies_publication_target_updates_outside_scope_or_without_catalog_proof",
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
    console.error("Shopify publication targets API test failed:");
    console.error(details);
    if (stdout) {
      console.error("--- API stdout tail ---");
      console.error(stdout);
    }
    if (stderr) {
      console.error("--- API stderr tail ---");
      console.error(stderr);
    }
    throw error;
  } finally {
    if (!apiProcess.killed && apiProcess.pid) {
      if (process.platform === "win32") {
        try {
          execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], { stdio: "ignore" });
        } catch {
          // ignore cleanup failure
        }
      } else {
        apiProcess.kill("SIGTERM");
        await sleep(500);
      }
    }
    await prisma.$disconnect();
    await prismaDirect.onModuleDestroy();
    await new Promise((resolve) => stub.server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
