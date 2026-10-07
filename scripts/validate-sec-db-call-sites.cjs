#!/usr/bin/env node

/**
 * SEC-DB-RLS-001 ratchet: no new privileged or context-free database consumer may appear unclassified.
 *
 * docs/qa/sec-db-rls-001-call-sites.v1.json classifies every call site that behaves differently under a non-superuser, non-owner,
 * RLS-enforced runtime role. This validator fails when:
 *   - a file starts using PrismaDirectService that the inventory does not list (a new privileged consumer);
 *   - the inventory lists a file that no longer uses it while still saying "open" (so the inventory is kept honest as sites migrate);
 *   - a file gains raw SQL call sites, or tenant()-with-no-argument raw scans, beyond what the inventory records;
 *   - a new `new PrismaClient(` appears outside the four known constructors;
 *   - an inventory entry is missing its class, remediation, plan, or the positive-result assertion that a migrated job must pass
 *     (a silent no-op must never read as success).
 * Decreases are allowed and expected as sites migrate; update the inventory in the same change.
 *
 * `validateCallSites(transforms, extra)` accepts per-source transforms and extra synthetic source so the negative tests can prove
 * each rule fires.
 */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const API_SRC = path.join(REPO_ROOT, "apps", "api", "src");
const INVENTORY = path.join(REPO_ROOT, "docs", "qa", "sec-db-rls-001-call-sites.v1.json");
const KNOWN_PRISMA_CLIENTS = new Set([
  "common/scheduling/advisory-lock.ts",
  "error-authority/observability-db.service.ts",
  "prisma/prisma-direct.service.ts",
  "prisma/prisma.service.ts",
]);
const CLASSES = new Set(["A", "A2", "B", "C", "D", "R"]);
const REMEDIATIONS = new Set(["tenant-iteration", "maintenance-read", "tenant-client", "explicit-tenant-argument", "approved-maintenance-path", "decision-needed", "split", "review"]);
const RAW = /[$](queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)/;
const NOT_A_CONSUMER = /prisma-direct[.]service[.]ts$|prisma[.]module[.]ts$|extensions[/]tenant-scope[.]ts$/;

function listSource(dir) {
  const out = [];
  (function visit(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "dist") {
          visit(p);
        }
      } else if (/[.]ts$/.test(entry.name) && !/[.]spec[.]ts$/.test(entry.name)) {
        out.push(p);
      }
    }
  })(dir);
  return out;
}

function scan(extra) {
  const direct = new Set();
  const rawByFile = {};
  const noArgByFile = {};
  const clients = [];
  const sources = listSource(API_SRC).map((f) => ({ rel: path.relative(API_SRC, f).split(path.sep).join("/"), text: fs.readFileSync(f, "utf8") }));
  for (const [rel, text] of Object.entries(extra || {})) {
    sources.push({ rel, text });
  }
  for (const { rel, text } of sources) {
    if (/PrismaDirectService/.test(text) && !NOT_A_CONSUMER.test(rel)) {
      direct.add(rel);
    }
    const lines = text.split("\n");
    let raw = 0;
    let noArg = 0;
    lines.forEach((line, i) => {
      if (RAW.test(line) && !/^\s*\/\//.test(line)) {
        raw += 1;
        if (/[.]tenant[(][)]/.test(lines.slice(Math.max(0, i - 1), i + 1).join(" "))) {
          noArg += 1;
        }
      }
      if (/globalQuery[(]this[.]prisma[.]tenant[(][)]/.test(line)) {
        noArg += 1;
      }
    });
    if (raw) {
      rawByFile[rel] = raw;
    }
    if (noArg) {
      noArgByFile[rel] = noArg;
    }
    if (/new PrismaClient[(]/.test(text)) {
      clients.push(rel);
    }
  }
  return { direct, rawByFile, noArgByFile, clients };
}

function validateCallSites(transform, extra) {
  const errors = [];
  const fail = (label, message) => errors.push(`${label}: ${message}`);
  let inventory = JSON.parse(fs.readFileSync(INVENTORY, "utf8"));
  if (transform) {
    inventory = transform(inventory) || inventory;
  }
  const { direct, rawByFile, noArgByFile, clients } = scan(extra);

  const listed = new Map(inventory.directClientFiles.map((e) => [e.file, e]));
  for (const file of direct) {
    if (!listed.has(file)) {
      fail("directClient.new", `${file} uses PrismaDirectService (no tenant context) but is not classified in the inventory`);
    }
  }
  for (const [file, entry] of listed) {
    if (!direct.has(file) && entry.status === "open") {
      fail("directClient.stale", `${file} no longer uses PrismaDirectService: mark it migrated or remove it from the inventory`);
    }
    if (direct.has(file) && entry.status === "migrated") {
      fail("directClient.regressed", `${file} is marked migrated but still uses PrismaDirectService`);
    }
  }

  const recordedRaw = inventory.rawSqlSitesByFile || {};
  for (const [file, count] of Object.entries(rawByFile)) {
    if (!(file in recordedRaw)) {
      fail("rawSql.new", `${file} has ${count} raw SQL call site(s) not recorded in the inventory`);
    } else if (count > recordedRaw[file]) {
      fail("rawSql.grew", `${file} has ${count} raw SQL call sites, the inventory records ${recordedRaw[file]}`);
    }
  }

  const recordedNoArg = new Map((inventory.crossTenantRawSqlFiles || []).map((e) => [e.file, e.noArgTenantRawSites]));
  for (const [file, count] of Object.entries(noArgByFile)) {
    if (!recordedNoArg.has(file)) {
      fail("noArgTenant.new", `${file} runs raw SQL through tenant() with no argument and is not classified as a cross-tenant site`);
    } else if (count > recordedNoArg.get(file)) {
      fail("noArgTenant.grew", `${file} has ${count} tenant()-no-argument raw SQL sites, the inventory records ${recordedNoArg.get(file)}`);
    }
  }

  // A raw-SQL file marked migrated must have NO tenant()-without-argument raw SQL left, and an open entry whose no-argument sites are
  // all gone must be marked migrated, so the migration cannot silently regress and the inventory cannot go stale.
  for (const entry of inventory.crossTenantRawSqlFiles || []) {
    const actual = noArgByFile[entry.file] || 0;
    if (entry.status === "migrated" && actual > 0) {
      fail("noArgTenant.regressed", `${entry.file} is marked migrated but has ${actual} tenant()-no-argument raw SQL site(s) again`);
    }
    if (entry.status === "open" && entry.noArgTenantRawSites > 0 && actual === 0) {
      fail("noArgTenant.stale", `${entry.file} no longer has tenant()-no-argument raw SQL: mark it migrated`);
    }
  }

  for (const file of clients) {
    if (!KNOWN_PRISMA_CLIENTS.has(file)) {
      fail("prismaClient.new", `${file} constructs its own PrismaClient: a new database identity must be classified first`);
    }
  }

  for (const entry of [...inventory.directClientFiles, ...(inventory.crossTenantRawSqlFiles || [])]) {
    const label = `entry ${entry.file}`;
    if (!CLASSES.has(entry.class)) {
      fail(label, `class must be one of ${[...CLASSES].join(", ")}`);
    }
    if (!REMEDIATIONS.has(entry.remediation)) {
      fail(label, `remediation must be one of ${[...REMEDIATIONS].join(", ")}`);
    }
    if (!entry.plan || String(entry.plan).length < 10) {
      fail(label, "needs a plan");
    }
    if (!entry.positiveAssertion || String(entry.positiveAssertion).length < 10) {
      fail(label, "needs a positive-result assertion: a migrated job must prove a non-empty result, never just the absence of an error");
    }
    if (!["open", "migrated"].includes(entry.status)) {
      fail(label, "status must be open or migrated");
    }
  }
  if (inventory.totals && inventory.totals.directClientFiles !== inventory.directClientFiles.length) {
    fail("totals", "directClientFiles total does not match the entries");
  }
  return { ok: errors.length === 0, errors };
}

function runCli() {
  const result = validateCallSites();
  if (!result.ok) {
    console.error("SEC-DB-RLS-001 call-site ratchet failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  const inv = JSON.parse(fs.readFileSync(INVENTORY, "utf8"));
  const open = inv.directClientFiles.filter((e) => e.status === "open").length;
  console.log(`SEC-DB-RLS-001 call-site ratchet passed: ${inv.directClientFiles.length} direct-client files classified (${open} open), ${inv.totals.rawSqlSites} raw SQL sites recorded.`);
}

if (require.main === module) {
  runCli();
}

module.exports = { validateCallSites };
