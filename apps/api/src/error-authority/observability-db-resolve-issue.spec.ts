import { ObservabilityDbService } from "./observability-db.service";

/**
 * PIM#766 Part 1: focused unit coverage for ObservabilityDbService.resolveIssue.
 */
function makeServiceWithClient(clientOverrides: Record<string, unknown> = {}) {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const service = new ObservabilityDbService(logger as never);
  const client = { errorIssue: {}, ...clientOverrides };
  (service as unknown as { client: unknown }).client = client;
  return { service, client, logger };
}

const OPEN_ISSUE_ROW = {
  id: "issue-1",
  state: "open",
  fingerprint: "fp-1",
  service: "vexa-pim-api",
  runtime: "api",
  severity: "p1",
};

describe("ObservabilityDbService.resolveIssue", () => {
  it("updates an 'open' issue's state to 'resolved' and reports the previous state", async () => {
    const findUnique = jest.fn().mockResolvedValue(OPEN_ISSUE_ROW);
    const update = jest.fn().mockResolvedValue({ ...OPEN_ISSUE_ROW, state: "resolved" });
    const { service } = makeServiceWithClient({ errorIssue: { findUnique, update } });

    const result = await service.resolveIssue("issue-1");

    expect(result).toEqual({
      outcome: "resolved",
      previousState: "open",
      issue: {
        id: "issue-1",
        state: "resolved",
        fingerprint: "fp-1",
        service: "vexa-pim-api",
        runtime: "api",
        severity: "p1",
      },
    });
    expect(update).toHaveBeenCalledTimes(1);
    const callArg = update.mock.calls[0][0] as { where: { id: string }; data: { state: string } };
    expect(callArg.where.id).toBe("issue-1");
    expect(callArg.data.state).toBe("resolved");
  });

  it("returns 'not_found' for an unknown issue id and never calls update", async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const update = jest.fn();
    const { service } = makeServiceWithClient({ errorIssue: { findUnique, update } });

    const result = await service.resolveIssue("does-not-exist");

    expect(result).toEqual({ outcome: "not_found" });
    expect(update).not.toHaveBeenCalled();
  });

  it("is idempotent: an already-'resolved' issue returns 'already_resolved' without calling update again", async () => {
    const resolvedRow = { ...OPEN_ISSUE_ROW, state: "resolved" };
    const findUnique = jest.fn().mockResolvedValue(resolvedRow);
    const update = jest.fn();
    const { service } = makeServiceWithClient({ errorIssue: { findUnique, update } });

    const result = await service.resolveIssue("issue-1");

    expect(result).toEqual({ outcome: "already_resolved", issue: resolvedRow });
    expect(update).not.toHaveBeenCalled();
  });

  it("reports storageAvailable-style 'storage_unavailable' without querying when no client is connected", async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new ObservabilityDbService(logger as never);

    const result = await service.resolveIssue("issue-1");

    expect(result).toEqual({ outcome: "storage_unavailable" });
  });

  it("fails open (no throw) and reports 'storage_unavailable' when the lookup itself rejects", async () => {
    const findUnique = jest.fn().mockRejectedValue(new Error("connection reset"));
    const { service, logger } = makeServiceWithClient({ errorIssue: { findUnique } });

    const result = await service.resolveIssue("issue-1");

    expect(result).toEqual({ outcome: "storage_unavailable" });
    expect(logger.error).toHaveBeenCalledWith(
      "Error authority manual resolve failed.",
      expect.objectContaining({ issueId: "issue-1", errorMessage: "connection reset" }),
    );
  });
});
