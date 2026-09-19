/* eslint-disable no-console */
// Regression test for production QA finding: the "Hide test data" toggle on
// /operations/imports visibly changed its own label and URL query param but had
// zero effect on the displayed job list, run list, or category dropdown.
//
// Root cause (traced in apps/web/src/app/operations/imports/page.tsx and
// apps/web/src/lib/test-data-filter.ts):
//   1. filterTestData() was applied to jobs but never to runs (`largeRuns` was
//      just an unfiltered alias for `runs`) or to the category dropdown list.
//   2. Even where filterTestData() *was* applied, its label-matching read
//      `item.title`/`item.name`/`item.category?.name` — fields BulkImportJob and
//      BulkImportRun don't have. The real identifying field is `sourceName`
//      (the uploaded file name), which getCandidateLabels() never checked.
//   3. The TEST_PREFIXES list didn't include a pattern matching the actual
//      category names the E2E suite creates in production ("E2E Test Category
//      Renamed 1786014444049-5356", etc.) — only "e2e-" (with a hyphen), which
//      doesn't match "e2e test category ..." (space-separated).
//
// This test imports the real, unmodified isTestData()/filterTestData() from
// test-data-filter.ts and asserts against the exact shapes/values observed in
// production, rather than hand-waving a synthetic shape that happens to pass.
import { isTestData, filterTestData } from "../../src/lib/test-data-filter";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function run(): void {
  // (3) The exact category-naming pattern observed in production.
  assert(
    isTestData("E2E Test Category Renamed 1786014444049-5356"),
    "isTestData() must recognize the real 'E2E Test Category Renamed <epoch>-<n>' pattern used by the E2E suite in production",
  );
  assert(
    isTestData("E2E Test Category 1786220467550-3751"),
    "isTestData() must recognize the real 'E2E Test Category <epoch>-<n>' pattern (no 'Renamed') used by the E2E suite in production",
  );
  assert(
    !isTestData("T-Shirt"),
    "isTestData() must not flag a genuine customer category as test data",
  );

  // (2) BulkImportJob/BulkImportRun's real identifying field is `sourceName`,
  // not `title`/`name`. The API only ever populates `category: { id, path }` —
  // never `category.name` — so a fixture relying on category.name would pass
  // for the wrong reason; this uses only fields the real API types carry.
  const jobs = [
    { id: "job-real", sourceName: "spring-catalog-2026.csv", status: "completed" },
    { id: "job-test", sourceName: "e2e-fixture-run-88.csv", status: "needs_attention" },
  ];
  const filteredJobs = filterTestData(jobs, true);
  assert(
    filteredJobs.length === 1 && filteredJobs[0].id === "job-real",
    `filterTestData(jobs, true) must drop the job whose sourceName matches a test prefix and keep the real one. Got: ${JSON.stringify(filteredJobs)}`,
  );
  const unfilteredJobs = filterTestData(jobs, false);
  assert(
    unfilteredJobs.length === 2,
    "filterTestData(jobs, false) must return every job unfiltered (hide=false is a no-op)",
  );

  // (1) Runs use the identical shape/field as jobs and must be filterable the
  // same way — this is what page.tsx now applies to `largeRuns`.
  const runs = [
    { id: "run-real", sourceName: "vendor-export.csv", status: "completed" },
    { id: "run-test", sourceName: "qa flow smoke-1.csv", status: "preflight_blocked" },
  ];
  const filteredRuns = filterTestData(runs, true);
  assert(
    filteredRuns.length === 1 && filteredRuns[0].id === "run-real",
    `filterTestData(runs, true) must drop the run whose sourceName matches a test prefix. Got: ${JSON.stringify(filteredRuns)}`,
  );

  // (1) The category dropdown list — Category has top-level `name`/`path`,
  // both already covered by getCandidateLabels(), but this asserts the real
  // production-observed name specifically, not a synthetic stand-in.
  const categories = [
    { id: "cat-real", name: "T-Shirt", path: "T-Shirt" },
    { id: "cat-test", name: "E2E Test Category Renamed 1786014444049-5356", path: "E2E Test Category Renamed 1786014444049-5356" },
  ];
  const filteredCategories = filterTestData(categories, true);
  assert(
    filteredCategories.length === 1 && filteredCategories[0].id === "cat-real",
    `filterTestData(categories, true) must drop the E2E-generated category and keep the real one. Got: ${JSON.stringify(filteredCategories)}`,
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "e2e_test_category_prefix_recognized",
          "jobs_filtered_by_sourceName_not_missing_title_field",
          "runs_now_filterable_same_as_jobs",
          "categories_filterable_for_the_import_form_dropdown",
          "hide_false_is_a_true_no_op",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error: unknown) {
  console.error("test-data-filter hide-toggle regression test failed:");
  if (error instanceof Error) {
    console.error(`${error.name}: ${error.message}`);
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
}
