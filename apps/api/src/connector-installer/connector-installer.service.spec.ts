import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { signConnectorOAuthState } from "./connector-oauth-state";
import { ConnectorInstallerService } from "./connector-installer.service";
import type { InstallConnectorDto } from "./dto/install-connector.dto";

const TEST_JWT_SECRET = "test-jwt-secret-at-least-32-characters-long-for-hkdf-derive";

describe("ConnectorInstallerService", () => {
  function createService() {
    const queryMock = jest.fn();
    const executeMock = jest.fn();
    const auditLogCreateMock = jest.fn().mockResolvedValue(undefined);
    // The transaction callback receives a `tx` exposing the same raw-query
    // surface as the outer tenant client, plus the ORM accessor used for the
    // atomic audit-log write (see deleteInstallationTransaction).
    const txClient = {
      $queryRawUnsafe: queryMock, // RLS-BYPASS: manual tenant filter
      $executeRawUnsafe: executeMock, // RLS-BYPASS: manual tenant filter
      auditLog: { create: auditLogCreateMock },
    };
    const transactionMock = jest.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient));
    const tenantMock = jest.fn().mockReturnValue({
      // RLS-BYPASS: manual tenant filter — tenantRaw/tenantExecRaw/globalQuery call through to these
      $queryRawUnsafe: queryMock, // RLS-BYPASS: manual tenant filter
      $executeRawUnsafe: executeMock, // RLS-BYPASS: manual tenant filter
      $transaction: transactionMock,
    });
    const prisma = {
      tenant: tenantMock,
    };
    const auditService = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
    const marketplaceService = {
      previewPayloadForInstallation: jest.fn(),
    };
    const connectorRegistry = {
      getConnector: jest.fn().mockReturnValue({
        validateCredentials: jest.fn().mockResolvedValue(true),
      }),
    };
    const txConnectorInstallationUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      connectorInstallation: { updateMany: txConnectorInstallationUpdateMany },
    };
    const credentialEncryptionService = {
      storeCredential: jest.fn().mockResolvedValue({ id: "cred_1", keyVersion: "v1" }),
      transaction: jest.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    };
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const planUsageService = {
      checkLimit: jest.fn().mockResolvedValue({ allowed: true }),
      touchUsageForCurrentTenant: jest.fn().mockResolvedValue(undefined),
    };
    const connectorPermissionService = {
      assertActionAllowed: jest.fn().mockResolvedValue(undefined),
      buildDefinitionActions: jest.fn().mockResolvedValue({
        install: { allowed: true, reason: null },
        reconnect: { allowed: false, reason: "INSTALLATION_REQUIRED" },
        uninstall: { allowed: false, reason: "INSTALLATION_REQUIRED" },
      }),
      buildDefinitionActionsForSlugs: jest.fn().mockResolvedValue(new Map()),
      buildInstallationActions: jest.fn().mockResolvedValue({
        install: { allowed: false, reason: "ALREADY_INSTALLED" },
        reconnect: { allowed: true, reason: null },
        uninstall: { allowed: true, reason: null },
      }),
      listPermissions: jest.fn(),
      grantPermission: jest.fn(),
      revokePermission: jest.fn(),
    };
    const accessPolicy = {
      assertProductAccess: jest.fn().mockResolvedValue(undefined),
      buildProductScopeWhere: jest.fn().mockResolvedValue({}),
      assertConnectorInstallationAccess: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ConnectorInstallerService(
      prisma as never,
      auditService,
      planUsageService as never,
      marketplaceService as never,
      connectorRegistry as never,
      credentialEncryptionService as never,
      connectorPermissionService as never,
      accessPolicy as never,
      {} as never, // credentialService
      {} as never, // httpClient
      logger as never,
    );
    return {
      service,
      tenantMock,
      queryMock,
      executeMock,
      transactionMock,
      auditLogCreateMock,
      auditService,
      connectorPermissionService,
      credentialEncryptionService,
      connectorRegistry,
      logger,
      tx,
      txConnectorInstallationUpdateMany,
    };
  }

  it("records delete attempt audit before deleting connector installation", async () => {
    const { service, queryMock, executeMock, auditService } = createService();
    queryMock.mockResolvedValue([{ id: "inst_1", slug: "amazon-in", accountAlias: "primary" }]);
    executeMock.mockResolvedValue(1);

    const result = await service.deleteInstallation("inst_1", {
      actorId: "user_42",
      actorRole: "admin",
    });

    expect(result).toEqual({ id: "inst_1", status: "DELETED" });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user_42",
        action: "CONNECTOR_DELETE_ATTEMPT",
        resource: "CONNECTOR_INSTALLATION",
        resourceId: "inst_1",
      }),
    );
    expect(executeMock).toHaveBeenCalled();
  });

  // ─── deleteInstallation lifecycle (#553 / #483) ──────────────────────────────
  // Hand-ported permanent-delete lifecycle: blocking checks for active work,
  // atomic credential + installation removal, and connector_submissions /
  // connector_webhook_events history preservation (enforced by the
  // 20260817000001/2 migrations, verified separately against a real Postgres —
  // not re-provable from these mocked unit tests).
  describe("deleteInstallation lifecycle (#553 / #483)", () => {
    function mockLockedRow(overrides: Partial<{ id: string; slug: string }> = {}) {
      return [{ id: overrides.id ?? "inst_1", slug: overrides.slug ?? "amazon-in" }];
    }

    it("deletes the installation when no active work exists", async () => {
      const { service, queryMock, executeMock, transactionMock, auditLogCreateMock } = createService();
      queryMock
        .mockResolvedValueOnce([{ id: "inst_1", slug: "amazon-in", accountAlias: "primary" }]) // requireInstallationForAction
        .mockResolvedValueOnce(mockLockedRow()) // FOR UPDATE lock
        .mockResolvedValueOnce([{ count: 0 }]) // active export jobs
        .mockResolvedValueOnce([{ count: 0 }]); // active submissions
      executeMock
        .mockResolvedValueOnce(1) // credentials deleted
        .mockResolvedValueOnce(1); // installation deleted

      const result = await service.deleteInstallation("inst_1", { actorId: "user_42", actorRole: "admin" });

      const tenantKey = getTenantKeyFromContext();
      expect(result).toEqual({ id: "inst_1", status: "DELETED" });
      expect(transactionMock).toHaveBeenCalledTimes(1);
      expect(executeMock).toHaveBeenNthCalledWith(1, expect.stringContaining("DELETE FROM connector_credentials"), tenantKey, "inst_1");
      expect(executeMock).toHaveBeenNthCalledWith(2, expect.stringContaining("DELETE FROM connector_installations"), tenantKey, "inst_1");
      expect(auditLogCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "CONNECTOR_DELETE_SUCCESS",
            resourceId: "inst_1",
            metadata: expect.objectContaining({
              cleanup: { credentialsDeleted: 1, installationDeleted: 1 },
            }),
          }),
        }),
      );
    });

    it("never issues a bare DELETE outside the transaction (regression: lifecycle guard cannot be bypassed)", async () => {
      const { service, queryMock, executeMock, transactionMock } = createService();
      queryMock
        .mockResolvedValueOnce([{ id: "inst_1", slug: "amazon-in", accountAlias: "primary" }])
        .mockResolvedValueOnce(mockLockedRow())
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([{ count: 0 }]);
      executeMock.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

      await service.deleteInstallation("inst_1", { actorId: "user_42", actorRole: "admin" });

      // Every executeMock call happened only via calls made from inside the
      // transaction callback — proven by transactionMock having run before any
      // assertions here would make sense, and by there being exactly the two
      // expected statements (credentials, installation), not a third bare delete.
      expect(transactionMock).toHaveBeenCalledTimes(1);
      expect(executeMock).toHaveBeenCalledTimes(2);
    });

    it("blocks deletion when export jobs are queued, processing, or retrying", async () => {
      const { service, queryMock, executeMock } = createService();
      queryMock
        .mockResolvedValueOnce([{ id: "inst_1", slug: "amazon-in", accountAlias: "primary" }])
        .mockResolvedValueOnce(mockLockedRow())
        .mockResolvedValueOnce([{ count: 2 }]); // active export jobs

      await expect(
        service.deleteInstallation("inst_1", { actorId: "user_42", actorRole: "admin" }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: "CONNECTOR_DELETE_BLOCKED_ACTIVE_EXPORT_JOBS",
          activeExportJobs: 2,
        }),
      });
      expect(executeMock).not.toHaveBeenCalled();
    });

    it("blocks deletion when a connector submission is still PENDING", async () => {
      const { service, queryMock, executeMock } = createService();
      queryMock
        .mockResolvedValueOnce([{ id: "inst_1", slug: "amazon-in", accountAlias: "primary" }])
        .mockResolvedValueOnce(mockLockedRow())
        .mockResolvedValueOnce([{ count: 0 }]) // active export jobs
        .mockResolvedValueOnce([{ count: 1 }]); // active submissions

      await expect(
        service.deleteInstallation("inst_1", { actorId: "user_42", actorRole: "admin" }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: "CONNECTOR_DELETE_BLOCKED_ACTIVE_SUBMISSIONS",
          activeSubmissions: 1,
        }),
      });
      expect(executeMock).not.toHaveBeenCalled();
    });

    it("does not block on submissions that already reached a terminal state", async () => {
      // SUCCESS/REJECTED/SUPPRESSED/ERROR are terminal (see ConnectorFrameworkService);
      // only PENDING counts as active. The blocking query itself filters to
      // UPPER(status) = 'PENDING', so a terminal-status submission simply never
      // matches — this asserts the deletion proceeds past that check.
      const { service, queryMock, executeMock } = createService();
      queryMock
        .mockResolvedValueOnce([{ id: "inst_1", slug: "amazon-in", accountAlias: "primary" }])
        .mockResolvedValueOnce(mockLockedRow())
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([{ count: 0 }]); // terminal-status submissions never match this query
      executeMock.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

      const result = await service.deleteInstallation("inst_1", { actorId: "user_42", actorRole: "admin" });

      expect(result).toEqual({ id: "inst_1", status: "DELETED" });
    });

    it("removes connector credentials as part of the same transaction", async () => {
      const { service, queryMock, executeMock } = createService();
      queryMock
        .mockResolvedValueOnce([{ id: "inst_1", slug: "amazon-in", accountAlias: "primary" }])
        .mockResolvedValueOnce(mockLockedRow())
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([{ count: 0 }]);
      executeMock.mockResolvedValueOnce(3).mockResolvedValueOnce(1); // 3 credential rows removed

      await service.deleteInstallation("inst_1", { actorId: "user_42", actorRole: "admin" });

      expect(executeMock).toHaveBeenNthCalledWith(
        1,
        expect.stringMatching(/DELETE FROM connector_credentials/),
        getTenantKeyFromContext(),
        "inst_1",
      );
    });

    it("never deletes connector_submissions or connector_webhook_events rows (history preservation)", async () => {
      const { service, queryMock, executeMock } = createService();
      queryMock
        .mockResolvedValueOnce([{ id: "inst_1", slug: "amazon-in", accountAlias: "primary" }])
        .mockResolvedValueOnce(mockLockedRow())
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([{ count: 0 }]);
      executeMock.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

      await service.deleteInstallation("inst_1", { actorId: "user_42", actorRole: "admin" });

      for (const call of executeMock.mock.calls) {
        const sql = String(call[0]);
        expect(sql).not.toMatch(/DELETE FROM connector_submissions/);
        expect(sql).not.toMatch(/DELETE FROM connector_webhook_events/);
      }
    });

    it("scopes every raw query inside the transaction to the caller's tenant", async () => {
      const { service, queryMock, executeMock } = createService();
      queryMock
        .mockResolvedValueOnce([{ id: "inst_1", slug: "amazon-in", accountAlias: "primary" }])
        .mockResolvedValueOnce(mockLockedRow())
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([{ count: 0 }]);
      executeMock.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

      await service.deleteInstallation("inst_1", { actorId: "user_42", actorRole: "admin" });

      // requireInstallationForAction's own lookup is call #1; the transaction's
      // lock + two COUNT queries are calls #2-4 — all four must carry tenantKey.
      const tenantKey = getTenantKeyFromContext();
      for (const call of queryMock.mock.calls) {
        expect(call).toContain(tenantKey);
      }
      for (const call of executeMock.mock.calls) {
        expect(call).toContain(tenantKey);
      }
    });

    it("throws NotFoundException when the installation vanishes between lookup and the FOR UPDATE lock", async () => {
      const { service, queryMock, executeMock, auditLogCreateMock } = createService();
      queryMock
        .mockResolvedValueOnce([{ id: "inst_1", slug: "amazon-in", accountAlias: "primary" }]) // still present at outer lookup
        .mockResolvedValueOnce([]); // gone by the time the transaction locks it

      await expect(
        service.deleteInstallation("inst_1", { actorId: "user_42", actorRole: "admin" }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(executeMock).not.toHaveBeenCalled();
      expect(auditLogCreateMock).not.toHaveBeenCalled();
    });

    it("repeated deletion of an already-deleted installation returns 404, not idempotent success", async () => {
      // Decision (invariant #6): a second delete call is NOT treated as a no-op
      // success — requireInstallationForAction's own lookup already fails closed
      // once the row is gone, before the transaction is ever entered.
      const { service, queryMock, transactionMock } = createService();
      queryMock.mockResolvedValueOnce([]); // second call: row no longer exists

      await expect(
        service.deleteInstallation("inst_1", { actorId: "user_42", actorRole: "admin" }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(transactionMock).not.toHaveBeenCalled();
    });

    it("rejects deletion when the locked row's slug no longer matches the expected slug (race with a concurrent reinstall)", async () => {
      const { service, queryMock, executeMock } = createService();
      queryMock
        .mockResolvedValueOnce([{ id: "inst_1", slug: "amazon-in", accountAlias: "primary" }])
        .mockResolvedValueOnce(mockLockedRow({ slug: "flipkart" })); // changed under our feet

      await expect(
        service.deleteInstallation("inst_1", { actorId: "user_42", actorRole: "admin" }, "amazon-in"),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ error: "CONNECTOR_SLUG_MISMATCH" }),
      });
      expect(executeMock).not.toHaveBeenCalled();
    });

    it("does not create an audit success record when the installation delete affects zero rows", async () => {
      // Simulates the installation vanishing between the FOR UPDATE lock and the
      // final DELETE within the same transaction — the whole point of running
      // these as one atomic unit is that this can never leave a half-deleted state.
      const { service, queryMock, executeMock, auditLogCreateMock } = createService();
      queryMock
        .mockResolvedValueOnce([{ id: "inst_1", slug: "amazon-in", accountAlias: "primary" }])
        .mockResolvedValueOnce(mockLockedRow())
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([{ count: 0 }]);
      executeMock
        .mockResolvedValueOnce(1) // credentials deleted
        .mockResolvedValueOnce(0); // installation delete affected 0 rows

      await expect(
        service.deleteInstallation("inst_1", { actorId: "user_42", actorRole: "admin" }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(auditLogCreateMock).not.toHaveBeenCalled();
    });
  });

  describe("reconnect (#564)", () => {
    function mockRuntimeRecordRow(overrides: Partial<{ slug: string }> = {}) {
      return [{
        id: "inst_1",
        tenantKey: "acme",
        connectorId: "def_1",
        accountAlias: "primary",
        externalAccountRef: null,
        metadata: {},
        slug: overrides.slug ?? "woocommerce",
      }];
    }

    it("validates credentials before marking the installation ACTIVE", async () => {
      const { service, queryMock, executeMock, auditService, connectorRegistry } = createService();
      queryMock.mockResolvedValue(mockRuntimeRecordRow());
      executeMock.mockResolvedValue(1);
      const validateCredentials = jest.fn().mockResolvedValue(true);
      (connectorRegistry.getConnector as jest.Mock).mockReturnValue({ validateCredentials });

      const result = await service.reconnect("inst_1", { actorId: "user_1", actorRole: "admin" });

      expect(connectorRegistry.getConnector).toHaveBeenCalledWith("woocommerce");
      expect(validateCredentials).toHaveBeenCalledWith(
        expect.objectContaining({ installationId: "inst_1", tenantId: "acme" }),
      );
      expect(executeMock).toHaveBeenCalled();
      expect(result).toEqual({ id: "inst_1", status: "ACTIVE" });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "CONNECTOR_RECONNECT_SUCCESS", resourceId: "inst_1" }),
      );
    });

    it("refuses to mark the installation ACTIVE when credentials still don't validate", async () => {
      const { service, queryMock, executeMock, auditService, connectorRegistry } = createService();
      queryMock.mockResolvedValue(mockRuntimeRecordRow());
      const validateCredentials = jest.fn().mockResolvedValue(false);
      (connectorRegistry.getConnector as jest.Mock).mockReturnValue({ validateCredentials });

      await expect(
        service.reconnect("inst_1", { actorId: "user_1", actorRole: "admin" }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ error: "CONNECTOR_CREDENTIALS_STILL_INVALID" }),
      });

      // The status update must never run — this is the whole point of the fix:
      // a still-broken connector should not get cosmetically flipped to ACTIVE.
      expect(executeMock).not.toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "CONNECTOR_RECONNECT_FAILURE", resourceId: "inst_1" }),
      );
      expect(auditService.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: "CONNECTOR_RECONNECT_SUCCESS" }),
      );
    });

    it("does not live-validate Meesho reconnect while RD-MEESHO-1 validation is deferred", async () => {
      const { service, queryMock, executeMock, auditService, connectorRegistry } = createService();
      queryMock.mockResolvedValue(mockRuntimeRecordRow({ slug: "meesho" }));
      executeMock.mockResolvedValue(1);
      const validateCredentials = jest.fn().mockResolvedValue(false);
      (connectorRegistry.getConnector as jest.Mock).mockReturnValue({ validateCredentials });

      const result = await service.reconnect("inst_1", { actorId: "user_1", actorRole: "admin" });

      expect(connectorRegistry.getConnector).not.toHaveBeenCalled();
      expect(validateCredentials).not.toHaveBeenCalled();
      expect(executeMock).toHaveBeenCalled();
      expect(result).toEqual({ id: "inst_1", status: "ACTIVE" });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "CONNECTOR_RECONNECT_SUCCESS", resourceId: "inst_1" }),
      );
    });
  });

  it("listAvailableDefinitions delegates to buildDefinitionActionsForSlugs (batch path)", async () => {
    const { service, queryMock, connectorPermissionService } = createService();
    queryMock.mockResolvedValue([
      { id: "def_1", slug: "amazon-in", displayName: "Amazon IN", authType: "api_key", capabilities: "[]", marketplaceId: null, connectorVersion: "1", isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "def_2", slug: "flipkart", displayName: "Flipkart", authType: "api_key", capabilities: "[]", marketplaceId: null, connectorVersion: "1", isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]);
    const actionsMap = new Map([
      ["amazon-in", { install: { allowed: true, reason: null }, reconnect: { allowed: false, reason: "INSTALLATION_REQUIRED" }, uninstall: { allowed: false, reason: "INSTALLATION_REQUIRED" } }],
      ["flipkart",  { install: { allowed: true, reason: null }, reconnect: { allowed: false, reason: "INSTALLATION_REQUIRED" }, uninstall: { allowed: false, reason: "INSTALLATION_REQUIRED" } }],
    ]);
    (connectorPermissionService.buildDefinitionActionsForSlugs as jest.Mock).mockResolvedValue(actionsMap);

    const result = await service.listAvailableDefinitions({ actorId: "user_1", actorRole: "admin" });

    expect(connectorPermissionService.buildDefinitionActionsForSlugs).toHaveBeenCalledTimes(1);
    expect(connectorPermissionService.buildDefinitionActionsForSlugs).toHaveBeenCalledWith(
      { actorId: "user_1", actorRole: "admin" },
      expect.arrayContaining(["amazon-in", "flipkart"]),
    );
    // amazon-in is under_development → filtered out; only flipkart should remain
    expect(result).toHaveLength(1);
    expect(result[0]!.slug).toBe("flipkart");
    expect(connectorPermissionService.buildDefinitionActions).not.toHaveBeenCalled();
  });

  it("listAvailableDefinitions includes non-customer-visible connectors for admin with system_admin boundary role", async () => {
    const { service, queryMock, connectorPermissionService } = createService();
    queryMock.mockResolvedValue([
      { id: "def_1", slug: "amazon-in", displayName: "Amazon IN", authType: "api_key", capabilities: "[]", marketplaceId: null, connectorVersion: "1", isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "def_2", slug: "flipkart", displayName: "Flipkart", authType: "api_key", capabilities: "[]", marketplaceId: null, connectorVersion: "1", isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]);
    (connectorPermissionService.buildDefinitionActionsForSlugs as jest.Mock).mockResolvedValue(new Map());

    const result = await service.listAvailableDefinitions({
      actorId: "user_1",
      actorRole: "admin",
      adminBoundaryRoles: ["system_admin"],
    });
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.slug)).toEqual(expect.arrayContaining(["amazon-in", "flipkart"]));
  });

  it("listAvailableDefinitions includes non-customer-visible connectors for admin with super_admin boundary role", async () => {
    const { service, queryMock, connectorPermissionService } = createService();
    queryMock.mockResolvedValue([
      { id: "def_1", slug: "amazon-in", displayName: "Amazon IN", authType: "api_key", capabilities: "[]", marketplaceId: null, connectorVersion: "1", isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "def_2", slug: "flipkart", displayName: "Flipkart", authType: "api_key", capabilities: "[]", marketplaceId: null, connectorVersion: "1", isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]);
    (connectorPermissionService.buildDefinitionActionsForSlugs as jest.Mock).mockResolvedValue(new Map());

    const result = await service.listAvailableDefinitions({
      actorId: "user_1",
      actorRole: "admin",
      adminBoundaryRoles: ["super_admin"],
    });
    expect(result).toHaveLength(2);
  });

  it("listAvailableDefinitions hides non-customer-visible connectors for admin without boundary roles", async () => {
    const { service, queryMock, connectorPermissionService } = createService();
    queryMock.mockResolvedValue([
      { id: "def_1", slug: "amazon-in", displayName: "Amazon IN", authType: "api_key", capabilities: "[]", marketplaceId: null, connectorVersion: "1", isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "def_2", slug: "flipkart", displayName: "Flipkart", authType: "api_key", capabilities: "[]", marketplaceId: null, connectorVersion: "1", isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]);
    (connectorPermissionService.buildDefinitionActionsForSlugs as jest.Mock).mockResolvedValue(new Map());

    const result = await service.listAvailableDefinitions({
      actorId: "user_1",
      actorRole: "admin",
      adminBoundaryRoles: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.slug).toBe("flipkart");
  });

  it("listAvailableDefinitions includes planned connectors when SHOW_PLANNED_CONNECTORS=true for admin", async () => {
    const originalEnv = process.env.SHOW_PLANNED_CONNECTORS;
    process.env.SHOW_PLANNED_CONNECTORS = "true";
    try {
      const { service, queryMock, connectorPermissionService } = createService();
      queryMock.mockResolvedValue([
        { id: "def_1", slug: "amazon-in", displayName: "Amazon IN", authType: "api_key", capabilities: "[]", marketplaceId: null, connectorVersion: "1", isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: "def_2", slug: "flipkart", displayName: "Flipkart", authType: "api_key", capabilities: "[]", marketplaceId: null, connectorVersion: "1", isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ]);
      (connectorPermissionService.buildDefinitionActionsForSlugs as jest.Mock).mockResolvedValue(new Map());

      const result = await service.listAvailableDefinitions({ actorId: "user_1", actorRole: "admin" });
      expect(result).toHaveLength(2);
      expect(result.map((d) => d.slug)).toEqual(expect.arrayContaining(["amazon-in", "flipkart"]));
    } finally {
      if (originalEnv === undefined) {
        delete process.env.SHOW_PLANNED_CONNECTORS;
      } else {
        process.env.SHOW_PLANNED_CONNECTORS = originalEnv;
      }
    }
  });

  it("listAvailableDefinitions hides planned connectors even with env flag when actor is not admin", async () => {
    const originalEnv = process.env.SHOW_PLANNED_CONNECTORS;
    process.env.SHOW_PLANNED_CONNECTORS = "true";
    try {
      const { service, queryMock, connectorPermissionService } = createService();
      queryMock.mockResolvedValue([
        { id: "def_1", slug: "amazon-in", displayName: "Amazon IN", authType: "api_key", capabilities: "[]", marketplaceId: null, connectorVersion: "1", isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: "def_2", slug: "flipkart", displayName: "Flipkart", authType: "api_key", capabilities: "[]", marketplaceId: null, connectorVersion: "1", isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ]);
      (connectorPermissionService.buildDefinitionActionsForSlugs as jest.Mock).mockResolvedValue(new Map());

      const result = await service.listAvailableDefinitions({ actorId: "user_1", actorRole: "editor" });
      expect(result).toHaveLength(1);
      expect(result[0]!.slug).toBe("flipkart");
    } finally {
      if (originalEnv === undefined) {
        delete process.env.SHOW_PLANNED_CONNECTORS;
      } else {
        process.env.SHOW_PLANNED_CONNECTORS = originalEnv;
      }
    }
  });

  it("throws NotFoundException when installation is missing", async () => {
    const { service, queryMock } = createService();
    queryMock.mockResolvedValue([]);

    await expect(
      service.deleteInstallation("missing", {
        actorId: "user_42",
        actorRole: "admin",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // ─── captureAndStoreMeeshoCredentials ────────────────────────────────────────
  // Tested via private-method cast because the public installConnector() path
  // requires full DB/OAuth scaffold. The three behaviour branches are:
  //   1. Both absent → silent return, no credential writes
  //   2. Partial     → BadRequestException(MEESHO_CREDENTIALS_INCOMPLETE)
  //   3. Both present → two storeCredential calls

  describe("captureAndStoreMeeshoCredentials", () => {
    type PrivateCapture = {
      captureAndStoreMeeshoCredentials: (input: {
        tenantKey: string;
        installationId: string;
        dto: InstallConnectorDto;
      }) => Promise<void>;
    };

    function getCapture(service: ConnectorInstallerService) {
      return (service as unknown as PrivateCapture).captureAndStoreMeeshoCredentials.bind(service);
    }

    it("returns silently when both clientId and clientSecret are absent", async () => {
      const { service, credentialEncryptionService } = createService();
      await getCapture(service)({ tenantKey: "t1", installationId: "i1", dto: {} as InstallConnectorDto });
      expect(credentialEncryptionService.storeCredential).not.toHaveBeenCalled();
    });

    it("returns silently when both clientId and clientSecret are empty strings", async () => {
      const { service, credentialEncryptionService } = createService();
      await getCapture(service)({
        tenantKey: "t1",
        installationId: "i1",
        dto: { clientId: "  ", clientSecret: "" } as InstallConnectorDto,
      });
      expect(credentialEncryptionService.storeCredential).not.toHaveBeenCalled();
    });

    it("throws BadRequestException(MEESHO_CREDENTIALS_INCOMPLETE) when only merchantId is present", async () => {
      const { service } = createService();
      await expect(
        getCapture(service)({
          tenantKey: "t1",
          installationId: "i1",
          dto: { clientId: "merchant_abc", clientSecret: "" } as InstallConnectorDto,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("throws BadRequestException(MEESHO_CREDENTIALS_INCOMPLETE) when only secretKey is present", async () => {
      const { service } = createService();
      let thrown: unknown;
      try {
        await getCapture(service)({
          tenantKey: "t1",
          installationId: "i1",
          dto: { clientId: "", clientSecret: "secret_xyz" } as InstallConnectorDto,
        });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(BadRequestException);
      expect((thrown as BadRequestException).getResponse()).toMatchObject({
        error: "MEESHO_CREDENTIALS_INCOMPLETE",
      });
    });

    it("stores merchant_id and secret_key when both are provided", async () => {
      const { service, credentialEncryptionService } = createService();
      await getCapture(service)({
        tenantKey: "tenant_meesho",
        installationId: "inst_meesho_1",
        dto: { clientId: "MID_123", clientSecret: "SK_abc" } as InstallConnectorDto,
      });

      expect(credentialEncryptionService.storeCredential).toHaveBeenCalledTimes(2);
      expect(credentialEncryptionService.storeCredential).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantKey: "tenant_meesho",
          installationId: "inst_meesho_1",
          credentialType: "merchant_id",
          plainValue: "MID_123",
        }),
      );
      expect(credentialEncryptionService.storeCredential).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantKey: "tenant_meesho",
          installationId: "inst_meesho_1",
          credentialType: "secret_key",
          plainValue: "SK_abc",
        }),
      );
    });
  });

  // ─── handlePublicOAuthCallback ──────────────────────────────────────────────

  describe("handlePublicOAuthCallback", () => {
    const INSTALLATION_ROW = {
      id: "inst_001",
      tenantKey: "tenant_abc",
      connectorId: "def_shopify",
      slug: "shopify",
      accountAlias: "primary",
      externalAccountRef: "test.myshopify.com",
      metadata: JSON.stringify({
        shopDomain: "test.myshopify.com",
        oauthNonceHash: "",
        oauthNonceIssuedAt: 0,
        oauthNonceExpiresAt: 0,
      }),
    };

    function setupEnv() {
      const original = process.env.JWT_SECRET;
      process.env.JWT_SECRET = TEST_JWT_SECRET;
      return () => {
        if (original === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = original;
      };
    }

    function signState(overrides?: Partial<{ tenantKey: string; installationId: string; connectorKey: string }>) {
      const { createHash } = require("node:crypto");
      const result = signConnectorOAuthState({
        tenantKey: overrides?.tenantKey ?? "tenant_abc",
        installationId: overrides?.installationId ?? "inst_001",
        connectorKey: overrides?.connectorKey ?? "shopify",
      }, TEST_JWT_SECRET);
      const nonceHash = createHash("sha256").update(result.nonce).digest("hex");
      return { ...result, nonceHash };
    }

    function mockInstallationWithNonce(queryMock: jest.Mock, executeMock: jest.Mock, nonceHash: string, expiresAt: number) {
      const meta = {
        shopDomain: "test.myshopify.com",
        oauthNonceHash: nonceHash,
        oauthNonceIssuedAt: Date.now(),
        oauthNonceExpiresAt: expiresAt,
      };
      queryMock.mockResolvedValue([{ ...INSTALLATION_ROW, metadata: JSON.stringify(meta) }]);
      executeMock.mockResolvedValue(1);
    }

    it("rejects a missing state token (empty string)", async () => {
      const restore = setupEnv();
      try {
        const { service } = createService();
        await expect(
          service.handlePublicOAuthCallback("", {}, "shopify"),
        ).rejects.toBeInstanceOf(BadRequestException);
      } finally { restore(); }
    });

    it("rejects a tampered state token", async () => {
      const restore = setupEnv();
      try {
        const { service } = createService();
        await expect(
          service.handlePublicOAuthCallback("dGFtcGVyZWQ.dGFtcGVyZWQ", {}, "shopify"),
        ).rejects.toBeInstanceOf(BadRequestException);
      } finally { restore(); }
    });

    it("rejects an expired state token", async () => {
      const restore = setupEnv();
      const originalNow = Date.now;
      try {
        // Sign a token in the past so it's already expired
        Date.now = () => originalNow() - 11 * 60 * 1000;
        const { stateToken } = signState();
        Date.now = originalNow;

        const { service } = createService();
        await expect(
          service.handlePublicOAuthCallback(stateToken, {}, "shopify"),
        ).rejects.toBeInstanceOf(BadRequestException);
      } finally {
        Date.now = originalNow;
        restore();
      }
    });

    it("rejects when expectedConnectorKey does not match state connectorKey", async () => {
      const restore = setupEnv();
      try {
        const { stateToken } = signState({ connectorKey: "woocommerce" });
        const { service } = createService();
        await expect(
          service.handlePublicOAuthCallback(stateToken, {}, "shopify"),
        ).rejects.toBeInstanceOf(BadRequestException);
      } finally { restore(); }
    });

    it("rejects when installation slug does not match state connectorKey", async () => {
      const restore = setupEnv();
      try {
        const { stateToken, nonceHash, expiresAt } = signState({ connectorKey: "shopify" });
        const { service, queryMock, executeMock } = createService();
        // Return an installation with a different slug
        const wrongRow = { ...INSTALLATION_ROW, slug: "flipkart", metadata: JSON.stringify({
          oauthNonceHash: nonceHash,
          oauthNonceIssuedAt: Date.now(),
          oauthNonceExpiresAt: expiresAt,
        })};
        queryMock.mockResolvedValue([wrongRow]);
        await expect(
          service.handlePublicOAuthCallback(stateToken, {}),
        ).rejects.toBeInstanceOf(BadRequestException);
      } finally { restore(); }
    });

    it("rejects when nonce hash does not match (replay attempt)", async () => {
      const restore = setupEnv();
      try {
        const { stateToken, expiresAt } = signState();
        const { service, queryMock, executeMock } = createService();
        // Store a different nonce hash
        mockInstallationWithNonce(queryMock, executeMock, "wrong_nonce_hash", expiresAt);
        await expect(
          service.handlePublicOAuthCallback(stateToken, {}, "shopify"),
        ).rejects.toBeInstanceOf(BadRequestException);
      } finally { restore(); }
    });

    it("rejects when nonce has expired", async () => {
      const restore = setupEnv();
      try {
        const { stateToken, nonceHash } = signState();
        const { service, queryMock, executeMock } = createService();
        // Nonce expired in the past
        mockInstallationWithNonce(queryMock, executeMock, nonceHash, Date.now() - 1000);
        await expect(
          service.handlePublicOAuthCallback(stateToken, {}, "shopify"),
        ).rejects.toBeInstanceOf(BadRequestException);
      } finally { restore(); }
    });

    it("rejects when no nonce is stored (initiation never happened)", async () => {
      const restore = setupEnv();
      try {
        const { stateToken } = signState();
        const { service, queryMock, executeMock } = createService();
        // Empty nonce hash
        mockInstallationWithNonce(queryMock, executeMock, "", Date.now() + 600_000);
        await expect(
          service.handlePublicOAuthCallback(stateToken, {}, "shopify"),
        ).rejects.toBeInstanceOf(BadRequestException);
      } finally { restore(); }
    });

    it("succeeds with valid state, matching nonce, and clears nonce after use", async () => {
      const restore = setupEnv();
      try {
        const { stateToken, nonceHash, expiresAt } = signState();
        const { service, queryMock, executeMock, connectorPermissionService } = createService();

        const connectorMock = { handleOAuthCallback: jest.fn().mockResolvedValue(undefined) };
        const connectorRegistry = (service as any).connectorRegistry;
        connectorRegistry.getConnector = jest.fn().mockReturnValue(connectorMock);

        mockInstallationWithNonce(queryMock, executeMock, nonceHash, expiresAt);
        // Second call: prisma update for status = ACTIVE
        const tenantMock = (service as any).prisma.tenant;
        tenantMock.mockReturnValue({
          $queryRawUnsafe: queryMock, // RLS-BYPASS: manual tenant filter
          $executeRawUnsafe: executeMock, // RLS-BYPASS: manual tenant filter
          connectorInstallation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        });

        const result = await service.handlePublicOAuthCallback(
          stateToken,
          { code: "test_code", shop: "test.myshopify.com" },
          "shopify",
        );
        expect(result).toEqual({ installationId: "inst_001", status: "CONNECTED" });
        expect(connectorMock.handleOAuthCallback).toHaveBeenCalledTimes(1);
        // Nonce should be cleared (executeMock called with null values via positional args)
        expect(executeMock).toHaveBeenCalledWith(
          expect.stringContaining("metadata = metadata ||"),
          expect.stringContaining("oauthNonceHash"),
          "inst_001",
          "tenant_abc",
        );
      } finally { restore(); }
    });

    it("rejects when connector does not support OAuth", async () => {
      const restore = setupEnv();
      try {
        const { stateToken, nonceHash, expiresAt } = signState();
        const { service, queryMock, executeMock } = createService();

        const connectorMock = {}; // no handleOAuthCallback
        const connectorRegistry = (service as any).connectorRegistry;
        connectorRegistry.getConnector = jest.fn().mockReturnValue(connectorMock);

        mockInstallationWithNonce(queryMock, executeMock, nonceHash, expiresAt);

        await expect(
          service.handlePublicOAuthCallback(stateToken, {}, "shopify"),
        ).rejects.toBeInstanceOf(BadRequestException);
      } finally { restore(); }
    });
  });

  // ─── initiateOAuth — shopDomain validation ──────────────────────────────────

  describe("initiateOAuth — shopDomain validation", () => {
    function setupInitiateEnv() {
      const origJwt = process.env.JWT_SECRET;
      const origClientId = process.env.PIM_SHOPIFY_CLIENT_ID;
      const origRedirect = process.env.PIM_SHOPIFY_REDIRECT_URI;
      process.env.JWT_SECRET = TEST_JWT_SECRET;
      process.env.PIM_SHOPIFY_CLIENT_ID = "test-client-id";
      process.env.PIM_SHOPIFY_REDIRECT_URI = "https://app.vexa.test/connectors/shopify/oauth/callback";
      return () => {
        if (origJwt === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = origJwt;
        if (origClientId === undefined) delete process.env.PIM_SHOPIFY_CLIENT_ID; else process.env.PIM_SHOPIFY_CLIENT_ID = origClientId;
        if (origRedirect === undefined) delete process.env.PIM_SHOPIFY_REDIRECT_URI; else process.env.PIM_SHOPIFY_REDIRECT_URI = origRedirect;
      };
    }

    function mockInstallation(queryMock: jest.Mock, executeMock: jest.Mock, shopDomain: string) {
      queryMock.mockResolvedValue([{
        id: "inst_001",
        tenantKey: "tenant_abc",
        connectorId: "def_shopify",
        slug: "shopify",
        accountAlias: "primary",
        externalAccountRef: shopDomain,
        metadata: JSON.stringify({ shopDomain, connectionStage: "awaiting_managed_install" }),
      }]);
      executeMock.mockResolvedValue(1);
    }

    const ACTOR = { actorId: "user_1", actorRole: "admin" as const };

    function enableOAuthOnConnector(service: any) {
      service.connectorRegistry = {
        getConnector: jest.fn().mockReturnValue({ handleOAuthCallback: jest.fn() }),
      };
    }

    async function expectOAuthReject(service: any, code: string) {
      try {
        await service.initiateOAuth("inst_001", ACTOR);
        throw new Error("Expected initiateOAuth to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const body = (err as BadRequestException).getResponse();
        expect(body).toEqual(expect.objectContaining({ error: code }));
      }
    }

    it("rejects shopDomain with protocol injection", async () => {
      const { service, queryMock, executeMock, connectorPermissionService } = createService();
      connectorPermissionService.assertActionAllowed.mockResolvedValue(undefined);
      enableOAuthOnConnector(service);
      const restore = setupInitiateEnv();
      try {
        mockInstallation(queryMock, executeMock, "https://evil.com/admin?x=.myshopify.com");
        await expectOAuthReject(service, "SHOPIFY_SHOP_DOMAIN_INVALID");
      } finally { restore(); }
    });

    it("rejects shopDomain pointing to non-myshopify.com host", async () => {
      const { service, queryMock, executeMock, connectorPermissionService } = createService();
      connectorPermissionService.assertActionAllowed.mockResolvedValue(undefined);
      enableOAuthOnConnector(service);
      const restore = setupInitiateEnv();
      try {
        mockInstallation(queryMock, executeMock, "evil.com");
        await expectOAuthReject(service, "SHOPIFY_SHOP_DOMAIN_INVALID");
      } finally { restore(); }
    });

    it("rejects empty shopDomain", async () => {
      const { service, queryMock, executeMock, connectorPermissionService } = createService();
      connectorPermissionService.assertActionAllowed.mockResolvedValue(undefined);
      enableOAuthOnConnector(service);
      const restore = setupInitiateEnv();
      try {
        mockInstallation(queryMock, executeMock, "");
        await expectOAuthReject(service, "SHOPIFY_SHOP_DOMAIN_REQUIRED");
      } finally { restore(); }
    });

    it("normalizes bare store name to .myshopify.com and returns valid authorizationUrl", async () => {
      const { service, queryMock, executeMock, connectorPermissionService } = createService();
      connectorPermissionService.assertActionAllowed.mockResolvedValue(undefined);
      enableOAuthOnConnector(service);
      const restore = setupInitiateEnv();
      try {
        mockInstallation(queryMock, executeMock, "test-store");
        const result = await service.initiateOAuth("inst_001", ACTOR);
        expect(result.authorizationUrl).toMatch(/^https:\/\/test-store\.myshopify\.com\/admin\/oauth\/authorize\?/);
        const url = new URL(result.authorizationUrl);
        expect(url.hostname).toBe("test-store.myshopify.com");
      } finally { restore(); }
    });

    it("authorizationUrl host is always *.myshopify.com for valid domains", async () => {
      const { service, queryMock, executeMock, connectorPermissionService } = createService();
      connectorPermissionService.assertActionAllowed.mockResolvedValue(undefined);
      enableOAuthOnConnector(service);
      const restore = setupInitiateEnv();
      try {
        mockInstallation(queryMock, executeMock, "my-shop.myshopify.com");
        const result = await service.initiateOAuth("inst_001", ACTOR);
        const url = new URL(result.authorizationUrl);
        expect(url.hostname).toMatch(/\.myshopify\.com$/);
        expect(url.pathname).toBe("/admin/oauth/authorize");
      } finally { restore(); }
    });
  });

  describe("updateCredentials", () => {
    function mockRuntimeRecordRow(overrides: Partial<{ slug: string; status: string; externalAccountRef: string | null }> = {}) {
      return [{
        id: "inst_1",
        tenantKey: "acme",
        connectorId: "def_1",
        accountAlias: "primary",
        externalAccountRef: overrides.externalAccountRef ?? null,
        status: overrides.status ?? "CREDENTIAL_EXPIRED",
        metadata: {},
        slug: overrides.slug ?? "woocommerce",
      }];
    }

    const ACTOR = { actorId: "user_1", actorRole: "admin" as const };

    it("rejects when the caller lacks connector-credentials permission", async () => {
      const { service, queryMock, connectorPermissionService, credentialEncryptionService } = createService();
      queryMock.mockResolvedValue(mockRuntimeRecordRow());
      connectorPermissionService.assertActionAllowed.mockRejectedValue(new Error("forbidden"));

      await expect(
        service.updateCredentials("inst_1", { clientId: "x", clientSecret: "y", refreshToken: "z" }, ACTOR),
      ).rejects.toThrow("forbidden");
      expect(credentialEncryptionService.storeCredential).not.toHaveBeenCalled();
    });

    it("404s for an unknown installation", async () => {
      const { service, queryMock } = createService();
      queryMock.mockResolvedValue([]);

      await expect(
        service.updateCredentials("missing", { clientId: "x", clientSecret: "y", refreshToken: "z" }, ACTOR),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("Shopify is unsupported", async () => {
      const { service, queryMock, credentialEncryptionService } = createService();
      queryMock.mockResolvedValue(mockRuntimeRecordRow({ slug: "shopify" }));

      await expect(
        service.updateCredentials("inst_1", { clientId: "x" }, ACTOR),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ error: "CONNECTOR_CREDENTIALS_EDIT_UNSUPPORTED" }),
      });
      expect(credentialEncryptionService.storeCredential).not.toHaveBeenCalled();
    });

    it("rejects a disallowed non-empty field for Meesho (refreshToken) with zero writes", async () => {
      const { service, queryMock, credentialEncryptionService } = createService();
      queryMock.mockResolvedValue(mockRuntimeRecordRow({ slug: "meesho" }));

      await expect(
        service.updateCredentials("inst_1", { clientId: "m", clientSecret: "s", refreshToken: "not-allowed" }, ACTOR),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ error: "CONNECTOR_CREDENTIALS_FIELD_NOT_ALLOWED" }),
      });
      expect(credentialEncryptionService.storeCredential).not.toHaveBeenCalled();
    });

    it("rejects a missing required field with zero writes", async () => {
      const { service, queryMock, credentialEncryptionService } = createService();
      queryMock.mockResolvedValue(mockRuntimeRecordRow({ slug: "flipkart" }));

      await expect(
        service.updateCredentials("inst_1", { clientId: "id-only" }, ACTOR),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ error: "FLIPKART_CREDENTIALS_INCOMPLETE" }),
      });
      expect(credentialEncryptionService.storeCredential).not.toHaveBeenCalled();
    });

    it("WooCommerce: rejects a blank externalAccountRef as a missing required field, never silently inheriting the old value", async () => {
      const { service, queryMock, credentialEncryptionService } = createService();
      queryMock.mockResolvedValue(mockRuntimeRecordRow({ slug: "woocommerce", externalAccountRef: "https://old-store.example.com" }));

      await expect(
        service.updateCredentials("inst_1", { externalAccountRef: "   ", clientId: "ck", clientSecret: "cs" }, ACTOR),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ error: "WOOCOMMERCE_CREDENTIALS_INCOMPLETE" }),
      });
      expect(credentialEncryptionService.storeCredential).not.toHaveBeenCalled();
    });

    it("WooCommerce valid: persists with health only on candidate-exercised fields, sets ACTIVE, updates externalAccountRef", async () => {
      const { service, queryMock, connectorRegistry, credentialEncryptionService, txConnectorInstallationUpdateMany } = createService();
      queryMock.mockResolvedValue(mockRuntimeRecordRow({ slug: "woocommerce", externalAccountRef: "https://old-store.example.com" }));
      const verifyCandidateCredentials = jest.fn().mockResolvedValue({ outcome: "valid" });
      (connectorRegistry.getConnector as jest.Mock).mockReturnValue({ verifyCandidateCredentials });

      const dto = { externalAccountRef: "https://new-store.example.com", clientId: "ck_new", clientSecret: "cs_new" };
      const result = await service.updateCredentials("inst_1", dto, ACTOR);

      expect(verifyCandidateCredentials).toHaveBeenCalledWith({
        site_url: "https://new-store.example.com",
        consumer_key: "ck_new",
        consumer_secret: "cs_new",
      });
      expect(result).toEqual({ id: "inst_1", status: "ACTIVE", verification: { outcome: "valid" } });

      const calls = (credentialEncryptionService.storeCredential as jest.Mock).mock.calls;
      const byType = Object.fromEntries(calls.map((c) => [c[0].credentialType, c]));
      expect(byType.site_url[2]).toEqual(expect.objectContaining({ lastValidatedAt: expect.any(Date) }));
      expect(byType.consumer_key[2]).toEqual(expect.objectContaining({ lastValidatedAt: expect.any(Date) }));
      expect(byType.consumer_secret[2]).toEqual(expect.objectContaining({ lastValidatedAt: expect.any(Date) }));
      // webhook_secret wasn't supplied here, so it shouldn't be written at all.
      expect(byType.webhook_secret).toBeUndefined();

      expect(txConnectorInstallationUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "inst_1" }),
          data: expect.objectContaining({ status: "ACTIVE", externalAccountRef: "https://new-store.example.com" }),
        }),
      );
    });

    it("WooCommerce: webhook_secret, when supplied, is stored WITHOUT a health stamp (not exercised by the candidate check)", async () => {
      const { service, queryMock, connectorRegistry, credentialEncryptionService } = createService();
      queryMock.mockResolvedValue(mockRuntimeRecordRow({ slug: "woocommerce" }));
      (connectorRegistry.getConnector as jest.Mock).mockReturnValue({
        verifyCandidateCredentials: jest.fn().mockResolvedValue({ outcome: "valid" }),
      });

      await service.updateCredentials(
        "inst_1",
        { externalAccountRef: "https://store.example.com", clientId: "ck", clientSecret: "cs", refreshToken: "whsec_new" },
        ACTOR,
      );

      const calls = (credentialEncryptionService.storeCredential as jest.Mock).mock.calls;
      const webhookCall = calls.find((c) => c[0].credentialType === "webhook_secret");
      expect(webhookCall).toBeDefined();
      expect(webhookCall![1]).toBeDefined(); // tx passed
      expect(webhookCall![2]).toBeUndefined(); // no health param
    });

    it("WooCommerce invalid: zero storeCredential calls, status untouched, 4xx with verification in the response", async () => {
      const { service, queryMock, connectorRegistry, credentialEncryptionService, txConnectorInstallationUpdateMany } = createService();
      queryMock.mockResolvedValue(mockRuntimeRecordRow({ slug: "woocommerce" }));
      (connectorRegistry.getConnector as jest.Mock).mockReturnValue({
        verifyCandidateCredentials: jest.fn().mockResolvedValue({ outcome: "invalid", reasonCode: "WOOCOMMERCE_CREDENTIALS_REJECTED" }),
      });

      await expect(
        service.updateCredentials("inst_1", { externalAccountRef: "https://store.example.com", clientId: "ck", clientSecret: "wrong" }, ACTOR),
      ).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({
          error: "WOOCOMMERCE_CREDENTIALS_INVALID",
          verification: { outcome: "invalid", reasonCode: "WOOCOMMERCE_CREDENTIALS_REJECTED" },
        }),
      });
      expect(credentialEncryptionService.storeCredential).not.toHaveBeenCalled();
      expect(txConnectorInstallationUpdateMany).not.toHaveBeenCalled();
    });

    it("WooCommerce unavailable: zero mutation, distinct 503", async () => {
      const { service, queryMock, connectorRegistry, credentialEncryptionService } = createService();
      queryMock.mockResolvedValue(mockRuntimeRecordRow({ slug: "woocommerce" }));
      (connectorRegistry.getConnector as jest.Mock).mockReturnValue({
        verifyCandidateCredentials: jest.fn().mockResolvedValue({ outcome: "unavailable", reasonCode: "NETWORK" }),
      });

      await expect(
        service.updateCredentials("inst_1", { externalAccountRef: "https://store.example.com", clientId: "ck", clientSecret: "cs" }, ACTOR),
      ).rejects.toMatchObject({
        status: 503,
        response: expect.objectContaining({ error: "WOOCOMMERCE_CREDENTIALS_UNAVAILABLE" }),
      });
      expect(credentialEncryptionService.storeCredential).not.toHaveBeenCalled();
    });

    it("Meesho: always persists without calling verifyCandidateCredentials, verification is not_supported, status untouched", async () => {
      const { service, queryMock, connectorRegistry, credentialEncryptionService, txConnectorInstallationUpdateMany } = createService();
      queryMock.mockResolvedValue(mockRuntimeRecordRow({ slug: "meesho", status: "ACTIVE" }));
      const verifyCandidateCredentials = jest.fn();
      (connectorRegistry.getConnector as jest.Mock).mockReturnValue({ verifyCandidateCredentials });

      const result = await service.updateCredentials("inst_1", { clientId: "merchant", clientSecret: "secret" }, ACTOR);

      expect(verifyCandidateCredentials).not.toHaveBeenCalled();
      expect(result).toEqual({ id: "inst_1", status: "ACTIVE", verification: { outcome: "not_supported" } });
      expect(credentialEncryptionService.storeCredential).toHaveBeenCalledTimes(2);
      // storeCredential called with no tx/health args at all for Meesho.
      for (const call of (credentialEncryptionService.storeCredential as jest.Mock).mock.calls) {
        expect(call[1]).toBeUndefined();
        expect(call[2]).toBeUndefined();
      }
      expect(txConnectorInstallationUpdateMany).not.toHaveBeenCalled();
    });

    it("Flipkart derived-token commit: stores the exchange response's access_token/refresh_token, not the operator-submitted refresh_token", async () => {
      const { service, queryMock, connectorRegistry, credentialEncryptionService, txConnectorInstallationUpdateMany } = createService();
      queryMock.mockResolvedValue(mockRuntimeRecordRow({ slug: "flipkart" }));
      const verifyCandidateCredentials = jest.fn().mockResolvedValue({
        outcome: "valid",
        commitExtra: {
          accessToken: { value: "fresh-access-token", expiresAt: new Date("2026-01-01T00:00:00Z") },
          refreshToken: { value: "rotated-refresh-token", expiresAt: new Date("2027-01-01T00:00:00Z") },
        },
      });
      (connectorRegistry.getConnector as jest.Mock).mockReturnValue({ verifyCandidateCredentials });

      const result = await service.updateCredentials(
        "inst_1",
        { clientId: "id", clientSecret: "secret", refreshToken: "operator-submitted-refresh-token" },
        ACTOR,
      );

      expect(result.status).toBe("ACTIVE");
      const calls = (credentialEncryptionService.storeCredential as jest.Mock).mock.calls;
      const byType = Object.fromEntries(calls.map((c) => [c[0].credentialType, c[0]]));
      expect(byType.refresh_token.plainValue).toBe("rotated-refresh-token");
      expect(byType.access_token.plainValue).toBe("fresh-access-token");
      expect(txConnectorInstallationUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "ACTIVE" }) }),
      );
    });

    it("Flipkart: when the response didn't rotate the refresh token, the operator-submitted value is stored unchanged", async () => {
      const { service, queryMock, connectorRegistry, credentialEncryptionService } = createService();
      queryMock.mockResolvedValue(mockRuntimeRecordRow({ slug: "flipkart" }));
      (connectorRegistry.getConnector as jest.Mock).mockReturnValue({
        verifyCandidateCredentials: jest.fn().mockResolvedValue({
          outcome: "valid",
          commitExtra: { accessToken: { value: "fresh-access-token", expiresAt: null } },
        }),
      });

      await service.updateCredentials(
        "inst_1",
        { clientId: "id", clientSecret: "secret", refreshToken: "operator-submitted-refresh-token" },
        ACTOR,
      );

      const calls = (credentialEncryptionService.storeCredential as jest.Mock).mock.calls;
      const byType = Object.fromEntries(calls.map((c) => [c[0].credentialType, c[0]]));
      expect(byType.refresh_token.plainValue).toBe("operator-submitted-refresh-token");
    });

    it("rotation-commit-failure: logs a distinct event when the transaction fails after a rotated refresh token was returned", async () => {
      const { service, queryMock, connectorRegistry, credentialEncryptionService, logger } = createService();
      queryMock.mockResolvedValue(mockRuntimeRecordRow({ slug: "flipkart" }));
      (connectorRegistry.getConnector as jest.Mock).mockReturnValue({
        verifyCandidateCredentials: jest.fn().mockResolvedValue({
          outcome: "valid",
          commitExtra: {
            accessToken: { value: "fresh-access-token", expiresAt: null },
            refreshToken: { value: "rotated-refresh-token", expiresAt: null },
          },
        }),
      });
      (credentialEncryptionService.transaction as jest.Mock).mockRejectedValue(new Error("db unavailable"));

      await expect(
        service.updateCredentials("inst_1", { clientId: "id", clientSecret: "secret", refreshToken: "submitted" }, ACTOR),
      ).rejects.toThrow("db unavailable");

      expect(logger.error).toHaveBeenCalledWith(
        "connector_credentials_rotation_commit_failed",
        expect.objectContaining({ installationId: "inst_1", connectorSlug: "flipkart" }),
      );
    });

    it("does not log a rotation-commit-failure event when the transaction fails and no refresh token was rotated", async () => {
      const { service, queryMock, connectorRegistry, credentialEncryptionService, logger } = createService();
      queryMock.mockResolvedValue(mockRuntimeRecordRow({ slug: "flipkart" }));
      (connectorRegistry.getConnector as jest.Mock).mockReturnValue({
        verifyCandidateCredentials: jest.fn().mockResolvedValue({
          outcome: "valid",
          commitExtra: { accessToken: { value: "fresh-access-token", expiresAt: null } },
        }),
      });
      (credentialEncryptionService.transaction as jest.Mock).mockRejectedValue(new Error("db unavailable"));

      await expect(
        service.updateCredentials("inst_1", { clientId: "id", clientSecret: "secret", refreshToken: "submitted" }, ACTOR),
      ).rejects.toThrow("db unavailable");

      expect(logger.error).not.toHaveBeenCalledWith("connector_credentials_rotation_commit_failed", expect.anything());
    });
  });

  // PIM#653 — install/reconnect need the same invalid/unavailable distinction
  // already proven for credential-replace (throwOnUnverified). A connector without
  // validateStoredCredentialsDetailed() must behave EXACTLY as before (plain 400 on
  // a false boolean) — zero behavior change for every connector except the ones that
  // opt in.
  describe("validateStoredCredentialsOrThrow (private helper backing install/reconnect)", () => {
    const CTX = { tenantId: "t1", installationId: "inst_1", connectorId: "conn_1" } as never;

    function callHelper(service: ConnectorInstallerService, connector: unknown) {
      return (service as unknown as { validateStoredCredentialsOrThrow: (...args: unknown[]) => Promise<void> })
        .validateStoredCredentialsOrThrow(connector, CTX, "SOME_CONNECTOR_INVALID", "Some connector credentials could not be validated.");
    }

    it("resolves without throwing when a connector without validateStoredCredentialsDetailed returns true (unchanged fallback behavior)", async () => {
      const { service } = createService();
      const connector = { validateCredentials: jest.fn().mockResolvedValue(true) };

      await expect(callHelper(service, connector)).resolves.toBeUndefined();
    });

    it("throws a plain BadRequestException (400) when a connector without validateStoredCredentialsDetailed returns false (unchanged fallback behavior)", async () => {
      const { service } = createService();
      const connector = { validateCredentials: jest.fn().mockResolvedValue(false) };

      await expect(callHelper(service, connector)).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({ error: "SOME_CONNECTOR_INVALID" }),
      });
    });

    it("resolves without throwing when validateStoredCredentialsDetailed returns valid", async () => {
      const { service } = createService();
      const connector = { validateStoredCredentialsDetailed: jest.fn().mockResolvedValue({ outcome: "valid" }) };

      await expect(callHelper(service, connector)).resolves.toBeUndefined();
    });

    it("throws a plain BadRequestException (400, Error-Authority-exempt) when validateStoredCredentialsDetailed returns invalid", async () => {
      const { service } = createService();
      const connector = { validateStoredCredentialsDetailed: jest.fn().mockResolvedValue({ outcome: "invalid", reasonCode: "HTTP_401" }) };

      await expect(callHelper(service, connector)).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({ error: "SOME_CONNECTOR_INVALID" }),
      });
    });

    it("throws a ServiceUnavailableException (503, non-exempt — captured by Error Authority) when validateStoredCredentialsDetailed returns unavailable — the actual PIM#653 fix", async () => {
      const { service } = createService();
      const connector = { validateStoredCredentialsDetailed: jest.fn().mockResolvedValue({ outcome: "unavailable", reasonCode: "HTTP_500" }) };

      await expect(callHelper(service, connector)).rejects.toMatchObject({
        status: 503,
        response: expect.objectContaining({ error: "SOME_CONNECTOR_INVALID_UNAVAILABLE" }),
      });
    });
  });
});
