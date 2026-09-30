import {
  getVnextMutationValidationIssues,
  isApprovedRelease,
  isMutationAllowedFor,
  isVnextMutationEnabled,
} from "./vnext-mutation-env";

const MATCHING_ENV = {
  VNEXT_MUTATION_ENABLED: "true",
  VNEXT_MUTATION_ALLOWLIST_JSON: JSON.stringify({
    tenantKey: "tenant-a",
    connectorSlug: "shopify",
    installationId: "install-1",
    productId: "prod-1",
  }),
  VNEXT_MUTATION_APPROVED_RELEASE_SHA: "260a89cc3475152d27821ae2334389ae88084f67",
  RAILWAY_GIT_COMMIT_SHA: "260a89cc3475152d27821ae2334389ae88084f67",
};

describe("vnext mutation env gates", () => {
  it("defaults to disabled and denies mutation without config", () => {
    expect(isVnextMutationEnabled({})).toBe(false);
    expect(isMutationAllowedFor("tenant-a", "shopify", "install-1", "prod-1", {})).toBe(false);
    expect(getVnextMutationValidationIssues({})).toEqual([]);
  });

  it("allows only the exact allowlisted tenant, connector, installation, and product", () => {
    expect(isMutationAllowedFor("tenant-a", "shopify", "install-1", "prod-1", MATCHING_ENV)).toBe(true);

    expect(isMutationAllowedFor("Tenant-A", "shopify", "install-1", "prod-1", MATCHING_ENV)).toBe(false);
    expect(isMutationAllowedFor("tenant-a", "SHOPIFY", "install-1", "prod-1", MATCHING_ENV)).toBe(false);
    expect(isMutationAllowedFor("tenant-a", "shopify", "install-2", "prod-1", MATCHING_ENV)).toBe(false);
    expect(isMutationAllowedFor("tenant-a", "shopify", "install-1", "prod-2", MATCHING_ENV)).toBe(false);
  });

  it("rejects enabled config without a single well-formed allowlist entry", () => {
    expect(getVnextMutationValidationIssues({
      VNEXT_MUTATION_ENABLED: "true",
      VNEXT_MUTATION_ALLOWLIST_JSON: "",
      VNEXT_MUTATION_APPROVED_RELEASE_SHA: MATCHING_ENV.VNEXT_MUTATION_APPROVED_RELEASE_SHA,
    })).toContain("VNEXT_MUTATION_ALLOWLIST_JSON: required when VNEXT_MUTATION_ENABLED=true");

    expect(getVnextMutationValidationIssues({
      VNEXT_MUTATION_ENABLED: "true",
      VNEXT_MUTATION_ALLOWLIST_JSON: "{not-json",
      VNEXT_MUTATION_APPROVED_RELEASE_SHA: MATCHING_ENV.VNEXT_MUTATION_APPROVED_RELEASE_SHA,
    }).join("\n")).toContain("VNEXT_MUTATION_ALLOWLIST_JSON");

    expect(getVnextMutationValidationIssues({
      VNEXT_MUTATION_ENABLED: "true",
      VNEXT_MUTATION_ALLOWLIST_JSON: JSON.stringify([
        { tenantKey: "tenant-a", connectorSlug: "shopify", installationId: "install-1", productId: "prod-1" },
        { tenantKey: "tenant-b", connectorSlug: "shopify", installationId: "install-2", productId: "prod-2" },
      ]),
      VNEXT_MUTATION_APPROVED_RELEASE_SHA: MATCHING_ENV.VNEXT_MUTATION_APPROVED_RELEASE_SHA,
    }).join("\n")).toContain("single-entry array");

    expect(getVnextMutationValidationIssues({
      VNEXT_MUTATION_ENABLED: "true",
      VNEXT_MUTATION_ALLOWLIST_JSON: JSON.stringify({
        tenantKey: "tenant-a",
        connectorSlug: "shopify",
        installationId: "install-1",
        productId: "prod-1",
        extra: "not-allowed",
      }),
      VNEXT_MUTATION_APPROVED_RELEASE_SHA: MATCHING_ENV.VNEXT_MUTATION_APPROVED_RELEASE_SHA,
    }).join("\n")).toContain("exactly tenantKey");
  });

  it("requires an approved release SHA when enabled", () => {
    expect(getVnextMutationValidationIssues({
      VNEXT_MUTATION_ENABLED: "true",
      VNEXT_MUTATION_ALLOWLIST_JSON: MATCHING_ENV.VNEXT_MUTATION_ALLOWLIST_JSON,
      VNEXT_MUTATION_APPROVED_RELEASE_SHA: "",
    })).toContain("VNEXT_MUTATION_APPROVED_RELEASE_SHA: required when VNEXT_MUTATION_ENABLED=true");

    expect(getVnextMutationValidationIssues({
      VNEXT_MUTATION_ENABLED: "true",
      VNEXT_MUTATION_ALLOWLIST_JSON: MATCHING_ENV.VNEXT_MUTATION_ALLOWLIST_JSON,
      VNEXT_MUTATION_APPROVED_RELEASE_SHA: "latest",
    })).toContain("VNEXT_MUTATION_APPROVED_RELEASE_SHA: must be a 7-64 character git commit SHA");
  });

  it("requires live Railway release identity to match exactly", () => {
    expect(isApprovedRelease(MATCHING_ENV)).toBe(true);
    expect(isApprovedRelease({
      ...MATCHING_ENV,
      RAILWAY_GIT_COMMIT_SHA: "160a89cc3475152d27821ae2334389ae88084f67",
    })).toBe(false);
    expect(isApprovedRelease({
      ...MATCHING_ENV,
      RAILWAY_GIT_COMMIT_SHA: "",
    })).toBe(false);
    expect(isApprovedRelease({
      ...MATCHING_ENV,
      VNEXT_MUTATION_APPROVED_RELEASE_SHA: "",
    })).toBe(false);
  });
});
