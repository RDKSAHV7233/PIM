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

const helper = read("apps/api/src/common/security/internal-token.ts");
const billing = read("apps/api/src/billing/billing.controller.ts");
const platform = read("apps/api/src/platform-admin/platform-admin.controller.ts");
const relay = read("apps/api/src/connector-framework/connector-webhook-relay.controller.ts");
const platformModule = read("apps/api/src/platform-admin/platform-admin.module.ts");
const relayModule = read("apps/api/src/connector-framework/connector-framework.module.ts");

for (const [name, source] of [
  ["billing.controller.ts", billing],
  ["platform-admin.controller.ts", platform],
  ["connector-webhook-relay.controller.ts", relay],
]) {
  assert(!source.includes("!== expectedToken"), `${name} must not use raw token inequality checks`);
  assert(!source.includes("=== expectedToken"), `${name} must not use raw token equality checks`);
  assert(source.includes("requireInternalToken"), `${name} must use requireInternalToken`);
}

assert(helper.includes("timingSafeEqual"), "internal-token helper must use timingSafeEqual");
assert(helper.includes("HttpStatus.TOO_MANY_REQUESTS"), "internal-token helper must rate-limit repeated invalid attempts");
assert(helper.includes("INTERNAL_TOKEN_RATE_LIMITED"), "internal-token helper must return a stable rate-limit error code");
assert(billing.includes("COMMERCIAL_INTERNAL_TOKEN_REJECTED"), "billing route must audit rejected internal tokens");
assert(platform.includes("PLATFORM_ADMIN_TOKEN_REJECTED"), "platform route must audit rejected internal tokens");
assert(relay.includes("CONNECTOR_WEBHOOK_RELAY_TOKEN_REJECTED"), "relay route must audit rejected internal tokens");
assert(platform.includes("PLATFORM_TENANT_PROVISIONED"), "platform route must audit successful tenant provisioning");
assert(relay.includes("CONNECTOR_WEBHOOK_RELAY_ACCEPTED"), "relay route must audit successful relay acceptance");
assert(platformModule.includes("AuditModule"), "platform module must import AuditModule");
assert(relayModule.includes("AuditModule"), "connector framework module must import AuditModule");

console.log(
  JSON.stringify(
    {
      status: "ok",
      validated: [
        "internal_token_comparisons_are_constant_time_helper_backed",
        "invalid_token_attempts_are_rate_limited",
        "failed_internal_token_attempts_are_audited",
        "sensitive_success_paths_have_audit_events",
      ],
      checkedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
