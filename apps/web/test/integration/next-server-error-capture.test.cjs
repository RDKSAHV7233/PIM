#!/usr/bin/env node
/* eslint-disable no-console */
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "CommonJS",
    moduleResolution: "node",
    esModuleInterop: true,
    types: ["node"],
  },
});

const assert = require("node:assert/strict");

const {
  buildTrustedNextServerErrorPayload,
  captureNextServerError,
  shouldCaptureNextServerError,
} = require("../../src/lib/server/next-server-error-capture");

async function main() {
  const previousEnv = { ...process.env };
  const previousConsoleInfo = console.info;
  const diagnosticLogs = [];
  try {
    delete process.env.NEXT_RUNTIME;
    process.env.ERROR_AUTHORITY_ENABLED = "true";
    process.env.ERROR_AUTHORITY_DIAGNOSTICS = "true";
    process.env.ERROR_AUTHORITY_RELEASE = "976ab94a9191e68800debe5b3ed312194f4b0451";
    process.env.ERROR_AUTHORITY_INGEST_TOKEN = "trusted-error-authority-token-minimum-32";
    process.env.PIM_API_BASE_URL = "https://api.example.test/api/v1";
    console.info = (...args) => {
      diagnosticLogs.push(args.map(String).join(" "));
    };

    const routeError = new Error("route handler exploded with token=secret");
    routeError.stack = "Error: route handler exploded\n    at GET (/srv/apps/web/src/app/api/test/route.ts:10:5)";
    const routePayload = buildTrustedNextServerErrorPayload(
      routeError,
      {
        method: "GET",
        url: "https://app.example.test/api/test?token=secret",
        headers: { get: (name) => (name === "x-request-id" ? "req-safe-123" : null) },
      },
      { routePath: "/api/test", routeType: "route" },
    );

    assert.equal(routePayload.release, "976ab94a9191e68800debe5b3ed312194f4b0451");
    assert.equal(routePayload.routeTemplate, "/api/test");
    assert.equal(routePayload.method, "GET");
    assert.equal(routePayload.requestId, "req-safe-123");
    assert.equal(routePayload.category, "internal");
    assert.equal(routePayload.statusCode, 500);
    assert(!JSON.stringify(routePayload).includes("token=secret"), "payload must not include query string or secret-like message text");

    const renderPayload = buildTrustedNextServerErrorPayload(
      new Error("server component failed"),
      { method: "GET", nextUrl: { pathname: "/products/cm123?debug=true" } },
      { routePath: "/products/[id]", renderSource: "server-component" },
    );
    assert.equal(renderPayload.category, "rendering");
    assert.equal(renderPayload.routeTemplate, "/products/[id]");

    const plainHeaderPayload = buildTrustedNextServerErrorPayload(
      new Error("server component failed with plain request headers"),
      {
        method: "GET",
        url: "https://app.example.test/internal/error-authority/runtime-proof",
        headers: { "x-request-id": "plain-safe-123" },
      },
      { routePath: "/internal/error-authority/runtime-proof", renderSource: "server-component" },
    );
    assert.equal(plainHeaderPayload.requestId, "plain-safe-123");

    const brokenHeaderPayload = buildTrustedNextServerErrorPayload(
      new Error("server component failed with nonstandard request headers"),
      {
        method: "GET",
        url: "https://app.example.test/internal/error-authority/runtime-proof",
        headers: { get: "not-a-function" },
      },
      { routePath: "/internal/error-authority/runtime-proof", renderSource: "server-component" },
    );
    assert.equal(brokenHeaderPayload.requestId, undefined);

    assert.equal(shouldCaptureNextServerError(new Error("unexpected server action failure")), true);
    assert.equal(shouldCaptureNextServerError(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login" })), false);
    assert.equal(shouldCaptureNextServerError(Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" })), false);
    assert.equal(shouldCaptureNextServerError(Object.assign(new Error("validation"), { statusCode: 400, code: "VALIDATION_FAILED" })), false);
    assert.equal(shouldCaptureNextServerError(Object.assign(new Error("csrf"), { status: 403, code: "CSRF_REJECTED" })), false);
    assert.equal(shouldCaptureNextServerError(Object.assign(new Error("connector rejected"), { code: "CONNECTOR_DOMAIN_REJECTED" })), false);

    const duplicate = new Error("same error object");
    const firstDuplicate = buildTrustedNextServerErrorPayload(duplicate, { method: "POST", url: "/actions" }, { routePath: "/actions" });
    const secondDuplicate = buildTrustedNextServerErrorPayload(duplicate, { method: "POST", url: "/actions" }, { routePath: "/actions" });
    assert.equal(firstDuplicate.sourceEventId, secondDuplicate.sourceEventId, "same error object must keep sourceEventId stable");

    const calls = [];
    global.fetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: false, status: 401 };
    };
    await captureNextServerError(new Error("server action failed"), { method: "POST", url: "/actions" }, { routePath: "/actions" });
    assert.equal(calls.length, 1, "unexpected server action error should be sent once");
    assert.equal(calls[0].url, "https://api.example.test/api/v1/error-authority/ingest/next-server");
    assert.equal(calls[0].init.headers["x-error-authority-ingest-token"], "trusted-error-authority-token-minimum-32");
    assert(
      diagnosticLogs.some((line) => line.includes("next_server_capture_transport_attempt")),
      "diagnostics should mark capture transport attempts",
    );
    assert(
      diagnosticLogs.some((line) => line.includes("next_server_capture_transport_response") && line.includes("status=401")),
      "diagnostics should report sanitized ingest response status",
    );
    assert(
      !diagnosticLogs.join("\n").includes("trusted-error-authority-token-minimum-32") &&
        !diagnosticLogs.join("\n").includes("https://api.example.test"),
      "capture diagnostics must not print ingest tokens or target URLs",
    );

    global.fetch = async () => {
      throw new Error("api unavailable");
    };
    await assert.doesNotReject(
      captureNextServerError(new Error("api unavailable should fail open"), { method: "GET", url: "/dashboard" }, { routePath: "/dashboard" }),
    );
    assert(
      diagnosticLogs.some((line) => line.includes("next_server_capture_transport_error") && line.includes("code=NO_CODE")),
      "diagnostics should report sanitized transport error classification while failing open",
    );

    process.env.NEXT_RUNTIME = "edge";
    let edgeFetchCalls = 0;
    global.fetch = async () => {
      edgeFetchCalls += 1;
      throw new Error("edge runtime must not send");
    };
    await assert.doesNotReject(
      captureNextServerError(new Error("edge runtime ignored"), { method: "GET", url: "/edge" }, { routePath: "/edge" }),
    );
    assert.equal(edgeFetchCalls, 0, "edge runtime must not send Next server Error Authority events");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: [
            "unexpected_route_handler_error_payload",
            "unexpected_server_component_render_payload",
            "nonstandard_next_request_headers_do_not_break_capture",
            "unexpected_server_action_capture_send",
            "duplicate_source_event_id_stability",
            "next_control_flow_excluded",
            "vexa_domain_errors_excluded",
            "ingest_auth_failure_fails_open_for_web",
            "api_unavailable_fails_open_for_web",
            "safe_capture_transport_diagnostics",
            "release_uses_canonical_accessor",
            "prohibited_query_header_body_fields_absent",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    process.env = previousEnv;
    console.info = previousConsoleInfo;
    delete global.fetch;
  }
}

main().catch((error) => {
  console.error("Next server error capture integration test failed");
  console.error(error);
  process.exit(1);
});
