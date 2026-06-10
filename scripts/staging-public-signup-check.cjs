#!/usr/bin/env node
/* eslint-disable no-console */

function requireEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name) {
  return String(process.env[name] ?? "").trim();
}

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  return raw === "true";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(baseUrl, path, options = {}) {
  const retries = Number(options.retries ?? 0);
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers: options.headers ?? {},
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = text;
      }
      if ([502, 503, 504].includes(response.status) && attempt < retries) {
        await wait(1_000 * (attempt + 1));
        continue;
      }
      return { status: response.status, payload, text };
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        throw error;
      }
      await wait(750 * (attempt + 1));
    }
  }

  throw lastError ?? new Error("request failed");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(
      `${context} failed: expected ${expected}, got ${result.status}; payload=${JSON.stringify(result.payload)}`,
    );
  }
}

async function main() {
  const apiBaseUrl = requireEnv("STAGING_BASE_URL").replace(/\/+$/, "");
  const webBaseUrl = optionalEnv("STAGING_WEB_URL").replace(/\/+$/, "");
  const signupEnabledRaw = String(process.env.STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED ?? "").trim();
  const signupExpectationConfigured = signupEnabledRaw !== "";
  const expectedEnabled = signupExpectationConfigured ? signupEnabledRaw.toLowerCase() === "true" : false;
  const expectedEnv = String(process.env.STAGING_EXPECTED_ENV ?? "staging").trim();
  const probeSlug = `tej-signup-probe-${Date.now().toString().slice(-8)}`;
  const probeEmail = `staging-signup-probe-${Date.now()}@example.com`;

  const health = await request(apiBaseUrl, "/api/v1/health", { retries: 3 });
  assertStatus(health, 200, "health");
  assert(health.payload?.status === "ok", `health payload invalid: ${JSON.stringify(health.payload)}`);
  assert(
    String(health.payload?.env ?? "") === expectedEnv,
    `health env mismatch: expected=${expectedEnv} got=${String(health.payload?.env ?? "")}`,
  );

  const validated = [
    "health_status_ok",
    "health_env_matches_expected",
  ];

  // When the secret is not set, probe the endpoint and log the state but do not
  // assert — the staging environment may be in a transitional state while ops
  // item #8 (STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED) is pending configuration.
  if (!signupExpectationConfigured) {
    const availability = await request(
      apiBaseUrl,
      `/api/v1/signup/workspace/availability?workspaceSlug=${encodeURIComponent(probeSlug)}`,
      { retries: 2 },
    );
    const actuallyEnabled = availability.status === 200;
    console.log(
      JSON.stringify(
        {
          status: "ok",
          mode: "signup_detection_only",
          warning:
            "STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED is not set — signup state observed but not enforced. " +
            "Set this secret (ops runbook item #8) to enable strict assertion.",
          detectedEnabled: actuallyEnabled,
          availabilityStatus: availability.status,
          validated,
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!expectedEnabled) {
    const availability = await request(
      apiBaseUrl,
      `/api/v1/signup/workspace/availability?workspaceSlug=${encodeURIComponent(probeSlug)}`,
      { retries: 2 },
    );
    assertStatus(availability, 404, "signup availability hidden when feature disabled");
    validated.push("signup_api_hidden_when_disabled");

    const verify = await request(apiBaseUrl, "/api/v1/signup/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { token: "bogus-token" },
      retries: 2,
    });
    assertStatus(verify, 404, "signup verify hidden when feature disabled");
    validated.push("signup_verify_hidden_when_disabled");

    if (webBaseUrl) {
      const signupPage = await request(webBaseUrl, "/signup", { retries: 2 });
      assertStatus(signupPage, 404, "signup page hidden when feature disabled");
      validated.push("signup_page_hidden_when_disabled");
    }

    console.log(
      JSON.stringify(
        {
          status: "ok",
          mode: "signup_disabled",
          validated,
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    return;
  }

  const availability = await request(
    apiBaseUrl,
    `/api/v1/signup/workspace/availability?workspaceSlug=${encodeURIComponent(probeSlug)}`,
    { retries: 2 },
  );
  assertStatus(availability, 200, "signup availability when feature enabled");
  assert(
    typeof availability.payload?.available === "boolean",
    `signup availability payload invalid: ${JSON.stringify(availability.payload)}`,
  );
  validated.push("signup_availability_endpoint_enabled");

  const createSignup = await request(apiBaseUrl, "/api/v1/signup/workspace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {
      displayName: "Vexa staging signup probe",
      workspaceSlug: probeSlug,
      adminEmail: probeEmail,
      password: "Signup#2026",
      acceptedTerms: false,
    },
    retries: 2,
  });
  assertStatus(createSignup, 400, "signup create validation when feature enabled");
  assert(
    String(createSignup.payload?.error ?? "") === "TERMS_ACCEPTANCE_REQUIRED",
    `signup create validation payload invalid: ${JSON.stringify(createSignup.payload)}`,
  );
  validated.push("signup_create_endpoint_rejects_missing_terms_without_creating_state");

  const verify = await request(apiBaseUrl, "/api/v1/signup/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { token: "bogus-token" },
    retries: 2,
  });
  assertStatus(verify, 401, "signup verify validation when feature enabled");
  assert(
    String(verify.payload?.error ?? "") === "SIGNUP_VERIFICATION_TOKEN_INVALID",
    `signup verify validation payload invalid: ${JSON.stringify(verify.payload)}`,
  );
  validated.push("signup_verify_endpoint_rejects_invalid_token");

  if (webBaseUrl) {
    const signupPage = await request(webBaseUrl, "/signup", { retries: 2 });
    assertStatus(signupPage, 200, "signup page when feature enabled");
    assert(
      String(signupPage.text).includes("Create your Vexa PIM workspace"),
      "signup page did not include the expected heading",
    );
    validated.push("signup_page_renders_when_enabled");
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        mode: "signup_enabled",
        webChecks: webBaseUrl ? "included" : "skipped_no_staging_web_url",
        validated,
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
