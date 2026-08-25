import { AuthService } from "./auth.service";

// PIM#656 — login()/verifyLoginMfa() fired `void this.prisma...updateMany(...)` for
// lastSignInAt with no await and no .catch() — an unhandled promise rejection, not a
// caught-and-hidden exception. Extracted into recordLastSignInAt() so the fire-and-forget
// write is intentional (still non-blocking — lastSignInAt is best-effort) but its failure
// is now caught, logged, and captured to Error Authority instead of unhandled.
//
// Tests invoke the private method directly (cast to any) rather than through the full
// login()/verifyLoginMfa() flows — those methods have a large dependency surface
// (password hashing, rate limiting, MFA, audit, notifications) unrelated to this fix;
// this proves the exact behavior that changed without needing to mock all of that.
function makeService(updateMany: jest.Mock) {
  const prisma = {
    tenant: jest.fn().mockReturnValue({
      authIdentity: { updateMany },
    }),
  };
  const queueService = { process: jest.fn() };
  const errorCaptureService = { captureUnexpected: jest.fn().mockResolvedValue(undefined) };

  const service = new AuthService(
    {} as never, // jwtBlocklistService
    prisma as never,
    {} as never, // prismaDirect
    {} as never, // auditService
    {} as never, // tenantDirectoryService
    queueService as never,
    {} as never, // authEmailService
    {} as never, // authExportStorageService
    {} as never, // planUsageService
    {} as never, // authPolicyService
    {} as never, // mfaService
    errorCaptureService as never,
  );

  return { service, errorCaptureService };
}

describe("AuthService.recordLastSignInAt — no unhandled rejection on write failure (#656)", () => {
  it("catches the failure, logs it, and captures it to Error Authority instead of an unhandled rejection", async () => {
    const updateMany = jest.fn().mockRejectedValue(new Error("connection reset"));
    const { service, errorCaptureService } = makeService(updateMany);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- invoking a private method directly
    (service as any).recordLastSignInAt("tenant1", "user1");
    // The write is intentionally fire-and-forget (not awaited by the caller in login()/
    // verifyLoginMfa() either) — flush microtasks so the internal .catch() has run.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(updateMany).toHaveBeenCalledWith({
      where: { tenantKey: "tenant1", userId: "user1" },
      data: { lastSignInAt: expect.any(Date) },
    });
    expect(errorCaptureService.captureUnexpected).toHaveBeenCalledTimes(1);
    const args = errorCaptureService.captureUnexpected.mock.calls[0][0] as {
      severity: string;
      category: string;
      routeTemplate: string;
      rawTenantKey: string;
      rawActorId: string;
    };
    expect(args.severity).toBe("p3");
    expect(args.category).toBe("database");
    expect(args.routeTemplate).toBe("auth:record-last-sign-in-at");
    expect(args.rawTenantKey).toBe("tenant1");
    expect(args.rawActorId).toBe("user1");
  });

  it("does not call Error Authority when the write succeeds", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { service, errorCaptureService } = makeService(updateMany);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- invoking a private method directly
    (service as any).recordLastSignInAt("tenant1", "user1");
    await Promise.resolve();
    await Promise.resolve();

    expect(errorCaptureService.captureUnexpected).not.toHaveBeenCalled();
  });

  it("never rejects/throws even when the write fails and no errorCaptureService is provided (proves this is no longer an unhandled rejection)", async () => {
    const updateMany = jest.fn().mockRejectedValue(new Error("connection reset"));
    const prisma = { tenant: jest.fn().mockReturnValue({ authIdentity: { updateMany } }) };
    const queueService = { process: jest.fn() };
    const service = new AuthService(
      {} as never,
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      queueService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
    );

    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- invoking a private method directly
      (service as any).recordLastSignInAt("tenant1", "user1");
    }).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
});
