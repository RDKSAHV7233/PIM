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
import type { LoggerService } from "../common/logging/logger.service";

const ENV = {
  CREDENTIAL_ENCRYPTION_KEY_V1: "pim1-test-encryption-key-v1-minimum-32",
  CREDENTIAL_ENCRYPTION_KEY_V2: "pim1-test-encryption-key-v2-minimum-32",
  CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION: "1",
};

function makeStubs(rows: Array<{ id: string; encryptedValue: string; keyVersion: string }>) {
  const remaining = [...rows];
  const updated: Array<{ id: string; data: Record<string, unknown> }> = [];

  const connectorCredential = {
    findMany: jest.fn().mockImplementation(({ where, take }: any) => {
      const cursor = where.id.gt as string;
      const versions: string[] = where.keyVersion.in;
      const page = remaining
        .filter((r) => r.id > cursor && versions.includes(r.keyVersion))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, take);
      return Promise.resolve(page.map((r) => ({ id: r.id, encryptedValue: r.encryptedValue, keyVersion: r.keyVersion })));
    }),
    update: jest.fn().mockImplementation(({ where, data }: any) => {
      updated.push({ id: where.id, data });
      const row = remaining.find((r) => r.id === where.id);
      if (row) {
        row.encryptedValue = data.encryptedValue;
        row.keyVersion = data.keyVersion;
      }
      return Promise.resolve(undefined);
    }),
  };

  const prismaDirect = {
    getClient: jest.fn().mockReturnValue({ connectorCredential }),
  } as unknown as PrismaDirectService;

  const logger = { info: jest.fn(), warn: jest.fn() } as unknown as LoggerService;

  return { prismaDirect, logger, connectorCredential, updated, remaining };
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
      })),
    );

    const result = await service.rotateKey({ fromVersion: 1, toVersion: 2, batchSize: 3 });

    expect(result).toEqual({ rotated: 7, failed: 0, errors: [] });
    expect(stubs.remaining.every((r) => r.keyVersion === "v2")).toBe(true);
    // Re-decrypt every rotated row under the new version to prove the plaintext survived rotation.
    stubs.remaining.forEach((row, i) => {
      expect(service.decrypt(row.encryptedValue, row.keyVersion)).toBe(plainValues[i]);
    });
    // 7 rows at batchSize 3: pages of 3+3+1, plus one final empty page to confirm the
    // cursor has drained the table — 4 calls total, proving the cursor actually advances
    // (a stuck cursor would either loop forever or stop short of all 7 rows).
    expect(stubs.connectorCredential.findMany).toHaveBeenCalledTimes(4);
  });

  it("also picks up rows tagged with the legacy unprefixed keyVersion format", async () => {
    const stubs = makeStubs([]);
    const service = makeService(stubs);
    stubs.remaining.push({ id: "cred-legacy", encryptedValue: service.encrypt("legacy-secret").cipher, keyVersion: "1" });

    const result = await service.rotateKey({ fromVersion: 1, toVersion: 2 });

    expect(result).toEqual({ rotated: 1, failed: 0, errors: [] });
    expect(stubs.remaining[0].keyVersion).toBe("v2");
  });

  it("dry run reports what would rotate but writes nothing", async () => {
    const stubs = makeStubs([]);
    const service = makeService(stubs);
    const cipher = service.encrypt("untouched-secret").cipher;
    stubs.remaining.push({ id: "cred-00", encryptedValue: cipher, keyVersion: "v1" });

    const result = await service.rotateKey({ fromVersion: 1, toVersion: 2, dryRun: true });

    expect(result).toEqual({ rotated: 1, failed: 0, errors: [] });
    expect(stubs.connectorCredential.update).not.toHaveBeenCalled();
    expect(stubs.remaining[0].keyVersion).toBe("v1");
    expect(stubs.remaining[0].encryptedValue).toBe(cipher);
  });

  it("isolates a single corrupt row's decrypt failure — the rest of the batch still rotates", async () => {
    const stubs = makeStubs([]);
    const service = makeService(stubs);
    stubs.remaining.push(
      { id: "cred-00", encryptedValue: service.encrypt("good-secret").cipher, keyVersion: "v1" },
      { id: "cred-01", encryptedValue: "enc::v1:not-valid-ciphertext", keyVersion: "v1" },
      { id: "cred-02", encryptedValue: service.encrypt("another-good-secret").cipher, keyVersion: "v1" },
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
