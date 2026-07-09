import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { signConnectorOAuthState } from "./connector-oauth-state";
import { ConnectorInstallerService } from "./connector-installer.service";
import type { InstallConnectorDto } from "./dto/install-connector.dto";

const TEST_JWT_SECRET = "test-jwt-secret-at-least-32-characters-long-for-hkdf-derive";

describe("ConnectorInstallerService", () => {
  function createService() {
    const queryMock = jest.fn();
    const executeMock = jest.fn();
    const tenantMock = jest.fn().mockReturnValue({
      // RLS-BYPASS: manual tenant filter — tenantRaw/tenantExecRaw/globalQuery call through to these
      $queryRawUnsafe: queryMock, // RLS-BYPASS: manual tenant filter
      $executeRawUnsafe: executeMock, // RLS-BYPASS: manual tenant filter
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
      {} as never, // credentialService
      {} as never, // httpClient
    );
    return {
      service,
      tenantMock,
      queryMock,
      executeMock,
      auditService,
      connectorPermissionService,
      credentialEncryptionService,
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
          $queryRawUnsafe: queryMock,
          $executeRawUnsafe: executeMock,
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
});
