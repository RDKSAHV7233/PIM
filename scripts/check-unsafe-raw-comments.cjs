#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(process.cwd(), "apps");
const TARGET_EXT = new Set([".ts", ".tsx"]);
// Spec files are excluded: their $queryRaw/$executeRaw occurrences are either
// hand-rolled mock property keys (nothing to annotate -- no real query runs)
// or integration tests exercising already-audited production call sites (the
// SQL that needs justifying lives in the service file, not duplicated here).
// This gate is about production code paths, not test scaffolding.
const isSpecFile = (filePath) => filePath.endsWith(".spec.ts");
// Covers both the string-interpolation-vulnerable "Unsafe" raw calls AND the
// safe, parameterized $queryRaw/$executeRaw tagged-template form. Both bypass
// the tenant-scope Prisma extension identically (it only instruments ORM query
// methods, never raw SQL of any kind) -- "safe" here means SQL-injection-safe,
// not tenant-isolation-safe. Originally this pattern only matched the "Unsafe"
// variants, leaving ~50 $queryRaw/$executeRaw call sites across the codebase
// with zero automated protection; extended 2026-09-20 after that gap let one
// real cross-tenant info-disclosure bug (VBPIM/PIM#886) go unnoticed by CI.
// A negative lookahead excludes exactly one harmless false-positive shape: an
// object-literal property key in a hand-rolled test mock (`{ $queryRaw: mockFn }`,
// this repo's standard Prisma-client mocking convention -- a key is not a call).
// Deliberately NOT anchored to "followed by `(`" -- a real call is often
// `$queryRaw<SomeGenericType>(...)` or a multi-line tagged template where the
// backtick/paren isn't on the same line as the method name at all, so requiring
// an immediately-following invocation character would silently stop matching
// the majority of this codebase's real call sites. Bare-word prose mentions in
// comments ("the $queryRaw call") still match and need fixing at the source --
// drop the `$` in prose, matching the convention already used elsewhere in this
// codebase, rather than trying to teach a line-based regex what a comment is.
const PATTERN = /\$(executeRawUnsafe|queryRawUnsafe|executeRaw|queryRaw)\b(?!\s*:)/;
// A prefix match (not a fixed sentence) so a call site can explain *why* it's
// exempt in its own words -- most calls carry "RLS-BYPASS: manual tenant
// filter" (the filter is right there in the SQL), but a call against a
// genuinely tenant-agnostic table (a global config table, an ops-only table,
// a Postgres advisory lock, a pre-tenant-determination webhook-ingestion
// table keyed on the provider's own globally-unique event id) carries a
// different, equally explicit "RLS-BYPASS: <reason this doesn't need one>"
// instead. Either way, the discipline enforced is the same: every raw call
// must be deliberately, visibly justified, not silently assumed correct.
const REQUIRED_COMMENT_PREFIX = "RLS-BYPASS:";

function walk(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absolute, out);
      continue;
    }
    if (TARGET_EXT.has(path.extname(entry.name)) && !isSpecFile(entry.name)) {
      out.push(absolute);
    }
  }
}

function hasRequiredComment(lines, lineIndex) {
  const line = lines[lineIndex] ?? "";
  if (line.includes(REQUIRED_COMMENT_PREFIX)) {
    return true;
  }
  // Scan upward through the contiguous `//` comment block directly above the
  // call site -- a real call is often preceded by a multi-line explanation of
  // *why* it's exempt, not just a single terse line immediately above it.
  for (let i = lineIndex - 1; i >= 0; i -= 1) {
    const prev = (lines[i] ?? "").trim();
    if (!prev.startsWith("//")) {
      break;
    }
    if (prev.includes(REQUIRED_COMMENT_PREFIX)) {
      return true;
    }
  }
  return false;
}

function main() {
  if (!fs.existsSync(ROOT)) {
    console.log("No apps directory found; skipping unsafe raw check.");
    return;
  }
  let files = [];
  if (String(process.env.CHECK_ONLY_CHANGED ?? "").toLowerCase() === "true") {
    const baseRef = process.env.GIT_BASE_REF || "HEAD~1";
    const raw = execSync(`git diff --name-only ${baseRef}...HEAD`, { encoding: "utf8" });
    files = raw
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith("apps/"))
      .map((entry) => path.resolve(process.cwd(), entry))
      .filter((entry) => fs.existsSync(entry) && TARGET_EXT.has(path.extname(entry)) && !isSpecFile(entry));
  } else {
    walk(ROOT, files);
  }

  const violations = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (!PATTERN.test(lines[index])) {
        continue;
      }
      if (!hasRequiredComment(lines, index)) {
        violations.push(`${path.relative(process.cwd(), file)}:${index + 1}`);
      }
    }
  }

  if (violations.length > 0) {
    console.error("Unsafe raw Prisma calls missing required RLS comment:");
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Unsafe raw Prisma call check passed.");
}

main();
