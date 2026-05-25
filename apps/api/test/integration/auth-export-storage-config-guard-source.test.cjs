#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const storageSource = fs.readFileSync(path.join(REPO_ROOT, "apps/api/src/auth/auth-export-storage.service.ts"), "utf8");

assert(
  storageSource.includes("LOCAL_PLACEHOLDER_ACCOUNT_ID") &&
    storageSource.includes("LOCAL_PLACEHOLDER_BUCKET_NAME") &&
    storageSource.includes("account_export_storage_config_invalid") &&
    storageSource.includes("validateObjectStorageConfiguration"),
  "account export storage must reject placeholder/local-default object storage configuration",
);
assert(
  storageSource.includes("R2_ACCOUNT_ID=local-dev") &&
    storageSource.includes("R2_BUCKET_NAME=vexa-pim-local") &&
    storageSource.includes("Placeholder/local-default storage configuration detected"),
  "account export storage config guard must explain which placeholder values were detected",
);

console.log(
  JSON.stringify(
    {
      status: "ok",
      validated: [
        "account_export_storage_config_invalid_guard_present",
        "account_export_storage_placeholder_guidance_present",
      ],
    },
    null,
    2,
  ),
);
