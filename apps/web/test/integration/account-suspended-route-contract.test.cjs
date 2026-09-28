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

// ── PlanLimitModal link hardening ─────────────────────────────────────────────
// The product and media pages pass planUpgrade / planContact straight from the
// URL into this modal, so a crafted link could point its "Request upgrade" /
// "Contact us to upgrade" buttons off-site. The modal must only ever link to a
// same-origin path for upgrades, and to the server-configured contact origin.
console.log("\nPlanLimitModal link hardening");

const linksPath = path.join(webRoot, "src/lib/plan-limit-links.ts");
function loadLinks() {
  const ts = require("typescript");
  const Module = require("node:module");
  const { outputText } = ts.transpileModule(fs.readFileSync(linksPath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: "plan-limit-links.ts",
  });
  const mod = new Module(linksPath, module);
  mod.filename = linksPath;
  mod._compile(outputText, linksPath);
  return mod.exports;
}

test("plan-limit link helpers exist", () => {
  assert.ok(fs.existsSync(linksPath), `Missing: ${linksPath}`);
});

test("upgrade link only ever points at a same-origin path", () => {
  const { safeUpgradeHref } = loadLinks();
  assert.equal(safeUpgradeHref("/admin/plan"), "/admin/plan");
  assert.equal(safeUpgradeHref("/admin/plan?from=jobs"), "/admin/plan?from=jobs");
  for (const hostile of [
    "https://evil.example/upgrade",
    "//evil.example/upgrade",
    "/\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/admin/plan\u0000",
    "javascript:alert(1)",
    " JavaScript:alert(1)",
    "data:text/html,hi",
    "admin/plan",
    "",
    null,
  ]) {
    assert.equal(safeUpgradeHref(hostile), "/admin/plan", `must reject ${JSON.stringify(hostile)}`);
  }
});

test("contact link only accepts the server-configured contact origin", () => {
  const { safeContactHref } = loadLinks();
  const trusted = "https://vexapim.com/contact";
  assert.equal(safeContactHref("https://vexapim.com/contact?tenantKey=t1", trusted), "https://vexapim.com/contact?tenantKey=t1");
  for (const hostile of [
    "https://evil.example/contact",
    "https://vexapim.com.evil.example/contact",
    "https://vexapim.com@evil.example/contact",
    "https://vexapim.com\t@evil.example/contact",
    "http://vexapim.com/contact",
    "javascript:alert(1)",
    "mailto:attacker@evil.example",
    "//evil.example",
    "/contact",
    "",
    null,
  ]) {
    assert.equal(safeContactHref(hostile, trusted), null, `must reject ${JSON.stringify(hostile)}`);
  }
  // No configured contact URL (or a non-https one) means no contact link at all.
  assert.equal(safeContactHref("https://vexapim.com/contact", ""), null);
  assert.equal(safeContactHref("https://vexapim.com/contact", undefined), null);
  assert.equal(safeContactHref("http://vexapim.com/contact", "http://vexapim.com/contact"), null);
});

test("modal sanitizes both links server-side against server config", () => {
  assert.ok(
    modalSource.includes("safeUpgradeHref(upgradeUrl)") &&
      modalSource.includes("safeContactHref(contactUrl, process.env.PIM_COMMERCIAL_CONTACT_URL)") &&
      !/^\s*["']use client["']/m.test(modalSource),
    "PlanLimitModal must be a server component that sanitizes upgradeUrl and contactUrl (the latter against PIM_COMMERCIAL_CONTACT_URL) before rendering them as links.",
  );
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
