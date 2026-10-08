import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { AuthService } from "./auth.service";

// SEC-DB-RLS-001 P2.8c: confirmPasswordReset finds the recovery token across tenants (the link carries only the token), then writes in
// the token's own tenant. The fake direct client is RLS-faithful: a query sees only rows of the tenant context the iteration set.
describe("AuthService.confirmPasswordReset — tenant of the recovery token (SEC-DB-RLS-001)", () => {
  type Token = { id: string; tenantKey: string; userId: string; purpose: string; tokenHash: string; expiresAt: Date; usedAt: Date | null };
  const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
  const future = new Date(Date.now() + 3600 * 1000);

  function makeService(tokens: Token[], options: { directory?: string[]; failTenant?: string; identityExists?: boolean } = {}) {
    const direct = {
      workspaceDirectory: { findMany: jest.fn().mockResolvedValue((options.directory ?? []).map((tenantKey) => ({ tenantKey }))) },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        let context = "";
        const tx = {
          $queryRaw: async (_strings: unknown, ...values: unknown[]) => {
            context = String(values[0]);
            return [];
          },
          authRecoveryToken: {
            findFirst: async (args: { where: { tokenHash: string; tenantKey?: string } }) => {
              if (args.where.tenantKey === undefined) throw new Error("query without a tenant filter");
              if (options.failTenant === args.where.tenantKey) {
                throw Object.assign(new Error("connection postgres://u:SECRET@h/db reset"), { code: "P1001" });
              }
              return tokens.find((t) => t.tenantKey === context && t.tenantKey === args.where.tenantKey && t.tokenHash === args.where.tokenHash) ?? null;
            },
          },
        };
        return fn(tx);
      }),
    };
    const tenantClients = new Map<string, any>();
    const prisma = {
      tenant: jest.fn((tenantKey: string) => {
        if (!tenantClients.has(tenantKey)) {
          tenantClients.set(tenantKey, {
            authIdentity: {
              findFirst: jest.fn().mockResolvedValue(options.identityExists === false ? null : { id: `ident_${tenantKey}` }),
              update: jest.fn((args: unknown) => ({ model: "identity", args })),
            },
            authRecoveryToken: { update: jest.fn((args: unknown) => ({ model: "token", args })) },
            $transaction: jest.fn(async (operations: unknown[]) => operations),
          });
        }
        return tenantClients.get(tenantKey);
      }),
    };
    const jwtBlocklistService = { revokeCredentials: jest.fn().mockResolvedValue(undefined) };
    const auditService = { record: jest.fn().mockResolvedValue(undefined) };
    const tenantDirectoryService = { resolveTenantAlias: jest.fn().mockResolvedValue({ workspaceSlug: "ws" }) };
    const service = new AuthService(
      jwtBlocklistService as never,
      prisma as never,
      { getClient: () => direct } as never,
      auditService as never,
      tenantDirectoryService as never,
      { process: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { emit: jest.fn() } as never,
    );
    (service as unknown as { clearUserFailures: jest.Mock }).clearUserFailures = jest.fn().mockResolvedValue(undefined);
    return { service, prisma, jwtBlocklistService, tenantClients };
  }

  const token = (tenantKey: string, raw: string, overrides: Partial<Token> = {}): Token => ({
    id: `rec_${tenantKey}`,
    tenantKey,
    userId: `user@${tenantKey}.test`,
    purpose: "password_reset",
    tokenHash: sha(raw),
    expiresAt: future,
    usedAt: null,
    ...overrides,
  });

  it("finds a non-default tenant's token and writes the password and the token in that tenant's own client", async () => {
    const { service, prisma, jwtBlocklistService, tenantClients } = makeService([token("tenant-b", "raw-b"), token("default", "raw-d")], { directory: ["tenant-b"] });

    const result = await service.confirmPasswordReset("raw-b", "a-long-enough-password");

    expect(result).toMatchObject({ ok: true, reset: true });
    expect(prisma.tenant).toHaveBeenCalledWith("tenant-b");
    const client = tenantClients.get("tenant-b");
    expect(client.authIdentity.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "ident_tenant-b" }, data: expect.objectContaining({ lockedUntil: null }) }));
    expect(client.authRecoveryToken.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "rec_tenant-b" }, data: { usedAt: expect.any(Date) } }));
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(jwtBlocklistService.revokeCredentials).toHaveBeenCalledWith("tenant-b", "user@tenant-b.test");
  });

  it("still resolves the default tenant's token", async () => {
    const { service, tenantClients } = makeService([token("default", "raw-d")], { directory: ["tenant-b"] });
    await expect(service.confirmPasswordReset("raw-d", "a-long-enough-password")).resolves.toMatchObject({ ok: true });
    expect(tenantClients.get("default")).toBeDefined();
  });

  it.each([
    ["an unknown token", "nope", {}],
    ["an expired token", "raw-b", { expiresAt: new Date(Date.now() - 1000) }],
    ["a used token", "raw-b", { usedAt: new Date() }],
  ])("%s is PASSWORD_RESET_TOKEN_INVALID", async (_label, raw, overrides) => {
    const { service } = makeService([token("tenant-b", "raw-b", overrides as Partial<Token>)], { directory: ["tenant-b"] });
    await expect(service.confirmPasswordReset(raw, "a-long-enough-password")).rejects.toMatchObject({ response: { error: "PASSWORD_RESET_TOKEN_INVALID" } });
    await expect(service.confirmPasswordReset(raw, "a-long-enough-password")).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("a token whose identity no longer exists is PASSWORD_RESET_TOKEN_INVALID and nothing is written", async () => {
    const { service, tenantClients } = makeService([token("tenant-b", "raw-b")], { directory: ["tenant-b"], identityExists: false });
    await expect(service.confirmPasswordReset("raw-b", "a-long-enough-password")).rejects.toMatchObject({ response: { error: "PASSWORD_RESET_TOKEN_INVALID" } });
    expect(tenantClients.get("tenant-b").$transaction).not.toHaveBeenCalled();
  });

  it("an unreadable tenant with no match is 'temporarily unavailable', never 'invalid link'; the error carries no detail", async () => {
    const { service } = makeService([token("tenant-c", "raw-c")], { directory: ["tenant-b", "tenant-c"], failTenant: "tenant-b" });
    const error = await service.confirmPasswordReset("unknown", "a-long-enough-password").catch((e: Error) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(JSON.stringify((error as ServiceUnavailableException).getResponse())).toBe(JSON.stringify({ error: "PASSWORD_RESET_TEMPORARILY_UNAVAILABLE" }));
  });

  it("a token found in a readable tenant works although another tenant is unreadable", async () => {
    const { service } = makeService([token("tenant-c", "raw-c")], { directory: ["tenant-b", "tenant-c"], failTenant: "tenant-b" });
    await expect(service.confirmPasswordReset("raw-c", "a-long-enough-password")).resolves.toMatchObject({ ok: true });
  });

  it("rejects a too-short password before touching the database", async () => {
    const { service, prisma } = makeService([], {});
    await expect(service.confirmPasswordReset("raw", "short")).rejects.toMatchObject({ response: { error: "PASSWORD_TOO_SHORT" } });
    expect(prisma.tenant).not.toHaveBeenCalled();
  });
});
