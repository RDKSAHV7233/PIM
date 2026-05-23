#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const controllerSource = fs.readFileSync(path.join(REPO_ROOT, "apps/api/src/common/app.controller.ts"), "utf8");
const storageSource = fs.readFileSync(path.join(REPO_ROOT, "apps/api/src/auth/auth-export-storage.service.ts"), "utf8");

assert(
  controllerSource.includes('@Get("health/account-export-storage")'),
  "account export storage probe route is missing",
);
assert(
  controllerSource.includes('@AuthenticatedReadRoute({ classification: "admin_only"') &&
    controllerSource.includes('@AdminBoundaryAccess({ capability: "manage_security" })') &&
    controllerSource.includes('@Roles("admin")'),
  "account export storage probe route must stay admin-only and read-policy classified",
);
assert(
  controllerSource.includes("return this.authExportStorageService.probeAccountExportStorage();") &&
    storageSource.includes("async probeAccountExportStorage(): Promise<AccountExportStorageProbeResult>") &&
    storageSource.includes('return `healthchecks/account-export-storage/${env}.json`;'),
  "account export storage probe must remain a bounded write probe backed by AuthExportStorageService",
);

console.log(
  JSON.stringify(
    {
      status: "ok",
      validated: [
        "account_export_storage_probe_route_present",
        "account_export_storage_probe_admin_only",
        "account_export_storage_probe_service_backed",
      ],
    },
    null,
    2,
  ),
);
