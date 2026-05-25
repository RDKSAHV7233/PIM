import { AuditService } from "./audit.service";

describe("AuditService metadata sanitization", () => {
  function createService() {
    const createMock = jest.fn().mockResolvedValue({});
    const prisma = {
      tenant: jest.fn().mockReturnValue({
        auditLog: { create: createMock },
      }),
    };
    const service = new AuditService(prisma as never);
    return { service, createMock };
  }

  it("redacts sensitive value strings even when key name is non-sensitive", async () => {
    const { service, createMock } = createService();

    await service.record({
      actorId: "user_1",
      actorRole: "admin",
      action: "CREATE",
      resource: "CONNECTOR_INSTALLATION",
      resourceId: "inst_1",
      metadata: {
        message: "temporary token value from upstream",
        connectorSlug: "amazon-in",
      },
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const metadata = createMock.mock.calls[0][0].data.metadata as Record<string, string>;
    // "message" value contains "token" — should be redacted
    expect(metadata.message).toBe("[REDACTED]");
    // "connectorSlug" value is non-sensitive — should pass through
    expect(metadata.connectorSlug).toBe("amazon-in");
  });

  it("redacts keys that match sensitive patterns regardless of value", async () => {
    const { service, createMock } = createService();

    await service.record({
      actorId: "user_1",
      actorRole: "admin",
      action: "UPDATE",
      resource: "CONNECTOR_INSTALLATION",
      resourceId: "inst_2",
      metadata: {
        apiKey: "abc123",
        refreshToken: "tok_xyz",
        displayName: "My Connector",
      },
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const metadata = createMock.mock.calls[0][0].data.metadata as Record<string, string>;
    // "apiKey" ends with "key" — redacted regardless of value
    expect(metadata.apiKey).toBe("[REDACTED]");
    // "refreshToken" contains "token" — redacted
    expect(metadata.refreshToken).toBe("[REDACTED]");
    // "displayName" is non-sensitive — passes through
    expect(metadata.displayName).toBe("My Connector");
  });

  it("does not throw when audit log write fails — primary path must continue", async () => {
    const createMock = jest.fn().mockRejectedValue(new Error("DB unavailable"));
    const prisma = {
      tenant: jest.fn().mockReturnValue({
        auditLog: { create: createMock },
      }),
    };
    const service = new AuditService(prisma as never);

    // Should not throw even though the DB call rejects
    await expect(
      service.record({
        actorId: "user_1",
        actorRole: "admin",
        action: "CREATE",
        resource: "CONNECTOR_INSTALLATION",
        resourceId: "inst_1",
      }),
    ).resolves.not.toThrow();
  });
});
