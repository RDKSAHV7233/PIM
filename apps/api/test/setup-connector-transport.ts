// Unit specs mock `global.fetch`. Route the connector transport seam to the
// *current* global fetch (read lazily, at call time) so those specs keep
// working unchanged. This test double is never imported by production code;
// the real, pinned transport is exercised by the connector-transport specs,
// which opt out with setConnectorTransportForTesting(null).
//
// Deliberately imports nothing from src/: this file runs before every spec, and
// importing application modules here would load them (and what they import, such
// as node:dns/promises) before a spec's own jest.mock() calls take effect. The
// override key is the same Symbol.for() registry key connector-transport.ts reads.
const TEST_OVERRIDE = Symbol.for("pim.connectorTransport.testOverride");

type TransportInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  redirect: "manual";
  signal?: AbortSignal;
  timeoutMs?: number;
};

(globalThis as Record<symbol, unknown>)[TEST_OVERRIDE] = {
  fetch: (url: string, init: TransportInit) =>
    globalThis.fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      redirect: init.redirect,
      signal: init.signal ?? (init.timeoutMs ? AbortSignal.timeout(init.timeoutMs) : undefined),
    }),
};
