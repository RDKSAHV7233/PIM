/**
 * PIM#766 Part 1: manual resolve, end-to-end through the browser.
 *
 * Requires a live Error Authority observability database — same
 * requirement as apps/api/test/integration/error-authority-runtime.test.cjs
 * — and the Playwright API process must have been started with
 * ERROR_AUTHORITY_ENABLED=true (both are already required for the ops
 * errors page to render anything other than "Storage unavailable"; no new
 * environment requirement is introduced by this spec).
 */
const { test, expect } = require("@playwright/test");
const { PrismaClient } = require("@pim1/observability-db/generated/client");
const { loginViaUi } = require("./helpers/vexa-pim.cjs");

const OBSERVABILITY_DATABASE_URL = String(process.env.OBSERVABILITY_DATABASE_URL ?? "").trim();
const SERVICE_NAME = "vexa-pim-api-e2e-resolve";

function createObservabilityClient() {
  return new PrismaClient({ datasources: { db: { url: OBSERVABILITY_DATABASE_URL } } });
}

async function cleanup(prisma) {
  const issues = await prisma.errorIssue.findMany({ where: { service: SERVICE_NAME }, select: { id: true } });
  const issueIds = issues.map((issue) => issue.id);
  if (issueIds.length === 0) {
    return;
  }
  await prisma.errorIssueTenantImpact.deleteMany({ where: { issueId: { in: issueIds } } });
  await prisma.errorOccurrence.deleteMany({ where: { issueId: { in: issueIds } } });
  await prisma.errorIssue.deleteMany({ where: { id: { in: issueIds } } });
}

test.describe("Internal ops errors — manual resolve", () => {
  test.skip(
    !OBSERVABILITY_DATABASE_URL,
    "OBSERVABILITY_DATABASE_URL is not set — this test requires a live Error Authority observability database.",
  );

  test("admin resolves an open error issue and sees the state chip flip", async ({ page }) => {
    const prisma = createObservabilityClient();
    let issueId;
    try {
      await cleanup(prisma);
      const environment = String(process.env.APP_ENV || process.env.NODE_ENV || "development");
      const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const issue = await prisma.errorIssue.create({
        data: {
          environment,
          runtime: "api",
          service: SERVICE_NAME,
          fingerprintVersion: 1,
          fingerprint: `e2e-resolve-${stamp}`,
          category: "internal",
          safeTitle: "Playwright resolve fixture issue",
          severity: "p2",
          state: "open",
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          occurrenceCount: 1,
          affectedTenantCount: 0,
        },
      });
      issueId = issue.id;

      await loginViaUi(page, "admin");
      await page.goto(
        `/internal/ops/errors?issueId=${encodeURIComponent(issueId)}&service=${encodeURIComponent(SERVICE_NAME)}&dateFrom=${encodeURIComponent(
          new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        )}`,
        { waitUntil: "domcontentloaded" },
      );

      await expect(page.getByText("Playwright resolve fixture issue")).toBeVisible();

      const resolveTrigger = page.getByRole("button", { name: "Resolve", exact: true });
      await expect(resolveTrigger).toBeEnabled();
      await resolveTrigger.click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("eligible for permanent deletion");
      await Promise.all([
        page.waitForURL(/resolveStatus=resolved/),
        dialog.getByRole("button", { name: "Resolve", exact: true }).click(),
      ]);

      await expect(page.getByText("Issue resolved.")).toBeVisible();
      const resolvedRow = page.locator("tr", { hasText: "Playwright resolve fixture issue" });
      await expect(resolvedRow.getByText("resolved", { exact: true })).toBeVisible();

      const resolvedInDb = await prisma.errorIssue.findUnique({ where: { id: issueId }, select: { state: true } });
      expect(resolvedInDb?.state).toBe("resolved");
    } finally {
      try {
        await cleanup(prisma);
      } finally {
        await prisma.$disconnect();
      }
    }
  });
});
