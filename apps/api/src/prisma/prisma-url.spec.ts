import {
  parseConnectionLimit,
  withApplicationName,
  withConnectionLimit,
  withTenantDatabaseUrl,
} from "./prisma-url";

describe("prisma URL helpers", () => {
  describe("withTenantDatabaseUrl", () => {
    it("appends the tenant key as a Postgres options parameter", () => {
      expect(withTenantDatabaseUrl("postgres://user:pass@localhost:5432/db", "tenant-a")).toBe(
        "postgres://user:pass@localhost:5432/db?options=-c%20app.tenant_key%3Dtenant-a",
      );
    });

    it("appends tenant options after an existing query string", () => {
      expect(withTenantDatabaseUrl("postgres://user:pass@localhost:5432/db?schema=public", "tenant-a")).toBe(
        "postgres://user:pass@localhost:5432/db?schema=public&options=-c%20app.tenant_key%3Dtenant-a",
      );
    });

    it("replaces an existing tenant options parameter", () => {
      expect(
        withTenantDatabaseUrl(
          "postgres://user:pass@localhost:5432/db?schema=public&options=-c%20app.tenant_key%3Dold",
          "tenant-b",
        ),
      ).toBe("postgres://user:pass@localhost:5432/db?schema=public&options=-c%20app.tenant_key%3Dtenant-b");
    });
  });

  describe("withApplicationName", () => {
    it("appends application_name when no query string exists", () => {
      expect(withApplicationName("postgres://user:pass@localhost:5432/db", "vexa pim")).toBe(
        "postgres://user:pass@localhost:5432/db?application_name=vexa%20pim",
      );
    });

    it("appends application_name after an existing query string", () => {
      expect(withApplicationName("postgres://user:pass@localhost:5432/db?schema=public", "vexa-pim-api")).toBe(
        "postgres://user:pass@localhost:5432/db?schema=public&application_name=vexa-pim-api",
      );
    });

    it("preserves an existing application_name", () => {
      expect(
        withApplicationName(
          "postgres://user:pass@localhost:5432/db?schema=public&application_name=existing",
          "vexa-pim-api",
        ),
      ).toBe("postgres://user:pass@localhost:5432/db?schema=public&application_name=existing");
    });
  });

  describe("withConnectionLimit", () => {
    it("appends connection_limit when no query string exists", () => {
      expect(withConnectionLimit("postgres://user:pass@localhost:5432/db", 5)).toBe(
        "postgres://user:pass@localhost:5432/db?connection_limit=5",
      );
    });

    it("appends connection_limit after an existing query string", () => {
      expect(withConnectionLimit("postgres://user:pass@localhost:5432/db?schema=public", 5)).toBe(
        "postgres://user:pass@localhost:5432/db?schema=public&connection_limit=5",
      );
    });

    it("replaces an existing connection_limit after a question mark", () => {
      expect(withConnectionLimit("postgres://user:pass@localhost:5432/db?connection_limit=15", 5)).toBe(
        "postgres://user:pass@localhost:5432/db?connection_limit=5",
      );
    });

    it("replaces an existing connection_limit after an ampersand", () => {
      expect(withConnectionLimit("postgres://user:pass@localhost:5432/db?schema=public&connection_limit=15", 5)).toBe(
        "postgres://user:pass@localhost:5432/db?schema=public&connection_limit=5",
      );
    });
  });

  describe("parseConnectionLimit", () => {
    it("defaults to 5 when unset or empty", () => {
      expect(parseConnectionLimit(undefined)).toBe(5);
      expect(parseConnectionLimit("")).toBe(5);
      expect(parseConnectionLimit("  ")).toBe(5);
    });

    it("accepts a positive integer", () => {
      expect(parseConnectionLimit("1")).toBe(1);
      expect(parseConnectionLimit("25")).toBe(25);
      expect(parseConnectionLimit(" 7 ")).toBe(7);
    });

    it("rejects zero, negative, decimal, and non-numeric values", () => {
      expect(() => parseConnectionLimit("0")).toThrow("DB_POOL_CONNECTION_LIMIT");
      expect(() => parseConnectionLimit("-1")).toThrow("DB_POOL_CONNECTION_LIMIT");
      expect(() => parseConnectionLimit("1.5")).toThrow("DB_POOL_CONNECTION_LIMIT");
      expect(() => parseConnectionLimit("many")).toThrow("DB_POOL_CONNECTION_LIMIT");
    });
  });
});
