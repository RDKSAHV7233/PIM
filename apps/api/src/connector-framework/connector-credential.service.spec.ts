// Coverage for ConnectorCredentialService — zero test coverage before,
// despite getOrRefreshAccessToken() being the fast/slow-path decision for
// every connector API call that needs a live access token, and
// rotateAllCredentials() being the automatic startup-time credential
// rotation ConnectorHeartbeatService triggers on a key-version bump.
//
// rotateAllCredentials() previously took exactly one bounded batch
// (ROTATION_BATCH_SIZE = 100) and returned — a tenant with more than 100
// stale credentials after a key-version bump needed multiple app restarts
// to finish rotating. Now loops in batches with an id-based cursor until
// every stale row is drained, in one call.

import { ConnectorCredentialService } from "./connector-credential.service";
import { encryptCredentialValue, decryptCredentialValue, formatCredentialKeyVersion } from "../connector-installer/credential-encryption.util";
import type { PrismaService } from "../prisma/prisma.service";
import type { PrismaDirectService } from "../prisma/prisma-direct.service";
import type { LoggerService } from "../common/logging/logger.service";

const ENV = {
  CREDENTIAL_ENCRYPTION_KEY_V1: "pim1-test-encryption-key-v1-minimum-32",
  CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION: "1",
};

function keyFromEnv(envVar: string): Buffer {
  const { deriveCredentialKey } = require("../connector-installer/credential-encryption.util");
  return deriveCredentialKey(envVar);
}

function makeAccessTokenStubs(row: { encryptedValue: string; keyVersion: string; expiresAt: Date | null } | null) {
  const connectorCredential = { findFirst: jest.fn().mockResolvedValue(row) };
  const prisma = { tenant: jest.fn().mockReturnValue({ connectorCredential }) } as unknown as PrismaService;
  const prismaDirect = { getClient: jest.fn() } as unknown as PrismaDirectService;
  const logger = { info: jest.fn(), warn: jest.fn() } as unknown as LoggerService;
  return { prisma, prismaDirect, logger, connectorCredential };
}

function makeRotationStubs(rows: Array<{ id: string; encryptedValue: string; keyVersion: string }>) {
  const remaining = [...rows];
  const findMany = jest.fn().mockImplementation(({ where, take }: any) => {
    const notVersion = where.keyVersion.not;
    const afterId = where.id?.gt ?? "";
    return Promise.resolve(
      remaining
        .filter((r) => r.keyVersion !== notVersion && r.id > afterId)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, take),
    );
  });
  const updateMany = jest.fn().mockImplementation(({ where, data }: any) => {
    const row = remaining.find((r) => r.id === where.id && r.keyVersion === where.keyVersion);
    if (row) {
      row.encryptedValue = data.encryptedValue;
      row.keyVersion = data.keyVersion;
      return Promise.resolve({ count: 1 });
    }
    return Promise.resolve({ count: 0 });
  });
  const prismaDirect = {
    getClient: jest.fn().mockReturnValue({ connectorCredential: { findMany, updateMany } }),
  } as unknown as PrismaDirectService;
  const prisma = { tenant: jest.fn() } as unknown as PrismaService;
  const logger = { info: jest.fn(), warn: jest.fn() } as unknown as LoggerService;
  return { prisma, prismaDirect, logger, remaining, findMany, updateMany };
}

describe("ConnectorCredentialService.getOrRefreshAccessToken — fast/slow path (no prior coverage)", () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { ...originalEnv, ...ENV }; });
  afterEach(() => { process.env = originalEnv; jest.restoreAllMocks(); });

  it("returns the decrypted token directly when it isn't near expiry, without calling the refresh callback", async () => {
    const key = keyFromEnv(ENV.CREDENTIAL_ENCRYPTION_KEY_V1);
    const encrypted = encryptCredentialValue("live-access-token", key, 1);
    const stubs = makeAccessTokenStubs({
      encryptedValue: encrypted,
      keyVersion: formatCredentialKeyVersion(1),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const service = new ConnectorCredentialService(stubs.prisma, stubs.prismaDirect, stubs.logger);
    const onRefreshNeeded = jest.fn().mockResolvedValue("should-not-be-used");

    const token = await service.getOrRefreshAccessToken("tenant-a", "install-1", "shopify", onRefreshNeeded);

    expect(token).toBe("live-access-token");
    expect(onRefreshNeeded).not.toHaveBeenCalled();
  });

  it("treats a token inside the 5-minute expiry buffer as stale and refreshes it", async () => {
    const key = keyFromEnv(ENV.CREDENTIAL_ENCRYPTION_KEY_V1);
    const encrypted = encryptCredentialValue("about-to-expire-token", key, 1);
    const stubs = makeAccessTokenStubs({
      encryptedValue: encrypted,
      keyVersion: formatCredentialKeyVersion(1),
      expiresAt: new Date(Date.now() + 4 * 60 * 1000), // inside the 5-minute buffer
    });
    const service = new ConnectorCredentialService(stubs.prisma, stubs.prismaDirect, stubs.logger);
    const onRefreshNeeded = jest.fn().mockResolvedValue("fresh-token");

    const token = await service.getOrRefreshAccessToken("tenant-a", "install-1", "shopify", onRefreshNeeded);

    expect(token).toBe("fresh-token");
    expect(onRefreshNeeded).toHaveBeenCalledTimes(1);
  });

  it("treats a token with no expiry at all as permanently fresh (e.g. Shopify offline tokens)", async () => {
    const key = keyFromEnv(ENV.CREDENTIAL_ENCRYPTION_KEY_V1);
    const encrypted = encryptCredentialValue("offline-token", key, 1);
    const stubs = makeAccessTokenStubs({
      encryptedValue: encrypted,
      keyVersion: formatCredentialKeyVersion(1),
      expiresAt: null,
    });
    const service = new ConnectorCredentialService(stubs.prisma, stubs.prismaDirect, stubs.logger);
    const onRefreshNeeded = jest.fn();

    const token = await service.getOrRefreshAccessToken("tenant-a", "install-1", "shopify", onRefreshNeeded);

    expect(token).toBe("offline-token");
    expect(onRefreshNeeded).not.toHaveBeenCalled();
  });

  it("calls the refresh callback when no credential row exists yet", async () => {
    const stubs = makeAccessTokenStubs(null);
    const service = new ConnectorCredentialService(stubs.prisma, stubs.prismaDirect, stubs.logger);
    const onRefreshNeeded = jest.fn().mockResolvedValue("first-token");

    const token = await service.getOrRefreshAccessToken("tenant-a", "install-1", "shopify", onRefreshNeeded);

    expect(token).toBe("first-token");
  });
});

describe("ConnectorCredentialService.rotateAllCredentials — startup key rotation (no prior coverage)", () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { ...originalEnv, ...ENV }; });
  afterEach(() => { process.env = originalEnv; jest.restoreAllMocks(); });

  it("rotates every stale row it's given (real crypto — plaintext survives rotation)", async () => {
    const oldKey = keyFromEnv(ENV.CREDENTIAL_ENCRYPTION_KEY_V1);
    const rows = [
      { id: "c1", encryptedValue: encryptCredentialValue("secret-a", oldKey, 1), keyVersion: "v2" },
      { id: "c2", encryptedValue: encryptCredentialValue("secret-b", oldKey, 1), keyVersion: "v2" },
    ];
    // Simulate an old key that's still configured under version 2 as well.
    process.env.CREDENTIAL_ENCRYPTION_KEY_V2 = ENV.CREDENTIAL_ENCRYPTION_KEY_V1;
    const stubs = makeRotationStubs(rows);
    const service = new ConnectorCredentialService(stubs.prisma, stubs.prismaDirect, stubs.logger);

    const result = await service.rotateAllCredentials();

    expect(result).toEqual({ rotated: 2, skipped: 0, errors: 0 });
    const currentKey = keyFromEnv(ENV.CREDENTIAL_ENCRYPTION_KEY_V1);
    expect(decryptCredentialValue(stubs.remaining[0].encryptedValue, currentKey)).toBe("secret-a");
    expect(stubs.remaining[0].keyVersion).toBe("v1");
  });

  it("skips (doesn't throw on) a row whose old key version was never configured", async () => {
    const rows = [{ id: "c1", encryptedValue: "enc::v9:whatever", keyVersion: "v9" }];
    const stubs = makeRotationStubs(rows);
    const service = new ConnectorCredentialService(stubs.prisma, stubs.prismaDirect, stubs.logger);

    const result = await service.rotateAllCredentials();

    expect(result).toEqual({ rotated: 0, skipped: 1, errors: 0 });
  });

  it("isolates one row's corrupt ciphertext as an error, not a batch-aborting throw", async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY_V2 = ENV.CREDENTIAL_ENCRYPTION_KEY_V1;
    const oldKey = keyFromEnv(ENV.CREDENTIAL_ENCRYPTION_KEY_V1);
    const rows = [
      { id: "good", encryptedValue: encryptCredentialValue("secret-a", oldKey, 1), keyVersion: "v2" },
      { id: "corrupt", encryptedValue: "enc::v0:not-valid-ciphertext", keyVersion: "v2" },
    ];
    const stubs = makeRotationStubs(rows);
    const service = new ConnectorCredentialService(stubs.prisma, stubs.prismaDirect, stubs.logger);

    const result = await service.rotateAllCredentials();

    expect(result).toEqual({ rotated: 1, skipped: 0, errors: 1 });
  });

  it("drains more than one batch of stale rows in a single call, not just the first ROTATION_BATCH_SIZE (100)", async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY_V2 = ENV.CREDENTIAL_ENCRYPTION_KEY_V1;
    const oldKey = keyFromEnv(ENV.CREDENTIAL_ENCRYPTION_KEY_V1);
    // ids zero-padded so the mock's lexicographic id sort matches insertion order.
    const rows = Array.from({ length: 150 }, (_, i) => ({
      id: `c${String(i).padStart(4, "0")}`,
      encryptedValue: encryptCredentialValue(`secret-${i}`, oldKey, 1),
      keyVersion: "v2",
    }));
    const stubs = makeRotationStubs(rows);
    const service = new ConnectorCredentialService(stubs.prisma, stubs.prismaDirect, stubs.logger);

    const result = await service.rotateAllCredentials();

    // All 150 rows rotate in one call now, across 2 batches (100 + 50) — no more
    // restart-required gap for a tenant with >ROTATION_BATCH_SIZE stale credentials.
    expect(result).toEqual({ rotated: 150, skipped: 0, errors: 0 });
    expect(stubs.remaining.filter((r) => r.keyVersion === "v2")).toHaveLength(0);
    expect(stubs.findMany).toHaveBeenCalledTimes(3); // 100 + 50 + one empty call to detect drained
  });

  it("advances past a row that fails to rotate via the id cursor, instead of re-fetching and re-failing it forever", async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY_V2 = ENV.CREDENTIAL_ENCRYPTION_KEY_V1;
    const oldKey = keyFromEnv(ENV.CREDENTIAL_ENCRYPTION_KEY_V1);
    const rows = [
      { id: "c1-corrupt", encryptedValue: "enc::v0:not-valid-ciphertext", keyVersion: "v2" },
      { id: "c2-good", encryptedValue: encryptCredentialValue("secret-b", oldKey, 1), keyVersion: "v2" },
    ];
    const stubs = makeRotationStubs(rows);
    const service = new ConnectorCredentialService(stubs.prisma, stubs.prismaDirect, stubs.logger);

    const result = await service.rotateAllCredentials();

    expect(result).toEqual({ rotated: 1, skipped: 0, errors: 1 });
    // Terminates (doesn't hang forever re-fetching the still-stale corrupt row).
    expect(stubs.findMany.mock.calls.length).toBeGreaterThan(0);
  });
});
