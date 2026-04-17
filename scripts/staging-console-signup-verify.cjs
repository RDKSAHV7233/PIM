#!/usr/bin/env node
/* eslint-disable no-console */

const { spawnSync } = require("node:child_process");
const { URL } = require("node:url");

if (String(process.env.USE_CURL_SHIM ?? "").trim().toLowerCase() === "true") {
  require("./staging-fetch-via-curl.cjs");
}

function requireEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name, fallback = "") {
  const value = String(process.env[name] ?? "").trim();
  return value || fallback;
}

function parseArgs(argv) {
  const args = {
    workspace: "",
    email: "",
    password: "",
    displayName: "",
    skipCreate: false,
    verifyOnly: false,
    since: "15m",
    lines: "400",
    timeoutMs: "45000",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = String(argv[index + 1] ?? "").trim();
    switch (token) {
      case "--workspace":
        args.workspace = next;
        index += 1;
        break;
      case "--email":
        args.email = next;
        index += 1;
        break;
      case "--password":
        args.password = next;
        index += 1;
        break;
      case "--display-name":
        args.displayName = next;
        index += 1;
        break;
      case "--since":
        args.since = next;
        index += 1;
        break;
      case "--lines":
        args.lines = next;
        index += 1;
        break;
      case "--timeout-ms":
        args.timeoutMs = next;
        index += 1;
        break;
      case "--skip-create":
        args.skipCreate = true;
        break;
      case "--verify-only":
        args.verifyOnly = true;
        break;
      default:
        break;
    }
  }

  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
    method: options.method ?? "GET",
    headers: options.headers ?? {},
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(Number(options.timeoutMs ?? 20_000)),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return {
    ok: response.ok,
    status: response.status,
    text,
    payload,
  };
}

function runRailwayLogs({ since, lines }) {
  const command = [
    "railway",
    "logs",
    "--service",
    optionalEnv("RAILWAY_API_SERVICE_NAME", "API"),
    "--environment",
    optionalEnv("RAILWAY_ENVIRONMENT_NAME", "Staging"),
    "--since",
    since,
    "--lines",
    lines,
    "--json",
  ]
    .map((segment) => (/\s/.test(segment) ? `"${segment}"` : segment))
    .join(" ");

  const result = spawnSync(command, [], {
    encoding: "utf8",
    env: process.env,
    shell: true,
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "railway logs failed").trim());
  }

  return String(result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function extractVerificationUrl(logEntries, email, workspace) {
  const emailNeedle = String(email).toLowerCase();
  const workspaceNeedle = String(workspace).toLowerCase();
  const urlPattern = /https:\/\/[^\s"]+\/signup\/verify\?token=[^"\s]+/i;

  for (let index = logEntries.length - 1; index >= 0; index -= 1) {
    const entry = logEntries[index];
    const message = String(entry?.message ?? "");
    const lowered = message.toLowerCase();
    if (!lowered.includes(emailNeedle) && !lowered.includes(workspaceNeedle)) {
      continue;
    }
    const match = message.match(urlPattern);
    if (match) {
      return match[0].replace(/[\\",]+$/g, "");
    }
  }

  return "";
}

async function waitForVerificationUrl({ email, workspace, since, lines, timeoutMs }) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const logs = runRailwayLogs({ since, lines });
    const url = extractVerificationUrl(logs, email, workspace);
    if (url) {
      return url;
    }
    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for console verification email for ${email}`);
}

function parseVerifyToken(verifyUrl) {
  const parsed = new URL(verifyUrl);
  return String(parsed.searchParams.get("token") ?? "").trim();
}

async function main() {
  requireEnv("STAGING_BASE_URL");
  requireEnv("STAGING_WEB_URL");
  requireEnv("RAILWAY_TOKEN");

  const args = parseArgs(process.argv.slice(2));
  const now = Date.now();
  const workspace = args.workspace || `staging-signup-${String(now).slice(-8)}`;
  const email = args.email || `${workspace}@example.com`;
  const password = args.password || "SignupConsole123!";
  const displayName = args.displayName || "TEJ Staging Signup";
  const timeoutMs = Number(args.timeoutMs);

  const summary = {
    workspace,
    email,
    created: null,
    verifyUrl: "",
    verified: null,
    login: null,
    checkedAt: new Date().toISOString(),
  };

  if (!args.skipCreate && !args.verifyOnly) {
    summary.created = await request(process.env.STAGING_BASE_URL, "/api/v1/signup/workspace", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: {
        displayName,
        workspaceSlug: workspace,
        adminEmail: email,
        password,
        acceptedTerms: true,
      },
    });

    if (summary.created.status !== 200) {
      throw new Error(`Signup create failed: status=${summary.created.status} payload=${JSON.stringify(summary.created.payload)}`);
    }
  }

  summary.verifyUrl = await waitForVerificationUrl({
    email,
    workspace,
    since: args.since,
    lines: args.lines,
    timeoutMs,
  });

  const token = parseVerifyToken(summary.verifyUrl);
  if (!token) {
    throw new Error(`Unable to parse verification token from ${summary.verifyUrl}`);
  }

  summary.verified = await request(process.env.STAGING_BASE_URL, "/api/v1/signup/verify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: {
      token,
      email,
      workspaceSlug: workspace,
    },
  });

  if (summary.verified.status !== 200) {
    throw new Error(
      `Signup verify failed: status=${summary.verified.status} payload=${JSON.stringify(summary.verified.payload)}`,
    );
  }

  summary.login = await request(process.env.STAGING_BASE_URL, "/api/v1/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: {
      workspaceSlug: workspace,
      userId: email,
      password,
    },
  });

  if (summary.login.status !== 201) {
    throw new Error(`Signup login failed: status=${summary.login.status} payload=${JSON.stringify(summary.login.payload)}`);
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        workspace,
        email,
        verifyUrl: summary.verifyUrl,
        created: summary.created
          ? { status: summary.created.status, payload: summary.created.payload }
          : { skipped: true },
        verified: { status: summary.verified.status, payload: summary.verified.payload },
        login: {
          status: summary.login.status,
          payload: {
            userId: summary.login.payload?.userId,
            tenantId: summary.login.payload?.tenantId,
            role: summary.login.payload?.role,
            expiresInSeconds: summary.login.payload?.expiresInSeconds,
          },
        },
        checkedAt: summary.checkedAt,
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
