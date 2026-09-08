import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ErrorAuthorityOpsService } from "./error-authority-ops.service";

const RESOLVED_ISSUE = {
  id: "issue-1",
  state: "resolved",
  fingerprint: "fp-1",
  service: "vexa-pim-api",
  runtime: "api",
  severity: "p1",
};

describe("ErrorAuthorityOpsService.resolveIssue", () => {
  it("returns the updated { id, state } plus audit-metadata fields on a fresh resolve", async () => {
    const observabilityDb = {
      resolveIssue: jest.fn().mockResolvedValue({
        outcome: "resolved",
        issue: RESOLVED_ISSUE,
        previousState: "open",
      }),
    };
    const service = new ErrorAuthorityOpsService(observabilityDb as never);

    const result = await service.resolveIssue("issue-1");

    expect(result).toEqual({
      id: "issue-1",
      state: "resolved",
      previousState: "open",
      fingerprint: "fp-1",
      service: "vexa-pim-api",
      runtime: "api",
      severity: "p1",
    });
    expect(observabilityDb.resolveIssue).toHaveBeenCalledWith("issue-1");
  });

  it("is idempotent: resolving an already-resolved issue succeeds and reports previousState = 'resolved'", async () => {
    const observabilityDb = {
      resolveIssue: jest.fn().mockResolvedValue({
        outcome: "already_resolved",
        issue: RESOLVED_ISSUE,
      }),
    };
    const service = new ErrorAuthorityOpsService(observabilityDb as never);

    const result = await service.resolveIssue("issue-1");

    expect(result.id).toBe("issue-1");
    expect(result.state).toBe("resolved");
    expect(result.previousState).toBe("resolved");
  });

  it("throws NotFoundException for an unknown issue id", async () => {
    const observabilityDb = {
      resolveIssue: jest.fn().mockResolvedValue({ outcome: "not_found" }),
    };
    const service = new ErrorAuthorityOpsService(observabilityDb as never);

    await expect(service.resolveIssue("does-not-exist")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws ServiceUnavailableException when observability storage is unreachable", async () => {
    const observabilityDb = {
      resolveIssue: jest.fn().mockResolvedValue({ outcome: "storage_unavailable" }),
    };
    const service = new ErrorAuthorityOpsService(observabilityDb as never);

    await expect(service.resolveIssue("issue-1")).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
