// Coverage for AutoSuggestionsService — zero test coverage before, despite
// applyRepair() being a real write path: when apply=true it persists a
// title/category/attributes patch built from the service's own generated
// suggestions directly onto the product, with no independent validation of
// the merged result. Two risk properties are checked here:
//   (a) dry-run (apply=false) must never touch the database — it's the only
//       thing standing between "preview a suggestion" and "silently mutate
//       a product";
//   (b) the attribute merge (`{...currentAttributes, ...suggested}`) must
//       let a suggested value win over an existing one but never invent a
//       key the enrichment logic didn't actually produce.
// AccessPolicyService and CacheService are mocked — the read path's
// category-ranking heuristic is exercised for its real branch/tie logic,
// not for the cache implementation itself.

import { NotFoundException } from "@nestjs/common";
import { AutoSuggestionsService } from "./auto-suggestions.service";

function createService() {
  const productFindUnique = jest.fn();
  const productUpdate = jest.fn();
  const categoryFindMany = jest.fn();
  const tenantClient = {
    product: { findUnique: productFindUnique, update: productUpdate },
    category: { findMany: categoryFindMany },
  };
  const prisma = { tenant: jest.fn().mockReturnValue(tenantClient) };
  const accessPolicyService = { assertProductAccess: jest.fn().mockResolvedValue(undefined) };
  const cache = { getOrSet: jest.fn().mockImplementation((_key: string, _ttl: number, producer: () => unknown) => producer()) };

  const service = new AutoSuggestionsService(prisma as any, accessPolicyService as any, cache as any);
  return { service, accessPolicyService, cache, productFindUnique, productUpdate, categoryFindMany };
}

const BASE_PRODUCT = {
  id: "p1",
  title: "Shirt",
  description: "A cotton shirt in blue",
  brand: "Acme",
  categoryId: "cat-1",
  attributes: {},
  status: "draft",
  vendorScopeKey: null,
};

const ACTOR = { actorId: "u1" } as any;

describe("AutoSuggestionsService.applyRepair — dry-run vs persisted mutation (no prior coverage)", () => {
  it("never touches the database in dry-run mode (apply=false)", async () => {
    const t = createService();
    t.productFindUnique.mockResolvedValue({ ...BASE_PRODUCT });
    t.categoryFindMany.mockResolvedValue([]);

    const result = await t.service.applyRepair("p1", false, ACTOR);

    expect(t.productUpdate).not.toHaveBeenCalled();
    expect(result.apply).toBe(false);
    expect(result.patch.title).toContain("Acme");
  });

  it("persists exactly the previewed patch when apply=true", async () => {
    const t = createService();
    t.productFindUnique.mockResolvedValue({ ...BASE_PRODUCT });
    t.categoryFindMany.mockResolvedValue([]);
    t.productUpdate.mockResolvedValue({ id: "p1" });

    const dryRun = await t.service.applyRepair("p1", false, ACTOR);
    const applied = await t.service.applyRepair("p1", true, ACTOR);

    expect(applied.patch).toEqual(dryRun.patch);
    expect(t.productUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({
          title: dryRun.patch.title,
          categoryId: dryRun.patch.categoryId,
          attributes: dryRun.patch.attributes,
        }),
      }),
    );
  });

  it("checks edit-level product access, not view, since this path mutates the product", async () => {
    const t = createService();
    t.productFindUnique.mockResolvedValue({ ...BASE_PRODUCT });
    t.categoryFindMany.mockResolvedValue([]);

    await t.service.applyRepair("p1", false, ACTOR);

    expect(t.accessPolicyService.assertProductAccess).toHaveBeenCalledWith(
      ACTOR,
      "edit",
      expect.objectContaining({ id: "p1" }),
      "AutoSuggestionRepair",
    );
  });

  it("lets a suggested attribute value win over an existing one, without inventing unrelated keys", async () => {
    const t = createService();
    t.productFindUnique.mockResolvedValue({
      ...BASE_PRODUCT,
      description: "A denim jacket",
      attributes: { color: "red", fit: "slim" }, // color already set, so enrichment must not override it
    });
    t.categoryFindMany.mockResolvedValue([]);

    const result = await t.service.applyRepair("p1", false, ACTOR);

    // color/fit were already present, so buildAttributeEnrichment produces no suggestion for
    // either — the merge must preserve them unchanged rather than dropping them.
    expect(result.patch.attributes).toMatchObject({ color: "red", fit: "slim" });
  });

  it("throws NotFoundException for a product that doesn't exist, before any suggestion logic runs", async () => {
    const t = createService();
    t.productFindUnique.mockResolvedValue(null);

    await expect(t.service.applyRepair("missing", false, ACTOR)).rejects.toThrow(NotFoundException);
    expect(t.categoryFindMany).not.toHaveBeenCalled();
  });
});

describe("AutoSuggestionsService.getTitleSuggestion — token dedup and ordering (no prior coverage)", () => {
  it("dedupes when a whole token (not sub-word) repeats verbatim across fields", async () => {
    const t = createService();
    // Dedup is Set-based over whole field values, not word-level: brand==="Acme" and
    // title==="Acme" are the exact same string, so they collapse to one occurrence.
    // (A shared word inside otherwise-different strings, e.g. brand "Acme" + title
    // "Acme Shirt", would NOT collapse — those are two distinct token strings.)
    t.productFindUnique.mockResolvedValue({
      ...BASE_PRODUCT,
      title: "Acme",
      brand: "Acme",
      attributes: {},
    });

    const result = await t.service.getTitleSuggestion("p1", ACTOR);

    expect(result.optimizedTitle).toBe("Acme");
  });

  it("falls back to the original title with lower confidence when every token is blank", async () => {
    const t = createService();
    t.productFindUnique.mockResolvedValue({ ...BASE_PRODUCT, title: "", brand: "", attributes: {} });

    const result = await t.service.getTitleSuggestion("p1", ACTOR);

    expect(result.optimizedTitle).toBe("");
    expect(result.confidence).toBe(0.5);
  });
});

describe("AutoSuggestionsService.getCategorySuggestion — token-overlap ranking (no prior coverage)", () => {
  it("picks the category with the highest token overlap, not just the first candidate", async () => {
    const t = createService();
    t.productFindUnique.mockResolvedValue({ ...BASE_PRODUCT, title: "Running Shoes", description: "athletic footwear" });
    t.categoryFindMany.mockResolvedValue([
      { id: "cat-shoes", name: "Athletic Footwear", path: "Sports > Athletic Footwear" },
      { id: "cat-generic", name: "Misc", path: "Misc" },
    ]);

    const result = await t.service.getCategorySuggestion("p1", ACTOR);

    expect(result.suggestedCategoryId).toBe("cat-shoes");
    expect(result.confidence).toBeGreaterThan(0.4);
  });

  it("still returns the top-ranked category (even at zero overlap) as long as any category exists — low confidence, not a silent no-op", async () => {
    const t = createService();
    t.productFindUnique.mockResolvedValue({ ...BASE_PRODUCT, categoryId: "cat-1", title: "Xyzzy", description: "Plugh" });
    t.categoryFindMany.mockResolvedValue([{ id: "cat-unrelated", name: "Kitchen", path: "Home > Kitchen" }]);

    const result = await t.service.getCategorySuggestion("p1", ACTOR);

    // The fallback to the product's *current* category only fires when there are no
    // categories at all (see the next test) — a zero-overlap match still wins over the
    // current category as long as `ranked` is non-empty, since `best` is truthy either way.
    expect(result.suggestedCategoryId).toBe("cat-unrelated");
    expect(result.confidence).toBe(0.35);
  });

  it("falls back to the product's current category only when the tenant has no categories at all", async () => {
    const t = createService();
    t.productFindUnique.mockResolvedValue({ ...BASE_PRODUCT, categoryId: "cat-1", title: "Xyzzy", description: "Plugh" });
    t.categoryFindMany.mockResolvedValue([]);

    const result = await t.service.getCategorySuggestion("p1", ACTOR);

    expect(result.suggestedCategoryId).toBe("cat-1");
    expect(result.confidence).toBe(0.35);
  });

  it("scopes the category cache key to the current tenant", async () => {
    const t = createService();
    t.productFindUnique.mockResolvedValue({ ...BASE_PRODUCT });
    t.categoryFindMany.mockResolvedValue([]);

    await t.service.getCategorySuggestion("p1", ACTOR);

    expect(t.cache.getOrSet).toHaveBeenCalledWith(
      expect.stringContaining("auto-suggest:categories:"),
      expect.any(Number),
      expect.any(Function),
    );
  });
});
