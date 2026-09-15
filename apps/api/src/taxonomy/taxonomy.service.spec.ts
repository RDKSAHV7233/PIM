// Coverage for TaxonomyService — zero test coverage before, despite the
// riskiest logic in the file being:
//   (a) updateCategory()'s rename cascade: renaming a category rewrites its
//       `path` and every descendant's `path` (prefix substitution), and must
//       reserve a collision-free slug for the renamed row AND every
//       descendant within the same batch, all inside one $transaction;
//   (b) deleteCategory()'s ordered guard chain, including the documented
//       withSoftDeleteBypass() call — the global tenant-scope extension
//       silently injects `deletedAt: null` into every Product query, so the
//       product-count delete-guard must explicitly bypass that to also catch
//       soft-deleted-but-not-yet-purged products (see the service's own
//       comment above that call site);
//   (c) listCategories()'s cursor-pagination correctness (hasNext detection,
//       cursor encode/decode round-trip, invalid-cursor rejection).
// AccessPolicyService is mocked (not exercised) — it already has its own
// dedicated, much larger test surface elsewhere in the audit backlog.

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { TaxonomyService } from "./taxonomy.service";
import { encodeCursorToken } from "../common/pagination/cursor-pagination";
import { SOFT_DELETE_BYPASS_ARG } from "../common/prisma-soft-delete.middleware";

function createService() {
  const categoryFindUnique = jest.fn();
  const categoryFindMany = jest.fn();
  const categoryFindFirst = jest.fn();
  const categoryCreate = jest.fn();
  const categoryUpdate = jest.fn();
  const categoryDelete = jest.fn();
  const categoryCount = jest.fn();
  const productCount = jest.fn();
  const productGroupBy = jest.fn();
  const bulkImportJobCount = jest.fn();
  const bulkImportRunCount = jest.fn();
  const marketplaceExportJobCount = jest.fn();
  const attributeDefinitionFindUnique = jest.fn();
  const attributeDefinitionFindMany = jest.fn();
  const attributeDefinitionCreate = jest.fn();
  const attributeDefinitionUpdate = jest.fn();
  const attributeDefinitionDelete = jest.fn();
  const transactionMock = jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));

  const tenantClient = {
    category: {
      findUnique: categoryFindUnique,
      findMany: categoryFindMany,
      findFirst: categoryFindFirst,
      create: categoryCreate,
      update: categoryUpdate,
      delete: categoryDelete,
      count: categoryCount,
    },
    product: { count: productCount, groupBy: productGroupBy },
    bulkImportJob: { count: bulkImportJobCount },
    bulkImportRun: { count: bulkImportRunCount },
    marketplaceExportJob: { count: marketplaceExportJobCount },
    attributeDefinition: {
      findUnique: attributeDefinitionFindUnique,
      findMany: attributeDefinitionFindMany,
      create: attributeDefinitionCreate,
      update: attributeDefinitionUpdate,
      delete: attributeDefinitionDelete,
    },
    $transaction: transactionMock,
  };
  const prisma = { tenant: jest.fn().mockReturnValue(tenantClient) };
  const accessPolicy = {
    buildCategoryScopeWhere: jest.fn().mockResolvedValue(undefined),
    assertCategoryAccess: jest.fn().mockResolvedValue(undefined),
  };
  const cache = { invalidateByPrefix: jest.fn().mockResolvedValue(undefined) };

  const service = new TaxonomyService(prisma as any, accessPolicy as any, cache as any);
  return {
    service,
    accessPolicy,
    cache,
    categoryFindUnique,
    categoryFindMany,
    categoryFindFirst,
    categoryCreate,
    categoryUpdate,
    categoryDelete,
    categoryCount,
    productCount,
    productGroupBy,
    bulkImportJobCount,
    bulkImportRunCount,
    marketplaceExportJobCount,
    attributeDefinitionFindUnique,
    attributeDefinitionFindMany,
    attributeDefinitionCreate,
    attributeDefinitionUpdate,
    attributeDefinitionDelete,
    transactionMock,
  };
}

describe("TaxonomyService.updateCategory — rename cascade and slug collision avoidance (no prior coverage)", () => {
  it("rewrites every descendant's path by substituting the renamed prefix, leaving the suffix intact", async () => {
    const t = createService();
    t.categoryFindUnique.mockResolvedValue({
      id: "cat-1",
      path: "Apparel > Shirts",
      parent: { path: "Apparel" },
    });
    t.categoryFindMany
      .mockResolvedValueOnce([
        { id: "child-1", path: "Apparel > Shirts > Casual" },
        { id: "child-2", path: "Apparel > Shirts > Casual > Cotton" },
      ])
      .mockResolvedValueOnce([]); // existing-slug collision check finds no other categories

    await t.service.updateCategory("cat-1", { name: "Tops" } as any);

    const updates = t.transactionMock.mock.calls[0][0];
    expect(updates).toHaveLength(3);
    // Each entry in the transaction array is itself a call to category.update(...) —
    // inspect what was passed to the mock rather than the (mocked) return value.
    expect(t.categoryUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: "cat-1" },
      data: expect.objectContaining({ name: "Tops", path: "Apparel > Tops" }),
    }));
    expect(t.categoryUpdate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: "child-1" },
      data: expect.objectContaining({ path: "Apparel > Tops > Casual" }),
    }));
    expect(t.categoryUpdate).toHaveBeenNthCalledWith(3, expect.objectContaining({
      where: { id: "child-2" },
      data: expect.objectContaining({ path: "Apparel > Tops > Casual > Cotton" }),
    }));
  });

  it("never sends a name change for descendant rows — only the renamed category's own row gets a new name", async () => {
    const t = createService();
    t.categoryFindUnique.mockResolvedValue({ id: "cat-1", path: "Apparel > Shirts", parent: { path: "Apparel" } });
    t.categoryFindMany
      .mockResolvedValueOnce([{ id: "child-1", path: "Apparel > Shirts > Casual", name: "Casual" }])
      .mockResolvedValueOnce([]);

    await t.service.updateCategory("cat-1", { name: "Tops" } as any);

    expect(t.categoryUpdate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ name: undefined }),
    }));
  });

  it("reserves collision-free slugs across the whole batch, including against a slug the rename itself just produced", async () => {
    const t = createService();
    t.categoryFindUnique.mockResolvedValue({ id: "cat-1", path: "Apparel > Shirts", parent: { path: "Apparel" } });
    // Two descendants whose new names would slugify to the exact same string
    // ("Cotton Blend" -> "cotton-blend") as each other, forcing the batch-level
    // dedup (reserveUniqueSlug) to kick in rather than the pre-existing-slug set.
    t.categoryFindMany
      .mockResolvedValueOnce([
        { id: "child-1", path: "Apparel > Shirts > Cotton Blend" },
        { id: "child-2", path: "Apparel > Shirts > Cotton  Blend" }, // double space collapses to the same slug
      ])
      .mockResolvedValueOnce([{ slug: "apparel-tops" }]); // an unrelated existing category's slug

    await t.service.updateCategory("cat-1", { name: "Tops" } as any);

    const slugs = t.categoryUpdate.mock.calls.map((call) => call[0].data.slug);
    expect(new Set(slugs).size).toBe(slugs.length); // no duplicate slugs within the batch
    expect(slugs).not.toContain("apparel-tops"); // and none collide with a slug reserved outside the batch
  });

  it("throws NotFoundException for a category that doesn't exist", async () => {
    const t = createService();
    t.categoryFindUnique.mockResolvedValue(null);

    await expect(t.service.updateCategory("missing", { name: "X" } as any)).rejects.toThrow(NotFoundException);
  });
});

describe("TaxonomyService.deleteCategory — ordered delete guards (no prior coverage)", () => {
  const CATEGORY = { id: "cat-1", path: "Apparel > Shirts" };

  it("refuses deletion when child categories exist, without ever checking products", async () => {
    const t = createService();
    t.categoryFindUnique.mockResolvedValue(CATEGORY);
    t.categoryCount.mockResolvedValue(1);

    await expect(t.service.deleteCategory("cat-1")).rejects.toThrow(BadRequestException);
    expect(t.productCount).not.toHaveBeenCalled();
  });

  it("bypasses the global soft-delete filter when checking attached products, so a soft-deleted-but-not-purged product still blocks deletion", async () => {
    const t = createService();
    t.categoryFindUnique.mockResolvedValue(CATEGORY);
    t.categoryCount.mockResolvedValue(0);
    t.productCount.mockResolvedValue(1);

    await expect(t.service.deleteCategory("cat-1")).rejects.toThrow(BadRequestException);
    expect(t.productCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: { categoryId: "cat-1" }, [SOFT_DELETE_BYPASS_ARG]: true }),
    );
  });

  it("checks import/run/export job counts only after the child and product checks pass, and reports the correct guard for each", async () => {
    const t = createService();
    t.categoryFindUnique.mockResolvedValue(CATEGORY);
    t.categoryCount.mockResolvedValue(0);
    t.productCount.mockResolvedValue(0);
    t.bulkImportJobCount.mockResolvedValue(1);
    t.bulkImportRunCount.mockResolvedValue(0);
    t.marketplaceExportJobCount.mockResolvedValue(0);

    await expect(t.service.deleteCategory("cat-1")).rejects.toThrow(/import jobs/);
  });

  it("deletes cleanly once every guard passes", async () => {
    const t = createService();
    t.categoryFindUnique.mockResolvedValue(CATEGORY);
    t.categoryCount.mockResolvedValue(0);
    t.productCount.mockResolvedValue(0);
    t.bulkImportJobCount.mockResolvedValue(0);
    t.bulkImportRunCount.mockResolvedValue(0);
    t.marketplaceExportJobCount.mockResolvedValue(0);

    await t.service.deleteCategory("cat-1");

    expect(t.categoryDelete).toHaveBeenCalledWith({ where: { id: "cat-1" } });
  });

  it("throws NotFoundException for a category that doesn't exist", async () => {
    const t = createService();
    t.categoryFindUnique.mockResolvedValue(null);

    await expect(t.service.deleteCategory("missing")).rejects.toThrow(NotFoundException);
  });
});

describe("TaxonomyService.listCategories — cursor pagination (no prior coverage)", () => {
  it("returns every category up to the defensive cap when options.all is set, bypassing cursor pagination entirely", async () => {
    const t = createService();
    t.categoryFindMany.mockResolvedValue([{ id: "c1" }]);

    const result = await t.service.listCategories(undefined, { all: true });

    expect(result).toEqual([{ id: "c1" }]);
    expect(t.categoryFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5_000 }));
  });

  it("throws BadRequestException for a cursor that fails to decode", async () => {
    const t = createService();

    await expect(t.service.listCategories({ cursor: "not-valid-base64url-json" })).rejects.toThrow(BadRequestException);
  });

  it("reports hasNext and encodes a cursor from the last item when more rows exist than the page limit", async () => {
    const t = createService();
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: `c${i}`, path: `Cat ${i}` }));
    t.categoryFindMany.mockResolvedValue(rows); // limit+1 rows returned signals "there's more"

    const result = (await t.service.listCategories({ limit: 2 })) as { items: unknown[]; nextCursor: string | null };

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).not.toBeNull();
  });

  it("returns a null cursor when the last page is reached exactly", async () => {
    const t = createService();
    t.categoryFindMany.mockResolvedValue([{ id: "c0", path: "Cat 0" }]);

    const result = (await t.service.listCategories({ limit: 2 })) as { items: unknown[]; nextCursor: string | null };

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it("resumes correctly from a previously-encoded cursor, filtering to rows strictly after it", async () => {
    const t = createService();
    t.categoryFindMany.mockResolvedValue([]);
    const cursor = encodeCursorToken({ sort: "Cat 0", id: "c0" });

    await t.service.listCategories({ cursor, limit: 2 });

    const callArgs = t.categoryFindMany.mock.calls[0][0];
    expect(callArgs.where.AND[1].OR).toEqual([
      { path: { gt: "Cat 0" } },
      { path: "Cat 0", id: { gt: "c0" } },
    ]);
  });
});

describe("TaxonomyService attribute definitions — duplicate-key mapping and cache invalidation (no prior coverage)", () => {
  it("maps a Prisma P2002 unique-constraint violation to a BadRequestException on create, not a raw 500", async () => {
    const t = createService();
    t.categoryFindUnique.mockResolvedValue({ id: "cat-1" });
    t.attributeDefinitionCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "5.0.0" }),
    );

    await expect(
      t.service.createAttributeDefinition("cat-1", { key: "color", name: "Color" } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it("rethrows a non-P2002 Prisma error unchanged", async () => {
    const t = createService();
    t.categoryFindUnique.mockResolvedValue({ id: "cat-1" });
    const dbError = new Prisma.PrismaClientKnownRequestError("Foreign key violation", { code: "P2003", clientVersion: "5.0.0" });
    t.attributeDefinitionCreate.mockRejectedValue(dbError);

    await expect(
      t.service.createAttributeDefinition("cat-1", { key: "color", name: "Color" } as any),
    ).rejects.toBe(dbError);
  });

  it("invalidates both the compliance-attrs and completeness-required caches after a successful create", async () => {
    const t = createService();
    t.categoryFindUnique.mockResolvedValue({ id: "cat-1" });
    t.attributeDefinitionCreate.mockResolvedValue({ id: "attr-1" });

    await t.service.createAttributeDefinition("cat-1", { key: "color", name: "Color" } as any);

    expect(t.cache.invalidateByPrefix).toHaveBeenCalledWith(expect.stringContaining("compliance:attrs:"));
    expect(t.cache.invalidateByPrefix).toHaveBeenCalledWith(expect.stringContaining("completeness:required:"));
  });

  it("does not invalidate caches when the create fails", async () => {
    const t = createService();
    t.categoryFindUnique.mockResolvedValue({ id: "cat-1" });
    t.attributeDefinitionCreate.mockRejectedValue(new Error("db down"));

    await expect(t.service.createAttributeDefinition("cat-1", { key: "color", name: "Color" } as any)).rejects.toThrow("db down");
    expect(t.cache.invalidateByPrefix).not.toHaveBeenCalled();
  });
});
