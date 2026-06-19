#!/usr/bin/env node

const { existsSync } = require("node:fs");
const Module = require("node:module");
const net = require("node:net");
const path = require("node:path");

const apiRoot = path.resolve(__dirname, "..");
const candidates = [
  path.join(apiRoot, "dist", "main.js"),
  path.join(apiRoot, "dist-feature", "main.js"),
];

const entry = candidates.find((candidate) => existsSync(candidate));
const bootDebugEnabled =
  String(process.env.PLAYWRIGHT_BOOT_DEBUG ?? "").trim() === "1" ||
  String(process.env.API_BOOT_DEBUG ?? "").trim().toLowerCase() === "true";

function bootDebug(message, meta) {
  if (!bootDebugEnabled) {
    return;
  }
  const payload = meta ? ` ${JSON.stringify(meta)}` : "";
  console.log(`[api-entry] ${message}${payload}`);
}

if (!entry) {
  console.error(
    [
      "Unable to locate a built API entrypoint.",
      "Checked:",
      ...candidates.map((candidate) => `- ${candidate}`),
      "Run `npm run build --workspace @pim1/api` before starting the API.",
    ].join("\n"),
  );
  process.exit(1);
}

if (bootDebugEnabled) {
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const originalListen = net.Server.prototype.listen;
  let loadDepth = 0;

  Module._load = function patchedLoad(request, parent, isMain) {
    let resolved = request;
    try {
      resolved = originalResolveFilename.call(this, request, parent, isMain);
    } catch {
      // Keep the original request string when Node fails before resolution.
    }
    const shouldTrace =
      typeof resolved === "string" &&
      resolved.startsWith(apiRoot) &&
      resolved.includes(`${path.sep}dist${path.sep}`);
    if (shouldTrace) {
      loadDepth += 1;
      bootDebug("module:load:start", {
        depth: loadDepth,
        request,
        resolved,
      });
    }
    try {
      return originalLoad.apply(this, arguments);
    } finally {
      if (shouldTrace) {
        bootDebug("module:load:done", {
          depth: loadDepth,
          resolved,
        });
        loadDepth = Math.max(0, loadDepth - 1);
      }
    }
  };

  net.Server.prototype.listen = function patchedListen(...args) {
    bootDebug("server.listen", {
      args: args.slice(0, 3).map((value) =>
        typeof value === "function" ? "[callback]" : value,
      ),
    });
    return originalListen.apply(this, args);
  };
  process.on("uncaughtException", (error) => {
    console.error("[api-entry] uncaughtException", error);
  });
  process.on("unhandledRejection", (error) => {
    console.error("[api-entry] unhandledRejection", error);
  });
  setTimeout(() => {
    const handles = typeof process._getActiveHandles === "function"
      ? process._getActiveHandles().map((handle) => handle?.constructor?.name ?? typeof handle)
      : [];
    const requests = typeof process._getActiveRequests === "function"
      ? process._getActiveRequests().map((request) => request?.constructor?.name ?? typeof request)
      : [];
    bootDebug("active-state", { handles, requests });
  }, 10_000).unref();
}

bootDebug("entry:resolved", { entry });
require(entry);
bootDebug("entry:required");
