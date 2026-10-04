import { resolve4, resolve6 } from "node:dns/promises";
import {
  ConnectorRedirectError,
  fetchWithValidatedRedirects,
  type RedirectHopFetch,
} from "./validated-redirect-fetch";

jest.mock("node:dns/promises", () => ({
  resolve4: jest.fn(),
  resolve6: jest.fn(),
}));

const START = "https://store.example.com/jsonrpc";
const AUTH_INIT = {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Basic c2VjcmV0" },
  body: JSON.stringify({ params: { args: ["db", "admin", "S3CRET-PASSWORD"] } }),
};

const redirect = (status: number, location?: string): Response =>
  new Response(null, { status, headers: location === undefined ? {} : { location } });
const ok = (): Response => new Response("{}", { status: 200 });

function scripted(...responses: Response[]) {
  const hop = jest.fn<ReturnType<RedirectHopFetch>, Parameters<RedirectHopFetch>>();
  for (const r of responses) hop.mockResolvedValueOnce(r);
  return hop;
}

async function expectRefusal(promise: Promise<unknown>, code: string): Promise<void> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ConnectorRedirectError);
  expect((err as ConnectorRedirectError).code).toBe(code);
}

describe("fetchWithValidatedRedirects", () => {
  beforeEach(() => {
    (resolve4 as unknown as jest.Mock).mockReset().mockResolvedValue(["93.184.216.34"]);
    (resolve6 as unknown as jest.Mock).mockReset().mockRejectedValue(new Error("ENODATA"));
  });

  it("returns a non-redirect response untouched and always asks the hop for redirect: manual", async () => {
    const hop = scripted(ok());
    const res = await fetchWithValidatedRedirects(hop, START, AUTH_INIT);
    expect(res.status).toBe(200);
    expect(hop).toHaveBeenCalledTimes(1);
    expect(hop.mock.calls[0][1].redirect).toBe("manual");
  });

  it.each([200, 204, 300, 304, 400, 401, 500])("does not treat status %i as a redirect", async (status) => {
    const hop = scripted(new Response(status === 204 || status === 304 ? null : "x", { status }));
    const res = await fetchWithValidatedRedirects(hop, START, AUTH_INIT);
    expect(res.status).toBe(status);
    expect(hop).toHaveBeenCalledTimes(1);
  });

  describe("unsafe redirect targets: second request is never sent", () => {
    it.each([
      ["private IPv4", "https://10.0.0.5/jsonrpc"],
      ["RFC1918 192.168", "https://192.168.1.10/jsonrpc"],
      ["loopback", "https://127.0.0.1/jsonrpc"],
      ["cloud metadata IPv4", "https://169.254.169.254/latest/meta-data/"],
      ["cloud metadata over http", "http://169.254.169.254/latest/meta-data/"],
      ["IPv4-mapped IPv6 loopback", "https://[::ffff:7f00:1]/jsonrpc"],
      ["IPv4-mapped IPv6 metadata (dotted)", "https://[::ffff:169.254.169.254]/"],
      ["unspecified IPv6", "https://[::]/"],
      ["IPv6 loopback", "https://[::1]/"],
      ["blocked hostname", "https://metadata.google.internal/computeMetadata/v1/"],
      ["trailing-dot localhost", "https://localhost./"],
      ["plain http to the same host", "http://store.example.com/jsonrpc"],
    ])("%s", async (_label, location) => {
      const hop = scripted(redirect(302, location), ok());
      await expectRefusal(fetchWithValidatedRedirects(hop, START, AUTH_INIT), "REDIRECT_UNSAFE_TARGET");
      expect(hop).toHaveBeenCalledTimes(1);
    });

    it("blocks a redirect to a host whose DNS answers a private address", async () => {
      (resolve4 as unknown as jest.Mock).mockResolvedValue(["10.1.2.3"]);
      const hop = scripted(redirect(307, "https://store.example.com/other"), ok());
      await expectRefusal(fetchWithValidatedRedirects(hop, START, AUTH_INIT), "REDIRECT_UNSAFE_TARGET");
      expect(hop).toHaveBeenCalledTimes(1);
    });

    it("does not echo the rejected target back to the caller", async () => {
      const hop = scripted(redirect(302, "https://10.9.8.7/secret-path"));
      const err = await fetchWithValidatedRedirects(hop, START, AUTH_INIT).catch((e: Error) => e);
      expect((err as Error).message).not.toContain("10.9.8.7");
    });
  });

  describe("cross-origin redirects fail closed before secrets are forwarded", () => {
    it.each([
      ["apex to www", "https://www.store.example.com/jsonrpc"],
      ["different public host", "https://other.example.net/jsonrpc"],
      ["different port", "https://store.example.com:8443/jsonrpc"],
      ["protocol-relative", "//other.example.net/jsonrpc"],
    ])("%s", async (_label, location) => {
      for (const status of [301, 302, 303, 307, 308]) {
        const hop = scripted(redirect(status, location), ok());
        await expectRefusal(fetchWithValidatedRedirects(hop, START, AUTH_INIT), "REDIRECT_CROSS_ORIGIN");
        // Only the original request was ever made; Authorization header and the
        // password-bearing body never reached a second call.
        expect(hop).toHaveBeenCalledTimes(1);
      }
    });

    it("tells the operator which canonical origin to save", async () => {
      const hop = scripted(redirect(301, "https://www.store.example.com/jsonrpc"));
      const err = await fetchWithValidatedRedirects(hop, START, AUTH_INIT).catch((e: Error) => e);
      expect((err as Error).message).toContain("https://www.store.example.com");
      expect((err as Error).message).toContain("canonical store URL");
    });
  });

  describe("same-origin redirects", () => {
    it("follows 307 and 308 for a POST, preserving method, headers and body", async () => {
      for (const status of [307, 308]) {
        const hop = scripted(redirect(status, "/jsonrpc/v2"), ok());
        const res = await fetchWithValidatedRedirects(hop, START, AUTH_INIT);
        expect(res.status).toBe(200);
        expect(hop).toHaveBeenCalledTimes(2);
        expect(hop.mock.calls[1][0]).toBe("https://store.example.com/jsonrpc/v2");
        expect(hop.mock.calls[1][1]).toEqual({ ...AUTH_INIT, redirect: "manual" });
      }
    });

    it.each([301, 302, 303])("fails closed on %i for a POST with a body instead of silently dropping it", async (status) => {
      const hop = scripted(redirect(status, "/jsonrpc/v2"), ok());
      await expectRefusal(fetchWithValidatedRedirects(hop, START, AUTH_INIT), "REDIRECT_METHOD_UNSUPPORTED");
      expect(hop).toHaveBeenCalledTimes(1);
    });

    it.each([301, 302, 303, 307, 308])("follows %i for a body-less GET", async (status) => {
      const hop = scripted(redirect(status, "/moved"), ok());
      const res = await fetchWithValidatedRedirects(hop, START, { method: "GET", headers: { Accept: "application/json" } });
      expect(res.status).toBe(200);
      expect(hop.mock.calls[1][0]).toBe("https://store.example.com/moved");
      expect(hop.mock.calls[1][1].method).toBe("GET");
    });

    it("resolves relative Locations against the current URL and re-validates them", async () => {
      const hop = scripted(redirect(307, "../v2/jsonrpc?x=1#frag"), ok());
      await fetchWithValidatedRedirects(hop, "https://store.example.com/a/b/jsonrpc", AUTH_INIT);
      expect(hop.mock.calls[1][0]).toBe("https://store.example.com/a/v2/jsonrpc?x=1");
      expect((resolve4 as unknown as jest.Mock).mock.calls.some(([h]) => h === "store.example.com")).toBe(true);
    });

    it("re-validates a same-origin target whose DNS later answers a private address", async () => {
      (resolve4 as unknown as jest.Mock).mockResolvedValue(["127.0.0.1"]);
      const hop = scripted(redirect(307, "/jsonrpc/v2"), ok());
      await expectRefusal(fetchWithValidatedRedirects(hop, START, AUTH_INIT), "REDIRECT_UNSAFE_TARGET");
      expect(hop).toHaveBeenCalledTimes(1);
    });
  });

  describe("bounded and fail-closed", () => {
    it("refuses a redirect loop", async () => {
      const hop = scripted(redirect(307, "/b"), redirect(307, "/jsonrpc"), ok());
      await expectRefusal(fetchWithValidatedRedirects(hop, START, AUTH_INIT), "REDIRECT_LOOP");
      expect(hop).toHaveBeenCalledTimes(2);
    });

    it("refuses a self-redirect", async () => {
      const hop = scripted(redirect(307, START), ok());
      await expectRefusal(fetchWithValidatedRedirects(hop, START, AUTH_INIT), "REDIRECT_LOOP");
      expect(hop).toHaveBeenCalledTimes(1);
    });

    it("stops after maxRedirects hops (default 3 => 4 requests)", async () => {
      const hop = scripted(redirect(307, "/1"), redirect(307, "/2"), redirect(307, "/3"), redirect(307, "/4"), ok());
      await expectRefusal(fetchWithValidatedRedirects(hop, START, AUTH_INIT), "REDIRECT_TOO_MANY");
      expect(hop).toHaveBeenCalledTimes(4);
    });

    it("honours a custom maxRedirects of 0", async () => {
      const hop = scripted(redirect(307, "/1"), ok());
      await expectRefusal(fetchWithValidatedRedirects(hop, START, AUTH_INIT, { maxRedirects: 0 }), "REDIRECT_TOO_MANY");
      expect(hop).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["missing", undefined],
      ["empty", ""],
      ["whitespace", "   "],
      ["unparseable authority", "https://["],
      ["bad IPv6 literal", "https://[::1"],
    ])("fails closed on a %s Location", async (_label, location) => {
      const hop = scripted(redirect(307, location), ok());
      await expectRefusal(fetchWithValidatedRedirects(hop, START, AUTH_INIT), "REDIRECT_INVALID_LOCATION");
      expect(hop).toHaveBeenCalledTimes(1);
    });

    it("refuses a response the hop already followed on its own (redirect not enforced)", async () => {
      const followed = ok();
      Object.defineProperty(followed, "redirected", { value: true });
      const hop = scripted(followed);
      await expectRefusal(fetchWithValidatedRedirects(hop, START, AUTH_INIT), "REDIRECT_NOT_ENFORCED");
    });

    it("propagates transport errors from the hop unchanged", async () => {
      const boom = new Error("socket hang up");
      const hop = jest.fn().mockRejectedValue(boom);
      await expect(fetchWithValidatedRedirects(hop, START, AUTH_INIT)).rejects.toBe(boom);
    });
  });
});
