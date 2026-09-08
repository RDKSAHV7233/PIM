#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

async function main() {
  const page = read("apps/web/src/app/internal/ops/errors/page.tsx");
  const apiClient = read("apps/web/src/lib/api/error-authority-ops.ts");
  const resolveButton = read("apps/web/src/components/error-authority/resolve-issue-button.tsx");
  const actions = read("apps/web/src/app/internal/ops/errors/actions.ts");

  assert(
    page.includes("await getServerSession()") &&
      page.includes("isSystemAdminBoundary(adminBoundaryRoles)") &&
      page.includes('actorRole !== "admin"') &&
      page.includes("SystemAdminRequiredCard"),
    "Internal ops errors page must gate by verified server session, admin role, and system/super boundary role.",
  );

  assert(
    apiClient.includes("/error-authority/ops/issues") &&
      apiClient.includes("options?: ApiRequestOptions") &&
      page.includes("{ authHeader }") &&
      !apiClient.includes("ERROR_AUTHORITY_INGEST_TOKEN") &&
      !apiClient.includes("OBSERVABILITY_DATABASE_URL") &&
      !apiClient.includes("ERROR_AUTHORITY_REF_SECRET"),
    "Internal ops errors Web client must use server-authenticated API reads and no Error Authority secrets.",
  );

  assert(
    page.includes("listErrorAuthorityIssues") &&
      page.includes("listErrorAuthorityOccurrences") &&
      page.includes("runtime") &&
      page.includes("severity") &&
      page.includes("dateFrom") &&
      page.includes("dateTo"),
    "Internal ops errors page must render issue and occurrence reads with core filters.",
  );

  // PIM#766 Part 1 (PO-approved Option C): the API client gains exactly one bounded
  // mutation — resolve — built on the shared postJson helper. Anything beyond that
  // (PATCH/DELETE, or a second POST) would be scope creep on this specific fix.
  assert(
    apiClient.includes("resolveErrorAuthorityIssue") &&
      apiClient.includes("postJson") &&
      apiClient.includes("/resolve") &&
      !apiClient.includes("patchJson") &&
      !apiClient.includes("deleteJson") &&
      !apiClient.includes('method: "PATCH"') &&
      !apiClient.includes('method: "DELETE"'),
    "Internal ops errors API client must expose only the PIM#766 resolve mutation, no other write capability.",
  );

  assert(
    resolveButton.includes("ConfirmDialog") &&
      resolveButton.includes("resolveErrorIssueAction") &&
      /eligible for permanent deletion/i.test(resolveButton) &&
      resolveButton.includes("alreadyResolved"),
    "Internal ops errors UI must gate the resolve mutation behind a confirmation dialog that warns about " +
      "retention impact, and must disable the control once an issue is already resolved.",
  );

  assert(
    actions.includes('"use server"') &&
      actions.includes("getServerSession()") &&
      actions.includes("isSystemAdminBoundary(adminBoundaryRoles)") &&
      actions.includes('actorRole !== "admin"') &&
      actions.includes("resolveErrorAuthorityIssue("),
    "The resolve server action must re-check the same admin + system/super boundary gate the page renders " +
      "behind — a server action is directly callable and is not protected by the page's own gating alone.",
  );

  const prohibitedUiFields = [
    "headers",
    "cookies",
    "requestBody",
    "rawBody",
    "queryString",
    "authorization",
    "password",
    "credential",
    "normalizedFrames",
  ];
  for (const field of prohibitedUiFields) {
    assert(!page.includes(field), `Internal ops errors UI must not render prohibited field ${field}.`);
  }

  assert(
    page.includes("safeTitle") &&
      page.includes("safeMessage") &&
      page.includes("safeTenantRef ?") &&
      !page.includes("rawTenant"),
    "Internal ops errors UI must render only safe titles/messages and hashed tenant impact indicators.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "ui_server_session_gate",
          "ui_server_authenticated_api_client",
          "ui_core_filters",
          "ui_bounded_resolve_mutation_only",
          "ui_resolve_confirmation_dialog",
          "ui_resolve_action_reauthorizes",
          "ui_no_prohibited_fields",
          "ui_safe_tenant_exposure",
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("Internal ops errors UI contract failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
