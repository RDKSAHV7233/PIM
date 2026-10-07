// Coverage for ConnectorCredentialEncryptionService — this had zero test
// coverage, despite rotateKey() being a real operational procedure
// (scripts/rotate-credentials.ts) that bulk-rewrites every stored connector
// credential (WooCommerce/Shopify/Amazon/Flipkart tokens etc.) under a new
// encryption key. A pagination or dry-run bug here would either loop forever,
// silently write during a dry run, or lose a tenant's connector credentials —
// this exercises the exact mechanics: cursor pagination across multiple
// batches, dry-run never writing, and one row's decrypt failure not aborting
// the rest of the batch.

import { ConnectorCredentialEncryptionService } from "./credential-encryption.service";
import type { PrismaDirectService } from "../prisma/prisma-direct.service";
import type { PrismaService } from "../prisma/prisma.service";
import { makeFakeRlsDb } from "../common/tenant/fake-rls-db-spec";
import type { LoggerService } from "../common/logging/logger.service";

const ENV = {
  CREDENTIAL_ENCRYPTION_KEY_V1: "pim1-test-encryption-key-v1-minimum-32",
  CREDENTIAL_ENCRYPTION_KEY_V2: "pim1-test-encryption-key-v2-minimum-32",
  CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION: "1",
};

function makeStubs(rows: Array<{ id: string; encryptedValue: string; keyVersion: string; tenantKey?: string }>, directory: string[] = []) {
  const db = makeFakeRlsDb(rows.map((r) => ({ ...r, tenantKey: r.tenantKey ?? "default" })), directory);
  const prismaDirect = { getClient: jest.fn().mockReturnValue(db.base) } as unknown as PrismaDirectService;
  const logger = { info: jest.fn(), warn: jest.fn() } as unknown as LoggerService;
  return { prismaDirect, logger, db, remaining: db.rows };
}

function makeService(stubs: ReturnType<typeof makeStubs>) {
  return new ConnectorCredentialEncryptionService(stubs.prismaDirect, stubs.logger);
}

describe("ConnectorCredentialEncryptionService — key rotation (no prior coverage)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, ...ENV };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("round-trips encrypt/decrypt through the current key version", () => {
    const stubs = makeStubs([]);
    const service = makeService(stubs);

    const encrypted = service.encrypt("super-secret-token");
    expect(encrypted.keyVersion).toBe(1);
    expect(service.decrypt(encrypted.cipher, encrypted.keyVersion)).toBe("super-secret-token");
  });

  it("rotates every row across multiple batches without skipping or duplicating any", async () => {
    const stubs = makeStubs([]);
    const service = makeService(stubs);
    const plainValues = Array.from({ length: 7 }, (_, i) => `secret-${i}`);
    stubs.remaining.push(
      ...plainValues.map((plain, i) => ({
        id: `cred-${String(i).padStart(2, "0")}`,
        encryptedValue: service.encrypt(plain).cipher,
        keyVersion: "v1",
      tenantKey: "default",
      })),
    );

    const result = await service.rotateKey({ fromVersion: 1, toVersion: 2, batchSize: 3 });

    expect(result).toMatchObject({ rotated: 7, failed: 0, errors: [] });
    expect(stubs.remaining.every((r) => r.keyVersion === "v2")).toBe(true);
    // Re-decrypt every rotated row under the new version to prove the plaintext survived rotation.
    stubs.remaining.forEach((row, i) => {
      expect(service.decrypt(row.encryptedValue, row.keyVersion)).toBe(plainValues[i]);
    });
    // 7 rows at batchSize 3: pages of 3+3+1, plus one final empty page to confirm the
    // cursor has drained the table — 4 calls total, proving the cursor actually advances
    // (a stuck cursor would either loop forever or stop short of all 7 rows).
    expect(stubs.db.findManyCalls).toBe(4);
  });

  it("also picks up rows tagged with the legacy unprefixed keyVersion format", async () => {
    const stubs = makeStubs([]);
    const service = makeService(stubs);
    stubs.remaining.push({ id: "cred-legacy", encryptedValue: service.encrypt("legacy-secret").cipher, keyVersion: "1", tenantKey: "default" });

    const result = await service.rotateKey({ fromVersion: 1, toVersion: 2 });

    expect(result).toMatchObject({ rotated: 1, failed: 0, errors: [] });
    expect(stubs.remaining[0].keyVersion).toBe("v2");
  });

  it("dry run reports what would rotate but writes nothing", async () => {
    const stubs = makeStubs([]);
    const service = makeService(stubs);
    const cipher = service.encrypt("untouched-secret").cipher;
    stubs.remaining.push({ id: "cred-00", encryptedValue: cipher, keyVersion: "v1", tenantKey: "default" });

    const result = await service.rotateKey({ fromVersion: 1, toVersion: 2, dryRun: true });

    expect(result).toMatchObject({ rotated: 1, failed: 0, errors: [] });
    expect(stubs.db.updateCalls).toBe(0);
    expect(stubs.remaining[0].keyVersion).toBe("v1");
    expect(stubs.remaining[0].encryptedValue).toBe(cipher);
  });

  it("isolates a single corrupt row's decrypt failure — the rest of the batch still rotates", async () => {
    const stubs = makeStubs([]);
    const service = makeService(stubs);
    stubs.remaining.push(
      { id: "cred-00", encryptedValue: service.encrypt("good-secret").cipher, keyVersion: "v1", tenantKey: "default" },
      { id: "cred-01", encryptedValue: "enc::v1:not-valid-ciphertext", keyVersion: "v1", tenantKey: "default" },
      { id: "cred-02", encryptedValue: service.encrypt("another-good-secret").cipher, keyVersion: "v1", tenantKey: "default" },
    );

    const result = await service.rotateKey({ fromVersion: 1, toVersion: 2 });

    expect(result.rotated).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("cred-01");
    expect(stubs.remaining.find((r) => r.id === "cred-00")!.keyVersion).toBe("v2");
    expect(stubs.remaining.find((r) => r.id === "cred-02")!.keyVersion).toBe("v2");
    expect(stubs.remaining.find((r) => r.id === "cred-01")!.keyVersion).toBe("v1");
  });

  it("refuses to rotate a version onto itself", async () => {
    const stubs = makeStubs([]);
    const service = makeService(stubs);

    await expect(service.rotateKey({ fromVersion: 1, toVersion: 1 })).rejects.toThrow(
      "fromVersion and toVersion must differ.",
    );
  });

  it("refuses to rotate to/from a key version that isn't configured in this environment", async () => {
    const stubs = makeStubs([]);
    const service = makeService(stubs);

    await expect(service.rotateKey({ fromVersion: 1, toVersion: 99 })).rejects.toThrow(
      "Missing configured key for toVersion=99.",
    );
  });
});

describe("ConnectorCredentialEncryptionService — tenant-scoped credential writes (SEC-DB-RLS-001 M1a)", () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv, ...ENV };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  function makeTenantStubs() {
    const directUpsert = jest.fn().mockResolvedValue(undefined);
    const tenantUpserts = new Map<string, jest.Mock>();
    const tenantTransactions: string[] = [];
    const clientFor = (tenantKey: string) => {
      const upsert = tenantUpserts.get(tenantKey) ?? jest.fn().mockResolvedValue(undefined);
      tenantUpserts.set(tenantKey, upsert);
      const client: any = {
        connectorCredential: { upsert },
        $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => {
          tenantTransactions.push(tenantKey);
          return fn(client);
        }),
      };
      return client;
    };
    const prisma = { tenant: jest.fn().mockImplementation((key: string) => clientFor(key)) } as unknown as PrismaService;
    const prismaDirect = {
      getClient: jest.fn().mockReturnValue({ connectorCredential: { upsert: directUpsert }, $transaction: jest.fn() }),
    } as unknown as PrismaDirectService;
    const logger = { info: jest.fn(), warn: jest.fn() } as unknown as LoggerService;
    return { prisma, prismaDirect, logger, directUpsert, tenantUpserts, tenantTransactions };
  }

  const input = (tenantKey: string) => ({
    tenantKey,
    installationId: "inst-1",
    credentialType: "access_token",
    plainValue: "token",
  });

  it("writes a credential through the tenant client of its own tenant, never the context-free client", async () => {
    const stubs = makeTenantStubs();
    const service = new ConnectorCredentialEncryptionService(stubs.prismaDirect, stubs.logger, stubs.prisma);

    await service.storeCredential(input("tenant-b"));

    expect(stubs.prisma.tenant).toHaveBeenCalledWith("tenant-b");
    expect(stubs.tenantUpserts.get("tenant-b")).toHaveBeenCalledTimes(1);
    expect(stubs.directUpsert).not.toHaveBeenCalled();
  });

  it("keeps two tenants' writes on two different tenant clients", async () => {
    const stubs = makeTenantStubs();
    const service = new ConnectorCredentialEncryptionService(stubs.prismaDirect, stubs.logger, stubs.prisma);

    await service.storeCredential(input("tenant-a"));
    await service.storeCredential(input("tenant-b"));

    expect(stubs.tenantUpserts.get("tenant-a")).toHaveBeenCalledTimes(1);
    expect(stubs.tenantUpserts.get("tenant-b")).toHaveBeenCalledTimes(1);
  });

  it("opens a transaction on the tenant client and lets storeCredential reuse that transaction", async () => {
    const stubs = makeTenantStubs();
    const service = new ConnectorCredentialEncryptionService(stubs.prismaDirect, stubs.logger, stubs.prisma);

    await service.transaction("tenant-b", async (tx) => {
      await service.storeCredential(input("tenant-b"), tx);
    });

    expect(stubs.tenantTransactions).toEqual(["tenant-b"]);
    expect(stubs.tenantUpserts.get("tenant-b")).toHaveBeenCalledTimes(1);
    expect(stubs.directUpsert).not.toHaveBeenCalled();
  });

  it("still works without the tenant client (tests that build the service by hand run as the admin identity)", async () => {
    const stubs = makeTenantStubs();
    const service = new ConnectorCredentialEncryptionService(stubs.prismaDirect, stubs.logger);

    await service.storeCredential(input("tenant-b"));

    expect(stubs.directUpsert).toHaveBeenCalledTimes(1);
    expect(stubs.tenantUpserts.size).toBe(0);
  });
});

describe("ConnectorCredentialEncryptionService.rotateKey — every tenant, not just the default (SEC-DB-RLS-001)", () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv, ...ENV };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  const rowFor = (service: ConnectorCredentialEncryptionService, id: string, tenantKey: string, plain: string) => ({
    id,
    tenantKey,
    encryptedValue: service.encrypt(plain).cipher,
    keyVersion: "v1",
  });

  it("rotates a NON-DEFAULT tenant's credential from v1 to v2 and the plaintext survives; the default tenant's already-current row is untouched", async () => {
    const stubs = makeStubs([], ["tenant-a"]);
    const service = makeService(stubs);
    stubs.remaining.push(rowFor(service, "a1", "tenant-a", "secret-a"), { id: "d1", tenantKey: "default", encryptedValue: "already-v2-ciphertext", keyVersion: "v2" });

    const result = await service.rotateKey({ fromVersion: 1, toVersion: 2 });

    expect(result).toMatchObject({ rotated: 1, failed: 0, status: "SUCCESS" });
    const a1 = stubs.remaining.find((r) => r.id === "a1")!;
    expect(a1.keyVersion).toBe("v2");
    expect(service.decrypt(a1.encryptedValue, a1.keyVersion)).toBe("secret-a");
    expect(stubs.remaining.find((r) => r.id === "d1")).toMatchObject({ encryptedValue: "already-v2-ciphertext", keyVersion: "v2" });
    expect(result.tenants.results.find((r) => r.tenantKey === "tenant-a")).toMatchObject({ status: "success", changedCount: 1 });
  });

  it("MUTATION: an unscoped scan of the same data would see none of the non-default tenant's credentials", async () => {
    const stubs = makeStubs([], ["tenant-a"]);
    const service = makeService(stubs);
    stubs.remaining.push(rowFor(service, "a1", "tenant-a", "secret-a"));
    const seenByOldScan = await stubs.db.base.connectorCredential.findMany({ where: { keyVersion: { in: ["v1", "1"] } } });
    expect(seenByOldScan).toEqual([]);
    expect((await service.rotateKey({ fromVersion: 1, toVersion: 2 })).rotated).toBe(1);
  });

  it("a dry run counts the non-default tenant's credentials and writes nothing", async () => {
    const stubs = makeStubs([], ["tenant-a"]);
    const service = makeService(stubs);
    stubs.remaining.push(rowFor(service, "a1", "tenant-a", "secret-a"));
    const before = { ...stubs.remaining[0] };

    const result = await service.rotateKey({ fromVersion: 1, toVersion: 2, dryRun: true });

    expect(result.rotated).toBe(1);
    expect(stubs.db.updateCalls).toBe(0);
    expect(stubs.remaining[0]).toEqual(before);
  });

  it("a tenant that fails does not undo another's rotation: PARTIAL_FAILURE with a non-zero failed count (so the CLI exits non-zero)", async () => {
    const stubs = makeStubs([], ["tenant-a", "tenant-b"]);
    const service = makeService(stubs);
    stubs.remaining.push(rowFor(service, "a1", "tenant-a", "secret-a"), rowFor(service, "b1", "tenant-b", "secret-b"));
    stubs.db.failCommitFor.add("tenant-b");

    const result = await service.rotateKey({ fromVersion: 1, toVersion: 2 });

    expect(result.status).toBe("PARTIAL_FAILURE");
    expect(result.failed).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes("tenant-b"))).toBe(true);
    expect(stubs.remaining.find((r) => r.id === "a1")?.keyVersion).toBe("v2");
    expect(stubs.remaining.find((r) => r.id === "b1")?.keyVersion).toBe("v1");
  });

  it("never reads through the context-free client and does not claim zero orphans", async () => {
    const stubs = makeStubs([], ["tenant-a"]);
    const service = makeService(stubs);
    stubs.remaining.push(rowFor(service, "a1", "tenant-a", "secret-a"));
    const result = await service.rotateKey({ fromVersion: 1, toVersion: 2 });
    expect(stubs.db.baseCredentialReads).toBe(0);
    expect(result.tenants.orphanDetection).toBe("UNVERIFIED_BY_RUNTIME_ROLE");
  });
});
