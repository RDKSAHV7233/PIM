const { test, expect } = require("@playwright/test");
const { loginViaUi } = require("./helpers/vexa-pim.cjs");

// CTO review remediation (CODE-006): the review claimed "/reports browser final
// URL stayed /reports while showing Dashboard" — but reports/page.tsx,
// settings/page.tsx, and catalog/page.tsx all use a plain `redirect()` from
// next/navigation, which is a standard server-side RSC redirect and should
// update the address bar. This spec asserts the final URL for all three
// stubs; if it passes cleanly (expected, given the code), the original claim
// was a browser-tooling artifact from that review session, not a real bug.

const REDIRECT_STUBS = [
  { from: "/reports", to: /\/dashboard$/ },
  { from: "/settings", to: /\/admin$/ },
  { from: "/catalog", to: /\/catalog\/products$/ },
];

test.describe("legacy redirect stubs", () => {
  for (const { from, to } of REDIRECT_STUBS) {
    test(`${from} redirects to a final URL matching ${to}`, async ({ page }) => {
      await loginViaUi(page, "admin");
      await page.goto(from, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(to);
    });
  }
});
