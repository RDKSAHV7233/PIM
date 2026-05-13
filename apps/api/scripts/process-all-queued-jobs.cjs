#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Process all queued/ready Shopify export jobs in the default tenant.
 */

const BASE_URL = process.env.API_BASE_URL ?? "http://localhost:4000/api/v1";
const USER_ID = process.env.SEED_USER_ID ?? "admin@pim1.local";
const WORKSPACE_SLUG = process.env.SEED_WORKSPACE_SLUG ?? "default";
const PASSWORD = process.env.SEED_PASSWORD ?? "vexa-pim-demo-password";
const CONCURRENCY = 5;

async function api(method, path, token, body) {
  const headers = { "Accept": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const opts = { method, headers, signal: AbortSignal.timeout(30_000) };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, data: json };
}

async function login() {
  const res = await api("POST", "/auth/login", null, {
    userId: USER_ID, workspaceSlug: WORKSPACE_SLUG, password: PASSWORD, expiresInMinutes: 120,
  });
  if (res.status !== 201 || !res.data?.accessToken) throw new Error(`Login failed: ${res.status}`);
  return res.data.accessToken;
}

async function getQueuedJobs(token) {
  const res = await api("GET", "/marketplace/export-jobs?status=queued&limit=200", token);
  if (res.status !== 200) {
    console.log(`Warning: queued jobs endpoint returned ${res.status} — trying ready_to_submit`);
    const res2 = await api("GET", "/marketplace/export-jobs?status=ready_to_submit&limit=200", token);
    if (res2.status !== 200) throw new Error(`Cannot get jobs: ${res2.status}`);
    return res2.data?.items ?? res2.data ?? [];
  }
  const queued = res.data?.items ?? res.data ?? [];

  const res2 = await api("GET", "/marketplace/export-jobs?status=ready_to_submit&limit=200", token);
  const ready = res2.status === 200 ? (res2.data?.items ?? res2.data ?? []) : [];

  return [...queued, ...ready];
}

async function processBatch(items, fn, concurrency) {
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    await Promise.all(batch.map(fn));
  }
}

async function main() {
  console.log(`Processing all queued Shopify export jobs via ${BASE_URL}`);
  const token = await login();
  console.log("Authenticated OK");

  const jobs = await getQueuedJobs(token);
  const shopifyJobs = jobs.filter(j => j.channel === "shopify" || !j.channel);
  console.log(`Found ${shopifyJobs.length} queued/ready jobs`);

  if (shopifyJobs.length === 0) {
    console.log("No jobs to process.");
    return 0;
  }

  let succeeded = 0;
  let failed = 0;

  await processBatch(shopifyJobs, async (job) => {
    process.stdout.write(`  Processing ${job.id} (${job.channel})... `);
    try {
      const res = await api("POST", `/marketplace/export-jobs/${job.id}/process`, token, {});
      if (res.status === 200 || res.status === 201) {
        succeeded++;
        console.log(`OK status=${res.data?.status}`);
      } else {
        failed++;
        console.log(`FAIL ${res.status} ${JSON.stringify(res.data).slice(0, 100)}`);
      }
    } catch (err) {
      failed++;
      console.log(`ERR ${err instanceof Error ? err.message : String(err)}`);
    }
  }, CONCURRENCY);

  console.log("\n────────────────────────────────────────");
  console.log(`Processed: ${succeeded}  Failed: ${failed}`);
  return failed > 0 ? 1 : 0;
}

main().then(code => process.exit(code)).catch(err => {
  console.error("Process failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
