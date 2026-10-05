import { ConnectorRedirectError, ConnectorTargetUnsafeError } from "../common/security/connector-target-errors";
import {
  CapabilityNotSupportedError,
  ConnectorNetworkError,
  ConnectorNotFoundError,
  CredentialExpiredError,
  InstallationNotFoundError,
} from "./connector.errors";
import {
  PROVIDER_CALL_IN_FLIGHT,
  PROVIDER_OUTCOME_UNKNOWN,
  SubmissionIntentNotRecordedError,
  classifyProviderCallFailure,
  providerCallInFlightMarker,
  providerOutcomeUnknownMarker,
} from "./provider-call-outcome";

function transportError(code: string, message = "fetch failed"): TypeError {
  return Object.assign(new TypeError(message), { cause: Object.assign(new Error(code), { code }) });
}

describe("classifyProviderCallFailure", () => {
  describe("OUTCOME_UNKNOWN: the request may have reached the provider", () => {
    it.each(["ECONNRESET", "ETIMEDOUT", "EPIPE", "ECONNABORTED", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"])(
      "a transport failure with cause %s",
      (code) => {
        expect(classifyProviderCallFailure(transportError(code))).toBe("OUTCOME_UNKNOWN");
      },
    );

    it.each(["TimeoutError", "AbortError"])("a %s", (name) => {
      expect(classifyProviderCallFailure(Object.assign(new Error("timed out"), { name }))).toBe("OUTCOME_UNKNOWN");
    });

    it("an undici 'fetch failed' with no recognizable cause is treated as unknown, not as a plain failure", () => {
      expect(classifyProviderCallFailure(new TypeError("fetch failed"))).toBe("OUTCOME_UNKNOWN");
    });

    it("a nested cause is found", () => {
      const nested = Object.assign(new Error("outer"), {
        cause: Object.assign(new Error("mid"), { cause: Object.assign(new Error("inner"), { code: "ECONNRESET" }) }),
      });
      expect(classifyProviderCallFailure(nested)).toBe("OUTCOME_UNKNOWN");
    });

    it.each(["TIMEOUT", "NETWORK"] as const)("a ConnectorNetworkError of category %s", (category) => {
      expect(classifyProviderCallFailure(new ConnectorNetworkError("bigcommerce", category, true, "x"))).toBe("OUTCOME_UNKNOWN");
    });

    it("a connector error that declares outcomeUnknown", () => {
      expect(classifyProviderCallFailure(Object.assign(new Error("create outcome unknown"), { outcomeUnknown: true }))).toBe("OUTCOME_UNKNOWN");
    });

    it("outcomeUnknown wins over an otherwise answered-looking error", () => {
      expect(classifyProviderCallFailure(Object.assign(new Error("Odoo product publish failed"), { name: "OdooPublishError", outcomeUnknown: true }))).toBe("OUTCOME_UNKNOWN");
    });
  });

  describe("NOT_EXECUTED: provably refused or failed before the provider could run it", () => {
    it.each(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED"])(
      "a transport failure with cause %s",
      (code) => {
        expect(classifyProviderCallFailure(transportError(code))).toBe("NOT_EXECUTED");
      },
    );

    it.each(["DNS", "TLS"] as const)("a ConnectorNetworkError of category %s", (category) => {
      expect(classifyProviderCallFailure(new ConnectorNetworkError("woocommerce", category, false, "x"))).toBe("NOT_EXECUTED");
    });

    it("a refused target (unsafe address)", () => {
      expect(classifyProviderCallFailure(new ConnectorTargetUnsafeError("Odoo URL is not allowed", "PRIVATE_ADDRESS" as never))).toBe("NOT_EXECUTED");
    });

    it("a blocked redirect", () => {
      expect(classifyProviderCallFailure(new ConnectorRedirectError("CROSS_ORIGIN" as never, "redirect refused"))).toBe("NOT_EXECUTED");
    });

    it.each([
      ["expired credentials", new CredentialExpiredError("etsy")],
      ["a missing installation", new InstallationNotFoundError("etsy")],
      ["an unsupported capability", new CapabilityNotSupportedError("etsy", "PUBLISH")],
      ["an unregistered connector", new ConnectorNotFoundError("etsy")],
      ["an intent that could not be recorded", new SubmissionIntentNotRecordedError(new Error("db down"))],
    ])("%s", (_label, error) => {
      expect(classifyProviderCallFailure(error)).toBe("NOT_EXECUTED");
    });

    it("when both a post-send and a pre-send code appear in the chain, it is treated as unknown", () => {
      const mixed = Object.assign(new Error("outer"), {
        code: "ECONNREFUSED",
        cause: Object.assign(new Error("inner"), { code: "ECONNRESET" }),
      });
      expect(classifyProviderCallFailure(mixed)).toBe("OUTCOME_UNKNOWN");
    });
  });

  describe("PROVIDER_ANSWERED: the failure is not a transport ambiguity", () => {
    it.each([
      ["a plain provider-style publish error", new Error("BigCommerce request failed with status 422: invalid category")],
      ["a local validation error", new Error("name is required")],
      ["a non-error value", "boom"],
      ["undefined", undefined],
    ])("%s", (_label, error) => {
      expect(classifyProviderCallFailure(error)).toBe("PROVIDER_ANSWERED");
    });

    it("a TypeError that is not a failed fetch", () => {
      expect(classifyProviderCallFailure(new TypeError("Cannot read properties of undefined"))).toBe("PROVIDER_ANSWERED");
    });
  });
});

describe("markers", () => {
  it("the in-flight marker is a warning with its own code", () => {
    expect(providerCallInFlightMarker()).toMatchObject({ code: PROVIDER_CALL_IN_FLIGHT, severity: "warning" });
  });

  it("the unknown-outcome marker tells the operator to check the channel before publishing again", () => {
    const marker = providerOutcomeUnknownMarker() as { code: string; severity: string; sellerMessage: string };
    expect(marker).toMatchObject({ code: PROVIDER_OUTCOME_UNKNOWN, severity: "warning" });
    expect(marker.sellerMessage).toMatch(/check the channel/i);
    expect(marker.sellerMessage).toMatch(/may have received/i);
  });
});
