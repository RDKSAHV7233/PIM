#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const storageSource = fs.readFileSync(path.join(REPO_ROOT, "apps/api/src/auth/auth-export-storage.service.ts"), "utf8");
const authSource = fs.readFileSync(path.join(REPO_ROOT, "apps/api/src/auth/auth.service.ts"), "utf8");

assert(
  storageSource.includes("export class AccountExportStorageError extends Error") &&
    storageSource.includes("ACCOUNT_EXPORT_STORAGE_PUBLIC_MESSAGE") &&
    storageSource.includes("account_export_storage_tls_handshake_failed"),
  "account export storage diagnostics must define typed TLS-aware storage failures",
);
assert(
  authSource.includes("const errorMessage = this.toAccountExportErrorMessage(error);") &&
    authSource.includes("error instanceof AccountExportStorageError") &&
    authSource.includes("return error.publicMessage;"),
  "account export failures must store the safe public message instead of raw transport errors",
);

console.log(
  JSON.stringify(
    {
      status: "ok",
      validated: [
        "typed_account_export_storage_error_present",
        "account_export_failure_public_message_mapping_present",
      ],
    },
    null,
    2,
  ),
);
