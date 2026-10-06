import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Static guards for the 5.1c-2 migrations (ADR-0015 sections 8 and 9). The behavioral proof needs a database and
 * lives in scripts/connector-entitlement-schema-proof.cjs; this spec runs everywhere and pins what must not drift:
 * the migrations are additive, the entitlement table keeps its access and audit guards, the provider-verification
 * columns refuse TOKEN_ONLY, Prisma mirrors the SQL, and nothing reads or writes any of it yet.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const MIGRATIONS = path.join(REPO_ROOT, "packages", "db", "prisma", "migrations");
const ENTITLEMENTS = "20261006100000_connector_tenant_entitlements";
const VERIFICATION = "20261006100100_connector_installation_provider_verification";

const read = (relative: string) => fs.readFileSync(path.join(REPO_ROOT, relative), "utf8").replace(/\r\n/g, "\n");
const migration = (name: string) => read(`packages/db/prisma/migrations/${name}/migration.sql`);
const stripSqlComments = (sql: string) => sql.replace(/^\s*--.*$/gm, "");

describe("5.1c-2 migrations", () => {
  const entitlements = stripSqlComments(migration(ENTITLEMENTS));
  const verification = stripSqlComments(migration(VERIFICATION));

  it("sort after every earlier migration, entitlements before verification", () => {
    const names = fs.readdirSync(MIGRATIONS).filter((entry) => /^\d{14}_/.test(entry)).sort();
    expect(names.indexOf(ENTITLEMENTS)).toBeGreaterThan(0);
    expect(names.indexOf(VERIFICATION)).toBe(names.indexOf(ENTITLEMENTS) + 1);
    expect(names.slice(-2)).toEqual([ENTITLEMENTS, VERIFICATION]);
  });

  describe("connector_tenant_entitlements", () => {
    it("is additive: it creates its own objects and alters nothing else", () => {
      const alters = [...entitlements.matchAll(/ALTER TABLE\s+"?([a-z_]+)"?/gi)].map((match) => match[1]);
      expect([...new Set(alters)]).toEqual(["connector_tenant_entitlements"]);
      const drops = [...entitlements.matchAll(/\bDROP\s+(\w+)/gi)].map((match) => match[1]!.toUpperCase());
      expect(drops).toEqual(["TRIGGER"]); // DROP TRIGGER IF EXISTS, for idempotent re-creation only
      expect(entitlements).not.toMatch(/\bTRUNCATE\b|\bRENAME\b|\bDELETE\s+FROM\b/i);
    });

    it("keeps the checks that make a grant attributable and well-formed", () => {
      for (const constraint of [
        "stage_check",
        "slug_check",
        "tenant_check",
        "attribution_check",
        "window_check",
        "opt_in_pair_check",
        "early_access_opt_in_check",
        "revocation_check",
      ]) {
        expect(entitlements).toContain(`connector_tenant_entitlements_${constraint}`);
      }
      expect(entitlements).toMatch(/"release_stage" IN \('controlled_pilot', 'early_access'\)/);
      expect(entitlements).not.toMatch(/IN \([^)]*'live'/);
    });

    it("allows one live grant per tenant, connector and stage (a partial unique index)", () => {
      expect(entitlements).toMatch(
        /CREATE UNIQUE INDEX IF NOT EXISTS "connector_tenant_entitlements_live_grant_unique"[\s\S]*?\("tenant_key", "connector_slug", "release_stage"\)\s+WHERE "revoked_at" IS NULL/,
      );
    });

    it("is append-and-revoke only: a trigger rejects deletes and any edit other than revocation", () => {
      expect(entitlements).toMatch(/BEFORE UPDATE OR DELETE ON "connector_tenant_entitlements"/);
      expect(entitlements).toContain("cannot be deleted; revoke the grant instead");
      expect(entitlements).toContain("cannot be edited, only revoked");
      expect(entitlements).toContain("a revoked grant is final");
      // every column other than the three revocation columns is compared in the guard
      for (const column of [
        "id", "tenant_key", "connector_slug", "release_stage", "valid_from", "valid_until", "approved_by", "approved_at",
        "reason", "source", "tenant_opted_in_at", "tenant_opted_in_by", "created_at",
      ]) {
        expect(entitlements).toContain(`NEW.${column} IS DISTINCT FROM OLD.${column}`);
      }
      for (const revocation of ["revoked_at", "revoked_by", "revoke_reason"]) {
        expect(entitlements).not.toContain(`NEW.${revocation} IS DISTINCT FROM OLD.${revocation}`);
      }
    });

    it("is row-level-secured and forced, with a tenant SELECT policy and no write policy", () => {
      expect(entitlements).toContain('ALTER TABLE "connector_tenant_entitlements" ENABLE ROW LEVEL SECURITY');
      expect(entitlements).toContain('ALTER TABLE "connector_tenant_entitlements" FORCE ROW LEVEL SECURITY');
      const policies = [...entitlements.matchAll(/CREATE POLICY\s+(\w+)\s+ON\s+"connector_tenant_entitlements"\s+FOR\s+(\w+)/g)].map((match) => `${match[1]}:${match[2]}`);
      expect(policies).toEqual(["tenant_read_connector_tenant_entitlements:SELECT"]);
      expect(entitlements).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE|ALL)\b/);
      expect(entitlements).toMatch(/"tenant_key" = %s/);
    });

    it("does not default tenant_key to the session tenant: a grant names its tenant explicitly", () => {
      expect(entitlements).toMatch(/"tenant_key" TEXT NOT NULL,/);
    });
  });

  describe("connector_installations provider verification", () => {
    it("is additive: three nullable columns and two constraints, nothing dropped or renamed", () => {
      const columns = [...verification.matchAll(/ADD COLUMN IF NOT EXISTS (\w+) (\w+)([^;]*);/g)];
      expect(columns.map((match) => match[1])).toEqual([
        "last_provider_verified_at",
        "last_provider_verification_kind",
        "last_provider_verification_reason",
      ]);
      for (const column of columns) {
        expect(column[3]).toMatch(/\bNULL\b/);
        expect(column[3]).not.toMatch(/NOT NULL|DEFAULT/i);
      }
      expect(verification).not.toMatch(/\bDROP\b|\bRENAME\b|\bTRUNCATE\b|\bDELETE\b|\bUPDATE\b/i);
      expect([...verification.matchAll(/ADD CONSTRAINT (\w+)/g)].map((match) => match[1])).toEqual([
        "connector_installations_provider_verification_pair_check",
        "connector_installations_provider_verification_code_check",
      ]);
    });

    it("adds the constraints NOT VALID and validates them, so the table is only briefly locked", () => {
      expect(verification.match(/\) NOT VALID;/g)).toHaveLength(2);
      expect(verification.match(/VALIDATE CONSTRAINT connector_installations_provider_verification_/g)).toHaveLength(2);
    });

    it("refuses TOKEN_ONLY as a verification kind and keeps the time and kind together", () => {
      expect(verification).toContain("last_provider_verification_kind <> 'TOKEN_ONLY'");
      expect(verification).toContain("(last_provider_verified_at IS NULL) = (last_provider_verification_kind IS NULL)");
      expect(verification).toContain("last_provider_verification_reason IS NULL OR last_provider_verified_at IS NOT NULL");
    });
  });

  describe("schema.prisma mirrors the SQL", () => {
    const schema = read("packages/db/prisma/schema.prisma");
    // A model block runs to the first closing brace on its own line (a field default can contain braces).
    const model = (name: string) => {
      const start = schema.indexOf(`model ${name} {`);
      const end = schema.indexOf("\n}\n", start);
      return start < 0 || end < 0 ? "" : schema.slice(start, end);
    };

    it("ConnectorTenantEntitlement maps every column of the table, and no more", () => {
      const sqlColumns = [...entitlements.matchAll(/^\s+"([a-z_]+)"\s+(?:TEXT|TIMESTAMPTZ)\b/gm)].map((match) => match[1]).sort();
      const body = model("ConnectorTenantEntitlement");
      const mapped = [...body.matchAll(/@map\("([a-z_]+)"\)/g)].map((match) => match[1]);
      // fields without an explicit @map are single-word column names
      const unmapped = [...body.matchAll(/^\s+(id|reason|source)\s+String\b/gm)].map((match) => match[1]);
      expect([...mapped, ...unmapped].filter((column) => column !== "connector_tenant_entitlements").sort()).toEqual(
        [...new Set(sqlColumns)].sort(),
      );
      expect(body).toMatch(/@@map\("connector_tenant_entitlements"\)/);
    });

    it("declares the tenantKey field the tenant-scope drift guard looks for", () => {
      expect(model("ConnectorTenantEntitlement")).toMatch(/^\s*tenantKey\s+String\b/m);
    });

    it("ConnectorInstallation carries the three provider-verification fields, optional", () => {
      const body = model("ConnectorInstallation");
      expect(body).toMatch(/lastProviderVerifiedAt\s+DateTime\?\s+@map\("last_provider_verified_at"\)/);
      expect(body).toMatch(/lastProviderVerificationKind\s+String\?\s+@map\("last_provider_verification_kind"\)/);
      expect(body).toMatch(/lastProviderVerificationReason\s+String\?\s+@map\("last_provider_verification_reason"\)/);
    });
  });

  describe("nothing reads or writes any of it yet", () => {
    function walk(dir: string): string[] {
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(full);
        return entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") ? [full] : [];
      });
    }

    it("no application code references the entitlement model, its table or the verification columns", () => {
      const pattern = /connectorTenantEntitlement|connector_tenant_entitlements|lastProviderVerif|last_provider_verif/i;
      const offenders = walk(path.join(REPO_ROOT, "apps", "api", "src"))
        .filter((file) => pattern.test(fs.readFileSync(file, "utf8")))
        .map((file) => path.relative(REPO_ROOT, file).replace(/\\/g, "/"));
      // tenant-scope.ts only lists the model so the drift guard and the tenant client isolate reads.
      // publication-target.facts.ts (5.1c-3) derives evaluator facts from rows the caller passes in; it has no database
      // access (the structure tests in the invariants spec pin that: pure imports only, no I/O).
      expect(offenders).toEqual([
        "apps/api/src/prisma/extensions/tenant-scope.ts",
        "apps/api/src/publication-targets/publication-target.facts.ts",
      ]);
    });

    it("the only non-listing reference is the pure fact derivation: it imports no database client", () => {
      const source = fs.readFileSync(path.join(__dirname, "publication-target.facts.ts"), "utf8");
      expect(source).not.toMatch(/prisma|@prisma|PrismaService|\$queryRaw|\$executeRaw|\bfetch\(/i);
    });

    it("the tenant-scope extension lists the new model", () => {
      expect(read("apps/api/src/prisma/extensions/tenant-scope.ts")).toContain('"ConnectorTenantEntitlement"');
    });
  });
});
