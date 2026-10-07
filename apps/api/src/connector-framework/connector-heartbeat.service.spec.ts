// Coverage for ConnectorHeartbeatService. Two properties matter:
//
//  1. Credential health is recorded truthfully. Provider availability is not credential
//     validity: only an explicit rejection (INVALID) may expire credentials. A timeout / DNS
//     failure / 429 / 5xx / crashed verifier is INDETERMINATE and keeps the installation's
//     status; a refused target (unsafe URL, blocked redirect) is CONFIGURATION_ERROR and does
//     not touch credentials. `lastValidatedAt` moves only on VALID.
//  2. Every installation is visited: the batch is ordered never-attempted first, then
//     longest-unattempted, so a fleet larger than the batch size is rotated through.
//
// The startup key-rotation trigger (skip entirely when nothing is stale, so a normal boot
// never pays for a rotation scan) is covered at the bottom. Both methods are private; this
// reaches them the same way #839's AccountDeletionWorkerService tests did.

import { ConnectorHeartbeatService } from "./connector-heartbeat.service";
import { BOOLEAN_FALSE_MEANS_REJECTION } from "./credential-validation";
import type { CredentialVerificationResult } from "./connector.interface";
import type { PrismaDirectService } from "../prisma/prisma-direct.service";
import { makeFakeRlsDb } from "../common/tenant/fake-rls-db-spec";
import type { ConnectorRegistry } from "./connector.registry";
import type { ConnectorCredentialService } from "./connector-credential.service";
import type { ConnectorHttpClient } from "./connector-http-client.service";
import type { LoggerService } from "../common/logging/logger.service";

type Row = {
  id: string;
  tenantKey: string;
  connectorId: string;
  status: string;
  lastValidatedAt?: Date | null;
  lastValidationAttemptAt?: Date | null;
  lastValidationOutcome?: string | null;
  lastValidationReason?: string | null;
};

type FakeConnector = {
  validateCredentials: jest.Mock;
  validateStoredCredentialsDetailed?: jest.Mock;
};

// Interprets the orderBy the SERVICE actually sends, like Prisma would (field: "asc" | "desc" |
// { sort, nulls }). Ties and fields it is not given fall through to insertion order, so a service
// that stops requesting a deterministic order gets the order it deserves, not the one the test wants.
type OrderByEntry = Record<string, "asc" | "desc" | { sort: "asc" | "desc"; nulls?: "first" | "last" }>;
function comparatorFor(orderBy: OrderByEntry | OrderByEntry[] | undefined): (a: Row, b: Row) => number {
  const entries = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).flatMap((e) => Object.entries(e));
  return (a, b) => {
    for (const [field, spec] of entries) {
      const sort = typeof spec === "string" ? spec : spec.sort;
      const nulls = typeof spec === "string" ? "last" : (spec.nulls ?? "last");
      const av = (a as any)[field] instanceof Date ? (a as any)[field].getTime() : (a as any)[field] ?? null;
      const bv = (b as any)[field] instanceof Date ? (b as any)[field].getTime() : (b as any)[field] ?? null;
      if (av === bv) continue;
      if (av === null) return nulls === "first" ? -1 : 1;
      if (bv === null) return nulls === "first" ? 1 : -1;
      const cmp = av < bv ? -1 : 1;
      return sort === "asc" ? cmp : -cmp;
    }
    return 0;
  };
}

function makeStubs(installations: Row[] = [], definitions: any[] = []) {
  const installationRows = new Map<string, Row>(installations.map((i) => [i.id, { ...i }]));
  const connectorInstallation = {
    // Honors where.status.in, orderBy (attempt NULLS FIRST, then id) and take, like the real query.
    findMany: jest.fn().mockImplementation((args: any = {}) => {
      let rows = [...installationRows.values()];
      const allowed: string[] | undefined = args.where?.status?.in;
      if (allowed) rows = rows.filter((r) => allowed.includes(r.status));
      rows.sort(comparatorFor(args.orderBy));
      if (typeof args.take === "number") rows = rows.slice(0, args.take);
      return Promise.resolve(rows.map((r) => ({ id: r.id, tenantKey: r.tenantKey, connectorId: r.connectorId })));
    }),
    updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
      const row = installationRows.get(where.id);
      if (!row) return Promise.resolve({ count: 0 });
      if (where.status && row.status !== where.status) return Promise.resolve({ count: 0 });
      if (where.tenantKey && row.tenantKey !== where.tenantKey) return Promise.resolve({ count: 0 });
      Object.assign(row, data);
      return Promise.resolve({ count: 1 });
    }),
  };
  const connectorDefinition = { findMany: jest.fn().mockResolvedValue(definitions) };
  const connectorCredential = { count: jest.fn().mockResolvedValue(0) };
  // The same object is the base client and every tenant transaction client here: these tests are about heartbeat behaviour, not RLS.
  const baseClient: any = { connectorInstallation, connectorDefinition, connectorCredential, workspaceDirectory: { findMany: jest.fn().mockResolvedValue([]) }, $queryRaw: jest.fn().mockResolvedValue([]) };
  baseClient.$transaction = jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(baseClient));
  const prismaDirect = {
    getClient: jest.fn().mockReturnValue(baseClient),
  } as unknown as PrismaDirectService;

  // By default every slug resolves to one connector with both verifiers.
  const connector: FakeConnector = { validateCredentials: jest.fn(), validateStoredCredentialsDetailed: jest.fn() };
  const connectorsBySlug = new Map<string, FakeConnector>();
  const registry = {
    getConnector: jest.fn().mockImplementation((slug: string) => connectorsBySlug.get(slug) ?? connector),
  } as unknown as ConnectorRegistry;
  const credentialService = { rotateAllCredentials: jest.fn(), getOrRefreshAccessToken: jest.fn() } as unknown as ConnectorCredentialService;
  const httpClient = { fetch: jest.fn() } as unknown as ConnectorHttpClient;
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService;

  return { prismaDirect, registry, credentialService, httpClient, logger, connector, connectorsBySlug, connectorInstallation, connectorCredential, installationRows };
}

function makeService(stubs: ReturnType<typeof makeStubs>) {
  return new ConnectorHeartbeatService(stubs.prismaDirect, stubs.registry, stubs.credentialService, stubs.httpClient, stubs.logger);
}

const run = (service: ConnectorHeartbeatService) => (service as any).runHeartbeat() as Promise<void>;

const INSTALL_ACTIVE: Row = { id: "install-1", tenantKey: "tenant-a", connectorId: "def-1", status: "ACTIVE" };
const INSTALL_EXPIRED: Row = { id: "install-2", tenantKey: "tenant-a", connectorId: "def-1", status: "CREDENTIAL_EXPIRED" };
const DEF = { id: "def-1", slug: "shopify" };

const detailed = (stubs: ReturnType<typeof makeStubs>, result: CredentialVerificationResult) =>
  stubs.connector.validateStoredCredentialsDetailed!.mockResolvedValue(result);

describe("ConnectorHeartbeatService.runHeartbeat - truthful credential health", () => {
  describe("VALID", () => {
    it("records lastValidatedAt and the attempt, and promotes CREDENTIAL_EXPIRED back to ACTIVE", async () => {
      const stubs = makeStubs([{ ...INSTALL_EXPIRED }], [DEF]);
      detailed(stubs, { outcome: "valid" });
      await run(makeService(stubs));

      const row = stubs.installationRows.get("install-2")!;
      expect(row.status).toBe("ACTIVE");
      expect(row.lastValidatedAt).toBeInstanceOf(Date);
      expect(row.lastValidationAttemptAt).toBeInstanceOf(Date);
      expect(row.lastValidationOutcome).toBe("VALID");
      expect(row.lastValidationReason).toBeNull();
    });

    it("leaves an already-ACTIVE installation's status and updatedAt alone (no status write)", async () => {
      const stubs = makeStubs([{ ...INSTALL_ACTIVE }], [DEF]);
      detailed(stubs, { outcome: "valid" });
      await run(makeService(stubs));

      const row = stubs.installationRows.get("install-1")!;
      expect(row.status).toBe("ACTIVE");
      // The validation-facts write never carries status or updatedAt; the only status write is
      // guarded on CREDENTIAL_EXPIRED, so it matches nothing for an ACTIVE row.
      expect(row).not.toHaveProperty("updatedAt");
      const factsWrites = stubs.connectorInstallation.updateMany.mock.calls.filter(([call]: any[]) => !call.where.status);
      expect(factsWrites).toHaveLength(1);
      expect(factsWrites[0][0].data).not.toHaveProperty("status");
      expect(factsWrites[0][0].data).not.toHaveProperty("updatedAt");
    });
  });

  describe("INVALID (explicit rejection only)", () => {
    it("expires the credentials, records the reason and the attempt, and does NOT touch lastValidatedAt", async () => {
      const previouslyValidated = new Date("2026-09-01T00:00:00Z");
      const stubs = makeStubs([{ ...INSTALL_ACTIVE, lastValidatedAt: previouslyValidated }], [DEF]);
      detailed(stubs, { outcome: "invalid", reasonCode: "HTTP_401" });
      await run(makeService(stubs));

      const row = stubs.installationRows.get("install-1")!;
      expect(row.status).toBe("CREDENTIAL_EXPIRED");
      expect(row.lastValidationOutcome).toBe("INVALID");
      expect(row.lastValidationReason).toBe("HTTP_401");
      expect(row.lastValidationAttemptAt).toBeInstanceOf(Date);
      expect(row.lastValidatedAt).toBe(previouslyValidated);
    });
  });

  describe("INDETERMINATE (no evidence either way)", () => {
    it.each(["HTTP_503", "HTTP_429", "TIMEOUT", "DNS", "UNKNOWN_NETWORK_ERROR"])(
      "an ACTIVE installation stays ACTIVE when the check is unavailable (%s)",
      async (reasonCode) => {
        const stubs = makeStubs([{ ...INSTALL_ACTIVE }], [DEF]);
        detailed(stubs, { outcome: "unavailable", reasonCode });
        await run(makeService(stubs));

        const row = stubs.installationRows.get("install-1")!;
        expect(row.status).toBe("ACTIVE");
        expect(row.lastValidationOutcome).toBe("INDETERMINATE");
        expect(row.lastValidationReason).toBe(reasonCode);
        expect(row.lastValidatedAt ?? null).toBeNull(); // never stamped as validated
        expect(row.lastValidationAttemptAt).toBeInstanceOf(Date);
      },
    );

    it("an outage does NOT promote an already-expired installation back to ACTIVE", async () => {
      const stubs = makeStubs([{ ...INSTALL_EXPIRED }], [DEF]);
      detailed(stubs, { outcome: "unavailable", reasonCode: "HTTP_503" });
      await run(makeService(stubs));

      const row = stubs.installationRows.get("install-2")!;
      expect(row.status).toBe("CREDENTIAL_EXPIRED");
      expect(row.lastValidationOutcome).toBe("INDETERMINATE");
    });

    it("a verifier that throws is INDETERMINATE (HEARTBEAT_ERROR), changes no status, and does not stop the batch", async () => {
      const stubs = makeStubs([{ ...INSTALL_ACTIVE }, { ...INSTALL_EXPIRED }], [DEF]);
      stubs.connector.validateStoredCredentialsDetailed!
        .mockRejectedValueOnce(new Error("socket hang up"))
        .mockResolvedValueOnce({ outcome: "valid" });
      await run(makeService(stubs));

      const first = stubs.installationRows.get("install-1")!;
      expect(first.status).toBe("ACTIVE");
      expect(first.lastValidationOutcome).toBe("INDETERMINATE");
      expect(first.lastValidationReason).toBe("HEARTBEAT_ERROR");
      expect(first.lastValidatedAt ?? null).toBeNull();
      expect(stubs.installationRows.get("install-2")!.status).toBe("ACTIVE"); // second was still checked
    });

    it("never stores a free-text or URL-shaped reason: only a short safe code survives", async () => {
      const stubs = makeStubs([{ ...INSTALL_ACTIVE }], [DEF]);
      detailed(stubs, { outcome: "unavailable", reasonCode: "failed calling https://shop.example.com/x?token=SECRET" });
      await run(makeService(stubs));

      expect(stubs.installationRows.get("install-1")!.lastValidationReason).toBe("UNAVAILABLE");
    });
  });

  describe("CONFIGURATION_ERROR (refused target is not a credential verdict)", () => {
    it("is recorded without expiring the credentials or changing the status", async () => {
      const stubs = makeStubs([{ ...INSTALL_ACTIVE }], [DEF]);
      detailed(stubs, { outcome: "invalid", reasonCode: "WOOCOMMERCE_SITE_URL_UNSAFE", category: "configuration" });
      await run(makeService(stubs));

      const row = stubs.installationRows.get("install-1")!;
      expect(row.status).toBe("ACTIVE");
      expect(row.lastValidationOutcome).toBe("CONFIGURATION_ERROR");
      expect(row.lastValidationReason).toBe("WOOCOMMERCE_SITE_URL_UNSAFE");
      expect(row.lastValidatedAt ?? null).toBeNull();
    });

    it("does not promote an expired installation either", async () => {
      const stubs = makeStubs([{ ...INSTALL_EXPIRED }], [DEF]);
      detailed(stubs, { outcome: "invalid", reasonCode: "ODOO_REDIRECT_CROSS_ORIGIN", category: "configuration" });
      await run(makeService(stubs));

      expect(stubs.installationRows.get("install-2")!.status).toBe("CREDENTIAL_EXPIRED");
    });
  });

  describe("legacy boolean fallback", () => {
    it("falls back to the boolean when the detailed verifier answers not_supported", async () => {
      const stubs = makeStubs([{ ...INSTALL_ACTIVE }], [DEF]);
      detailed(stubs, { outcome: "not_supported" });
      stubs.connector.validateCredentials.mockResolvedValue(true);
      await run(makeService(stubs));

      expect(stubs.connector.validateCredentials).toHaveBeenCalledTimes(1);
      expect(stubs.installationRows.get("install-1")!.lastValidationOutcome).toBe("VALID");
    });

    it("a connector with only the boolean verifier: true is VALID", async () => {
      const stubs = makeStubs([{ ...INSTALL_ACTIVE }], [DEF]);
      delete stubs.connector.validateStoredCredentialsDetailed;
      stubs.connector.validateCredentials.mockResolvedValue(true);
      await run(makeService(stubs));

      expect(stubs.installationRows.get("install-1")!.lastValidationOutcome).toBe("VALID");
      expect(stubs.installationRows.get("install-1")!.lastValidatedAt).toBeInstanceOf(Date);
    });

    it("a boolean false does NOT expire credentials unless the connector is on the audited allowlist", async () => {
      const stubs = makeStubs([{ ...INSTALL_ACTIVE }], [{ id: "def-1", slug: "meesho" }]);
      delete stubs.connector.validateStoredCredentialsDetailed;
      stubs.connector.validateCredentials.mockResolvedValue(false); // meesho/nykaa: constant false
      await run(makeService(stubs));

      const row = stubs.installationRows.get("install-1")!;
      expect(row.status).toBe("ACTIVE");
      expect(row.lastValidationOutcome).toBe("INDETERMINATE");
      expect(row.lastValidationReason).toBe("LEGACY_BOOLEAN_FALSE");
    });

    it("an audited allowlisted connector's boolean false IS a rejection", async () => {
      (BOOLEAN_FALSE_MEANS_REJECTION as Set<string>).add("meesho");
      try {
        const stubs = makeStubs([{ ...INSTALL_ACTIVE }], [{ id: "def-1", slug: "meesho" }]);
        delete stubs.connector.validateStoredCredentialsDetailed;
        stubs.connector.validateCredentials.mockResolvedValue(false);
        await run(makeService(stubs));

        expect(stubs.installationRows.get("install-1")!.status).toBe("CREDENTIAL_EXPIRED");
        expect(stubs.installationRows.get("install-1")!.lastValidationOutcome).toBe("INVALID");
      } finally {
        (BOOLEAN_FALSE_MEANS_REJECTION as Set<string>).delete("meesho");
      }
    });
  });

  describe("batch ordering and rotation", () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it("asks for never-attempted first, then longest-unattempted, then id, capped at the batch size", async () => {
      const stubs = makeStubs([{ ...INSTALL_ACTIVE }], [DEF]);
      detailed(stubs, { outcome: "valid" });
      await run(makeService(stubs));

      const args = stubs.connectorInstallation.findMany.mock.calls[0][0];
      expect(args.take).toBe(50);
      expect(args.where).toEqual({ status: { in: ["ACTIVE", "CREDENTIAL_EXPIRED"] } });
      expect(args.orderBy).toEqual([{ lastValidationAttemptAt: { sort: "asc", nulls: "first" } }, { id: "asc" }]);
    });

    it("rotates through a fleet larger than the batch: every installation is attempted once before any is attempted twice", async () => {
      jest.useFakeTimers({
        now: new Date("2026-10-04T00:00:00Z"),
        doNotFake: ["nextTick", "queueMicrotask", "setImmediate", "clearImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "hrtime"],
      });
      const fleet: Row[] = Array.from({ length: 120 }, (_, i) => ({
        id: `inst-${String(i).padStart(3, "0")}`,
        tenantKey: "tenant-a",
        connectorId: "def-1",
        status: "ACTIVE",
      }));
      const stubs = makeStubs(fleet, [DEF]);
      detailed(stubs, { outcome: "valid" });
      const service = makeService(stubs);

      const attemptsPerTick: string[][] = [];
      for (let tick = 0; tick < 3; tick++) {
        jest.setSystemTime(new Date(Date.UTC(2026, 9, 4, 6 * (tick + 1))));
        const before = new Map([...stubs.installationRows].map(([id, r]) => [id, r.lastValidationAttemptAt?.getTime() ?? null]));
        await run(service);
        attemptsPerTick.push(
          [...stubs.installationRows.values()]
            .filter((r) => (r.lastValidationAttemptAt?.getTime() ?? null) !== before.get(r.id))
            .map((r) => r.id),
        );
      }

      const ids = fleet.map((r) => r.id);
      const sorted = (list: string[]) => [...list].sort();
      // Tick 1 = the first 50, tick 2 = the next 50, tick 3 = the remaining 20 never-attempted
      // installations plus the 30 longest-unattempted (those attempted in tick 1), nothing else.
      expect(sorted(attemptsPerTick[0])).toEqual(ids.slice(0, 50));
      expect(sorted(attemptsPerTick[1])).toEqual(ids.slice(50, 100));
      expect(sorted(attemptsPerTick[2])).toEqual([...ids.slice(100, 120), ...ids.slice(0, 30)].sort());

      // Every installation receives one attempt before ANY receives its second: the first 120
      // attempts, in the order the service made them, are 120 distinct installations.
      const attemptOrder = stubs.connectorInstallation.updateMany.mock.calls
        .filter(([call]: any[]) => !call.where.status)
        .map(([call]: any[]) => call.where.id as string);
      expect(attemptOrder).toHaveLength(150);
      expect(new Set(attemptOrder.slice(0, 120)).size).toBe(120);
      // After three ticks nobody has been starved.
      expect([...stubs.installationRows.values()].every((r) => r.lastValidationAttemptAt)).toBe(true);
    });
  });

  it("isolates a recording failure: one installation's DB error does not stop the rest of the batch", async () => {
    const stubs = makeStubs([{ ...INSTALL_ACTIVE }, { ...INSTALL_EXPIRED }], [DEF]);
    detailed(stubs, { outcome: "valid" });
    const original = stubs.connectorInstallation.updateMany.getMockImplementation()!;
    stubs.connectorInstallation.updateMany.mockImplementationOnce(() => Promise.reject(new Error("db unavailable")));
    stubs.connectorInstallation.updateMany.mockImplementation(original);
    await run(makeService(stubs));

    expect(stubs.installationRows.get("install-2")!.lastValidationOutcome).toBe("VALID");
  });

  it("is single-flight: a heartbeat already running skips a concurrent second call entirely", async () => {
    const stubs = makeStubs([{ ...INSTALL_ACTIVE }], [DEF]);
    detailed(stubs, { outcome: "valid" });
    const service = makeService(stubs);

    const firstRun = run(service);
    await run(service);
    // The second call's synchronous guard check ran before firstRun's first real await could
    // have completed a full findMany round trip, so it must have skipped without querying twice.
    expect(stubs.prismaDirect.getClient).toHaveBeenCalledTimes(1);

    await firstRun;
  });

  it("completes cleanly with zero active installations", async () => {
    const stubs = makeStubs([], []);
    await run(makeService(stubs));

    expect(stubs.connector.validateCredentials).not.toHaveBeenCalled();
    expect(stubs.connector.validateStoredCredentialsDetailed).not.toHaveBeenCalled();
  });

  it("logs per-outcome counters for the tick", async () => {
    const stubs = makeStubs([{ ...INSTALL_ACTIVE }, { ...INSTALL_EXPIRED }], [DEF]);
    stubs.connector.validateStoredCredentialsDetailed!
      .mockResolvedValueOnce({ outcome: "valid" })
      .mockResolvedValueOnce({ outcome: "unavailable", reasonCode: "HTTP_503" });
    await run(makeService(stubs));

    expect(stubs.logger.info).toHaveBeenCalledWith(
      "Connector credential heartbeat completed.",
      expect.objectContaining({ checked: 2, valid: 1, indeterminate: 1, expired: 0, configurationError: 0, errors: 0 }),
    );
  });
});

describe("ConnectorHeartbeatService.runKeyRotationIfNeeded — startup rotation trigger (no prior coverage)", () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { ...originalEnv, CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION: "1" }; });
  afterEach(() => { process.env = originalEnv; });

  it("never calls rotateAllCredentials when nothing is on a stale key version", async () => {
    const stubs = makeStubs();
    stubs.connectorCredential.count.mockResolvedValue(0);
    const service = new ConnectorHeartbeatService(stubs.prismaDirect, stubs.registry, stubs.credentialService, stubs.httpClient, stubs.logger);

    await (service as any).runKeyRotationIfNeeded();

    expect(stubs.credentialService.rotateAllCredentials).not.toHaveBeenCalled();
  });

  it("calls rotateAllCredentials when stale credentials exist", async () => {
    const stubs = makeStubs();
    stubs.connectorCredential.count.mockResolvedValue(5);
    (stubs.credentialService.rotateAllCredentials as jest.Mock).mockResolvedValue({ rotated: 5, skipped: 0, errors: 0 });
    const service = new ConnectorHeartbeatService(stubs.prismaDirect, stubs.registry, stubs.credentialService, stubs.httpClient, stubs.logger);

    await (service as any).runKeyRotationIfNeeded();

    expect(stubs.credentialService.rotateAllCredentials).toHaveBeenCalledTimes(1);
  });

  it("catches a rotation failure rather than letting it crash the startup sequence", async () => {
    const stubs = makeStubs();
    stubs.connectorCredential.count.mockResolvedValue(3);
    (stubs.credentialService.rotateAllCredentials as jest.Mock).mockRejectedValue(new Error("db unavailable"));
    const service = new ConnectorHeartbeatService(stubs.prismaDirect, stubs.registry, stubs.credentialService, stubs.httpClient, stubs.logger);

    await expect((service as any).runKeyRotationIfNeeded()).resolves.toBeUndefined();
  });
});

describe("ConnectorHeartbeatService.runKeyRotationIfNeeded — stale credentials of any tenant (SEC-DB-RLS-001)", () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { ...originalEnv, CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION: "1" }; });
  afterEach(() => { process.env = originalEnv; });

  const credential = (id: string, tenantKey: string, keyVersion: string) => ({ id, tenantKey, encryptedValue: `cipher-${id}`, keyVersion });
  const build = (rows: ReturnType<typeof credential>[], directory: string[]) => {
    const stubs = makeStubs();
    const db = makeFakeRlsDb(rows, directory);
    const prismaDirect = { getClient: jest.fn().mockReturnValue(db.base) } as unknown as PrismaDirectService;
    (stubs.credentialService.rotateAllCredentials as jest.Mock).mockResolvedValue({ rotated: 1, skipped: 0, errors: 0, status: "SUCCESS" });
    const service = new ConnectorHeartbeatService(prismaDirect, stubs.registry, stubs.credentialService, stubs.httpClient, stubs.logger);
    return { stubs, db, service };
  };

  it("triggers rotation when ONLY a non-default tenant has a stale credential (the default tenant is fully current)", async () => {
    const { stubs, service } = build([credential("d1", "default", "v1"), credential("a1", "tenant-a", "v0")], ["tenant-a"]);

    await (service as any).runKeyRotationIfNeeded();

    expect(stubs.credentialService.rotateAllCredentials).toHaveBeenCalledTimes(1);
    expect(stubs.logger.info).toHaveBeenCalledWith("connector.credential.rotation_triggered", expect.objectContaining({ staleCount: 1, tenantsEvaluated: 2 }));
  });

  it("MUTATION: the old single count through the context-free client would have seen zero and never rotated", async () => {
    const { db } = build([credential("d1", "default", "v1"), credential("a1", "tenant-a", "v0")], ["tenant-a"]);
    expect(await db.base.connectorCredential.count({ where: { keyVersion: { not: "v1" } } })).toBe(0);
  });

  it("does not rotate when every tenant is current", async () => {
    const { stubs, service } = build([credential("d1", "default", "v1"), credential("a1", "tenant-a", "v1")], ["tenant-a"]);
    await (service as any).runKeyRotationIfNeeded();
    expect(stubs.credentialService.rotateAllCredentials).not.toHaveBeenCalled();
  });

  it("does not read credentials through the context-free client", async () => {
    const { db, service } = build([credential("a1", "tenant-a", "v0")], ["tenant-a"]);
    await (service as any).runKeyRotationIfNeeded();
    expect(db.baseCredentialReads).toBe(0);
  });

  it("a tenant whose stale count could not be read is not treated as 'nothing stale': rotation still runs and the gap is logged", async () => {
    const { stubs, db, service } = build([credential("d1", "default", "v1"), credential("a1", "tenant-a", "v1")], ["tenant-a"]);
    db.failCommitFor.add("tenant-a");

    await (service as any).runKeyRotationIfNeeded();

    expect(stubs.credentialService.rotateAllCredentials).toHaveBeenCalledTimes(1);
    expect(stubs.logger.warn).toHaveBeenCalledWith("connector.credential.rotation_check_incomplete", expect.objectContaining({ tenantsFailed: 1 }));
  });

  it("surfaces a PARTIAL_FAILURE rotation as degraded instead of logging only success", async () => {
    const { stubs, service } = build([credential("a1", "tenant-a", "v0")], ["tenant-a"]);
    (stubs.credentialService.rotateAllCredentials as jest.Mock).mockResolvedValue({
      rotated: 1, skipped: 0, errors: 1, status: "PARTIAL_FAILURE", tenants: { tenantsFailed: 1 },
    });

    await (service as any).runKeyRotationIfNeeded();

    expect(stubs.logger.warn).toHaveBeenCalledWith("connector.credential.rotation_degraded", expect.objectContaining({ status: "PARTIAL_FAILURE", tenantsFailed: 1 }));
  });
});
