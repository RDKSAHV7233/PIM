import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "..", "..");
const ALLOWED_FILES = new Set([
  path.resolve(SRC_ROOT, "common", "tenant", "tenant-raw.ts"),
]);

const GRANDFATHERED_FILES = new Set<string>([]);

const UNSAFE_PATTERN = /\.\$(?:queryRawUnsafe|executeRawUnsafe)\s*[<(]/;

function collectSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__mocks__") continue;
      files.push(...collectSourceFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") && !entry.name.endsWith(".d.ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("tenant-raw usage guard", () => {
  it("should not have queryRawUnsafe/executeRawUnsafe outside tenant-raw.ts and grandfathered files", () => {
    const violations: string[] = [];
    const files = collectSourceFiles(SRC_ROOT);

    for (const file of files) {
      if (ALLOWED_FILES.has(file)) continue;
      if (GRANDFATHERED_FILES.has(file)) continue;
      if (file.endsWith(".spec.ts")) continue;

      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;
        if (UNSAFE_PATTERN.test(line)) {
          const relative = path.relative(SRC_ROOT, file);
          violations.push(`${relative}:${i + 1}: ${line.trim().slice(0, 120)}`);
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Found ${violations.length} direct queryRawUnsafe/executeRawUnsafe call(s) outside tenant-raw.ts.\n` +
        `Use tenantRaw() or tenantExecRaw() from common/tenant/tenant-raw.ts instead.\n\n` +
        violations.join("\n"),
      );
    }
  });

  it("should list grandfathered files that still need migration", () => {
    const remaining: string[] = [];
    for (const file of GRANDFATHERED_FILES) {
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, "utf-8");
      const count = (content.match(UNSAFE_PATTERN) || []).length;
      if (count > 0) {
        remaining.push(`${path.relative(SRC_ROOT, file)}: ${count} call(s)`);
      }
    }
    if (remaining.length > 0) {
      console.warn(`Grandfathered files still needing tenantRaw migration:\n${remaining.join("\n")}`);
    }
  });
});
