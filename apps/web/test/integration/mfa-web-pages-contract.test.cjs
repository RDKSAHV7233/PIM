#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const challengePage = read(path.join(REPO_ROOT, "apps/web/src/app/login/mfa/page.tsx"));
  const enrollPage = read(path.join(REPO_ROOT, "apps/web/src/app/login/enroll/page.tsx"));
  const challengeClient = read(path.join(REPO_ROOT, "apps/web/src/components/auth/mfa-challenge-page-client.tsx"));
  const enrollClient = read(path.join(REPO_ROOT, "apps/web/src/components/auth/mfa-enroll-page-client.tsx"));
  const verifyLoginRoute = read(path.join(REPO_ROOT, "apps/web/src/app/api/auth/mfa/verify-login/route.ts"));
  const enrollRoute = read(path.join(REPO_ROOT, "apps/web/src/app/api/auth/mfa/enroll/route.ts"));
  const verifyEnrollRoute = read(path.join(REPO_ROOT, "apps/web/src/app/api/auth/mfa/verify-enrollment/route.ts"));
  const backupRegenRoute = read(path.join(REPO_ROOT, "apps/web/src/app/api/auth/mfa/backup-codes/regenerate/route.ts"));
  const requestEnrollTokenRoute = read(path.join(REPO_ROOT, "apps/web/src/app/api/auth/mfa/request-enrollment-token/route.ts"));
  const authProxyHelper = read(path.join(REPO_ROOT, "apps/web/src/app/api/_auth.ts"));
  const loginPageClient = read(path.join(REPO_ROOT, "apps/web/src/components/auth/login-page-client.tsx"));
  const authCopy = read(path.join(REPO_ROOT, "apps/web/src/components/auth/auth-copy.ts"));
  const securityPage = read(path.join(REPO_ROOT, "apps/web/src/app/settings/security/page.tsx"));
  const securityClient = read(path.join(REPO_ROOT, "apps/web/src/components/settings/account-security-client.tsx"));
  const sidebar = read(path.join(REPO_ROOT, "apps/web/src/components/nav/app-sidebar.tsx"));

  assert(
    challengePage.includes("MfaChallengePageClient") &&
      challengePage.includes("pim_mfa_pending_token") &&
      challengePage.includes('redirect("/login")') &&
      challengePage.includes("sanitizeNextPath"),
    "MFA challenge page must guard missing token with a redirect to /login and sanitize the next path. Token must stay server-side (cookie only, not passed as client prop).",
  );

  assert(
    enrollPage.includes("MfaEnrollPageClient") &&
      enrollPage.includes("pim_mfa_enrollment_token") &&
      enrollPage.includes('redirect("/login")'),
    "MFA enroll page must guard missing token with a redirect to /login. Token must stay server-side (cookie only, not passed as client prop).",
  );

  assert(
    challengeClient.includes("/api/auth/mfa/verify-login") &&
      challengeClient.includes("MFA_PENDING_TOKEN_REQUIRED") &&
      challengeClient.includes("window.location.assign"),
    "MFA challenge client must POST to verify-login proxy, handle expired token error, and assign to nextPath on success. pendingToken must NOT be a client prop (cookie-only).",
  );

  assert(
    !challengeClient.includes("pendingToken:") &&
      !challengeClient.includes("pendingToken,"),
    "MFA challenge client must NOT receive pendingToken as a prop — the httpOnly cookie is sent automatically with the fetch.",
  );

  assert(
    enrollClient.includes("/api/auth/mfa/enroll") &&
      enrollClient.includes("/api/auth/mfa/verify-enrollment") &&
      enrollClient.includes("otpauthUri") &&
      enrollClient.includes('QRCode.toDataURL(enrollData.otpauthUri') &&
      enrollClient.includes("Authenticator QR code") &&
      enrollClient.includes("manualEntryKey") &&
      enrollClient.includes("backupCodes"),
    "MFA enroll client must load TOTP URI, render an authenticator QR code plus manual key, verify code, and display backup codes.",
  );

  assert(
    verifyLoginRoute.includes("pim_access_token") ||
      verifyLoginRoute.includes("pendingToken"),
    "verify-login proxy route must handle the pending token.",
  );

  assert(
    verifyLoginRoute.includes("pim_access_token") &&
      verifyLoginRoute.includes("pim_csrf_token") &&
      verifyLoginRoute.includes("outgoing.cookies.set"),
    "verify-login proxy route must set pim_access_token and pim_csrf_token cookies on successful MFA verification.",
  );

  assert(
    enrollRoute.includes("enrollmentToken") &&
      enrollRoute.includes("/auth/mfa/enroll"),
    "enroll proxy route must forward enrollmentToken as Bearer to backend /auth/mfa/enroll.",
  );

  assert(
    verifyEnrollRoute.includes("enrollmentToken") &&
      verifyEnrollRoute.includes("/auth/mfa/verify-enrollment"),
    "verify-enrollment proxy route must forward enrollmentToken and code to backend.",
  );

  assert(
    authProxyHelper.includes('request.cookies.get("pim_access_token")') &&
      backupRegenRoute.includes("resolveBearerToken") &&
      backupRegenRoute.includes("/auth/mfa/backup-codes/regenerate") &&
      backupRegenRoute.includes("UNAUTHENTICATED"),
    "backup-codes regenerate route must use the shared pim_access_token cookie resolver and reject unauthenticated requests.",
  );

  assert(
    authProxyHelper.includes('request.cookies.get("pim_access_token")') &&
      requestEnrollTokenRoute.includes("resolveBearerToken") &&
      requestEnrollTokenRoute.includes("/auth/mfa/request-enrollment-token") &&
      requestEnrollTokenRoute.includes("UNAUTHENTICATED"),
    "request-enrollment-token proxy must use the shared pim_access_token cookie resolver and forward to backend endpoint.",
  );

  assert(
    loginPageClient.includes("MFA_REQUIRED") &&
      loginPageClient.includes("mfaPendingToken") &&
      loginPageClient.includes("/login/mfa") &&
      loginPageClient.includes("MFA_ENROLLMENT_REQUIRED") &&
      loginPageClient.includes("enrollmentToken") &&
      loginPageClient.includes("/login/enroll") &&
      loginPageClient.includes("AUTH_METHOD_NOT_ALLOWED"),
    "Login page client must handle MFA_REQUIRED (→ /login/mfa), MFA_ENROLLMENT_REQUIRED (→ /login/enroll), and AUTH_METHOD_NOT_ALLOWED.",
  );

  assert(
    authCopy.includes("mfaChallengeTitle") &&
      authCopy.includes("mfaEnrollTitle") &&
      authCopy.includes("mfaEnrollBackupCodesTitle") &&
      authCopy.includes("authMethodNotAllowed") &&
      authCopy.includes("mfaSetupCta"),
    "auth-copy must include MFA challenge, enrollment, backup codes, auth method not allowed, and setup CTA string keys.",
  );

  assert(
    securityPage.includes("getMfaStatus") &&
      securityPage.includes("getTenantAuthPolicy") &&
      securityPage.includes("AccountSecurityClient") &&
      securityPage.includes('buildLoginRedirect("/settings/security"') &&
      securityPage.includes("getServerSessionClaims") &&
      securityPage.includes("assignedRoles") &&
      securityPage.includes("mfaStatusState") &&
      securityPage.includes("policyState") &&
      securityPage.includes("planState"),
    "Account security page must load MFA status, auth policy, session claims, pass role/assignedRoles plus degraded-state flags to AccountSecurityClient, and redirect unauthenticated requests.",
  );

  assert(
    securityClient.includes("backupCodesRemaining") &&
      securityClient.includes("/api/auth/mfa/backup-codes/regenerate") &&
      securityClient.includes("enrollmentStatus") &&
      securityClient.includes("mfaRequired") &&
      securityClient.includes("/api/auth/mfa/request-enrollment-token") &&
      securityClient.includes("window.location.assign") &&
      securityClient.includes("role") &&
      securityClient.includes("assignedRoles") &&
      securityClient.includes("We couldn&apos;t load complete MFA settings right now.") &&
      securityClient.includes("Enrollment status is temporarily unavailable.") &&
      securityClient.includes("Workspace MFA policy is temporarily unavailable.") &&
      securityClient.includes("Plan-based MFA entitlement is temporarily unavailable."),
    "Account security client must display role/boundary, MFA enrollment status, backup codes remaining, self-service enrollment CTA, and an explicit unavailable state when supporting security reads fail.",
  );

  assert(
    sidebar.includes('href: "/settings/security"') &&
      sidebar.includes('"Account Security"'),
    "Sidebar must include an Account Security link pointing to /settings/security.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "mfa_challenge_page_guards_missing_token",
          "mfa_enroll_page_guards_missing_token",
          "mfa_challenge_client_verifies_and_redirects",
          "mfa_enroll_client_loads_totp_and_shows_backup_codes",
          "verify_login_proxy_sets_session_cookies",
          "enroll_proxy_forwards_enrollment_token",
          "verify_enrollment_proxy_forwards_code",
          "backup_codes_regenerate_proxy_requires_auth",
          "request_enrollment_token_proxy_requires_session_cookie",
          "login_client_handles_mfa_required_enrollment_required_method_not_allowed",
          "auth_copy_includes_all_mfa_strings_and_setup_cta",
          "account_security_page_loads_mfa_status_and_passes_role",
          "account_security_client_shows_role_status_regenerate_and_setup_cta",
          "sidebar_includes_account_security_link",
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
  console.error("MFA web pages contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
