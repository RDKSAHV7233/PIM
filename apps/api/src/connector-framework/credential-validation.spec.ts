import {
  BOOLEAN_FALSE_MEANS_REJECTION,
  classifyDetailedResult,
  classifyLegacyBoolean,
  classifyThrown,
  configurationInvalid,
  safeReason,
  unvalidatedAfterCredentialChange,
  validationColumns,
  verifiedValidationStamp,
} from "./credential-validation";

describe("classifyDetailedResult", () => {
  it.each([
    [{ outcome: "valid" as const }, { outcome: "VALID", reason: null }],
    [{ outcome: "invalid" as const, reasonCode: "HTTP_401" }, { outcome: "INVALID", reason: "HTTP_401" }],
    [{ outcome: "invalid" as const, reasonCode: "invalid_grant" }, { outcome: "INVALID", reason: "invalid_grant" }],
    [{ outcome: "invalid" as const }, { outcome: "INVALID", reason: "UNSPECIFIED" }],
    [{ outcome: "unavailable" as const, reasonCode: "HTTP_503" }, { outcome: "INDETERMINATE", reason: "HTTP_503" }],
    [{ outcome: "unavailable" as const }, { outcome: "INDETERMINATE", reason: "UNAVAILABLE" }],
    [
      { outcome: "invalid" as const, reasonCode: "ODOO_URL_UNSAFE", category: "configuration" as const },
      { outcome: "CONFIGURATION_ERROR", reason: "ODOO_URL_UNSAFE" },
    ],
  ])("%j -> %j", (input, expected) => {
    expect(classifyDetailedResult(input)).toEqual(expected);
  });

  it("a token-only success is VALID but records its evidence level, so it is never mistaken for a live check", () => {
    expect(classifyDetailedResult({ outcome: "valid", evidence: "token_only" })).toEqual({ outcome: "VALID", reason: "TOKEN_ONLY" });
    expect(classifyDetailedResult({ outcome: "valid" })).toEqual({ outcome: "VALID", reason: null });
  });

  it("only an explicit invalid result can ever be INVALID", () => {
    expect(classifyDetailedResult({ outcome: "unavailable", reasonCode: "HTTP_401" }).outcome).toBe("INDETERMINATE");
  });
});

describe("classifyLegacyBoolean", () => {
  it("true is VALID", () => {
    expect(classifyLegacyBoolean("anything", true)).toEqual({ outcome: "VALID", reason: null });
  });

  it("false is INDETERMINATE unless the connector is on the audited allowlist (which ships empty)", () => {
    expect(BOOLEAN_FALSE_MEANS_REJECTION.size).toBe(0);
    expect(classifyLegacyBoolean("meesho", false)).toEqual({ outcome: "INDETERMINATE", reason: "LEGACY_BOOLEAN_FALSE" });
  });

  it("false is INVALID only for an allowlisted slug", () => {
    (BOOLEAN_FALSE_MEANS_REJECTION as Set<string>).add("audited-slug");
    try {
      expect(classifyLegacyBoolean("audited-slug", false)).toEqual({ outcome: "INVALID", reason: "LEGACY_BOOLEAN_FALSE" });
    } finally {
      (BOOLEAN_FALSE_MEANS_REJECTION as Set<string>).delete("audited-slug");
    }
  });
});

describe("classifyThrown", () => {
  it("a crashed verifier is INDETERMINATE, never INVALID", () => {
    expect(classifyThrown()).toEqual({ outcome: "INDETERMINATE", reason: "HEARTBEAT_ERROR" });
  });
});

describe("safeReason", () => {
  it.each([
    ["HTTP_503", "HTTP_503"],
    ["invalid_client", "invalid_client"],
    ["a.b-c_D9", "a.b-c_D9"],
    ["", "FALLBACK"],
    ["   ", "FALLBACK"],
    ["has a space", "FALLBACK"],
    ["https://shop.example.com/x?token=SECRET", "FALLBACK"],
    ["x".repeat(65), "FALLBACK"],
    [undefined, "FALLBACK"],
    [503, "FALLBACK"],
  ])("%j -> %s", (input, expected) => {
    expect(safeReason(input, "FALLBACK")).toBe(expected);
  });
});

describe("configurationInvalid", () => {
  it("builds an invalid result flagged as a configuration problem", () => {
    expect(configurationInvalid("WOOCOMMERCE_SITE_URL_UNSAFE")).toEqual({
      outcome: "invalid",
      reasonCode: "WOOCOMMERCE_SITE_URL_UNSAFE",
      category: "configuration",
    });
  });
});

describe("validationColumns", () => {
  const now = new Date("2026-10-05T00:00:00Z");

  it("VALID moves lastValidatedAt and the attempt, clears the reason", () => {
    expect(validationColumns({ outcome: "VALID", reason: null }, now)).toEqual({
      lastValidatedAt: now,
      lastValidationAttemptAt: now,
      lastValidationOutcome: "VALID",
      lastValidationReason: null,
    });
  });

  it.each(["INVALID", "INDETERMINATE", "CONFIGURATION_ERROR"] as const)(
    "%s moves the attempt but never lastValidatedAt",
    (outcome) => {
      const columns = validationColumns({ outcome, reason: "WHY" }, now);
      expect(columns).not.toHaveProperty("lastValidatedAt");
      expect(columns).toEqual({ lastValidationAttemptAt: now, lastValidationOutcome: outcome, lastValidationReason: "WHY" });
    },
  );

  it("verifiedValidationStamp is a VALID record for install / reconnect / credential replacement", () => {
    expect(verifiedValidationStamp(now)).toEqual(validationColumns({ outcome: "VALID", reason: null }, now));
  });
});

describe("unvalidatedAfterCredentialChange", () => {
  it("clears every fact to unknown and never records VALID (no VALID without provider-authenticated evidence)", () => {
    const columns = unvalidatedAfterCredentialChange();
    expect(columns).toEqual({
      lastValidatedAt: null,
      lastValidationAttemptAt: null,
      lastValidationOutcome: null,
      lastValidationReason: null,
    });
    expect(JSON.stringify(columns)).not.toContain("VALID");
  });
});
