import https from "node:https";
import net from "node:net";
import type { Duplex } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import {
  ConnectorTargetUnsafeError,
  isConnectorTargetSecurityError,
} from "./connector-target-errors";
import { fetchWithValidatedRedirects } from "./validated-redirect-fetch";
import {
  PinnedUndiciTransport,
  canonicalAddress,
  verifyConnectedAddress,
  type ValidatedCandidate,
} from "./pinned-undici-transport";

// The URL validator's DNS (c-ares) is irrelevant here; the transport under test
// resolves through the injected resolver. Stub it so no real query is made.
jest.mock("node:dns/promises", () => ({
  resolve4: jest.fn().mockResolvedValue(["93.184.216.34"]),
  resolve6: jest.fn().mockRejectedValue(new Error("ENODATA")),
}));

// Real undici (npm), real TLS, real local servers. Nothing here mocks the network:
// the proof that "no connection is made to an address outside the validated set" is
// a server listening on the forbidden address that must see zero connections.

const FIXTURES = path.join(__dirname, "../../../test/fixtures/tls");
const read = (name: string) => fs.readFileSync(path.join(FIXTURES, name));
const CA = read("ca.crt");
const REQUIRE_FULL_LOOPBACK = process.env.REQUIRE_FULL_LOOPBACK === "1";

type TestServer = {
  server: https.Server;
  port: number;
  host: string;
  tcpConnections: number;
  tlsConnections: number;
  snis: string[];
  hostHeaders: string[];
  open: Set<Duplex>;
  close(): Promise<void>;
};

async function startServer(certName: "pin" | "other", host: string, port = 0): Promise<TestServer> {
  const state = { tcpConnections: 0, tlsConnections: 0, snis: [] as string[], hostHeaders: [] as string[], open: new Set<Duplex>() };
  const server = https.createServer(
    {
      key: read(`${certName}.key`),
      cert: read(`${certName}.crt`),
      SNICallback: (servername, cb) => {
        state.snis.push(servername);
        cb(null, undefined);
      },
    },
    (req, res) => {
      state.hostHeaders.push(String(req.headers.host));
      if (req.url === "/redir") {
        res.writeHead(307, { location: "/hello" });
        res.end();
        return;
      }
      res.end("ok");
    },
  );
  server.on("connection", (s) => {
    state.tcpConnections += 1;
    state.open.add(s);
    s.on("close", () => state.open.delete(s));
  });
  server.on("secureConnection", () => {
    state.tlsConnections += 1;
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  const actualPort = (server.address() as net.AddressInfo).port;
  return Object.assign(state, {
    server,
    port: actualPort,
    host,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  }) as unknown as TestServer;
}

async function tryStart(certName: "pin" | "other", host: string, port = 0): Promise<TestServer | undefined> {
  try {
    return await startServer(certName, host, port);
  } catch {
    return undefined;
  }
}

function need(value: unknown, what: string): void {
  if (!value && REQUIRE_FULL_LOOPBACK) throw new Error(`REQUIRE_FULL_LOOPBACK=1 but ${what} is unavailable on this machine.`);
}

async function rejection(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
}

const causeCode = (error: any): string | undefined => error?.cause?.code ?? error?.code;
const v4 = (address: string): ValidatedCandidate => ({ address, family: 4 });
const v6 = (address: string): ValidatedCandidate => ({ address, family: 6 });

describe("PinnedUndiciTransport (real undici, real TLS, local servers)", () => {
  let pin: TestServer;
  let other: TestServer;
  let forbidden: TestServer | undefined; // listens on 127.0.0.2 at pin's port
  let ipv6Server: TestServer | undefined; // listens on ::1
  const transports: PinnedUndiciTransport[] = [];

  // Only 127.0.0.1 and ::1 are "allowed" unless a test says otherwise.
  const allowLoopbackOnly = (address: string) => address !== "127.0.0.1" && address !== "::1";

  function makeTransport(
    resolveHost: (hostname: string) => Promise<ValidatedCandidate[]>,
    options: { isBlockedAddress?: (a: string) => boolean; trusted?: boolean; defaultClassifier?: boolean } = {},
  ): PinnedUndiciTransport {
    const transport = new PinnedUndiciTransport({
      resolveHost,
      ...(options.defaultClassifier ? {} : { isBlockedAddress: options.isBlockedAddress ?? allowLoopbackOnly }),
      trustedCa: options.trusted === false ? undefined : CA,
    });
    transports.push(transport);
    return transport;
  }

  const get = (transport: PinnedUndiciTransport, url: string, extra: { timeoutMs?: number } = {}) =>
    transport.fetch(url, { method: "GET", redirect: "manual", ...extra });

  beforeAll(async () => {
    pin = await startServer("pin", "127.0.0.1");
    other = await startServer("other", "127.0.0.1");
    forbidden = await tryStart("pin", "127.0.0.2", pin.port);
    ipv6Server = await tryStart("pin", "::1");
    need(forbidden, "a second loopback address (127.0.0.2)");
    need(ipv6Server, "IPv6 loopback (::1)");
  });

  afterAll(async () => {
    await Promise.all(transports.map((t) => t.close().catch(() => undefined)));
    await Promise.all([pin, other, forbidden, ipv6Server].map((s) => s?.close()));
  });


  describe("pinning: only validated addresses are ever dialed", () => {
    it("connects to the validated address; Host header, SNI and certificate hostname keep the original hostname", async () => {
      const resolve = jest.fn().mockResolvedValue([v4("127.0.0.1")]);
      const transport = makeTransport(resolve);
      const before = { snis: pin.snis.length, hosts: pin.hostHeaders.length };
      const res = await get(transport, `https://pin.example.test:${pin.port}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(resolve).toHaveBeenCalledWith("pin.example.test");
      expect(pin.snis.slice(before.snis)).toEqual(["pin.example.test"]);
      expect(pin.hostHeaders.slice(before.hosts)).toEqual([`pin.example.test:${pin.port}`]);
    });

    it("refuses an answer whose only address is unsafe, with zero connections to it", async () => {
      need(forbidden, "127.0.0.2");
      const transport = makeTransport(async () => [v4("127.0.0.2")]);
      const before = { forbidden: forbidden?.tcpConnections ?? 0, pin: pin.tcpConnections };
      const error = await rejection(get(transport, `https://pin.example.test:${pin.port}/`));
      expect(error).toBeInstanceOf(ConnectorTargetUnsafeError);
      expect(error).toMatchObject({ code: "CONNECTOR_TARGET_UNSAFE", reason: "PRIVATE_IP_RESOLVED" });
      expect(forbidden?.tcpConnections ?? 0).toBe(before.forbidden);
      expect(pin.tcpConnections).toBe(before.pin);
    });

    it("refuses a MIXED answer outright: the safe member is not used and the unsafe one is never dialed", async () => {
      need(forbidden, "127.0.0.2");
      const transport = makeTransport(async () => [v4("127.0.0.1"), v4("127.0.0.2")]);
      const before = { forbidden: forbidden?.tcpConnections ?? 0, pin: pin.tcpConnections };
      const error = await rejection(get(transport, `https://pin.example.test:${pin.port}/`));
      expect(error).toMatchObject({ code: "CONNECTOR_TARGET_UNSAFE", reason: "PRIVATE_IP_RESOLVED" });
      expect(forbidden?.tcpConnections ?? 0).toBe(before.forbidden);
      expect(pin.tcpConnections).toBe(before.pin);
    });

    it("re-validates on every attempt: DNS that flips to an unsafe address on the second request is refused", async () => {
      need(forbidden, "127.0.0.2");
      let calls = 0;
      const transport = makeTransport(async () => (++calls === 1 ? [v4("127.0.0.1")] : [v4("127.0.0.2")]));
      const url = `https://pin.example.test:${pin.port}/`;
      expect((await get(transport, url)).status).toBe(200);
      const before = forbidden?.tcpConnections ?? 0;
      const error = await rejection(get(transport, url));
      expect(error).toMatchObject({ code: "CONNECTOR_TARGET_UNSAFE" });
      expect(forbidden?.tcpConnections ?? 0).toBe(before);
      expect(calls).toBe(2);
    });

    it("does not reuse a connection between attempts (each attempt resolves, validates and connects)", async () => {
      const resolve = jest.fn().mockResolvedValue([v4("127.0.0.1")]);
      const transport = makeTransport(resolve);
      const url = `https://pin.example.test:${pin.port}/`;
      const before = pin.tlsConnections;
      await (await get(transport, url)).text();
      await (await get(transport, url)).text();
      expect(pin.tlsConnections - before).toBe(2);
      expect(resolve).toHaveBeenCalledTimes(2);
    });

    it.each([
      ["IPv4-mapped loopback", "::ffff:7f00:1"],
      ["IPv4-mapped metadata", "::ffff:a9fe:a9fe"],
      ["NAT64 loopback", "64:ff9b::7f00:1"],
      ["IPv6 loopback", "::1"],
      ["unspecified", "::"],
      ["metadata IPv4", "169.254.169.254"],
    ])("the DEFAULT classifier refuses %s", async (_label, address) => {
      const resolve = jest.fn().mockResolvedValue([address.includes(":") ? v6(address) : v4(address)]);
      const transport = makeTransport(resolve, { defaultClassifier: true });
      const error = await rejection(get(transport, `https://pin.example.test:${pin.port}/`));
      expect(error).toMatchObject({ code: "CONNECTOR_TARGET_UNSAFE", reason: "PRIVATE_IP_RESOLVED" });
    });

    it("the DEFAULT classifier refuses loopback and never opens a connection to the local server", async () => {
      const transport = makeTransport(async () => [v4("127.0.0.1")], { defaultClassifier: true });
      const before = pin.tcpConnections;
      const error = await rejection(get(transport, `https://pin.example.test:${pin.port}/`));
      expect(error).toMatchObject({ code: "CONNECTOR_TARGET_UNSAFE" });
      expect(pin.tcpConnections).toBe(before);
    });

    it("PIM_UNSAFE_HTTP_WEBHOOK_TARGETS=true (local fixtures only) lets the default classifier through, read at call time", async () => {
      const transport = makeTransport(async () => [v4("127.0.0.1")], { defaultClassifier: true });
      const url = `https://pin.example.test:${pin.port}/`;
      const previous = process.env.PIM_UNSAFE_HTTP_WEBHOOK_TARGETS;
      try {
        process.env.PIM_UNSAFE_HTTP_WEBHOOK_TARGETS = "true";
        expect((await get(transport, url)).status).toBe(200);
        delete process.env.PIM_UNSAFE_HTTP_WEBHOOK_TARGETS;
        await expect(get(transport, url)).rejects.toMatchObject({ code: "CONNECTOR_TARGET_UNSAFE" });
      } finally {
        if (previous === undefined) delete process.env.PIM_UNSAFE_HTTP_WEBHOOK_TARGETS;
        else process.env.PIM_UNSAFE_HTTP_WEBHOOK_TARGETS = previous;
      }
    });

    it("an unsafe IP-literal URL is refused without name resolution and without a connection", async () => {
      need(forbidden, "127.0.0.2");
      const resolve = jest.fn();
      const transport = makeTransport(resolve);
      const before = forbidden?.tcpConnections ?? 0;
      const error = await rejection(get(transport, `https://127.0.0.2:${pin.port}/`));
      expect(error).toMatchObject({ code: "CONNECTOR_TARGET_UNSAFE", reason: "PRIVATE_IP_LITERAL" });
      expect(resolve).not.toHaveBeenCalled();
      expect(forbidden?.tcpConnections ?? 0).toBe(before);
    });

    it("an allowed IP-literal URL still gets normal certificate verification (hostname mismatch is rejected)", async () => {
      const resolve = jest.fn();
      const transport = makeTransport(resolve);
      const error = await rejection(get(transport, `https://127.0.0.1:${pin.port}/`));
      expect(causeCode(error)).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
      expect(resolve).not.toHaveBeenCalled();
    });

    it("falls back to another address inside the validated set when the first is dead", async () => {
      // 127.0.0.3 has no listener; the attempt must still succeed via 127.0.0.1, and only
      // ever within the validated set.
      const transport = makeTransport(async () => [v4("127.0.0.3"), v4("127.0.0.1")], {
        isBlockedAddress: (a) => a !== "127.0.0.1" && a !== "127.0.0.3",
      });
      const res = await get(transport, `https://pin.example.test:${pin.port}/`);
      expect(res.status).toBe(200);
    });

    it("works for an IPv6-only host", async () => {
      need(ipv6Server, "::1");
      if (!ipv6Server) return;
      const transport = makeTransport(async () => [v6("::1")]);
      const res = await get(transport, `https://pin.example.test:${ipv6Server.port}/`);
      expect(res.status).toBe(200);
    });

    it("a host with no DNS answer fails as a DNS error, not as a security error", async () => {
      const transport = makeTransport(async () => []);
      const error = await rejection(get(transport, `https://pin.example.test:${pin.port}/`));
      expect(isConnectorTargetSecurityError(error)).toBe(false);
      expect(causeCode(error)).toBe("ENOTFOUND");
    });
  });

  describe("TLS verification is never weakened", () => {
    it("rejects a certificate that does not match the hostname", async () => {
      const transport = makeTransport(async () => [v4("127.0.0.1")]);
      // `other` presents a certificate for other.example.test, not pin.example.test.
      const error = await rejection(get(transport, `https://pin.example.test:${other.port}/`));
      expect(causeCode(error)).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
    });

    it("rejects a certificate from an untrusted CA", async () => {
      const transport = makeTransport(async () => [v4("127.0.0.1")], { trusted: false });
      const error = await rejection(get(transport, `https://pin.example.test:${pin.port}/`));
      expect(String(causeCode(error))).toMatch(/CERT|SIGNATURE|UNABLE_TO_VERIFY|SELF_SIGNED/);
    });
  });

  describe("no global fetch", () => {
    it("never calls globalThis.fetch", async () => {
      const globalFetch = jest.fn();
      const original = globalThis.fetch;
      globalThis.fetch = globalFetch as never;
      try {
        const transport = makeTransport(async () => [v4("127.0.0.1")]);
        await (await get(transport, `https://pin.example.test:${pin.port}/`)).text();
        expect(globalFetch).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = original;
      }
    });
  });

  describe("redirect hops and abort", () => {
    it("a redirect hop is a fresh attempt: DNS that flips between hops is refused on the second hop", async () => {
      need(forbidden, "127.0.0.2");
      let calls = 0;
      const transport = makeTransport(async () => (++calls === 1 ? [v4("127.0.0.1")] : [v4("127.0.0.2")]));
      const before = forbidden?.tcpConnections ?? 0;
      const error = await rejection(
        fetchWithValidatedRedirects(
          (url, init) => transport.fetch(url, init),
          `https://pin.example.test:${pin.port}/redir`,
          { method: "GET" },
        ),
      );
      expect(error).toMatchObject({ code: "CONNECTOR_TARGET_UNSAFE" });
      expect(calls).toBe(2);
      expect(forbidden?.tcpConnections ?? 0).toBe(before);
    });

    it("a same-origin redirect with stable DNS is followed, with a fresh resolution per hop", async () => {
      const resolve = jest.fn().mockResolvedValue([v4("127.0.0.1")]);
      const transport = makeTransport(resolve);
      const res = await fetchWithValidatedRedirects(
        (url, init) => transport.fetch(url, init),
        `https://pin.example.test:${pin.port}/redir`,
        { method: "GET" },
      );
      expect(res.status).toBe(200);
      expect(resolve).toHaveBeenCalledTimes(2);
    });

    it("a timeout during name resolution rejects and leaves no open socket", async () => {
      const transport = makeTransport(async () => {
        await new Promise((r) => setTimeout(r, 300));
        return [v4("127.0.0.1")];
      });
      const error = await rejection(get(transport, `https://pin.example.test:${pin.port}/`, { timeoutMs: 50 }));
      expect(["TimeoutError", "AbortError"]).toContain(error.name);
      await new Promise((r) => setTimeout(r, 800));
      expect(pin.open.size).toBe(0);
    });

    it("a caller abort signal is honoured", async () => {
      const controller = new AbortController();
      const transport = makeTransport(async () => {
        await new Promise((r) => setTimeout(r, 200));
        return [v4("127.0.0.1")];
      });
      const pending = rejection(
        transport.fetch(`https://pin.example.test:${pin.port}/`, { method: "GET", redirect: "manual", signal: controller.signal }),
      );
      setTimeout(() => controller.abort(), 30);
      const error = await pending;
      expect(["AbortError", "TimeoutError"]).toContain(error.name);
    });
  });

  describe("helpers", () => {
    it("canonicalAddress collapses IPv4-mapped IPv6 and normalizes case/compression", () => {
      expect(canonicalAddress("127.0.0.1")).toBe("127.0.0.1");
      expect(canonicalAddress("::ffff:127.0.0.1")).toBe("127.0.0.1");
      expect(canonicalAddress("::FFFF:7f00:1")).toBe("127.0.0.1");
      expect(canonicalAddress("0:0:0:0:0:0:0:1")).toBe("::1");
      expect(canonicalAddress("2606:4700:4700:0:0:0:0:1111")).toBe("2606:4700:4700::1111");
      expect(canonicalAddress("")).toBe("");
    });

    it("verifyConnectedAddress: verified, mismatch, and unverifiable (platform exposes no peer address)", () => {
      const allowed = new Set(["127.0.0.1", "2606:4700:4700::1111"]);
      expect(verifyConnectedAddress("127.0.0.1", allowed)).toBe("verified");
      expect(verifyConnectedAddress("::ffff:127.0.0.1", allowed)).toBe("verified");
      expect(verifyConnectedAddress("2606:4700:4700:0:0:0:0:1111", allowed)).toBe("verified");
      expect(verifyConnectedAddress("10.0.0.5", allowed)).toBe("mismatch");
      expect(verifyConnectedAddress("::ffff:10.0.0.5", allowed)).toBe("mismatch");
      expect(verifyConnectedAddress("", allowed)).toBe("unverifiable");
      expect(verifyConnectedAddress(undefined, allowed)).toBe("unverifiable");
    });
  });
});
