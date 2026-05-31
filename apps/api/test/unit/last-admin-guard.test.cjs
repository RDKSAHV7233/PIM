#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Set J: Verify LAST_ADMIN_GUARD is present and correctly structured in
 * workspace-users.service.ts. Static analysis — no runtime needed.
 */
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.resolve(__dirname, "../../src/workspace-users/workspace-users.service.ts"),
  "utf8",
);

const checks = [
  // Guard must exist
  { pattern: "LAST_ADMIN_GUARD", desc: "LAST_ADMIN_GUARD error code present" },
  // Must count only active admins
  { pattern: 'role: "admin", isActive: true', desc: "admin-count query scoped to active admins" },
  // Must compare count <= 1 (not just === 0)
  { pattern: "activeAdminCount <= 1", desc: "throws when count <= 1 (not === 0)" },
  // Must guard only admin-role targets
  { pattern: 'existing.role === "admin"', desc: "guard only runs for admin-role target" },
  // CANNOT_DEACTIVATE_SELF must still be present (guard added, not replaced)
  { pattern: "CANNOT_DEACTIVATE_SELF", desc: "self-deactivation guard still present" },
];

let passed = 0;
let failed = 0;

for (const { pattern, desc } of checks) {
  if (source.includes(pattern)) {
    console.log(`  ✓ ${desc}`);
    passed++;
  } else {
    console.error(`  ✗ MISSING: ${desc}  (pattern: ${pattern})`);
    failed++;
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
