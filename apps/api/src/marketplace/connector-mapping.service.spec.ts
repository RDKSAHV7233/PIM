// Coverage for ConnectorMappingService — zero test coverage before, despite
// being the versioned category-mapping lifecycle (draft -> validated ->
// published -> superseded/archived) with rollback, previously deferred from
// the zero-coverage sweep as "too large for a safely-scoped single pass"
// alongside dashboard.service.ts and access-policy.service.ts.
//
// Scoped deliberately to the highest-stakes, previously-unverified properties
// rather than every method in a 1700+ line file:
//   (a) validateMappingRules()'s per-level scope/field requirements;
//   (b) the lifecycle guard (canTransition) enforced by validateVersion/
//       publishVersion/rollbackVersion/archiveVersion — an invalid transition
//       (re-validating an already-validated version, archiving an archived
//       one, publishing a draft) must be rejected, not silently allowed;
//   (c) publishVersion()'s scope-isolation invariant: a slug-scoped publish
//       must never supersede an installation-scoped published version at the
//       same categoryScope, and vice versa — each scope has its own
//       independent "published" slot, per the service's own comment;
//   (d) publishVersion()'s draft/publish account-mismatch guard and its
//       P2002 -> ConflictException mapping for a concurrent publish race;
//   (e) rollbackVersion()'s guards (can't roll back to draft/validated, can't
//       "roll back" to the version already published, blocked compatibility
//       state refused) and that it creates a genuinely new version row
//       rather than resurrecting the old one;
//   (f) resolveEffectiveMapping()'s 5-level precedence merge — specifically
//       the regression the service's own comment describes as already fixed
//       once (an installation-scoped mapping must always outrank a
//       slug-scoped one regardless of which was created more recently).
//
// Prisma is mocked; MetricsService's emit is stubbed to a no-op matching the
// "must never break the transaction" pattern already used elsewhere in this
// service (emitMappingCompletionMetric runs outside the $transaction).

import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ConnectorMappingService } from "./connector-mapping.service";
import * as tenantContext from "../common/tenant/tenant-context";

jest.spyOn(tenantContext, "getTenantKeyFromContext").mockReturnValue("acme");

function makePrismaStub() {
  const connectorMappingVersion = {
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    updateMany: jest.fn(),
  };
  const connectorMappingEvent = {
    create: jest.fn().mockResolvedValue(undefined),
    findMany: jest.fn().mockResolvedValue([]),
  };
  const connectorDefinition = { findUnique: jest.fn() };
  const connectorInstallation = { findFirst: jest.fn() };
  const attributeDefinition = { findMany: jest.fn().mockResolvedValue([]) };
  const product = { findUnique: jest.fn().mockResolvedValue(null) };
  const validationIssue = { count: jest.fn().mockResolvedValue(0) };
  const mediaAsset = { findFirst: jest.fn().mockResolvedValue(null) };

  const tenantClient = {
    connectorMappingVersion,
    connectorMappingEvent,
    connectorDefinition,
    connectorInstallation,
    attributeDefinition,
    product,
    validationIssue,
    mediaAsset,
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tenantClient)),
  };

  return {
    prisma: { tenant: jest.fn().mockReturnValue(tenantClient) },
    tenantClient,
    mocks: {
      connectorMappingVersion,
      connectorMappingEvent,
      connectorDefinition,
      connectorInstallation,
      attributeDefinition,
      product,
      validationIssue,
      mediaAsset,
    },
  };
}

function makeMetricsStub() {
  return { emit: jest.fn().mockResolvedValue(undefined) };
}

function createService() {
  const { prisma, mocks } = makePrismaStub();
  const metrics = makeMetricsStub();
  const service = new ConnectorMappingService(prisma as never, metrics as never);
  return { service, mocks, metrics };
}

const BASE_ROW_FIELDS = {
  tenantKey: "acme",
  connectorDefinitionId: "def-1",
  connectorDefinitionVersion: "1",
  fallbackPolicy: {},
  fallbackAckRequired: false,
  publishedAt: null,
  supersededBy: null,
  createdBy: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  archivedAt: null,
};

function makeRow(overrides: Record<string, unknown>) {
  return {
    id: "v1",
    connectorSlug: "shopify",
    installationId: null,
    draftInstallationId: null,
    categoryScope: "*",
    mappingLevel: "tenant_connector_default",
    lifecycleState: "draft",
    compatibilityState: "compatible",
    mappingRules: { field_mappings: { title: "title" } },
    ...BASE_ROW_FIELDS,
    ...overrides,
  };
}

describe("ConnectorMappingService.validateMappingRules", () => {
  it("requires categoryScope='*' for a tenant_connector_default", () => {
    const { service } = createService();
    const result = service.validateMappingRules({
      mappingLevel: "tenant_connector_default",
      categoryScope: "electronics",
      mappingRules: { field_mappings: { title: "title" } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("tenant_connector_default_requires_global_scope");
  });

  it("requires a specific (non-'*') categoryScope and a target category for tenant_connector_category_mapping", () => {
    const { service } = createService();
    const wildcardResult = service.validateMappingRules({
      mappingLevel: "tenant_connector_category_mapping",
      categoryScope: "*",
      mappingRules: { field_mappings: { title: "title" }, category: { target: "shirts" } },
    });
    expect(wildcardResult.errors).toContain("tenant_connector_category_mapping_requires_specific_scope");

    const noTargetResult = service.validateMappingRules({
      mappingLevel: "tenant_connector_category_mapping",
      categoryScope: "apparel",
      mappingRules: { field_mappings: { title: "title" } },
    });
    expect(noTargetResult.errors).toContain("target_category_required");
  });

  it("requires field_mappings for every level except connector_default_template", () => {
    const { service } = createService();
    const missing = service.validateMappingRules({
      mappingLevel: "tenant_connector_default",
      categoryScope: "*",
      mappingRules: {},
    });
    expect(missing.errors).toContain("field_mappings_required");

    const templateOk = service.validateMappingRules({
      mappingLevel: "connector_default_template",
      categoryScope: "*",
      mappingRules: {},
    });
    expect(templateOk.errors).not.toContain("field_mappings_required");
  });

  it("requires a fallbackPolicy when fallbackAckRequired is set, and rejects a fallback default matching the target category", () => {
    const { service } = createService();
    const missingPolicy = service.validateMappingRules({
      mappingLevel: "tenant_connector_default",
      categoryScope: "*",
      mappingRules: { field_mappings: { title: "title" } },
      fallbackAckRequired: true,
      fallbackPolicy: {},
    });
    expect(missingPolicy.errors).toContain("fallback_policy_required_when_ack_is_enabled");

    const selfReferential = service.validateMappingRules({
      mappingLevel: "tenant_connector_category_mapping",
      categoryScope: "apparel",
      mappingRules: { field_mappings: { title: "title" }, category: { target: "shirts" } },
      fallbackPolicy: { default_category: "shirts" },
    });
    expect(selfReferential.errors).toContain("fallback_category_cannot_match_target_category");
  });
});

describe("ConnectorMappingService — lifecycle transition guards", () => {
  afterEach(() => jest.clearAllMocks());

  it("validateVersion rejects re-validating an already-validated version", async () => {
    const { service, mocks } = createService();
    mocks.connectorMappingVersion.findFirst.mockResolvedValue(makeRow({ lifecycleState: "validated" }));

    await expect(
      service.validateVersion({ connectorSlug: "shopify", versionId: "v1" }),
    ).rejects.toThrow(ConflictException);
  });

  it("publishVersion rejects a draft (must be validated first)", async () => {
    const { service, mocks } = createService();
    mocks.connectorMappingVersion.findFirst.mockResolvedValue(makeRow({ lifecycleState: "draft" }));

    await expect(
      service.publishVersion({ connectorSlug: "shopify", versionId: "v1", confirm: true }),
    ).rejects.toThrow(ConflictException);
  });

  it("archiveVersion rejects a version that's already archived", async () => {
    const { service, mocks } = createService();
    mocks.connectorMappingVersion.findFirst.mockResolvedValue(makeRow({ lifecycleState: "archived" }));

    await expect(
      service.archiveVersion({ connectorSlug: "shopify", versionId: "v1", reason: "cleanup" }),
    ).rejects.toThrow(ConflictException);
  });

  it("archiveVersion allows archiving from draft, validated, published, or superseded", async () => {
    for (const lifecycleState of ["draft", "validated", "published", "superseded"] as const) {
      const { service, mocks } = createService();
      mocks.connectorMappingVersion.findFirst.mockResolvedValue(makeRow({ lifecycleState }));
      mocks.connectorMappingVersion.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        service.archiveVersion({ connectorSlug: "shopify", versionId: "v1", reason: "cleanup" }),
      ).resolves.toBeDefined();
    }
  });
});

describe("ConnectorMappingService.publishVersion", () => {
  afterEach(() => jest.clearAllMocks());

  it("never lets a slug-scoped publish supersede an installation-scoped published version at the same categoryScope", async () => {
    const { service, mocks } = createService();
    // Selected: slug-scoped (installationId=null), being published.
    mocks.connectorMappingVersion.findFirst
      .mockResolvedValueOnce(makeRow({ id: "v-slug", lifecycleState: "validated", installationId: null }))
      .mockResolvedValueOnce(makeRow({ id: "v-slug", lifecycleState: "published", installationId: null, publishedAt: new Date() }));
    // Candidate published rows at the same categoryScope include an installation-scoped one.
    mocks.connectorMappingVersion.findMany.mockResolvedValue([
      { id: "v-install", installationId: "inst-1" },
    ]);
    mocks.connectorMappingVersion.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.publishVersion({ connectorSlug: "shopify", versionId: "v-slug", confirm: true });

    expect(result.superseded).toEqual([]);
    // updateMany for superseding should never have been called with the installation-scoped id.
    const supersedeCalls = mocks.connectorMappingVersion.updateMany.mock.calls.filter(
      ([args]) => args?.data?.lifecycleState === "superseded",
    );
    expect(supersedeCalls).toHaveLength(0);
  });

  it("supersedes a prior published version in the SAME scope (both slug-scoped)", async () => {
    const { service, mocks } = createService();
    mocks.connectorMappingVersion.findFirst
      .mockResolvedValueOnce(makeRow({ id: "v-new", lifecycleState: "validated", installationId: null }))
      .mockResolvedValueOnce(makeRow({ id: "v-new", lifecycleState: "published", installationId: null, publishedAt: new Date() }));
    mocks.connectorMappingVersion.findMany.mockResolvedValue([
      { id: "v-old", installationId: null },
    ]);
    mocks.connectorMappingVersion.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.publishVersion({ connectorSlug: "shopify", versionId: "v-new", confirm: true });

    expect(result.superseded).toEqual(["v-old"]);
  });

  it("rejects a publish whose installationId doesn't match the draft's own draftInstallationId", async () => {
    const { service, mocks } = createService();
    mocks.connectorMappingVersion.findFirst.mockResolvedValue(
      makeRow({ lifecycleState: "validated", draftInstallationId: "inst-1" }),
    );

    await expect(
      service.publishVersion({ connectorSlug: "shopify", versionId: "v1", confirm: true, installationId: "inst-2" }),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.publishVersion({ connectorSlug: "shopify", versionId: "v1", confirm: true }),
    ).rejects.toThrow(ConflictException);
  });

  it("skips the account-mismatch guard when draftInstallationId is null (pre-migration draft)", async () => {
    const { service, mocks } = createService();
    mocks.connectorMappingVersion.findFirst
      .mockResolvedValueOnce(makeRow({ lifecycleState: "validated", draftInstallationId: null }))
      .mockResolvedValueOnce(makeRow({ lifecycleState: "published", publishedAt: new Date() }));
    mocks.connectorMappingVersion.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.publishVersion({ connectorSlug: "shopify", versionId: "v1", confirm: true }),
    ).resolves.toBeDefined();
  });

  it("maps a concurrent-publish P2002 unique-constraint violation to ConflictException(mapping_publish_conflict)", async () => {
    const { service, mocks } = createService();
    mocks.connectorMappingVersion.findFirst.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "5.0.0" }),
    );

    await expect(
      service.publishVersion({ connectorSlug: "shopify", versionId: "v1", confirm: true }),
    ).rejects.toThrow("mapping_publish_conflict");
  });

  it("requires explicit confirm:true before publishing anything", async () => {
    const { service } = createService();
    await expect(
      service.publishVersion({ connectorSlug: "shopify", versionId: "v1", confirm: false }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe("ConnectorMappingService.rollbackVersion", () => {
  afterEach(() => jest.clearAllMocks());

  it("rejects rolling back to a draft or validated source — must have been previously published", async () => {
    const { service, mocks } = createService();
    mocks.connectorMappingVersion.findFirst.mockResolvedValue(makeRow({ lifecycleState: "validated" }));

    await expect(
      service.rollbackVersion({ connectorSlug: "shopify", versionId: "v1", confirm: true, reason: "bad data" }),
    ).rejects.toThrow(ConflictException);
  });

  it("rejects rolling back to the version that is already the current published one", async () => {
    const { service, mocks } = createService();
    mocks.connectorMappingVersion.findFirst.mockResolvedValue(makeRow({ lifecycleState: "published" }));

    await expect(
      service.rollbackVersion({ connectorSlug: "shopify", versionId: "v1", confirm: true, reason: "bad data" }),
    ).rejects.toThrow("mapping_version_already_published");
  });

  it("rejects rolling back to a source whose compatibilityState is blocked", async () => {
    const { service, mocks } = createService();
    mocks.connectorMappingVersion.findFirst.mockResolvedValue(
      makeRow({ lifecycleState: "superseded", compatibilityState: "blocked" }),
    );

    await expect(
      service.rollbackVersion({ connectorSlug: "shopify", versionId: "v1", confirm: true, reason: "bad data" }),
    ).rejects.toThrow("rollback_source_blocked");
  });

  it("creates a genuinely new version row (not the source's own id) and copies the source's installation scope", async () => {
    const { service, mocks } = createService();
    const source = makeRow({ id: "v-old", lifecycleState: "superseded", installationId: "inst-1" });
    mocks.connectorMappingVersion.findFirst
      .mockResolvedValueOnce(source) // sourceRow lookup
      .mockResolvedValueOnce({ ...source, id: "rollback-generated", lifecycleState: "published", publishedAt: new Date() }); // rollbackRow lookup
    mocks.connectorMappingVersion.findMany.mockResolvedValue([]); // no currently-published rows to supersede
    mocks.connectorMappingVersion.updateMany.mockResolvedValue({ count: 1 });

    await service.rollbackVersion({ connectorSlug: "shopify", versionId: "v-old", confirm: true, reason: "bad data" });

    const createCall = mocks.connectorMappingVersion.create.mock.calls[0][0];
    expect(createCall.data.id).not.toBe("v-old");
    expect(createCall.data.installationId).toBe("inst-1");
  });

  it("only supersedes currently-published rows in the SAME installation scope as the rollback source", async () => {
    const { service, mocks } = createService();
    const source = makeRow({ id: "v-old", lifecycleState: "superseded", installationId: null });
    mocks.connectorMappingVersion.findFirst
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce({ ...source, id: "rollback-generated", lifecycleState: "published", publishedAt: new Date() });
    // findMany is called once for "currently published at this categoryScope" (pre-filtered by
    // the service's own query to lifecycleState:"published"); simulate both scopes present,
    // the service must post-filter to only the null-installationId one.
    mocks.connectorMappingVersion.findMany.mockResolvedValue([
      makeRow({ id: "currently-slug", installationId: null, lifecycleState: "published" }),
      makeRow({ id: "currently-install", installationId: "inst-9", lifecycleState: "published" }),
    ]);
    mocks.connectorMappingVersion.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.rollbackVersion({
      connectorSlug: "shopify",
      versionId: "v-old",
      confirm: true,
      reason: "bad data",
    });

    expect(result.superseded).toEqual(["currently-slug"]);
  });

  it("requires explicit confirm:true before rolling back anything", async () => {
    const { service } = createService();
    await expect(
      service.rollbackVersion({ connectorSlug: "shopify", versionId: "v1", confirm: false, reason: "x" }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe("ConnectorMappingService.resolveEffectiveMapping — 5-level precedence merge", () => {
  afterEach(() => jest.clearAllMocks());

  it("an installation-scoped category mapping always outranks a slug-scoped default, even if the slug-scoped one was created later (regression guard)", async () => {
    const { service, mocks } = createService();
    const installCategory = makeRow({
      id: "v-install-category",
      mappingLevel: "tenant_connector_category_mapping",
      categoryScope: "apparel",
      installationId: "inst-1",
      lifecycleState: "published",
      mappingRules: { field_mappings: { title: "install_title" } },
      createdAt: new Date("2026-01-01T00:00:00Z"), // created FIRST
    });
    const slugDefault = makeRow({
      id: "v-slug-default",
      mappingLevel: "tenant_connector_default",
      categoryScope: "*",
      installationId: null,
      lifecycleState: "published",
      mappingRules: { field_mappings: { title: "slug_title" } },
      createdAt: new Date("2026-06-01T00:00:00Z"), // created LATER — must still lose
    });
    mocks.connectorMappingVersion.findMany.mockResolvedValue([installCategory, slugDefault]);

    const result = await service.resolveEffectiveMapping({
      connectorSlug: "shopify",
      categoryScope: "apparel",
      installationId: "inst-1",
    });

    expect((result.resolvedMapping.field_mappings as Record<string, unknown>).title).toBe("install_title");
  });

  it("applies the fallback default and marks fallbackAckRequired when no category-specific mapping exists for the requested scope", async () => {
    const { service, mocks } = createService();
    const slugDefault = makeRow({
      id: "v-slug-default",
      mappingLevel: "tenant_connector_default",
      categoryScope: "*",
      installationId: null,
      lifecycleState: "published",
      fallbackAckRequired: true,
      mappingRules: { field_mappings: { title: "default_title" } },
    });
    mocks.connectorMappingVersion.findMany.mockResolvedValue([slugDefault]);

    const result = await service.resolveEffectiveMapping({
      connectorSlug: "shopify",
      categoryScope: "apparel",
    });

    expect(result.fallbackApplied).toBe(true);
    expect(result.fallbackAckRequired).toBe(true);
  });

  it("escalates compatibilityState to the most severe among matched versions", async () => {
    const { service, mocks } = createService();
    const slugDefault = makeRow({
      id: "v1",
      mappingLevel: "tenant_connector_default",
      categoryScope: "*",
      installationId: null,
      lifecycleState: "published",
      compatibilityState: "deprecated",
    });
    const categoryMapping = makeRow({
      id: "v2",
      mappingLevel: "tenant_connector_category_mapping",
      categoryScope: "apparel",
      installationId: null,
      lifecycleState: "published",
      compatibilityState: "remap_required",
    });
    mocks.connectorMappingVersion.findMany.mockResolvedValue([slugDefault, categoryMapping]);

    const result = await service.resolveEffectiveMapping({
      connectorSlug: "shopify",
      categoryScope: "apparel",
    });

    expect(result.compatibilityState).toBe("remap_required");
  });

  it("falls back to the hardcoded system connector default when nothing published matches at all", async () => {
    const { service, mocks } = createService();
    mocks.connectorMappingVersion.findMany.mockResolvedValue([]);

    const result = await service.resolveEffectiveMapping({
      connectorSlug: "unknown-connector-xyz",
      categoryScope: "apparel",
    });

    expect(result.matchedVersions).toEqual([]);
    expect(result.compatibilityState).toBe("compatible");
    expect(result.resolvedMapping).toEqual({ field_mappings: {} });
  });
});

// Regression coverage for evaluatePublishReadiness's missingRequiredProductValues:
// SYSTEM_CONNECTOR_DEFAULTS stores attribute-sourced fields under an "attributes.X"
// source key (e.g. Shopify's "attributes.sku" -> "variants.0.sku",
// "attributes.mainImageUrl" -> "images.0.src"), but a tenant's required_fields list
// naturally names the bare canonical field ("sku", "mainImageUrl"). Before this fix,
// missingRequiredProductValues only ever looked up the bare name as an exact source
// key, so it always fell through to "missing" for any attribute-sourced required
// field even when the connector's own default mapping already covered it —
// mislabeling a fully-mapped product as blocked. missingRequiredMappings (just above
// it in evaluatePublishReadiness) already guarded against this exact mismatch by
// checking both `key` and `attributes.${key}`; these tests assert
// missingRequiredProductValues now does the same.
describe("ConnectorMappingService.evaluatePublishReadiness — attributes. prefix coverage (missingRequiredProductValues)", () => {
  afterEach(() => jest.clearAllMocks());

  function publishedShopifyDefault(requiredFields: string[]) {
    return makeRow({
      id: "v-shopify-default",
      connectorSlug: "shopify",
      mappingLevel: "tenant_connector_default",
      categoryScope: "*",
      installationId: null,
      lifecycleState: "published",
      mappingRules: { required_fields: requiredFields },
    });
  }

  function baseProduct(overrides: Record<string, unknown> = {}) {
    return {
      id: "prod-1",
      categoryId: "cat-apparel",
      status: "approved",
      title: "Classic Tee",
      description: "A tee",
      brand: "Acme",
      hsnCode: null,
      gstRate: null,
      attributes: {},
      variants: [{ skuCode: "SKU-1", sellingPrice: 999, mrp: 1099, attributes: {} }],
      ...overrides,
    };
  }

  it("does not report bare 'sku' as missing when the Shopify default mapping only covers it via attributes.sku and the value is present", async () => {
    const { service, mocks } = createService();
    mocks.connectorMappingVersion.findMany.mockResolvedValue([publishedShopifyDefault(["sku"])]);
    mocks.product.findUnique.mockResolvedValue(
      baseProduct({ attributes: { sku: "SKU-1" } }),
    );

    const result = await service.evaluatePublishReadiness({
      connectorSlug: "shopify",
      categoryScope: "cat-apparel",
      productId: "prod-1",
    });

    expect(result.checks).toMatchObject({
      productDataReadiness: { missingRequiredProductValues: [] },
    });
    expect(result.blockers).not.toContain("required_product_data_missing");
  });

  it("still reports bare 'sku' as missing when attributes.sku resolves but the value itself is empty", async () => {
    const { service, mocks } = createService();
    mocks.connectorMappingVersion.findMany.mockResolvedValue([publishedShopifyDefault(["sku"])]);
    mocks.product.findUnique.mockResolvedValue(baseProduct({ attributes: {} }));

    const result = await service.evaluatePublishReadiness({
      connectorSlug: "shopify",
      categoryScope: "cat-apparel",
      productId: "prod-1",
    });

    expect(result.checks).toMatchObject({
      productDataReadiness: { missingRequiredProductValues: ["sku"] },
    });
    expect(result.blockers).toContain("required_product_data_missing");
  });

  it("does not report bare 'mainImageUrl' as missing when the Shopify default mapping only covers it via attributes.mainImageUrl and the value is present", async () => {
    const { service, mocks } = createService();
    mocks.connectorMappingVersion.findMany.mockResolvedValue([publishedShopifyDefault(["mainImageUrl"])]);
    mocks.product.findUnique.mockResolvedValue(
      baseProduct({ attributes: { mainImageUrl: "https://cdn.example.com/img.jpg" } }),
    );

    const result = await service.evaluatePublishReadiness({
      connectorSlug: "shopify",
      categoryScope: "cat-apparel",
      productId: "prod-1",
    });

    expect(result.checks).toMatchObject({
      productDataReadiness: { missingRequiredProductValues: [] },
    });
  });

  it("still reports missing when required_fields already uses the attributes.-prefixed form and the value is empty", async () => {
    const { service, mocks } = createService();
    mocks.connectorMappingVersion.findMany.mockResolvedValue([publishedShopifyDefault(["attributes.mainImageUrl"])]);
    mocks.product.findUnique.mockResolvedValue(baseProduct({ attributes: {} }));

    const result = await service.evaluatePublishReadiness({
      connectorSlug: "shopify",
      categoryScope: "cat-apparel",
      productId: "prod-1",
    });

    expect(result.checks).toMatchObject({
      productDataReadiness: { missingRequiredProductValues: ["attributes.mainImageUrl"] },
    });
  });

  it("still reports a genuinely unmapped required field as missing (no attributes. source or target covers it)", async () => {
    const { service, mocks } = createService();
    mocks.connectorMappingVersion.findMany.mockResolvedValue([publishedShopifyDefault(["seoDescription"])]);
    mocks.product.findUnique.mockResolvedValue(baseProduct());

    const result = await service.evaluatePublishReadiness({
      connectorSlug: "shopify",
      categoryScope: "cat-apparel",
      productId: "prod-1",
    });

    expect(result.checks).toMatchObject({
      productDataReadiness: { missingRequiredProductValues: ["seoDescription"] },
    });
    expect(result.blockers).toContain("required_product_data_missing");
  });
});
