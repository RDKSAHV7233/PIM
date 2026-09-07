import * as bcrypt from "bcryptjs";
import { TenantDirectoryService } from "./tenant-directory.service";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function makeService() {
  const authIdentity = {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: "auth_1" }),
    update: jest.fn(),
  };
  const workspaceDirectory = {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn(({ data }) => Promise.resolve(data)),
    update: jest.fn(),
  };
  const directClient = {
    workspaceDirectory,
    authIdentity,
    market: { findFirst: jest.fn().mockResolvedValue({ id: "market_1" }) },
    $transaction: jest.fn(),
  };
  const prismaDirect = { getClient: jest.fn().mockReturnValue(directClient) };
  const prisma = { tenant: jest.fn() };
  const svc = new TenantDirectoryService(prisma as never, prismaDirect as never);
  return { svc, authIdentity };
}

describe("TenantDirectoryService — initial admin password source", () => {
  const originalAuthMode = process.env.AUTH_MODE;
  const originalAppEnv = process.env.APP_ENV;
  const originalSharedPassword = process.env.PIM_AUTH_PASSWORD;

  afterEach(() => {
    restoreEnv("AUTH_MODE", originalAuthMode);
    restoreEnv("APP_ENV", originalAppEnv);
    restoreEnv("PIM_AUTH_PASSWORD", originalSharedPassword);
  });

  it("provisionWorkspace never hashes the shared PIM_AUTH_PASSWORD fallback for a new tenant admin", async () => {
    process.env.AUTH_MODE = "db";
    process.env.APP_ENV = "staging";
    process.env.PIM_AUTH_PASSWORD = "shared-password-must-not-be-used";
    const { svc, authIdentity } = makeService();

    await svc.provisionWorkspace({
      tenantKey: "tenant-a",
      workspaceSlug: "tenant-a",
      displayName: "Tenant A",
      initialAdminUserId: "admin@example.test",
    });

    const createPayload = authIdentity.create.mock.calls[0]?.[0]?.data;
    expect(createPayload).toMatchObject({
      tenantKey: "tenant-a",
      userId: "admin@example.test",
      role: "admin",
      isActive: true,
      passwordHash: null,
    });
  });

  it("provisionWorkspaceWithPasswordHash stores only the explicit hash supplied by the caller", async () => {
    process.env.AUTH_MODE = "db";
    process.env.APP_ENV = "staging";
    process.env.PIM_AUTH_PASSWORD = "shared-password-must-not-be-used";
    const explicitHash = await bcrypt.hash("Explicit#Password2026", 12);
    const { svc, authIdentity } = makeService();

    await svc.provisionWorkspaceWithPasswordHash({
      tenantKey: "tenant-a",
      workspaceSlug: "tenant-a",
      displayName: "Tenant A",
      initialAdminUserId: "admin@example.test",
      initialAdminPasswordHash: explicitHash,
    });

    const createPayload = authIdentity.create.mock.calls[0]?.[0]?.data;
    expect(createPayload.passwordHash).toBe(explicitHash);
    await expect(bcrypt.compare("Explicit#Password2026", createPayload.passwordHash)).resolves.toBe(true);
    await expect(bcrypt.compare("shared-password-must-not-be-used", createPayload.passwordHash)).resolves.toBe(false);
  });
});
