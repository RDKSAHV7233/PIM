import { validateEnv } from "./env-validation";

const BASE_ENV: Record<string, string> = {
  DATABASE_URL_POOLED: "postgres://user:pass@localhost:5432/db",
  DATABASE_URL_DIRECT: "postgres://user:pass@localhost:5432/db",
  JWT_SECRET: "a".repeat(32),
  REDIS_URL: "redis://localhost:6379",
  R2_ACCOUNT_ID: "acct",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET_NAME: "bucket",
  R2_PUBLIC_URL: "https://example.com",
  APP_ENV: "development",
};

describe("validateEnv - credential encryption key versioning", () => {
  const originalEnv = process.env;
  let exitSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...BASE_ENV };
    exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("PROCESS_EXIT");
    });
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("boots successfully with only V2 present and CURRENT_VERSION=2 (no V1 at all)", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY_V2 = "b".repeat(32);
    process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "2";

    const result = validateEnv();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(result.CREDENTIAL_ENCRYPTION_KEY_V1).toBeUndefined();
    expect(result.CREDENTIAL_ENCRYPTION_KEY_V2).toBe("b".repeat(32));
  });

  it("still boots successfully with only V1 present and CURRENT_VERSION=1 (legacy/unrotated state)", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY_V1 = "a".repeat(32);
    process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "1";

    const result = validateEnv();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(result.CREDENTIAL_ENCRYPTION_KEY_V1).toBe("a".repeat(32));
  });

  it("fails to boot when CURRENT_VERSION points to a version with no corresponding key", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "1";
    // Neither V1 nor V2 set.

    expect(() => validateEnv()).toThrow("PROCESS_EXIT");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain("CREDENTIAL_ENCRYPTION_KEY_V1");
  });

  it("fails to boot when CURRENT_VERSION points to a future version that was never configured", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY_V1 = "a".repeat(32);
    process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "3";

    expect(() => validateEnv()).toThrow("PROCESS_EXIT");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain("CREDENTIAL_ENCRYPTION_KEY_V3");
  });

  it("fails to boot when the current-version key is present but shorter than 32 chars", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY_V2 = "short";
    process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "2";

    expect(() => validateEnv()).toThrow("PROCESS_EXIT");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("fails staging boot when shared password fallback is still configured", () => {
    process.env.APP_ENV = "staging";
    process.env.AUTH_MODE = "db";
    process.env.CREDENTIAL_ENCRYPTION_KEY_V1 = "a".repeat(32);
    process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "1";
    process.env.PIM_COMMERCIAL_OPS_TOKEN = "commercial-token-minimum-length";
    process.env.PIM_AUTH_PASSWORD = "shared-password-must-not-remain";

    expect(() => validateEnv()).toThrow("PROCESS_EXIT");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain("PIM_AUTH_PASSWORD");
  });

  it("keeps vNext mutation disabled by default without requiring allowlist config", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY_V1 = "a".repeat(32);
    process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "1";

    const result = validateEnv();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(result.VNEXT_MUTATION_ENABLED).toBe("false");
    expect(result.VNEXT_MUTATION_ALLOWLIST_JSON).toBeUndefined();
    expect(result.VNEXT_MUTATION_APPROVED_RELEASE_SHA).toBeUndefined();
  });

  it("fails startup when vNext mutation is enabled without an allowlist and approved release", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY_V1 = "a".repeat(32);
    process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "1";
    process.env.VNEXT_MUTATION_ENABLED = "true";

    expect(() => validateEnv()).toThrow("PROCESS_EXIT");
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = errorSpy.mock.calls.flat().join("\n");
    expect(output).toContain("VNEXT_MUTATION_ALLOWLIST_JSON");
    expect(output).toContain("VNEXT_MUTATION_APPROVED_RELEASE_SHA");
  });

  it("accepts a single exact vNext mutation allowlist entry with an approved release SHA", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY_V1 = "a".repeat(32);
    process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "1";
    process.env.VNEXT_MUTATION_ENABLED = "true";
    process.env.VNEXT_MUTATION_ALLOWLIST_JSON = JSON.stringify({
      tenantKey: "tenant-a",
      connectorSlug: "shopify",
      installationId: "install-1",
      productId: "prod-1",
    });
    process.env.VNEXT_MUTATION_APPROVED_RELEASE_SHA = "260a89cc3475152d27821ae2334389ae88084f67";

    const result = validateEnv();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(result.VNEXT_MUTATION_ENABLED).toBe("true");
    expect(result.VNEXT_MUTATION_ALLOWLIST_JSON).toBe(process.env.VNEXT_MUTATION_ALLOWLIST_JSON);
    expect(result.VNEXT_MUTATION_APPROVED_RELEASE_SHA).toBe(process.env.VNEXT_MUTATION_APPROVED_RELEASE_SHA);
  });
});
