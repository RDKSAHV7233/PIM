#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * Unit test for sentryBeforeSend — runs via ts-node without Jest.
 * Verifies the multi-tenant PII scrub boundary for issue #920.
 */

const path = require("node:path");
const assert = require("node:assert/strict");

// Register ts-node so we can require TypeScript files directly.
require("ts-node").register({
  project: path.join(__dirname, "../../tsconfig.json"),
  transpileOnly: true,
});

const { sentryBeforeSend } = require("../../src/common/sentry-before-send");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log("\nsentryBeforeSend — null/non-object inputs");
test("passes through null", () => {
  assert.equal(sentryBeforeSend(null), null);
});
test("passes through undefined", () => {
  assert.equal(sentryBeforeSend(undefined), undefined);
});
test("passes through a string", () => {
  assert.equal(sentryBeforeSend("error"), "error");
});
test("passes through an event with no request field", () => {
  const event = { exception: { values: [{ type: "Error", value: "boom" }] } };
  assert.deepEqual(sentryBeforeSend(event), event);
});

console.log("\nsentryBeforeSend — request body (tenant product data)");
test("removes request.data so product titles/prices/SKUs are not sent", () => {
  const event = {
    request: {
      method: "POST",
      url: "/api/v1/products",
      data: JSON.stringify({ title: "My Product", price: 9.99, sku: "SKU-001" }),
    },
  };
  const result = sentryBeforeSend(event);
  assert.equal(result.request.data, undefined);
  assert.equal(result.request.method, "POST");
  assert.equal(result.request.url, "/api/v1/products");
});
test("removes request.cookies", () => {
  const event = {
    request: { url: "/api/v1/products", cookies: { session: "abc123", _ga: "UA-xxx" } },
  };
  const result = sentryBeforeSend(event);
  assert.equal(result.request.cookies, undefined);
});

console.log("\nsentryBeforeSend — auth headers (session credentials)");
test("removes authorization header", () => {
  const event = {
    request: {
      url: "/api/v1/products",
      headers: { authorization: "Bearer tok_secret", "content-type": "application/json" },
    },
  };
  const result = sentryBeforeSend(event);
  assert.equal(result.request.headers["authorization"], undefined);
  assert.equal(result.request.headers["content-type"], "application/json");
});
test("removes cookie header", () => {
  const event = {
    request: {
      url: "/api/v1/products",
      headers: { cookie: "session=abc; _ga=UA-xxx", host: "api.vexapim.com" },
    },
  };
  const result = sentryBeforeSend(event);
  assert.equal(result.request.headers["cookie"], undefined);
  assert.equal(result.request.headers["host"], "api.vexapim.com");
});
test("removes x-api-key header", () => {
  const event = {
    request: {
      url: "/api/v1/products",
      headers: { "x-api-key": "secret_key_123", "content-type": "application/json" },
    },
  };
  const result = sentryBeforeSend(event);
  assert.equal(result.request.headers["x-api-key"], undefined);
  assert.equal(result.request.headers["content-type"], "application/json");
});
test("strips all three auth headers together", () => {
  const event = {
    request: {
      url: "/api/v1/products",
      data: '{"title":"My Product"}',
      cookies: { session: "abc" },
      headers: {
        authorization: "Bearer tok",
        cookie: "session=abc",
        "x-api-key": "key_secret",
        "accept-language": "en-US",
      },
    },
  };
  const result = sentryBeforeSend(event);
  assert.equal(result.request.data, undefined);
  assert.equal(result.request.cookies, undefined);
  assert.equal(result.request.headers["authorization"], undefined);
  assert.equal(result.request.headers["cookie"], undefined);
  assert.equal(result.request.headers["x-api-key"], undefined);
  assert.equal(result.request.headers["accept-language"], "en-US");
});

console.log("\nsentryBeforeSend — non-sensitive fields preserved");
test("keeps exception, level, and tags", () => {
  const event = {
    exception: { values: [{ type: "TypeError", value: "Cannot read property" }] },
    level: "error",
    tags: { env: "production", component: "connector" },
    request: {
      method: "GET",
      url: "/api/v1/health",
      headers: { host: "api.vexapim.com" },
    },
  };
  const result = sentryBeforeSend(event);
  assert.deepEqual(result.exception, event.exception);
  assert.equal(result.level, "error");
  assert.deepEqual(result.tags, event.tags);
  assert.equal(result.request.headers["host"], "api.vexapim.com");
});

console.log("\nsentryBeforeSend — edge cases");
test("does not throw if headers is missing", () => {
  const event = { request: { method: "GET", url: "/api/v1/health" } };
  assert.doesNotThrow(() => sentryBeforeSend(event));
});
test("does not mutate when request is a string", () => {
  const event = { request: "not-an-object" };
  const result = sentryBeforeSend(event);
  assert.equal(result.request, "not-an-object");
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
