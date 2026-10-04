import { ConnectorNetworkError } from "../connector-framework/connector.errors";
import {
  ConnectorTargetUnsafeError,
  isConnectorTargetSecurityError,
} from "../common/security/connector-target-errors";
import {
  setConnectorTransportForTesting,
  getConnectorTransport,
  type ConnectorTransport,
  type TransportRequestInit,
} from "../common/security/connector-transport";
import { OdooConnector } from "./odoo/odoo.connector";
import { PrestaShopConnector } from "./prestashop/prestashop.connector";
import { ShopwareConnector } from "./shopware/shopware.connector";
import { WooCommerceConnector } from "./woocommerce/woocommerce.connector";

// The URL validator's DNS is not under test here; keep it offline and public.
jest.mock("node:dns/promises", () => ({
  resolve4: jest.fn().mockResolvedValue(["93.184.216.34"]),
  resolve6: jest.fn().mockRejectedValue(new Error("ENODATA")),
}));

// Each tenant-URL connector must send its credential-bearing requests through the
// transport seam (never straight to fetch) and must surface a transport-level
// refusal as the neutral security error / an invalid configuration, not as a
// transient network failure.

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() } as never;
const db = { getClient: () => ({}) } as never;

type Recorded = { url: string; init: TransportRequestInit };

function recordingTransport(respond: (url: string) => Response | Promise<Response>): ConnectorTransport & { calls: Recorded[] } {
  const calls: Recorded[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return respond(url);
    },
  };
}

function refusingTransport(error: Error): ConnectorTransport & { calls: Recorded[] } {
  const calls: Recorded[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      throw error;
    },
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const CONNECTORS = [
  {
    name: "odoo",
    prefix: "ODOO",
    make: () => new OdooConnector(db, logger),
    candidate: { odoo_url: "https://odoo.example.com", database: "db", username: "admin", password: "pw" },
    ok: (url: string) => (url.endsWith("/jsonrpc") ? json({ jsonrpc: "2.0", id: 1, result: 2 }) : json({})),
    firstPath: "/jsonrpc",
  },
  {
    name: "woocommerce",
    prefix: "WOOCOMMERCE",
    make: () => new WooCommerceConnector(db, logger),
    candidate: { site_url: "https://shop.example.com", consumer_key: "ck", consumer_secret: "cs" },
    ok: () => json([]),
    firstPath: "/wp-json/wc/v3/products",
  },
  {
    name: "prestashop",
    prefix: "PRESTASHOP",
    make: () => new PrestaShopConnector(db, logger),
    candidate: { store_url: "https://shop.example.com", api_key: "key" },
    ok: () => new Response("<prestashop/>", { status: 200 }),
    firstPath: "/api/",
  },
  {
    name: "shopware",
    prefix: "SHOPWARE",
    make: () => new ShopwareConnector(db, logger),
    candidate: { store_url: "https://shop.example.com", client_id: "id", client_secret: "secret" },
    ok: (url: string) => (url.endsWith("/api/oauth/token") ? json({ access_token: "tok", expires_in: 600 }) : json({})),
    firstPath: "/api/oauth/token",
  },
] as const;

describe("tenant-URL connectors use the pinned transport seam", () => {
  const previous = getConnectorTransport();
  afterEach(() => setConnectorTransportForTesting(previous));

  describe.each(CONNECTORS)("$name", ({ make, candidate, ok, firstPath, prefix }) => {
    it("sends its credential-bearing request through the transport with redirect: 'manual'", async () => {
      const transport = recordingTransport(ok);
      setConnectorTransportForTesting(transport);
      const result = await make().verifyCandidateCredentials!(candidate as Record<string, string>);
      expect(result.outcome).toBe("valid");
      expect(transport.calls.length).toBeGreaterThan(0);
      expect(new URL(transport.calls[0].url).pathname.startsWith(firstPath)).toBe(true);
      for (const call of transport.calls) {
        expect(call.init.redirect).toBe("manual");
        expect(call.init.timeoutMs).toBe(30_000);
      }
    });

    it.each([
      ["resolved to a private address", "PRIVATE_IP_RESOLVED"],
      ["connected to an unvalidated address", "CONNECTED_ADDRESS_NOT_VALIDATED"],
    ] as const)("a transport refusal (%s) is an invalid configuration, not a transient failure", async (_label, reason) => {
      const refusal = new ConnectorTargetUnsafeError("The target was refused.", reason);
      const transport = refusingTransport(refusal);
      setConnectorTransportForTesting(transport);
      const result = await make().verifyCandidateCredentials!(candidate as Record<string, string>);
      expect(result).toEqual({
        outcome: "invalid",
        reasonCode: `${prefix}_${prefix === "WOOCOMMERCE" ? "SITE_URL" : "URL"}_UNSAFE`,
        category: "configuration",
      });
      expect(transport.calls).toHaveLength(1); // not retried
    });
  });

  it("odoo: a transport refusal on the RPC path propagates unchanged (not a ConnectorNetworkError)", async () => {
    const refusal = new ConnectorTargetUnsafeError("The target was refused.", "PRIVATE_IP_RESOLVED");
    setConnectorTransportForTesting(refusingTransport(refusal));
    const connector = new OdooConnector(db, logger);
    const error = await (connector as any).authenticate("https://odoo.example.com", "db", "admin", "pw").catch((e: unknown) => e);
    expect(error).toBe(refusal);
    expect(error).not.toBeInstanceOf(ConnectorNetworkError);
    expect(isConnectorTargetSecurityError(error)).toBe(true);
  });

  it("woocommerce: a transport refusal in callApi propagates unchanged (not a ConnectorNetworkError)", async () => {
    const refusal = new ConnectorTargetUnsafeError("The target was refused.", "PRIVATE_IP_RESOLVED");
    setConnectorTransportForTesting(refusingTransport(refusal));
    const connector = new WooCommerceConnector(db, logger);
    const error = await (connector as any).callApi("GET", "/products", "https://shop.example.com", "ck", "cs").catch((e: unknown) => e);
    expect(error).toBe(refusal);
    expect(error).not.toBeInstanceOf(ConnectorNetworkError);
  });

  it("a timeout from the transport is classified as a timeout (TimeoutError from AbortSignal.timeout)", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    setConnectorTransportForTesting(refusingTransport(timeout));
    const connector = new WooCommerceConnector(db, logger);
    const error = await (connector as any).callApi("GET", "/products", "https://shop.example.com", "ck", "cs").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorNetworkError);
    expect((error as ConnectorNetworkError).category).toBe("TIMEOUT");
  });
});
