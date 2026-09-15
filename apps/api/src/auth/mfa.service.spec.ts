// Coverage for MfaService — a hand-rolled RFC 6238 TOTP + backup-code
// implementation (base32 encode/decode, HOTP, time-window matching) with
// zero test coverage, despite being the exact mechanism this session's
// #824 and #827 already worked on (MFA enforcement copy, grace period).
// Nothing has ever checked that this implementation actually produces
// standard-compliant codes an authenticator app would agree with, or that
// backup codes are truly single-use.
//
// To make this a real correctness check rather than a tautology, the test
// computes its own TOTP codes with an independent RFC 4226/6238
// implementation (below) rather than reusing anything from mfa.service.ts —
// if the app's hotp()/totp() ever drifted from the standard (wrong byte
// order, off-by-one in the time step, wrong truncation), this would catch it
// even though the app's own internals would happily agree with themselves.

import { UnauthorizedException, BadRequestException } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { MfaService } from "./mfa.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";

const ENV = {
  CREDENTIAL_ENCRYPTION_KEY_V1: "pim1-test-encryption-key-v1-minimum-32",
  CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION: "1",
};

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function independentDecodeBase32(input: string): Buffer {
  const normalized = input.replace(/=+$/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

// RFC 4226 HOTP + RFC 6238 TOTP, written independently of mfa.service.ts's
// own hotp()/totp() so this test can't just be checking the app against itself.
function independentTotp(secretBase32: string, atMs: number, digits = 6, periodSeconds = 30): string {
  const counter = Math.floor(atMs / 1000 / periodSeconds);
  const secret = independentDecodeBase32(secretBase32);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

function makeStubs() {
  const enrollmentRows = new Map<string, any>();
  const backupCodeRows = new Map<string, any>();
  const identities = new Map<string, any>();
  let idCounter = 0;

  const authIdentity = {
    findFirst: jest.fn().mockImplementation(({ where }: any) => {
      const identity = identities.get(`${where.tenantKey}:${where.userId}`);
      return Promise.resolve(identity ?? null);
    }),
  };

  const userMfaEnrollment = {
    findUnique: jest.fn().mockImplementation(({ where }: any) => {
      const key = where.tenantKey_userId_method;
      return Promise.resolve(enrollmentRows.get(`${key.tenantKey}:${key.userId}:${key.method}`) ?? null);
    }),
    upsert: jest.fn().mockImplementation(({ where, create, update }: any) => {
      const key = where.tenantKey_userId_method;
      const mapKey = `${key.tenantKey}:${key.userId}:${key.method}`;
      const existing = enrollmentRows.get(mapKey);
      const row = existing
        ? { ...existing, ...update, id: existing.id }
        : { ...create, id: `enroll-${++idCounter}` };
      enrollmentRows.set(mapKey, row);
      return Promise.resolve(row);
    }),
    update: jest.fn().mockImplementation(({ where, data }: any) => {
      for (const row of enrollmentRows.values()) {
        if (row.id === where.id) {
          Object.assign(row, data);
          return Promise.resolve(row);
        }
      }
      return Promise.resolve(null);
    }),
  };

  const userMfaBackupCode = {
    deleteMany: jest.fn().mockImplementation(({ where }: any) => {
      let count = 0;
      for (const [k, row] of backupCodeRows) {
        if (row.enrollmentId === where.enrollmentId) {
          backupCodeRows.delete(k);
          count++;
        }
      }
      return Promise.resolve({ count });
    }),
    createMany: jest.fn().mockImplementation(({ data }: any) => {
      for (const row of data) {
        backupCodeRows.set(`bc-${++idCounter}`, { ...row, id: `bc-${idCounter}` });
      }
      return Promise.resolve({ count: data.length });
    }),
    findFirst: jest.fn().mockImplementation(({ where }: any) => {
      for (const row of backupCodeRows.values()) {
        if (row.enrollmentId === where.enrollmentId && row.codeHash === where.codeHash) {
          return Promise.resolve(row);
        }
      }
      return Promise.resolve(null);
    }),
    delete: jest.fn().mockImplementation(({ where }: any) => {
      for (const [k, row] of backupCodeRows) {
        if (row.id === where.id) {
          backupCodeRows.delete(k);
          return Promise.resolve(row);
        }
      }
      return Promise.resolve(null);
    }),
  };

  const tenantClient = {
    authIdentity,
    userMfaEnrollment,
    userMfaBackupCode,
    tenantAuthPolicy: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  const prisma = { tenant: jest.fn().mockReturnValue(tenantClient) } as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  identities.set("tenant-a:user1", { id: "identity-1" });

  return { prisma, audit, enrollmentRows, backupCodeRows };
}

describe("MfaService — TOTP + backup codes (no prior coverage)", () => {
  const originalEnv = process.env;
  const REAL_NOW = 1_757_000_000_000; // fixed instant, aligned to no particular boundary

  beforeEach(() => {
    process.env = { ...originalEnv, ...ENV };
    jest.spyOn(Date, "now").mockReturnValue(REAL_NOW);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("accepts a code computed by an independent, standard-compliant TOTP implementation", async () => {
    const stubs = makeStubs();
    const service = new MfaService(stubs.prisma, stubs.audit);

    const enrollment = await service.beginEnrollment("user1", "tenant-a", "viewer");
    const correctCode = independentTotp(enrollment.manualEntryKey, REAL_NOW);

    const result = await service.verifyEnrollment("user1", "tenant-a", "viewer", correctCode);

    expect(result.ok).toBe(true);
    expect(result.backupCodes).toHaveLength(8);
  });

  it("rejects a code that doesn't match, even one digit off", async () => {
    const stubs = makeStubs();
    const service = new MfaService(stubs.prisma, stubs.audit);

    const enrollment = await service.beginEnrollment("user1", "tenant-a", "viewer");
    const correctCode = independentTotp(enrollment.manualEntryKey, REAL_NOW);
    const wrongCode = String((Number(correctCode) + 1) % 1_000_000).padStart(6, "0");

    await expect(service.verifyEnrollment("user1", "tenant-a", "viewer", wrongCode)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("accepts a code from one time-step in the past or future (the documented ±1 window)", async () => {
    const stubs = makeStubs();
    const service = new MfaService(stubs.prisma, stubs.audit);
    const enrollment = await service.beginEnrollment("user1", "tenant-a", "viewer");

    const pastStepCode = independentTotp(enrollment.manualEntryKey, REAL_NOW - 30_000);
    await service.verifyEnrollment("user1", "tenant-a", "viewer", pastStepCode);
  });

  it("rejects a code two time-steps away — the window has an actual edge, not unlimited drift", async () => {
    const stubs = makeStubs();
    const service = new MfaService(stubs.prisma, stubs.audit);
    const enrollment = await service.beginEnrollment("user1", "tenant-a", "viewer");

    const twoStepsAwayCode = independentTotp(enrollment.manualEntryKey, REAL_NOW - 60_000);
    // Only assert rejection if it isn't coincidentally equal to a code inside the accepted window
    // (astronomically unlikely for 6-digit codes, but keep the test honest either way).
    const inWindow = [-1, 0, 1].some(
      (step) => independentTotp(enrollment.manualEntryKey, REAL_NOW + step * 30_000) === twoStepsAwayCode,
    );
    if (!inWindow) {
      await expect(
        service.verifyEnrollment("user1", "tenant-a", "viewer", twoStepsAwayCode),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it("logs in with a real backup code exactly once — the second use of the same code fails", async () => {
    const stubs = makeStubs();
    const service = new MfaService(stubs.prisma, stubs.audit);
    const enrollment = await service.beginEnrollment("user1", "tenant-a", "viewer");
    const correctCode = independentTotp(enrollment.manualEntryKey, REAL_NOW);
    const { backupCodes } = await service.verifyEnrollment("user1", "tenant-a", "viewer", correctCode);

    const firstUse = await service.verifyMfaForLogin("user1", "tenant-a", backupCodes[0]);
    expect(firstUse).toBe(true);

    const secondUse = await service.verifyMfaForLogin("user1", "tenant-a", backupCodes[0]);
    expect(secondUse).toBe(false);
  });

  it("regenerating backup codes invalidates every old code, not just augments the set", async () => {
    const stubs = makeStubs();
    const service = new MfaService(stubs.prisma, stubs.audit);
    const enrollment = await service.beginEnrollment("user1", "tenant-a", "viewer");
    const correctCode = independentTotp(enrollment.manualEntryKey, REAL_NOW);
    const { backupCodes: oldCodes } = await service.verifyEnrollment("user1", "tenant-a", "viewer", correctCode);

    const totpCodeForRegen = independentTotp(enrollment.manualEntryKey, REAL_NOW);
    const { backupCodes: newCodes } = await service.regenerateBackupCodes(
      "user1",
      "tenant-a",
      "viewer",
      totpCodeForRegen,
    );

    expect(await service.verifyMfaForLogin("user1", "tenant-a", oldCodes[0])).toBe(false);
    expect(await service.verifyMfaForLogin("user1", "tenant-a", newCodes[0])).toBe(true);
  });

  it("refuses to start enrollment for a user with no active identity in the tenant", async () => {
    const stubs = makeStubs();
    const service = new MfaService(stubs.prisma, stubs.audit);

    await expect(service.beginEnrollment("ghost-user", "tenant-a", "viewer")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("verifyMfaForLogin returns false (not an exception) for a user with no enrollment at all", async () => {
    const stubs = makeStubs();
    const service = new MfaService(stubs.prisma, stubs.audit);

    const result = await service.verifyMfaForLogin("user1", "tenant-a", "000000");
    expect(result).toBe(false);
  });
});
