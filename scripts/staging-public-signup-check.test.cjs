#!/usr/bin/env node
/* eslint-disable no-console */

const http = require("node:http");
const path = require("node:path");
const childProcess = require("node:child_process");

const SCRIPT_PATH = path.resolve(__dirname, "staging-public-signup-check.cjs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += String(chunk);
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

async function startStubServer(mode) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url });

    if (request.url === "/api/v1/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok", env: "staging" }));
      return;
    }

    if (mode === "disabled") {
      if (
        request.url === "/signup" ||
        request.url?.startsWith("/api/v1/signup/workspace/availability") ||
        request.url === "/api/v1/signup/verify"
      ) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "FEATURE_DISABLED" }));
        return;
      }
    }

    if (mode === "enabled") {
      if (request.url === "/signup") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end("<html><body><h1>Create your TEJ PIM workspace</h1></body></html>");
        return;
      }
      if (request.url?.startsWith("/api/v1/signup/workspace/availability")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ available: true }));
        return;
      }
      if (request.url === "/api/v1/signup/workspace" && request.method === "POST") {
        const payload = await readJsonBody(request);
        assert(payload.acceptedTerms === false, `Expected acceptedTerms=false, got ${JSON.stringify(payload)}`);
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "TERMS_ACCEPTANCE_REQUIRED" }));
        return;
      }
      if (request.url === "/api/v1/signup/verify" && request.method === "POST") {
        const payload = await readJsonBody(request);
        assert(payload.token === "bogus-token", `Expected bogus-token verify payload, got ${JSON.stringify(payload)}`);
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "SIGNUP_VERIFICATION_TOKEN_INVALID" }));
        return;
      }
    }

    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "UNEXPECTED_ROUTE", mode, url: request.url, method: request.method }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return { server, baseUrl, requests };
}

function stopServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function runScript(env) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(process.execPath, [SCRIPT_PATH], {
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ status: code, stdout, stderr });
    });
  });
}

async function main() {
  const disabled = await startStubServer("disabled");
  try {
    const result = await runScript({
      STAGING_BASE_URL: disabled.baseUrl,
      STAGING_WEB_URL: disabled.baseUrl,
      STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED: "false",
      STAGING_EXPECTED_ENV: "staging",
    });
    assert(result.status === 0, `Disabled-path script failed: status=${result.status} stderr=${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert(payload.mode === "signup_disabled", `Unexpected disabled-path payload: ${result.stdout}`);
    assert(
      payload.validated.includes("signup_api_hidden_when_disabled") &&
        payload.validated.includes("signup_verify_hidden_when_disabled") &&
        payload.validated.includes("signup_page_hidden_when_disabled"),
      `Disabled-path validations missing: ${result.stdout}`,
    );
  } finally {
    await stopServer(disabled.server);
  }

  const enabled = await startStubServer("enabled");
  try {
    const result = await runScript({
      STAGING_BASE_URL: enabled.baseUrl,
      STAGING_WEB_URL: enabled.baseUrl,
      STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED: "true",
      STAGING_EXPECTED_ENV: "staging",
    });
    assert(result.status === 0, `Enabled-path script failed: status=${result.status} stderr=${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert(payload.mode === "signup_enabled", `Unexpected enabled-path payload: ${result.stdout}`);
    assert(
      payload.validated.includes("signup_availability_endpoint_enabled") &&
        payload.validated.includes("signup_create_endpoint_rejects_missing_terms_without_creating_state") &&
        payload.validated.includes("signup_verify_endpoint_rejects_invalid_token") &&
        payload.validated.includes("signup_page_renders_when_enabled"),
      `Enabled-path validations missing: ${result.stdout}`,
    );
  } finally {
    await stopServer(enabled.server);
  }

  console.log("staging-public-signup-check.test.cjs: PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
