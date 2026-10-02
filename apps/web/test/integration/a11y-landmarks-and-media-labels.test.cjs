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

try {
  const sidebar = read("apps/web/src/components/nav/app-sidebar.tsx");
  assert(
    /<nav aria-label="Primary"/.test(sidebar) && /<\/nav>/.test(sidebar),
    "The sidebar menu must be a <nav aria-label=\"Primary\"> landmark (DEF-PC-020).",
  );
  assert((sidebar.match(/<nav\b/g) ?? []).length === 1, "The sidebar must expose exactly one navigation landmark.");

  const media = read("apps/web/src/app/media/page.tsx");
  assert(
    media.includes("aria-label={`Alt text for ${asset.fileName}`}"),
    "Each per-asset alt-text input must carry an accessible name that identifies the asset (DEF-PC-019).",
  );
  assert(
    media.includes("aria-label={`Gallery order for ${asset.fileName}`}"),
    "Each per-asset gallery-order input must carry an accessible name that identifies the asset (DEF-PC-019).",
  );

  console.log("a11y-landmarks-and-media-labels.test.cjs: PASS");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
