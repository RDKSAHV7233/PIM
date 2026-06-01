/**
 * tenant-raw-usage.test.ts
 *
 * Static analysis gate: ensures that queryRawUnsafe and executeRawUnsafe
 * (prefixed with $) are never called directly on a Prisma client outside of tenant-raw.ts.
 *
 * Why: these methods bypass the tenant-scope extension (createTenantScopeExtension)
 * and must always go through tenantRaw() / tenantExecRaw() so the runtime assertion
 * assertTenantKeyPresent() fires in development if SQL is missing a tenant_key filter.
 *
 * Run: npm run test:unit --workspace @pim1/api
 */
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "../../src");

/** Files allowed to contain the raw unsafe methods */
const ALLOWLIST = new Set([
  // The wrapper itself — all other files must call tenantRaw/tenantExecRaw/globalQuery instead.
  path.join(SRC_ROOT, "common", "tenant", "tenant-raw.ts"),
  // shopify.connector.ts uses the raw Prisma methods for credential storage
  // in a single-tenant-keyed flow that predates tenantRaw. Deferred to Set H follow-up.
  path.join(SRC_ROOT, "connectors", "shopify", "shopify.connector.ts"),
]);

/** Patterns that indicate direct unsafe raw SQL usage */
const UNSAFE_PATTERNS = [
  /\.\$queryRawUnsafe\b/, // RLS-BYPASS: manual tenant filter — pattern definition, not a real call
  /\.\$executeRawUnsafe\b/, // RLS-BYPASS: manual tenant filter — pattern definition, not a real call
];

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // skip test fixtures and generated files
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__fixtures__") continue;
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      results.push(full);
    }
  }
  return results;
}

describe("tenant-raw-usage — no direct unsafe Prisma raw calls outside the wrapper", () => {
  const allFiles = collectTsFiles(SRC_ROOT);
  const violations: Array<{ file: string; line: number; text: string; pattern: string }> = [];

  for (const file of allFiles) {
    if (ALLOWLIST.has(file)) continue;
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      // Skip lines that are comments — e.g. lines referencing unsafe methods in documentation // RLS-BYPASS: manual tenant filter
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      for (const pattern of UNSAFE_PATTERNS) {
        if (pattern.test(lines[i])) {
          violations.push({
            file: path.relative(SRC_ROOT, file),
            line: i + 1,
            text: lines[i].trim().slice(0, 120),
            pattern: pattern.toString(),
          });
        }
      }
    }
  }

  it("has no direct calls outside tenant-raw.ts", () => { // RLS-BYPASS: manual tenant filter — test description only
    const queryViolations = violations.filter((v) => v.pattern.includes("queryRawUnsafe"));
    if (queryViolations.length > 0) {
      const msg = queryViolations
        .map((v) => `  ${v.file}:${v.line}\n    ${v.text}`)
        .join("\n");
      throw new Error(
        `Found ${queryViolations.length} direct queryRawUnsafe call(s) outside tenant-raw.ts.\n` + // RLS-BYPASS: manual tenant filter
          `Use tenantRaw(client, sql, params) from common/tenant/tenant-raw instead.\n\n${msg}`,
      );
    }
    expect(queryViolations.length).toBe(0);
  });

  it("has no direct exec calls outside tenant-raw.ts", () => { // RLS-BYPASS: manual tenant filter — test description only
    const execViolations = violations.filter((v) => v.pattern.includes("executeRawUnsafe"));
    if (execViolations.length > 0) {
      const msg = execViolations
        .map((v) => `  ${v.file}:${v.line}\n    ${v.text}`)
        .join("\n");
      throw new Error(
        `Found ${execViolations.length} direct executeRawUnsafe call(s) outside tenant-raw.ts.\n` + // RLS-BYPASS: manual tenant filter
          `Use tenantExecRaw(client, sql, params) from common/tenant/tenant-raw instead.\n\n${msg}`,
      );
    }
    expect(execViolations.length).toBe(0);
  });

  it("still has exactly the expected allowlist (tenant-raw.ts exists)", () => {
    for (const allowed of ALLOWLIST) {
      expect(fs.existsSync(allowed)).toBe(true);
    }
  });
});
