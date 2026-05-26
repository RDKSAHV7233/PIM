/* eslint-disable no-console */
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const rbacGuardPath = path.join(root, "apps", "api", "dist", "common", "rbac", "rbac.guard.js");
const publicDecoratorPath = path.join(root, "apps", "api", "dist", "auth", "public.decorator.js");
const apiEntryPath = path.join(root, "apps", "api", "dist", "main.js");

try {
  const rbacGuard = require(rbacGuardPath);
  if (typeof rbacGuard.Public !== "function") {
    const publicDecorator = require(publicDecoratorPath);
    if (typeof publicDecorator.Public === "function") {
      rbacGuard.Public = publicDecorator.Public;
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
}

require(apiEntryPath);
