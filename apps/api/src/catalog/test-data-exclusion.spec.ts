import {
  buildTestDataExclusionWhere,
  TEST_DATA_DESCRIPTION_MARKERS,
  TEST_DATA_PREFIXES,
} from "./test-data-exclusion";

describe("buildTestDataExclusionWhere", () => {
  it("returns null when hideTestData is false — no query cost when the filter is off", () => {
    expect(buildTestDataExclusionWhere(false)).toBeNull();
  });

  it("returns a NOT/OR clause covering every known prefix, on both title and category.name, plus description markers", () => {
    const where = buildTestDataExclusionWhere(true);
    expect(where).not.toBeNull();
    const or = (where as { NOT: { OR: unknown[] } }).NOT.OR;
    expect(or).toHaveLength(TEST_DATA_PREFIXES.length * 2 + TEST_DATA_DESCRIPTION_MARKERS.length);
    expect(or).toContainEqual({ title: { startsWith: "vexa-qa", mode: "insensitive" } });
    expect(or).toContainEqual({ category: { name: { startsWith: "vexa-qa", mode: "insensitive" } } });
  });

  it("does not include a bare 'e2e ' prefix — would swallow this repo's own e2e-journey fixtures", () => {
    const where = buildTestDataExclusionWhere(true);
    const or = (where as { NOT: { OR: Array<{ title?: { startsWith: string } }> } }).NOT.OR;
    const titlePrefixes = or.map((clause) => clause.title?.startsWith).filter(Boolean);
    expect(titlePrefixes).not.toContain("e2e ");
    expect(titlePrefixes).toContain("e2e editor role product");
  });

  it("excludes products via a description substring marker — catches bulk-import load-test batches whose titles/brands look real", () => {
    const where = buildTestDataExclusionWhere(true);
    const or = (where as { NOT: { OR: Array<{ description?: { contains: string; mode: string } }> } }).NOT.OR;
    expect(or).toContainEqual({
      description: { contains: "for bulk import testing with realistic catalog attributes", mode: "insensitive" },
    });
  });
});
