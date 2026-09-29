#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression coverage for DEF-01 (2026-09-29 browser review): every /connectors/{id}/mapping link
 * ended on a bare /channels/mappings because the enriched redirect() sat inside a try block whose
 * catch swallowed Next's internal NEXT_REDIRECT exception and issued a second, context-free redirect.
 *
 * Executes the real page module (transpiled with ts.transpileModule, same pattern as
 * mapping-version-label.test.cjs) against stubbed Next/API modules, and asserts where it redirects.
 */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "connectors", "[installationId]", "mapping", "page.tsx");

class ApiHttpError extends Error {
  constructor(status, message) {
    super(message ?? `HTTP ${status}`);
    this.status = status;
  }
}

function loadPage(stubs) {
  const ts = require("typescript");
  const { outputText } = ts.transpileModule(fs.readFileSync(PAGE_FILE, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    fileName: "page.tsx",
  });

  const modules = {
    "next/navigation": {
      redirect(url) {
        const error = new Error("NEXT_REDIRECT");
        error.digest = `NEXT_REDIRECT;replace;${url};307;`;
        throw error;
      },
      notFound() {
        const error = new Error("NEXT_NOT_FOUND");
        error.digest = "NEXT_HTTP_ERROR_FALLBACK;404";
        throw error;
      },
    },
    "@/lib/api": {
      ApiHttpError,
      getInstalledConnectors: stubs.getInstalledConnectors,
      getProduct: stubs.getProduct,
      getConnectorMappingVersions: stubs.getConnectorMappingVersions,
    },
    "@/lib/auth-redirect": { buildLoginRedirect: (target) => `/login?next=${encodeURIComponent(target)}` },
    "@/lib/marketplace-channels": {
      DEFAULT_MARKETPLACE_CHANNEL: "amazon",
      mapConnectorSlugToMarketplaceChannel: (slug) => slug,
      normalizeMarketplaceChannel: (channel, _unused, fallback) => channel || fallback,
    },
    "@/lib/server-session": { getServerSession: async () => ({ authHeader: "Bearer test", actorRole: "admin" }) },
  };

  const exports = {};
  const fakeModule = { exports };
  new Function("require", "module", "exports", outputText)(
    (id) => {
      if (!(id in modules)) throw new Error(`Unexpected import in page under test: ${id}`);
      return modules[id];
    },
    fakeModule,
    exports,
  );
  return fakeModule.exports.default;
}

async function outcome(stubs, installationId, query) {
  const Page = loadPage(stubs);
  try {
    await Page({ params: Promise.resolve({ installationId }), searchParams: Promise.resolve(query) });
    return { kind: "returned" };
  } catch (error) {
    const digest = String(error?.digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT;")) return { kind: "redirect", url: digest.split(";")[2] };
    if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return { kind: "notFound" };
    return { kind: "error", message: String(error?.message ?? error) };
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function params(url) {
  return new URL(url, "https://example.test").searchParams;
}

const INSTALLATION = { id: "inst-1", slug: "shopify" };
const PRODUCT = { id: "prod-1", categoryId: "cat-1" };
const base = {
  getInstalledConnectors: async () => [INSTALLATION],
  getProduct: async () => PRODUCT,
  getConnectorMappingVersions: async () => [],
};

async function run() {
  // 1. Happy path: scope, account, product and category all survive the redirect.
  let r = await outcome(base, "inst-1", { productId: "prod-1", channel: "shopify" });
  assert(r.kind === "redirect", `expected a redirect, got ${JSON.stringify(r)}`);
  assert(r.url.startsWith("/channels/mappings?"), `redirect must keep the query string, got "${r.url}" (bare route = DEF-01)`);
  let p = params(r.url);
  assert(p.get("channel") === "shopify", "channel must be preserved");
  assert(p.get("installationId") === "inst-1", "installationId must be preserved");
  assert(p.get("productId") === "prod-1", "productId must be preserved");
  assert(p.get("categoryId") === "cat-1", "categoryId must come from the product");
  assert(!p.has("step"), "no live version, so the wizard must start at its default step");

  // 2. A live version exists: land on the review step.
  r = await outcome(
    { ...base, getConnectorMappingVersions: async () => [{ lifecycleState: "draft" }, { lifecycleState: "published" }] },
    "inst-1",
    { productId: "prod-1", channel: "shopify" },
  );
  assert(r.kind === "redirect" && params(r.url).get("step") === "review", `live version must land on review, got ${JSON.stringify(r)}`);

  // 3. Version lookup failure is non-fatal and must keep the context.
  r = await outcome(
    { ...base, getConnectorMappingVersions: async () => { throw new ApiHttpError(500); } },
    "inst-1",
    { productId: "prod-1", channel: "shopify" },
  );
  assert(r.kind === "redirect" && params(r.url).get("installationId") === "inst-1" && !params(r.url).has("step"), `version failure must keep scope without a step, got ${JSON.stringify(r)}`);

  // 4. No product: channel and account still carried.
  r = await outcome(base, "inst-1", {});
  assert(r.kind === "redirect" && params(r.url).get("installationId") === "inst-1" && params(r.url).get("channel") === "shopify", `no-product entry must keep channel and account, got ${JSON.stringify(r)}`);
  assert(!params(r.url).has("productId"), "no productId should be invented");

  // 5. Product lookup 404 is non-fatal: keep the connector scope.
  r = await outcome(
    { ...base, getProduct: async () => { throw new ApiHttpError(404); } },
    "inst-1",
    { productId: "gone", channel: "shopify" },
  );
  assert(r.kind === "redirect" && params(r.url).get("installationId") === "inst-1", `product 404 must keep the connector scope, got ${JSON.stringify(r)}`);

  // 6. Unknown installation: a real not-found, not a silent bare redirect.
  r = await outcome(base, "does-not-exist", {});
  assert(r.kind === "notFound", `unknown installation must be notFound, got ${JSON.stringify(r)}`);

  // 7. Auth failures go to login with the original target.
  for (const status of [401, 403]) {
    r = await outcome({ ...base, getInstalledConnectors: async () => { throw new ApiHttpError(status); } }, "inst-1", {});
    assert(r.kind === "redirect" && r.url === `/login?next=${encodeURIComponent("/connectors/inst-1/mapping")}`, `${status} must redirect to login, got ${JSON.stringify(r)}`);
  }

  // 8. Unexpected API failure keeps the documented fallback to the wizard.
  r = await outcome({ ...base, getInstalledConnectors: async () => { throw new ApiHttpError(500); } }, "inst-1", {});
  assert(r.kind === "redirect" && r.url === "/channels/mappings", `unexpected failure must fall back to the wizard, got ${JSON.stringify(r)}`);

  console.log(JSON.stringify({ status: "ok", validated: 8 }, null, 2));
}

run().catch((error) => {
  console.error("Connector mapping redirect test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
