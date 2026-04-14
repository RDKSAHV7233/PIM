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
  const layout = read("apps/web/src/app/layout.tsx");
  const brandLogo = read("apps/web/src/components/ui/brand-logo.tsx");
  const login = read("apps/web/src/components/auth/login-page-client.tsx");
  const locked = read("apps/web/src/components/auth/account-locked-page-client.tsx");
  const reset = read("apps/web/src/components/auth/password-reset-page-client.tsx");
  const consent = read("apps/web/src/components/auth/consent-page-client.tsx");
  const signup = read("apps/web/src/components/auth/signup-page-client.tsx");
  const signupVerify = read("apps/web/src/components/auth/signup-verify-page-client.tsx");
  const vexaWordmarkPattern = /\bVexa\b/;

  assert(
    brandLogo.includes('variant?: "compact" | "lockup"') &&
      brandLogo.includes("Product information manager") &&
      brandLogo.includes("radial-gradient"),
    "Brand logo component must expose compact and lockup variants with a light Vexa auth treatment.",
  );
  assert(
    brandLogo.includes('variant = "compact"') &&
      brandLogo.includes('/brand/app_icon.svg') &&
      vexaWordmarkPattern.test(brandLogo),
    "Brand logo component must render the Vexa app icon and wordmark in the shared UI component.",
  );
  assert(
    layout.includes('import { BrandLogo } from "@/components/ui/brand-logo";') &&
      layout.includes('aria-label="Vexa PIM home"') &&
      layout.includes('BrandLogo variant="compact"'),
    "Root layout must use the compact Vexa logo in the authenticated header.",
  );
  for (const source of [login, locked, reset, consent, signup, signupVerify]) {
    assert(
      source.includes('import { BrandLogo } from "@/components/ui/brand-logo";') &&
        source.includes('BrandLogo variant="lockup"'),
      "Auth and consent entry screens must use the lockup Vexa logo.",
    );
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "brand_logo_component_exposes_compact_and_lockup_variants",
          "layout_uses_compact_brand_logo",
          "auth_and_consent_routes_use_lockup_brand_logo",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("brand-logo-ui integration test failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
