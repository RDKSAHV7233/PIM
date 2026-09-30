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
    },
    categoryId: "cat-1",
    installation: { id: overrides.installationId ?? "inst-1", connectorId: "conn-1" },
    existingGid: null,
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

    await expect(runControlled(svc)).resolves.toEqual({
      outcome: "executed",
      result: { externalRef: "gid://shopify/Product/999", status: "SUCCESS", isAsync: false },
      correlationId: expect.stringMatching(/^vnext_[0-9a-f-]{36}$/),
    });
    expect(connector.applyControlledMutation).toHaveBeenCalledTimes(1);
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

  it("falls back to exactly one legacy write when a gated vNext attempt fails before completion", async () => {
    setExactGates();
    const { svc, connector, connectorFramework, logger } = makeSafetyService({
      applyControlledMutationImpl: async () => {
        throw new Error(`provider rejected token ${TOKEN_VALUE}`);
      },
    });
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

    await expect(runRecordConnectorSubmission(svc)).resolves.toEqual({
      kind: "success",
      installationId: "inst-1",
      submissionId: "submission-1",
    });

    expect(connector.applyControlledMutation).toHaveBeenCalledTimes(1);
    expect(connectorFramework.publish).toHaveBeenCalledTimes(1);
    expect(connectorFramework.update).not.toHaveBeenCalled();
    expect(connectorFramework.recordSubmissionAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "SUCCESS",
      externalRef: "gid://shopify/Product/legacy",
    }));
    expect(logger.warn).toHaveBeenCalledWith(
      "shopify_vnext_controlled_mutation_failed",
      expect.objectContaining({ errorName: "Error" }),
    );
  });

  it("contains controlled branch failures as no-vNext-mutation skips without leaking thrown secrets", async () => {
    setExactGates();
    const { svc, connector, logger } = makeSafetyService({
      applyControlledMutationImpl: async () => {
        throw new Error(`provider rejected token ${TOKEN_VALUE}`);
      },
    });

    await expect(runControlled(svc)).resolves.toEqual({
      outcome: "skipped",
      reason: "controlled_mutation_failed",
      correlationId: expect.stringMatching(/^vnext_[0-9a-f-]{36}$/),
    });
    expect(connector.applyControlledMutation).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "shopify_vnext_controlled_mutation_failed",
      expect.objectContaining({
        errorName: "Error",
        installationId: "inst-1",
        productId: "prod-1",
      }),
    );
    expect(JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls])).not.toContain(TOKEN_VALUE);
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
});
