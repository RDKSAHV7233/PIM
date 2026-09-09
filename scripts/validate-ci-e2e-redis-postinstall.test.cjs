const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
const e2eStart = workflow.indexOf("\n  e2e:\n");

if (e2eStart < 0) {
  throw new Error("CI workflow must define the e2e job.");
}

const e2eJob = workflow.slice(e2eStart);

if (!e2eJob.includes('REDISMS_DISABLE_POSTINSTALL: "true"')) {
  throw new Error("CI e2e must disable redis-memory-server postinstall downloads.");
}

if (!e2eJob.includes("image: redis:7") || !e2eJob.includes("REDIS_URL: redis://localhost:6379")) {
  throw new Error("CI e2e must retain its live Redis service contract.");
}

if (/apt-get\s+(?:update|install[^\n]*redis-server)/.test(e2eJob)) {
  throw new Error("CI e2e must not install a redundant host Redis package through apt.");
}

const disableGoogleSource = e2eJob.indexOf("- name: Disable unrelated Google Chrome apt source");
const installPlaywright = e2eJob.indexOf("- name: Install Playwright browsers");
if (disableGoogleSource < 0 || installPlaywright < 0 || disableGoogleSource >= installPlaywright) {
  throw new Error("CI e2e must disable the unrelated Google Chrome apt source before installing Playwright.");
}

if (
  !e2eJob.includes("/etc/apt/sources.list.d/google-chrome*.list") ||
  !e2eJob.includes("dl.google.com/linux/chrome")
) {
  throw new Error("CI e2e Google source guard must remain narrowly scoped to Chrome's apt list.");
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      validated: [
        "e2e_disables_redis_memory_server_postinstall",
        "e2e_retains_live_redis_service",
        "e2e_has_no_redundant_apt_redis_install",
        "e2e_disables_unrelated_google_source_before_playwright_install",
      ],
    },
    null,
    2,
  ),
);
