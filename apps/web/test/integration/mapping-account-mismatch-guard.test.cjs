#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SERVICE_FILE = path.join(REPO_ROOT, "apps", "api", "src", "marketplace", "connector-mapping.service.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const serviceSource = fs.readFileSync(SERVICE_FILE, "utf8");

  // Verify the stricter guard pattern is present.
  // The bypass-prone form is:  draftInstId && input.installationId && draftInstId !== input.installationId
  // The correct form requires: draftInstId && (!input.installationId || draftInstId !== input.installationId)
  // This ensures that omitting installationId in a publish request is also rejected
  // when the draft was scoped to a specific account.
  assert(
    serviceSource.includes("draftInstId && (!input.installationId || draftInstId !== input.installationId)"),
    "publishVersion mismatch guard must reject publish requests that omit installationId when the draft was scoped to an account. " +
    "Bypass-prone form 'draftInstId && input.installationId && draftInstId !== ...' was found instead of " +
    "'draftInstId && (!input.installationId || draftInstId !== ...)'.",
  );

  // Verify draftInstallationId is read from the Prisma row at publish time (typed, not via raw cast).
  assert(
    serviceSource.includes("selectedRow.draftInstallationId"),
    "publishVersion must read draftInstallationId from the typed Prisma row.",
  );

  // Verify the error code used at the service level matches what the E2E test and UI check for.
  assert(
    serviceSource.includes('"account_mismatch_draft_vs_publish"'),
    "publishVersion must throw ConflictException(\"account_mismatch_draft_vs_publish\") on mismatch.",
  );

  // Verify draftInstallationId is stored at draft creation time.
  assert(
    serviceSource.includes("draftInstallationId: input.installationId ?? null"),
    "createDraft must store draftInstallationId from input.installationId.",
  );

  // Verify the supersede query selects installationId so the scope filter can compare it.
  // Without this select, the filter always sees undefined (null), making slug-scoped publishes
  // incorrectly supersede account-scoped ones and account-scoped publishes supersede nothing.
  assert(
    serviceSource.includes("select: { id: true, installationId: true }"),
    "publishVersion supersede query must select installationId so the account-scope filter works. " +
    "select: { id: true } without installationId causes all scope comparisons to see null.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "mismatch_guard_rejects_omitted_installation_id",
          "mismatch_guard_reads_draft_installation_id_from_row",
          "mismatch_guard_uses_canonical_error_code",
          "create_draft_persists_draft_installation_id",
          "supersede_query_selects_installation_id_for_scope_filter",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error("Account mismatch guard test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
