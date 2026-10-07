#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 7.9b: a real restore test. A backup that sits in R2 and has never been restored is not a backup.
 *
 * It takes the NEWEST backup written by scripts/r2-backup-run.cjs (plain SQL, gzipped), restores it with the runbook's own procedure
 * (`gunzip | psql`, docs/runbooks/backup-restore.md section 5) into a throwaway local database, and checks what came back. It never
 * touches a production database: the target is RESTORE_TEST_DATABASE_URL, which must be a local host with no tables in `public`, and this
 * script reads no other database variable at all. Output is counts and verdicts only. A restore error is reported as its SQLSTATE code
 * and never its message (a message can contain a row value), and no URL, user or password is ever printed.
 *
 * Required env: RESTORE_TEST_DATABASE_URL (local, empty), R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * R2_PRIVATE_BUCKET_NAME (falls back to R2_BUCKET_NAME). Optional: R2_BACKUP_PREFIX (as for the backup), RESTORE_TEST_MAX_AGE_HOURS (36).
 */
const { spawn } = require("node:child_process");
const { Transform } = require("node:stream");
const { createGunzip } = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];
const DEFAULT_MAX_AGE_HOURS = 36;
/** A table created by a migration after the backup was taken is expected to be missing; a quarter of the schema missing is a truncated restore. */
const MAX_MISSING_FRACTION = 0.1;
const MIN_RLS_TABLES = 50;
const MIN_CONNECTOR_DEFINITIONS = 10;
const TRAILER = "PostgreSQL database dump complete";
const COUNTED_TABLES = ["Product", "WorkspaceDirectory", "ai_platform_controls", "connector_definitions"];

/** Newest object by LastModified, or null. */
function pickNewest(objects) {
  const valid = (objects || []).filter((o) => o && o.key && o.lastModified && !Number.isNaN(new Date(o.lastModified).getTime()) && Number(o.size ?? 1) > 0);
  if (valid.length === 0) {
    return null;
  }
  return valid.slice().sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified))[0];
}

function ageHours(lastModified, now = new Date()) {
  return (now.getTime() - new Date(lastModified).getTime()) / 3_600_000;
}

/** The restore target must be a local host. Throws otherwise; never echoes the URL. */
function assertLocalTarget(url) {
  let host;
  try {
    host = new URL(String(url)).hostname;
  } catch {
    throw new Error("RESTORE_TEST_DATABASE_URL is not a valid database URL");
  }
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error("RESTORE_TEST_DATABASE_URL must be a local database: the restore test never restores into a remote host");
  }
}

function countExpr(table) {
  // query_to_xml runs only when its CASE branch is taken, so a table that is missing from a partial restore yields NULL instead of an error.
  return `CASE WHEN to_regclass('public."${table}"') IS NULL THEN NULL ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM public."${table}"', false, true, '')))[1]::text::bigint END`;
}

/** One read-only statement; the result is one JSON document of counts and names, never row values. */
const FACTS_SQL = [
  "SELECT json_build_object(",
  "'tables', (SELECT coalesce(json_agg(c.relname ORDER BY c.relname), '[]'::json) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p')),",
  "'migrations', CASE WHEN to_regclass('public._prisma_migrations') IS NULL THEN NULL ELSE json_build_object(",
  "'count', (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM public._prisma_migrations', false, true, '')))[1]::text::bigint,",
  "'unfinished', (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM public._prisma_migrations WHERE finished_at IS NULL', false, true, '')))[1]::text::bigint) END,",
  `'counts', json_build_object(${COUNTED_TABLES.map((t) => `'${t}', ${countExpr(t)}`).join(", ")}),`,
  "'rlsTables', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relrowsecurity),",
  "'policies', (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')",
  ")::text AS facts",
].join(" ");

/**
 * Pure verdicts. `facts` is the parsed FACTS_SQL document, `ctx` is { restoreExit, trailerSeen, ageHours, maxAgeHours }, `manifest` is the
 * grants manifest (packages/db/identity/identity-model.v1.json), used only as the list of tables the schema is expected to have.
 */
function evaluateRestore(facts, ctx, manifest) {
  const findings = [];
  const add = (check, ok, detail) => findings.push({ check, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) });
  const expected = new Set([...Object.keys(manifest.runtime.tables), ...(manifest.runtime.excluded || [])]);
  const restored = new Set((facts && facts.tables) || []);
  const maxAge = Number.isFinite(ctx.maxAgeHours) ? ctx.maxAgeHours : DEFAULT_MAX_AGE_HOURS;

  add(`the newest backup is recent (at most ${maxAge} hours old)`, Number.isFinite(ctx.ageHours) && ctx.ageHours <= maxAge, Number.isFinite(ctx.ageHours) ? { ageHours: Math.round(ctx.ageHours * 10) / 10 } : undefined);
  add("the dump stream ended with pg_dump's completion trailer (it was not truncated)", ctx.trailerSeen === true);
  add("psql restored the whole dump without an error (single transaction, stop on first error)", ctx.restoreExit === 0, ctx.restoreExit === 0 ? undefined : { exit: ctx.restoreExit });

  const unknown = [...restored].filter((t) => !expected.has(t));
  add("every restored table is classified in the grants manifest (an unknown table means the manifest or the backup has drifted)", unknown.length === 0, unknown.length ? unknown.slice(0, 5) : undefined);
  const missing = [...expected].filter((t) => !restored.has(t));
  const allowed = Math.floor(expected.size * MAX_MISSING_FRACTION);
  add(`at most ${Math.round(MAX_MISSING_FRACTION * 100)}% of the manifest's tables are missing from the backup (a table added after the backup is expected; a truncated schema is not)`, missing.length <= allowed, missing.length ? { missing: missing.length, allowed, sample: missing.slice(0, 5) } : undefined);

  const mig = facts && facts.migrations;
  add("the migrations table was restored, is not empty, and no migration is unfinished", Boolean(mig) && Number(mig.count) > 0 && Number(mig.unfinished) === 0, mig ? { count: Number(mig.count), unfinished: Number(mig.unfinished) } : { restored: false });
  const counts = (facts && facts.counts) || {};
  add("the platform control row, written by a migration, was restored exactly once", Number(counts.ai_platform_controls) === 1, { rows: counts.ai_platform_controls ?? null });
  add(`the connector definitions seeded by migrations were restored (at least ${MIN_CONNECTOR_DEFINITIONS})`, Number(counts.connector_definitions) >= MIN_CONNECTOR_DEFINITIONS, { rows: counts.connector_definitions ?? null });
  add(`row level security came back: at least ${MIN_RLS_TABLES} tables have it enabled and policies exist`, Number(facts && facts.rlsTables) >= MIN_RLS_TABLES && Number(facts && facts.policies) > 0, { rlsTables: Number(facts && facts.rlsTables), policies: Number(facts && facts.policies) });
  return findings;
}

/** Keeps the last few KB of what passes through, so the completion trailer can be found without holding the dump in memory. */
function tailTracker(limit = 8192) {
  let tail = "";
  const transform = new Transform({
    transform(chunk, _enc, cb) {
      tail = (tail + chunk.toString("utf8")).slice(-limit);
      cb(null, chunk);
    },
  });
  transform.trailerSeen = () => tail.includes(TRAILER);
  return transform;
}

/**
 * Streams gzipped plain SQL through gunzip into psql, the runbook's procedure. Resolves { exit, trailerSeen, sqlstate }. Only the SQLSTATE
 * of a failure is kept (VERBOSITY=sqlstate), never a message, and nothing about the URL.
 */
function restoreFromStream(gzipped, databaseUrl, { psqlBin = "psql", psqlPrefixArgs = [] } = {}) {
  return new Promise((resolve, reject) => {
    const psql = spawn(psqlBin, [...psqlPrefixArgs, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate", "--single-transaction", "-d", databaseUrl], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    const gunzip = createGunzip();
    const tracker = tailTracker();
    let stderr = "";
    psql.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    psql.on("error", (e) => reject(new Error(`psql failed to start: ${e.message}`)));
    psql.stdin.on("error", () => undefined); // psql may exit early on the first error; the exit code is what matters
    gunzip.on("error", (e) => reject(new Error(`the backup is not valid gzip: ${e.code || "gunzip error"}`)));
    gzipped.on("error", (e) => reject(new Error(`reading the backup failed: ${e.name || "stream error"}`)));
    psql.on("close", (code) => {
      const codes = (stderr.match(/\b[0-9A-Z]{5}\b/g) || []).filter((c) => /^[0-9]/.test(c));
      resolve({ exit: code, trailerSeen: tracker.trailerSeen(), sqlstate: codes.length ? codes[codes.length - 1] : null });
    });
    gzipped.pipe(gunzip).pipe(tracker).pipe(psql.stdin);
  });
}

function psqlQuery(databaseUrl, sql, { psqlBin = "psql" } = {}) {
  return new Promise((resolve, reject) => {
    const psql = spawn(psqlBin, ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate", "-c", sql, "-d", databaseUrl], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    psql.stdout.on("data", (c) => (out += c.toString()));
    psql.stderr.on("data", (c) => (err = (err + c.toString()).slice(-500)));
    psql.on("error", (e) => reject(new Error(`psql failed to start: ${e.message}`)));
    psql.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`psql query failed (exit ${code}, ${(err.match(/\b[0-9][0-9A-Z]{4}\b/) || ["no sqlstate"])[0]})`))));
  });
}

function requireEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function listAll(client, ListObjectsV2Command, bucket, prefix) {
  const objects = [];
  let token;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of page.Contents || []) {
      objects.push({ key: o.Key, lastModified: o.LastModified, size: o.Size });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

function printReport(findings, facts) {
  for (const f of findings) {
    console.log(`${f.ok ? "PASS" : "FAIL"} ${f.check}${f.detail === undefined ? "" : `  ${JSON.stringify(f.detail)}`}`);
  }
  const counts = (facts && facts.counts) || {};
  console.log(`counts (reported, not asserted): ${COUNTED_TABLES.map((t) => `${t}=${counts[t] ?? "absent"}`).join(", ")}; tables=${((facts && facts.tables) || []).length}; policies=${facts && facts.policies}`);
}

async function main() {
  const { S3Client, GetObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");
  const target = requireEnv("RESTORE_TEST_DATABASE_URL");
  assertLocalTarget(target);
  const bucket = String(process.env.R2_PRIVATE_BUCKET_NAME ?? process.env.R2_BUCKET_NAME ?? "").trim();
  if (!bucket) {
    throw new Error("Missing required environment variable: R2_PRIVATE_BUCKET_NAME (or R2_BUCKET_NAME)");
  }
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: requireEnv("R2_ACCESS_KEY_ID"), secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY") },
  });
  const maxAgeHours = Number(process.env.RESTORE_TEST_MAX_AGE_HOURS ?? DEFAULT_MAX_AGE_HOURS) || DEFAULT_MAX_AGE_HOURS;

  const present = await psqlQuery(target, "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'");
  if (present !== "0") {
    throw new Error(`the restore target already has ${present} table(s) in public: it must be an empty throwaway database`);
  }

  const { resolveBackupPrefix } = require("./r2-backup-run.cjs");
  const prefix = resolveBackupPrefix();
  const newest = pickNewest(await listAll(client, ListObjectsV2Command, bucket, prefix));
  if (!newest) {
    throw new Error(`no backup object under ${prefix}: there is nothing to restore`);
  }
  const age = ageHours(newest.lastModified);
  console.log(`[restore-test] newest backup: ${newest.key} (${newest.size} bytes, ${Math.round(age * 10) / 10} hours old)`);

  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: newest.key }));
  const restored = await restoreFromStream(object.Body, target);
  console.log(`[restore-test] psql exit ${restored.exit}${restored.sqlstate ? `, SQLSTATE ${restored.sqlstate}` : ""}`);

  let facts = null;
  if (restored.exit === 0) {
    facts = JSON.parse(await psqlQuery(target, FACTS_SQL));
  }
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "packages", "db", "identity", "identity-model.v1.json"), "utf8"));
  const findings = evaluateRestore(facts, { restoreExit: restored.exit, trailerSeen: restored.trailerSeen, ageHours: age, maxAgeHours }, manifest);
  printReport(findings, facts);
  const failed = findings.filter((f) => !f.ok);
  console.log(failed.length === 0 ? `\nRESTORE TEST PASSED: ${findings.length}/${findings.length} checks` : `\nRESTORE TEST FAILED: ${findings.length - failed.length}/${findings.length} checks passed`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[restore-test] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  pickNewest,
  ageHours,
  assertLocalTarget,
  evaluateRestore,
  restoreFromStream,
  tailTracker,
  FACTS_SQL,
  DEFAULT_MAX_AGE_HOURS,
  MAX_MISSING_FRACTION,
  MIN_RLS_TABLES,
  MIN_CONNECTOR_DEFINITIONS,
  TRAILER,
};
