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
  const loginPage = read("apps/web/src/app/login/page.tsx");
  const loginClient = read("apps/web/src/components/auth/login-page-client.tsx");
  const signupPage = read("apps/web/src/app/signup/page.tsx");
  const signupVerifyPage = read("apps/web/src/app/signup/verify/page.tsx");
  const signupClient = read("apps/web/src/components/auth/signup-page-client.tsx");
  const signupVerifyClient = read("apps/web/src/components/auth/signup-verify-page-client.tsx");
  const signupShared = read("apps/web/src/app/api/signup/_shared.ts");
  const signupRoute = read("apps/web/src/app/api/signup/workspace/route.ts");
  const verifyRoute = read("apps/web/src/app/api/signup/verify/route.ts");
  const publicSignupFlag = read("apps/web/src/lib/public-signup.ts");
  const envExample = read(".env.example");

  assert(
    publicSignupFlag.includes("NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED") &&
      publicSignupFlag.includes("FEATURE_PUBLIC_SIGNUP_ENABLED"),
    "Public signup flag helper must resolve both web and server feature flag sources.",
  );
  assert(
    envExample.includes('NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED="false"'),
    "Env examples must document the public signup web flag.",
  );
  assert(
    loginPage.includes("isPublicSignupEnabled()") &&
      loginClient.includes("signupEnabled") &&
      loginClient.includes('href={`/signup?lang=${encodeURIComponent(locale)}`}'),
    "Login flow must expose a signup CTA when public signup is enabled.",
  );
  assert(
    signupPage.includes("notFound();") &&
      signupPage.includes("isPublicSignupEnabled()") &&
      signupVerifyPage.includes("notFound();") &&
      signupVerifyPage.includes("isPublicSignupEnabled()"),
    "Signup pages must be gated behind the public signup feature flag.",
  );
  assert(
    signupClient.includes("/api/signup/workspace/availability") &&
      signupClient.includes("/api/signup/workspace") &&
      signupClient.includes("normalizeWorkspaceSlugInput") &&
      signupClient.includes("acceptedTerms"),
    "Signup page client must perform live workspace checks and submit the public signup form.",
  );
  assert(
    signupVerifyClient.includes("/api/signup/verify") &&
      signupVerifyClient.includes("/api/signup/resend-verification"),
    "Signup verify page must verify tokens and support resend verification.",
  );
  assert(
    signupShared.includes("signupFeatureDisabledResponse") &&
      signupRoute.includes('"/signup/workspace"') &&
      verifyRoute.includes('"/signup/verify"'),
    "Web signup API routes must proxy to the backend signup endpoints and preserve feature gating.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "public_signup_flag_helper_exists",
          "login_page_exposes_signup_cta_when_enabled",
          "signup_pages_are_feature_gated",
          "signup_page_client_checks_availability_and_submits",
          "signup_verify_client_supports_verify_and_resend",
          "web_signup_api_routes_proxy_backend_endpoints",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("public-signup-ui integration test failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
