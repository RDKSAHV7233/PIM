#!/usr/bin/env node
/* eslint-disable no-console */
const { spawnSync } = require("node:child_process");
const net = require("node:net");

function resolveDatabaseUrl() {
  const direct = String(process.env.DATABASE_URL_DIRECT ?? "").trim();
  if (direct) {
    return { url: direct, source: "DATABASE_URL_DIRECT" };
  }
  const pooled = String(process.env.DATABASE_URL ?? "").trim();
  if (pooled) {
    return { url: pooled, source: "DATABASE_URL" };
  }
  throw new Error("Neither DATABASE_URL_DIRECT nor DATABASE_URL is set.");
}

function parseHostPort(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const host = parsed.hostname;
  const port = Number(parsed.port || "5432");
  if (!host || !Number.isFinite(port) || port <= 0) {
    throw new Error("Invalid database URL host/port.");
  }
  return { host, port };
}

function checkTcp(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (ok, reason) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ ok, reason });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true, "connected"));
    socket.once("timeout", () => finish(false, `timeout after ${timeoutMs}ms`));
    socket.once("error", (err) => finish(false, err.message || "connection error"));
    socket.connect(port, host);
  });
}

async function main() {
  const { url, source } = resolveDatabaseUrl();
  const { host, port } = parseHostPort(url);

  console.log(`[prisma:migrate:deploy] using ${source} (${host}:${port})`);
  const connectivity = await checkTcp(host, port);
  if (!connectivity.ok) {
    console.error(
      `[prisma:migrate:deploy] database unreachable at ${host}:${port}: ${connectivity.reason}`,
    );
    console.error(
      "[prisma:migrate:deploy] start Postgres first (e.g. `npm run infra:up`) or fix DB env vars.",
    );
    process.exit(1);
  }

  const result = process.platform === "win32"
    ? spawnSync(
        "cmd.exe",
        ["/d", "/s", "/c", "npx prisma migrate deploy --schema packages/db/prisma/schema.prisma"],
        {
          stdio: "inherit",
          env: {
            ...process.env,
            DATABASE_URL: url,
          },
        },
      )
    : spawnSync(
        "npx",
        ["prisma", "migrate", "deploy", "--schema", "packages/db/prisma/schema.prisma"],
        {
          stdio: "inherit",
          env: {
            ...process.env,
            DATABASE_URL: url,
          },
        },
      );

  if (result.error) {
    console.error("[prisma:migrate:deploy] child process failed:", result.error.message);
    process.exit(1);
  }

  if (typeof result.status === "number") {
    process.exit(result.status);
  }
  process.exit(1);
}

main().catch((error) => {
  console.error("[prisma:migrate:deploy] failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
