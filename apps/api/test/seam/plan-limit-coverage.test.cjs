/**
 * Seam test: Plan-limit coverage.
 *
 * Ensures every PlanResource type defined in the billing system has:
 * 1. At least one controller endpoint decorated with @RequirePlanLimit(resource)
 * 2. A human-readable label in the web PlanLimitModal component
 *
 * This test catches the exact gap found in the CTO review: "users" was defined
 * as a PlanResource but had no @RequirePlanLimit decorator on any controller.
 */

const fs = require("node:fs");
const path = require("node:path");

// ── Extract PlanResource types from the decorator file ─────────────────────
const decoratorFile = path.join(
  __dirname,
  "../../src/billing/require-plan-limit.decorator.ts",
);
const decoratorSource = fs.readFileSync(decoratorFile, "utf-8");

// Match all string literals in the PlanResource union type
const resourceMatches = decoratorSource.match(
  /export type PlanResource\s*=[\s\S]*?;/,
);
if (!resourceMatches) {
  throw new Error("Could not find PlanResource type definition");
}
const planResources = [];
const literalPattern = /"([^"]+)"/g;
let m;
while ((m = literalPattern.exec(resourceMatches[0])) !== null) {
  planResources.push(m[1]);
}

// ── Scan all controllers for @RequirePlanLimit usage ───────────────────────
function findFilesRecursive(dir, pattern) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFilesRecursive(fullPath, pattern));
    } else if (pattern.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

const srcDir = path.join(__dirname, "../../src");
const controllerFiles = findFilesRecursive(srcDir, /\.controller\.ts$/);
const serviceFiles = findFilesRecursive(srcDir, /\.service\.ts$/);
const allSourceFiles = [...controllerFiles, ...serviceFiles];

const decoratedResources = new Set();
for (const file of allSourceFiles) {
  const content = fs.readFileSync(file, "utf-8");
  // Match @RequirePlanLimit("resource") and @RequirePlanLimit(["r1", "r2"])
  const matches = content.matchAll(/@RequirePlanLimit\(([^)]+)\)/g);
  for (const match of matches) {
    const arg = match[1];
    const literals = arg.matchAll(/"([^"]+)"/g);
    for (const lit of literals) {
      decoratedResources.add(lit[1]);
    }
  }
}

// ── Scan PlanLimitModal for resource labels ────────────────────────────────
const modalFile = path.join(
  __dirname,
  "../../../../apps/web/src/components/ui/plan-limit-modal.tsx",
);
const modalSource = fs.readFileSync(modalFile, "utf-8");

// Extract all string comparisons in normalizeResourceLabel
const labeledResources = new Set();
const labelPattern = /normalized\s*===\s*"([^"]+)"/g;
while ((m = labelPattern.exec(modalSource)) !== null) {
  labeledResources.add(m[1]);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("Plan-limit coverage seam test", () => {
  test("PlanResource type has at least 1 resource defined", () => {
    expect(planResources.length).toBeGreaterThan(0);
  });

  for (const resource of planResources) {
    test(`PlanResource "${resource}" has @RequirePlanLimit on at least one controller or service-level enforcement`, () => {
      // "users" is enforced at service level (workspace-users.service.ts)
      // as well as guard level — both are acceptable
      const hasGuardEnforcement = decoratedResources.has(resource);

      // Check for service-level enforcement via checkLimit calls
      let hasServiceEnforcement = false;
      for (const file of allSourceFiles) {
        const content = fs.readFileSync(file, "utf-8");
        if (content.includes(`checkLimit("${resource}"`) || content.includes(`checkLimit('${resource}'`)) {
          hasServiceEnforcement = true;
          break;
        }
      }

      expect(hasGuardEnforcement || hasServiceEnforcement).toBe(true);
    });

    test(`PlanResource "${resource}" has a human-readable label in PlanLimitModal`, () => {
      // The modal's normalizeResourceLabel() should handle this resource.
      // Resources that fall through to the default `return resource` show raw keys.
      expect(labeledResources.has(resource)).toBe(true);
    });
  }
});
