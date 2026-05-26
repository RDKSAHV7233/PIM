const { defineConfig, devices } = require("@playwright/test");
const path = require("node:path");

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001";
const apiURL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:4001/api/v1";

// Per-role storageState paths written by global-setup and consumed by specs.
// Each file holds cookies + localStorage for a pre-authenticated session, so
// individual tests skip the login round-trip and start with a clean, isolated context.
const STORAGE_STATE_DIR = path.join(__dirname, ".runlogs", "storage-state");
const storageStatePaths = {
  admin: path.join(STORAGE_STATE_DIR, "admin.json"),
  editor: path.join(STORAGE_STATE_DIR, "editor.json"),
  reviewer: path.join(STORAGE_STATE_DIR, "reviewer.json"),
  viewer: path.join(STORAGE_STATE_DIR, "viewer.json"),
};

// defineConfig returns the config object. We attach storageStatePaths after so
// specs can import it via require('../../playwright.config.cjs').storageStatePaths
// without a separate constants file.
const config = defineConfig({
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
      timeout: 600_000,
      reuseExistingServer: true,
      cwd: __dirname,
    },
    {
      command: "node scripts/start-playwright-web.cjs",
      url: `${baseURL}/login`,
      timeout: 600_000,
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
    // Each spec file gets its own fresh browser context — no accumulated cookies,
    // localStorage, or event listeners from previous specs. Specs that need a
    // logged-in session declare `test.use({ storageState: storageStatePaths.admin })`
    // at the top of the file, which reuses the pre-authenticated snapshot written
    // by global-setup without performing a full login on every test.
    storageState: undefined,
  },
  metadata: {
    baseURL,
    apiURL,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    // Firefox and WebKit run in CI only. Use --project=chromium locally.
    ...(process.env.CI
      ? [
          { name: "firefox", use: { ...devices["Desktop Firefox"] } },
          { name: "webkit", use: { ...devices["Desktop Safari"] } },
        ]
      : []),
  ],
});

config.storageStatePaths = storageStatePaths;
module.exports = config;
