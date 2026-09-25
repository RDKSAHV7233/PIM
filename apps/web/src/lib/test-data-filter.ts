const TEST_PREFIXES = [
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
  // 2026-09 additions (F-011 root cause): this allowlist hadn't tracked this
  // project's own QA/E2E fixture naming since it was written — every pattern
  // below was found leaking through a checked "Hide test data" filter during
  // the 2026-09-19 production launch QA pass (see docs/qa/... for context).
  // Prefixes chosen to match the same specificity level as the entries
  // above: distinctive enough not to plausibly collide with a real
  // customer's product/category name. NOTE: a bare "e2e " prefix was tried
  // here first and reverted — it also matched this repo's own CI e2e-journey
  // fixture titles ("E2E Journey Product A/B/C ...", built by
  // apps/web/test/e2e/journey-bulk-import-to-mapping.spec.js), hiding a
  // journey test's just-imported products from its own catalog assertion.
  // Use the full observed fixture phrase instead of the bare "e2e " word.
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
  // Formula/CSV-injection security-test payloads (VEXA-QA-SEC-*): these
  // deliberately start with a leading =, +, @, or - so an exported CSV opens
  // as a live formula in Excel/Sheets if the injection isn't escaped. Match
  // the payload shapes actually used, not just anything starting with the
  // bare character (too collision-prone on its own).
  "@sum(",
  "=1+1",
  "+vexa-qa",
];

// F-004 (2026-09-25 follow-up): mirrors TEST_DATA_DESCRIPTION_MARKERS in
// apps/api/src/catalog/test-data-exclusion.ts — kept in sync by
// test-data-governance-patterns.test.cjs. A ~19,800-product bulk-import
// load-test batch used generated titles/brands designed to look like
// plausible real catalog entries ("EcoMotive Athletic Dry-Fit Tee Maroon
// VX0500001"), so no title/category prefix could catch it without risking a
// real customer collision — but every one of these products' own
// description self-declares "... for bulk import testing with realistic
// catalog attributes.", which is safe to substring-match since no real
// merchant would ever write that phrase into a product description.
const TEST_DESCRIPTION_MARKERS = ["for bulk import testing with realistic catalog attributes"];

export function isTestData(name: string): boolean {
  const value = name.trim().toLowerCase();
  if (TEST_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return true;
  }
  return TEST_DESCRIPTION_MARKERS.some((marker) => value.includes(marker));
}

interface TestDataShape {
  title?: string;
  name?: string;
  path?: string;
  description?: string;
  // The real identifying label on BulkImportJob/BulkImportRun — the uploaded
  // file name (e.g. "e2e-fixture.csv") — is carried in `sourceName`, not
  // `title`/`name`, which those API shapes don't have.
  sourceName?: string | null;
  categoryName?: string;
  categoryPath?: string;
  category?: {
    name?: string;
    path?: string;
  } | null;
}

function getCandidateLabels(item: TestDataShape): string[] {
  return [
    item.title,
    item.name,
    item.path,
    item.description,
    item.sourceName,
    item.categoryName,
    item.categoryPath,
    item.category?.name,
    item.category?.path,
  ]
    .map((value) => String(value ?? "").trim())
    .filter((value) => value.length > 0);
}

export function filterTestData<T extends TestDataShape>(
  items: T[],
  hide: boolean,
): T[] {
  if (!hide) {
    return items;
  }
  return items.filter((item) => {
    return !getCandidateLabels(item).some((label) => isTestData(label));
  });
}
