import { applyProductSoftDeleteScope, withSoftDeleteBypass, SOFT_DELETE_BYPASS_ARG } from "./prisma-soft-delete.middleware";

// This is the actual filter-injection logic behind every Product read in the
// app — wired into the tenant-scope Prisma extension (tenant-scope.ts) to
// silently exclude soft-deleted rows. A bug here has two distinct failure
// directions with opposite consequences: too weak, and deleted products leak
// back into normal reads; too strong (or wrong on the wrong operation type),
// and active products get silently hidden. Only ever exercised indirectly —
// taxonomy.service.spec.ts mentions withSoftDeleteBypass() in a comment, but
// nothing calls this function or asserts on its output shape. Zero real
// coverage before this.
describe("applyProductSoftDeleteScope", () => {
  it("passes non-Product models through completely unchanged", () => {
    const result = applyProductSoftDeleteScope("Category", "findMany", { where: { id: "x" } });
    expect(result).toEqual({ where: { id: "x" } });
  });

  describe("filter operations (findMany, findFirst, count, aggregate, groupBy)", () => {
    const FILTER_OPS = ["findMany", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy"];

    for (const op of FILTER_OPS) {
      it(`${op}: merges deletedAt: null into an existing where via AND, preserving the original filter`, () => {
        const result = applyProductSoftDeleteScope("Product", op, { where: { tenantKey: "acme", status: "approved" } });
        expect(result.where).toEqual({
          AND: [{ tenantKey: "acme", status: "approved" }, { deletedAt: null }],
        });
      });

      it(`${op}: injects a bare deletedAt: null when no where clause is present at all`, () => {
        const result = applyProductSoftDeleteScope("Product", op, {});
        expect(result.where).toEqual({ deletedAt: null });
      });
    }
  });

  describe("unique-lookup operations (findUnique)", () => {
    const UNIQUE_OPS = ["findUnique", "findUniqueOrThrow"];

    for (const op of UNIQUE_OPS) {
      it(`${op}: spreads deletedAt: null directly into where, NOT wrapped in AND (unique where must stay a flat unique-key shape)`, () => {
        const result = applyProductSoftDeleteScope("Product", op, { where: { id: "prod-1" } });
        expect(result.where).toEqual({ id: "prod-1", deletedAt: null });
        // Specifically not the filter-operation AND shape:
        expect(result.where).not.toHaveProperty("AND");
      });
    }
  });

  describe("write and other unlisted operations", () => {
    for (const op of ["create", "update", "delete", "upsert", "updateMany", "deleteMany"]) {
      it(`${op}: where clause is left completely untouched — soft-delete filtering only applies to reads`, () => {
        const originalWhere = { id: "prod-1" };
        const result = applyProductSoftDeleteScope("Product", op, { where: originalWhere, data: { title: "x" } });
        expect(result.where).toBe(originalWhere);
        expect(result.data).toEqual({ title: "x" });
      });
    }
  });

  describe("withSoftDeleteBypass()", () => {
    it("suppresses the soft-delete filter entirely for a filter operation", () => {
      const args = withSoftDeleteBypass({ where: { tenantKey: "acme" } });
      const result = applyProductSoftDeleteScope("Product", "findMany", args);
      expect(result.where).toEqual({ tenantKey: "acme" });
      expect(result.where).not.toHaveProperty("AND");
    });

    it("suppresses the soft-delete filter for a unique-lookup operation too", () => {
      const args = withSoftDeleteBypass({ where: { id: "prod-1" } });
      const result = applyProductSoftDeleteScope("Product", "findUnique", args);
      expect(result.where).toEqual({ id: "prod-1" });
    });

    it("strips the internal bypass marker from the args passed through to Prisma — it must never reach the real client", () => {
      const args = withSoftDeleteBypass({ where: { id: "prod-1" } });
      expect(args).toHaveProperty(SOFT_DELETE_BYPASS_ARG, true);
      const result = applyProductSoftDeleteScope("Product", "findUnique", args);
      expect(result).not.toHaveProperty(SOFT_DELETE_BYPASS_ARG);
    });

    it("a non-Product model is returned via the early model-check return, before the marker would be stripped", () => {
      // Documents actual behavior, not an assumption: the `model !== PRODUCT_MODEL`
      // check returns `args` as-is BEFORE the strip logic runs, so the bypass
      // marker — if ever present — would pass through unstripped for a non-Product
      // model. Not a live bug (no real caller calls withSoftDeleteBypass() for a
      // model without soft-delete), but worth pinning down precisely rather than
      // assuming the stripping is unconditional.
      const args = withSoftDeleteBypass({ where: { id: "cat-1" } });
      const result = applyProductSoftDeleteScope("Category", "findMany", args);
      expect(result).toHaveProperty(SOFT_DELETE_BYPASS_ARG, true);
    });
  });
});
