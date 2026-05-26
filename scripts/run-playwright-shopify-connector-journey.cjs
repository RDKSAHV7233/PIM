#!/usr/bin/env node
/* eslint-disable no-console */
const http = require("node:http");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const envFile = path.join(root, ".env");
const apiBuildEntry = path.join(root, "apps", "api", "dist", "main.js");
const webBuildIdFile = path.join(root, "apps", "web", ".next", "BUILD_ID");

function loadEnvFile(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) {
    return values;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const hash = value.indexOf(" #");
    if (hash >= 0) {
      value = value.slice(0, hash).trim();
    }
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function playwrightInvocation(specPath) {
  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", `npx playwright test ${specPath} --config=playwright.config.cjs`],
    };
  }
  return {
    command: "npx",
    args: ["playwright", "test", specPath, "--config=playwright.config.cjs"],
  };
}

function runCommand(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env,
  });
  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
  if (result.error) {
    throw result.error;
  }
}

function resolveDatabaseUrl(fileEnv) {
  const localDatabaseUrl = "postgresql://postgres:postgres@localhost:5432/pim1?schema=public";
  const resolved = String(
    process.env.DATABASE_URL_POOLED ||
      process.env.DATABASE_URL ||
      fileEnv.DATABASE_URL_POOLED ||
      fileEnv.DATABASE_URL ||
      "",
  ).trim();
  return !resolved || /HOST:5432/i.test(resolved) ? localDatabaseUrl : resolved;
}

function shouldForcePrebuild() {
  return String(process.env.PLAYWRIGHT_FORCE_PREBUILD || "").trim() === "1";
}

function createShopifyStubServer() {
  const publicationName = "Online Store";
  const shopName = "Demo Store";
  const shopDomain = "demo-store.myshopify.com";
  const shopId = "gid://shopify/Shop/9001";
  const requests = [];

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
      const pathname = requestUrl.pathname.replace(/\/+$/, "") || "/";
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({
        method: req.method || "GET",
        pathname,
        body,
      });

      if (req.method === "POST" && pathname === "/admin/oauth/access_token") {
        const params = new URLSearchParams(body);
        const grantType = params.get("grant_type") || "";
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");

        if (grantType === "urn:ietf:params:oauth:grant-type:token-exchange") {
          res.end(
            JSON.stringify({
              access_token: "shopify-access-token-1",
              expires_in: 3600,
              refresh_token: "shopify-refresh-token-1",
              refresh_token_expires_in: 7776000,
              scope: "read_products,write_products,read_publications,write_publications",
            }),
          );
          return;
        }

        if (grantType === "refresh_token") {
          res.end(
            JSON.stringify({
              access_token: "shopify-access-token-refresh-1",
              expires_in: 3600,
              refresh_token: "shopify-refresh-token-refresh-1",
              refresh_token_expires_in: 7776000,
              scope: "read_products,write_products,read_publications,write_publications",
            }),
          );
          return;
        }

        res.statusCode = 400;
        res.end(JSON.stringify({ error: "unsupported_grant_type" }));
        return;
      }

      if (req.method === "POST" && /^\/admin\/api\/[^/]+\/graphql\.json$/.test(pathname)) {
        const parsed = body ? JSON.parse(body) : {};
        const query = String(parsed.query || "");

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");

        if (query.includes("shop {")) {
          res.end(
            JSON.stringify({
              data: {
                shop: {
                  id: shopId,
                  name: shopName,
                  myshopifyDomain: shopDomain,
                },
              },
            }),
          );
          return;
        }

        if (query.includes("publications(first: 50)")) {
          res.end(
            JSON.stringify({
              data: {
                publications: {
                  nodes: [
                    {
                      id: "gid://shopify/Publication/1",
                      name: publicationName,
                      catalog: {
                        __typename: "AppCatalog",
                        id: "gid://shopify/AppCatalog/1",
                        title: publicationName,
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
                  ],
                },
              },
            }),
          );
          return;
        }

        res.end(JSON.stringify({ data: {} }));
        return;
      }

      res.statusCode = 404;
      res.end();
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve Shopify stub address."));
        return;
      }
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
        publicationName,
        shopName,
        shopDomain,
        shopId,
        requests,
      });
    });
  });
}

async function main() {
  const fileEnv = loadEnvFile(envFile);
  const apiPort = 4500 + Math.floor(Math.random() * 100);
  const webPort = 3500 + Math.floor(Math.random() * 100);
  const databaseUrl = resolveDatabaseUrl(fileEnv);
  const shopifyHarness = {
    publicationName: "Online Store",
    shopName: "Demo Store",
    shopDomain: "demo-store.myshopify.com",
    shopId: "gid://shopify/Shop/9001",
  };

  const env = {
    ...process.env,
    ...fileEnv,
    PLAYWRIGHT_API_PORT: String(apiPort),
    PLAYWRIGHT_WEB_PORT: String(webPort),
    PLAYWRIGHT_API_URL: `http://127.0.0.1:${apiPort}/api/v1`,
    PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${webPort}`,
    PLAYWRIGHT_DATABASE_URL: databaseUrl,
    DATABASE_URL: databaseUrl,
    DATABASE_URL_POOLED: databaseUrl,
    DATABASE_URL_DIRECT: databaseUrl,
    PLAYWRIGHT_AUTH_MODE: "local",
    PLAYWRIGHT_PASSWORD: "vexa-pim-demo-password",
    PLAYWRIGHT_ENABLE_SHOPIFY_STUB: "1",
    PLAYWRIGHT_SKIP_PRISMA_GENERATE: "1",
    PLAYWRIGHT_SKIP_API_BUILD: "1",
    PLAYWRIGHT_SKIP_WEB_BUILD: "1",
    CORS_ORIGIN: `http://127.0.0.1:${webPort}`,
    PIM_SHOPIFY_CLIENT_ID: "shopify-client-id",
    PIM_SHOPIFY_CLIENT_SECRET: "shopify-client-secret",
    PIM_SHOPIFY_ADMIN_API_VERSION: "2026-04",
    PLAYWRIGHT_SHOPIFY_STORE_DOMAIN: shopifyHarness.shopDomain,
    PLAYWRIGHT_SHOPIFY_STORE_NAME: shopifyHarness.shopName,
    PLAYWRIGHT_SHOPIFY_STORE_ID: shopifyHarness.shopId,
    PLAYWRIGHT_SHOPIFY_PUBLICATION_NAME: shopifyHarness.publicationName,
    PLAYWRIGHT_SHOPIFY_PUBLICATION_COUNT_LABEL: "1 publication target",
  };

  runCommand("npm", ["run", "prisma:generate"], env);

  if (shouldForcePrebuild() || !fs.existsSync(apiBuildEntry)) {
    runCommand("npm", ["run", "build", "--workspace", "@pim1/api"], env);
  }

  if (shouldForcePrebuild() || !fs.existsSync(webBuildIdFile)) {
    runCommand("npm", ["run", "build", "--workspace", "@pim1/web"], {
      ...env,
      PIM_API_BASE_URL: env.PLAYWRIGHT_API_URL,
    });
  }

  const invocation = playwrightInvocation("apps/web/test/e2e/shopify-connector-managed-install.spec.js");
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env,
  });

  if (typeof result.status === "number") {
    process.exit(result.status);
  }
  if (result.error) {
    throw result.error;
  }
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
