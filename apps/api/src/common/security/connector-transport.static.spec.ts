import fs from "node:fs";
import path from "node:path";

// Static guards for the pinning contract. They exist so a later refactor cannot
// quietly recreate the problems pinning solves: a hostname swapped for an IP, a
// weakened TLS check, a fall-back to global fetch (which would mix Node's bundled
// undici with the npm Agent), or a connector bypassing the transport seam.

const SRC = path.join(__dirname, "../..");
const read = (relative: string) => fs.readFileSync(path.join(SRC, relative), "utf8");

// Drop block comments and whole-line `//` comments only, so string literals that
// contain "//" (URLs) are left intact.
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

const BARE_FETCH_CALL = /(?<![.\w])fetch\(/;
const bareFetchLines = (source: string) =>
  code(source)
    .split("\n")
    .filter((line) => BARE_FETCH_CALL.test(line) && !/\basync fetch\(/.test(line));

describe("connector transport static guards", () => {
  const transport = code(read("common/security/pinned-undici-transport.ts"));

  it.each([
    ["rejectUnauthorized", /rejectUnauthorized/],
    ["checkServerIdentity", /checkServerIdentity/],
    ["NODE_TLS_REJECT_UNAUTHORIZED", /NODE_TLS_REJECT_UNAUTHORIZED/],
    ["a servername override", /servername\s*[:=]/],
    ["global fetch", /globalThis\.fetch|\bglobal\.fetch/],
    ["rewriting the URL host", /\.(hostname|host)\s*=[^=]/],
    ["building a URL from an address", /new URL\(`https?:\/\/\$\{/],
  ])("the pinned transport never uses %s", (_label, pattern) => {
    expect(transport).not.toMatch(pattern);
  });

  it("the pinned transport makes no bare fetch() call (only undici's own fetch)", () => {
    expect(bareFetchLines(read("common/security/pinned-undici-transport.ts"))).toEqual([]);
  });

  it("the pinned transport imports fetch, Agent and buildConnector from the same npm undici package", () => {
    expect(transport).toMatch(/from "undici"/);
    expect(transport).toMatch(/Agent/);
    expect(transport).toMatch(/buildConnector/);
    expect(transport).toMatch(/fetch as undiciFetch/);
  });

  describe.each([
    ["odoo connector", "connectors/odoo/odoo.connector.ts", "getConnectorTransport"],
    ["woocommerce connector", "connectors/woocommerce/woocommerce.connector.ts", "getConnectorTransport"],
    ["prestashop connector", "connectors/prestashop/prestashop.connector.ts", "getConnectorTransport"],
    ["shopware connector", "connectors/shopware/shopware.connector.ts", "getConnectorTransport"],
    ["outbound webhooks service", "outbound-webhooks/outbound-webhooks.service.ts", "getWebhookTransport"],
  ])("%s", (_name, file, accessor) => {
    it("sends tenant-targeted requests only through the transport seam", () => {
      const source = read(file);
      expect(bareFetchLines(source)).toEqual([]);
      expect(code(source)).toContain(`${accessor}()`);
    });

    it("never touches TLS verification settings", () => {
      expect(code(read(file))).not.toMatch(/rejectUnauthorized|checkServerIdentity|NODE_TLS_REJECT_UNAUTHORIZED/);
    });
  });

  it("the test-only override setter and the jest test double are not used by production code", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")) {
          const text = fs.readFileSync(full, "utf8");
          const isRegistry = full.endsWith(path.join("common", "security", "connector-transport.ts"));
          if (!isRegistry && /setConnectorTransportForTesting|setup-connector-transport/.test(text)) {
            offenders.push(path.relative(SRC, full));
          }
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});
