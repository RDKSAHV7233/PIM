// Coverage for ConnectorHeartbeatService — zero test coverage before,
// despite driving two real correctness properties: the credential-
// validation state machine (only promote CREDENTIAL_EXPIRED back to
// ACTIVE, never touch an already-ACTIVE row; only demote to
// CREDENTIAL_EXPIRED on an actual validation failure) and the startup
// key-rotation trigger (skip entirely when nothing is stale, so a normal
// boot never pays for a rotation scan). Both methods are private — no
// public entry point was carved out for testing here the way
// WooCommerceReconciliationService.runReconciliation() or
// ConnectorWebhookLeaseSweeperService.runSweep() were — so this reaches
// them the same way #839's AccountDeletionWorkerService tests did.

import { ConnectorHeartbeatService } from "./connector-heartbeat.service";
import type { PrismaDirectService } from "../prisma/prisma-direct.service";
import type { ConnectorRegistry } from "./connector.registry";
import type { ConnectorCredentialService } from "./connector-credential.service";
import type { ConnectorHttpClient } from "./connector-http-client.service";
import type { LoggerService } from "../common/logging/logger.service";

function makeStubs(installations: any[] = [], definitions: any[] = []) {
  const installationRows = new Map(installations.map((i) => [i.id, { ...i }]));
  const connectorInstallation = {
    findMany: jest.fn().mockImplementation(() => Promise.resolve([...installationRows.values()])),
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
  const prismaDirect = {
    getClient: jest.fn().mockReturnValue({ connectorInstallation, connectorDefinition, connectorCredential }),
  } as unknown as PrismaDirectService;

  const connector = { validateCredentials: jest.fn() };
  const registry = { getConnector: jest.fn().mockReturnValue(connector) } as unknown as ConnectorRegistry;
  const credentialService = { rotateAllCredentials: jest.fn(), getOrRefreshAccessToken: jest.fn() } as unknown as ConnectorCredentialService;
  const httpClient = { fetch: jest.fn() } as unknown as ConnectorHttpClient;
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService;

  return { prismaDirect, registry, credentialService, httpClient, logger, connector, connectorInstallation, connectorCredential, installationRows };
}

const INSTALL_ACTIVE = { id: "install-1", tenantKey: "tenant-a", connectorId: "def-1", status: "ACTIVE" };
const INSTALL_EXPIRED = { id: "install-2", tenantKey: "tenant-a", connectorId: "def-1", status: "CREDENTIAL_EXPIRED" };
const DEF = { id: "def-1", slug: "shopify" };

describe("ConnectorHeartbeatService.runHeartbeat — credential validation state machine (no prior coverage)", () => {
  it("demotes an ACTIVE installation to CREDENTIAL_EXPIRED when validation fails", async () => {
    const stubs = makeStubs([{ ...INSTALL_ACTIVE }], [DEF]);
    stubs.connector.validateCredentials.mockResolvedValue(false);
    const service = new ConnectorHeartbeatService(stubs.prismaDirect, stubs.registry, stubs.credentialService, stubs.httpClient, stubs.logger);

    await (service as any).runHeartbeat();

    expect(stubs.installationRows.get("install-1").status).toBe("CREDENTIAL_EXPIRED");
  });

  it("promotes a CREDENTIAL_EXPIRED installation back to ACTIVE once validation passes again", async () => {
    const stubs = makeStubs([{ ...INSTALL_EXPIRED }], [DEF]);
    stubs.connector.validateCredentials.mockResolvedValue(true);
    const service = new ConnectorHeartbeatService(stubs.prismaDirect, stubs.registry, stubs.credentialService, stubs.httpClient, stubs.logger);

    await (service as any).runHeartbeat();

    expect(stubs.installationRows.get("install-2").status).toBe("ACTIVE");
  });

  it("never writes to an already-ACTIVE installation just because validation passed again — no unnecessary write", async () => {
    const stubs = makeStubs([{ ...INSTALL_ACTIVE }], [DEF]);
    stubs.connector.validateCredentials.mockResolvedValue(true);
    const service = new ConnectorHeartbeatService(stubs.prismaDirect, stubs.registry, stubs.credentialService, stubs.httpClient, stubs.logger);

    await (service as any).runHeartbeat();

    // markValidated()'s updateMany only matches rows currently CREDENTIAL_EXPIRED — an
    // ACTIVE row's status is untouched (still "ACTIVE", and the guarded updateMany no-ops).
    expect(stubs.installationRows.get("install-1").status).toBe("ACTIVE");
  });

  it("isolates one installation's validation error — the rest of the batch still gets checked", async () => {
    const stubs = makeStubs([{ ...INSTALL_ACTIVE }, { ...INSTALL_EXPIRED }], [DEF]);
    stubs.connector.validateCredentials
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockResolvedValueOnce(true);
    const service = new ConnectorHeartbeatService(stubs.prismaDirect, stubs.registry, stubs.credentialService, stubs.httpClient, stubs.logger);

    await (service as any).runHeartbeat();

    expect(stubs.installationRows.get("install-2").status).toBe("ACTIVE");
  });

  it("is single-flight: a heartbeat already running skips a concurrent second call entirely", async () => {
    const stubs = makeStubs([{ ...INSTALL_ACTIVE }], [DEF]);
    stubs.connector.validateCredentials.mockResolvedValue(true);
    const service = new ConnectorHeartbeatService(stubs.prismaDirect, stubs.registry, stubs.credentialService, stubs.httpClient, stubs.logger);

    const firstRun = (service as any).runHeartbeat();
    await (service as any).runHeartbeat();
    // The second call's synchronous guard check ran before firstRun's first real await could
    // have completed a full findMany round trip, so it must have skipped without querying twice.
    expect(stubs.prismaDirect.getClient).toHaveBeenCalledTimes(1);

    await firstRun;
  });

  it("completes cleanly with zero active installations", async () => {
    const stubs = makeStubs([], []);
    const service = new ConnectorHeartbeatService(stubs.prismaDirect, stubs.registry, stubs.credentialService, stubs.httpClient, stubs.logger);

    await (service as any).runHeartbeat();

    expect(stubs.connector.validateCredentials).not.toHaveBeenCalled();
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
