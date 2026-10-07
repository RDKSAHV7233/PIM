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
import { makeFakeRlsDb } from "../common/tenant/fake-rls-db-spec";
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

function makeRotationStubs(rows: Array<{ id: string; encryptedValue: string; keyVersion: string; tenantKey?: string }>, directory: string[] = []) {
  const db = makeFakeRlsDb(rows.map((r) => ({ ...r, tenantKey: r.tenantKey ?? "default" })), directory);
  const prismaDirect = { getClient: jest.fn().mockReturnValue(db.base) } as unknown as PrismaDirectService;
  const prisma = { tenant: jest.fn() } as unknown as PrismaService;
  const logger = { info: jest.fn(), warn: jest.fn() } as unknown as LoggerService;
  return { prisma, prismaDirect, logger, db, remaining: db.rows };
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

    expect(result).toMatchObject({ rotated: 2, skipped: 0, errors: 0 });
    const currentKey = keyFromEnv(ENV.CREDENTIAL_ENCRYPTION_KEY_V1);
    expect(decryptCredentialValue(stubs.remaining[0].encryptedValue, currentKey)).toBe("secret-a");
    expect(stubs.remaining[0].keyVersion).toBe("v1");
  });

  it("skips (doesn't throw on) a row whose old key version was never configured", async () => {
    const rows = [{ id: "c1", encryptedValue: "enc::v9:whatever", keyVersion: "v9" }];
    const stubs = makeRotationStubs(rows);
    const service = new ConnectorCredentialService(stubs.prisma, stubs.prismaDirect, stubs.logger);

    const result = await service.rotateAllCredentials();

    expect(result).toMatchObject({ rotated: 0, skipped: 1, errors: 0 });
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

    expect(result).toMatchObject({ rotated: 1, skipped: 0, errors: 1 });
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
    expect(result).toMatchObject({ rotated: 150, skipped: 0, errors: 0 });
    expect(stubs.remaining.filter((r) => r.keyVersion === "v2")).toHaveLength(0);
    expect(stubs.db.findManyCalls).toBe(3); // 100 + 50 + one empty call to detect drained
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

    expect(result).toMatchObject({ rotated: 1, skipped: 0, errors: 1 });
    // Terminates (doesn't hang forever re-fetching the still-stale corrupt row).
    expect(stubs.db.findManyCalls).toBeGreaterThan(0);
  });
});

describe("ConnectorCredentialService.rotateAllCredentials — every tenant, not just the default (SEC-DB-RLS-001)", () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv, ...ENV, CREDENTIAL_ENCRYPTION_KEY_V2: ENV.CREDENTIAL_ENCRYPTION_KEY_V1 };
  });
  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  const oldKey = () => keyFromEnv(ENV.CREDENTIAL_ENCRYPTION_KEY_V1);
  const stale = (id: string, tenantKey: string, plain: string) => ({ id, tenantKey, encryptedValue: encryptCredentialValue(plain, oldKey(), 1), keyVersion: "v2" });

  it("rotates a NON-DEFAULT tenant's stale credential, and the plaintext survives", async () => {
    const stubs = makeRotationStubs([stale("a1", "tenant-a", "secret-a"), stale("d1", "default", "secret-d")], ["tenant-a"]);
    const service = new ConnectorCredentialService(stubs.prisma, stubs.prismaDirect, stubs.logger);

    const result = await service.rotateAllCredentials();

    expect(result).toMatchObject({ rotated: 2, skipped: 0, errors: 0, status: "SUCCESS" });
    const a1 = stubs.remaining.find((r) => r.id === "a1")!;
    expect(a1.keyVersion).toBe("v1");
    expect(decryptCredentialValue(a1.encryptedValue, oldKey())).toBe("secret-a");
    expect(result.tenants.results.map((r) => [r.tenantKey, r.changedCount])).toEqual([["default", 1], ["tenant-a", 1]]);
  });

  it("MUTATION: the old unscoped scan, run against the same data, would have rotated only the default tenant", async () => {
    // What rotateAllCredentials used to do: one scan through the base client, which has no tenant context.
    const stubs = makeRotationStubs([stale("a1", "tenant-a", "secret-a"), stale("d1", "default", "secret-d")], ["tenant-a"]);
    const seenByOldScan = await stubs.db.base.connectorCredential.findMany({ where: { keyVersion: { not: "v1" } } });
    expect(seenByOldScan.map((r: { id: string }) => r.id)).toEqual(["d1"]);
    // ...and the real implementation, on the same data, reaches both. If it reverted to the old scan this test pair would disagree.
    const service = new ConnectorCredentialService(stubs.prisma, stubs.prismaDirect, stubs.logger);
    const result = await service.rotateAllCredentials();
    expect(result.rotated).toBe(2);
    expect(stubs.db.baseCredentialReads).toBe(1); // only the explicit read above; the implementation never reads through the base client
  });

  it("never reads credentials through the context-free client", async () => {
    const stubs = makeRotationStubs([stale("a1", "tenant-a", "secret-a")], ["tenant-a"]);
    await new ConnectorCredentialService(stubs.prisma, stubs.prismaDirect, stubs.logger).rotateAllCredentials();
    expect(stubs.db.baseCredentialReads).toBe(0);
  });

  it("leaves a credential that is already on the current key version byte-for-byte unchanged", async () => {
    const stubs = makeRotationStubs([{ id: "d1", tenantKey: "default", encryptedValue: "already-current-ciphertext", keyVersion: "v1" }, stale("a1", "tenant-a", "secret-a")], ["tenant-a"]);
    const result = await new ConnectorCredentialService(stubs.prisma, stubs.prismaDirect, stubs.logger).rotateAllCredentials();
    expect(stubs.remaining.find((r) => r.id === "d1")).toMatchObject({ encryptedValue: "already-current-ciphertext", keyVersion: "v1" });
    expect(result.rotated).toBe(1);
  });

  it("a tenant that fails does not undo another tenant's rotation, and the result is PARTIAL_FAILURE, not success", async () => {
    const stubs = makeRotationStubs([stale("a1", "tenant-a", "secret-a"), stale("b1", "tenant-b", "secret-b"), stale("d1", "default", "secret-d")], ["tenant-a", "tenant-b"]);
    stubs.db.failCommitFor.add("tenant-b");

    const result = await new ConnectorCredentialService(stubs.prisma, stubs.prismaDirect, stubs.logger).rotateAllCredentials();

    expect(result.status).toBe("PARTIAL_FAILURE");
    expect(result.tenants).toMatchObject({ tenantsEvaluated: 3, tenantsSucceeded: 2, tenantsFailed: 1, orphanDetection: "UNVERIFIED_BY_RUNTIME_ROLE" });
    expect(result.rotated).toBe(2); // only what was committed
    expect(stubs.remaining.find((r) => r.id === "a1")?.keyVersion).toBe("v1");
    expect(stubs.remaining.find((r) => r.id === "d1")?.keyVersion).toBe("v1");
    expect(stubs.remaining.find((r) => r.id === "b1")?.keyVersion).toBe("v2"); // rolled back: still stale, so the next run retries it
  });

  it("an undecryptable credential makes the run PARTIAL_FAILURE even though the tenant's other credentials rotated", async () => {
    const stubs = makeRotationStubs([stale("a1", "tenant-a", "secret-a"), { id: "a2", tenantKey: "tenant-a", encryptedValue: "enc::v0:not-valid-ciphertext", keyVersion: "v2" }], ["tenant-a"]);
    const result = await new ConnectorCredentialService(stubs.prisma, stubs.prismaDirect, stubs.logger).rotateAllCredentials();
    expect(result).toMatchObject({ rotated: 1, errors: 1, status: "PARTIAL_FAILURE" });
    expect(stubs.remaining.find((r) => r.id === "a1")?.keyVersion).toBe("v1");
  });

  it("does not claim zero orphans", async () => {
    const stubs = makeRotationStubs([], ["tenant-a"]);
    const result = await new ConnectorCredentialService(stubs.prisma, stubs.prismaDirect, stubs.logger).rotateAllCredentials();
    expect(result.tenants.orphanDetection).toBe("UNVERIFIED_BY_RUNTIME_ROLE");
  });
});
