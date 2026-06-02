/**
 * Seam test: RBAC matrix parity.
 *
 * Parses all @Roles() decorators from API controllers and compares them
 * against the committed truth file at docs/test-plan/rbac-matrix.json.
 *
 * If a developer adds or removes a role from a @Roles() decorator but
 * doesn't update rbac-matrix.json, this test fails with a clear diff.
 * This forces conscious acknowledgment of RBAC changes.
 */

const fs = require("node:fs");
const path = require("node:path");

// ── Load committed RBAC matrix ────────────────────────────────────────────
const matrixPath = path.join(
  __dirname,
  "../../../../docs/test-plan/rbac-matrix.json",
);

// ── Scan controllers for @Roles() decorators ──────────────────────────────
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

function extractRolesFromFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const relativePath = path.relative(srcDir, filePath).replace(/\\/g, "/");
  const entries = [];

  // Match @Roles(...) — handles both explicit roles and ...APP_ROLES spread
  const rolesPattern = /@Roles\(([^)]+)\)/g;
  let match;
  while ((match = rolesPattern.exec(content)) !== null) {
    const arg = match[1].trim();
    const roles = [];

    if (arg.includes("...APP_ROLES") || arg === "...APP_ROLES") {
      roles.push(
        "admin", "editor", "publisher", "approver",
        "channel_manager", "connector_admin", "reviewer", "viewer",
      );
    } else {
      const literals = arg.matchAll(/"([^"]+)"/g);
      for (const lit of literals) {
        roles.push(lit[1]);
      }
    }

    if (roles.length > 0) {
      entries.push({ file: relativePath, roles: roles.sort() });
    }
  }

  return entries;
}

// Build a map of all unique role combinations found in controllers
const codeRoleSets = new Map();
for (const file of controllerFiles) {
  const entries = extractRolesFromFile(file);
  for (const entry of entries) {
    const key = entry.roles.join(",");
    if (!codeRoleSets.has(key)) {
      codeRoleSets.set(key, []);
    }
    codeRoleSets.get(key).push(entry.file);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("RBAC matrix parity seam test", () => {
  test("rbac-matrix.json exists", () => {
    expect(fs.existsSync(matrixPath)).toBe(true);
  });

  test("rbac-matrix.json has surfaces defined", () => {
    const matrix = JSON.parse(fs.readFileSync(matrixPath, "utf-8"));
    expect(Object.keys(matrix.surfaces).length).toBeGreaterThan(0);
  });

  test("all roles in rbac-matrix.json are valid APP_ROLES", () => {
    const validRoles = new Set([
      "admin", "editor", "publisher", "approver",
      "channel_manager", "connector_admin", "reviewer", "viewer",
    ]);
    const matrix = JSON.parse(fs.readFileSync(matrixPath, "utf-8"));
    for (const [surface, config] of Object.entries(matrix.surfaces)) {
      for (const role of config.roles) {
        expect(validRoles.has(role)).toBe(true);
      }
    }
  });

  test("every unique @Roles() combination in code is represented in the matrix", () => {
    const matrix = JSON.parse(fs.readFileSync(matrixPath, "utf-8"));

    // Build set of all role combinations documented in the matrix
    const matrixRoleSets = new Set();
    for (const config of Object.values(matrix.surfaces)) {
      matrixRoleSets.add([...config.roles].sort().join(","));
    }

    // Check every code combination is documented
    const undocumented = [];
    for (const [roleSet, files] of codeRoleSets.entries()) {
      if (!matrixRoleSets.has(roleSet)) {
        undocumented.push({ roles: roleSet, files: files.slice(0, 3) });
      }
    }

    if (undocumented.length > 0) {
      const msg = undocumented
        .map((u) => `  Roles [${u.roles}] in ${u.files.join(", ")}`)
        .join("\n");
      expect(undocumented).toEqual(
        [],
        `Undocumented @Roles() combinations found in controllers.\n` +
          `Update docs/test-plan/rbac-matrix.json to include:\n${msg}`,
      );
    }
  });

  test("@Roles() decorators found in at least 10 controller files", () => {
    // Sanity check: if the parser finds fewer than 10 files, something is wrong
    const filesWithRoles = new Set();
    for (const files of codeRoleSets.values()) {
      for (const f of files) filesWithRoles.add(f);
    }
    expect(filesWithRoles.size).toBeGreaterThanOrEqual(10);
  });
});
