#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DIST_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "auth", "auth-export-storage.service.js");
const PUBLIC_MESSAGE = "Account export storage is temporarily unavailable. Please contact support if this persists.";

async function run() {
  if (!fs.existsSync(DIST_ENTRY)) {
    throw new Error(`API build output not found at ${DIST_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const originalEnv = {
    APP_ENV: process.env.APP_ENV,
    R2_ENDPOINT: process.env.R2_ENDPOINT,
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
  };

  try {
    process.env.APP_ENV = "staging";
    delete process.env.R2_ENDPOINT;
    process.env.R2_ACCOUNT_ID = "local-dev";
    process.env.R2_ACCESS_KEY_ID = "local-dev";
    process.env.R2_SECRET_ACCESS_KEY = "local-dev";
    process.env.R2_BUCKET_NAME = "vexa-pim-local";

    const { AccountExportStorageError, AuthExportStorageService } = require(DIST_ENTRY);
    const service = new AuthExportStorageService();

    const probe = await service.probeAccountExportStorage();
    assert.equal(probe.ok, false, `expected failing probe, got ${JSON.stringify(probe)}`);
    assert.equal(
      probe.code,
      "account_export_storage_config_invalid",
      `expected config-invalid probe code, got ${JSON.stringify(probe)}`,
    );
    assert.match(
      String(probe.message ?? ""),
      /Placeholder\/local-default storage configuration detected/,
      `expected placeholder configuration guidance, got ${JSON.stringify(probe)}`,
    );
    assert.equal(
      probe.endpointHost,
      "local-dev.r2.cloudflarestorage.com",
      `expected local-dev endpoint host to be reported, got ${JSON.stringify(probe)}`,
    );
    assert.equal(
      probe.bucketName,
      "vexa-pim-local",
      `expected placeholder bucket to be reported, got ${JSON.stringify(probe)}`,
    );

    let captured = null;
    try {
      await service.storeAccountExportArtifact({
        tenantId: "diag-tenant",
        userId: "diag-user@example.com",
        jobId: "exp_diag_cfg_1",
        format: "json",
        fileContents: "{\"ok\":true}",
      });
    } catch (error) {
      captured = error;
    }

    assert(captured instanceof AccountExportStorageError, `expected AccountExportStorageError, got ${captured}`);
    assert.match(
      captured.message,
      /account_export_storage_config_invalid/,
      `expected config-invalid storage failure, got ${captured.message}`,
    );
    assert.equal(captured.publicMessage, PUBLIC_MESSAGE, "public export error message should remain user-safe");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: [
            "account_export_storage_probe_blocks_placeholder_defaults",
            "account_export_storage_write_blocks_placeholder_defaults",
            "account_export_storage_placeholder_defaults_stay_user_safe",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
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
  console.error("Auth export storage config guard test failed:");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
