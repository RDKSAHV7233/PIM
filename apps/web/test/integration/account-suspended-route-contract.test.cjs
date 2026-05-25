/**
 * Contract test: /account-suspended page
 *
 * Verifies page existence, composition, and that auth-redirect sends
 * TENANT_SUSPENDED responses to /account-suspended instead of /login.
 */
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

const webRoot = path.resolve(__dirname, "../../");

// ── Page file existence ───────────────────────────────────────────────────────
console.log("\n/account-suspended page");

const pagePath = path.join(webRoot, "src/app/account-suspended/page.tsx");
test("page file exists", () => {
  assert.ok(fs.existsSync(pagePath), `Missing: ${pagePath}`);
});

const pageSource = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, "utf8") : "";

test("page exports default function", () => {
  assert.ok(
    pageSource.includes("export default function AccountSuspendedPage"),
    "Should export default AccountSuspendedPage function",
  );
});

test("page renders contact email or URL from env", () => {
  assert.ok(
    pageSource.includes("PIM_COMMERCIAL_CONTACT_EMAIL") ||
      pageSource.includes("PIM_COMMERCIAL_CONTACT_URL"),
    "Should read commercial contact from env vars",
  );
});

test("page has link back to sign in", () => {
  assert.ok(
    pageSource.includes("/login") || pageSource.includes("sign in"),
    "Should include link back to sign in",
  );
});

test("page contains workspace suspended messaging", () => {
  const lower = pageSource.toLowerCase();
  assert.ok(
    lower.includes("suspend"),
    "Should include suspension-related messaging",
  );
});

// ── auth-redirect module ──────────────────────────────────────────────────────
console.log("\nauth-redirect.ts");

const redirectPath = path.join(webRoot, "src/lib/auth-redirect.ts");
test("auth-redirect file exists", () => {
  assert.ok(fs.existsSync(redirectPath), `Missing: ${redirectPath}`);
});

const redirectSource = fs.existsSync(redirectPath) ? fs.readFileSync(redirectPath, "utf8") : "";

test("TENANT_SUSPENDED redirects to /account-suspended", () => {
  assert.ok(
    redirectSource.includes("/account-suspended"),
    "buildLoginRedirect should redirect tenant_suspended to /account-suspended",
  );
});

test("tenant_suspended reason handled before building login URL", () => {
  assert.ok(
    redirectSource.includes(`reason === "tenant_suspended"`) ||
      redirectSource.includes(`reason==="tenant_suspended"`),
    "Should short-circuit for tenant_suspended before building /login URL",
  );
});

// ── BillingStatusBanner ───────────────────────────────────────────────────────
console.log("\nBillingStatusBanner component");

const bannerPath = path.join(webRoot, "src/components/nav/billing-status-banner.tsx");
test("billing-status-banner file exists", () => {
  assert.ok(fs.existsSync(bannerPath), `Missing: ${bannerPath}`);
});

const bannerSource = fs.existsSync(bannerPath) ? fs.readFileSync(bannerPath, "utf8") : "";

test("banner exports BillingStatusBanner", () => {
  assert.ok(
    bannerSource.includes("export async function BillingStatusBanner"),
    "Should export BillingStatusBanner async function",
  );
});

test("banner checks billingStatus === trial", () => {
  assert.ok(
    bannerSource.includes('"trial"') || bannerSource.includes("=== 'trial'"),
    "Should check for trial billing status",
  );
});

test("banner checks billingStatus === past_due", () => {
  assert.ok(
    bannerSource.includes('"past_due"') || bannerSource.includes("=== 'past_due'"),
    "Should check for past_due billing status",
  );
});

test("banner reads trialEndsAt for day calculation", () => {
  assert.ok(
    bannerSource.includes("trialEndsAt"),
    "Should read trialEndsAt from billing profile",
  );
});

test("banner is wired into layout", () => {
  const layoutPath = path.join(webRoot, "src/app/layout.tsx");
  const layoutSource = fs.existsSync(layoutPath) ? fs.readFileSync(layoutPath, "utf8") : "";
  assert.ok(
    layoutSource.includes("BillingStatusBanner"),
    "layout.tsx should import and render BillingStatusBanner",
  );
});

// ── PlanLimitModal contact URL ────────────────────────────────────────────────
console.log("\nPlanLimitModal contactUrl");

const modalPath = path.join(webRoot, "src/components/ui/plan-limit-modal.tsx");
test("plan-limit-modal file exists", () => {
  assert.ok(fs.existsSync(modalPath), `Missing: ${modalPath}`);
});

const modalSource = fs.existsSync(modalPath) ? fs.readFileSync(modalPath, "utf8") : "";

test("modal accepts contactUrl prop", () => {
  assert.ok(
    modalSource.includes("contactUrl"),
    "PlanLimitModal should accept a contactUrl prop",
  );
});

test("modal renders Contact us to upgrade when contactUrl is set", () => {
  assert.ok(
    modalSource.includes("Contact us to upgrade"),
    "Should show 'Contact us to upgrade' CTA when contactUrl is set",
  );
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
