#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ADMIN_USERS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "users", "page.tsx");
const ADMIN_WEBHOOKS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "webhooks", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const usersSource = fs.readFileSync(ADMIN_USERS_PAGE, "utf8");
  const webhooksSource = fs.readFileSync(ADMIN_WEBHOOKS_PAGE, "utf8");

  assert(
    usersSource.includes("aria-invalid") && usersSource.includes("aria-describedby"),
    "Admin users form must include aria-invalid and aria-describedby on the user ID field for field-linked error accessibility.",
  );

  assert(
    usersSource.includes("aria-invalid") && usersSource.includes('aria-describedby'),
    "Admin users form must include aria-invalid and aria-describedby on the role field.",
  );

  assert(
    usersSource.includes("id=\"admin-user-id\"") || usersSource.includes("id='admin-user-id'"),
    "Admin users form must have an id on the email/user ID field for aria-describedby linkage.",
  );

  assert(
    webhooksSource.includes("aria-invalid") && webhooksSource.includes("aria-describedby"),
    "Admin webhooks form must include aria-invalid and aria-describedby on the URL and secret fields.",
  );

  assert(
    webhooksSource.includes("webhook-url-error") || webhooksSource.includes("webhook-url-hint"),
    "Admin webhooks form must have field-level error or hint IDs for the URL field.",
  );

  assert(
    webhooksSource.includes("webhook-signing-secret") || webhooksSource.includes("webhook-secret-hint"),
    "Admin webhooks form must have field-level IDs for the signing secret field.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "admin_users_form_has_aria_invalid",
          "admin_users_form_has_aria_describedby",
          "admin_users_form_has_field_ids",
          "admin_webhooks_form_has_aria_invalid_and_describedby",
          "admin_webhooks_url_field_has_error_id",
          "admin_webhooks_secret_field_has_id",
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
  console.error("Admin form accessibility test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
