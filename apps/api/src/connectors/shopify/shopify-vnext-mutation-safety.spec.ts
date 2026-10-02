import fs from "node:fs";
import path from "node:path";
import { ConnectorFrameworkService } from "../../connector-framework/connector-framework.service";
import { MarketplaceService } from "../../marketplace/marketplace.service";

const GOOD_SHA = "aaaaaaaa";
const OTHER_SHA = "bbbbbbbb";
const TOKEN_VALUE = "shpat_mock_secret_token";

type ControlledOutcome = {
  outcome: string;
  reason?: string;
  result?: unknown;
  correlationId?: string;
};

function rollbackSnapshot(imageId: string, imageSrc: string) {
  return {
    capturedAt: "2026-10-01T00:00:00.000Z",
    product: {
      id: "gid://shopify/Product/999",
      title: "Classic Tee",
      handle: "classic-tee-sku-1",
      descriptionHtml: "A tee",
      status: "ACTIVE",
      vendor: "Acme",
      productType: "default",
      tags: [],
      seo: null,
      options: [{ name: "Title", position: 1, values: ["Default Title"] }],
      variants: [
        {
          id: "gid://shopify/ProductVariant/1",
          sku: "SKU-1",
          price: "799.00",
          compareAtPrice: "999.00",
          barcode: null,
          inventoryPolicy: "CONTINUE",
          taxable: true,
          selectedOptions: [{ name: "Title", value: "Default Title" }],
          inventoryItem: { id: "gid://shopify/InventoryItem/1", sku: "SKU-1", tracked: false },
        },
      ],
      images: [{ id: imageId, src: imageSrc, altText: "Classic Tee" }],
    },
  };
}

function setExactGates(overrides: Record<string, string | undefined> = {}) {
  process.env.APP_ENV = "test";
  process.env.SHOPIFY_SHADOW_PROJECTION_ENABLED = "false";
  process.env.VNEXT_MUTATION_ENABLED = "true";
  process.env.VNEXT_MUTATION_ALLOWLIST_JSON = JSON.stringify({
    tenantKey: "tenant1",
    connectorSlug: "shopify",
    installationId: "inst-1",
    productId: "prod-1",
  });
  process.env.VNEXT_MUTATION_APPROVED_RELEASE_SHA = GOOD_SHA;
  process.env.VNEXT_MUTATION_ALLOWED_FIELD_CLASS = "image";
  process.env.RAILWAY_GIT_COMMIT_SHA = GOOD_SHA;

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function makeSafetyService(options: {
  accessToken?: string;
  applyControlledMutationImpl?: (ctx: { getAccessToken: () => Promise<string> }) => Promise<unknown>;
  captureRollbackSnapshotImpl?: () => Promise<unknown>;
} = {}) {
  const db = {
    connectorSubmission: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const prisma = {
    tenant: jest.fn().mockReturnValue(db),
  };
  const realCtx = {
    tenantId: "tenant1",
    installationId: "inst-1",
    connectorId: "conn-1",
    getAccessToken: jest.fn().mockResolvedValue(options.accessToken ?? TOKEN_VALUE),
    fetch: jest.fn(),
  };
  const connectorFramework = {
    getCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
    requireCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
    requireInstallation: jest.fn().mockResolvedValue({
      id: "inst-1",
      tenantKey: "tenant1",
      connectorId: "conn-1",
      slug: "shopify",
      capabilities: ["PUBLISH"],
      metadata: {},
    }),
    buildContextForInstallation: jest.fn().mockReturnValue(realCtx),
    publish: jest.fn().mockResolvedValue({
      externalRef: "gid://shopify/Product/legacy",
      status: "SUCCESS",
      isAsync: false,
    }),
    update: jest.fn().mockResolvedValue({
      externalRef: "gid://shopify/Product/legacy",
      status: "SUCCESS",
      isAsync: false,
    }),
    recordSubmissionAttempt: jest.fn().mockResolvedValue({
      id: "submission-1",
      status: "SUCCESS",
      attemptNumber: 1,
    }),
  };
  const connector = {
    fetchProductTypeSchema: jest.fn().mockResolvedValue({
      productType: "default",
      requiredAttributes: ["sku", "title", "description", "mainImageUrl"],
      optionalAttributes: [],
      validValues: {},
      schemaVersion: "LOCAL-shopify-default-2026Q3",
    }),
    applyControlledMutation: jest.fn().mockImplementation(
      options.applyControlledMutationImpl ??
        (async () => ({
          externalRef: "gid://shopify/Product/999",
          status: "SUCCESS",
          isAsync: false,
        })),
    ),
    captureRollbackSnapshot: jest.fn().mockImplementation(
      options.captureRollbackSnapshotImpl ??
        jest.fn()
          .mockResolvedValueOnce(rollbackSnapshot("gid://shopify/ProductImage/before", "https://cdn.example.com/before.jpg"))
          .mockResolvedValueOnce(rollbackSnapshot("gid://shopify/ProductImage/after", "https://cdn.example.com/after.jpg")),
    ),
  };
  const connectorRegistry = {
    getConnector: jest.fn().mockReturnValue(connector),
  };
  const metricsService = { emit: jest.fn().mockResolvedValue(undefined) };
  const connectorMappingService = {
    resolveEffectiveMapping: jest.fn().mockResolvedValue({ resolvedMapping: { localeTranslations: [] } }),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const svc = new MarketplaceService(
    prisma as never,
    connectorFramework as never,
    connectorRegistry as never,
    {} as never,
    {} as never,
    metricsService as never,
    connectorMappingService as never,
    {} as never,
    logger as never,
    {} as never,
    {} as never,
    {} as never,
  );
  jest.spyOn(svc as any, "getEffectiveMapping").mockResolvedValue({
    requiredFields: [],
    fieldMap: {},
    rawFieldMap: {},
    source: "system_pack",
  });
  return {
    svc,
    prisma,
    db,
    connectorFramework,
    connectorRegistry,
    connector,
    realCtx,
    metricsService,
    connectorMappingService,
    logger,
  };
}

function runControlled(
  svc: MarketplaceService,
  overrides: {
    tenantKey?: string;
    productId?: string;
    installationId?: string;
    productPayload?: Record<string, unknown>;
    executionMode?: "normal" | "controlled_vnext_required";
  } = {},
): Promise<ControlledOutcome> {
  return (
    svc as unknown as {
      attemptShopifyControlledMutation: (input: {
        tenantKey: string;
        productId: string;
        productPayload: Record<string, unknown>;
        categoryId: string;
        installation: { id: string; connectorId: string };
        existingGid: string | null;
        executionMode?: "normal" | "controlled_vnext_required";
      }) => Promise<ControlledOutcome>;
    }
  ).attemptShopifyControlledMutation({
    tenantKey: overrides.tenantKey ?? "tenant1",
    productId: overrides.productId ?? "prod-1",
    productPayload: {
      sku: "SKU-1",
      title: "Classic Tee",
      description: "A tee",
      brand: "Acme",
      hsnCode: "61091000",
      gstRate: 5,
      mrp: 999,
      sellingPrice: 799,
      mainImageUrl: "https://cdn.example.com/tee.jpg",
      attributes: {},
      productType: "default",
      ...overrides.productPayload,
    },
    categoryId: "cat-1",
    installation: { id: overrides.installationId ?? "inst-1", connectorId: "conn-1" },
    existingGid: "gid://shopify/Product/999",
    executionMode: overrides.executionMode,
  });
}

function runRecordConnectorSubmission(svc: MarketplaceService): Promise<unknown> {
  return (
    svc as unknown as {
      recordConnectorSubmission: (
        job: {
          id: string;
          productId: string;
          channel: string;
          installationId?: string | null;
          categoryId?: string | null;
        },
        simulation: {
          exportReady: boolean;
          mappedPayload: Record<string, unknown>;
          channelIssues: unknown[];
          validationSource: "local_rules" | "amazon_sp_api";
        },
      ) => Promise<unknown>;
    }
  ).recordConnectorSubmission(
    {
      id: "job-1",
      productId: "prod-1",
      channel: "shopify",
      installationId: "inst-1",
      categoryId: "cat-1",
    },
    {
      exportReady: true,
      mappedPayload: { sku: "SKU-1" },
      channelIssues: [],
      validationSource: "local_rules",
    },
  );
}

function sourceFile(relativeFromThisSpec: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativeFromThisSpec), "utf8");
}

describe("Shopify vNext controlled mutation mandatory safety proofs", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
  });

  it.each([
    {
      name: "flag disabled",
      env: { VNEXT_MUTATION_ENABLED: "false" },
      reason: "disabled",
    },
    {
      name: "allowlist missing",
      env: { VNEXT_MUTATION_ALLOWLIST_JSON: undefined },
      reason: "allowlist_miss",
    },
    {
      name: "approved release missing",
      env: { VNEXT_MUTATION_APPROVED_RELEASE_SHA: undefined },
      reason: "release_not_approved",
    },
    {
      name: "live release missing",
      env: { RAILWAY_GIT_COMMIT_SHA: undefined },
      reason: "release_not_approved",
    },
    {
      name: "allowed field class missing",
      env: { VNEXT_MUTATION_ALLOWED_FIELD_CLASS: undefined },
      reason: "field_class_not_allowed",
    },
  ])("cannot mutate when the $name gate is missing", async ({ env, reason }) => {
    setExactGates(env);
    const { svc, connectorFramework, connectorRegistry, connector } = makeSafetyService();

    await expect(runControlled(svc)).resolves.toEqual({
      outcome: "skipped",
      reason,
      correlationId: expect.stringMatching(/^vnext_[0-9a-f-]{36}$/),
    });

    expect(connector.applyControlledMutation).not.toHaveBeenCalled();
    expect(connectorRegistry.getConnector).not.toHaveBeenCalled();
    expect(connectorFramework.buildContextForInstallation).not.toHaveBeenCalled();
  });

  it.each([
    { name: "tenant differs by case", input: { tenantKey: "Tenant1" } },
    { name: "installation differs by case", input: { installationId: "Inst-1" } },
    { name: "product differs by case", input: { productId: "Prod-1" } },
    {
      name: "connector differs by case",
      env: {
        VNEXT_MUTATION_ALLOWLIST_JSON: JSON.stringify({
          tenantKey: "tenant1",
          connectorSlug: "Shopify",
          installationId: "inst-1",
          productId: "prod-1",
        }),
      },
    },
  ])("only the exact allowlisted tenant/product passes: $name", async ({ input, env }) => {
    setExactGates(env);
    const { svc, connector } = makeSafetyService();

    await expect(runControlled(svc, input)).resolves.toEqual({
      outcome: "skipped",
      reason: "allowlist_miss",
      correlationId: expect.stringMatching(/^vnext_[0-9a-f-]{36}$/),
    });
    expect(connector.applyControlledMutation).not.toHaveBeenCalled();
  });

  it("executes only when every gate and allowlist field matches exactly", async () => {
    setExactGates();
    const { svc, connector } = makeSafetyService();

    await expect(runControlled(svc)).resolves.toMatchObject({
      outcome: "executed",
      result: { externalRef: "gid://shopify/Product/999", status: "SUCCESS", isAsync: false },
      correlationId: expect.stringMatching(/^vnext_[0-9a-f-]{36}$/),
      fieldClass: "image",
      mutationCount: 1,
    });
    expect(connector.applyControlledMutation).toHaveBeenCalledTimes(1);
    expect(connector.applyControlledMutation).toHaveBeenCalledWith(
      expect.anything(),
      { files: [expect.objectContaining({ originalSource: "https://cdn.example.com/tee.jpg" })] },
      { id: "gid://shopify/Product/999" },
      expect.objectContaining({ correlationId: expect.stringMatching(/^vnext_[0-9a-f-]{36}$/) }),
    );
    expect(connector.captureRollbackSnapshot).toHaveBeenCalledTimes(2);
  });

  it("documents retry idempotency through ConnectorSubmission's tenant/installation/idempotency unique key", () => {
    const schema = sourceFile("../../../../../packages/db/prisma/schema.prisma");

    expect(schema).toContain("model ConnectorSubmission");
    expect(schema).toContain('@@unique([tenantKey, installationId, idempotencyKey], map: "idx_connector_submissions_tenant_installation_idempotency")');
  });

  it("keeps credential lookup tenant-scoped through ConnectorContext construction", async () => {
    setExactGates();
    const { svc, connectorFramework, realCtx } = makeSafetyService({
      applyControlledMutationImpl: async (ctx) => {
        await ctx.getAccessToken();
        return { externalRef: "gid://shopify/Product/999", status: "SUCCESS", isAsync: false };
      },
    });

    await expect(runControlled(svc)).resolves.toMatchObject({ outcome: "executed" });
    expect(connectorFramework.buildContextForInstallation).toHaveBeenCalledWith(expect.objectContaining({
      tenantKey: "tenant1",
      id: "inst-1",
      slug: "shopify",
    }));
    expect(realCtx.getAccessToken).toHaveBeenCalledTimes(1);

    const refreshAccessToken = jest.fn().mockResolvedValue("refreshed-token");
    const registry = { getConnector: jest.fn().mockReturnValue({ refreshAccessToken }) };
    const credentialService = { getOrRefreshAccessToken: jest.fn().mockResolvedValue(TOKEN_VALUE) };
    const httpClient = { fetch: jest.fn() };
    const framework = new ConnectorFrameworkService(
      {} as never,
      registry as never,
      {} as never,
      credentialService as never,
      httpClient as never,
      {} as never,
    );

    const ctx = framework.buildContextForInstallation({
      id: "inst-1",
      tenantKey: "tenant1",
      connectorId: "conn-1",
      slug: "shopify",
      metadata: {},
    });
    await expect(ctx.getAccessToken()).resolves.toBe(TOKEN_VALUE);
    expect(credentialService.getOrRefreshAccessToken).toHaveBeenCalledWith(
      "tenant1",
      "inst-1",
      "shopify",
      expect.any(Function),
    );
  });

  it("fails closed instead of falling back to a legacy write when authorized vNext fails before readback", async () => {
    setExactGates();
    const { svc, db, connector, connectorFramework, logger } = makeSafetyService({
      applyControlledMutationImpl: async () => {
        throw new Error(`provider rejected token ${TOKEN_VALUE}`);
      },
    });
    db.connectorSubmission.findFirst.mockResolvedValueOnce({ externalRef: "gid://shopify/Product/999" });
    jest.spyOn(svc as any, "buildConnectorProductPayload").mockResolvedValue({
      sku: "SKU-1",
      title: "Classic Tee",
      description: "A tee",
      brand: "Acme",
      hsnCode: "61091000",
      gstRate: 5,
      mrp: 999,
      sellingPrice: 799,
      mainImageUrl: "https://cdn.example.com/tee.jpg",
      attributes: {},
      productType: "default",
    });

    await expect(runRecordConnectorSubmission(svc)).rejects.toMatchObject({ name: "ShopifyControlledMutationError" });

    expect(connector.applyControlledMutation).toHaveBeenCalledTimes(1);
    expect(connectorFramework.publish).not.toHaveBeenCalled();
    expect(connectorFramework.update).not.toHaveBeenCalled();
    expect(connectorFramework.recordSubmissionAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "ERROR",
      payloadSnapshot: expect.objectContaining({
        __vnextMutationAudit: expect.objectContaining({
          correlationId: expect.stringMatching(/^vnext_[0-9a-f-]{36}$/),
          status: "failed",
          rollbackModel: "strict_one_write_no_automatic_rollback",
          maxPrimaryProviderWrites: 1,
          automaticRollback: false,
          legacyFallbackAfterVnextStart: false,
          retryAfterAmbiguousProviderResult: false,
          fieldClass: "image",
          payloadChecksum: expect.any(String),
          failureCode: "SHOPIFY_VNEXT_MUTATION_FAILED",
        }),
      }),
    }));
    expect(logger.warn).toHaveBeenCalledWith(
      "shopify_vnext_mutation_failed",
      expect.objectContaining({ errorName: "Error" }),
    );
  });

  it("contains controlled branch failures as sanitized hard failures without leaking thrown secrets", async () => {
    setExactGates();
    const { svc, connector, logger } = makeSafetyService({
      applyControlledMutationImpl: async () => {
        throw new Error(`provider rejected token ${TOKEN_VALUE}`);
      },
    });

    await expect(runControlled(svc)).rejects.toMatchObject({ name: "ShopifyControlledMutationError" });
    expect(connector.applyControlledMutation).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "shopify_vnext_mutation_failed",
      expect.objectContaining({
        errorName: "Error",
        installationId: "inst-1",
        productId: "prod-1",
      }),
    );
    expect(JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls])).not.toContain(TOKEN_VALUE);
  });

  it("blocks image plus another changed product field instead of silently stripping the unauthorized field", async () => {
    setExactGates();
    const { svc, connector, logger } = makeSafetyService();

    await expect(runControlled(svc, { productPayload: { title: "Changed Tee" } })).rejects.toMatchObject({
      name: "ShopifyControlledMutationError",
      audit: expect.objectContaining({
        status: "blocked",
        failureReason: expect.stringContaining("unauthorized_field_scope:title"),
      }),
    });

    expect(connector.applyControlledMutation).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "shopify_vnext_mutation_blocked",
      expect.objectContaining({ reason: expect.stringContaining("unauthorized_field_scope:title") }),
    );
  });

  it("controlled_vnext_required: unauthorized non-image field → hard fail pre-write, providerWrites=0, legacyWrites=0", async () => {
    setExactGates();
    const { svc, connector, connectorFramework } = makeSafetyService();

    await expect(
      runControlled(svc, {
        executionMode: "controlled_vnext_required",
        productPayload: { title: "Unauthorized Title Change" },
      }),
    ).rejects.toMatchObject({
      name: "ShopifyControlledMutationError",
      audit: expect.objectContaining({
        status: "blocked",
        failureReason: expect.stringContaining("unauthorized_field_scope:title"),
      }),
    });

    expect(connector.applyControlledMutation).not.toHaveBeenCalled();
    expect(connectorFramework.publish).not.toHaveBeenCalled();
    expect(connectorFramework.update).not.toHaveBeenCalled();
  });

  it("does not treat Shopify CDN URL-only drift as a verified image change", async () => {
    setExactGates();
    const { svc, connector, logger } = makeSafetyService({
      captureRollbackSnapshotImpl: jest.fn()
        .mockResolvedValueOnce(rollbackSnapshot("gid://shopify/ProductImage/same", "https://cdn.example.com/before.jpg"))
        .mockResolvedValueOnce(rollbackSnapshot("gid://shopify/ProductImage/same", "https://cdn.example.com/after-versioned.jpg")),
    });

    await expect(runControlled(svc)).rejects.toMatchObject({
      name: "ShopifyControlledMutationError",
      audit: expect.objectContaining({
        status: "readback_mismatch",
        failureCode: "SHOPIFY_VNEXT_READBACK_MISMATCH",
        readback: expect.objectContaining({ imageChanged: false }),
      }),
    });

    expect(connector.applyControlledMutation).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "shopify_vnext_mutation_readback_mismatch",
      expect.objectContaining({ imageChanged: false }),
    );
  });

  it("does not leak credential tokens in logs during an executed controlled mutation", async () => {
    setExactGates();
    const { svc, logger } = makeSafetyService({
      accessToken: TOKEN_VALUE,
      applyControlledMutationImpl: async (ctx) => {
        await ctx.getAccessToken();
        return { externalRef: "gid://shopify/Product/999", status: "SUCCESS", isAsync: false };
      },
    });

    await expect(runControlled(svc)).resolves.toMatchObject({ outcome: "executed" });

    expect(JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls])).not.toContain(TOKEN_VALUE);
  });

  it("skips on release-identity mismatch even when every other field matches exactly", async () => {
    setExactGates({ RAILWAY_GIT_COMMIT_SHA: OTHER_SHA });
    const { svc, connectorFramework, connector } = makeSafetyService();

    await expect(runControlled(svc)).resolves.toEqual({
      outcome: "skipped",
      reason: "release_not_approved",
      correlationId: expect.stringMatching(/^vnext_[0-9a-f-]{36}$/),
    });
    expect(connector.applyControlledMutation).not.toHaveBeenCalled();
    expect(connectorFramework.buildContextForInstallation).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "vNext disabled",
      env: { VNEXT_MUTATION_ENABLED: "false" },
      expectedReason: "disabled_in_controlled_mode",
    },
    {
      name: "allowlist miss",
      env: { VNEXT_MUTATION_ALLOWLIST_JSON: undefined },
      expectedReason: "allowlist_miss_in_controlled_mode",
    },
    {
      name: "release not approved",
      env: { RAILWAY_GIT_COMMIT_SHA: OTHER_SHA },
      expectedReason: "release_not_approved_in_controlled_mode",
    },
    {
      name: "wrong field class",
      env: { VNEXT_MUTATION_ALLOWED_FIELD_CLASS: undefined },
      expectedReason: "field_class_not_allowed_in_controlled_mode",
    },
  ])(
    "controlled_vnext_required mode: failClosed with zero legacy writes when $name gate is not met",
    async ({ env, expectedReason }) => {
      setExactGates(env);
      const { svc, connector, connectorFramework } = makeSafetyService();

      await expect(
        runControlled(svc, { executionMode: "controlled_vnext_required" }),
      ).rejects.toMatchObject({
        name: "ShopifyControlledMutationError",
        audit: expect.objectContaining({ failureReason: expectedReason }),
      });

      expect(connector.applyControlledMutation).not.toHaveBeenCalled();
      expect(connectorFramework.publish).not.toHaveBeenCalled();
      expect(connectorFramework.update).not.toHaveBeenCalled();
    },
  );

  it("normal mode gate miss still quiet-skips (regression guard for legacy fallback)", async () => {
    setExactGates({ VNEXT_MUTATION_ENABLED: "false" });
    const { svc, connector } = makeSafetyService();

    await expect(runControlled(svc, { executionMode: "normal" })).resolves.toEqual({
      outcome: "skipped",
      reason: "disabled",
      correlationId: expect.stringMatching(/^vnext_[0-9a-f-]{36}$/),
    });
    expect(connector.applyControlledMutation).not.toHaveBeenCalled();
  });

  it("connector methods retain their instance receiver after being extracted from the connector object", async () => {
    // Regression guard for the `this` binding bug:
    // captureRollbackSnapshot, applyControlledMutation, and fetchProductTypeSchema were
    // destructured without .bind(connector), causing `this` to be undefined when invoked
    // as plain functions, which threw "Cannot read properties of undefined (reading 'requireCredential')".
    setExactGates();

    class BoundCheckConnector {
      private readonly _secret = "bound-secret";
      private _callCount = 0;

      private requireCredential(): string {
        // Throws "Cannot read properties of undefined (reading '_secret')" if `this` is lost
        return this._secret;
      }

      async fetchProductTypeSchema(_ctx: unknown, _productType: unknown) {
        return {
          productType: "default",
          requiredAttributes: ["sku", "title", "description", "mainImageUrl"],
          optionalAttributes: [] as string[],
          validValues: {} as Record<string, string[]>,
          schemaVersion: "LOCAL-shopify-default-2026Q3",
        };
      }

      async captureRollbackSnapshot(_ctx: unknown, _gid: unknown, _opts: unknown) {
        const cred = this.requireCredential(); // Throws if unbound
        this._callCount += 1;
        // Return different image IDs on before vs after capture so readback verification passes
        const imageId = this._callCount === 1
          ? "gid://shopify/ProductImage/before-bound"
          : "gid://shopify/ProductImage/after-bound";
        return rollbackSnapshot(imageId, `https://cdn.example.com/${cred}-${this._callCount}.jpg`);
      }

      async applyControlledMutation(_ctx: unknown, _input: unknown, _identifier: unknown, _opts: unknown) {
        this.requireCredential(); // Throws if unbound
        return { externalRef: "gid://shopify/Product/999", status: "SUCCESS" as const, isAsync: false };
      }
    }

    const boundConnector = new BoundCheckConnector();
    const { svc, connectorRegistry } = makeSafetyService();
    connectorRegistry.getConnector.mockReturnValue(boundConnector);

    await expect(runControlled(svc)).resolves.toMatchObject({
      outcome: "executed",
      result: { externalRef: "gid://shopify/Product/999", status: "SUCCESS", isAsync: false },
    });
  });

  it("controlled_vnext_required mode fails closed when categoryId is absent (outer bypass guard)", async () => {
    setExactGates();
    const { svc, connector, connectorFramework } = makeSafetyService();
    jest.spyOn(svc as any, "buildConnectorProductPayload").mockResolvedValue({
      sku: "SKU-1",
      title: "Classic Tee",
      description: "A tee",
      brand: "Acme",
      hsnCode: "61091000",
      gstRate: 5,
      mrp: 999,
      sellingPrice: 799,
      mainImageUrl: "https://cdn.example.com/tee.jpg",
      attributes: {},
      productType: "default",
    });

    await expect(
      (svc as unknown as {
        recordConnectorSubmission: (
          job: { id: string; productId: string; channel: string; installationId?: string | null; categoryId?: string | null },
          simulation: { exportReady: boolean; mappedPayload: Record<string, unknown>; channelIssues: unknown[]; validationSource: "local_rules" },
          executionMode: "controlled_vnext_required",
        ) => Promise<unknown>;
      }).recordConnectorSubmission(
        { id: "job-1", productId: "prod-1", channel: "shopify", installationId: "inst-1", categoryId: null },
        { exportReady: true, mappedPayload: { sku: "SKU-1" }, channelIssues: [], validationSource: "local_rules" },
        "controlled_vnext_required",
      )
    ).rejects.toMatchObject({
      name: "ShopifyControlledMutationError",
      audit: expect.objectContaining({
        failureReason: expect.stringContaining("skipped_in_controlled_mode:not_shopify_or_missing_category"),
      }),
    });

    expect(connector.applyControlledMutation).not.toHaveBeenCalled();
    expect(connectorFramework.publish).not.toHaveBeenCalled();
    expect(connectorFramework.update).not.toHaveBeenCalled();
  });
});
