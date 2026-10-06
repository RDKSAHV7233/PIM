#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * SEC-DB-RLS-001 read-only production probe.
 *
 *   node scripts/sec-db-rls-001-probe.cjs database            roles and their flags, memberships, database and schema privileges,
 *                                                             ownership, RLS (per table and every policy expression), relation /
 *                                                             function / enum ACLs, default privileges, who is connected (counts),
 *                                                             what the CONNECTED role can do, derived findings, migration state
 *   node scripts/sec-db-rls-001-probe.cjs service-identity    what database user and host kind the named env vars resolve to
 *
 * Output is role names, object names, ACLs, policy expressions, counts and booleans ONLY. No DSN, password, token, row payload or
 * customer data is ever printed: every line passes a guard that refuses to print a URL or any secret taken from the connection
 * string. The `database` mode runs entirely inside a READ ONLY transaction (the database itself rejects any write), with a
 * statement and lock timeout, and never reads `pg_authid`, so password hashes are never touched. It changes no grant, owner, role,
 * RLS setting or connection. Every statement it can send is listed in sec-db-rls-001-probe-lib.cjs and pinned by
 * sec-db-rls-001-probe.test.cjs (SELECT only; no write or DDL keyword; no secret-bearing catalog).
 *
 * Connection source is explicit, never guessed:
 *   PROBE_DATABASE_URL        a full URL, or
 *   PROBE_DATABASE_URL_FROM   the NAME of one env var to read it from:
 *                             DATABASE_URL_DIRECT | DATABASE_URL | DATABASE_URL_POOLED | OBSERVABILITY_DATABASE_URL
 *   PROBE_ENV_VARS            (service-identity) comma-separated env var NAMES from the same list
 *   PROBE_OUT                 optional path for the JSON evidence
 *
 * The probe reports what the CONNECTED role can see and do. Run it as the deployed runtime role to see production as the
 * application sees it. Run it again as a candidate role (vexa_runtime, vexa_backup, vexa_reporter) to certify that role: the
 * "effective privileges of the connected role" and "derived findings" sections are written for that comparison. Run it once per
 * database (the main database and, separately, the observability database).
 *
 * `@prisma/client` is used for raw read-only queries only. Run it from the repo root after `npm ci`/`prisma generate`, or point
 * NODE_PATH at a node_modules that has `@prisma/client`.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const lib = require("./sec-db-rls-001-probe-lib.cjs");

const ALLOWED = ["DATABASE_URL_DIRECT", "DATABASE_URL", "DATABASE_URL_POOLED", "OBSERVABILITY_DATABASE_URL"];
const mode = process.argv[2];
if (!["database", "service-identity"].includes(mode)) {
  console.error("usage: node scripts/sec-db-rls-001-probe.cjs database | service-identity");
  process.exit(2);
}

const secrets = new Set();
const guard = lib.makeLineGuard(secrets);
const evidence = { probe: "SEC-DB-RLS-001", mode, probeVersion: 2, startedAt: new Date().toISOString(), sections: {} };

function remember(urlText) {
  try {
    const u = new URL(urlText);
    for (const part of [u.password, decodeURIComponent(u.password)]) {
      if (part && part.length >= 4) {
        secrets.add(part);
      }
    }
  } catch {
    /* not a URL */
  }
}

/** Every printed line passes through the guard. A URL or a remembered secret aborts the run rather than being printed. */
function emit(text) {
  console.log(guard(text));
}

const json = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
const hostKind = (host) => (/\.railway\.internal$/i.test(host) ? "private-network" : /\.proxy\.rlwy\.net$/i.test(host) ? "public-proxy" : /^(localhost|127\.0\.0\.1|::1)$/.test(host) ? "local" : "other");
const fingerprint = (host, port) => crypto.createHash("sha256").update(`${host}:${port}`).digest("hex").slice(0, 12);

function resolveUrl() {
  let url = String(process.env.PROBE_DATABASE_URL || "").trim();
  if (!url && process.env.PROBE_DATABASE_URL_FROM) {
    const name = String(process.env.PROBE_DATABASE_URL_FROM).trim();
    if (!ALLOWED.includes(name)) {
      console.error(`PROBE_DATABASE_URL_FROM must be one of ${ALLOWED.join(", ")}.`);
      process.exit(2);
    }
    url = String(process.env[name] || "").trim();
  }
  if (!url) {
    console.error("a database URL is required (PROBE_DATABASE_URL or PROBE_DATABASE_URL_FROM): the target is never guessed.");
    process.exit(2);
  }
  remember(url);
  return url;
}

function section(name, rows) {
  evidence.sections[name] = rows;
  emit(`\n## ${name}`);
  if (Array.isArray(rows)) {
    if (rows.length === 0) {
      emit("(none)");
    }
    for (const r of rows) {
      emit(typeof r === "string" ? r : json(r));
    }
  } else {
    emit(json(rows));
  }
}

async function serviceIdentity() {
  const names = String(process.env.PROBE_ENV_VARS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (names.length === 0 || names.some((n) => !ALLOWED.includes(n))) {
    console.error(`PROBE_ENV_VARS must list one or more of ${ALLOWED.join(", ")}.`);
    process.exit(2);
  }
  const rows = [];
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (!value) {
      rows.push({ variable: name, present: false });
      continue;
    }
    remember(value);
    try {
      const u = new URL(value);
      rows.push({
        variable: name,
        present: true,
        databaseUser: decodeURIComponent(u.username),
        database: u.pathname.replace(/^\//, ""),
        hostKind: hostKind(u.hostname),
        hostFingerprint: fingerprint(u.hostname, u.port),
        sslModeParameterPresent: u.searchParams.has("sslmode"),
      });
    } catch {
      rows.push({ variable: name, present: true, parseable: false });
    }
  }
  section("service database identity (names, host kind, fingerprint only)", rows);
}

async function databaseProbe() {
  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: resolveUrl() } } });
  try {
    await db.$transaction(
      async (tx) => {
        for (const statement of lib.SESSION_STATEMENTS) {
          await tx.$executeRawUnsafe(statement);
        }
        const q = (sql) => tx.$queryRawUnsafe(sql);

        const exec = (sql) => tx.$executeRawUnsafe(sql);
        await lib.runSections({ queries: lib.QUERIES, exec, query: q, section });

        // The migrations table is read only when it exists, under its own savepoint: a runtime role is deliberately NOT allowed
        // to read it, so "permission denied" here is an expected finding for that role and must not abort the probe.
        const [mig] = await q(lib.MIGRATIONS_PRESENCE_SQL);
        if (mig.table_present) {
          await lib.runSections({ queries: [{ section: "migration state", shape: "one", sql: lib.MIGRATIONS_STATE_SQL }], exec, query: q, section });
        } else {
          section("migration state", { table_present: false });
        }

        section("derived findings (computed from the sections above; booleans, counts and names)", lib.deriveFindings(evidence.sections));
      },
      { timeout: 60000, maxWait: 10000 },
    );
    evidence.result = "COMPLETE";
  } finally {
    await db.$disconnect().catch(() => undefined);
  }
}

(async () => {
  let code = 0;
  try {
    if (mode === "service-identity") {
      await serviceIdentity();
      evidence.result = "COMPLETE";
    } else {
      await databaseProbe();
    }
  } catch (error) {
    code = 1;
    evidence.result = "FAILED";
    evidence.error = error instanceof Error ? `${error.name}: ${String(error.message).split("\n")[0]}`.slice(0, 200) : "unknown error";
    emit(`\nPROBE FAILED: ${evidence.error}`);
  }
  evidence.finishedAt = new Date().toISOString();
  emit(`\nRESULT: ${evidence.result}`);
  if (process.env.PROBE_OUT) {
    try {
      fs.writeFileSync(process.env.PROBE_OUT, `${json(evidence)}\n`);
    } catch {
      emit("evidence file could not be written");
    }
  }
  process.exit(code);
})();
