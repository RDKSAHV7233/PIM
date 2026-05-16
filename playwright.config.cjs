const { defineConfig } = require("@playwright/test");

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001";
const apiURL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:4001/api/v1";

module.exports = defineConfig({
  testDir: "./apps/web/test/e2e",
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: ".runlogs/playwright-report", open: "never" }],
  ],
  outputDir: ".runlogs/playwright-test-results",
  globalSetup: require.resolve("./apps/web/test/e2e/helpers/global-setup.cjs"),
  webServer: [
    {
      command: "node scripts/start-playwright-api.cjs",
      url: `${apiURL}/health`,
      timeout: 300_000,
      reuseExistingServer: true,
      cwd: __dirname,
    },
    {
      command: "node scripts/start-playwright-web.cjs",
      url: `${baseURL}/login`,
      timeout: 300_000,
      reuseExistingServer: true,
      cwd: __dirname,
    },
  ],
  use: {
    baseURL,
    storageState: undefined,
    extraHTTPHeaders: {
      "x-playwright-suite": "vexa-pim-e2e",
    },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  metadata: {
    baseURL,
    apiURL,
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
      },
    },
  ],
});
