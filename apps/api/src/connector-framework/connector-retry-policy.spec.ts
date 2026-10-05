import {
  CONNECTOR_RETRY_POLICIES,
  ConnectorRetryPolicyError,
  automaticRetryAllowed,
  resolveRetryPolicy,
} from "./connector-retry-policy";

describe("resolveRetryPolicy", () => {
  it("defaults to CURRENT_BEHAVIOR with no extra headers", () => {
    expect(resolveRetryPolicy({}, undefined)).toEqual({ policy: "CURRENT_BEHAVIOR", operation: null, extraHeaders: {} });
  });

  it.each(["CURRENT_BEHAVIOR", "SAFE_TO_RETRY", "NO_AUTOMATIC_RETRY"] as const)("%s needs nothing else", (retryPolicy) => {
    expect(resolveRetryPolicy({ retryPolicy }, { A: "b" })).toEqual({ policy: retryPolicy, operation: null, extraHeaders: {} });
  });

  it("RETRY_WITH_IDEMPOTENCY yields the header the client must attach", () => {
    expect(
      resolveRetryPolicy(
        { retryPolicy: "RETRY_WITH_IDEMPOTENCY", idempotency: { header: "X-Request-Id", key: "abcdefgh-1234" } },
        undefined,
      ).extraHeaders,
    ).toEqual({ "X-Request-Id": "abcdefgh-1234" });
  });

  it("RETRY_WITH_IDEMPOTENCY without evidence throws", () => {
    expect(() => resolveRetryPolicy({ retryPolicy: "RETRY_WITH_IDEMPOTENCY" }, undefined)).toThrow(ConnectorRetryPolicyError);
  });

  it("an idempotency key under a policy that does not use it throws", () => {
    expect(() =>
      resolveRetryPolicy({ retryPolicy: "SAFE_TO_RETRY", idempotency: { header: "X-Request-Id", key: "abcdefgh-1234" } }, undefined),
    ).toThrow(ConnectorRetryPolicyError);
  });

  it("lists exactly the four policies", () => {
    expect([...CONNECTOR_RETRY_POLICIES]).toEqual(["CURRENT_BEHAVIOR", "SAFE_TO_RETRY", "RETRY_WITH_IDEMPOTENCY", "NO_AUTOMATIC_RETRY"]);
  });

  it("only NO_AUTOMATIC_RETRY forbids automatic retry", () => {
    expect(CONNECTOR_RETRY_POLICIES.filter((p) => !automaticRetryAllowed(p))).toEqual(["NO_AUTOMATIC_RETRY"]);
  });
});
