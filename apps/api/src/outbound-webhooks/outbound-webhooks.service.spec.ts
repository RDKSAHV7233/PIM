// Coverage for OutboundWebhooksService's dispatch path — this had zero test
// coverage before. A live click-test (create a real webhook endpoint against
// a shared tenant and inspect the signed payload) was blocked by the browser
// tool's own safety classifier on the state-changing "create endpoint" step
// (QA plan §J8.2), so this exercises the same signing/dispatch mechanism the
// live test would have checked, without touching any real tenant.

import { createHmac } from "node:crypto";
import { OutboundWebhooksService } from "./outbound-webhooks.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { QueueService } from "../queue/queue.service";
import type { PlanUsageService } from "../billing/plan-usage.service";
import { buildEncryptedCredential, loadCredentialEncryptionKeys, resolveCurrentCredentialKeyVersion } from "../connector-installer/credential-encryption.util";

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

function makeStubs() {
  const endpointRow = {
    id: "endpoint-1",
    tenantKey: "tenant-a",
    targetUrl: "https://example.com/hooks/pim1",
    signingSecretEncrypted: "",
    signingSecretKeyVersion: "",
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
  const tenantClient = { outboundWebhookEndpoint, outboundWebhookDelivery };

  const prisma = {
    tenant: jest.fn().mockReturnValue(tenantClient),
  } as unknown as PrismaService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  let capturedHandler: ((payload: unknown) => Promise<void>) | null = null;
  const queueService = {
    enqueue: jest.fn().mockResolvedValue(undefined),
    processWithBackpressure: jest.fn((_name: string, _opts: unknown, handler: (payload: unknown) => Promise<void>) => {
      capturedHandler = handler;
    }),
  } as unknown as QueueService;

  const planUsage = {
    getTenantPlanProfile: jest.fn().mockResolvedValue({ accessStatus: "active" }),
  } as unknown as PlanUsageService;

  return { prisma, audit, queueService, planUsage, endpointRow, deliveryRow, outboundWebhookDelivery, outboundWebhookEndpoint, getHandler: () => capturedHandler };
}

describe("OutboundWebhooksService — dispatch signing (QA §J8.2, no prior coverage)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, ...ENV };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("signs the delivered payload with HMAC-SHA256 of `${timestamp}.${body}` using the endpoint's own decrypted secret", async () => {
    const stubs = makeStubs();
    const secret = "whsec_test_only_12345";
    const encrypted = encryptTestSecret(secret);
    stubs.endpointRow.signingSecretEncrypted = encrypted.cipher;
    stubs.endpointRow.signingSecretKeyVersion = encrypted.keyVersion;

    let capturedRequest: { url: string; init: RequestInit } | null = null;
    const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (url: any, init?: any) => {
      capturedRequest = { url: String(url), init };
      return new Response("ok", { status: 200 });
    });

    const service = new OutboundWebhooksService(stubs.prisma, stubs.audit, stubs.queueService, stubs.planUsage);
    const handler = stubs.getHandler();
    expect(handler).not.toBeNull();

    await handler!({ tenantKey: "tenant-a", endpointId: "endpoint-1", deliveryId: "delivery-1" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const headers = capturedRequest!.init.headers as Record<string, string>;
    const timestamp = headers["X-PIM1-Webhook-Timestamp"];
    const body = capturedRequest!.init.body as string;
    expect(body).toBe(JSON.stringify(stubs.deliveryRow.requestBody));

    const expectedSignature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    expect(headers["X-PIM1-Webhook-Signature"]).toBe(`sha256=${expectedSignature}`);
    expect(headers["X-PIM1-Webhook-Event"]).toBe("publish_succeeded");
    expect(headers["X-PIM1-Webhook-Delivery-Id"]).toBe("delivery-1");
  });

  it("produces a different signature for a different signing secret — proves the secret, not just the format, is checked", async () => {
    const stubs = makeStubs();
    const encrypted = encryptTestSecret("a-completely-different-secret");
    stubs.endpointRow.signingSecretEncrypted = encrypted.cipher;
    stubs.endpointRow.signingSecretKeyVersion = encrypted.keyVersion;

    let capturedRequest: { init: RequestInit } | null = null;
    jest.spyOn(global, "fetch").mockImplementation(async (_url: any, init?: any) => {
      capturedRequest = { init };
      return new Response("ok", { status: 200 });
    });

    const service = new OutboundWebhooksService(stubs.prisma, stubs.audit, stubs.queueService, stubs.planUsage);
    const handler = stubs.getHandler();
    await handler!({ tenantKey: "tenant-a", endpointId: "endpoint-1", deliveryId: "delivery-1" });

    const headers = capturedRequest!.init.headers as Record<string, string>;
    const timestamp = headers["X-PIM1-Webhook-Timestamp"];
    const body = capturedRequest!.init.body as string;
    const signatureWithWrongSecret = createHmac("sha256", "whsec_test_only_12345").update(`${timestamp}.${body}`).digest("hex");
    expect(headers["X-PIM1-Webhook-Signature"]).not.toBe(`sha256=${signatureWithWrongSecret}`);
  });

  it("marks the delivery delivered and records lastTriggeredAt on a 2xx response", async () => {
    const stubs = makeStubs();
    const encrypted = encryptTestSecret("whsec_test_only_12345");
    stubs.endpointRow.signingSecretEncrypted = encrypted.cipher;
    stubs.endpointRow.signingSecretKeyVersion = encrypted.keyVersion;
    jest.spyOn(global, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));

    const service = new OutboundWebhooksService(stubs.prisma, stubs.audit, stubs.queueService, stubs.planUsage);
    await stubs.getHandler()!({ tenantKey: "tenant-a", endpointId: "endpoint-1", deliveryId: "delivery-1" });

    expect(stubs.outboundWebhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "delivered", responseStatus: 200 }) }),
    );
    expect(stubs.outboundWebhookEndpoint.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastTriggeredAt: expect.any(Date) }) }),
    );
  });

  it("marks the delivery failed with the response status/body on a non-2xx response, without silently swallowing it", async () => {
    const stubs = makeStubs();
    const encrypted = encryptTestSecret("whsec_test_only_12345");
    stubs.endpointRow.signingSecretEncrypted = encrypted.cipher;
    stubs.endpointRow.signingSecretKeyVersion = encrypted.keyVersion;
    jest.spyOn(global, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));

    const service = new OutboundWebhooksService(stubs.prisma, stubs.audit, stubs.queueService, stubs.planUsage);
    await expect(
      stubs.getHandler()!({ tenantKey: "tenant-a", endpointId: "endpoint-1", deliveryId: "delivery-1" }),
    ).rejects.toThrow();

    expect(stubs.outboundWebhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed", responseStatus: 500 }) }),
    );
  });

  it("skips delivery entirely (no fetch) when the endpoint is inactive and delivery isn't forced", async () => {
    const stubs = makeStubs();
    stubs.endpointRow.isActive = false;
    const encrypted = encryptTestSecret("whsec_test_only_12345");
    stubs.endpointRow.signingSecretEncrypted = encrypted.cipher;
    stubs.endpointRow.signingSecretKeyVersion = encrypted.keyVersion;
    const fetchSpy = jest.spyOn(global, "fetch");

    const service = new OutboundWebhooksService(stubs.prisma, stubs.audit, stubs.queueService, stubs.planUsage);
    await stubs.getHandler()!({ tenantKey: "tenant-a", endpointId: "endpoint-1", deliveryId: "delivery-1" });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(stubs.outboundWebhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "skipped", errorMessage: "endpoint_inactive" }) }),
    );
  });

  it("skips delivery entirely (no fetch, no secret decryption) when the tenant is suspended", async () => {
    const stubs = makeStubs();
    (stubs.planUsage.getTenantPlanProfile as jest.Mock).mockResolvedValue({ accessStatus: "suspended" });
    const fetchSpy = jest.spyOn(global, "fetch");

    const service = new OutboundWebhooksService(stubs.prisma, stubs.audit, stubs.queueService, stubs.planUsage);
    await stubs.getHandler()!({ tenantKey: "tenant-a", endpointId: "endpoint-1", deliveryId: "delivery-1" });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(stubs.outboundWebhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "skipped", errorMessage: "tenant_suspended" }) }),
    );
  });
});

describe("OutboundWebhooksService — stuck-delivery recovery timer (prod-cert DEF-PC-013)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, ...ENV };
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("a DB error in the scheduled recovery is logged, not left as an unhandled rejection that would crash the API", async () => {
    const stubs = makeStubs();
    // Simulate Prisma P2024 (connection pool timeout) from the cross-tenant scan query.
    const poolTimeout = Object.assign(new Error("Timed out fetching a new connection from the connection pool"), { code: "P2024" });
    (stubs.prisma.tenant as jest.Mock).mockReturnValue({ $queryRaw: jest.fn().mockRejectedValue(poolTimeout) });

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    const service = new OutboundWebhooksService(stubs.prisma, stubs.audit, stubs.queueService, stubs.planUsage);
    const errorSpy = jest.spyOn((service as unknown as { logger: { error: (m: string) => void } }).logger, "error").mockImplementation(() => undefined);
    service.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(60_000);
    // Let the rejected promise's handlers (or, before the fix, the unhandled-rejection event) run.
    jest.useRealTimers();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    process.off("unhandledRejection", onUnhandled);
    service.onApplicationShutdown();

    // Authoritative, deterministic assertion: only a .catch on the timer's promise can produce this log.
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("[P2024]"), expect.anything());
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("recovery failed"), expect.anything());
    // Secondary check (event-loop timing dependent, so it is not the proof on its own).
    expect(unhandled).toHaveLength(0);
  });
});
