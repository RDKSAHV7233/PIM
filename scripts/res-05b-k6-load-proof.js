import http from "k6/http";
import { check, fail, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const PROFILE = normalizeProfile(__ENV.RES05B_PROFILE || "smoke");
const API_BASE_URL = normalizeBaseUrl(__ENV.RES05B_API_BASE_URL || "https://vexa-api-slug-vexa-api-staging.up.railway.app/api/v1");
const WORKSPACE = String(__ENV.RES05B_WORKSPACE || "").trim();
const ADMIN_USER = String(__ENV.RES05B_ADMIN_USER || "").trim();
const ADMIN_PASSWORD = String(__ENV.RES05B_ADMIN_PASSWORD || "").trim();
const ENABLE_MUTATIONS = isTrue(__ENV.RES05B_ENABLE_MUTATIONS);

export const options = buildOptions(PROFILE);

const apiRequestDuration = new Trend("res05b_api_request_duration_ms", true);
const healthDuration = new Trend("res05b_health_duration_ms", true);
const catalogDuration = new Trend("res05b_catalog_products_duration_ms", true);
const dashboardDuration = new Trend("res05b_dashboard_duration_ms", true);
const connectorsDuration = new Trend("res05b_connectors_duration_ms", true);
const auditDuration = new Trend("res05b_audit_duration_ms", true);
const http5xxRate = new Rate("res05b_http_5xx_rate");
const http429Rate = new Rate("res05b_http_429_rate");
const requestFailureRate = new Rate("res05b_request_failure_rate");
const queueFailureIncrease = new Counter("res05b_queue_failed_total_observed");
const queueActiveObserved = new Counter("res05b_queue_active_total_observed");
const queueWaitingObserved = new Counter("res05b_queue_waiting_total_observed");

export function setup() {
  const health = request("GET", "/health", null, "health");
  if (!isSuccessfulResponse(health)) {
    fail(`RES-05B setup failed: health returned ${health.status}`);
  }

  const healthJson = parseJson(health);
  const queueRuntime = healthJson && typeof healthJson === "object" ? healthJson.queueRuntime : null;
  if (String(queueRuntime?.backend || "").toLowerCase() !== "bullmq") {
    fail("RES-05B setup failed: health queueRuntime.backend is not bullmq");
  }
  if (queueRuntime?.workerEnabled !== true) {
    fail("RES-05B setup failed: health queueRuntime.workerEnabled is not true");
  }

  const credentialsRequired = PROFILE !== "health";
  if (!credentialsRequired) {
    return { token: null };
  }
  if (!WORKSPACE || !ADMIN_USER || !ADMIN_PASSWORD) {
    fail("RES-05B setup failed: workspace, admin user, and password are required for authenticated profiles");
  }

  const login = request(
    "POST",
    "/auth/login",
    null,
    "login",
    JSON.stringify({
      workspaceSlug: WORKSPACE,
      userId: ADMIN_USER,
      password: ADMIN_PASSWORD,
      expiresInMinutes: 90,
    }),
  );
  if (!isSuccessfulResponse(login)) {
    fail(`RES-05B setup failed: login returned ${login.status}`);
  }
  const payload = parseJson(login);
  const token = payload?.accessToken;
  if (!token) {
    fail("RES-05B setup failed: login response did not contain accessToken");
  }

  return { token };
}

export default function (data) {
  const token = data?.token || null;

  sampleHealth();
  if (PROFILE === "health") {
    sleep(1);
    return;
  }

  sampleReadPath(token);

  if (ENABLE_MUTATIONS) {
    fail("RES-05B mutation workload is intentionally not implemented in this read-only harness.");
  }

  sleep(randomBetween(0.5, 2));
}

export function handleSummary(data) {
  const summaryPath = __ENV.RES05B_SUMMARY_PATH || "artifacts/res-05b/k6-summary.json";
  return {
    stdout: textSummary(data),
    [summaryPath]: JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        profile: PROFILE,
        apiBaseUrl: redactUrl(API_BASE_URL),
        mutationMode: ENABLE_MUTATIONS ? "blocked" : "read_only",
        metrics: data.metrics,
        rootGroup: data.root_group,
      },
      null,
      2,
    ),
  };
}

function sampleHealth() {
  const response = request("GET", "/health", null, "health");
  const payload = parseJson(response);
  collectQueueSnapshot(payload);
}

function sampleReadPath(token) {
  const routes = [
    ["GET", "/catalog/products?slim=true&limit=20", "catalog_products", catalogDuration],
    ["GET", "/taxonomy/categories?limit=20", "taxonomy_categories", null],
    ["GET", "/dashboard/health", "dashboard", dashboardDuration],
    ["GET", "/connectors/installed?limit=10", "connectors", connectorsDuration],
    ["GET", "/billing/usage", "billing_usage", null],
    ["GET", "/audit/logs?limit=10", "audit", auditDuration],
  ];

  const index = Math.floor(Math.random() * routes.length);
  const [method, route, label, trend] = routes[index];
  const response = request(method, route, token, label);
  if (trend) {
    trend.add(response.timings.duration);
  }
}

function request(method, route, token, label, body) {
  const headers = { Accept: "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (body) {
    headers["Content-Type"] = "application/json";
  }

  const response = http.request(method, `${API_BASE_URL}${route}`, body, {
    headers,
    timeout: "30s",
    tags: { res05b_route: label },
  });

  apiRequestDuration.add(response.timings.duration, { res05b_route: label });
  if (label === "health") {
    healthDuration.add(response.timings.duration);
  }

  const is5xx = response.status >= 500 && response.status <= 599;
  const is429 = response.status === 429;
  const ok = response.status >= 200 && response.status <= 399;
  http5xxRate.add(is5xx);
  http429Rate.add(is429);
  requestFailureRate.add(!ok && !is429);

  check(response, {
    [`${label} returned 2xx/3xx or documented 429`]: (res) =>
      (res.status >= 200 && res.status <= 399) || res.status === 429,
  });

  return response;
}

function collectQueueSnapshot(payload) {
  if (!payload || typeof payload !== "object" || !payload.queues || typeof payload.queues !== "object") {
    return;
  }
  for (const queue of Object.values(payload.queues)) {
    queueWaitingObserved.add(Number(queue?.waiting || 0));
    queueActiveObserved.add(Number(queue?.active || 0));
    queueFailureIncrease.add(Number(queue?.failed || 0));
  }
}

function buildOptions(profile) {
  const commonThresholds = {
    "res05b_health_duration_ms": ["p(95)<=200"],
    "res05b_catalog_products_duration_ms": ["p(95)<=2000"],
    "res05b_dashboard_duration_ms": ["p(95)<=3000"],
    "res05b_connectors_duration_ms": ["p(95)<=1000"],
    "res05b_audit_duration_ms": ["p(95)<=2000"],
    "res05b_http_5xx_rate": ["rate<=0.005"],
    "res05b_request_failure_rate": ["rate<=0.005"],
  };

  const profiles = {
    health: {
      scenarios: {
        health: {
          executor: "constant-vus",
          vus: 1,
          duration: "1m",
        },
      },
      thresholds: {
        "res05b_health_duration_ms": ["p(95)<=200"],
        "res05b_http_5xx_rate": ["rate==0"],
      },
    },
    smoke: {
      scenarios: {
        smoke: {
          executor: "constant-vus",
          vus: 1,
          duration: "2m",
        },
      },
      thresholds: commonThresholds,
    },
    baseline: {
      scenarios: {
        baseline: {
          executor: "constant-vus",
          vus: 5,
          duration: "15m",
        },
      },
      thresholds: commonThresholds,
    },
    expected: {
      scenarios: {
        expected: {
          executor: "ramping-vus",
          stages: [
            { duration: "5m", target: 25 },
            { duration: "20m", target: 25 },
            { duration: "5m", target: 0 },
          ],
        },
      },
      thresholds: commonThresholds,
    },
    burst: {
      scenarios: {
        burst: {
          executor: "ramping-vus",
          stages: [
            { duration: "2m", target: 50 },
            { duration: "6m", target: 50 },
            { duration: "2m", target: 0 },
          ],
        },
      },
      thresholds: commonThresholds,
    },
    sustained: {
      scenarios: {
        sustained: {
          executor: "constant-vus",
          vus: 25,
          duration: "60m",
        },
      },
      thresholds: commonThresholds,
    },
  };

  return profiles[profile];
}

function normalizeProfile(value) {
  const profile = String(value || "").trim().toLowerCase();
  const allowed = new Set(["health", "smoke", "baseline", "expected", "burst", "sustained"]);
  if (!allowed.has(profile)) {
    throw new Error(`Unsupported RES05B_PROFILE '${value}'.`);
  }
  return profile;
}

function normalizeBaseUrl(value) {
  const normalized = String(value || "").trim().replace(/\/+$/, "");
  if (!normalized) {
    throw new Error("RES05B_API_BASE_URL is required.");
  }
  return normalized;
}

function isTrue(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function parseJson(response) {
  try {
    return response.json();
  } catch {
    return null;
  }
}

function redactUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "missing-url";
  }
  return text.replace(/:\/\/([^:@/]+):([^@/]+)@/, "://redacted:redacted@");
}

function isSuccessfulResponse(response) {
  return response && response.status >= 200 && response.status <= 399;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function textSummary(data) {
  const metrics = data.metrics || {};
  const lines = [
    "",
    "RES-05B k6 load proof summary",
    `profile=${PROFILE}`,
    `apiBaseUrl=${redactUrl(API_BASE_URL)}`,
    `mutationMode=${ENABLE_MUTATIONS ? "blocked" : "read_only"}`,
    metricLine(metrics, "http_req_duration"),
    metricLine(metrics, "res05b_health_duration_ms"),
    metricLine(metrics, "res05b_catalog_products_duration_ms"),
    metricLine(metrics, "res05b_dashboard_duration_ms"),
    metricLine(metrics, "res05b_http_5xx_rate"),
    "",
  ];
  return `${lines.filter(Boolean).join("\n")}\n`;
}

function metricLine(metrics, name) {
  const values = metrics[name]?.values;
  if (!values) {
    return `${name}=not_recorded`;
  }
  return `${name}=${JSON.stringify(values)}`;
}
