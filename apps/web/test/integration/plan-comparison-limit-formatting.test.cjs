#!/usr/bin/env node
/* eslint-disable no-console */
//
// Regression test for PIM#610: the Compare Plans card showed Starter's SKU and submission
// limits as "3K" when the backend seed/enforcement authority for that tier is 2,500 — a 20%
// overstatement of the real, enforced entitlement. Root cause: `formatLimit()` rounded any
// value >= 1,000 to the nearest thousand via `.toFixed(0)`, with no floor/ceiling bias, so any
// non-exact-multiple-of-1000 limit renders misleadingly. Every other seeded plan limit happens
// to land on an exact multiple of 1,000, which is why only Starter's SKUs/submissions (2,500)
// were ever visibly affected.
//
// Invariant (PIM#610): a customer-facing plan limit must display the exact entitlement that
// backend enforcement uses. Abbreviation to "K" is only permitted when it is mathematically
// exact — never a value that rounds away from the real number in either direction.
//
// This test extracts and executes the real `formatLimit` function out of the actual source file
// (via the TypeScript compiler, not a hand-reimplementation or a source-regex check), so it runs
// the exact logic that ships in the Compare Plans card.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PLAN_COMPARISON_FILE = path.join(
  REPO_ROOT, "apps", "web", "src", "app", "admin", "plan", "_components", "plan-comparison.tsx",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractFunction(source, fnName) {
  const startPattern = new RegExp(`(?:export )?function ${fnName}\\s*\\(`);
  const match = source.match(startPattern);
  assert(match, `Could not locate function ${fnName} in source.`);
  const startIndex = match.index;
  let depth = 0;
  let inBody = false;
  for (let i = startIndex; i < source.length; i++) {
    if (source[i] === "{") {
      depth++;
      inBody = true;
    } else if (source[i] === "}") {
      depth--;
      if (inBody && depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }
  throw new Error(`Could not find closing brace for ${fnName}.`);
}

/**
 * Loads the real `formatLimit` implementation out of the actual source file (not a
 * reimplementation) by transpiling just that function through the TypeScript compiler and
 * evaluating it, so the test exercises the exact logic that ships in the Compare Plans card.
 */
function loadRealFormatLimit() {
  const source = fs.readFileSync(PLAN_COMPARISON_FILE, "utf8");
  const fnSource = extractFunction(source, "formatLimit");
  const transpiled = ts.transpileModule(fnSource.replace(/^export /, ""), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const factory = new Function(`${transpiled}\nreturn formatLimit;`);
  return factory();
}

function run() {
  const formatLimit = loadRealFormatLimit();

  // The exact matrix from PIM#610: exact multiples of 1,000 may abbreviate to "K"; every other
  // value — including values immediately adjacent to a thousand boundary — must render its
  // precise, comma-grouped value. This is the core invariant: never round away from the real
  // enforced number, in either direction.
  const matrix = [
    [999, "999"],
    [1000, "1K"],
    [2000, "2K"],
    [2499, "2,499"],
    [2500, "2,500"], // the exact PIM#610 case: Starter's real seeded/enforced SKU and submission limit
    [2501, "2,501"],
    [3000, "3K"],
    [10000, "10K"],
    [100000, "100K"],
  ];
  for (const [input, expected] of matrix) {
    const actual = formatLimit(input);
    assert(
      actual === expected,
      `formatLimit(${input}) must render "${expected}" (the exact enforced value, or an exact-multiple abbreviation) — got "${actual}". ` +
        `Rendering anything else for a non-exact-multiple-of-1000 value misrepresents the real backend entitlement to a prospect.`,
    );
  }

  assert(formatLimit(100000, true) === "Unlimited", "The unlimited flag must still short-circuit to \"Unlimited\" regardless of the numeric value.");

  // Explicitly verify BOTH Starter fields that were reported as distorted are wired through
  // formatLimit with the real seeded value (2500), not a hand-rounded literal — so a future
  // refactor can't accidentally fix SKUs while leaving submissions distorted (or vice versa).
  const pageSource = fs.readFileSync(PLAN_COMPARISON_FILE, "utf8");
  assert(
    /formatLimit\(plan\.limits\.skus,\s*plan\.unlimited\.skus\)/.test(pageSource),
    "The SKUs row must render through formatLimit(plan.limits.skus, ...) — reading the live seeded value, not a hardcoded display string.",
  );
  assert(
    /formatLimit\(plan\.limits\.submissions,\s*plan\.unlimited\.submissions\)/.test(pageSource),
    "The Submissions row must render through formatLimit(plan.limits.submissions, ...) — reading the live seeded value, not a hardcoded display string.",
  );

  // Regression guard: React error #418 on /admin/plan, live on production. This file has
  // "use client" — its output gets hydrated, meaning the SSR pass and the browser's own
  // client-side render of the same markup must produce byte-identical text. A bare
  // .toLocaleString() (no locale argument) resolves the default locale from whatever
  // environment is running it — the Node SSR process on first render, the browser's own
  // locale on hydration — and those aren't guaranteed to agree. This is exactly what fired:
  // the server and the browser disagreed on how to group Starter's "2,500", React detected
  // the mismatch, and threw. The fix is a pinned, explicit locale argument, not a correct
  // *result* — a test asserting the OUTPUT string would pass by coincidence on any single
  // machine where server and client locale happen to match. Assert the call shape instead.
  assert(
    /plan-comparison\.tsx$/.test(PLAN_COMPARISON_FILE) && /"use client"/.test(pageSource),
    "This file must stay a client component for the hydration-mismatch class of bug this test guards against to be meaningful at all — if it's ever converted to a server component, this assertion (and the bug it guards) no longer apply.",
  );
  assert(
    !/\.toLocaleString\(\s*\)/.test(pageSource),
    "toLocaleString() must never be called with no arguments in this client component — the default locale is resolved from the runtime environment (SSR server vs. browser), which can differ and produce a hydration mismatch (React error #418, reproduced live on /admin/plan). Pass an explicit locale.",
  );
  assert(
    /\.toLocaleString\(\s*"en-IN"\s*\)/.test(pageSource),
    "formatLimit's toLocaleString() call must pin an explicit locale (\"en-IN\", matching the rest of this codebase's date-formatting convention) so the server-rendered value and the client's hydration pass always agree.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "format_limit_never_rounds_non_exact_multiples",
          "format_limit_abbreviates_only_exact_multiples_of_1000",
          "format_limit_unlimited_flag_still_works",
          "skus_row_wired_through_format_limit",
          "submissions_row_wired_through_format_limit",
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
} catch (error) {
  console.error("Plan comparison limit-formatting test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
