/* eslint-disable no-console */

async function assertReachable(url, expectedStatus, context) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== expectedStatus) {
    const body = await response.text();
    throw new Error(`${context} failed: expected ${expectedStatus}, got ${response.status}; body=${body.slice(0, 300)}`);
  }
}

module.exports = async function globalSetup() {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001";
  const apiURL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:4001/api/v1";
  const workspace = process.env.PLAYWRIGHT_WORKSPACE || "default";

  if (!workspace || workspace.trim().length === 0) {
    throw new Error("PLAYWRIGHT_WORKSPACE is required for Vexa PIM E2E.");
  }

  await assertReachable(`${baseURL}/login`, 200, "web login reachability");
  await assertReachable(`${apiURL}/health`, 200, "api health reachability");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        suite: "playwright-e2e",
        baseURL,
        apiURL,
        workspace,
      },
      null,
      2,
    ),
  );
};
