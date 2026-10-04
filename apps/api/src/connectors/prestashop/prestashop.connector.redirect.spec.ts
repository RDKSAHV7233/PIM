import { resolve4, resolve6 } from "node:dns/promises";
import { PrestaShopConnector } from "./prestashop.connector";

// Separate from prestashop.connector.spec.ts, which replaces url-safety wholesale
// with an always-accepting mock. Redirect targets must go through the REAL
// canonical validation here, with DNS stubbed so no network is touched.
jest.mock("node:dns/promises", () => ({
  resolve4: jest.fn(),
  resolve6: jest.fn(),
}));

// Redirect handling on the credential-bearing webservice transport. Every
// request carries the webservice key (Basic auth) and, for writes, the product
// XML, so fetch must never follow a redirect to a destination that has not
// passed the canonical SSRF validation.
describe("PrestaShopConnector authenticated redirect handling", () => {
  const SHOP = "https://shop.example.com";
  const candidate = { store_url: SHOP, api_key: "PS_REDIRECT_TEST_KEY" };
  const redirect = (status: number, location: string) =>
    new Response(null, { status, headers: { location } });
  const okXml = () => new Response("<prestashop/>", { status: 200 });

  function makeConnector() {
    return new PrestaShopConnector(
      { getClient: () => ({}) } as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() } as never,
    );
  }

  beforeEach(() => {
    (resolve4 as unknown as jest.Mock).mockReset().mockResolvedValue(["93.184.216.34"]);
    (resolve6 as unknown as jest.Mock).mockReset().mockRejectedValue(new Error("ENODATA"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("sends the credential-bearing request with redirect: 'manual'", async () => {
    const fetchMock = jest.fn().mockResolvedValue(okXml());
    (global as any).fetch = fetchMock;
    const result = await makeConnector().verifyCandidateCredentials!(candidate);
    expect(result).toEqual({ outcome: "valid" });
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toMatch(/^Basic /);
  });

  it.each([
    ["private IPv4", "https://10.0.0.5/api/"],
    ["cloud metadata", "https://169.254.169.254/latest/meta-data/"],
    ["IPv4-mapped IPv6 loopback", "https://[::ffff:7f00:1]/api/"],
    ["plain http downgrade", "http://shop.example.com/api/"],
  ])("never sends the webservice key to a redirect to %s", async (_label, location) => {
    const fetchMock = jest.fn().mockResolvedValue(redirect(302, location));
    (global as any).fetch = fetchMock;
    const result = await makeConnector().verifyCandidateCredentials!(candidate);
    expect(result).toEqual({ outcome: "invalid", reasonCode: "PRESTASHOP_REDIRECT_UNSAFE_TARGET", category: "configuration" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed on an apex->www cross-origin redirect instead of following it", async () => {
    const fetchMock = jest.fn().mockResolvedValue(redirect(301, "https://www.shop.example.com/api/"));
    (global as any).fetch = fetchMock;
    const result = await makeConnector().verifyCandidateCredentials!(candidate);
    expect(result).toEqual({ outcome: "invalid", reasonCode: "PRESTASHOP_REDIRECT_CROSS_ORIGIN", category: "configuration" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows a same-origin redirect for a GET, keeping the key on the same origin only", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(redirect(301, "/api/?output_format=JSON"))
      .mockResolvedValueOnce(okXml());
    (global as any).fetch = fetchMock;
    const result = await makeConnector().verifyCandidateCredentials!(candidate);
    expect(result).toEqual({ outcome: "valid" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(fetchMock.mock.calls[1][0]).origin).toBe(SHOP);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(fetchMock.mock.calls[0][1].headers.Authorization);
  });

  it("fails closed on a 302 for a product write rather than letting fetch drop the XML body", async () => {
    const fetchMock = jest.fn().mockResolvedValue(redirect(302, "/api/products/"));
    (global as any).fetch = fetchMock;
    await expect(
      (makeConnector() as any).fetchWithTimeout(`${SHOP}/api/products`, {
        method: "POST",
        headers: { Authorization: "Basic abc", "Content-Type": "application/xml" },
        body: "<prestashop><product/></prestashop>",
      }),
    ).rejects.toMatchObject({ name: "ConnectorRedirectError", code: "CONNECTOR_REDIRECT_BLOCKED", reason: "REDIRECT_METHOD_UNSUPPORTED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows a same-origin 307 for a product write, preserving method, headers and body", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(redirect(307, "/api/products/"))
      .mockResolvedValueOnce(new Response("<id>7</id>", { status: 201 }));
    (global as any).fetch = fetchMock;
    const init = {
      method: "POST",
      headers: { Authorization: "Basic abc", "Content-Type": "application/xml" },
      body: "<prestashop><product/></prestashop>",
    };
    const res = await (makeConnector() as any).fetchWithTimeout(`${SHOP}/api/products`, init);
    expect(res.status).toBe(201);
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
    expect(fetchMock.mock.calls[1][1].body).toBe(init.body);
    expect(fetchMock.mock.calls[1][1].headers).toEqual(init.headers);
  });

  it("validateStoredCredentialsDetailed reports a refused redirect as invalid with a reason code", async () => {
    const connector = makeConnector();
    jest.spyOn(connector as any, "resolveCredentials").mockResolvedValue({
      storeUrl: SHOP,
      apiKey: "k",
      langId: "1",
    });
    (global as any).fetch = jest.fn().mockResolvedValue(redirect(301, "https://www.shop.example.com/api/"));
    await expect(
      connector.validateStoredCredentialsDetailed!({ tenantId: "t1", installationId: "i1", connectorId: "prestashop" } as any),
    ).resolves.toEqual({ outcome: "invalid", reasonCode: "PRESTASHOP_REDIRECT_CROSS_ORIGIN", category: "configuration" });
  });

  it("does not report a redirect refusal as a transient (unavailable) failure", async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(redirect(307, "https://evil.example.net/api/"));
    const result = await makeConnector().verifyCandidateCredentials!(candidate);
    expect(result.outcome).toBe("invalid");
  });
});
