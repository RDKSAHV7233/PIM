/* eslint-disable no-console */
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const root = path.resolve(__dirname, "..");
const envFile = path.join(root, ".env");
const apiStartScriptPath = path.join(root, "apps", "api", "scripts", "start-built-api.cjs");
const apiBuildEntryPath = path.join(root, "apps", "api", "dist", "main.js");
const apiBuildDistPath = path.join(root, "apps", "api", "dist");
const rootNodeModulesPath = path.join(root, "node_modules");
const prismaClientEntryPath = path.join(root, "node_modules", "@prisma", "client", "index.js");

function isWindowsInteropMount(filePath) {
  return /^\/mnt\/[a-z](?:\/|$)/i.test(path.resolve(filePath));
}

function shouldStageApiDist() {
  const mode = String(process.env.PLAYWRIGHT_API_DIST_STAGING ?? "auto").trim().toLowerCase();
  if (["0", "false", "off", "never"].includes(mode)) {
    return false;
  }
  if (["1", "true", "on", "always"].includes(mode)) {
    return true;
  }
  return isWindowsInteropMount(root);
}

function getNativeTmpRoot() {
  const requestedRuntimeDir = String(process.env.PLAYWRIGHT_API_RUNTIME_DIR || "").trim();
  return requestedRuntimeDir || (isWindowsInteropMount(os.tmpdir()) ? "/tmp" : os.tmpdir());
}

function getLatestMtimeMs(paths) {
  return paths.reduce((latest, filePath) => {
    try {
      return Math.max(latest, fs.statSync(filePath).mtimeMs);
    } catch {
      return latest;
    }
  }, 0);
}

function copyWorkspacePackageManifests(runtimeRoot) {
  for (const relativePath of ["package.json", "package-lock.json"]) {
    fs.copyFileSync(path.join(root, relativePath), path.join(runtimeRoot, relativePath));
  }

  for (const workspaceRoot of ["apps", "packages"]) {
    const workspaceParent = path.join(root, workspaceRoot);
    if (!fs.existsSync(workspaceParent)) {
      continue;
    }
    for (const workspaceName of fs.readdirSync(workspaceParent)) {
      const packageJsonPath = path.join(workspaceParent, workspaceName, "package.json");
      if (!fs.existsSync(packageJsonPath)) {
        continue;
      }
      const destination = path.join(runtimeRoot, workspaceRoot, workspaceName, "package.json");
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(packageJsonPath, destination);
    }
  }
}

function installNativeNodeModules(runtimeRoot) {
  copyWorkspacePackageManifests(runtimeRoot);
  const npmCi = spawnSync("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: runtimeRoot,
    stdio: "inherit",
  });
  if (npmCi.error) {
    throw npmCi.error;
  }
  if (npmCi.status !== 0) {
    throw new Error(`Failed to install native Playwright API dependencies; npm ci exited with ${npmCi.status}.`);
  }
}

function syncPrismaGeneratedClient(stagedNodeModules) {
  const source = path.join(rootNodeModulesPath, ".prisma");
  if (!fs.existsSync(source)) {
    return;
  }
  const destination = path.join(stagedNodeModules, ".prisma");
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true });
}

function syncNativeNodeModules(runtimeRoot) {
  const stagedNodeModules = path.join(runtimeRoot, "node_modules");
  const markerPath = path.join(runtimeRoot, ".node_modules_synced.json");
  const invalidationInputs = [
    path.join(root, "package.json"),
    path.join(root, "package-lock.json"),
    path.join(root, "apps", "api", "package.json"),
    path.join(rootNodeModulesPath, ".package-lock.json"),
  ];
  const latestInputMtime = getLatestMtimeMs(invalidationInputs);
  const markerMtime = getLatestMtimeMs([markerPath]);

  if (fs.existsSync(stagedNodeModules) && markerMtime >= latestInputMtime) {
    return stagedNodeModules;
  }

  console.log(`[playwright-api] installing API runtime dependencies on native filesystem: ${stagedNodeModules}`);
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.rmSync(stagedNodeModules, { recursive: true, force: true });
  installNativeNodeModules(runtimeRoot);
  syncPrismaGeneratedClient(stagedNodeModules);
  fs.writeFileSync(
    markerPath,
    `${JSON.stringify(
      {
        syncedAt: new Date().toISOString(),
        source: rootNodeModulesPath,
        latestInputMtime,
      },
      null,
      2,
    )}\n`,
  );
  return stagedNodeModules;
}

function stageApiDistForPlaywright() {
  if (!shouldStageApiDist()) {
    return null;
  }
  if (!fs.existsSync(apiBuildEntryPath)) {
    return null;
  }

  const port = String(process.env.PLAYWRIGHT_API_PORT || "4001").replace(/[^a-zA-Z0-9._-]/g, "_");
  const tmpRoot = getNativeTmpRoot();
  const runtimeRoot = path.join(tmpRoot, "vexa-pim-playwright-api-runtime");
  const stagedRoot = path.join(runtimeRoot, `api-${port}`);
  const stagedDist = path.join(stagedRoot, "dist");
  const stagedEntry = path.join(stagedDist, "main.js");
  const stagedLauncher = path.join(stagedRoot, "start-built-api.cjs");
  const stagedNodeModules = syncNativeNodeModules(runtimeRoot);

  fs.rmSync(stagedRoot, { recursive: true, force: true });
  fs.mkdirSync(stagedRoot, { recursive: true });
  fs.cpSync(apiBuildDistPath, stagedDist, { recursive: true });
  fs.copyFileSync(apiStartScriptPath, stagedLauncher);
  console.log(`[playwright-api] staged API dist on native filesystem: ${stagedDist}`);
  return { entry: stagedEntry, launcher: stagedLauncher, nodeModules: stagedNodeModules };
}

function prependNodePath(env, entries) {
  const delimiter = path.delimiter;
  const existing = String(env.NODE_PATH || "").trim();
  const values = [...entries.filter(Boolean), ...(existing ? existing.split(delimiter) : [])];
  env.NODE_PATH = Array.from(new Set(values)).join(delimiter);
}

function resolveDatabaseUrl(fileEnv) {
  const localDatabaseUrl =
    process.env.PLAYWRIGHT_DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/pim1?schema=playwright_e2e";
  const resolved = String(
    process.env.PLAYWRIGHT_DATABASE_URL ||
    process.env.DATABASE_URL_POOLED ||
      process.env.DATABASE_URL_DIRECT ||
      process.env.DATABASE_URL ||
      fileEnv.DATABASE_URL_POOLED ||
      fileEnv.DATABASE_URL_DIRECT ||
      fileEnv.DATABASE_URL ||
      "",
  ).trim();
  return !resolved || /HOST:5432/i.test(resolved) ? localDatabaseUrl : resolved;
}

function withConnectionLimit(databaseUrl, connectionLimit) {
  try {
    const parsed = new URL(databaseUrl);
    parsed.searchParams.set("connection_limit", String(connectionLimit));
    return parsed.toString();
  } catch {
    return databaseUrl;
  }
}

const PLAYWRIGHT_DEMO_USERS = {
  admin: () => process.env.PLAYWRIGHT_ADMIN_USER || "admin@vexa-pim.local",
  editor: () => process.env.PLAYWRIGHT_EDITOR_USER || "editor@vexa-pim.local",
  publisher: () => process.env.PLAYWRIGHT_PUBLISHER_USER || "publisher@vexa-pim.local",
  approver: () => process.env.PLAYWRIGHT_APPROVER_USER || "approver@vexa-pim.local",
  channel_manager: () => process.env.PLAYWRIGHT_CHANNEL_MANAGER_USER || "channel_manager@vexa-pim.local",
  connector_admin: () => process.env.PLAYWRIGHT_CONNECTOR_ADMIN_USER || "connector_admin@vexa-pim.local",
  reviewer: () => process.env.PLAYWRIGHT_REVIEWER_USER || "reviewer@vexa-pim.local",
  viewer: () => process.env.PLAYWRIGHT_VIEWER_USER || "viewer@vexa-pim.local",
};

function normalizeSeedValue(value, fallback) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || fallback;
}

function normalizePlanTier(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return ["TRIAL", "STARTER", "GROWTH", "BUSINESS", "ENTERPRISE"].includes(normalized)
    ? normalized
    : "ENTERPRISE";
}

function buildWorkspaceDisplayName(workspaceSlug) {
  const explicit = String(process.env.PLAYWRIGHT_WORKSPACE_NAME ?? "").trim();
  if (explicit) {
    return explicit;
  }
  if (workspaceSlug === "default") {
    return "Default";
  }
  return "Playwright Workspace";
}

async function seedPlaywrightFixtures(databaseUrl) {
  const authMode = String(process.env.PLAYWRIGHT_AUTH_MODE || process.env.AUTH_MODE || "local").trim().toLowerCase() || "local";
  if (authMode !== "db") {
    return;
  }

  const workspaceSlug = normalizeSeedValue(process.env.PLAYWRIGHT_WORKSPACE || process.env.PIM_DEFAULT_WORKSPACE_SLUG, "default");
  const tenantKey = normalizeSeedValue(process.env.PLAYWRIGHT_TENANT_KEY || process.env.PIM_DEFAULT_TENANT_KEY, workspaceSlug);
  const planTier = normalizePlanTier(process.env.PLAYWRIGHT_PLAN_TIER || "ENTERPRISE");
  const billingStatus = planTier === "TRIAL" ? "trial" : "active_paid";
  const workspaceDisplayName = buildWorkspaceDisplayName(workspaceSlug);
  const password = String(process.env.PLAYWRIGHT_PASSWORD || "vexa-pim-demo-password").trim() || "vexa-pim-demo-password";
  const passwordHash = await bcrypt.hash(password, 12);
  const seededAt = new Date();

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });

  try {
    await prisma.$connect();

    await prisma.workspaceDirectory.upsert({
      where: { tenantKey },
      create: {
        tenantKey,
        workspaceSlug,
        displayName: workspaceDisplayName,
        isActive: true,
      },
      update: {
        workspaceSlug,
        displayName: workspaceDisplayName,
        isActive: true,
      },
    });

    await prisma.tenantPlanProfile.upsert({
      where: { tenantKey },
      create: {
        tenantKey,
        planTier,
        billingStatus,
        accessStatus: "active",
        effectiveFrom: seededAt,
        trialEndsAt: null,
        paidThroughAt: null,
        graceEndsAt: null,
        cancelledAt: null,
        suspendedAt: null,
        suspensionReason: null,
        billingContactEmail: null,
        billingProvider: null,
        externalCustomerId: null,
        externalSubscriptionId: null,
        updatedBy: "playwright-bootstrap",
      },
      update: {
        planTier,
        billingStatus,
        accessStatus: "active",
        effectiveFrom: seededAt,
        trialEndsAt: null,
        paidThroughAt: null,
        graceEndsAt: null,
        cancelledAt: null,
        suspendedAt: null,
        suspensionReason: null,
        billingContactEmail: null,
        billingProvider: null,
        externalCustomerId: null,
        externalSubscriptionId: null,
        updatedBy: "playwright-bootstrap",
      },
    });

    for (const [role, getUserId] of Object.entries(PLAYWRIGHT_DEMO_USERS)) {
      const userId = String(getUserId()).trim().toLowerCase();
      await prisma.authIdentity.upsert({
        where: { userId },
        create: {
          tenantKey,
          userId,
          role,
          isActive: true,
          assignedRoles: [],
          passwordHash,
          createdBy: "playwright-bootstrap",
          lockedUntil: null,
          lastSignInAt: null,
        },
        update: {
          tenantKey,
          role,
          isActive: true,
          assignedRoles: [],
          passwordHash,
          createdBy: "playwright-bootstrap",
          lockedUntil: null,
          lastSignInAt: null,
        },
      });
    }

    console.log(
      `[playwright-bootstrap] Seeded DB auth fixtures for workspace "${workspaceSlug}" (tenant "${tenantKey}", plan ${planTier}).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function seedPlaywrightConnectorDefinitions(databaseUrl) {
  if (!/schema=playwright_e2e/i.test(databaseUrl)) {
    return;
  }

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });

  const definitions = [
    {
      id: "cdef_amazon_in",
      slug: "amazon-in",
      displayName: "Amazon India",
      authType: "OAUTH2_LWA",
      capabilities: ["PUBLISH", "VALIDATE", "STATUS_SYNC", "WEBHOOK_RECEIVE"],
      marketplaceId: "A21TJRUUN4KGV",
      connectorVersion: "1.0.0",
    },
    {
      id: "cdef_flipkart",
      slug: "flipkart",
      displayName: "Flipkart",
      authType: "OAUTH2_AUTHCODE",
      capabilities: ["PUBLISH", "VALIDATE", "STATUS_SYNC"],
      marketplaceId: null,
      connectorVersion: "1.0.0",
    },
    {
      id: "cdef_meesho",
      slug: "meesho",
      displayName: "Meesho",
      authType: "API_KEY",
      capabilities: ["VALIDATE", "EXCEL_EXPORT"],
      marketplaceId: null,
      connectorVersion: "1.0.0",
    },
    {
      id: "cdef_shopify",
      slug: "shopify",
      displayName: "Shopify",
      authType: "SHOPIFY_MANAGED_INSTALL",
      capabilities: ["PUBLISH", "VALIDATE", "STATUS_SYNC", "WEBHOOK_RECEIVE"],
      marketplaceId: null,
      connectorVersion: "0.1.0",
    },
  ];

  try {
    await prisma.$connect();
    for (const definition of definitions) {
      await prisma.connectorDefinition.upsert({
        where: { slug: definition.slug },
        create: {
          ...definition,
          isActive: true,
        },
        update: {
          displayName: definition.displayName,
          authType: definition.authType,
          capabilities: definition.capabilities,
          marketplaceId: definition.marketplaceId,
          connectorVersion: definition.connectorVersion,
          isActive: true,
        },
      });
    }
    console.log("[playwright-bootstrap] Seeded connector definitions for Playwright schema.");
  } finally {
    await prisma.$disconnect();
  }
}

async function seedPlaywrightTaxRegimes(databaseUrl) {
  if (!/schema=playwright_e2e/i.test(databaseUrl)) {
    return;
  }

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });

  const regimes = [
    {
      marketCode: "IN",
      name: "India GST",
      description: "Goods and Services Tax - HSN code required (4/6/8 digits)",
    },
    {
      marketCode: "GB",
      name: "UK VAT",
      description: "Value Added Tax - UK Trade Tariff commodity code (10 digits)",
    },
    {
      marketCode: "US",
      name: "US Sales Tax",
      description: "Sales tax - Avalara/AvaTax tax category string",
    },
    {
      marketCode: "AE",
      name: "UAE VAT",
      description: "Value Added Tax - HS code required (6 digits)",
    },
    {
      marketCode: "AU",
      name: "Australia GST",
      description: "Goods and Services Tax - commodity code",
    },
  ];

  try {
    await prisma.$connect();
    for (const regime of regimes) {
      await prisma.taxRegime.upsert({
        where: { marketCode: regime.marketCode },
        create: regime,
        update: {
          name: regime.name,
          description: regime.description,
        },
      });
    }
    console.log("[playwright-bootstrap] Seeded tax regimes for Playwright schema.");
  } finally {
    await prisma.$disconnect();
  }
}

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

function createShopifyStubServer() {
  const publicationName = String(process.env.PLAYWRIGHT_SHOPIFY_PUBLICATION_NAME || "Online Store").trim();
  const shopName = String(process.env.PLAYWRIGHT_SHOPIFY_STORE_NAME || "Demo Store").trim();
  const shopDomain = String(process.env.PLAYWRIGHT_SHOPIFY_STORE_DOMAIN || "demo-store.myshopify.com").trim();
  const shopId = String(process.env.PLAYWRIGHT_SHOPIFY_STORE_ID || "gid://shopify/Shop/9001").trim();
  const requests = [];
  const products = new Map();
  const productByHandle = new Map();
  let nextProductId = 4242;

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

        if (query.includes("productSet(")) {
          const input = parsed.variables?.input || {};
          const identifier = parsed.variables?.identifier || {};
          const title = String(input.title || "").trim();
          if (title.includes("CONTROLLED_SHOPIFY_FAIL")) {
            res.end(
              JSON.stringify({
                data: {
                  productSet: {
                    product: null,
                    userErrors: [
                      {
                        field: ["title"],
                        message: "Controlled Shopify failure for Playwright retry coverage",
                      },
                    ],
                  },
                },
              }),
            );
            return;
          }
          const handle = String(input.handle || identifier.handle || title.toLowerCase().replace(/[^a-z0-9]+/g, "-")).replace(/^-+|-+$/g, "") || `product-${nextProductId}`;
          const productId = String(identifier.id || productByHandle.get(handle) || `gid://shopify/Product/${nextProductId++}`);
          productByHandle.set(handle, productId);
          products.set(productId, {
            id: productId,
            title,
            handle,
            descriptionHtml: String(input.descriptionHtml || ""),
            status: String(input.status || "ACTIVE"),
            vendor: String(input.vendor || ""),
            productType: String(input.productType || ""),
            tags: Array.isArray(input.tags) ? input.tags : [],
            seo: input.seo || null,
            variants: Array.isArray(input.variants) ? input.variants : [],
            images: Array.isArray(input.files) ? input.files.map((file, index) => ({
              id: `${productId}/Image/${index + 1}`,
              src: String(file.originalSource || ""),
              altText: String(file.alt || ""),
              managedByVexa: true,
            })) : [],
          });
          res.end(
            JSON.stringify({
              data: {
                productSet: {
                  product: {
                    id: productId,
                    handle,
                    status: String(input.status || "ACTIVE"),
                    variants: {
                      edges: [
                        {
                          node: {
                            id: `${productId}/Variant/1`,
                          },
                        },
                      ],
                    },
                  },
                  userErrors: [],
                },
              },
            }),
          );
          return;
        }

        if (query.includes("publishablePublish")) {
          res.end(
            JSON.stringify({
              data: {
                publishablePublish: {
                  publishable: {
                    publishedOnPublication: true,
                  },
                  userErrors: [],
                },
              },
            }),
          );
          return;
        }

        if (query.includes("productVariantsBulkUpdate")) {
          const productId = String(parsed.variables?.productId || "");
          const variants = Array.isArray(parsed.variables?.variants) ? parsed.variables.variants : [];
          res.end(
            JSON.stringify({
              data: {
                productVariantsBulkUpdate: {
                  productVariants: variants.map((v, i) => ({
                    id: `${productId}/Variant/${i + 1}`,
                    price: String(v?.price || "0.00"),
                  })),
                  userErrors: [],
                },
              },
            }),
          );
          return;
        }

        if (query.includes("GetProductMediaStatus")) {
          const id = String(parsed.variables?.id || "");
          const product = products.get(id);
          const mediaNodes = product?.images?.map((img, index) => ({
            id: `${id}/Media/${index + 1}`,
            status: "READY",
            mediaErrors: [],
          })) ?? [];
          res.end(
            JSON.stringify({
              data: {
                node: product
                  ? { id: product.id, media: { nodes: mediaNodes } }
                  : null,
              },
            }),
          );
          return;
        }

        if (query.includes("node(id: $id)")) {
          const id = String(parsed.variables?.id || "");
          const product = products.get(id);
          res.end(
            JSON.stringify({
              data: {
                node: product
                  ? {
                      id: product.id,
                      title: product.title,
                      handle: product.handle,
                      descriptionHtml: product.descriptionHtml,
                      status: product.status,
                      vendor: product.vendor,
                      productType: product.productType,
                      tags: product.tags,
                      seo: product.seo,
                      variants: {
                        nodes: product.variants.slice(0, 1).map((variant) => ({
                          price: String(variant.price || ""),
                          compareAtPrice: variant.compareAtPrice ? String(variant.compareAtPrice) : null,
                          barcode: variant.barcode || null,
                          sku: variant.inventoryItem?.sku || null,
                          inventoryPolicy: variant.inventoryPolicy || "CONTINUE",
                          taxable: variant.taxable ?? true,
                        })),
                      },
                      images: {
                        nodes: product.images.slice(0, 1).map((image) => ({
                          src: image.src,
                          altText: image.altText,
                        })),
                      },
                      resourcePublications: {
                        nodes: [
                          {
                            isPublished: true,
                            publication: { id: "gid://shopify/Publication/1" },
                          },
                        ],
                      },
                    }
                  : null,
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
        requests,
      });
    });
  });
}

function playwrightSchemaLooksBootstrapped(databaseUrl) {
  if (!/schema=playwright_e2e/i.test(databaseUrl)) {
    return false;
  }

  let probeDatabaseUrl = databaseUrl;
  try {
    const parsed = new URL(databaseUrl);
    parsed.searchParams.delete("schema");
    parsed.searchParams.delete("connection_limit");
    probeDatabaseUrl = parsed.toString();
  } catch {
    probeDatabaseUrl = databaseUrl
      .replace(/([?&])schema=playwright_e2e(&?)/i, "$1")
      .replace(/([?&])connection_limit=\d+(&?)/i, "$1")
      .replace(/[?&]$/, "");
  }

  const probe = spawnSync(
    "psql",
    [
      probeDatabaseUrl,
      "-tAc",
      "select count(*) from information_schema.tables where table_schema='playwright_e2e';",
    ],
    {
      cwd: root,
      shell: false,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (probe.status !== 0) {
    return false;
  }

  const tableCount = Number.parseInt(String(probe.stdout || "").trim(), 10);
  return Number.isFinite(tableCount) && tableCount > 0;
}

const fileEnv = loadEnvFile(envFile);
const databaseUrl = withConnectionLimit(resolveDatabaseUrl(fileEnv), 10);
const usingPlaywrightFallbackDatabase = /schema=playwright_e2e/i.test(databaseUrl);
const hasBootstrappedPlaywrightSchema = playwrightSchemaLooksBootstrapped(databaseUrl);
const skipPrismaGenerate =
  String(process.env.PLAYWRIGHT_SKIP_PRISMA_GENERATE || "").trim() === "1" ||
  (fs.existsSync(prismaClientEntryPath) && String(process.env.PLAYWRIGHT_FORCE_PRISMA_GENERATE || "").trim() !== "1");
const hasBuiltApiEntry = fs.existsSync(apiBuildEntryPath);
const skipApiBuild =
  String(process.env.PLAYWRIGHT_SKIP_API_BUILD || "").trim() === "1" ||
  (hasBuiltApiEntry && String(process.env.PLAYWRIGHT_FORCE_API_BUILD || "").trim() !== "1");
const skipSchemaSync =
  String(process.env.PLAYWRIGHT_SKIP_SCHEMA_SYNC || "").trim() === "1" ||
  (hasBootstrappedPlaywrightSchema && String(process.env.PLAYWRIGHT_FORCE_SCHEMA_SYNC || "").trim() !== "1");
const authMode = String(process.env.PLAYWRIGHT_AUTH_MODE || process.env.AUTH_MODE || "local").trim().toLowerCase() || "local";
const playwrightBaseUrl = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001";
const playwrightTenantKey = process.env.PLAYWRIGHT_TENANT_KEY || "default";
const playwrightWorkspaceSlug = process.env.PLAYWRIGHT_WORKSPACE || "default";
const identityDirectory =
  process.env.PLAYWRIGHT_AUTH_IDENTITIES_JSON !== undefined
    ? process.env.PLAYWRIGHT_AUTH_IDENTITIES_JSON
    : authMode === "db"
      ? ""
      : JSON.stringify({
          "admin@vexa-pim.local": { tenantId: playwrightTenantKey, workspaceSlug: playwrightWorkspaceSlug, role: "admin", assignedRoles: ["admin", "product_admin", "system_admin"] },
          "editor@vexa-pim.local": { tenantId: playwrightTenantKey, workspaceSlug: playwrightWorkspaceSlug, role: "editor" },
          "publisher@vexa-pim.local": { tenantId: playwrightTenantKey, workspaceSlug: playwrightWorkspaceSlug, role: "publisher" },
          "approver@vexa-pim.local": { tenantId: playwrightTenantKey, workspaceSlug: playwrightWorkspaceSlug, role: "approver" },
          "channel_manager@vexa-pim.local": { tenantId: playwrightTenantKey, workspaceSlug: playwrightWorkspaceSlug, role: "channel_manager" },
          "connector_admin@vexa-pim.local": { tenantId: playwrightTenantKey, workspaceSlug: playwrightWorkspaceSlug, role: "connector_admin" },
          "reviewer@vexa-pim.local": { tenantId: playwrightTenantKey, workspaceSlug: playwrightWorkspaceSlug, role: "reviewer" },
          "viewer@vexa-pim.local": { tenantId: playwrightTenantKey, workspaceSlug: playwrightWorkspaceSlug, role: "viewer" },
        });
const workspaceDirectory =
  process.env.PLAYWRIGHT_AUTH_WORKSPACES_JSON !== undefined
    ? process.env.PLAYWRIGHT_AUTH_WORKSPACES_JSON
    : authMode === "db"
      ? ""
      : process.env.PIM_AUTH_WORKSPACES_JSON ||
        JSON.stringify({
          [playwrightWorkspaceSlug]: { tenantId: playwrightTenantKey, displayName: playwrightWorkspaceSlug === "default" ? "Default" : "Media QA" },
        });

console.log(
  `[playwright-api] preflight prisma=${skipPrismaGenerate ? "reuse" : "generate"} apiBuild=${skipApiBuild ? "reuse" : "build"} schema=${skipSchemaSync ? "reuse" : "sync"} auth=${authMode} port=${process.env.PLAYWRIGHT_API_PORT || "4001"}`,
);

if (!skipPrismaGenerate) {
  const prismaGenerate = spawnSync("npm", ["run", "prisma:generate"], {
    cwd: root,
    shell: true,
    stdio: "inherit",
    env: {
      ...fileEnv,
      ...process.env,
    },
  });

  if (prismaGenerate.status !== 0) {
    process.exit(prismaGenerate.status ?? 1);
  }
}

if (!skipApiBuild) {
  const build = spawnSync("npm", ["run", "build", "--workspace", "@pim1/api"], {
    cwd: root,
    shell: true,
    stdio: "inherit",
    env: {
      ...fileEnv,
      ...process.env,
    },
  });

  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
}

if (!skipSchemaSync) {
  const schemaSync = spawnSync(
    "npx",
    usingPlaywrightFallbackDatabase
      ? ["prisma", "db", "push", "--schema", "packages/db/prisma/schema.prisma", "--skip-generate", "--accept-data-loss"]
      : ["prisma", "migrate", "deploy", "--schema", "packages/db/prisma/schema.prisma"],
    {
      cwd: root,
      shell: true,
      stdio: "inherit",
      env: {
        ...fileEnv,
        ...process.env,
        DATABASE_URL: databaseUrl,
        DATABASE_URL_POOLED: databaseUrl,
        DATABASE_URL_DIRECT: databaseUrl,
      },
    },
  );

  if (schemaSync.status !== 0) {
    process.exit(schemaSync.status ?? 1);
  }
}

const env = {
  ...fileEnv,
  ...process.env,
  PORT: process.env.PLAYWRIGHT_API_PORT || "4001",
  APP_ENV: "development",
  DATABASE_URL: databaseUrl,
  DATABASE_URL_POOLED: databaseUrl,
  DATABASE_URL_DIRECT: databaseUrl,
  AUTH_MODE: authMode,
  PIM_AUTH_PASSWORD: process.env.PLAYWRIGHT_PASSWORD || "vexa-pim-demo-password",
  PIM_DEFAULT_TENANT_KEY: playwrightTenantKey,
  PIM_DEFAULT_WORKSPACE_SLUG: playwrightWorkspaceSlug,
  // E2E suites cycle through many roles per run; default of 100 trips the rate
  // limiter within ~2 suite runs. 2000 leaves headroom for the full ~46-test suite
  // plus 2-3 retries without flake.
  PIM_AUTH_IP_ATTEMPT_LIMIT: process.env.PLAYWRIGHT_AUTH_IP_ATTEMPT_LIMIT || "2000",
  PIM_AUTH_REDIS_DISABLED: "true",
  JWT_BLOCKLIST_REDIS_DISABLED: "true",
  DASHBOARD_CACHE_REDIS_DISABLED: "true",
  JWT_SECRET: process.env.JWT_SECRET || fileEnv.JWT_SECRET || "vexa-pim-local-dev-jwt-secret-minimum-length-32",
  CREDENTIAL_ENCRYPTION_KEY_V1:
    process.env.CREDENTIAL_ENCRYPTION_KEY_V1 ||
    fileEnv.CREDENTIAL_ENCRYPTION_KEY_V1 ||
    "vexa-pim-local-encryption-key-v1-minimum-32",
  CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION:
    process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION ||
    fileEnv.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION ||
    "1",
  REDIS_URL: process.env.REDIS_URL || fileEnv.REDIS_URL || "redis://localhost:6379",
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID || fileEnv.R2_ACCOUNT_ID || "local-dev",
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || fileEnv.R2_ACCESS_KEY_ID || "local-dev",
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || fileEnv.R2_SECRET_ACCESS_KEY || "local-dev",
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME || fileEnv.R2_BUCKET_NAME || "vexa-pim-local",
  R2_PUBLIC_URL: process.env.R2_PUBLIC_URL || fileEnv.R2_PUBLIC_URL || "https://example.com/vexa-pim-local",
  PIM_WEB_BASE_URL: process.env.PIM_WEB_BASE_URL || playwrightBaseUrl,
  PIM_AUTH_IDENTITIES_JSON: identityDirectory,
};

if (workspaceDirectory !== undefined) {
  env.PIM_AUTH_WORKSPACES_JSON = workspaceDirectory;
}

async function main() {
  await seedPlaywrightConnectorDefinitions(databaseUrl);
  await seedPlaywrightTaxRegimes(databaseUrl);
  await seedPlaywrightFixtures(databaseUrl);

  const enableShopifyStub = String(process.env.PLAYWRIGHT_ENABLE_SHOPIFY_STUB ?? "1").trim() !== "0";
  const shopifyStub = enableShopifyStub ? await createShopifyStubServer() : null;

  if (shopifyStub) {
    env.PIM_SHOPIFY_TOKEN_BASE_URL = shopifyStub.baseUrl;
    env.PIM_SHOPIFY_ADMIN_API_BASE_URL = shopifyStub.baseUrl;
    env.PIM_SHOPIFY_ADMIN_API_VERSION = env.PIM_SHOPIFY_ADMIN_API_VERSION || "2026-04";
  }

  const stagedApiRuntime = stageApiDistForPlaywright();
  const apiLauncherPath = stagedApiRuntime?.launcher ?? apiStartScriptPath;
  if (stagedApiRuntime) {
    env.PLAYWRIGHT_API_DIST_ENTRY = stagedApiRuntime.entry;
    prependNodePath(env, [stagedApiRuntime.nodeModules]);
  }

  console.log(`[playwright-api] starting built API on port ${env.PORT}.`);
  const child = spawn("node", [apiLauncherPath], {
    cwd: root,
    shell: false,
    stdio: "inherit",
    env,
  });
  console.log(`[playwright-api] spawned API child pid=${child.pid ?? "unknown"}.`);

  function shutdown(signal) {
    if (!child.killed) {
      child.kill(signal);
    }
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  child.on("exit", async (code, signal) => {
    if (shopifyStub) {
      if ((code ?? 0) !== 0 || signal) {
        console.error("[shopify-stub] requests");
        console.error(JSON.stringify(shopifyStub.requests, null, 2));
      }
      await new Promise((resolve) => shopifyStub.server.close(() => resolve()));
    }
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
