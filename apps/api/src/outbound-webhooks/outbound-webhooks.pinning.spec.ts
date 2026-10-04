// Outbound webhook delivery through the pinned webhook transport. Real undici, real TLS,
// real local servers: for every refusal a server listening on the forbidden address must
// see zero connections. The webhook-specific controls (manual redirects, strict
// dispatch-time URL validation, the fixture flag, signing) are asserted unchanged.

import {
  closeConnectorTransport,
  createWebhookTransport,
  getWebhookTransport,
  setConnectorTransportForTesting,
  getConnectorTransport,
  type ConnectorTransport,
} from "../common/security/connector-transport";
import type { ValidatedCandidate } from "../common/security/pinned-undici-transport";
import {
  TEST_CA,
  need,
  startHttpServer,
  startTlsServer,
  tryStartTlsServer,
  type TestServer,
} from "../../test/helpers/tls-test-server";
import { OutboundWebhooksService } from "./outbound-webhooks.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { QueueService } from "../queue/queue.service";
import type { PlanUsageService } from "../billing/plan-usage.service";
import {
  buildEncryptedCredential,
  loadCredentialEncryptionKeys,
  resolveCurrentCredentialKeyVersion,
} from "../connector-installer/credential-encryption.util";

// The dispatch-time URL pre-check (strict, c-ares based) must see a public answer so these
// specs exercise the connection-time boundary: a name that passes validation and then
// resolves to something internal when the socket is opened.
jest.mock("node:dns/promises", () => ({
  resolve4: jest.fn().mockResolvedValue(["93.184.216.34"]),
  resolve6: jest.fn().mockRejectedValue(new Error("ENODATA")),
}));

const ENV = {
  CREDENTIAL_ENCRYPTION_KEY_V1: "pim1-test-encryption-key-v1-minimum-32",
  CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION: "1",
};

function encryptTestSecret(secret: string) {
  const keys = loadCredentialEncryptionKeys(ENV as NodeJS.ProcessEnv);
  const currentVersion = resolveCurrentCredentialKeyVersion(ENV as NodeJS.ProcessEnv);
  const encrypted = buildEncryptedCredential(secret, currentVersion, keys);
  return { cipher: encrypted.cipher, keyVersion: `v${encrypted.keyVersion}` };
}

function makeStubs(targetUrl: string) {
  const secret = encryptTestSecret("whsec_pinning_test_only");
  const endpointRow = {
    id: "endpoint-1",
    tenantKey: "tenant-a",
    targetUrl,
    signingSecretEncrypted: secret.cipher,
    signingSecretKeyVersion: secret.keyVersion,
    isActive: true,
  };
  const deliveryRow = {
    id: "delivery-1",
    endpointId: "endpoint-1",
    eventType: "publish_succeeded",
    eventId: "event-1",
    status: "queued",
    requestBody: { hello: "world" },
  };
  const outboundWebhookEndpoint = {
    findUnique: jest.fn().mockResolvedValue(endpointRow),
    update: jest.fn().mockResolvedValue(endpointRow),
  };
  const outboundWebhookDelivery = {
    findUnique: jest.fn().mockResolvedValue(deliveryRow),
    update: jest.fn().mockImplementation((args) => Promise.resolve({ ...deliveryRow, ...args.data })),
  };
  const prisma = {
    tenant: jest.fn().mockReturnValue({ outboundWebhookEndpoint, outboundWebhookDelivery }),
  } as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  let handler: ((payload: unknown) => Promise<void>) | null = null;
  const queueService = {
    enqueue: jest.fn().mockResolvedValue(undefined),
    processWithBackpressure: jest.fn((_n: string, _o: unknown, h: (payload: unknown) => Promise<void>) => {
      handler = h;
    }),
  } as unknown as QueueService;
  const planUsage = {
    getTenantPlanProfile: jest.fn().mockResolvedValue({ accessStatus: "active" }),
  } as unknown as PlanUsageService;
  new OutboundWebhooksService(prisma, audit, queueService, planUsage);
  return {
    outboundWebhookDelivery,
    deliver: () => handler!({ tenantKey: "tenant-a", endpointId: "endpoint-1", deliveryId: "delivery-1" }),
  };
}

const v4 = (address: string): ValidatedCandidate => ({ address, family: 4 });
const v6 = (address: string): ValidatedCandidate => ({ address, family: 6 });

function lastUpdateData(delivery: jest.Mock): Record<string, unknown> {
  const calls = delivery.mock.calls;
  return calls[calls.length - 1][0].data;
}

describe("OutboundWebhooksService - pinned delivery", () => {
  const originalEnv = process.env;
  const previousTransport = getConnectorTransport();
  let pin: TestServer;
  let redirectTarget: TestServer;
  let forbidden: TestServer | undefined;

  beforeAll(async () => {
    pin = await startTlsServer("pin", "127.0.0.1", {
      onRequest: (req, res) => {
        if (req.url?.startsWith("/redir")) {
          res.writeHead(307, { location: `https://pin.example.test:${redirectTarget.port}/landed` });
          res.end();
          return true;
        }
        if (req.url?.startsWith("/hang")) {
          return true; // never answers
        }
        return false;
      },
    });
    redirectTarget = await startTlsServer("pin", "127.0.0.1");
    forbidden = await tryStartTlsServer("pin", "127.0.0.2", { port: pin.port });
    need(forbidden, "a second loopback address (127.0.0.2)");
  });

  afterAll(async () => {
    await Promise.all([pin, redirectTarget, forbidden].map((s) => s?.close()));
  });

  beforeEach(() => {
    process.env = { ...originalEnv, ...ENV };
  });

  afterEach(async () => {
    process.env = originalEnv;
    jest.restoreAllMocks();
    setConnectorTransportForTesting(previousTransport);
    await closeConnectorTransport();
  });

  const useTransport = (transport: ConnectorTransport) => setConnectorTransportForTesting(transport);
  const url = (path = "/hooks/pim1") => `https://pin.example.test:${pin.port}${path}`;

  it("delivers to a public hostname through a validated address; Host and SNI keep the original hostname and the payload is signed", async () => {
    // Only 127.0.0.1 is treated as allowed here so the local server can stand in for the public host.
    useTransport(
      createWebhookTransport({
        resolveHost: async () => [v4("127.0.0.1")],
        isBlockedAddress: (a) => a !== "127.0.0.1",
        trustedCa: TEST_CA,
      }),
    );
    const stubs = makeStubs(url());
    const before = { hosts: pin.hostHeaders.length, snis: pin.snis.length, requests: pin.requests.length };

    await stubs.deliver();

    expect(lastUpdateData(stubs.outboundWebhookDelivery.update)).toMatchObject({ status: "delivered", responseStatus: 200 });
    expect(pin.hostHeaders.slice(before.hosts)).toEqual([`pin.example.test:${pin.port}`]);
    expect(pin.snis.slice(before.snis)).toEqual(["pin.example.test"]);
    const request = pin.requests[before.requests];
    expect(request.method).toBe("POST");
    expect(request.headers["x-pim1-webhook-signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(request.headers["x-pim1-webhook-delivery-id"]).toBe("delivery-1");
    expect(JSON.parse(request.body)).toEqual({ hello: "world" });
  });

  describe("connection-time validation (the pre-check saw a public answer)", () => {
    it("blocks a hostname that now resolves to a private address, with zero connections to it", async () => {
      useTransport(
        createWebhookTransport({
          resolveHost: async () => [v4("127.0.0.1")], // loopback, blocked by the DEFAULT classifier
          trustedCa: TEST_CA,
        }),
      );
      const stubs = makeStubs(url());
      const before = pin.tcpConnections;

      await expect(stubs.deliver()).rejects.toThrow("Webhook target URL resolves to a private or reserved IP address.");

      expect(lastUpdateData(stubs.outboundWebhookDelivery.update)).toMatchObject({
        status: "failed",
        errorMessage: "Webhook target URL resolves to a private or reserved IP address.",
      });
      expect(pin.tcpConnections).toBe(before);
    });

    it("blocks a hostname that resolves to the cloud metadata address", async () => {
      useTransport(createWebhookTransport({ resolveHost: async () => [v4("169.254.169.254")], trustedCa: TEST_CA }));
      const stubs = makeStubs(url());
      await expect(stubs.deliver()).rejects.toThrow("Webhook target URL resolves to a private or reserved IP address.");
      expect(lastUpdateData(stubs.outboundWebhookDelivery.update)).toMatchObject({ status: "failed" });
    });

    it("blocks an IPv4-mapped IPv6 destination, with zero connections to the local server it maps to", async () => {
      useTransport(createWebhookTransport({ resolveHost: async () => [v6("::ffff:7f00:1")], trustedCa: TEST_CA }));
      const stubs = makeStubs(url());
      const before = pin.tcpConnections;
      await expect(stubs.deliver()).rejects.toThrow("Webhook target URL resolves to a private or reserved IP address.");
      expect(pin.tcpConnections).toBe(before);
    });

    it("blocks a mixed answer outright and never dials the forbidden member", async () => {
      need(forbidden, "127.0.0.2");
      useTransport(
        createWebhookTransport({
          resolveHost: async () => [v4("127.0.0.1"), v4("127.0.0.2")],
          isBlockedAddress: (a) => a !== "127.0.0.1",
          trustedCa: TEST_CA,
        }),
      );
      const stubs = makeStubs(url());
      const before = { forbidden: forbidden?.tcpConnections ?? 0, pin: pin.tcpConnections };
      await expect(stubs.deliver()).rejects.toThrow("resolves to a private or reserved IP address");
      expect(forbidden?.tcpConnections ?? 0).toBe(before.forbidden);
      expect(pin.tcpConnections).toBe(before.pin);
    });
  });

  describe("webhook-specific controls are unchanged", () => {
    it("never follows a redirect: a 3xx is a failed delivery and the redirect target is never contacted", async () => {
      useTransport(
        createWebhookTransport({
          resolveHost: async () => [v4("127.0.0.1")],
          isBlockedAddress: (a) => a !== "127.0.0.1",
          trustedCa: TEST_CA,
        }),
      );
      const stubs = makeStubs(url("/redir"));
      const before = redirectTarget.tcpConnections;

      await expect(stubs.deliver()).rejects.toThrow("Outbound webhook endpoint returned 307");

      expect(lastUpdateData(stubs.outboundWebhookDelivery.update)).toMatchObject({ status: "failed", responseStatus: 307 });
      expect(redirectTarget.tcpConnections).toBe(before);
    });

    it("keeps the delivery timeout behavior: a hung endpoint fails the delivery and leaves no open socket", async () => {
      const realTimeout = AbortSignal.timeout.bind(AbortSignal);
      jest.spyOn(AbortSignal, "timeout").mockImplementation(() => realTimeout(150));
      useTransport(
        createWebhookTransport({
          resolveHost: async () => [v4("127.0.0.1")],
          isBlockedAddress: (a) => a !== "127.0.0.1",
          trustedCa: TEST_CA,
        }),
      );
      const stubs = makeStubs(url("/hang"));

      await expect(stubs.deliver()).rejects.toThrow(/timeout|aborted/i);

      expect(lastUpdateData(stubs.outboundWebhookDelivery.update)).toMatchObject({ status: "failed" });
      await new Promise((resolve) => setTimeout(resolve, 800));
      expect(pin.open.size).toBe(0);
    });

    it("still rejects a plain-http target at dispatch when the fixture flag is off (strict pre-check unchanged)", async () => {
      const plain = await startHttpServer("127.0.0.1");
      try {
        setConnectorTransportForTesting(null);
        delete process.env.PIM_UNSAFE_HTTP_WEBHOOK_TARGETS;
        const stubs = makeStubs(`http://127.0.0.1:${plain.port}/hook`);
        await expect(stubs.deliver()).rejects.toThrow("Webhook target URL must use HTTPS.");
        expect(plain.tcpConnections).toBe(0);
      } finally {
        await plain.close();
      }
    });

    it("PIM_UNSAFE_HTTP_WEBHOOK_TARGETS=true still permits plain http and loopback, through the real default webhook transport", async () => {
      const plain = await startHttpServer("127.0.0.1");
      try {
        setConnectorTransportForTesting(null); // the real, default-configured webhook transport
        process.env.PIM_UNSAFE_HTTP_WEBHOOK_TARGETS = "true";
        const stubs = makeStubs(`http://127.0.0.1:${plain.port}/hook`);

        await stubs.deliver();

        expect(lastUpdateData(stubs.outboundWebhookDelivery.update)).toMatchObject({ status: "delivered", responseStatus: 200 });
        expect(plain.requests).toHaveLength(1);
        expect(plain.requests[0].method).toBe("POST");
        expect(plain.requests[0].headers["x-pim1-webhook-signature"]).toMatch(/^sha256=/);
      } finally {
        await plain.close();
      }
    });
  });

  describe("the default webhook transport", () => {
    it("refuses an unsafe IP literal with the webhook wording, without any connection", async () => {
      setConnectorTransportForTesting(null);
      const transport = getWebhookTransport();
      const error = await transport
        .fetch("https://[::ffff:7f00:1]:8443/", { method: "POST", redirect: "manual", body: "{}" })
        .then(() => undefined, (e: unknown) => e as Error);
      expect(error).toMatchObject({
        code: "CONNECTOR_TARGET_UNSAFE",
        reason: "PRIVATE_IP_LITERAL",
        message: "Webhook target URL points to a private or reserved IP address.",
      });
    });

    it("is a distinct instance from the connector transport (connector wording is unaffected)", async () => {
      setConnectorTransportForTesting(null);
      const connectorError = await getConnectorTransport()
        .fetch("https://127.0.0.1:8443/", { method: "GET", redirect: "manual" })
        .then(() => undefined, (e: unknown) => e as Error);
      expect(connectorError?.message).toBe("Connector base URL points to a private or reserved IP address.");
    });
  });
});
