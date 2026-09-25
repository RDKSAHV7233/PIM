import { Prisma } from "@prisma/client";

/**
 * Mirrors TEST_PREFIXES in apps/web/src/lib/test-data-filter.ts exactly — kept in sync by
 * apps/web/test/integration/test-data-governance-patterns.test.cjs (F-004: the web "Hide test
 * data" checkbox only ever filtered the current page's rows client-side; the search endpoint's
 * own pagination/totalCount was always computed over the full, unfiltered catalog, so most pages
 * showed nothing once you'd actually filtered out the ~99.6% that's QA/E2E fixture data). This
 * list makes the exclusion happen in the query itself, so totalCount and pagination are correct.
 */
export const TEST_DATA_PREFIXES = [
  "phase2 ",
  "phase3 ",
  "phase4 ",
  "phase5 ",
  "phase6 ",
  "phase7 ",
  "phase8 ",
  "smoke ",
  "rbac ",
  "concurrency ",
  "audit ",
  "benchmark",
  "metrics ",
  "reject score ",
  "media smoke ",
  "ondc smoke ",
  "ai smoke ",
  "pilot ",
  "template ",
  "version ",
  "xlsx ",
  "e2e-",
  "e2e test category",
  "qa flow ",
  "pim1 qa flow ",
  "ui-reality-",
  "manual cat ",
  "e2e editor role product",
  "vexa-qa",
  "vexa qa",
  "vexaqa",
  "e2ebrand",
  "qa-retest-",
  "qa retest ",
  "qa-stage-",
  "stageqa",
  "qapilot",
  "qa-e2e-",
  "res-02 ",
  "pim594-",
  "pim594 ",
  "@sum(",
  "=1+1",
  "+vexa-qa",
];

/**
 * F-004 (2026-09-25 follow-up): the title/category prefix list above missed an entire
 * ~19,800-product bulk-import load-test batch because these products' titles/brands were
 * deliberately generated to look like plausible real catalog entries (e.g. "EcoMotive Athletic
 * Dry-Fit Tee Maroon VX0500001", "FreshNest Polo Collar T-Shirt Black VX0100001") — no prefix
 * would catch these without risking real customer collisions. But every one of these products'
 * own DESCRIPTION field self-declares its purpose verbatim: "... for bulk import testing with
 * realistic catalog attributes." Confirmed live on both 10,000-row bulk-import batches
 * (bulkRunId a0eab803, 273bc046) and on VX0109940/VX0109897 (the earlier smaller QA fixture
 * batch reused for connector publish/edit-republish testing) — no real merchant would ever write
 * this phrase into a product description, so this is a safe substring match unlike a prefix.
 */
export const TEST_DATA_DESCRIPTION_MARKERS = ["for bulk import testing with realistic catalog attributes"];

export function buildTestDataExclusionWhere(hideTestData: boolean): Prisma.ProductWhereInput | null {
  if (!hideTestData) {
    return null;
  }
  return {
    NOT: {
      OR: [
        ...TEST_DATA_PREFIXES.flatMap((prefix) => [
          { title: { startsWith: prefix, mode: "insensitive" as const } },
          { category: { name: { startsWith: prefix, mode: "insensitive" as const } } },
        ]),
        ...TEST_DATA_DESCRIPTION_MARKERS.map((marker) => ({
          description: { contains: marker, mode: "insensitive" as const },
        })),
      ],
    },
  };
}
