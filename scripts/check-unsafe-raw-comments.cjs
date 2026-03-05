#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(process.cwd(), "apps");
const TARGET_EXT = new Set([".ts", ".tsx"]);
const PATTERN = /\$(executeRawUnsafe|queryRawUnsafe)\b/;
const REQUIRED_COMMENT = "RLS-BYPASS: manual tenant filter";

function walk(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absolute, out);
      continue;
    }
    if (TARGET_EXT.has(path.extname(entry.name))) {
      out.push(absolute);
    }
  }
}

function hasRequiredComment(lines, lineIndex) {
  const line = lines[lineIndex] ?? "";
  if (line.includes(REQUIRED_COMMENT)) {
    return true;
  }
  const prev = lines[lineIndex - 1] ?? "";
  return prev.includes(REQUIRED_COMMENT);
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
      .filter((entry) => fs.existsSync(entry) && TARGET_EXT.has(path.extname(entry)));
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
