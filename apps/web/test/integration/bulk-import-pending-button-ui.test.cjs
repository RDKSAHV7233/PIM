#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const page = read("apps/web/src/app/operations/imports/page.tsx");
  const component = read("apps/web/src/components/ui/pending-submit-button.tsx");
  const preflightForm = read("apps/web/src/components/operations/import-preflight-form.tsx");

  assert(
    component.includes('useFormStatus'),
    "PendingSubmitButton must derive loading state from useFormStatus",
  );
  assert(
    component.includes("disabled={disabled || pending}"),
    "PendingSubmitButton must disable itself while pending",
  );
  assert(
    component.includes("aria-busy={pending}"),
    "PendingSubmitButton must expose aria-busy while pending",
  );
  assert(
    preflightForm.includes("PendingSubmitButton"),
    "imports preflight form must use PendingSubmitButton for upload",
  );
  assert(
    preflightForm.includes('pendingLabel="Uploading and starting import..."'),
    "upload button must show an uploading pending label",
  );
  assert(
    page.includes('pendingLabel="Starting import..."'),
    "start import button must show a starting pending label",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "pending_submit_button_uses_form_status",
          "pending_submit_button_disables_while_pending",
          "imports_preflight_upload_uses_pending_feedback",
          "imports_start_action_uses_pending_feedback",
        ],
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("bulk-import-pending-button-ui integration test failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
