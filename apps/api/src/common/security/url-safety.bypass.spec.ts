import { resolve4, resolve6 } from "node:dns/promises";
import { validateConnectorTargetUrl, validateWebhookTargetUrl } from "./url-safety";

jest.mock("node:dns/promises", () => ({
  resolve4: jest.fn(),
  resolve6: jest.fn(),
}));

const resolve4Mock = resolve4 as unknown as jest.Mock;
const resolve6Mock = resolve6 as unknown as jest.Mock;

// Both validators share one implementation (validateOutboundTargetUrl); every
// bypass is asserted against both so a future split cannot regress one caller.
const VALIDATORS: Array<[string, (url: string) => Promise<string>]> = [
  ["validateConnectorTargetUrl", (url) => validateConnectorTargetUrl(url, { requireResolvable: false })],
  ["validateWebhookTargetUrl", (url) => validateWebhookTargetUrl(url, { requireResolvable: false })],
];

// IP literals that must never be reachable. Hostnames are the WHATWG-normalized
// form the validator actually sees (e.g. `[::ffff:127.0.0.1]` becomes
// `[::ffff:7f00:1]`), so each case is written as the URL a tenant would type.
const BLOCKED_IP_LITERAL_URLS = [
  // IPv4-mapped IPv6 (::ffff:0:0/96) wrapping loopback / metadata / RFC1918
  "https://[::ffff:127.0.0.1]/",
  "https://[::ffff:7f00:1]/",
  "https://[::ffff:169.254.169.254]/latest/meta-data",
  "https://[::ffff:a9fe:a9fe]/",
  "https://[::ffff:10.0.0.1]/",
  "https://[::ffff:192.168.1.1]/",
  "https://[::ffff:172.16.0.1]/",
  "https://[0:0:0:0:0:ffff:7f00:1]/",
  // IPv4-compatible (deprecated ::/96)
  "https://[::127.0.0.1]/",
  "https://[::10.0.0.1]/",
  // Unspecified address (connects to localhost on Linux)
  "https://[::]/",
  "https://[0:0:0:0:0:0:0:0]/",
  "https://[::1]/",
  // NAT64 well-known prefix embedding a private IPv4
  "https://[64:ff9b::7f00:1]/",
  "https://[64:ff9b::a9fe:a9fe]/",
  // 6to4 embedding loopback / metadata
  "https://[2002:7f00:1::]/",
  "https://[2002:a9fe:a9fe::1]/",
  // Teredo
  "https://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/",
  // Link-local is fe80::/10, not just the literal fe80: prefix
  "https://[fe80::1]/",
  "https://[fe90::1]/",
  "https://[fea0::1]/",
  "https://[febf::1]/",
  // Deprecated site-local fec0::/10
  "https://[fec0::1]/",
  // Unique local fc00::/7, including the AWS IPv6 metadata endpoint
  "https://[fc00::1]/",
  "https://[fd00:ec2::254]/",
  // Multicast, documentation, discard-only
  "https://[ff02::1]/",
  "https://[2001:db8::1]/",
  "https://[100::1]/",
  // IPv4 ranges missing from the original list
  "https://0.0.0.0/",
  "https://192.0.0.192/",
  "https://192.0.2.1/",
  "https://198.18.0.1/",
  "https://198.51.100.1/",
  "https://203.0.113.1/",
  "https://224.0.0.1/",
  "https://240.0.0.1/",
  "https://255.255.255.255/",
  "https://100.100.100.200/",
  // Non-dotted IPv4 spellings the URL parser normalizes to loopback
  "https://2130706433/",
  "https://0x7f.1/",
  "https://0177.0.0.1/",
  "https://127.1/",
];

const BLOCKED_HOSTNAME_URLS = [
  "https://localhost./",
  "https://LOCALHOST/",
  "https://foo.localhost/",
  "https://foo.localhost./",
  "https://metadata.google.internal./",
  "https://evil.internal./",
  "https://shop.local./",
  "https://metadata.internal./",
];

const ALLOWED_PUBLIC_URLS = [
  "https://93.184.216.34/",
  "https://8.8.8.8/",
  "https://[2606:4700:4700::1111]/",
  "https://[2001:4860:4860::8888]/",
  "https://[::ffff:8.8.8.8]/",
  "https://[64:ff9b::808:808]/",
  "https://[2002:808:808::1]/",
];

describe.each(VALIDATORS)("%s — SSRF guard bypasses", (_name, validate) => {
  beforeEach(() => {
    resolve4Mock.mockReset();
    resolve6Mock.mockReset();
    resolve4Mock.mockResolvedValue(["93.184.216.34"]);
    resolve6Mock.mockRejectedValue(new Error("ENODATA"));
  });

  it.each(BLOCKED_IP_LITERAL_URLS)("rejects IP literal %s", async (url) => {
    await expect(validate(url)).rejects.toThrow("private or reserved IP");
  });

  it.each(BLOCKED_HOSTNAME_URLS)("rejects blocked hostname %s", async (url) => {
    await expect(validate(url)).rejects.toThrow("blocked host");
    expect(resolve4Mock).not.toHaveBeenCalled();
  });

  it.each(ALLOWED_PUBLIC_URLS)("still allows public address %s", async (url) => {
    await expect(validate(url)).resolves.toEqual(expect.stringMatching(/^https:\/\//));
  });

  describe("resolved addresses", () => {
    const RESOLVED_BLOCKED: Array<[string, string[], string[]]> = [
      ["IPv4 loopback", ["127.0.0.1"], []],
      ["IPv4 metadata", ["169.254.169.254"], []],
      ["IPv4 0.0.0.0", ["0.0.0.0"], []],
      ["AAAA ::", [], ["::"]],
      ["AAAA ::1", [], ["::1"]],
      ["AAAA IPv4-mapped loopback", [], ["::ffff:7f00:1"]],
      ["AAAA IPv4-mapped metadata (dotted)", [], ["::ffff:169.254.169.254"]],
      ["AAAA NAT64 loopback", [], ["64:ff9b::7f00:1"]],
      ["AAAA fe90 link-local", [], ["fe90::1"]],
      ["AAAA fec0 site-local", [], ["fec0::1"]],
      ["public A + private AAAA (rebinding mix)", ["93.184.216.34"], ["::ffff:a00:1"]],
    ];

    it.each(RESOLVED_BLOCKED)("rejects a host resolving to %s", async (_label, a, aaaa) => {
      resolve4Mock.mockImplementation(async () => {
        if (a.length === 0) throw new Error("ENODATA");
        return a;
      });
      resolve6Mock.mockImplementation(async () => {
        if (aaaa.length === 0) throw new Error("ENODATA");
        return aaaa;
      });
      await expect(validate("https://rebind.example.com/")).rejects.toThrow("private or reserved IP");
    });

    it("allows a host resolving only to public addresses", async () => {
      resolve4Mock.mockResolvedValue(["93.184.216.34"]);
      resolve6Mock.mockResolvedValue(["2606:2800:220:1:248:1893:25c8:1946"]);
      await expect(validate("https://store.example.com/")).resolves.toBe("https://store.example.com/");
    });
  });
});
