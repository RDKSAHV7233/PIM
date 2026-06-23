#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "channels",
  "submissions",
  "[id]",
  "page.tsx",
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function run() {
  const page = read(PAGE);

  assert(
    page.includes("await getServerSession()") &&
      page.includes("getSubmission") &&
      page.includes("getSubmissionIssues") &&
      page.includes("buildLoginRedirect"),
    "Submission detail page must derive shared server auth context, load submission and issues, and redirect expired sessions.",
  );

  assert(
    page.includes("error.status === 401 || error.status === 403"),
    "Submission detail page must redirect on both 401 and 403 errors — not 401 alone — to prevent 403 leaking as a 500.",
  );

  assert(
    page.includes("Submission Not Found") &&
      page.includes("does not exist or you do not have access"),
    "Submission detail page must show an explicit not-found state for 404 errors.",
  );

  assert(
    page.includes("Submission unavailable") &&
      page.includes("Submission data could not be loaded"),
    "Submission detail page must show an explicit unavailable state on non-auth backend failures instead of throwing a 500.",
  );

  assert(
    page.includes("submissionStatusTone") &&
      page.includes('"SUCCESS"') &&
      page.includes('"REJECTED"') &&
      page.includes('"PENDING"'),
    "Submission detail page must tone-code submission status (SUCCESS, REJECTED, PENDING) to make outcome visually distinct.",
  );

  assert(
    page.includes("issueSeverityTone") &&
      page.includes('"error"') &&
      page.includes('"warning"'),
    "Submission detail page must discriminate issue severity (error vs warning) and render blocking issues prominently.",
  );

  assert(
    page.includes("Timeline") &&
      page.includes("submittedAt") &&
      page.includes("resolvedAt"),
    "Submission detail page must render a timeline with submission and resolution events.",
  );

  assert(
    page.includes("payloadSnapshot"),
    "Submission detail page must expose the payload snapshot for debugging failed submissions.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "submission_detail_route_uses_shared_server_auth_context",
          "submission_detail_route_redirects_on_401_and_403",
          "submission_detail_route_renders_explicit_not_found_state",
          "submission_detail_route_renders_unavailable_state_on_backend_failure",
          "submission_detail_route_tone_codes_submission_status",
          "submission_detail_route_discriminates_issue_severity",
          "submission_detail_route_renders_timeline",
          "submission_detail_route_exposes_payload_snapshot",
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
  console.error("Submission detail route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
