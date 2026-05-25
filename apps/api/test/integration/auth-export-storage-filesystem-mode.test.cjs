#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DIST_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "auth", "auth-export-storage.service.js");

async function run() {
  if (!fs.existsSync(DIST_ENTRY)) {
    throw new Error(`API build output not found at ${DIST_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pim1-account-export-fs-"));
  const originalEnv = {
    APP_ENV: process.env.APP_ENV,
    ACCOUNT_EXPORT_STORAGE_MODE: process.env.ACCOUNT_EXPORT_STORAGE_MODE,
    ACCOUNT_EXPORT_STORAGE_DIR: process.env.ACCOUNT_EXPORT_STORAGE_DIR,
    R2_ENDPOINT: process.env.R2_ENDPOINT,
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
  };

  try {
    process.env.APP_ENV = "staging";
    process.env.ACCOUNT_EXPORT_STORAGE_MODE = "filesystem";
    process.env.ACCOUNT_EXPORT_STORAGE_DIR = tempRoot;
    delete process.env.R2_ENDPOINT;
    process.env.R2_ACCOUNT_ID = "local-dev";
    process.env.R2_ACCESS_KEY_ID = "local-dev";
    process.env.R2_SECRET_ACCESS_KEY = "local-dev";
    process.env.R2_BUCKET_NAME = "vexa-pim-local";

    const { AuthExportStorageService } = require(DIST_ENTRY);
    const service = new AuthExportStorageService();

    const probe = await service.probeAccountExportStorage();
    assert.equal(probe.ok, true, `expected filesystem probe to succeed, got ${JSON.stringify(probe)}`);
    assert.equal(probe.mode, "filesystem", `expected filesystem mode, got ${JSON.stringify(probe)}`);
    assert.equal(probe.code, null, `expected no probe error code, got ${JSON.stringify(probe)}`);
    assert.equal(probe.message, null, `expected no probe message, got ${JSON.stringify(probe)}`);
    assert.equal(
      fs.existsSync(path.join(tempRoot, "healthchecks", "account-export-storage", "staging.json")),
      true,
      "expected filesystem probe to leave a bounded healthcheck artifact",
    );

    const stored = await service.storeAccountExportArtifact({
      tenantId: "tenant-filesystem",
      userId: "filesystem-user@example.com",
      jobId: "exp_fs_1",
      format: "json",
      fileContents: "{\"ok\":true}",
    });
    assert.equal(path.isAbsolute(stored.storagePath), true, `expected absolute filesystem path, got ${stored.storagePath}`);
    assert.equal(
      stored.storagePath.startsWith(tempRoot),
      true,
      `expected artifact path to stay inside configured storage dir, got ${stored.storagePath}`,
    );
    assert.equal(fs.readFileSync(stored.storagePath, "utf8"), "{\"ok\":true}", "expected stored artifact contents");

    const download = await service.resolveAccountExportDownload({
      artifactPath: stored.storagePath,
      format: "json",
      fileName: stored.fileName,
    });
    assert.equal(download.kind, "binary", `expected binary download from filesystem mode, got ${JSON.stringify(download)}`);
    assert.equal(download.content.toString("utf8"), "{\"ok\":true}", "expected download contents to match stored artifact");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: [
            "account_export_filesystem_mode_probe_writes_healthcheck",
            "account_export_filesystem_mode_stores_artifact_on_disk",
            "account_export_filesystem_mode_resolves_binary_download",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

run().catch((error) => {
  console.error("Auth export storage filesystem mode test failed:");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
