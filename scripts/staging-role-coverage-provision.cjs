#!/usr/bin/env node
/* eslint-disable no-console */

function requireEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

function normalizeApiBaseUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const url = new URL(raw);
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  if (!/\/api\/v1$/i.test(normalizedPath)) {
    url.pathname = `${normalizedPath === "/" ? "" : normalizedPath}/api/v1`;
  }
  return url.toString().replace(/\/+$/, "");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertStatus(result, expected, context) {
  const expectedList = Array.isArray(expected) ? expected : [expected];
  if (!expectedList.includes(result.status)) {
    throw new Error(`${context} failed: expected ${expectedList.join("/")} got ${result.status}; payload=${JSON.stringify(result.payload)}`);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(baseUrl, path, options = {}) {
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
        payload = { raw: text.slice(0, 500) };
      }
      return { status: response.status, payload };
    } catch (error) {
      lastError = error;
      if (attempt < retries) await wait(Math.min(1_000 * (attempt + 1), 5_000));
    }
  }
  throw lastError;
}

function roleConfig(role, defaultWorkspace) {
  const prefix = role.toUpperCase();
  return {
    role,
    workspaceSlug: optionalEnv(`STAGING_${prefix}_WORKSPACE`, defaultWorkspace) || defaultWorkspace,
    userId: requireEnv(`STAGING_${prefix}_USER`),
    password: requireEnv(`STAGING_${prefix}_PASSWORD`),
  };
}

async function login(baseUrl, workspaceSlug, userId, password, context) {
  const result = await requestJson(baseUrl, "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { workspaceSlug, userId, password },
    retries: 2,
  });
  assertStatus(result, [200, 201], context);
  assert(result.payload?.accessToken, `${context} response missing access token`);
  return String(result.payload.accessToken);
}

async function ensureRoleUser(baseUrl, adminToken, input) {
  const headers = {
    authorization: `Bearer ${adminToken}`,
    "content-type": "application/json",
  };
  const created = await requestJson(baseUrl, "/admin/workspace/users", {
    method: "POST",
    headers,
    body: { userId: input.userId, role: input.role },
    retries: 2,
  });
  if (created.status === 409 && String(created.payload?.error ?? "") === "USER_ALREADY_EXISTS") {
    const roleUpdated = await requestJson(baseUrl, `/admin/workspace/users/${encodeURIComponent(input.userId)}/role`, {
      method: "PATCH",
      headers,
      body: { role: input.role },
      retries: 2,
    });
    assertStatus(roleUpdated, 200, `update ${input.role} user role`);
  } else {
    assertStatus(created, 201, `create ${input.role} user`);
  }

  const passwordSet = await requestJson(baseUrl, `/admin/workspace/users/${encodeURIComponent(input.userId)}/password`, {
    method: "POST",
    headers,
    body: { password: input.password },
    retries: 2,
  });
  assertStatus(passwordSet, 200, `set ${input.role} user password`);

  await login(baseUrl, input.workspaceSlug, input.userId, input.password, `${input.role} login after provisioning`);
  return {
    role: input.role,
    workspaceSlug: input.workspaceSlug,
    userId: input.userId,
    createdOrUpdated: true,
    passwordPrinted: false,
    loginVerified: true,
  };
}

async function main() {
  const baseUrl = normalizeApiBaseUrl(requireEnv("STAGING_BASE_URL"));
  const workspaceSlug = requireEnv("STAGING_SMOKE_WORKSPACE").toLowerCase();
  const adminToken = await login(
    baseUrl,
    workspaceSlug,
    requireEnv("STAGING_SMOKE_USER"),
    requireEnv("STAGING_SMOKE_PASSWORD"),
    "admin login",
  );

  const results = [];
  for (const role of ["viewer", "editor", "reviewer"]) {
    results.push(await ensureRoleUser(baseUrl, adminToken, roleConfig(role, workspaceSlug)));
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        suite: "STAGING_ROLE_COVERAGE_PROVISION",
        roles: results,
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("Staging role coverage provisioning failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
