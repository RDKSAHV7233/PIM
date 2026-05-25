import { NotFoundException } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { ConnectorInstallerService } from "./connector-installer.service";

describe("ConnectorInstallerService", () => {
  function createService() {
    const queryMock = jest.fn();
    const executeMock = jest.fn();
    const tenantMock = jest.fn().mockReturnValue({
      // RLS-BYPASS: manual tenant filter
      $queryRawUnsafe: queryMock,
      // RLS-BYPASS: manual tenant filter
      $executeRawUnsafe: executeMock,
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
    const credentialEncryptionService = {
      storeCredential: jest.fn().mockResolvedValue({ id: "cred_1", keyVersion: "v1" }),
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
    );
    return {
      service,
      tenantMock,
      queryMock,
      executeMock,
      auditService,
      connectorPermissionService,
    };
  }

  it("records delete attempt + success audit before deleting connector installation", async () => {
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
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user_42",
        action: "CONNECTOR_DELETE_SUCCESS",
        resource: "CONNECTOR_INSTALLATION",
        resourceId: "inst_1",
      }),
    );
    expect(executeMock).toHaveBeenCalled();
  });

  it("listAvailableDefinitions delegates to buildDefinitionActionsForSlugs (batch path)", async () => {
    const { service, queryMock, connectorPermissionService } = createService();
    // Two active definitions returned by the raw query
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
    // Both definitions should be in the result
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.slug)).toEqual(expect.arrayContaining(["amazon-in", "flipkart"]));
    // buildDefinitionActions (old per-slug method) must NOT be called
    expect(connectorPermissionService.buildDefinitionActions).not.toHaveBeenCalled();
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
});
