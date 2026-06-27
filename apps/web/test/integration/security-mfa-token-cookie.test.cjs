#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const WEB_SRC = path.join(REPO_ROOT, "apps", "web", "src");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(relPath) {
  return fs.readFileSync(path.join(WEB_SRC, relPath), "utf8");
}

function run() {
  // ── 1. MFA pages must read token from cookie, not searchParams ─────────
  const mfaPage = read("app/login/mfa/page.tsx");
  assert(
    mfaPage.includes('pim_mfa_pending_token'),
    "MFA challenge page must read the pending token from the pim_mfa_pending_token cookie.",
  );
  assert(
    !mfaPage.includes("params.token") && !mfaPage.includes("searchParams.token"),
    "MFA challenge page must NOT read the token from URL searchParams.",
  );

  const enrollPage = read("app/login/enroll/page.tsx");
  assert(
    enrollPage.includes('pim_mfa_enrollment_token'),
    "MFA enroll page must read the enrollment token from the pim_mfa_enrollment_token cookie.",
  );
  assert(
    !enrollPage.includes("params.token") && !enrollPage.includes("searchParams.token"),
    "MFA enroll page must NOT read the token from URL searchParams.",
  );

  // ── 2. Login page client must NOT put tokens in URL ────────────────────
  const loginClient = read("components/auth/login-page-client.tsx");
  assert(
    !loginClient.includes("token: payload.mfaPendingToken"),
    "Login client must NOT include mfaPendingToken in URL params — token is now set via HttpOnly cookie by the login API route.",
  );
  assert(
    !loginClient.includes("token: payload.enrollmentToken"),
    "Login client must NOT include enrollmentToken in URL params — token is now set via HttpOnly cookie by the login API route.",
  );

  // ── 3. Login API route must set MFA cookies ────────────────────────────
  const loginRoute = read("app/api/auth/login/route.ts");
  assert(
    loginRoute.includes("pim_mfa_pending_token") &&
      loginRoute.includes("httpOnly: true"),
    "Login API route must set pim_mfa_pending_token as an HttpOnly cookie when MFA_REQUIRED.",
  );
  assert(
    loginRoute.includes("pim_mfa_enrollment_token"),
    "Login API route must set pim_mfa_enrollment_token as an HttpOnly cookie when MFA_ENROLLMENT_REQUIRED.",
  );

  // ── 4. Verify routes must read token from cookie ───────────────────────
  const verifyLogin = read("app/api/auth/mfa/verify-login/route.ts");
  assert(
    verifyLogin.includes('cookies.get("pim_mfa_pending_token")'),
    "Verify-login route must read pendingToken from the pim_mfa_pending_token cookie.",
  );
  assert(
    verifyLogin.includes('maxAge: 0'),
    "Verify-login route must clear the pim_mfa_pending_token cookie on success.",
  );

  const verifyEnroll = read("app/api/auth/mfa/verify-enrollment/route.ts");
  assert(
    verifyEnroll.includes('cookies.get("pim_mfa_enrollment_token")'),
    "Verify-enrollment route must read enrollmentToken from the pim_mfa_enrollment_token cookie.",
  );
  assert(
    verifyEnroll.includes('maxAge: 0'),
    "Verify-enrollment route must clear the pim_mfa_enrollment_token cookie on success.",
  );

  const enrollRoute = read("app/api/auth/mfa/enroll/route.ts");
  assert(
    enrollRoute.includes('cookies.get("pim_mfa_enrollment_token")'),
    "Enroll route must read enrollmentToken from the pim_mfa_enrollment_token cookie.",
  );

  // ── 5. Client components must not send tokens in JSON.stringify body ──
  const mfaChallengeClient = read("components/auth/mfa-challenge-page-client.tsx");
  const challengeStringifyBlocks = mfaChallengeClient.match(/JSON\.stringify\(\{[^}]*\}/g) || [];
  for (const block of challengeStringifyBlocks) {
    assert(
      !block.includes("pendingToken"),
      "MFA challenge client must not send pendingToken in JSON.stringify body — it is auto-sent via HttpOnly cookie.",
    );
  }

  const mfaEnrollClient = read("components/auth/mfa-enroll-page-client.tsx");
  const enrollStringifyBlocks = mfaEnrollClient.match(/JSON\.stringify\(\{[^}]*\}/g) || [];
  for (const block of enrollStringifyBlocks) {
    assert(
      !block.includes("enrollmentToken"),
      "MFA enroll client must not send enrollmentToken in JSON.stringify body — it is auto-sent via HttpOnly cookie.",
    );
  }

  // ── 6. Settings enrollment must use cookie flow ────────────────────────
  const accountSecurity = read("components/settings/account-security-client.tsx");
  assert(
    !accountSecurity.includes("token: data.enrollmentToken") &&
      !accountSecurity.includes("token: enrollmentToken"),
    "Account security client must NOT put enrollment token in URL — must use cookie flow.",
  );
  assert(
    accountSecurity.includes("csrfHeaders"),
    "Account security client must use csrfHeaders() for CSRF-protected fetches.",
  );

  // ── 7. Request-enrollment-token route must stash token in cookie ───────
  const requestEnrollRoute = read("app/api/auth/mfa/request-enrollment-token/route.ts");
  assert(
    requestEnrollRoute.includes("pim_mfa_enrollment_token") &&
      requestEnrollRoute.includes("httpOnly: true"),
    "Request-enrollment-token route must set the enrollment token as an HttpOnly cookie.",
  );

  // ── 8. Password change must send CSRF header ──────────────────────────
  assert(
    accountSecurity.includes("csrfHeaders()"),
    "Password change fetch must include csrfHeaders() — the server validates CSRF.",
  );

  // ── 9. Shared CSRF utility must exist ─────────────────────────────────
  const csrfUtil = read("lib/csrf.ts");
  assert(
    csrfUtil.includes("readCsrfCookie") && csrfUtil.includes("csrfHeaders"),
    "Shared CSRF utility must export readCsrfCookie and csrfHeaders.",
  );

  // ── 10. No local readCookie in migrated files ─────────────────────────
  const migratedFiles = [
    "components/settings/data-privacy-page-client.tsx",
    "components/auth/logout-button.tsx",
    "components/auth/consent-page-client.tsx",
    "components/operations/import-preflight-form.tsx",
    "components/nav/notification-center.tsx",
    "app/notifications/page.tsx",
    "components/ui/meesho-export-panel.tsx",
  ];
  for (const relPath of migratedFiles) {
    const content = read(relPath);
    assert(
      !content.includes("function readCookie(") && !content.includes("function readCsrfToken("),
      `${relPath} must not define a local readCookie/readCsrfToken function — use the shared @/lib/csrf utility.`,
    );
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "mfa_challenge_page_reads_token_from_cookie",
          "mfa_enroll_page_reads_token_from_cookie",
          "login_client_no_token_in_url_params",
          "login_route_sets_mfa_pending_cookie",
          "login_route_sets_mfa_enrollment_cookie",
          "verify_login_reads_from_cookie_and_clears",
          "verify_enrollment_reads_from_cookie_and_clears",
          "enroll_route_reads_from_cookie",
          "mfa_challenge_client_no_token_in_body",
          "mfa_enroll_client_no_token_in_body",
          "settings_enrollment_uses_cookie_flow",
          "request_enrollment_token_stashes_cookie",
          "password_change_sends_csrf_header",
          "shared_csrf_utility_exists",
          "no_local_readCookie_in_7_migrated_files",
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
  console.error("Security MFA token cookie test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
