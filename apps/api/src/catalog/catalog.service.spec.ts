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
    },
  };
  tenantClient.$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(tenantClient));

  const prisma = {
    tenant: jest.fn().mockReturnValue(tenantClient),
  };

  const complianceService = {
    validateAndPersistProduct: jest.fn().mockResolvedValue(undefined),
  };

  const planUsageService = {};

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

  return { service, tenantClient, prisma, complianceService, auditService, accessPolicy };
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
