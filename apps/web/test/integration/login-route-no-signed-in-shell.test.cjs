#!/usr/bin/env node
/* eslint-disable no-console */
// INC-88-S1 (DEF-PC-016 follow-up / backlog S4b): a session token that is valid locally but revoked on the
// server sends the visitor to /login?reason=session_expired; RootLayout used to draw the signed-in shell
// (sidebar navigation, role badge) around the login form because it trusted the local check.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

function loadHelper() {
  const ts = require("typescript");
  const file = path.join(REPO_ROOT, "apps/web/src/lib/shell-visibility.ts");
  const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: "shell-visibility.ts",
  });
  const mod = new Module(file, module);
  mod.filename = file;
  mod._compile(outputText, file);
  return mod.exports;
}

const { PATHNAME_HEADER, isLoginRoute } = loadHelper();

// behaviour
assert.equal(PATHNAME_HEADER, "x-pim-pathname");
assert.equal(isLoginRoute("/login"), true);
assert.equal(isLoginRoute("/login/"), true);
assert.equal(isLoginRoute("/login/reset"), true);
assert.equal(isLoginRoute("/dashboard"), false, "signed-in pages keep the shell");
assert.equal(isLoginRoute("/catalog/media"), false);
assert.equal(isLoginRoute("/loginx"), false, "only the /login route tree is affected");
assert.equal(isLoginRoute("/signup"), false);
assert.equal(isLoginRoute(null), false, "unknown path keeps current behaviour");
assert.equal(isLoginRoute(undefined), false);

// wiring
const layout = read("apps/web/src/app/layout.tsx");
assert.ok(layout.includes("(await headers()).get(PATHNAME_HEADER)"), "RootLayout must read the pathname header");
assert.ok(
  layout.includes("const sessionClaims = isLoginRoute(pathname) ? null : await getServerSessionClaims();"),
  "RootLayout must ignore the session on login routes",
);
assert.ok(layout.includes("const hasAuthToken = Boolean(sessionClaims);"), "the shell must stay keyed off verified session claims");
const middleware = read("apps/web/src/middleware.ts");
assert.ok(
  middleware.includes(`const PATHNAME_HEADER = "${PATHNAME_HEADER}";`),
  "middleware's header name must equal lib/shell-visibility PATHNAME_HEADER",
);
assert.ok(middleware.includes("requestHeaders.set(PATHNAME_HEADER, pathname)"), "middleware must forward the pathname");
assert.ok(
  middleware.indexOf("new Headers(request.headers)") < middleware.indexOf("requestHeaders.set(PATHNAME_HEADER"),
  "the header must be set after copying incoming headers so a client-supplied value is overwritten",
);

console.log("login-route-no-signed-in-shell.test.cjs: PASS");
