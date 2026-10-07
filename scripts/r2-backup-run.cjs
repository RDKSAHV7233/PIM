#!/usr/bin/env node
/* eslint-disable no-console */

"use strict";

// Daily Postgres -> R2 backup. Implements docs/runbooks/backup-restore.md section 2-3.
//
// Flow: pg_dump (plain SQL, matching the runbook's `gunzip | psql` restore path) -> gzip -> upload to R2 under backups/ ->
// verify the uploaded object is non-zero via HeadObject -> prune backups older
// than the retention window, keeping a safety floor so a clock/logic bug can
// never delete every backup in one run.
//
// Required env: DATABASE_URL_DIRECT, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY, R2_PRIVATE_BUCKET_NAME (falls back to R2_BUCKET_NAME).
//
// Optional env: R2_BACKUP_PREFIX — overrides the object-key prefix so this same
// script can back up a second database (e.g. Postgres-MSwk) into its own
// independently-listable/prunable namespace within the same bucket, without
// touching the primary daily job's behavior (#919 gate F). Unset preserves the
// exact prior "backups/" prefix.

const { spawn } = require("node:child_process");
const { createGzip } = require("node:zlib");
const { createWriteStream, createReadStream, statSync, unlinkSync } = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const RETENTION_DAYS = 30;
const MIN_BACKUPS_TO_KEEP = 7;

function resolveBackupPrefix() {
  const raw = String(process.env.R2_BACKUP_PREFIX ?? "").trim();
  if (!raw) {
    return "backups/";
  }
  return raw.endsWith("/") ? raw : `${raw}/`;
}

const BACKUP_PREFIX = resolveBackupPrefix();

function requireEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function backupKey(date = new Date()) {
  const iso = date.toISOString(); // e.g. 2026-08-27T02:00:00.000Z
  const stamp = iso.replace(/[:.]/g, "-").replace("Z", "Z");
  return `${BACKUP_PREFIX}${stamp}.sql.gz`;
}

/**
 * Pure filter: given a list of {key, lastModified} objects and "now", return
 * the keys that are safe to delete under the retention policy.
 * Never returns enough keys to drop the total below MIN_BACKUPS_TO_KEEP.
 */
function selectKeysToPrune(objects, now = new Date(), retentionDays = RETENTION_DAYS, minKeep = MIN_BACKUPS_TO_KEEP) {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const sorted = objects.slice().sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
  const eligible = sorted.filter((o) => new Date(o.lastModified).getTime() < cutoff);
  const keepCount = Math.max(0, minKeep - (sorted.length - eligible.length));
  // `eligible` is sorted newest-first. Keep the newest `keepCount` of them
  // (closest point-in-time recovery) and prune the rest — the oldest ones.
  const toPrune = eligible.slice(keepCount);
  return toPrune.map((o) => o.key);
}

/**
 * SEC-DB-RLS-001 7.9b: when the workflow gives this job the dedicated backup credential it also sets BACKUP_EXPECT_ROLE=vexa_backup,
 * and the dump does not start unless the connection really is that role: not a superuser, and with BYPASSRLS (the tables are forced
 * row level security, so a role without it is refused by pg_dump or sees only one tenant). A wrong credential therefore fails the backup
 * job, and the existing failure alert fires, instead of producing a backup nobody has checked. Unset = no check = exactly the old
 * behaviour. The statement is exported so the rehearsal runs this very text against the real roles.
 */
const BACKUP_IDENTITY_SQL =
  "SELECT current_user AS name, r.rolsuper AS super, r.rolbypassrls AS bypassrls FROM pg_roles r WHERE r.rolname = current_user";

/** psql -At -F'|' prints `name|t|f`; the same shape, parsed. */
function parseBackupIdentity(line) {
  const parts = String(line ?? "").trim().split("|");
  if (parts.length !== 3 || !parts[0]) {
    return null;
  }
  return { name: parts[0], super: parts[1] === "t", bypassrls: parts[2] === "t" };
}

/** Pure verdict: { ok, skipped?, reason? }. `row` is { name, super, bypassrls } or null when it could not be read. */
function evaluateBackupIdentity(row, expectedRole) {
  const expected = String(expectedRole ?? "").trim();
  if (!expected) {
    return { ok: true, skipped: true };
  }
  if (!row) {
    return { ok: false, reason: "could not read the connected role, so the backup identity cannot be verified" };
  }
  if (row.name !== expected) {
    return { ok: false, reason: `connected as ${row.name}, expected ${expected}` };
  }
  if (row.super) {
    return { ok: false, reason: `${row.name} is a superuser; the backup identity must not be` };
  }
  if (!row.bypassrls) {
    return { ok: false, reason: `${row.name} does not bypass row level security, so the dump would be refused or partial` };
  }
  return { ok: true };
}

function readBackupIdentity(databaseUrl) {
  return new Promise((resolve, reject) => {
    const psql = spawn("psql", ["-X", "-A", "-t", "-F", "|", "-c", BACKUP_IDENTITY_SQL, databaseUrl], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    psql.stdout.on("data", (chunk) => (out += chunk.toString()));
    psql.stderr.on("data", (chunk) => (err += chunk.toString()));
    psql.on("error", (e) => reject(new Error(`psql failed to start: ${e.message}`)));
    psql.on("close", (code) => {
      if (code !== 0) {
        // The message is psql's own diagnostic; it does not contain the connection string.
        reject(new Error(`could not read the backup identity (psql exit ${code}): ${err.trim().split("\n")[0].slice(0, 200)}`));
        return;
      }
      resolve(parseBackupIdentity(out));
    });
  });
}

async function pgDumpGzipToFile(databaseUrl, outFile) {
  await new Promise((resolve, reject) => {
    const dump = spawn("pg_dump", ["--format=plain", "--no-owner", "--no-privileges", databaseUrl], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const gzip = createGzip();
    const out = createWriteStream(outFile);
    let stderr = "";
    dump.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    dump.stdout.pipe(gzip).pipe(out);
    out.on("finish", resolve);
    out.on("error", reject);
    dump.on("error", (err) => reject(new Error(`pg_dump failed to start: ${err.message}`)));
    dump.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`pg_dump exited with code ${code}: ${stderr.slice(0, 2000)}`));
      }
    });
  });
}

async function run() {
  const { S3Client, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require("@aws-sdk/client-s3");

  const databaseUrl = requireEnv("DATABASE_URL_DIRECT");
  const accountId = requireEnv("R2_ACCOUNT_ID");
  const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");
  const bucket = String(process.env.R2_PRIVATE_BUCKET_NAME ?? process.env.R2_BUCKET_NAME ?? "").trim();
  if (!bucket) {
    throw new Error("Missing required environment variable: R2_PRIVATE_BUCKET_NAME (or R2_BUCKET_NAME)");
  }

  const expectedRole = String(process.env.BACKUP_EXPECT_ROLE ?? "").trim();
  if (expectedRole) {
    const identity = await readBackupIdentity(databaseUrl);
    const verdict = evaluateBackupIdentity(identity, expectedRole);
    if (!verdict.ok) {
      throw new Error(`backup identity check failed: ${verdict.reason}`);
    }
    console.log(`[r2-backup] connected as ${identity.name}: read-only backup identity verified (not a superuser, bypasses RLS)`);
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const key = backupKey();
  const localFile = path.join(os.tmpdir(), `pim1-backup-${Date.now()}.sql.gz`);

  console.log(`[r2-backup] dumping database to ${localFile} ...`);
  await pgDumpGzipToFile(databaseUrl, localFile);

  const sizeBytes = statSync(localFile).size;
  if (sizeBytes === 0) {
    throw new Error("pg_dump produced a zero-byte file — refusing to upload an empty backup");
  }
  console.log(`[r2-backup] dump complete: ${sizeBytes} bytes`);

  console.log(`[r2-backup] uploading to r2://${bucket}/${key} ...`);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(localFile),
      ContentLength: sizeBytes,
      ContentType: "application/gzip",
    }),
  );

  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  if (!head.ContentLength || head.ContentLength <= 0) {
    throw new Error(`Uploaded backup ${key} is zero-byte or missing — backup verification FAILED`);
  }
  console.log(`[r2-backup] verified: ${key} is ${head.ContentLength} bytes in R2`);

  unlinkSync(localFile);

  console.log("[r2-backup] applying retention policy ...");
  const listed = [];
  let ContinuationToken;
  do {
    const resp = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: BACKUP_PREFIX, ContinuationToken }));
    for (const obj of resp.Contents || []) {
      listed.push({ key: obj.Key, lastModified: obj.LastModified });
    }
    ContinuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (ContinuationToken);

  const toPrune = selectKeysToPrune(listed, new Date());
  for (const pruneKey of toPrune) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: pruneKey }));
    console.log(`[r2-backup] pruned ${pruneKey} (older than ${RETENTION_DAYS}d, floor of ${MIN_BACKUPS_TO_KEEP} preserved)`);
  }

  // `listed` was fetched after this run's upload, so it already includes the new
  // backup — no +1 needed here (a prior version double-counted it).
  console.log(
    `[r2-backup] done. total backups: ${listed.length - toPrune.length}, pruned this run: ${toPrune.length}`,
  );
}

async function main() {
  try {
    await run();
  } catch (err) {
    console.error(`[r2-backup] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  backupKey,
  selectKeysToPrune,
  resolveBackupPrefix,
  evaluateBackupIdentity,
  parseBackupIdentity,
  BACKUP_IDENTITY_SQL,
  RETENTION_DAYS,
  MIN_BACKUPS_TO_KEEP,
  BACKUP_PREFIX,
};
