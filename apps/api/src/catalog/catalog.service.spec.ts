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
