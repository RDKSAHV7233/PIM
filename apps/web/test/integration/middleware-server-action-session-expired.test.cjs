#!/usr/bin/env node
/* eslint-disable no-console */
// PIM#601: a Server Action submitted after the user's session has been fully
// invalidated (both pim_access_token and pim_refresh_token cookies absent) used to
// crash the client with Next.js error E394 ("unexpected response was received from
// the server") instead of redirecting to /login. Root cause: middleware.ts's
// fail-fast auth gate returned a plain NextResponse.redirect() unconditionally, but
// that response shape is not one the Server Action client fetch runtime can consume
// - Next's own action-handler (node_modules/next/dist/server/app-render/action-handler.js)
// only accepts a redirect for a "fetch action" request (method === POST with the
// `next-action` header - see node_modules/next/dist/server/lib/server-action-request-meta.js's
// isFetchAction / ACTION_HEADER = 'next-action') in the form of a response carrying an
// `x-action-redirect` header and an RSC body, built via redirect() thrown from *inside*
// the action itself and translated by Next's runtime - never a raw 3xx with a Location
// header, which is exactly what NextResponse.redirect() produces.
//
// This test exercises the actual request path through middleware.ts (not a static
// source assertion): it compiles the real middleware.ts source with the TypeScript
// compiler and invokes the exported `middleware()` function with real NextRequest
// objects, asserting the response middleware itself hands back for each case.
//
// A plain GET navigation while fully logged out was already confirmed (live, against
// app.vexapim.com) to redirect correctly - that path must keep working. Only the
// Server Action fetch case (POST + `next-action` header) was broken.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const MIDDLEWARE_PATH = path.join(REPO_ROOT, "apps", "web", "src", "middleware.ts");
const WEB_NODE_MODULES = path.join(REPO_ROOT, "apps", "web");

function loadMiddleware() {
  const source = fs.readFileSync(MIDDLEWARE_PATH, "utf8");
  const { outputText, diagnostics } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      resolveJsonModule: true,
    },
    fileName: "middleware.ts",
    reportDiagnostics: true,
  });
  assert.equal(
    (diagnostics ?? []).length,
    0,
    `middleware.ts failed to transpile cleanly: ${JSON.stringify(diagnostics)}`,
  );

  const mod = new Module(MIDDLEWARE_PATH, module);
  mod.filename = MIDDLEWARE_PATH;
  // Resolve `next/server` etc. the same way Node would from middleware.ts's real
  // location, so this exercises the actual installed Next.js runtime, not a mock.
  mod.paths = Module._nodeModulePaths(WEB_NODE_MODULES);
  mod._compile(outputText, MIDDLEWARE_PATH);
  return mod.exports;
}

async function run() {
  const { middleware } = loadMiddleware();
  assert.equal(typeof middleware, "function", "middleware.ts must export a `middleware` function.");

  // next/server is resolved via the same node_modules chain as middleware.ts itself.
  const { NextRequest } = require(path.join(REPO_ROOT, "node_modules", "next", "server.js"));

  const PROTECTED_PATH = "/products/cmst5qs0a009brq01eq2wljwi";
  const BASE_URL = "https://app.vexapim.test";

  function buildRequest({ method, headers }) {
    // Deliberately no Cookie header at all: this is the "fully logged out" case from
    // the issue - both pim_access_token and pim_refresh_token are absent, not just
    // expired.
    return new NextRequest(new URL(PROTECTED_PATH, BASE_URL), {
      method,
      headers: headers ?? {},
    });
  }

  // --- Case 1 (regression guard): plain GET navigation while fully logged out must
  // still redirect cleanly to /login, exactly as before this fix and as confirmed live
  // against app.vexapim.com. This must NOT regress.
  {
    const response = await middleware(buildRequest({ method: "GET" }));
    assert.ok(response, "GET with no auth cookies must produce a response.");
    const location = response.headers.get("location");
    assert.ok(location, "GET with no auth cookies on a protected path must redirect (Location header present).");
    const redirectUrl = new URL(location);
    assert.equal(redirectUrl.pathname, "/login", "Logged-out GET navigation must redirect to /login.");
    assert.equal(
      redirectUrl.searchParams.get("next"),
      PROTECTED_PATH,
      "Login redirect must carry the original path as ?next= for post-login return.",
    );
  }

  // --- Case 2 (the bug, PIM#601): a Server Action fetch submission (POST carrying the
  // `next-action` header) while fully logged out must NOT receive a raw redirect from
  // middleware. A raw redirect here is precisely what produced the E394 crash: the
  // client's action runtime followed it, got back a 200 HTML document instead of an
  // action-response payload, and threw "unexpected response was received from the
  // server". Instead, middleware must let the request fall through so Next's own
  // action-handler (and actions.ts's resolveSessionExpiredRedirect/handleSessionExpired)
  // can produce a response shape the action runtime actually understands.
  {
    const response = await middleware(
      buildRequest({
        method: "POST",
        headers: { "next-action": "60f0b8f5d0e1c2a3b4c5d6e7f8091a2b3c4d5e6f" },
      }),
    );
    assert.ok(response, "POST with next-action header and no auth cookies must produce a response.");
    assert.equal(
      response.headers.get("location"),
      null,
      "Middleware must NOT return a Location-header redirect for a Server Action fetch request " +
        "(next-action header present) - that response shape is not one the Server Action client " +
        "runtime can consume and is exactly what caused the E394 crash in PIM#601.",
    );
    assert.notEqual(
      response.status,
      307,
      "Middleware must not issue its own 307 redirect for a Server Action fetch request.",
    );
    assert.notEqual(
      response.status,
      308,
      "Middleware must not issue its own 308 redirect for a Server Action fetch request.",
    );
    // NextResponse.next() (pass-through) is signalled via this internal header - confirms
    // middleware chose the fall-through path rather than synthesizing any response of its
    // own, so the request reaches the real Next.js action-handler pipeline.
    assert.equal(
      response.headers.get("x-middleware-next"),
      "1",
      "Middleware must fall through (NextResponse.next()) for a Server Action fetch request with no " +
        "auth cookies, so actions.ts's resolveSessionExpiredRedirect/handleSessionExpired " +
        "(BUG-AUTH-STALE-SESSION-001) gets a chance to run instead of being pre-empted.",
    );
  }

  // --- Case 3 (sanity / no false negatives): a GET request that happens to carry a
  // stray `next-action` header (never legitimately produced by Next's client for a GET)
  // must still redirect - the bypass is scoped to POST only, matching Next's own
  // isFetchAction definition exactly (method === "POST" && next-action header present).
  {
    const response = await middleware(
      buildRequest({
        method: "GET",
        headers: { "next-action": "60f0b8f5d0e1c2a3b4c5d6e7f8091a2b3c4d5e6f" },
      }),
    );
    assert.ok(
      response.headers.get("location"),
      "A GET request must still redirect even if a next-action header is (abnormally) present - " +
        "the Server Action bypass must be scoped to POST, matching Next.js's own isFetchAction check.",
    );
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "logged_out_get_navigation_still_redirects_to_login",
          "logged_out_server_action_post_does_not_receive_raw_redirect",
          "logged_out_server_action_post_falls_through_to_next_middleware_next",
          "next_action_bypass_scoped_to_post_only",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error("middleware-server-action-session-expired.test.cjs failed:");
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
