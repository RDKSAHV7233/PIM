import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { CatalogService } from "./catalog.service";

const BASE_PRODUCT = {
  id: "prod1",
  categoryId: "cat1",
  brand: "TestBrand",
  vendorScopeKey: null,
  version: 1,
  status: "draft",
  title: "Original Title",
  description: "Original description",
  hsnCode: "12345678",
  gstRate: 18,
  attributes: {},
};

function makeService(productOverride?: Partial<typeof BASE_PRODUCT>) {
  const product = { ...BASE_PRODUCT, ...productOverride };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantClient: any = {
    product: {
      findUnique: jest.fn().mockResolvedValue(product),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({ ...product, category: {}, variants: [] }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ ...product, category: {}, variants: [] }),
      create: jest.fn().mockResolvedValue({ ...product, id: "prod1", status: "draft", category: {}, variants: [] }),
    },
    category: {
      findUnique: jest.fn().mockResolvedValue({ id: "cat1", name: "Category" }),
    },
    workflowSla: {
      findUnique: jest.fn().mockResolvedValue({ reviewTargetDays: 3 }),
    },
    validationIssue: {
      count: jest.fn().mockResolvedValue(0),
    },
    productTaxCode: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    variant: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "var-new" }),
      // Only consulted by enforceSkuLimitForApproval when findFirst found an existing
      // variant (i.e. NOT the zero-variant/canonical-creation case, which uses delta=1
      // without ever calling count). Default 0 so existing tests that never override this
      // — because they exercise the zero-variant branch — stay unaffected either way.
      count: jest.fn().mockResolvedValue(0),
    },
  };
  tenantClient.$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(tenantClient));

  const prisma = {
    tenant: jest.fn().mockReturnValue(tenantClient),
  };

  const complianceService = {
    validateAndPersistProduct: jest.fn().mockResolvedValue(undefined),
    resolveOpenIssuesForDeletedProduct: jest.fn().mockResolvedValue({ resolved: 0 }),
  };

  // Default: never blocks. Tests that need to exercise the SKU-limit rejection path
  // override this per-case (see the dedicated describe block for it).
  const planUsageService = {
    checkLimit: jest.fn().mockResolvedValue({ allowed: true, resource: "skus", limit: 999999, current: 0 }),
    touchUsageForCurrentTenant: jest.fn().mockResolvedValue(undefined),
  };

  const auditService = {
    record: jest.fn().mockResolvedValue(undefined),
  };

  const notificationsService = {
    emitApprovalDecision: jest.fn().mockResolvedValue(undefined),
  };

  const accessPolicy = {
    assertProductAccess: jest.fn().mockResolvedValue(undefined),
    assertRequestedProductScopeAllowed: jest.fn().mockResolvedValue(undefined),
    assertProductAttributeWriteAllowed: jest.fn().mockResolvedValue(undefined),
  };

  const cache = {};

  const service = new CatalogService(
    prisma as never,
    complianceService as never,
    planUsageService as never,
    auditService as never,
    notificationsService as never,
    accessPolicy as never,
    cache as never,
  );

  return { service, tenantClient, prisma, complianceService, auditService, accessPolicy, planUsageService };
}

describe("CatalogService.updateProduct — approval-transition guard (F-1)", () => {
  it("editor: in_review -> approved, no content change -> rejected, product not persisted", async () => {
    const { service, tenantClient } = makeService({ status: "in_review", version: 1 });

    await expect(
      service.updateProduct(
        "prod1",
        { expectedVersion: 1, status: "approved" } as never,
        { id: "actor1", role: "editor" },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tenantClient.product.updateMany).not.toHaveBeenCalled();
  });

  it("editor: draft -> in_review is still allowed (must not regress the legitimate submit-for-review path)", async () => {
    const { service, tenantClient } = makeService({ status: "draft", version: 1 });

    const result = await service.updateProduct(
      "prod1",
      { expectedVersion: 1, status: "in_review" } as never,
      { id: "actor1", role: "editor" },
    );

    expect(result).toBeDefined();
    expect(tenantClient.product.updateMany).toHaveBeenCalled();
  });

  it("editor: in_review -> approved WITH a content change in the same request -> rejected with APPROVAL_CONTENT_CHANGE_CONFLICT, before any role/blocking-issue check", async () => {
    const { service, tenantClient } = makeService({ status: "in_review", version: 1 });

    await expect(
      service.updateProduct(
        "prod1",
        { expectedVersion: 1, status: "approved", title: "A brand new title" } as never,
        { id: "actor1", role: "admin" },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "APPROVAL_CONTENT_CHANGE_CONFLICT" }),
    });

    expect(tenantClient.product.updateMany).not.toHaveBeenCalled();
  });

  it("admin: in_review -> approved with an open blocking issue -> rejected APPROVAL_BLOCKED, product not persisted", async () => {
    const { service, tenantClient } = makeService({ status: "in_review", version: 1 });
    tenantClient.validationIssue.count.mockResolvedValueOnce(1);

    await expect(
      service.updateProduct(
        "prod1",
        { expectedVersion: 1, status: "approved" } as never,
        { id: "admin1", role: "admin" },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "APPROVAL_BLOCKED" }),
    });

    expect(tenantClient.product.updateMany).not.toHaveBeenCalled();
  });

  it("admin: in_review -> approved, no blocking issues, no content change -> allowed (regression guard for the existing admin-approves-via-PATCH path)", async () => {
    const { service, tenantClient } = makeService({ status: "in_review", version: 1 });

    const result = await service.updateProduct(
      "prod1",
      { expectedVersion: 1, status: "approved" } as never,
      { id: "admin1", role: "admin" },
    );

    expect(result).toBeDefined();
    expect(tenantClient.product.updateMany).toHaveBeenCalled();
  });

  it("editor: in_review -> active is rejected the same as -> approved (closes the canonicalWorkflowStatus backdoor)", async () => {
    const { service, tenantClient } = makeService({ status: "in_review", version: 1 });

    await expect(
      service.updateProduct(
        "prod1",
        { expectedVersion: 1, status: "active" } as never,
        { id: "actor1", role: "editor" },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tenantClient.product.updateMany).not.toHaveBeenCalled();
  });

  it("approver: in_review -> approved, no content change, no blocking issues -> allowed at the service layer", async () => {
    // Note: approver/reviewer can never reach CatalogService.updateProduct via HTTP in
    // practice — both PATCH routes (catalog.controller.ts, products.controller.ts) 403
    // any role outside admin/editor before this method ever runs. This test exercises
    // the service-level allow-list directly; it is not proof of end-to-end approver
    // access and should not be cited as such.
    const { service, tenantClient } = makeService({ status: "in_review", version: 1 });

    const result = await service.updateProduct(
      "prod1",
      { expectedVersion: 1, status: "approved" } as never,
      { id: "approver1", role: "approver" },
    );

    expect(result).toBeDefined();
    expect(tenantClient.product.updateMany).toHaveBeenCalled();
  });
});

describe("CatalogService.updateProduct — archive/restore transitions (BUG-ARCHIVE-SOFTDELETE-001)", () => {
  it("admin: approved -> archived is allowed and records a STATUS_TRANSITION audit entry", async () => {
    const { service, tenantClient, auditService } = makeService({ status: "approved", version: 1 });

    const result = await service.updateProduct(
      "prod1",
      { expectedVersion: 1, status: "archived" } as never,
      { id: "admin1", role: "admin" },
    );

    expect(result).toBeDefined();
    expect(tenantClient.product.updateMany).toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "STATUS_TRANSITION",
        resourceId: "prod1",
        metadata: expect.objectContaining({ fromStatus: "approved", toStatus: "archived" }),
      }),
    );
  });

  it("admin: archived -> draft is allowed (this is the Restore action; the PATCH endpoint never touches deletedAt)", async () => {
    const { service, tenantClient, auditService } = makeService({ status: "archived", version: 1 });

    const result = await service.updateProduct(
      "prod1",
      { expectedVersion: 1, status: "draft" } as never,
      { id: "admin1", role: "admin" },
    );

    expect(result).toBeDefined();
    expect(tenantClient.product.updateMany).toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "STATUS_TRANSITION",
        resourceId: "prod1",
        metadata: expect.objectContaining({ fromStatus: "archived", toStatus: "draft" }),
      }),
    );
  });

  it("rejected -> archived is allowed (archived is reachable from every status)", async () => {
    const { service, tenantClient } = makeService({ status: "rejected", version: 1 });

    const result = await service.updateProduct(
      "prod1",
      { expectedVersion: 1, status: "archived" } as never,
      { id: "admin1", role: "admin" },
    );

    expect(result).toBeDefined();
    expect(tenantClient.product.updateMany).toHaveBeenCalled();
  });
});

// PIM#663 — #593 ratified "SKU = sellable variant, never product" as the commercial
// definition. createProduct never creates a Variant, so a product could reach
// approved/active with zero variants — invisible to SKU billing and connector publish
// despite being sellable. Fix: the moment a product first enters the approved/active
// canonical bucket, auto-create exactly one canonical variant if none exists yet.
describe("CatalogService — canonical variant auto-creation on first approval (#663)", () => {
  it("updateProduct: in_review -> approved with zero existing variants creates one canonical variant", async () => {
    const { service, tenantClient } = makeService({ status: "in_review", version: 1, attributes: {} });
    tenantClient.variant.findFirst.mockResolvedValue(null);

    await service.updateProduct(
      "prod1",
      { expectedVersion: 1, status: "approved" } as never,
      { id: "admin1", role: "admin" },
    );

    expect(tenantClient.variant.create).toHaveBeenCalledTimes(1);
    const createArgs = tenantClient.variant.create.mock.calls[0][0] as { data: { productId: string; skuCode: string; status: string } };
    expect(createArgs.data.productId).toBe("prod1");
    expect(createArgs.data.skuCode).toBe("prod1"); // falls back to product id — no attributes.sku present
    expect(createArgs.data.status).toBe("approved");
  });

  it("updateProduct: in_review -> approved when a variant already exists does NOT create a second one", async () => {
    const { service, tenantClient } = makeService({ status: "in_review", version: 1 });
    tenantClient.variant.findFirst.mockResolvedValue({ id: "existing-variant" });

    await service.updateProduct(
      "prod1",
      { expectedVersion: 1, status: "approved" } as never,
      { id: "admin1", role: "admin" },
    );

    expect(tenantClient.variant.create).not.toHaveBeenCalled();
  });

  it("updateProduct: in_review -> active (direct, bypassing approved) also creates a canonical variant, with matching status", async () => {
    const { service, tenantClient } = makeService({ status: "in_review", version: 1 });
    tenantClient.variant.findFirst.mockResolvedValue(null);

    await service.updateProduct(
      "prod1",
      { expectedVersion: 1, status: "active" } as never,
      { id: "admin1", role: "admin" },
    );

    expect(tenantClient.variant.create).toHaveBeenCalledTimes(1);
    const createArgs = tenantClient.variant.create.mock.calls[0][0] as { data: { status: string } };
    expect(createArgs.data.status).toBe("active");
  });

  it("updateProduct: approved -> active (same canonical bucket) does not re-check or re-create a variant", async () => {
    const { service, tenantClient } = makeService({ status: "approved", version: 1 });

    await service.updateProduct(
      "prod1",
      { expectedVersion: 1, status: "active" } as never,
      { id: "admin1", role: "admin" },
    );

    expect(tenantClient.variant.findFirst).not.toHaveBeenCalled();
    expect(tenantClient.variant.create).not.toHaveBeenCalled();
  });

  it("updateProduct: reuses a real product-level SKU/price from attributes instead of fabricating one", async () => {
    const { service, tenantClient } = makeService({
      status: "in_review",
      version: 1,
      attributes: { sku: "REAL-SKU-001", mrp: 999, sellingPrice: 799 },
    });
    tenantClient.variant.findFirst.mockResolvedValue(null);

    await service.updateProduct(
      "prod1",
      { expectedVersion: 1, status: "approved" } as never,
      { id: "admin1", role: "admin" },
    );

    const createArgs = tenantClient.variant.create.mock.calls[0][0] as { data: { skuCode: string; mrp: number; sellingPrice: number } };
    expect(createArgs.data.skuCode).toBe("REAL-SKU-001");
    expect(createArgs.data.mrp).toBe(999);
    expect(createArgs.data.sellingPrice).toBe(799);
  });

  it("decideProductReview: approving with zero existing variants creates one canonical variant", async () => {
    const { service, tenantClient } = makeService({ status: "in_review", version: 1 });
    tenantClient.variant.findFirst.mockResolvedValue(null);

    await service.decideProductReview(
      "prod1",
      { status: "approved" },
      { id: "admin1", role: "admin" },
    );

    expect(tenantClient.variant.create).toHaveBeenCalledTimes(1);
    const createArgs = tenantClient.variant.create.mock.calls[0][0] as { data: { productId: string; status: string } };
    expect(createArgs.data.productId).toBe("prod1");
    expect(createArgs.data.status).toBe("approved");
  });

  it("decideProductReview: approving a product that already has a variant does not create a second one", async () => {
    const { service, tenantClient } = makeService({ status: "in_review", version: 1 });
    tenantClient.variant.findFirst.mockResolvedValue({ id: "existing-variant" });

    await service.decideProductReview(
      "prod1",
      { status: "approved" },
      { id: "admin1", role: "admin" },
    );

    expect(tenantClient.variant.create).not.toHaveBeenCalled();
  });

  it("decideProductReview: rejecting never creates a variant (only approval reaches the sellable bucket)", async () => {
    const { service, tenantClient } = makeService({ status: "in_review", version: 1 });
    tenantClient.variant.findFirst.mockResolvedValue(null);

    await service.decideProductReview(
      "prod1",
      { status: "rejected" },
      { id: "admin1", role: "admin" },
    );

    expect(tenantClient.variant.findFirst).not.toHaveBeenCalled();
    expect(tenantClient.variant.create).not.toHaveBeenCalled();
  });
});

// CTO-directed correction to the plan-limit enforcement introduced by the earlier SKU-limit
// fixes (commits 82b533af / c51a10c5): Plan & Usage's own copy states drafts, archived,
// deleted, and parent-only records don't count toward SKU usage. checkLimit belongs on the
// transition INTO the approved/active canonical bucket (enforceSkuLimitForApproval), not on
// product/variant creation. See catalog.controller.ts / products.controller.ts for the
// removed creation-time guard.
describe("CatalogService — SKU plan-limit enforcement moved to approval, not creation", () => {
  it("createProduct never calls checkLimit — draft creation is not gated by the SKU limit", async () => {
    const { service, planUsageService } = makeService();

    await service.createProduct(
      { title: "New Product", description: "d", brand: "B", categoryId: "cat1" } as never,
      { id: "admin1", role: "admin" },
    );

    expect(planUsageService.checkLimit).not.toHaveBeenCalled();
  });

  it("updateProduct: zero-variant approval calls checkLimit with delta=1 (the canonical variant about to be created)", async () => {
    const { service, tenantClient, planUsageService } = makeService({ status: "in_review", version: 1 });
    tenantClient.variant.findFirst.mockResolvedValue(null);

    await service.updateProduct(
      "prod1",
      { expectedVersion: 1, status: "approved" } as never,
      { id: "admin1", role: "admin" },
    );

    expect(planUsageService.checkLimit).toHaveBeenCalledWith("skus", 1, expect.anything());
  });

  it("updateProduct: approving a product with 2 pre-existing active-status variants calls checkLimit with delta=2 — not 1 (ignoring them) and not 3 (double-counting the parent as a SKU)", async () => {
    const { service, tenantClient, planUsageService } = makeService({ status: "in_review", version: 1 });
    tenantClient.variant.findFirst.mockResolvedValue({ id: "v1" }); // non-null -> "has variants" branch
    tenantClient.variant.count.mockResolvedValue(2);

    await service.updateProduct(
      "prod1",
      { expectedVersion: 1, status: "approved" } as never,
      { id: "admin1", role: "admin" },
    );

    expect(tenantClient.variant.count).toHaveBeenCalledWith({
      where: { productId: "prod1", status: { in: ["approved", "active"] } },
    });
    expect(planUsageService.checkLimit).toHaveBeenCalledWith("skus", 2, expect.anything());
  });

  it("updateProduct: approving a product whose existing variants are all still draft calls checkLimit with delta=0 → no block, nothing becomes billable", async () => {
    const { service, tenantClient, planUsageService } = makeService({ status: "in_review", version: 1 });
    tenantClient.variant.findFirst.mockResolvedValue({ id: "v1" });
    tenantClient.variant.count.mockResolvedValue(0); // none of the existing variants are approved/active

    await service.updateProduct(
      "prod1",
      { expectedVersion: 1, status: "approved" } as never,
      { id: "admin1", role: "admin" },
    );

    expect(planUsageService.checkLimit).not.toHaveBeenCalled();
    expect(tenantClient.product.updateMany).toHaveBeenCalled(); // approval still proceeds
  });

  it("updateProduct: approval is blocked with PLAN_LIMIT_EXCEEDED when checkLimit disallows it, and the product is never written", async () => {
    const { service, tenantClient, planUsageService } = makeService({ status: "in_review", version: 1 });
    tenantClient.variant.findFirst.mockResolvedValue(null);
    planUsageService.checkLimit.mockResolvedValue({ allowed: false, resource: "skus", limit: 500, current: 501 });

    await expect(
      service.updateProduct(
        "prod1",
        { expectedVersion: 1, status: "approved" } as never,
        { id: "admin1", role: "admin" },
      ),
    ).rejects.toMatchObject({
      status: 402,
      response: { error: "PLAN_LIMIT_EXCEEDED", resource: "skus", limit: 500, current: 501 },
    });

    expect(tenantClient.product.updateMany).not.toHaveBeenCalled();
    expect(tenantClient.variant.create).not.toHaveBeenCalled();
  });

  it("decideProductReview: approval is blocked with PLAN_LIMIT_EXCEEDED when checkLimit disallows it, and neither the product nor a variant is written", async () => {
    const { service, tenantClient, planUsageService } = makeService({ status: "in_review", version: 1 });
    tenantClient.variant.findFirst.mockResolvedValue(null);
    planUsageService.checkLimit.mockResolvedValue({ allowed: false, resource: "skus", limit: 500, current: 501 });

    await expect(
      service.decideProductReview("prod1", { status: "approved" }, { id: "admin1", role: "admin" }),
    ).rejects.toMatchObject({
      status: 402,
      response: { error: "PLAN_LIMIT_EXCEEDED", resource: "skus" },
    });

    expect(tenantClient.product.update).not.toHaveBeenCalled();
    expect(tenantClient.variant.create).not.toHaveBeenCalled();
  });

  // The exact RED -> GREEN sequence from the CTO's regression spec:
  //   Plan limit = N, current billable SKUs = N
  //   Create draft product -> allowed, billable usage remains N
  //   Approve/activate that draft -> blocked with PLAN_LIMIT_EXCEEDED
  //   Archive one existing billable SKU -> usage becomes N-1
  //   Retry approval -> succeeds, usage returns to N
  it("RED -> GREEN: at-limit tenant is blocked approving a new draft, then succeeds after archiving one existing SKU", async () => {
    const { service, tenantClient, planUsageService } = makeService({ status: "in_review", version: 1 });
    tenantClient.variant.findFirst.mockResolvedValue(null); // zero-variant product -> delta=1 on approval

    // Step 1: create the draft. Never touches checkLimit — draft creation is free.
    await service.createProduct(
      { title: "New Product", description: "d", brand: "B", categoryId: "cat1" } as never,
      { id: "admin1", role: "admin" },
    );
    expect(planUsageService.checkLimit).not.toHaveBeenCalled();

    // Step 2: at the limit (N/N) — approving this draft would make it N+1. Blocked.
    planUsageService.checkLimit.mockResolvedValueOnce({ allowed: false, resource: "skus", limit: 500, current: 501 });
    await expect(
      service.updateProduct(
        "prod1",
        { expectedVersion: 1, status: "approved" } as never,
        { id: "admin1", role: "admin" },
      ),
    ).rejects.toMatchObject({ status: 402, response: { error: "PLAN_LIMIT_EXCEEDED" } });
    expect(tenantClient.product.updateMany).not.toHaveBeenCalled();

    // Step 3: archive one existing billable SKU elsewhere (out of band — this test only
    // needs the effect: usage is now N-1=499, so approving this draft (->500) fits again).
    // Step 4: retry the exact same approval. Now allowed.
    planUsageService.checkLimit.mockResolvedValueOnce({ allowed: true, resource: "skus", limit: 500, current: 500 });
    await service.updateProduct(
      "prod1",
      { expectedVersion: 1, status: "approved" } as never,
      { id: "admin1", role: "admin" },
    );
    expect(tenantClient.product.updateMany).toHaveBeenCalledTimes(1);
    expect(tenantClient.variant.create).toHaveBeenCalledTimes(1);
  });
});
