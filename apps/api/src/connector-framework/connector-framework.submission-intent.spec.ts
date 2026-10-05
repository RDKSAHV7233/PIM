// recordSubmissionAttempt: the semantics the call-intent flow depends on.
//   - the PENDING intent and the write that ends the attempt are ONE attempt (completesIntent),
//   - a row sent back to PENDING is not "resolved", and
//   - every other caller keeps counting a new attempt per write, exactly as before.

import { ConnectorFrameworkService } from "./connector-framework.service";
import type { ConnectorInstallationRecord } from "./connector.types";

function setup() {
  const upsert = jest.fn().mockImplementation(async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
    id: "sub-1",
    idempotencyKey: "job-1:PUBLISH",
    attemptNumber: 1,
    status: args.create.status,
    submissionType: "PUBLISH",
    source: "LIVE_API",
    payloadSnapshotUrl: null,
  }));
  const svc = new ConnectorFrameworkService(
    { tenant: () => ({ connectorSubmission: { upsert } }) } as never,
    {} as never,
    { warn: jest.fn(), info: jest.fn() } as never,
    {} as never,
    {} as never,
    { storeSnapshot: jest.fn() } as never,
  );
  const installation = { id: "inst-1", tenantKey: "tenant1" } as ConnectorInstallationRecord;
  const base = {
    installation,
    productId: "prod-1",
    jobId: "job-1",
    operation: "PUBLISH" as const,
    source: "LIVE_API" as const,
    payloadSnapshot: { sku: "A" },
  };
  return { svc, upsert, base };
}

describe("ConnectorFrameworkService.recordSubmissionAttempt — call intent", () => {
  it("an ordinary write still counts a new attempt on an existing row (unchanged behavior)", async () => {
    const { svc, upsert, base } = setup();

    await svc.recordSubmissionAttempt({ ...base, status: "ERROR" });

    expect(upsert.mock.calls[0][0].update.attemptNumber).toEqual({ increment: 1 });
  });

  it("the write that completes an intent does not count a second attempt", async () => {
    const { svc, upsert, base } = setup();

    await svc.recordSubmissionAttempt({ ...base, status: "SUCCESS", externalRef: "77", completesIntent: true });

    expect(upsert.mock.calls[0][0].update).not.toHaveProperty("attemptNumber");
    expect(upsert.mock.calls[0][0].create.attemptNumber).toBe(1);
  });

  it("intent + completion is exactly one attempt; a replayed intent is one more", async () => {
    const { svc, upsert, base } = setup();

    await svc.recordSubmissionAttempt({ ...base, status: "PENDING" }); // intent
    await svc.recordSubmissionAttempt({ ...base, status: "ERROR", completesIntent: true }); // outcome
    await svc.recordSubmissionAttempt({ ...base, status: "PENDING" }); // replay intent
    await svc.recordSubmissionAttempt({ ...base, status: "SUCCESS", completesIntent: true });

    const increments = upsert.mock.calls.map((c) => c[0].update.attemptNumber ?? null);
    expect(increments).toEqual([{ increment: 1 }, null, { increment: 1 }, null]);
  });

  it("a PENDING write clears resolvedAt so a replayed or unknown attempt does not read as finished", async () => {
    const { svc, upsert, base } = setup();

    await svc.recordSubmissionAttempt({ ...base, status: "PENDING" });

    expect(upsert.mock.calls[0][0].update).toHaveProperty("resolvedAt", null);
    expect(upsert.mock.calls[0][0].create.resolvedAt).toBeNull();
  });

  it.each(["SUCCESS", "REJECTED", "SUPPRESSED", "ERROR"] as const)("a %s write sets resolvedAt", async (status) => {
    const { svc, upsert, base } = setup();

    await svc.recordSubmissionAttempt({ ...base, status });

    expect(upsert.mock.calls[0][0].update.resolvedAt).toBeInstanceOf(Date);
  });

  it("carries the in-flight marker through channelErrors", async () => {
    const { svc, upsert, base } = setup();

    await svc.recordSubmissionAttempt({
      ...base,
      status: "PENDING",
      channelErrors: [{ code: "PROVIDER_CALL_IN_FLIGHT", severity: "warning" }],
    });

    expect(upsert.mock.calls[0][0].create.channelErrors).toEqual([{ code: "PROVIDER_CALL_IN_FLIGHT", severity: "warning" }]);
  });
});
