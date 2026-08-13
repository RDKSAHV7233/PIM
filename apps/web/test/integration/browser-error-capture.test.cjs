#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

async function main() {
    const component = read("apps/web/src/components/error-authority/browser-error-capture.tsx");
    const layout = read("apps/web/src/app/layout.tsx");
    const route = read("apps/web/src/app/api/internal/error-authority/browser/route.ts");
    const serverProxy = read("apps/web/src/lib/server/browser-error-capture.ts");

    assert(component.includes('"use client"'), "browser capture provider must be a client component");
    assert(component.includes('window.addEventListener("error"'), "provider must listen for browser error events");
    assert(component.includes('window.addEventListener("unhandledrejection"'), "provider must listen for unhandled promise rejections");
    assert(component.includes('fetch("/api/internal/error-authority/browser"'), "provider must send only to the same-origin Web route");
    assert(!component.includes("ERROR_AUTHORITY_INGEST_TOKEN"), "browser bundle must not reference trusted ingest token env");
    assert(!component.includes("OBSERVABILITY_DATABASE_URL"), "browser bundle must not reference observability DB env");
    assert(!component.includes("ERROR_AUTHORITY_REF_SECRET"), "browser bundle must not reference ref secret env");
    assert(layout.includes("<BrowserErrorCapture />"), "root layout must install browser capture provider");

    assert(route.includes("validateOrigin(request)"), "same-origin Web route must validate origin/referer");
    assert(route.includes("forwardBrowserErrorToAuthority(body)"), "Web route must delegate to trusted server transport");
    assert(serverProxy.includes("/error-authority/ingest/browser"), "server transport must target browser ingest endpoint");
    assert(serverProxy.includes('"x-error-authority-ingest-token": token'), "server transport must attach trusted token server-side");
    assert(!route.includes("pim_access_token") && !serverProxy.includes("pim_access_token"), "browser capture must not forward session cookies");
    assert(serverProxy.includes("release: resolveErrorAuthorityRelease()"), "server transport must assign release server-side");
    assert(serverProxy.includes("safeRoute(payload.routeTemplate)"), "server transport must sanitize routes");
    assert(serverProxy.includes("safeFrames(payload.frames)"), "server transport must sanitize frames");
    assert(!serverProxy.includes("message?: unknown"), "server transport must not accept raw browser message");
    assert(!serverProxy.includes("headers?: unknown"), "server transport must not accept browser headers");
    assert(!serverProxy.includes("cookies?: unknown"), "server transport must not accept cookies");
    assert(!serverProxy.includes("body?: unknown"), "server transport must not accept raw request bodies");
    assert(serverProxy.includes("return { forwarded: false };"), "server transport must fail open");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: [
            "browser_listener_installed",
            "same_origin_web_proxy_used",
            "trusted_token_server_side_only",
            "browser_payload_sanitized",
            "browser_transport_fails_open",
            "client_bundle_has_no_error_authority_secrets",
          ],
        },
        null,
        2,
      ),
    );
}

main().catch((error) => {
  console.error("Browser Error Authority capture integration test failed");
  console.error(error);
  process.exit(1);
});
