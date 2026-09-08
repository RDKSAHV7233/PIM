import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ErrorAuthorityOpsController } from "./error-authority-ops.controller";

function makeController(opsServiceOverrides: Record<string, unknown> = {}) {
  const opsService = {
    resolveIssue: jest.fn().mockResolvedValue({
      id: "issue-1",
      state: "resolved",
      previousState: "open",
      fingerprint: "fp-1",
      service: "vexa-pim-api",
      runtime: "api",
      severity: "p1",
    }),
    ...opsServiceOverrides,
  };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const controller = new ErrorAuthorityOpsController(opsService as never, auditService as never);
  return { controller, opsService, auditService };
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return { pimRole: "admin", pimUserId: "user-42", url: "/error-authority/ops/issues/issue-1/resolve", ...overrides } as never;
}

describe("ErrorAuthorityOpsController.resolveIssue", () => {
  it("resolves the issue, returns { id, state }, and records an ERROR_ISSUE_RESOLVED audit entry", async () => {
    const { controller, opsService, auditService } = makeController();

    const result = await controller.resolveIssue("issue-1", makeRequest());

    expect(result).toEqual({ id: "issue-1", state: "resolved" });
    expect(opsService.resolveIssue).toHaveBeenCalledWith("issue-1");

    expect(auditService.record).toHaveBeenCalledTimes(1);
    const auditPayload = auditService.record.mock.calls[0][0];
    expect(auditPayload).toMatchObject({
      actorId: "user-42",
      actorRole: "admin",
      action: "ERROR_ISSUE_RESOLVED",
      resource: "ERROR_ISSUE",
      resourceId: "issue-1",
      metadata: {
        fingerprint: "fp-1",
        service: "vexa-pim-api",
        runtime: "api",
        severity: "p1",
        previousState: "open",
      },
    });
  });

  it("throws ForbiddenException without calling the service when the app role is not admin", async () => {
    const { controller, opsService, auditService } = makeController();

    await expect(
      controller.resolveIssue("issue-1", makeRequest({ pimRole: "editor" })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(opsService.resolveIssue).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it("falls back to actorId 'system' when pimUserId is missing", async () => {
    const { controller, auditService } = makeController();

    await controller.resolveIssue("issue-1", makeRequest({ pimUserId: undefined }));

    expect(auditService.record.mock.calls[0][0]).toMatchObject({ actorId: "system" });
  });

  it("propagates a 404 from the service without recording an audit entry", async () => {
    const { controller, auditService } = makeController({
      resolveIssue: jest.fn().mockRejectedValue(new NotFoundException({ error: "ERROR_ISSUE_NOT_FOUND" })),
    });

    await expect(controller.resolveIssue("does-not-exist", makeRequest())).rejects.toBeInstanceOf(NotFoundException);
    expect(auditService.record).not.toHaveBeenCalled();
  });
});
