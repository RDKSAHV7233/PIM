// Hardening for call sites that fire a promise with `void` (no .catch): they must never reject.
// An unhandled rejection used to crash the API process (DEF-PC-013); the process guard now only logs it,
// but these hot-path helpers should not produce one at all.

import { ApiKeysService } from "../api-keys/api-keys.service";
import { AuditService } from "../audit/audit.service";
import { QueueService } from "../queue/queue.service";

function track(): { rejections: unknown[]; stop: () => void } {
  const rejections: unknown[] = [];
  const handler = (reason: unknown) => rejections.push(reason);
  process.on("unhandledRejection", handler);
  return { rejections, stop: () => process.off("unhandledRejection", handler) };
}

async function flushRejections(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe("fire-and-forget helpers never reject", () => {
  it("AuditService.record: a throwing tenant lookup is swallowed", async () => {
    const service = Object.create(AuditService.prototype) as AuditService;
    Object.assign(service, {
      prisma: {
        tenant: () => {
          throw new Error("no tenant context");
        },
      },
    });
    const watch = track();
    void service.record({ actorId: "u", actorRole: "admin", action: "POST", resource: "/x", metadata: { a: 1 } });
    await flushRejections();
    watch.stop();
    expect(watch.rejections).toEqual([]);
  });

  it("AuditService.record: invalid tenant keys and unsanitisable metadata are swallowed, valid writes still happen", async () => {
    const create = jest.fn().mockResolvedValue({});
    const service = Object.create(AuditService.prototype) as AuditService;
    Object.assign(service, { prisma: { tenant: () => ({ auditLog: { create } }) } });

    await expect(service.record({ actorId: "u", actorRole: "admin", action: "POST", resource: "/x", tenantKey: "\u0000bad" as never })).resolves.toBeUndefined();

    // 20k levels of nesting overflows the recursive sanitiser
    let nested: Record<string, unknown> = {};
    const root = nested;
    for (let i = 0; i < 20000; i += 1) {
      const next: Record<string, unknown> = {};
      nested.n = next;
      nested = next;
    }
    await expect(service.record({ actorId: "u", actorRole: "admin", action: "POST", resource: "/x", metadata: root })).resolves.toBeUndefined();

    create.mockClear();
    await service.record({ actorId: "u", actorRole: "admin", action: "POST", resource: "/x", metadata: { token: "abc", ok: 1 } });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.metadata).toEqual({ token: "[REDACTED]", ok: 1 });
  });

  it("ApiKeysService.touchLastUsed: a throwing prisma.tenant() is swallowed; a normal call still updates", async () => {
    const update = jest.fn().mockResolvedValue({});
    const throwing = Object.create(ApiKeysService.prototype) as ApiKeysService;
    Object.assign(throwing, {
      prisma: {
        tenant: () => {
          throw new Error("no tenant context");
        },
      },
    });
    const watch = track();
    void throwing.touchLastUsed("key-1");
    await flushRejections();
    watch.stop();
    expect(watch.rejections).toEqual([]);

    const working = Object.create(ApiKeysService.prototype) as ApiKeysService;
    Object.assign(working, { prisma: { tenant: () => ({ apiAccessKey: { update } }) } });
    await working.touchLastUsed("key-1");
    expect(update).toHaveBeenCalledWith({ where: { id: "key-1" }, data: { lastUsedAt: expect.any(Date) } });

    update.mockRejectedValueOnce(new Error("db down"));
    await expect(working.touchLastUsed("key-2")).resolves.toBeUndefined();
  });

  it("QueueService.captureTerminalWorkerFailure: a failing capture is logged, never rejected", async () => {
    const logger = { error: jest.fn() };
    const captureUnexpected = jest.fn().mockRejectedValue(new Error("capture store down"));
    const fake = { errorCaptureService: { captureUnexpected }, logger };
    const run = (QueueService.prototype as unknown as Record<string, (...args: unknown[]) => Promise<void>>)
      .captureTerminalWorkerFailure;

    const watch = track();
    void run.call(fake, "q", "lane", { tenantId: "t" }, new Error("boom"), {});
    await flushRejections();
    watch.stop();
    expect(captureUnexpected).toHaveBeenCalledTimes(1);
    expect(watch.rejections).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Terminal worker failure capture failed for q/lane"));
  });
});
