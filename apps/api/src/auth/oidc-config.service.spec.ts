// Coverage for OidcConfigService — the encrypt-on-write / decrypt-on-read
// storage layer OidcService.getDecrypted() relies on for the client secret
// used in every SSO token exchange. Zero test coverage before, despite
// handling the same encrypted-credential pattern already covered elsewhere
// this session (#832, #834) for connector credentials — this is the OIDC
// client secret's own version of it, and it has one property those don't:
// a "disabled" config (status !== "active") must be unusable for login even
// though the row — and its still-valid encrypted secret — still exists.

import { NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { OidcConfigService } from "./oidc-config.service";
import type { PrismaService } from "../prisma/prisma.service";

const ENV = {
  CREDENTIAL_ENCRYPTION_KEY_V1: "pim1-test-encryption-key-v1-minimum-32",
  CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION: "1",
};

function makeStubs() {
  let row: any = null;
  const oidcConfig = {
    upsert: jest.fn().mockImplementation(({ create, update }: any) => {
      row = row ? { ...row, ...update } : { ...create, createdAt: new Date(), updatedAt: new Date() };
      return Promise.resolve(row);
    }),
    findUnique: jest.fn().mockImplementation(() => Promise.resolve(row)),
    delete: jest.fn().mockImplementation(() => {
      row = null;
      return Promise.resolve(undefined);
    }),
  };
  const prisma = { tenant: jest.fn().mockReturnValue({ oidcConfig }) } as unknown as PrismaService;
  return { prisma, oidcConfig, getRow: () => row };
}

describe("OidcConfigService — client-secret encryption at rest (no prior coverage)", () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { ...originalEnv, ...ENV }; });
  afterEach(() => { process.env = originalEnv; });

  it("never stores the client secret in plaintext, and never returns it from a plain view", async () => {
    const stubs = makeStubs();
    const service = new OidcConfigService(stubs.prisma);

    const view = await service.upsert("tenant-a", {
      issuer: "https://idp.example.com/",
      clientId: "client-1",
      clientSecret: "super-secret-value",
      callbackUrl: "https://app.example.com/callback",
    } as any);

    expect(JSON.stringify(view)).not.toContain("super-secret-value");
    expect(stubs.getRow().clientSecretEnc).not.toContain("super-secret-value");
    expect(stubs.getRow().clientSecretEnc).toMatch(/^enc::v1:/);
  });

  it("trims a trailing slash from the issuer on write", async () => {
    const stubs = makeStubs();
    const service = new OidcConfigService(stubs.prisma);

    const view = await service.upsert("tenant-a", {
      issuer: "https://idp.example.com/",
      clientId: "client-1",
      clientSecret: "secret",
      callbackUrl: "https://app.example.com/callback",
    } as any);

    expect(view.issuer).toBe("https://idp.example.com");
  });

  it("round-trips the exact client secret through getDecrypted() after upsert", async () => {
    const stubs = makeStubs();
    const service = new OidcConfigService(stubs.prisma);
    await service.upsert("tenant-a", {
      issuer: "https://idp.example.com",
      clientId: "client-1",
      clientSecret: "round-trip-me",
      callbackUrl: "https://app.example.com/callback",
    } as any);

    const decrypted = await service.getDecrypted("tenant-a");

    expect(decrypted.clientSecret).toBe("round-trip-me");
    expect(decrypted.issuer).toBe("https://idp.example.com");
  });

  it("get() throws NotFoundException when no config exists for the tenant", async () => {
    const stubs = makeStubs();
    const service = new OidcConfigService(stubs.prisma);

    await expect(service.get("tenant-a")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("delete() throws NotFoundException when there's nothing to delete", async () => {
    const stubs = makeStubs();
    const service = new OidcConfigService(stubs.prisma);

    await expect(service.delete("tenant-a")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("getDecrypted() throws when no config exists at all", async () => {
    const stubs = makeStubs();
    const service = new OidcConfigService(stubs.prisma);

    await expect(service.getDecrypted("tenant-a")).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("getDecrypted() refuses a disabled config even though the row (and its valid secret) still exists", async () => {
    const stubs = makeStubs();
    const service = new OidcConfigService(stubs.prisma);
    await service.upsert("tenant-a", {
      issuer: "https://idp.example.com",
      clientId: "client-1",
      clientSecret: "still-a-valid-secret",
      callbackUrl: "https://app.example.com/callback",
    } as any);
    stubs.getRow().status = "disabled";

    await expect(service.getDecrypted("tenant-a")).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("getDecrypted() throws a clear error rather than a raw decrypt failure when the stored key version isn't configured", async () => {
    const stubs = makeStubs();
    const service = new OidcConfigService(stubs.prisma);
    await service.upsert("tenant-a", {
      issuer: "https://idp.example.com",
      clientId: "client-1",
      clientSecret: "secret",
      callbackUrl: "https://app.example.com/callback",
    } as any);
    stubs.getRow().clientSecretKeyVersion = "v9"; // never configured

    await expect(service.getDecrypted("tenant-a")).rejects.toThrow(/Missing credential encryption key/);
  });
});
