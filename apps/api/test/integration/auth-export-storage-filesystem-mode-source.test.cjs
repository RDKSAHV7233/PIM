#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const storageSource = fs.readFileSync(path.join(REPO_ROOT, "apps/api/src/auth/auth-export-storage.service.ts"), "utf8");
const envValidationSource = fs.readFileSync(path.join(REPO_ROOT, "apps/api/src/common/env-validation.ts"), "utf8");

assert(
  storageSource.includes("ACCOUNT_EXPORT_STORAGE_MODE") &&
    storageSource.includes("ACCOUNT_EXPORT_STORAGE_DIR") &&
    storageSource.includes('private readonly storageBackend = this.resolveStorageBackend();'),
  "account export storage must support an explicit filesystem/object storage mode contract",
);
assert(
  storageSource.includes("account_export_storage_filesystem_unwritable") &&
    storageSource.includes("buildProbeFileRelativePath") &&
    storageSource.includes('mode: "filesystem"'),
  "account export storage filesystem mode must have a bounded probe and actionable filesystem diagnostics",
);
assert(
  envValidationSource.includes("ACCOUNT_EXPORT_STORAGE_MODE") &&
    envValidationSource.includes("ACCOUNT_EXPORT_STORAGE_DIR") &&
    envValidationSource.includes("required when ACCOUNT_EXPORT_STORAGE_MODE=filesystem in staging/production"),
  "env validation must guard the explicit account export filesystem mode contract",
);

console.log(
  JSON.stringify(
    {
      status: "ok",
      validated: [
        "account_export_storage_filesystem_mode_contract_present",
        "account_export_storage_filesystem_probe_and_diagnostics_present",
        "account_export_storage_env_validation_present",
      ],
    },
    null,
    2,
  ),
);
