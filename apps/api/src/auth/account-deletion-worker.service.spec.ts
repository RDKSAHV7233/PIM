// Coverage for AccountDeletionWorkerService — zero test coverage before,
// despite executeAccountDeletion() performing an irreversible delete of a
// user's MFA enrollment and auth identity rows. The one guard standing
// between "delete exactly the tickets that are still scheduled" and
// "re-delete an already-completed ticket, or delete one that was
// cancelled" is a single status check with no test ever having exercised
// either branch.

process.env.AUTH_MODE = "db";

import { AccountDeletionWorkerService } from "./account-deletion-worker.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { QueueService } from "../queue/queue.service";

function makeStubs(requestRow: any = null) {
  let row = requestRow;
  const mfaDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const identityDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const requestUpdate = jest.fn().mockImplementation(({ data }: any) => {
    row = { ...row, ...data };
    return Promise.resolve(row);
  });
  const requestFindUnique = jest.fn().mockImplementation(() => Promise.resolve(row));
  const requestFindMany = jest.fn().mockResolvedValue([]);

  const tenantClient = {
    userMfaEnrollment: { deleteMany: mfaDeleteMany },
    authIdentity: { deleteMany: identityDeleteMany },
    accountDeletionRequest: { findUnique: requestFindUnique, update: requestUpdate, findMany: requestFindMany },
    $transaction: jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  const prisma = { tenant: jest.fn().mockReturnValue(tenantClient) } as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const queueService = { process: jest.fn(), enqueue: jest.fn().mockResolvedValue(undefined) } as unknown as QueueService;

  return { prisma, audit, queueService, mfaDeleteMany, identityDeleteMany, requestUpdate, getRow: () => row };
}

describe("AccountDeletionWorkerService.executeAccountDeletion — irreversible data deletion (no prior coverage)", () => {
  it("deletes MFA enrollment and auth identity, and marks the ticket completed, when scheduled", async () => {
    const stubs = makeStubs({ id: "ticket-1", status: "scheduled", actorRole: "viewer" });
    const service = new AccountDeletionWorkerService(stubs.prisma, stubs.audit, stubs.queueService);

    await (service as any).executeAccountDeletion({ ticketId: "ticket-1", tenantId: "tenant-a", userId: "user-1" });

    expect(stubs.mfaDeleteMany).toHaveBeenCalledWith({ where: { tenantKey: "tenant-a", userId: "user-1" } });
    expect(stubs.identityDeleteMany).toHaveBeenCalledWith({ where: { tenantKey: "tenant-a", userId: "user-1" } });
    expect(stubs.getRow().status).toBe("completed");
    expect(stubs.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "account.deletion_executed", resourceId: "ticket-1" }),
    );
  });

  it("does nothing when the ticket doesn't exist at all", async () => {
    const stubs = makeStubs(null);
    const service = new AccountDeletionWorkerService(stubs.prisma, stubs.audit, stubs.queueService);

    await (service as any).executeAccountDeletion({ ticketId: "ghost", tenantId: "tenant-a", userId: "user-1" });

    expect(stubs.mfaDeleteMany).not.toHaveBeenCalled();
    expect(stubs.identityDeleteMany).not.toHaveBeenCalled();
  });

  it("refuses to re-execute a ticket that's already completed — no re-deletion, no re-audit", async () => {
    const stubs = makeStubs({ id: "ticket-1", status: "completed", actorRole: "viewer" });
    const service = new AccountDeletionWorkerService(stubs.prisma, stubs.audit, stubs.queueService);

    await (service as any).executeAccountDeletion({ ticketId: "ticket-1", tenantId: "tenant-a", userId: "user-1" });

    expect(stubs.mfaDeleteMany).not.toHaveBeenCalled();
    expect(stubs.identityDeleteMany).not.toHaveBeenCalled();
    expect(stubs.audit.record).not.toHaveBeenCalled();
  });

  it("refuses to execute a ticket that was cancelled before its grace period elapsed", async () => {
    const stubs = makeStubs({ id: "ticket-1", status: "cancelled", actorRole: "viewer" });
    const service = new AccountDeletionWorkerService(stubs.prisma, stubs.audit, stubs.queueService);

    await (service as any).executeAccountDeletion({ ticketId: "ticket-1", tenantId: "tenant-a", userId: "user-1" });

    expect(stubs.identityDeleteMany).not.toHaveBeenCalled();
  });

  it("marks the ticket failed and rethrows — a partial failure isn't silently swallowed", async () => {
    const stubs = makeStubs({ id: "ticket-1", status: "scheduled", actorRole: "viewer" });
    const service = new AccountDeletionWorkerService(stubs.prisma, stubs.audit, stubs.queueService);
    (stubs.prisma.tenant("tenant-a") as any).$transaction.mockRejectedValue(new Error("db unavailable"));

    await expect(
      (service as any).executeAccountDeletion({ ticketId: "ticket-1", tenantId: "tenant-a", userId: "user-1" }),
    ).rejects.toThrow("db unavailable");

    expect(stubs.getRow().status).toBe("failed");
  });
});

describe("AccountDeletionWorkerService — auth-mode gating (no prior coverage)", () => {
  it("scheduleAccountDeletion is a no-op outside db auth mode — never enqueues a real deletion job", async () => {
    process.env.AUTH_MODE = "local";
    const stubs = makeStubs();
    const service = new AccountDeletionWorkerService(stubs.prisma, stubs.audit, stubs.queueService);

    await service.scheduleAccountDeletion({ ticketId: "t1", tenantId: "tenant-a", userId: "user-1" });

    expect(stubs.queueService.enqueue).not.toHaveBeenCalled();
    process.env.AUTH_MODE = "db";
  });

  it("scheduleAccountDeletion enqueues with the deletion grace period delay in db auth mode", async () => {
    const stubs = makeStubs();
    const service = new AccountDeletionWorkerService(stubs.prisma, stubs.audit, stubs.queueService);

    await service.scheduleAccountDeletion({ ticketId: "t1", tenantId: "tenant-a", userId: "user-1" });

    expect(stubs.queueService.enqueue).toHaveBeenCalledWith(
      expect.any(String),
      { ticketId: "t1", tenantId: "tenant-a", userId: "user-1" },
      expect.objectContaining({ delayMs: 24 * 60 * 60 * 1000 }),
    );
  });
});
