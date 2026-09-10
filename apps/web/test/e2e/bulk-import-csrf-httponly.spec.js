/**
 * Bulk-Import CSRF httpOnly Token Test
 *
 * Regression test for production bug: CSRF_MISMATCH errors when form tries to
 * read httpOnly CSRF token with JavaScript (fails silently, no header sent).
 *
 * Server now accepts: Cookie alone (httpOnly case) OR Cookie + Header matching (double-submit).
 * This test ensures the httpOnly path works end-to-end.
 */
const { test, expect } = require("@playwright/test");
const { apiLogin } = require("./helpers/vexa-pim.cjs");

test.describe("Bulk-Import CSRF httpOnly Token Handling", () => {
  test("form submission works with httpOnly CSRF token (no header needed)", async ({ browser }) => {
    // This test verifies the fix for: "CSRF_MISMATCH when uploading import file"
    // The issue: form tries to read pim_csrf_token cookie (httpOnly), fails, doesn't send header
    // The fix: server accepts httpOnly cookie alone (browser sends it automatically)

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // 1. Login (sets httpOnly pim_csrf_token + pim_access_token cookies)
      await page.goto("http://localhost:3000/");
      await page.click("text=Sign In");
      await page.fill('input[placeholder="Workspace"]', "test-workspace");
      await page.fill('input[placeholder="User ID"]', "admin@test.local");
      await page.fill('input[type="password"]', "Password123!");
      await page.click("button:has-text('Sign In')");
      await page.waitForURL(/\/dashboard|\/operations/);

      // 2. Navigate to import page
      await page.goto("http://localhost:3000/operations/imports");
      await page.waitForLoadState("networkidle");

      // 3. Upload a file and submit validation
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles({
        name: "test.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("title,description\nProduct1,Desc1\nProduct2,Desc2\n"),
      });

      // 4. Click validate button
      await page.click("button:has-text('Validate file')");

      // 5. Wait for validation to complete
      // Should NOT see "CSRF_MISMATCH" error
      // Should see validation results instead
      const errorMsg = await page.locator('text=/CSRF_MISMATCH|csrf.*error/i').isVisible().catch(() => false);
      expect(errorMsg).toBe(false);

      // Verify we got to the validation results view (not error)
      await expect(page.locator("text=/Validation summary|preflight/i")).toBeVisible({ timeout: 10000 });

      console.log("✓ CSRF httpOnly flow working: form submission succeeded without header");
    } finally {
      await context.close();
    }
  });

  test("API fetch without CSRF header succeeds if cookie present", async ({ page }) => {
    // This test directly verifies the server-side CSRF validation logic
    const adminToken = await apiLogin("admin");

    // Simulate: browser sends cookie (automatic), but JS can't read httpOnly so no header
    const response = await page.evaluate(
      async (token) => {
        try {
          const res = await fetch("/api/bulk-import/runs", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              // NO x-csrf-token header (httpOnly prevents JS from reading it)
              // But browser automatically sends pim_csrf_token cookie with same-origin request
            },
            body: JSON.stringify({
              categoryId: "test",
              sourceFormat: "csv",
              sourceName: "test.csv",
              csvContent: "title\nProduct1\n",
              mapping: { title: "title" },
            }),
            credentials: "include", // Ensures cookies are sent
          });
          return { status: res.status, errorText: await res.text() };
        } catch (err) {
          return { error: err.message };
        }
      },
      adminToken,
    );

    // Should NOT be 403 CSRF_MISMATCH
    if (response.status === 403 && response.errorText.includes("CSRF_MISMATCH")) {
      throw new Error(
        `CSRF regression: httpOnly cookie rejected without header. ` +
          `The fix in PR #278 should allow this. Response: ${response.errorText}`,
      );
    }

    // Should succeed (201) or fail with plan limit (400) — NOT CSRF error
    expect([200, 201, 400, 422]).toContain(response.status);
  });

  test("missing CSRF cookie still fails with 403", async ({ page }) => {
    // Ensure we're still protecting against requests with NO CSRF token at all
    // (e.g., forged cross-origin requests that lack the cookie)

    const response = await page.evaluate(async () => {
      try {
        // Force a request from a context that doesn't have the CSRF cookie
        const res = await fetch("/api/bulk-import/runs", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            categoryId: "test",
            sourceFormat: "csv",
            csvContent: "title\nProduct1\n",
          }),
          credentials: "omit", // Explicitly exclude cookies
        });
        return { status: res.status };
      } catch (err) {
        return { error: err.message };
      }
    });

    // Should fail with 403 because no CSRF cookie
    expect(response.status).toBe(403);
  });
});
