import * as bcrypt from "bcryptjs";
import { PlatformAdminController } from "./platform-admin.controller";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

describe("PlatformAdminController — tenant provisioning password contract", () => {
  const originalPlatformToken = process.env.PIM_PLATFORM_ADMIN_TOKEN;

  afterEach(() => {
    restoreEnv("PIM_PLATFORM_ADMIN_TOKEN", originalPlatformToken);
  });

  it("requires an explicit initial admin password and passes only its hash to tenant provisioning", async () => {
    process.env.PIM_PLATFORM_ADMIN_TOKEN = "test-platform-token";
    const tenantDirectoryService = {
      provisionWorkspaceWithPasswordHash: jest.fn().mockResolvedValue({
        tenantId: "tenant-a",
        workspaceSlug: "tenant-a",
        displayName: "Tenant A",
      }),
    };
    const auditService = { record: jest.fn().mockResolvedValue(undefined) };
    const controller = new PlatformAdminController(tenantDirectoryService as never, auditService as never);

    const result = await controller.createTenant(
      "test-platform-token",
      {
        tenantKey: "tenant-a",
        workspaceSlug: "tenant-a",
        displayName: "Tenant A",
        initialAdminUserId: "admin@example.test",
        initialAdminPassword: "Explicit#Password2026",
      },
      { ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } } as never,
    );

    expect(result).toMatchObject({ tenantId: "tenant-a" });
    const provisionInput = tenantDirectoryService.provisionWorkspaceWithPasswordHash.mock.calls[0]?.[0];
    expect(provisionInput).toMatchObject({
      tenantKey: "tenant-a",
      workspaceSlug: "tenant-a",
      displayName: "Tenant A",
      initialAdminUserId: "admin@example.test",
      initialAdminPasswordHash: expect.any(String),
    });
    expect(provisionInput.initialAdminPasswordHash).not.toBe("Explicit#Password2026");
    await expect(bcrypt.compare("Explicit#Password2026", provisionInput.initialAdminPasswordHash)).resolves.toBe(true);

    const auditPayloads = auditService.record.mock.calls.map((call) => call[0]);
    expect(JSON.stringify(auditPayloads)).not.toContain("Explicit#Password2026");
    expect(JSON.stringify(auditPayloads)).not.toContain("initialAdminPassword");
  });
});
