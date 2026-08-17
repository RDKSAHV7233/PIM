/* eslint-disable no-console */
// PIM#578 — controlled causal reproduction, not a static source-pattern assertion.
//
// This test does NOT hand-construct a mock error. It starts a real HTTP server that
// accepts the TCP connection and then genuinely never responds, then issues a real
// fetch() with a real AbortSignal.timeout() against it — the exact same primitives
// apps/web/src/lib/api/core.ts's fetchJson() uses in production
// (FETCH_TIMEOUT_MS = 20_000). That produces a real DOMException named "TimeoutError",
// the same object shape a genuinely slow backend call would throw. Empirically
// confirmed by hand before writing this file (Node 24, `err.constructor.name` ===
// "DOMException", `err.name` === "TimeoutError", `err instanceof Error` === true,
// `err.message` === "The operation was aborted due to timeout").
//
// It then feeds that real rejection into the actual loadSharedRead() implementation
// (imported from the module, not copied/reimplemented here) and asserts on the
// documented invariant: a fetch timeout on any of the Products page's four parallel
// shared reads must degrade to { state: "unavailable" } — the page's own existing
// fallback UI for exactly this situation — never escape as an unhandled exception.
//
// Run via: TS_NODE_PROJECT=apps/web/test/integration/tsconfig.node-test.json
//          node -r ts-node/register apps/web/test/integration/catalog-shared-read-timeout-classification.test.ts
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { loadSharedRead } from "../../src/lib/catalog-shared-read";

async function withHangingServer<T>(fn: (url: string) => Promise<T>): Promise<T> {
  // Deliberately never calls res.end()/res.write() — the request stays open until
  // the client aborts it, so the only way fetch() settles is via AbortSignal.timeout().
  const server = http.createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo | null;
  if (!address) {
    throw new Error("Failed to bind an ephemeral port for the hanging test server.");
  }
  const url = `http://127.0.0.1:${address.port}/`;
  try {
    return await fn(url);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function run(): Promise<void> {
  const result = await withHangingServer((url) => {
    const slowRequest = fetch(url, { signal: AbortSignal.timeout(80) });
    return loadSharedRead(slowRequest);
  });

  if (result.state !== "unavailable") {
    throw new Error(
      `Expected a real fetch timeout to degrade to { state: "unavailable" }, but ` +
        `loadSharedRead() resolved with state=${JSON.stringify(result.state)} instead. ` +
        "The timeout error was classified as something other than 'unavailable' — check " +
        "isCatalogProductsApiUnavailable()'s handling of TimeoutError/AbortError.",
    );
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: ["real_fetch_timeout_classified_as_unavailable_not_escaped"],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

run().catch((error: unknown) => {
  console.error("Catalog shared-read timeout classification test failed:");
  if (error instanceof Error) {
    console.error(`${error.name}: ${error.message}`);
    console.error(
      "If this is a TimeoutError/AbortError, it means the real timeout escaped " +
        "loadSharedRead() uncaught instead of resolving to { state: 'unavailable' } — this IS " +
        "PIM#578's reproduction. If it's some other error (e.g. a module-resolution failure), " +
        "the test harness itself is broken, not the classifier under test.",
    );
    if (error.stack) {
      console.error(error.stack);
    }
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
});
