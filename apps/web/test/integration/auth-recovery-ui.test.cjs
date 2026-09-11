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
  const loginClient = read("apps/web/src/components/auth/login-page-client.tsx");
  const resetPage = read("apps/web/src/app/login/reset/page.tsx");
  const lockedPage = read("apps/web/src/app/login/locked/page.tsx");
  const resetClient = read("apps/web/src/components/auth/password-reset-page-client.tsx");
  const lockedClient = read("apps/web/src/components/auth/account-locked-page-client.tsx");
  const authCopy = read("apps/web/src/components/auth/auth-copy.ts");

  assert(
    loginClient.includes('router.push(`/login/locked?${params.toString()}`)') &&
      loginClient.includes("const resetHref = useMemo(() => {") &&
      loginClient.includes('return `/login/reset?${params.toString()}`;') &&
      loginClient.includes('params.set("email", trimmedEmail)') &&
      loginClient.includes('params.set("workspace", trimmedWorkspace)') &&
      loginClient.includes("href={resetHref}"),
    // L-2 (d50317c0) switched the reset link from an always-populated template
    // literal to a URLSearchParams builder that omits blank email/workspace
    // params. Assert the current builder + its conditional sets, not the old
    // exact string.
    "Login client must route recovery flows into the locked and reset pages with workspace-aware query state.",
  );

  assert(
    resetPage.includes("cookies()") &&
      resetPage.includes("resolveLocale") &&
      resetPage.includes("initialEmail") &&
      resetPage.includes("initialToken") &&
      resetPage.includes("initialWorkspaceSlug") &&
      resetPage.includes("<PasswordResetPageClient"),
    "Password reset page must normalize locale, email, token, and workspace query state before rendering the reset client.",
  );

  assert(
    lockedPage.includes("cookies()") &&
      lockedPage.includes("resolveLocale") &&
      lockedPage.includes("maskedEmail") &&
      lockedPage.includes("unlockAtIso") &&
      lockedPage.includes("workspaceSlug") &&
      lockedPage.includes("<AccountLockedPageClient"),
    "Account locked page must normalize locale and lock metadata before rendering the locked-account client.",
  );

  assert(
    resetClient.includes("const isConfirmMode = token.trim().length > 0") &&
      resetClient.includes('fetch("/api/auth/password-reset/request"') &&
      resetClient.includes('fetch("/api/auth/password-reset/confirm"') &&
      resetClient.includes("password !== confirmPassword") &&
      resetClient.includes("authCopy.resetPasswordMismatch") &&
      resetClient.includes("authCopy.resetInvalidToken") &&
      resetClient.includes("authCopy.resetCompleteSuccess") &&
      resetClient.includes("authCopy.resetSuccess"),
    "Password reset client must support request and confirm modes, validate password mismatch, and distinguish request/confirm success and invalid-token failures.",
  );

  assert(
    resetClient.includes("const loginHref = useMemo(() => {") &&
      resetClient.includes('params.set("workspace", workspaceSlug.trim())') &&
      resetClient.includes('params.set("email", email.trim())') &&
      resetClient.includes('return `/login?${params.toString()}`;'),
    "Password reset client must preserve email and workspace context when routing back to login.",
  );

  assert(
    lockedClient.includes('fetch("/api/auth/resend-unlock"') &&
      lockedClient.includes("body: JSON.stringify({ email, workspaceSlug })") &&
      lockedClient.includes("authCopy.resendNeedsEmail") &&
      lockedClient.includes("authCopy.workspaceInvalid") &&
      lockedClient.includes("authCopy.resendSent") &&
      lockedClient.includes('href={`/login?lang=${encodeURIComponent(locale)}&workspace=${encodeURIComponent(workspaceSlug)}`}'),
    "Locked account client must post resend-unlock requests with email and workspace context and preserve workspace-aware navigation back to login.",
  );

  assert(
    authCopy.includes("resetTitle: \"Reset your password\"") &&
      authCopy.includes("lockedTitle: \"This account has been locked for security.\"") &&
      authCopy.includes("resendUnlock: \"Email me a recovery link\"") &&
      authCopy.includes("resetPasswordMismatch: \"The password confirmation does not match.\""),
    "Auth copy must include the recovery and locked-account messages used by the reset and unlock pages.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "login_routes_recovery_flows_with_workspace_context",
          "reset_page_normalizes_query_state_for_client",
          "locked_page_normalizes_lock_state_for_client",
          "password_reset_client_supports_request_and_confirm_modes",
          "password_reset_client_preserves_workspace_aware_login_return",
          "locked_account_client_posts_resend_unlock_and_preserves_back_link",
          "auth_copy_includes_recovery_messages",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("Auth recovery UI integration test failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
