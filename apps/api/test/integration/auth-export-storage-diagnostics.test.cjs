#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DIST_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "auth", "auth-export-storage.service.js");
const PUBLIC_MESSAGE = "Account export storage is temporarily unavailable. Please contact support if this persists.";

async function startPlaintextTlsTrap() {
  const server = net.createServer((socket) => {
    socket.write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
    socket.end();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve TLS trap server address.");
  }

  return {
    endpoint: `https://127.0.0.1:${address.port}`,
    close: async () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function run() {
  if (!fs.existsSync(DIST_ENTRY)) {
    throw new Error(`API build output not found at ${DIST_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const tlsTrap = await startPlaintextTlsTrap();
  const originalEnv = {
    APP_ENV: process.env.APP_ENV,
    R2_ENDPOINT: process.env.R2_ENDPOINT,
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
  };

  try {
    process.env.APP_ENV = "staging";
    process.env.R2_ENDPOINT = tlsTrap.endpoint;
    process.env.R2_ACCOUNT_ID = "diagnostics-test";
    process.env.R2_ACCESS_KEY_ID = "diagnostics-test";
    process.env.R2_SECRET_ACCESS_KEY = "diagnostics-test";
    process.env.R2_BUCKET_NAME = "diagnostics-test";

    const { AccountExportStorageError, AuthExportStorageService } = require(DIST_ENTRY);
    const service = new AuthExportStorageService();

    let captured = null;
    try {
      await service.storeAccountExportArtifact({
        tenantId: "diag-tenant",
        userId: "diag-user@example.com",
        jobId: "exp_diag_1",
        format: "json",
        fileContents: "{\"ok\":true}",
      });
    } catch (error) {
      captured = error;
    }

    assert(captured instanceof AccountExportStorageError, `expected AccountExportStorageError, got ${captured}`);
    assert.match(
      captured.message,
      /account_export_storage_tls_handshake_failed/,
      `expected TLS handshake diagnostic, got ${captured.message}`,
    );
    assert.match(
      captured.message,
      /Verify R2 endpoint and TLS settings/,
      `expected actionable TLS guidance, got ${captured.message}`,
    );
    assert.equal(captured.publicMessage, PUBLIC_MESSAGE, "public export error message should remain user-safe");
    assert.doesNotMatch(
      captured.publicMessage,
      /ssl|tls|handshake|eproto|openssl/i,
      `public message should not expose transport internals: ${captured.publicMessage}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: [
            "account_export_storage_tls_failures_normalized",
            "account_export_storage_tls_failures_actionable",
            "account_export_storage_public_message_safe",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await tlsTrap.close().catch(() => undefined);
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

run().catch((error) => {
  console.error("Auth export storage diagnostics test failed:");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
