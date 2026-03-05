import { AuditService } from "./audit.service";

describe("AuditService metadata sanitization", () => {
  it("redacts sensitive value strings even when key name is non-sensitive", async () => {
    const executeMock = jest.fn().mockResolvedValue(1);
    const prisma = {
      tenant: jest.fn().mockReturnValue({
        // RLS-BYPASS: manual tenant filter
        $executeRawUnsafe: executeMock,
      }),
    };
    const service = new AuditService(prisma as never);

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

    const metadataArg = executeMock.mock.calls[0][6] as string;
    expect(metadataArg).toContain("\"message\":\"[REDACTED]\"");
    expect(metadataArg).toContain("\"connectorSlug\":\"amazon-in\"");
  });
});
