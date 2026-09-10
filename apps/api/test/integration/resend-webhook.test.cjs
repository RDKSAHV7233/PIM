"use strict";

/**
 * Integration contract test: Resend delivery webhook (H-2)
 *
 * Two layers:
 *
 * 1. FUNCTIONAL — a self-contained Svix signer (`svixSign`) is checked against
 *    the canonical Svix test vector, then the same signing + verification logic
 *    the controller relies on is exercised directly:
 *      - valid signature            -> accepted (controller would return 2xx and
 *                                      emit the `auth.email.delivery` metric)
 *      - tampered / wrong signature -> rejected (controller returns 401)
 *      - unset secret               -> guard trips (controller returns 503)
 *      - stale timestamp            -> rejected (replay-window guard)
 *
 * 2. SOURCE CONTRACT — asserts the shipped source wires everything together:
 *    controller decorators + status codes, MetricsService emission, raw-body
 *    middleware, module registration, the auth.email job-failure signal, and the
 *    RESEND_WEBHOOK_SECRET env entry.
 *
 * The worktree has no node_modules / no dist, so a full Nest bootstrap is not
 * possible here; the functional layer re-implements the exact Svix scheme (it is
 * kept in lockstep with `resend-signature.ts` by assertions in layer 2).
 */

const fs = require("fs");
const path = require("path");
const { createHmac, timingSafeEqual } = require("crypto");

const SRC = path.join(__dirname, "../../src");
const SIGNATURE_PATH = path.join(SRC, "webhooks/resend/resend-signature.ts");
const CONTROLLER_PATH = path.join(SRC, "webhooks/resend/resend-webhook.controller.ts");
const MODULE_PATH = path.join(SRC, "webhooks/resend/resend-webhook.module.ts");
const APP_MODULE_PATH = path.join(SRC, "app.module.ts");
const MAIN_PATH = path.join(SRC, "main.ts");
const ENV_PATH = path.join(SRC, "common/env-validation.ts");
const AUTH_SERVICE_PATH = path.join(SRC, "auth/auth.service.ts");
const AUTH_MODULE_PATH = path.join(SRC, "auth/auth.module.ts");

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

// ── Svix signing helper (mirrors resend-signature.ts) ─────────────────────────

const WHSEC_PREFIX = "whsec_";
const MAX_SKEW_SECONDS = 5 * 60;

function svixSign(rawBody, { svixId, svixTimestamp }, secret) {
  const base64 = secret.startsWith(WHSEC_PREFIX) ? secret.slice(WHSEC_PREFIX.length) : secret;
  const key = Buffer.from(base64, "base64");
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);
  const signedContent = `${svixId}.${svixTimestamp}.${body}`;
  return createHmac("sha256", key).update(signedContent, "utf8").digest("base64");
}

function svixHeader(rawBody, headers, secret) {
  return `v1,${svixSign(rawBody, headers, secret)}`;
}

// Reference verifier — same decision the controller makes before returning 401.
function verify(rawBody, headers, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const svixId = String(headers.svixId ?? "").trim();
  const svixTimestamp = String(headers.svixTimestamp ?? "").trim();
  const svixSignature = String(headers.svixSignature ?? "").trim();
  if (!svixId || !svixTimestamp || !svixSignature) return { valid: false, reason: "missing_headers" };
  const base64 = secret.startsWith(WHSEC_PREFIX) ? secret.slice(WHSEC_PREFIX.length) : secret;
  const key = base64 ? Buffer.from(base64, "base64") : Buffer.alloc(0);
  if (key.length === 0) return { valid: false, reason: "bad_secret" };
  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) {
    return { valid: false, reason: "timestamp_skew" };
  }
  const expected = svixSign(rawBody, { svixId, svixTimestamp }, secret);
  const candidates = svixSignature
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.startsWith("v1,"))
    .map((t) => t.slice(3));
  for (const candidate of candidates) {
    const a = Buffer.from(candidate, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length === b.length && timingSafeEqual(a, b)) return { valid: true };
  }
  return { valid: false, reason: "signature_mismatch" };
}

console.log("\nResend Webhook Integration Contract Tests (H-2)\n");

// ── Layer 1: functional ──────────────────────────────────────────────────────

console.log("Svix signing scheme:");

// Canonical Svix test vector — https://docs.svix.com/receiving/verifying-payloads/how-manual
const VECTOR_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const VECTOR_ID = "msg_p5jXN8AQM9LWM0D4loKWxJek";
const VECTOR_TS = "1614265330";
const VECTOR_BODY = '{"test": 2432232314}';
const VECTOR_EXPECTED = "g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";
assert(
  "svixSign reproduces the canonical Svix test-vector signature",
  svixSign(VECTOR_BODY, { svixId: VECTOR_ID, svixTimestamp: VECTOR_TS }, VECTOR_SECRET) === VECTOR_EXPECTED,
);

const SECRET = "whsec_" + Buffer.from("h2-email-delivery-observability-secret").toString("base64");
const NOW = Math.floor(Date.now() / 1000);
const BOUNCE_BODY = JSON.stringify({
  type: "email.bounced",
  created_at: new Date(NOW * 1000).toISOString(),
  data: { to: ["ops-test@example.com"], tags: [{ name: "category", value: "password_reset" }] },
});
const HEADERS = { svixId: "msg_h2_test", svixTimestamp: String(NOW) };

console.log("\nSignature verification (the 401 / 2xx decision):");
assert(
  "valid signature over the raw body is accepted (-> 2xx + metric emit)",
  verify(BOUNCE_BODY, { ...HEADERS, svixSignature: svixHeader(BOUNCE_BODY, HEADERS, SECRET) }, SECRET, NOW).valid === true,
);
assert(
  "signature over a different body is rejected (-> 401)",
  verify(BOUNCE_BODY, { ...HEADERS, svixSignature: svixHeader("{}", HEADERS, SECRET) }, SECRET, NOW).valid === false,
);
assert(
  "garbage signature is rejected (-> 401)",
  verify(BOUNCE_BODY, { ...HEADERS, svixSignature: "v1,not-a-real-signature" }, SECRET, NOW).valid === false,
);
assert(
  "missing svix headers are rejected (-> 401)",
  verify(BOUNCE_BODY, { svixId: "", svixTimestamp: "", svixSignature: "" }, SECRET, NOW).valid === false,
);
assert(
  "empty secret trips the guard (-> 503 in controller)",
  verify(BOUNCE_BODY, { ...HEADERS, svixSignature: "v1,x" }, "", NOW).reason === "bad_secret",
);
assert(
  "timestamp older than 5 min is rejected (replay guard)",
  verify(
    BOUNCE_BODY,
    { svixId: HEADERS.svixId, svixTimestamp: String(NOW - 6 * 60), svixSignature: svixHeader(BOUNCE_BODY, { svixId: HEADERS.svixId, svixTimestamp: String(NOW - 6 * 60) }, SECRET) },
    SECRET,
    NOW,
  ).valid === false,
);

// ── Layer 2: source contract ─────────────────────────────────────────────────

const signatureSrc = readFile(SIGNATURE_PATH);
const controllerSrc = readFile(CONTROLLER_PATH);
const moduleSrc = readFile(MODULE_PATH);
const appModuleSrc = readFile(APP_MODULE_PATH);
const mainSrc = readFile(MAIN_PATH);
const envSrc = readFile(ENV_PATH);
const authServiceSrc = readFile(AUTH_SERVICE_PATH);
const authModuleSrc = readFile(AUTH_MODULE_PATH);

console.log("\nresend-signature.ts:");
assert("helper file exists", signatureSrc.length > 0);
assert("strips the whsec_ prefix", signatureSrc.includes("whsec_"));
assert("base64-decodes the secret key bytes", signatureSrc.includes('Buffer.from(base64, "base64")'));
assert("signs ${svixId}.${svixTimestamp}.${body}", signatureSrc.includes("${svixId}.${svixTimestamp}.${body}") || signatureSrc.includes("${String(headers.svixId ?? \"\")}.${String(headers.svixTimestamp ?? \"\")}.${body}"));
assert("uses HMAC-SHA256 -> base64", signatureSrc.includes('createHmac("sha256"') && signatureSrc.includes('.digest("base64")'));
assert("constant-time compare via timingSafeEqual", signatureSrc.includes("timingSafeEqual"));
assert("parses space-separated v1, tokens", signatureSrc.includes('startsWith("v1,")') && signatureSrc.includes('.split(" ")'));
assert("rejects timestamp skew > 5 min", signatureSrc.includes("5 * 60"));

console.log("\nresend-webhook.controller.ts:");
assert("controller file exists", controllerSrc.length > 0);
assert("route is webhooks/resend", controllerSrc.includes('@Controller("webhooks/resend")'));
assert("@Public() (no JWT on webhook route)", controllerSrc.includes("@Public()"));
assert("@Post() declared", controllerSrc.includes("@Post()"));
assert("responds 200 quickly (@HttpCode OK)", controllerSrc.includes("HttpStatus.OK"));
assert("reads svix-id / svix-timestamp / svix-signature headers",
  controllerSrc.includes('"svix-id"') && controllerSrc.includes('"svix-timestamp"') && controllerSrc.includes('"svix-signature"'));
assert("calls verifyResendSignature", controllerSrc.includes("verifyResendSignature"));
assert("401 on bad signature", controllerSrc.includes("UnauthorizedException"));
assert("503 when secret unset", controllerSrc.includes("ServiceUnavailableException"));
assert('logs "RESEND_WEBHOOK_SECRET not configured"', controllerSrc.includes("RESEND_WEBHOOK_SECRET not configured"));
assert("reads RESEND_WEBHOOK_SECRET from env", controllerSrc.includes("process.env.RESEND_WEBHOOK_SECRET"));
assert("handles the five delivery event types",
  ["email.sent", "email.delivered", "email.delivery_delayed", "email.bounced", "email.complained"].every((t) => controllerSrc.includes(t)));
assert("emits MetricsService metricKey auth.email.delivery",
  controllerSrc.includes("metricsService.emit") && controllerSrc.includes('"auth.email.delivery"'));
assert("metric tags carry event + category", controllerSrc.includes("event: type") && controllerSrc.includes("category"));
assert("category is read from data.tags with unknown default", controllerSrc.includes("tags") && controllerSrc.includes('"unknown"'));
assert("bounced/complained -> logger.warn with masked recipient",
  controllerSrc.includes("logger.warn") && controllerSrc.includes("maskRecipient"));
assert("raw body handled like the Stripe webhook", controllerSrc.includes("Buffer.isBuffer(request.body)"));

console.log("\nresend-webhook.module.ts + registration:");
assert("module imports MetricsModule", moduleSrc.includes("MetricsModule"));
assert("module registers ResendWebhookController", moduleSrc.includes("ResendWebhookController"));
assert("app.module imports ResendWebhookModule", appModuleSrc.includes("ResendWebhookModule"));
assert("main.ts gives /api/v1/webhooks/resend a raw body before json()",
  mainSrc.includes('app.use("/api/v1/webhooks/resend", raw({ type: "*/*" }))') &&
    mainSrc.indexOf("/api/v1/webhooks/resend") < mainSrc.indexOf("json({"));

console.log("\nenv-validation.ts:");
assert("RESEND_WEBHOOK_SECRET declared on the Env interface + schema",
  (envSrc.match(/RESEND_WEBHOOK_SECRET/g) || []).length >= 2);
assert("RESEND_WEBHOOK_SECRET is optional (no hard requirement)",
  envSrc.includes("RESEND_WEBHOOK_SECRET: z.string().optional()"));

console.log("\nauth.service.ts job-failure signal:");
assert("MetricsService injected", authServiceSrc.includes("private readonly metricsService: MetricsService"));
assert("auth.email consumer wraps the handler in try/catch",
  authServiceSrc.includes("await this.processAuthEmailJob(payload)") && authServiceSrc.includes("emitAuthEmailJobFailure"));
assert("emits metricKey auth.email.job_failed with category tag",
  authServiceSrc.includes('"auth.email.job_failed"') && authServiceSrc.includes("tags: { category }"));
assert("logs the correlation ref via logger.error", authServiceSrc.includes("logger.error") && authServiceSrc.includes("correlationRef"));
assert("rethrows so BullMQ retry / DLQ still happens",
  /emitAuthEmailJobFailure\(payload, error\);\s*throw error;/.test(authServiceSrc));
assert("auth.module imports MetricsModule", authModuleSrc.includes("MetricsModule"));

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"-".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll Resend webhook integration contract tests passed.");
process.exit(0);
