#!/usr/bin/env node
/* eslint-disable no-console */
//
// P1 evidence: WooCommerce credential ownership and tenant isolation, plus the app-auth product gap.
//
// This is an EVIDENCE run against a local sandbox. It proves what is real and states plainly what is
// not. It does not implement, simulate-as-passing, or fix anything in the product.
//
//   PART A  PROVIDER ISSUANCE   a real WooCommerce (sandbox) runs its real /wc-auth/v1/authorize flow
//                               and POSTs real, freshly generated credentials to a capture listener.
//                               Records the method, content type and payload shape.
//   PART B  VEXA PERSISTENCE    the BUILT Vexa API on a THROWAWAY database, two tenants, two
//                               installations. Genuine WooCommerce-issued credentials are fed through the
//                               EXISTING AUTHENTICATED Vexa path (POST /connectors/:id/oauth/callback).
//                               NOT a real WooCommerce app-auth callback: WooCommerce cannot call that
//                               route (see PART D). Rows are read back and printed REDACTED. The stored
//                               credentials are then used against the sandbox (reconnect -> authenticated
//                               request), with a wrong-credentials control.
//   PART C  NEGATIVE BOUNDARY   tenant B -> installation A is denied; a cross-tenant credential-id
//                               collision fails closed; forged / replayed / expired / cross-tenant /
//                               swapped / mismatched / tampered signed state is refused. After every
//                               negative the whole credential table is unchanged. The public-route
//                               negatives use SYNTHETIC values only; no real credential is ever placed
//                               in a URL.
//   PART D  PRODUCT GAP         expected findings, observed live and in source: Vexa cannot generate a
//                               WooCommerce app-auth URL, has no receiver WooCommerce can call, the web UI
//                               cannot initiate it, and a valid WooCommerce signed state cannot be minted.
//
// Isolation: a throwaway Postgres database (created and dropped here), random secrets generated per run,
// a dedicated sandbox WordPress user (created and removed here), and a local TLS front on a random port.
// It never touches a shared database, a real tenant or production. Secrets are never printed: every
// secret value is registered and the final transcript is scanned for it; a leak fails the run.
//
// Requirements: Docker with the Woo sandbox containers running (default vexa-wc-wp / vexa-wc-mysql, site
// http://localhost:8081), the API built (npm run build --workspace @pim1/api), openssl, and
//   P1_PROOF_ADMIN_DATABASE_URL  a Postgres URL with CREATEDB rights (its database is only used to
//                                connect; the throwaway database is created beside it).
// Optional: P1_PROOF_WOO_URL, P1_PROOF_WP_CONTAINER, P1_PROOF_API_PORT.
//
// Usage:
//   P1_PROOF_ADMIN_DATABASE_URL=postgresql://... node scripts/p1-woo-credential-ownership-proof.cjs [--out evidence.json]
//
// Exit status: 0 when every PROOF check passed and every expected GAP was observed as expected;
// non-zero otherwise (including any secret appearing in the output).

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");

// ─── pure helpers (unit tested) ────────────────────────────────────────────────

/** A value safe to print for a credential: kind and length only. */
function redactSecret(value) {
  const text = String(value ?? "");
  if (!text) return "<empty>";
  const prefix = /^(ck_|cs_)/.exec(text)?.[1] ?? "";
  return `${prefix}***(len ${text.length})`;
}

/** The shape of a WooCommerce app-auth callback body: keys and types, values redacted. */
function describeCallbackBody(rawBody) {
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { parsedAs: "not-json", keys: [] };
  }
  const shape = {};
  for (const [key, value] of Object.entries(parsed)) {
    shape[key] = ["consumer_key", "consumer_secret"].includes(key) ? redactSecret(value) : typeof value === "number" ? "number" : String(value);
  }
  return { parsedAs: "json", keys: Object.keys(parsed).sort(), shape };
}

/** Fingerprint of the credentials table: any change to any row changes it. Never printed raw. */
function fingerprintRows(rows) {
  const lines = rows
    .map((r) => `${r.id}|${r.tenant_key}|${r.installation_id}|${r.credential_type}|${r.encrypted_hash}|${r.updated_at}`)
    .sort();
  return crypto.createHash("sha256").update(lines.join("\n")).digest("hex");
}

/** A sensitive value plus the encodings the script could plausibly emit it in. */
function expandSecretVariants(value) {
  if (!value) return [];
  const text = String(value);
  return [...new Set([
    text,
    Buffer.from(text).toString("base64"),
    Buffer.from(text).toString("base64url"),
    Buffer.from(text).toString("hex"),
    encodeURIComponent(text),
  ])];
}

/** Returns the registered secrets found in the text (empty when clean). */
function findLeaks(text, secrets) {
  const leaks = [];
  for (const secret of secrets) {
    if (secret && secret.length >= 6 && text.includes(secret)) leaks.push(redactSecret(secret));
  }
  return leaks;
}

/** Source-level check: any non-comment line that builds a WooCommerce app-auth URL. */
function findWcAuthCode(files) {
  const hits = [];
  for (const { file, text } of files) {
    text.split(/\r?\n/).forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      if (/wc-auth/i.test(trimmed)) hits.push(`${file}:${index + 1}`);
    });
  }
  return hits;
}

// ─── run state ────────────────────────────────────────────────────────────────

const transcript = [];
const secrets = new Set();
const results = []; // { id, part, kind: "PROOF" | "GAP", claim, expected, observed, status }

function say(line = "") {
  transcript.push(line);
  console.log(line);
}

function register(...values) {
  for (const value of values) for (const variant of expandSecretVariants(value)) secrets.add(variant);
}

function record(id, part, kind, claim, expected, observed, ok) {
  const status = kind === "GAP" ? (ok ? "GAP-CONFIRMED" : "GAP-CHANGED") : ok ? "PASS" : "FAIL";
  results.push({ id, part, kind, claim, expected, observed, status });
  say(`  ${status.padEnd(13)} ${id}  ${claim}`);
  if (!ok || process.env.P1_PROOF_VERBOSE === "1") say(`                 expected: ${expected}\n                 observed: ${observed}`);
}

// ─── small utilities ──────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  return { code: result.status, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function databaseUrlFor(adminUrl, databaseName) {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

// ─── TLS front: HTTPS for the sandbox + the callback capture listener ─────────

function generateCertificate(dir) {
  const key = path.join(dir, "proof.key");
  const cert = path.join(dir, "proof.crt");
  const made = run("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1",
    "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,DNS:host.docker.internal,IP:127.0.0.1",
  ]);
  if (made.code !== 0) throw new Error(`openssl failed: ${made.out.slice(0, 200)}`);
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert), certPath: cert };
}

function startFront({ key, cert }, wooHttpUrl) {
  const captured = [];
  const target = new URL(wooHttpUrl);
  const server = https.createServer({ key, cert }, (req, res) => {
    if (req.url && req.url.startsWith("/__p1proof/callback")) {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        captured.push({
          method: req.method,
          contentType: req.headers["content-type"] ?? null,
          userAgent: req.headers["user-agent"] ?? null,
          body: Buffer.concat(chunks).toString("utf8"),
          at: new Date().toISOString(),
        });
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
      });
      return;
    }
    // Everything else is a plain proxy to the sandbox (it only speaks HTTP).
    const upstream = http.request(
      { host: target.hostname, port: target.port, method: req.method, path: req.url, headers: { ...req.headers, host: target.host } },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502);
      res.end("sandbox unreachable");
    });
    req.pipe(upstream);
  });
  return new Promise((resolve) => {
    server.listen(0, "0.0.0.0", () => resolve({ server, port: server.address().port, captured }));
  });
}

// ─── WooCommerce sandbox: user, allowances, real app-auth issuance ────────────

function sandboxPhp(container, code, env = {}) {
  const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  return run("docker", ["exec", ...envArgs, container, "php", "-r", code], { env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
}

function writeSandboxFile(container, filePath, content) {
  const result = spawnSync("docker", ["exec", "-i", container, "sh", "-c", `cat > ${filePath}`], {
    input: content,
    encoding: "utf8",
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
  });
  return result.status === 0;
}

const MU_PLUGIN = "/var/www/html/wp-content/mu-plugins/p1-proof-callback.php";

function prepareSandbox({ container, port, password }) {
  // Sandbox-only allowances so WooCommerce's safe remote post may reach the local self-signed listener.
  const mu = `<?php
// P1 proof (sandbox only, removed by the proof run).
add_filter('http_request_host_is_external', function ($is, $host) { return $host === 'host.docker.internal' ? true : $is; }, 10, 2);
add_filter('http_allowed_safe_ports', function ($ports) { $ports[] = ${port}; return $ports; });
add_filter('https_ssl_verify', '__return_false');
add_filter('https_local_ssl_verify', '__return_false');
`;
  if (!writeSandboxFile(container, MU_PLUGIN, mu)) throw new Error("could not write the sandbox mu-plugin");
  const created = sandboxPhp(
    container,
    `require '/var/www/html/wp-load.php';
$u = get_user_by('login', 'p1proof_admin');
if (!$u) { $id = wp_insert_user(['user_login'=>'p1proof_admin','user_pass'=>getenv('P1_PW'),'role'=>'administrator','user_email'=>'p1proof@example.invalid']); if (is_wp_error($id)) { fwrite(STDERR, $id->get_error_message()); exit(2); } }
else { wp_set_password(getenv('P1_PW'), $u->ID); }
echo 'user-ready';`,
    { P1_PW: password },
  );
  if (!created.out.includes("user-ready")) throw new Error(`could not prepare the sandbox user: ${created.out.slice(0, 200)}`);
}

function cleanupSandbox(container) {
  run("docker", ["exec", container, "rm", "-f", MU_PLUGIN], { env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  sandboxPhp(
    container,
    `require '/var/www/html/wp-load.php'; require_once ABSPATH.'wp-admin/includes/user.php'; global $wpdb;
$wpdb->query("DELETE FROM {$wpdb->prefix}woocommerce_api_keys WHERE description LIKE 'P1 proof%'");
$u = get_user_by('login', 'p1proof_admin'); if ($u) { wp_delete_user($u->ID); } echo 'cleaned';`,
  );
}

class CookieJar {
  constructor() { this.cookies = new Map(); }
  absorb(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
}

async function fetchManual(url, { jar, method = "GET", body, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    body,
    redirect: "manual",
    headers: { ...(jar ? { cookie: jar.header() } : {}), ...headers },
  });
  jar?.absorb(res);
  return res;
}

/** Sandbox Woo redirects to https://localhost:8081 (its mu-plugin claims SSL); the sandbox only speaks HTTP. */
function toSandboxHttp(url, wooHttpUrl) {
  const base = new URL(wooHttpUrl);
  const u = new URL(url, wooHttpUrl);
  u.protocol = base.protocol;
  u.host = base.host;
  return u.toString();
}

/**
 * One real WooCommerce app-auth issuance: log in, open the real authorize page, grant access. WooCommerce itself
 * then creates the key pair and POSTs it to the callback URL. Returns the captured callback and the credentials.
 */
async function issueViaWooAppAuth({ wooHttpUrl, password, front, hostForWoo, label, captured }) {
  const jar = new CookieJar();
  jar.cookies.set("wordpress_test_cookie", "WP%20Cookie%20check");
  const login = await fetchManual(`${wooHttpUrl}/wp-login.php`, {
    jar,
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ log: "p1proof_admin", pwd: password, "wp-submit": "Log In", testcookie: "1" }).toString(),
  });
  if (![302, 200].includes(login.status) || ![...jar.cookies.keys()].some((k) => k.startsWith("wordpress_logged_in"))) {
    throw new Error(`sandbox login failed (status ${login.status})`);
  }

  const callbackUrl = `https://${hostForWoo}:${front.port}/__p1proof/callback/${encodeURIComponent(label)}`;
  const returnUrl = `https://localhost:${front.port}/__p1proof/return`;
  const authorize = `${wooHttpUrl}/wc-auth/v1/authorize?${new URLSearchParams({
    app_name: `P1 proof ${label}`,
    scope: "read_write",
    user_id: label,
    return_url: returnUrl,
    callback_url: callbackUrl,
  })}`;
  const page = await fetchManual(authorize, { jar });
  if (page.status === 302) {
    const next = await fetchManual(toSandboxHttp(page.headers.get("location"), wooHttpUrl), { jar });
    if (next.status !== 200) throw new Error(`authorize page not shown (status ${next.status})`);
    return grantAccess(await next.text(), { wooHttpUrl, jar, label, captured, returnUrl });
  }
  if (page.status !== 200) throw new Error(`authorize page not shown (status ${page.status})`);
  return grantAccess(await page.text(), { wooHttpUrl, jar, label, captured, returnUrl });
}

async function grantAccess(html, { wooHttpUrl, jar, label, captured, returnUrl }) {
  const match = /href="([^"]*access_granted[^"]*)"/.exec(html);
  if (!match) throw new Error("authorize page has no access-granted link");
  const grantedUrl = toSandboxHttp(match[1].replace(/&#038;|&amp;/g, "&"), wooHttpUrl);
  const before = captured.length;
  const granted = await fetchManual(grantedUrl, { jar });
  const location = granted.headers.get("location") ?? "";
  const hit = captured.slice(before).find((c) => true);
  if (!hit) throw new Error(`WooCommerce did not post to the callback (status ${granted.status})`);
  let body;
  try { body = JSON.parse(hit.body); } catch { throw new Error("callback body is not JSON"); }
  register(body.consumer_key, body.consumer_secret);
  return {
    label,
    callback: { method: hit.method, contentType: hit.contentType, shape: describeCallbackBody(hit.body), at: hit.at },
    returnRedirect: { status: granted.status, toReturnUrl: location.startsWith(returnUrl), success: /[?&]success=1/.test(location) },
    credentials: { consumerKey: body.consumer_key, consumerSecret: body.consumer_secret, userId: body.user_id, keyPermissions: body.key_permissions },
  };
}

// ─── Vexa API ─────────────────────────────────────────────────────────────────

function startApi({ port, env }) {
  const child = spawn(process.execPath, [path.join(REPO_ROOT, "apps", "api", "scripts", "start-built-api.cjs")], {
    cwd: path.join(REPO_ROOT, "apps", "api"),
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = [];
  child.stdout.on("data", (d) => log.push(String(d)));
  child.stderr.on("data", (d) => log.push(String(d)));
  return { child, log };
}

async function waitForApi(base, child, log) {
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null) throw new Error(`API exited early:\n${log.join("").slice(-1500)}`);
    try {
      const res = await fetch(`${base}/health`);
      if (res.status < 500) return;
    } catch { /* not yet */ }
    await sleep(1000);
  }
  throw new Error(`API did not become ready:\n${log.join("").slice(-1500)}`);
}

async function api(base, method, route, { token, body, redirect = "manual" } = {}) {
  const res = await fetch(`${base}${route}`, {
    method,
    redirect,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await res.text();
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, json, location: res.headers.get("location"), text };
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const outIndex = process.argv.indexOf("--out");
  const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : null;
  const adminUrl = process.env.P1_PROOF_ADMIN_DATABASE_URL;
  if (!adminUrl) {
    console.error("P1_PROOF_ADMIN_DATABASE_URL is required (a Postgres URL with CREATEDB rights).");
    process.exit(2);
  }
  const wooHttpUrl = (process.env.P1_PROOF_WOO_URL || "http://localhost:8081").replace(/\/+$/, "");
  const container = process.env.P1_PROOF_WP_CONTAINER || "vexa-wc-wp";
  const apiPort = Number(process.env.P1_PROOF_API_PORT || 4027);
  const apiBase = `http://127.0.0.1:${apiPort}/api/v1`;
  const hostForWoo = process.env.P1_PROOF_CALLBACK_HOST || "host.docker.internal";
  // RLS is on by default: the API runs as a restricted role that cannot bypass row-level security, the way
  // the tenant-scoped client is meant to. P1_PROOF_RLS=off runs it as the owner (RLS bypassed), which is
  // only useful to prove the application-level tenant filter on its own.
  const rlsOn = String(process.env.P1_PROOF_RLS || "on").toLowerCase() !== "off";

  const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const dbName = `pim1_p1_woo_proof_${runId}`;
  const appRole = `p1proof_app_${runId}`;
  const appRolePassword = crypto.randomBytes(12).toString("hex");
  const tenantA = `p1proof-tenant-a-${runId}`;
  const tenantB = `p1proof-tenant-b-${runId}`;
  const sharedPassword = crypto.randomBytes(12).toString("hex");
  const wpPassword = crypto.randomBytes(12).toString("hex");
  const jwtSecret = crypto.randomBytes(32).toString("hex");
  const encryptionKey = crypto.randomBytes(32).toString("hex");
  register(sharedPassword, wpPassword, jwtSecret, encryptionKey, appRolePassword);
  // The administrator's own connection string (and its password) is also sensitive and must never be emitted.
  register(adminUrl, (() => { try { return decodeURIComponent(new URL(adminUrl).password); } catch { return ""; } })());

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p1-woo-proof-"));
  const meta = {
    runId,
    startedAt: new Date().toISOString(),
    gitSha: run("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT }).out.trim(),
    node: process.version,
    wooSandbox: wooHttpUrl,
    throwawayDatabase: dbName,
    clients: {
      setupAndEvidence: "privileged; not used to prove tenant isolation",
      application: rlsOn ? "restricted role, RLS enforced" : "owner, RLS bypassed",
      applicationDirect: "privileged by design (RLS-BYPASS); guarded by the credential upsert WHERE clause (C5)",
    },
    rowLevelSecurity: rlsOn ? "enforced for the tenant-scoped client (restricted role)" : "BYPASSED (owner role) - application filter only",
    note: "Local sandbox evidence. Not staging. Not production.",
  };
  say("P1 WooCommerce credential ownership proof");
  say(`run ${runId}  sha ${meta.gitSha.slice(0, 12)}  node ${process.version}`);
  say("Local sandbox evidence only: not staging, not production.");
  say();

  let front;
  let apiProc;
  let apiProcOwner;
  let prisma;
  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try { if (apiProc) apiProc.child.kill(); } catch { /* ignore */ }
    try { if (apiProcOwner) apiProcOwner.child.kill(); } catch { /* ignore */ }
    try { if (prisma) await prisma.$disconnect(); } catch { /* ignore */ }
    try { if (front) front.server.close(); } catch { /* ignore */ }
    try { cleanupSandbox(container); } catch { /* ignore */ }
    try {
      const { PrismaClient } = require(path.join(REPO_ROOT, "node_modules", "@prisma", "client"));
      const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS "${appRole}"`);
      await admin.$disconnect();
    } catch { /* ignore */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  };
  process.on("SIGINT", () => cleanup().then(() => process.exit(130)));

  try {
    // ── setup ──────────────────────────────────────────────────────────────────
    const running = run("docker", ["inspect", "-f", "{{.State.Running}}", container]);
    if (running.out.trim() !== "true") throw new Error(`sandbox container ${container} is not running`);
    if (!fs.existsSync(path.join(REPO_ROOT, "apps", "api", "dist", "main.js"))) throw new Error("API not built: npm run build --workspace @pim1/api");

    const tls = generateCertificate(tmp);
    register(tls.key.toString("utf8"));
    front = await startFront(tls, wooHttpUrl);
    prepareSandbox({ container, port: front.port, password: wpPassword });

    const { PrismaClient } = require(path.join(REPO_ROOT, "node_modules", "@prisma", "client"));
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    await admin.$disconnect();
    const dbUrl = databaseUrlFor(adminUrl, dbName);
    register(dbUrl);
    const migrate = run(process.execPath, [path.join(REPO_ROOT, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], {
      cwd: path.join(REPO_ROOT, "packages", "db"),
      env: { ...process.env, DATABASE_URL: dbUrl, DATABASE_URL_DIRECT: dbUrl, DATABASE_URL_POOLED: dbUrl, CHECKPOINT_DISABLE: "1" },
    });
    if (migrate.code !== 0) throw new Error(`migrate deploy failed:\n${migrate.out.slice(-800)}`);
    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    // Plan fixture (not credential data): the default plan allows one account per connector, and this proof
    // needs several installations per tenant.
    for (const tenant of [tenantA, tenantB]) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "TenantPlanProfile" (id, "tenantKey", "planTier", "billingStatus", "accessStatus", "updatedAt") VALUES ($1, $2, 'ENTERPRISE', 'active', 'active', NOW())`,
        crypto.randomBytes(12).toString("hex"),
        tenant,
      );
    }

    let appUrl = dbUrl;
    if (rlsOn) {
      await prisma.$executeRawUnsafe(`CREATE ROLE "${appRole}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${appRolePassword}'`);
      await prisma.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${dbName}" TO "${appRole}"`);
      await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${appRole}"`);
      await prisma.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${appRole}"`);
      await prisma.$executeRawUnsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${appRole}"`);
      const u = new URL(dbUrl);
      u.username = appRole;
      u.password = appRolePassword;
      appUrl = u.toString();
      register(appUrl);
    }
    const identities = {
      [`admin-a@${runId}.proof.local`]: { tenantId: tenantA, role: "admin" },
      [`admin-b@${runId}.proof.local`]: { tenantId: tenantB, role: "admin" },
    };
    const siteUrl = `https://localhost:${front.port}`;
    const baseApiEnv = {
        // The tenant-scoped client uses the restricted role; the documented RLS-bypass ("direct") client keeps
        // the privileged one, as it does by design.
        DATABASE_URL: appUrl,
        DATABASE_URL_POOLED: appUrl,
        DATABASE_URL_DIRECT: dbUrl,
        JWT_SECRET: jwtSecret,
        JWT_EXPIRY: "1h",
        AUTH_MODE: "local",
        PIM_AUTH_IDENTITIES_JSON: JSON.stringify(identities),
        PIM_AUTH_PASSWORD: sharedPassword,
        PIM_DEFAULT_TENANT_KEY: tenantA,
        PIM_DEFAULT_ROLE: "viewer",
        PIM_ALLOW_LEGACY_HEADERS: "false",
        CREDENTIAL_ENCRYPTION_KEY_V1: encryptionKey,
        CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION: "1",
        APP_ENV: "development",
        CORS_ORIGIN: "http://localhost:3099",
        PIM_WEB_BASE_URL: "http://localhost:3099",
        // Sandbox only: lets the connector reach the loopback TLS front, and trusts the throwaway certificate.
        PIM_UNSAFE_HTTP_WEBHOOK_TARGETS: "true",
        NODE_EXTRA_CA_CERTS: tls.certPath,
        CONNECTOR_HEARTBEAT_DISABLED: "true",
        JWT_BLOCKLIST_REDIS_DISABLED: "true",
        PIM_AUTH_REDIS_DISABLED: "true",
        DASHBOARD_CACHE_REDIS_DISABLED: "true",
        ERROR_AUTHORITY_ENABLED: "false",
        // Required by startup validation, never used in this run (Redis-backed features are disabled above,
        // and no media is touched). Obviously fake on purpose.
        REDIS_URL: "redis://127.0.0.1:6399",
        R2_ACCOUNT_ID: "p1-proof-unused",
        R2_ACCESS_KEY_ID: "p1-proof-unused",
        R2_SECRET_ACCESS_KEY: "p1-proof-unused",
        R2_BUCKET_NAME: "p1-proof-unused",
        R2_PUBLIC_URL: "https://p1-proof.invalid",
        CHECKPOINT_DISABLE: "1",
    };
    apiProc = startApi({ port: apiPort, env: baseApiEnv });
    await waitForApi(apiBase, apiProc.child, apiProc.log);

    const login = async (tenant) => {
      const userId = tenant === tenantA ? `admin-a@${runId}.proof.local` : `admin-b@${runId}.proof.local`;
      const res = await api(apiBase, "POST", "/auth/login", { body: { userId, password: sharedPassword, tenantId: tenant } });
      if (res.status >= 300 || !res.json?.accessToken) throw new Error(`login failed for ${tenant}: ${res.status} ${res.text.slice(0, 200)}`);
      register(res.json.accessToken);
      return res.json.accessToken;
    };
    const tokenA = await login(tenantA);
    const tokenB = await login(tenantB);

    const credentialRows = async () =>
      prisma.$queryRawUnsafe(
        `SELECT id, tenant_key, installation_id, credential_type, key_version, status,
                metadata->>'source' AS source, length(encrypted_value) AS encrypted_length,
                md5(encrypted_value) AS encrypted_hash, updated_at::text AS updated_at
           FROM connector_credentials ORDER BY id`,
      );
    const snapshot = async () => fingerprintRows(await credentialRows());
    const printable = (rows) =>
      rows.map((r) => ({
        id: r.id.replace(/^[^:]*:/, "<installation>:"),
        tenant_key: r.tenant_key,
        installation_id: r.installation_id,
        credential_type: r.credential_type,
        key_version: r.key_version,
        source: r.source,
        status: r.status,
        encrypted_value: `<${r.encrypted_length} chars, not printed>`,
      }));

    const rlsFacts = await prisma.$queryRawUnsafe(
      `SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = $1) AS app_super,
              (SELECT rolbypassrls FROM pg_roles WHERE rolname = $1) AS app_bypass,
              (SELECT relrowsecurity FROM pg_class WHERE relname = 'connector_credentials') AS creds_rls,
              (SELECT relrowsecurity FROM pg_class WHERE relname = 'connector_installations') AS inst_rls`,
      appRole,
    );
    const facts = rlsFacts[0] ?? {};
    say("Database clients in this run:");
    say("  SETUP / EVIDENCE client   privileged (owner). Creates fixtures and reads rows back. NOT used to prove tenant isolation.");
    say(`  APPLICATION client        ${rlsOn ? `restricted role ${appRole}, row-level security ENFORCED` : "owner role, RLS BYPASSED (P1_PROOF_RLS=off)"}. Every tenant-scoped API operation uses it.`);
    say("  APPLICATION direct client privileged by design (documented RLS-BYPASS: the WooCommerce credential write and the heartbeat use it).");
    say("                            Its tenant-ownership guard is the SQL WHERE clause on the credential upsert, proven by C5.");
    if (rlsOn) {
      record("R1", "R", "PROOF", "row-level security is enforced for the tenant-scoped client (restricted role, RLS enabled on both tables)", "app role not superuser, not BYPASSRLS; RLS on", JSON.stringify({ super: facts.app_super, bypassrls: facts.app_bypass, credentials: facts.creds_rls, installations: facts.inst_rls }), facts.app_super === false && facts.app_bypass === false && facts.creds_rls === true && facts.inst_rls === true);
    } else {
      say("  NOTE         R1  RLS bypassed for this run by request: application-level tenant filter only");
    }
    say();

    // ── PART A ─────────────────────────────────────────────────────────────────
    say("PART A  Provider issuance (real WooCommerce sandbox, real /wc-auth/v1/authorize)");
    const issuances = {};
    for (const label of ["A-install", "B-install", "A-callback", "B-callback"]) {
      issuances[label] = await issueViaWooAppAuth({ wooHttpUrl, password: wpPassword, front, hostForWoo, label, captured: front.captured });
    }
    const first = issuances["A-install"];
    const bodyKeys = first.callback.shape.keys.join(",");
    record("A1", "A", "PROOF", "WooCommerce performed the app-auth callback itself", "a request reached the listener from WooCommerce", `${front.captured.length} callbacks received`, front.captured.length === 4);
    record("A2", "A", "PROOF", "callback HTTP method is POST", "POST", String(first.callback.method), first.callback.method === "POST");
    record("A3", "A", "PROOF", "callback body is JSON (not query parameters)", "application/json", String(first.callback.contentType), /^application\/json/i.test(first.callback.contentType ?? "") && first.callback.shape.parsedAs === "json");
    record("A4", "A", "PROOF", "callback carries consumer_key, consumer_secret, key_id, user_id, key_permissions", "key_id,key_permissions,user_id,consumer_key,consumer_secret", bodyKeys, ["consumer_key", "consumer_secret", "key_id", "key_permissions", "user_id"].every((k) => first.callback.shape.keys.includes(k)));
    record("A5", "A", "PROOF", "WooCommerce issued fresh, distinct credentials per authorization", "4 distinct pairs", `${new Set(Object.values(issuances).map((i) => i.credentials.consumerKey)).size} distinct keys`, new Set(Object.values(issuances).map((i) => i.credentials.consumerKey)).size === 4 && Object.values(issuances).every((i) => /^ck_/.test(i.credentials.consumerKey) && /^cs_/.test(i.credentials.consumerSecret)));
    record("A6", "A", "PROOF", "WooCommerce then redirected the browser to the return URL with success=1", "redirect success=1", JSON.stringify(first.returnRedirect), first.returnRedirect.toReturnUrl && first.returnRedirect.success);
    say(`  captured shape: method=${first.callback.method} content-type=${first.callback.contentType}`);
    say(`  captured body : ${JSON.stringify(first.callback.shape.shape)}`);
    say();

    // ── PART B ─────────────────────────────────────────────────────────────────
    say("PART B  Vexa persistence: authenticated Vexa credential-ingestion path, using genuine WooCommerce-issued credentials");
    say("         (NOT a real WooCommerce app-auth callback: see PART D)");
    const install = async (token, alias, creds) => {
      const res = await api(apiBase, "POST", "/connectors/woocommerce/install", {
        token,
        body: { accountAlias: alias, externalAccountRef: siteUrl, clientId: creds.consumerKey, clientSecret: creds.consumerSecret },
      });
      if (![200, 201].includes(res.status) || !res.json?.id) throw new Error(`install ${alias} failed: ${res.status} ${res.text.slice(0, 300)}
--- API log tail ---
${apiProc.log.join("").slice(-1200)}`);
      return res.json.id;
    };
    const instA = await install(tokenA, "proof-a", issuances["A-install"].credentials);
    const instB = await install(tokenB, "proof-b", issuances["B-install"].credentials);
    const instA2 = await install(tokenA, "proof-a-public", issuances["A-install"].credentials);
    const instB2 = await install(tokenB, "proof-b-collision", issuances["B-install"].credentials);

    const afterInstall = await credentialRows();
    const hashOf = (rows, id) => rows.find((r) => r.id === id)?.encrypted_hash;
    const beforeA = hashOf(afterInstall, `${instA}:consumer_key`);

    const cbA = await api(apiBase, "POST", `/connectors/${instA}/oauth/callback`, {
      token: tokenA,
      body: { consumer_key: issuances["A-callback"].credentials.consumerKey, consumer_secret: issuances["A-callback"].credentials.consumerSecret, user_id: "A-callback", key_permissions: "read_write" },
    });
    const cbB = await api(apiBase, "POST", `/connectors/${instB}/oauth/callback`, {
      token: tokenB,
      body: { consumer_key: issuances["B-callback"].credentials.consumerKey, consumer_secret: issuances["B-callback"].credentials.consumerSecret, user_id: "B-callback", key_permissions: "read_write" },
    });
    record("B1", "B", "PROOF", "tenant A credential ingestion accepted", "200 CONNECTED", `${cbA.status} ${cbA.json?.status}`, cbA.status === 200 && cbA.json?.status === "CONNECTED");
    record("B2", "B", "PROOF", "tenant B credential ingestion accepted", "200 CONNECTED", `${cbB.status} ${cbB.json?.status}`, cbB.status === 200 && cbB.json?.status === "CONNECTED");

    const rows = await credentialRows();
    const forInst = (id) => rows.filter((r) => r.installation_id === id && ["consumer_key", "consumer_secret"].includes(r.credential_type));
    const ownedBy = (id, tenant) => forInst(id).length === 2 && forInst(id).every((r) => r.tenant_key === tenant && r.source === "app_auth_callback" && r.status === "ACTIVE" && r.id.startsWith(`${id}:`));
    record("B3", "B", "PROOF", "tenant A credentials stored only under tenant A / installation A", `consumer_key+consumer_secret rows, tenant_key=${tenantA}`, JSON.stringify(forInst(instA).map((r) => [r.credential_type, r.tenant_key, r.source])), ownedBy(instA, tenantA));
    record("B4", "B", "PROOF", "tenant B credentials stored only under tenant B / installation B", `consumer_key+consumer_secret rows, tenant_key=${tenantB}`, JSON.stringify(forInst(instB).map((r) => [r.credential_type, r.tenant_key, r.source])), ownedBy(instB, tenantB));
    record("B5", "B", "PROOF", "no credential row exists under any other tenant than its installation's tenant", "0 mismatches", `${rows.filter((r) => !((r.installation_id === instA || r.installation_id === instA2) ? r.tenant_key === tenantA : r.tenant_key === tenantB)).length} mismatches`, rows.every((r) => ((r.installation_id === instA || r.installation_id === instA2) ? r.tenant_key === tenantA : r.tenant_key === tenantB)));
    record("B6", "B", "PROOF", "the callback replaced the stored credential (ingestion actually wrote)", "encrypted value changed", beforeA === hashOf(rows, `${instA}:consumer_key`) ? "unchanged" : "changed", beforeA !== hashOf(rows, `${instA}:consumer_key`));
    const plaintexts = Object.values(issuances).flatMap((i) => [i.credentials.consumerKey, i.credentials.consumerSecret]);
    const rawDump = JSON.stringify(await prisma.$queryRawUnsafe("SELECT encrypted_value FROM connector_credentials"));
    record("B7", "B", "PROOF", "stored values are encrypted: no plaintext key or secret appears in the table", "0 plaintext matches", `${plaintexts.filter((p) => rawDump.includes(p)).length} matches`, plaintexts.every((p) => !rawDump.includes(p)));
    say("  redacted rows (installation A, B):");
    for (const row of printable([...forInst(instA), ...forInst(instB)])) say(`    ${JSON.stringify(row)}`);

    const reconnectA = await api(apiBase, "POST", `/connectors/${instA}/reconnect`, { token: tokenA });
    record("B8", "B", "PROOF", "stored tenant A credentials authenticate to the WooCommerce sandbox", "reconnect succeeds (ACTIVE)", `${reconnectA.status} ${JSON.stringify(reconnectA.json ?? reconnectA.text.slice(0, 120))}`, reconnectA.status < 300 && reconnectA.json?.status === "ACTIVE");
    const reconnectB = await api(apiBase, "POST", `/connectors/${instB}/reconnect`, { token: tokenB });
    record("B9", "B", "PROOF", "stored tenant B credentials authenticate to the WooCommerce sandbox", "reconnect succeeds (ACTIVE)", `${reconnectB.status} ${JSON.stringify(reconnectB.json ?? reconnectB.text.slice(0, 120))}`, reconnectB.status < 300 && reconnectB.json?.status === "ACTIVE");
    const wrong = { consumer_key: `ck_${crypto.randomBytes(20).toString("hex")}`, consumer_secret: `cs_${crypto.randomBytes(20).toString("hex")}` };
    register(wrong.consumer_key, wrong.consumer_secret);
    await api(apiBase, "POST", `/connectors/${instA2}/oauth/callback`, { token: tokenA, body: { ...wrong, user_id: "control", key_permissions: "read_write" } });
    const reconnectWrong = await api(apiBase, "POST", `/connectors/${instA2}/reconnect`, { token: tokenA });
    record("B10", "B", "PROOF", "control: well-formed but wrong credentials are rejected by the same check (the check is not vacuous)", "reconnect refused (4xx)", `${reconnectWrong.status}`, reconnectWrong.status >= 400 && reconnectWrong.status < 500);
    say();

    // ── PART C ─────────────────────────────────────────────────────────────────
    say("PART C  Negative boundary: nothing may be written under a tenant or installation other than the bound one");
    const unchanged = async (label, before) => {
      const after = await snapshot();
      return { ok: after === before, label };
    };
    // C1: tenant B into installation A (authenticated route)
    let before = await snapshot();
    const c1 = await api(apiBase, "POST", `/connectors/${instA}/oauth/callback`, { token: tokenB, body: { consumer_key: "ck_synthetic_c1_not_a_secret", consumer_secret: "cs_synthetic_c1_not_a_secret", user_id: "x", key_permissions: "read_write" } });
    record("C1", "C", "PROOF", "tenant B cannot ingest credentials into tenant A's installation", "denied (404/403) and no row changes", `${c1.status} ${String(c1.json?.message ?? c1.json?.error ?? "").slice(0, 80)}; rows ${(await unchanged("c1", before)).ok ? "unchanged" : "CHANGED"}`, [403, 404].includes(c1.status) && (await unchanged("c1", before)).ok);
    // C2: tenant hints in the body are ignored
    before = await snapshot();
    const c2 = await api(apiBase, "POST", `/connectors/${instA}/oauth/callback`, { token: tokenB, body: { consumer_key: "ck_synthetic_c2_not_a_secret", consumer_secret: "cs_synthetic_c2_not_a_secret", tenant_key: tenantA, tenantId: tenantA, installation_id: instA, installationId: instA } });
    record("C2", "C", "PROOF", "a forged tenant/installation in the request body does not redirect the write", "denied and no row changes", `${c2.status}; rows ${(await unchanged("c2", before)).ok ? "unchanged" : "CHANGED"}`, [400, 403, 404].includes(c2.status) && (await unchanged("c2", before)).ok);
    // C3: tenant A reading/overwriting B's installation by id
    before = await snapshot();
    const c3 = await api(apiBase, "POST", `/connectors/${instB}/oauth/callback`, { token: tokenA, body: { consumer_key: "ck_synthetic_c3_not_a_secret", consumer_secret: "cs_synthetic_c3_not_a_secret" } });
    const c3read = await api(apiBase, "GET", `/connectors/installed/${instB}`, { token: tokenA });
    record("C3", "C", "PROOF", "tenant A can neither overwrite nor read tenant B's installation", "write denied, read 404, no row changes", `write ${c3.status}, read ${c3read.status}; rows ${(await unchanged("c3", before)).ok ? "unchanged" : "CHANGED"}`, [403, 404].includes(c3.status) && c3read.status === 404 && (await unchanged("c3", before)).ok);
    // C4: unauthenticated
    before = await snapshot();
    const c4 = await api(apiBase, "POST", `/connectors/${instA}/oauth/callback`, { body: { consumer_key: "ck_synthetic_c4_not_a_secret", consumer_secret: "cs_synthetic_c4_not_a_secret" } });
    record("C4", "C", "PROOF", "an unauthenticated caller cannot ingest credentials", "401 and no row changes", `${c4.status}; rows ${(await unchanged("c4", before)).ok ? "unchanged" : "CHANGED"}`, c4.status === 401 && (await unchanged("c4", before)).ok);

    // C5: cross-tenant credential-id collision fails closed (fixture: a row id owned by another tenant)
    const collisionId = `${instB2}:consumer_key`;
    await prisma.$executeRawUnsafe(`UPDATE connector_credentials SET tenant_key = $1 WHERE id = $2`, tenantA, collisionId);
    before = await snapshot();
    const c5 = await api(apiBase, "POST", `/connectors/${instB2}/oauth/callback`, { token: tokenB, body: { consumer_key: "ck_synthetic_c5_not_a_secret", consumer_secret: "cs_synthetic_c5_not_a_secret" } });
    const plantedRow = (await credentialRows()).find((r) => r.id === collisionId);
    record("C5", "C", "PROOF", "a credential id already owned by another tenant is never overwritten (collision guard fails closed)", "request fails, planted row still tenant A and unchanged", `${c5.status}; planted row tenant=${plantedRow?.tenant_key}; rows ${(await unchanged("c5", before)).ok ? "unchanged" : "CHANGED"}`, c5.status >= 400 && plantedRow?.tenant_key === tenantA && (await unchanged("c5", before)).ok);
    say("         (C5 fixture: the colliding row was planted by direct SQL; the write attempt itself goes through the API)");

    // C6..: the public, signed-state route. SYNTHETIC values only: no real credential is ever placed in a URL.
    const stateLib = require(path.join(REPO_ROOT, "apps", "api", "dist", "connector-installer", "connector-oauth-state.js"));
    // Signed state tokens and their nonces are secrets too: register every one that is minted.
    const rawSign = stateLib.signConnectorOAuthState;
    stateLib.signConnectorOAuthState = (...args) => {
      const signed = rawSign(...args);
      register(signed.stateToken, signed.nonce);
      return signed;
    };
    const syntheticKey = "ck_SYNTHETIC_public_route_value_not_a_secret";
    const syntheticSecret = "cs_SYNTHETIC_public_route_value_not_a_secret";
    const plantNonce = async (installationId, nonce, expiresAt) => {
      const hash = crypto.createHash("sha256").update(nonce).digest("hex");
      await prisma.$executeRawUnsafe(
        `UPDATE connector_installations SET metadata = metadata || $1::jsonb WHERE id = $2`,
        JSON.stringify({ oauthNonceHash: hash, oauthNonceIssuedAt: Date.now(), oauthNonceExpiresAt: expiresAt }),
        installationId,
      );
    };
    const publicGet = async (state, installationId) =>
      api(apiBase, "GET", `/connectors/${installationId}/oauth/callback?${new URLSearchParams({ state, consumer_key: syntheticKey, consumer_secret: syntheticSecret })}`);
    const errorCode = (res) => new URL(res.location ?? "http://x/").searchParams.get("code");
    const refused = (res) => res.status === 302 && /status=oauth_error/.test(res.location ?? "");

    // positive control: a valid state binds the write to exactly its tenant/installation
    const good = stateLib.signConnectorOAuthState({ tenantKey: tenantA, installationId: instA2, connectorKey: "woocommerce" }, jwtSecret);
    await plantNonce(instA2, good.nonce, good.expiresAt);
    before = await snapshot();
    const rowsBefore = await credentialRows();
    const pos = await publicGet(good.stateToken, instA2);
    const rowsAfter = await credentialRows();
    const changedIds = rowsAfter.filter((r) => rowsBefore.find((b) => b.id === r.id)?.encrypted_hash !== r.encrypted_hash).map((r) => r.id).sort();
    record("C6", "C", "PROOF", "positive control: a valid signed state writes ONLY the bound tenant/installation's rows", `only ${instA2}:consumer_key/secret change, owned by ${tenantA}`, `${pos.status}; changed ${changedIds.map((id) => id.replace(instA2, "<A2>")).join(",")}`, pos.status === 302 && /status=oauth_complete/.test(pos.location ?? "") && JSON.stringify(changedIds) === JSON.stringify([`${instA2}:consumer_key`, `${instA2}:consumer_secret`].sort()) && rowsAfter.filter((r) => changedIds.includes(r.id)).every((r) => r.tenant_key === tenantA && r.installation_id === instA2));
    // replay
    before = await snapshot();
    const replay = await publicGet(good.stateToken, instA2);
    record("C7", "C", "PROOF", "a replayed signed state is refused", "oauth_error NONCE_NOT_FOUND, no row changes", `${replay.status} ${errorCode(replay)}; rows ${(await unchanged("c7", before)).ok ? "unchanged" : "CHANGED"}`, refused(replay) && errorCode(replay) === "NONCE_NOT_FOUND" && (await unchanged("c7", before)).ok);
    // forged signature
    const fresh = stateLib.signConnectorOAuthState({ tenantKey: tenantA, installationId: instA2, connectorKey: "woocommerce" }, jwtSecret);
    await plantNonce(instA2, fresh.nonce, fresh.expiresAt);
    before = await snapshot();
    const forgedToken = `${fresh.stateToken.split(".")[0]}.${Buffer.from(crypto.randomBytes(32)).toString("base64url")}`;
    register(forgedToken);
    const forged = await publicGet(forgedToken, instA2);
    record("C8", "C", "PROOF", "a forged state signature is refused", "oauth_error, no row changes", `${forged.status} ${errorCode(forged)}; rows ${(await unchanged("c8", before)).ok ? "unchanged" : "CHANGED"}`, refused(forged) && (await unchanged("c8", before)).ok);
    // tampered payload (re-targeted to tenant B with the original MAC)
    const [payloadB64, mac] = fresh.stateToken.split(".");
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    const tampered = `${Buffer.from(JSON.stringify({ ...payload, tenantKey: tenantB })).toString("base64url")}.${mac}`;
    register(tampered);
    before = await snapshot();
    const tamperedRes = await publicGet(tampered, instA2);
    record("C9", "C", "PROOF", "a state whose payload was re-targeted to another tenant is refused", "oauth_error, no row changes", `${tamperedRes.status} ${errorCode(tamperedRes)}; rows ${(await unchanged("c9", before)).ok ? "unchanged" : "CHANGED"}`, refused(tamperedRes) && (await unchanged("c9", before)).ok);
    // expired
    const realNow = Date.now;
    let expired;
    try {
      Date.now = () => realNow() - 60 * 60 * 1000;
      expired = stateLib.signConnectorOAuthState({ tenantKey: tenantA, installationId: instA2, connectorKey: "woocommerce" }, jwtSecret);
    } finally {
      Date.now = realNow;
    }
    await plantNonce(instA2, expired.nonce, Date.now() + 600000);
    before = await snapshot();
    const expiredRes = await publicGet(expired.stateToken, instA2);
    record("C10", "C", "PROOF", "an expired signed state is refused", "oauth_error, no row changes", `${expiredRes.status} ${errorCode(expiredRes)}; rows ${(await unchanged("c10", before)).ok ? "unchanged" : "CHANGED"}`, refused(expiredRes) && (await unchanged("c10", before)).ok);
    // cross-tenant: a correctly signed state for tenant B naming tenant A's installation
    const cross = stateLib.signConnectorOAuthState({ tenantKey: tenantB, installationId: instA2, connectorKey: "woocommerce" }, jwtSecret);
    await plantNonce(instA2, cross.nonce, cross.expiresAt);
    before = await snapshot();
    const crossRes = await publicGet(cross.stateToken, instA2);
    record("C11", "C", "PROOF", "a validly signed state for tenant B cannot write tenant A's installation", "refused, no row changes", `${crossRes.status} ${errorCode(crossRes)}; rows ${(await unchanged("c11", before)).ok ? "unchanged" : "CHANGED"}`, refused(crossRes) && (await unchanged("c11", before)).ok);
    // swapped: tenant A's state naming tenant B's installation
    const swapped = stateLib.signConnectorOAuthState({ tenantKey: tenantA, installationId: instB, connectorKey: "woocommerce" }, jwtSecret);
    await plantNonce(instB, swapped.nonce, swapped.expiresAt);
    before = await snapshot();
    const swappedRes = await publicGet(swapped.stateToken, instB);
    record("C12", "C", "PROOF", "a state for tenant A cannot write tenant B's installation", "refused, no row changes", `${swappedRes.status} ${errorCode(swappedRes)}; rows ${(await unchanged("c12", before)).ok ? "unchanged" : "CHANGED"}`, refused(swappedRes) && (await unchanged("c12", before)).ok);
    // connector mismatch
    const mismatch = stateLib.signConnectorOAuthState({ tenantKey: tenantA, installationId: instA2, connectorKey: "shopify" }, jwtSecret);
    await plantNonce(instA2, mismatch.nonce, mismatch.expiresAt);
    before = await snapshot();
    const mismatchRes = await publicGet(mismatch.stateToken, instA2);
    record("C13", "C", "PROOF", "a state minted for another connector cannot write a WooCommerce installation", "oauth_error CONNECTOR_MISMATCH, no row changes", `${mismatchRes.status} ${errorCode(mismatchRes)}; rows ${(await unchanged("c13", before)).ok ? "unchanged" : "CHANGED"}`, refused(mismatchRes) && errorCode(mismatchRes) === "CONNECTOR_MISMATCH" && (await unchanged("c13", before)).ok);
    say();

    // ── PART L ─────────────────────────────────────────────────────────────────
    say("PART L  Layer independence: the database boundary and the application boundary are each asserted on their own");
    if (rlsOn) {
      const restricted = new PrismaClient({ datasources: { db: { url: appUrl } } });
      const asTenant = (tenant, fn) =>
        restricted.$transaction(async (tx) => {
          await tx.$executeRawUnsafe("SELECT set_config('app.tenant_key', $1, true)", tenant);
          return fn(tx);
        });
      try {
        // Direct SQL as the restricted role: no application code is involved in any of these.
        const seeAasA = await asTenant(tenantA, (tx) => tx.$queryRawUnsafe("SELECT count(*)::int AS n FROM connector_credentials WHERE installation_id = $1", instA));
        const seeAasB = await asTenant(tenantB, (tx) => tx.$queryRawUnsafe("SELECT count(*)::int AS n FROM connector_credentials WHERE installation_id = $1", instA));
        const seeInstAasB = await asTenant(tenantB, (tx) => tx.$queryRawUnsafe("SELECT count(*)::int AS n FROM connector_installations WHERE id = $1", instA));
        record("L1", "L", "PROOF", "database layer alone: the restricted role sees tenant A's rows only under tenant A's context", "A sees its credentials; B sees 0 credentials and 0 installations of A", `A sees ${seeAasA[0].n}; B sees ${seeAasB[0].n} credentials, ${seeInstAasB[0].n} installations`, seeAasA[0].n > 0 && seeAasB[0].n === 0 && seeInstAasB[0].n === 0);
        before = await snapshot();
        const updated = await asTenant(tenantB, (tx) => tx.$executeRawUnsafe("UPDATE connector_credentials SET status = 'REVOKED' WHERE installation_id = $1", instA));
        record("L2", "L", "PROOF", "database layer alone: tenant B's context cannot update tenant A's credential rows", "0 rows updated, no row changes", `${updated} rows updated; rows ${(await unchanged("l2", before)).ok ? "unchanged" : "CHANGED"}`, updated === 0 && (await unchanged("l2", before)).ok);
        let insertError = "";
        try {
          await asTenant(tenantB, (tx) => tx.$executeRawUnsafe(
            "INSERT INTO connector_credentials (id, tenant_key, installation_id, credential_type, encrypted_value, key_version, status, metadata, updated_at) VALUES ($1, $2, $3, 'consumer_key', 'not-a-credential', 'v1', 'ACTIVE', '{}'::jsonb, NOW())",
            `${instA}:injected`, tenantA, instA,
          ));
        } catch (error) {
          insertError = String(error instanceof Error ? error.message : error);
        }
        const injected = (await credentialRows()).some((r) => r.id === `${instA}:injected`);
        record("L3", "L", "PROOF", "database layer alone: tenant B's context cannot insert a row owned by tenant A", "row-level security violation, no row created", `${/row-level security|violates/i.test(insertError) ? "RLS violation" : insertError.slice(0, 60) || "no error"}; row created: ${injected}`, /row-level security|violates/i.test(insertError) && !injected);
      } finally {
        await restricted.$disconnect();
      }
    } else {
      say("  NOTE         L1-L3  skipped: this run bypasses RLS on request (P1_PROOF_RLS=off)");
    }
    // The application layer on its own: the same API, running as the OWNER role so row-level security cannot help.
    apiProcOwner = startApi({ port: apiPort + 1, env: { ...baseApiEnv, DATABASE_URL: dbUrl, DATABASE_URL_POOLED: dbUrl } });
    const apiBaseOwner = `http://127.0.0.1:${apiPort + 1}/api/v1`;
    await waitForApi(apiBaseOwner, apiProcOwner.child, apiProcOwner.log);
    before = await snapshot();
    const ownerWrite = await api(apiBaseOwner, "POST", `/connectors/${instA}/oauth/callback`, { token: tokenB, body: { consumer_key: "ck_synthetic_l4_not_a_secret", consumer_secret: "cs_synthetic_l4_not_a_secret" } });
    const ownerRead = await api(apiBaseOwner, "GET", `/connectors/installed/${instA}`, { token: tokenB });
    record("L4", "L", "PROOF", "application layer alone (API running as the owner role, so RLS cannot help): tenant B is still denied", "write 403/404, read 404, no row changes", `write ${ownerWrite.status}, read ${ownerRead.status}; rows ${(await unchanged("l4", before)).ok ? "unchanged" : "CHANGED"}`, [403, 404].includes(ownerWrite.status) && ownerRead.status === 404 && (await unchanged("l4", before)).ok);
    apiProcOwner.child.kill();
    say();

    // ── PART D ─────────────────────────────────────────────────────────────────
    say("PART D  Product gap (expected findings): WooCommerce app-auth onboarding is not implemented end to end");
    const initiate = await api(apiBase, "POST", `/connectors/${instA}/oauth/initiate`, { token: tokenA });
    record("D1", "D", "GAP", "Vexa cannot generate a WooCommerce app-auth URL or valid state", "400 CONNECTOR_OAUTH_NOT_SUPPORTED", `${initiate.status} ${initiate.json?.error ?? ""}`, initiate.status === 400 && initiate.json?.error === "CONNECTOR_OAUTH_NOT_SUPPORTED");
    const nonceSideEffect = await prisma.$queryRawUnsafe(`SELECT (metadata ? 'oauthNonceHash') AS has_nonce FROM connector_installations WHERE id = $1`, instA);
    record("D2", "D", "GAP", "side effect: the failed initiate still persists an OAuth nonce hash on the installation", "nonce hash present although no state was returned", `has_nonce=${nonceSideEffect[0]?.has_nonce}`, nonceSideEffect[0]?.has_nonce === true);
    before = await snapshot();
    const wooShape = await api(apiBase, "POST", `/connectors/${instA}/oauth/callback`, { body: { key_id: 1, user_id: "x", consumer_key: "ck_synthetic_d3_not_a_secret", consumer_secret: "cs_synthetic_d3_not_a_secret", key_permissions: "read_write" } });
    record("D3", "D", "GAP", "no Vexa receiver accepts WooCommerce's actual callback (unauthenticated JSON POST)", "401, nothing written", `${wooShape.status}; rows ${(await unchanged("d3", before)).ok ? "unchanged" : "CHANGED"}`, wooShape.status === 401 && (await unchanged("d3", before)).ok);
    const sources = [];
    for (const root of ["apps/api/src", "apps/web/src"]) {
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(spec|test)\./.test(entry.name)) sources.push({ file: path.relative(REPO_ROOT, full).replace(/\\/g, "/"), text: fs.readFileSync(full, "utf8") });
        }
      };
      walk(path.join(REPO_ROOT, root));
    }
    const wcAuthCode = findWcAuthCode(sources);
    record("D4", "D", "GAP", "no API or web code builds or handles a /wc-auth URL (the web UI cannot initiate WooCommerce app-auth)", "0 code references", `${wcAuthCode.length} code references${wcAuthCode.length ? `: ${wcAuthCode.slice(0, 3).join(", ")}` : ""}`, wcAuthCode.length === 0);
    const qs = pos.location ?? "";
    record("D5", "D", "GAP", "BUG-WOO-OAUTH-QUERY-SECRET: the public callback accepted credential material from the URL query string (synthetic values used)", "route accepted query-string credentials", `${pos.status} ${/status=oauth_complete/.test(qs) ? "accepted" : "refused"}; real WooCommerce posts JSON in the body`, pos.status === 302 && /status=oauth_complete/.test(qs));
    say();

    // ── finish ─────────────────────────────────────────────────────────────────
    // Evidence summary, with the two isolation layers kept separate. Derived only from the checks above.
    const verdict = (ids, pass = "PASS") => {
      const found = ids.map((id) => results.find((r) => r.id === id));
      if (found.some((r) => !r)) return "NOT RUN";
      return found.every((r) => r.status === "PASS" || r.status === "GAP-CONFIRMED") ? pass : "FAIL";
    };
    const row = (label, value, ids) => say(`  ${label.padEnd(56, ".")} ${value.padEnd(16)} (${ids.join(", ")})`);
    say("EVIDENCE SUMMARY");
    row("PROVIDER ISSUANCE (real WooCommerce app-auth)", verdict(["A1", "A2", "A3", "A4", "A5", "A6"]), ["A1-A6"]);
    row("VEXA AUTHENTICATED CREDENTIAL INGESTION", verdict(["B1", "B2", "B3", "B4", "B5", "B6", "B8", "B9", "B10"]), ["B1-B6", "B8-B10"]);
    row("CREDENTIALS ENCRYPTED AT REST", verdict(["B7"]), ["B7"]);
    say("  Tenant isolation, one layer at a time:");
    row("    APPLICATION LAYER  (tenant-scoped API, RLS not helping)", verdict(["L4"]), ["L4"]);
    row("    DATABASE LAYER     (restricted role + RLS, no app code)", rlsOn ? verdict(["R1", "L1", "L2", "L3"]) : "SKIPPED (RLS off)", ["R1", "L1-L3"]);
    row("    COMBINED           cross-tenant credential access", verdict(["C1", "C2", "C3", "C4", "C5"], "DENIED"), ["C1-C5"]);
    row("SIGNED STATE: binding, replay, expiry, forgery", verdict(["C6", "C7", "C8", "C9", "C10", "C11", "C12", "C13"]), ["C6-C13"]);
    row("REAL WOO -> VEXA APP-AUTH CALLBACK", verdict(["D3"], "NOT IMPLEMENTED"), ["D3"]);
    row("VEXA GENERATES WOO APP-AUTH URL / VALID STATE", verdict(["D1"], "NOT IMPLEMENTED"), ["D1"]);
    row("WEB UI CAN INITIATE WOO APP-AUTH", verdict(["D4"], "NOT IMPLEMENTED"), ["D4"]);
    row("PUBLIC CALLBACK ACCEPTS SECRETS IN THE QUERY STRING", verdict(["D5"], "FINDING"), ["D5"]);
    say("  PRODUCTION WOO ONBOARDING ............................... NOT VERIFIED    (no supported onboarding flow exists to verify)");
    say();
    const leaks = findLeaks(transcript.join("\n"), secrets);
    record("Z1", "Z", "PROOF", "no secret value appears anywhere in this output", "0 leaks", `${leaks.length} leaks`, leaks.length === 0);
    const proofFailures = results.filter((r) => r.kind === "PROOF" && r.status !== "PASS");
    const gapChanges = results.filter((r) => r.kind === "GAP" && r.status !== "GAP-CONFIRMED");
    say();
    say(`PROOF checks: ${results.filter((r) => r.kind === "PROOF").length - proofFailures.length}/${results.filter((r) => r.kind === "PROOF").length} passed`);
    say(`GAP checks  : ${results.filter((r) => r.kind === "GAP").length - gapChanges.length}/${results.filter((r) => r.kind === "GAP").length} confirmed as expected`);
    say(proofFailures.length === 0 && gapChanges.length === 0 ? "RESULT: PASS" : "RESULT: FAIL");

    const evidence = { meta: { ...meta, finishedAt: new Date().toISOString() }, results, redactedRows: printable(await credentialRows()), callbackShape: first.callback };
    const serialized = JSON.stringify(evidence, null, 2);
    if (findLeaks(serialized, secrets).length) throw new Error("secret detected in the evidence file; refusing to write it");
    if (outPath) {
      fs.writeFileSync(outPath, serialized + "\n");
      say(`evidence written to ${outPath}`);
    }
    await cleanup();
    process.exit(proofFailures.length === 0 && gapChanges.length === 0 ? 0 : 1);
  } catch (error) {
    console.error(`\nPROOF RUN ERROR: ${error instanceof Error ? error.message : String(error)}`);
    await cleanup();
    process.exit(2);
  }
}

module.exports = { redactSecret, describeCallbackBody, fingerprintRows, findLeaks, findWcAuthCode, expandSecretVariants };

if (require.main === module) {
  main();
}
