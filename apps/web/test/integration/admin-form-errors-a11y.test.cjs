#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_KEY_CREATE_PANEL = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "api-keys", "api-key-create-panel.tsx");
const WEBHOOKS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "webhooks", "page.tsx");
const USERS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "users", "page.tsx");
const IMPORT_PREFLIGHT_FORM = path.join(REPO_ROOT, "apps", "web", "src", "components", "operations", "import-preflight-form.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const apiKeysSource = fs.readFileSync(API_KEY_CREATE_PANEL, "utf8");
  const webhooksSource = fs.readFileSync(WEBHOOKS_PAGE, "utf8");
  const usersSource = fs.readFileSync(USERS_PAGE, "utf8");
  const importsSource = fs.readFileSync(IMPORT_PREFLIGHT_FORM, "utf8");

  assert(
    apiKeysSource.includes('aria-invalid={state.status === "error" && fieldErrors.label ? "true" : undefined}') &&
      apiKeysSource.includes('aria-describedby={state.status === "error" && fieldErrors.label ? "api-key-label-error" : undefined}') &&
      apiKeysSource.includes('id="api-key-label-error"') &&
      apiKeysSource.includes('id="api-key-scopes-error"'),
    "API key creation must link field and scope validation errors directly to the relevant inputs instead of relying only on the page-level alert.",
  );
  assert(
    webhooksSource.includes('aria-invalid={status === "webhook-error" && webhookFieldErrors.name ? "true" : undefined}') &&
      webhooksSource.includes('id="webhook-target-error"') &&
      webhooksSource.includes('id="webhook-secret-error"'),
    "Webhook creation must expose field-linked errors for name, target URL, and signing secret when admin validation fails.",
  );
  assert(
    usersSource.includes('aria-invalid={status === "user-error" && inviteFieldErrors.userId ? "true" : undefined}') &&
      usersSource.includes('id="workspace-user-id-error"') &&
      usersSource.includes('id="workspace-user-role-error"'),
    "User invitation must expose field-linked errors for user ID and role selection when admin validation fails.",
  );
  assert(
    importsSource.includes('aria-invalid={fieldErrors.categoryId ? "true" : undefined}') &&
      importsSource.includes('id="bulk-import-category-error"') &&
      importsSource.includes('aria-invalid={fieldErrors.sourceFile ? "true" : undefined}') &&
      importsSource.includes('id="bulk-import-file-error"') &&
      importsSource.includes('id="bulk-import-chunk-error"') &&
      importsSource.includes('id="bulk-import-retries-error"'),
    "Import preflight form must expose field-linked errors for category, source file, chunk size, and retry count.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "api_key_form_links_field_errors_to_inputs",
          "webhook_form_links_field_errors_to_inputs",
          "workspace_user_invite_links_field_errors_to_inputs",
          "bulk_import_form_links_field_errors_to_inputs",
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
  console.error("Admin form error accessibility test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
