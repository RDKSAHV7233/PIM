// Coverage for ApiKeysService.resolveApiKey() — the customer-facing API
// auth decision (JwtAuthGuard falls through to this whenever a request
// carries an API key instead of a user JWT). QA's live-browser plan flagged
// §J8.3-8.5 (API auth, rate limiting, API-triggered actions) as untestable
// live because no API keys existed yet in the test tenant to test against.
//
// Separately: grepping this service and api-key-auth.ts for rate-limiting of
// any kind (§J8.4) turns up nothing — there is no rate limiter on the
// API-key auth path today. That's a real absence worth the team knowing
// about, not a bug this file can fix; not addressed here.
//
// This covers what's actually implemented and was never covered: a revoked,
// expired, or wrong-secret key must be rejected exactly like an unknown one
// (no distinguishing error that would help an attacker enumerate keys), and
// a valid key must resolve to the correct tenant/role/scopes.

import { ForbiddenException } from "@nestjs/common";
import { ApiKeysService } from "./api-keys.service";
import { buildPlainTextApiKey, generateApiKeySecret, hashApiKeySecret } from "./api-key-auth";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";

function makeRow(overrides: Partial<{
  id: string;
  tenantKey: string;
  label: string;
  role: string;
  scopes: string[];
  secretHash: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
}> = {}) {
  return {
    id: "key-1",
    tenantKey: "tenant-a",
    label: "CI integration",
    role: "viewer",
    scopes: [],
    secretHash: "",
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function makeStubs(row: ReturnType<typeof makeRow> | null) {
  const apiAccessKey = {
    findUnique: jest.fn().mockResolvedValue(row),
    update: jest.fn().mockResolvedValue(row ? { ...row, lastUsedAt: new Date() } : null),
  };
  const tenantClient = { apiAccessKey };
  const prisma = {
    tenant: jest.fn().mockReturnValue(tenantClient),
  } as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  return { prisma, audit, apiAccessKey };
}

describe("ApiKeysService.resolveApiKey — customer-facing API auth (QA §J8.3, no prior coverage)", () => {
  it("rejects a malformed key without querying the database at all", async () => {
    const stubs = makeStubs(null);
    const service = new ApiKeysService(stubs.prisma, stubs.audit);

    const result = await service.resolveApiKey("not-a-real-key-format");

    expect(result).toBeNull();
    expect(stubs.apiAccessKey.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an unknown key id the same way as any other failure (no existence leak)", async () => {
    const stubs = makeStubs(null);
    const service = new ApiKeysService(stubs.prisma, stubs.audit);

    const result = await service.resolveApiKey(buildPlainTextApiKey("unknown-id", generateApiKeySecret()));

    expect(result).toBeNull();
  });

  it("rejects a revoked key even with the exact correct secret", async () => {
    const secret = generateApiKeySecret();
    const row = makeRow({ secretHash: hashApiKeySecret(secret), revokedAt: new Date() });
    const stubs = makeStubs(row);
    const service = new ApiKeysService(stubs.prisma, stubs.audit);

    const result = await service.resolveApiKey(buildPlainTextApiKey(row.id, secret));

    expect(result).toBeNull();
  });

  it("rejects an expired key even with the exact correct secret", async () => {
    const secret = generateApiKeySecret();
    const row = makeRow({ secretHash: hashApiKeySecret(secret), expiresAt: new Date(Date.now() - 60_000) });
    const stubs = makeStubs(row);
    const service = new ApiKeysService(stubs.prisma, stubs.audit);

    const result = await service.resolveApiKey(buildPlainTextApiKey(row.id, secret));

    expect(result).toBeNull();
  });

  it("rejects the correct key id with the wrong secret", async () => {
    const row = makeRow({ secretHash: hashApiKeySecret(generateApiKeySecret()) });
    const stubs = makeStubs(row);
    const service = new ApiKeysService(stubs.prisma, stubs.audit);

    const result = await service.resolveApiKey(buildPlainTextApiKey(row.id, generateApiKeySecret()));

    expect(result).toBeNull();
  });

  it("resolves a valid, active key to the correct tenant, role, and scopes — and touches lastUsedAt separately", async () => {
    const secret = generateApiKeySecret();
    const row = makeRow({
      id: "key-42",
      tenantKey: "tenant-b",
      role: "editor",
      scopes: ["catalog.read", "catalog.write"],
      secretHash: hashApiKeySecret(secret),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const stubs = makeStubs(row);
    const service = new ApiKeysService(stubs.prisma, stubs.audit);

    const result = await service.resolveApiKey(buildPlainTextApiKey(row.id, secret));

    expect(result).toEqual({
      keyId: "key-42",
      actorId: "api_key:key-42",
      tenantId: "tenant-b",
      role: "editor",
      label: "CI integration",
      scopes: ["catalog.read", "catalog.write"],
    });

    await service.touchLastUsed(result!.keyId);
    expect(stubs.apiAccessKey.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "key-42" }, data: { lastUsedAt: expect.any(Date) } }),
    );
  });

  it("createKey refuses to mint an admin-role API key", async () => {
    const stubs = makeStubs(null);
    const service = new ApiKeysService(stubs.prisma, stubs.audit);

    await expect(
      service.createKey("tenant-a", "actor-1", "admin", { label: "too powerful", role: "admin" } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
