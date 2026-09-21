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

export function buildTestDataExclusionWhere(hideTestData: boolean): Prisma.ProductWhereInput | null {
  if (!hideTestData) {
    return null;
  }
  return {
    NOT: {
      OR: TEST_DATA_PREFIXES.flatMap((prefix) => [
        { title: { startsWith: prefix, mode: "insensitive" as const } },
        { category: { name: { startsWith: prefix, mode: "insensitive" as const } } },
      ]),
    },
  };
}
