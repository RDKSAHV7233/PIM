#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const controller = read("apps/api/src/error-authority/browser-ingest.controller.ts");
  const moduleSource = read("apps/api/src/error-authority/error-authority.module.ts");

  assert(
    moduleSource.includes("BrowserErrorIngestController") &&
      moduleSource.includes("controllers: [NextServerErrorIngestController, BrowserErrorIngestController]"),
    "ErrorAuthorityModule must register BrowserErrorIngestController beside the existing Next server owner.",
  );

  assert(
    controller.includes('@Post("ingest/browser")') &&
      controller.includes("@Public()") &&
      controller.includes("@ApiExcludeEndpoint()") &&
      controller.includes("requireInternalToken({") &&
      controller.includes('routeKey: "error_authority.browser_ingest"') &&
      controller.includes("expectedToken: process.env.ERROR_AUTHORITY_INGEST_TOKEN"),
    "Browser ingest endpoint must be private-by-token even though it is unauthenticated for internal Web transport.",
  );

  assert(
    controller.includes('runtime: "browser"') &&
      controller.includes('service: "vexa-pim-web"') &&
      controller.includes('actorType: "anonymous"') &&
      controller.includes("this.errorCaptureService.captureUnexpected({"),
    "Browser ingest must use the canonical ErrorCaptureService with runtime=browser and service=vexa-pim-web.",
  );

  assert(
    controller.includes('new Error("Unexpected browser error")') &&
      !controller.includes("message?: unknown") &&
      !controller.includes("headers?: unknown") &&
      !controller.includes("cookies?: unknown") &&
      !controller.includes("body?: unknown") &&
      !controller.includes("query?: unknown"),
    "Browser ingest must not accept or persist raw browser messages, headers, cookies, bodies, or query strings.",
  );

  assert(
    controller.includes('!sourceEventId.startsWith("browser:")') &&
      controller.includes("ERROR_AUTHORITY_SOURCE_EVENT_ID_REQUIRED") &&
      controller.includes("safeRoute(payload.routeTemplate)") &&
      controller.includes("safeFrames(payload.frames)"),
    "Browser ingest must require browser sourceEventId and sanitize route/frame fields.",
  );

  assert(
    controller.includes('const VALID_CATEGORIES = new Set<ErrorCategory>(["hydration", "rendering", "network", "unknown"])') &&
      controller.includes('const VALID_SEVERITIES = new Set<ErrorSeverity>(["p2", "p3"])'),
    "Browser ingest must restrict category and severity to the approved browser/client set.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "browser_ingest_controller_registered",
          "browser_ingest_auth_fails_closed_by_contract",
          "browser_ingest_uses_canonical_capture_service",
          "browser_runtime_and_service",
          "browser_payload_omits_raw_message_headers_cookies_body_query",
          "browser_source_event_id_and_frames_sanitized",
        ],
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error("Error Authority browser ingest integration contract failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
