import { ErrorCaptureService } from "./error-capture.service";
import type { ErrorEventStore } from "./error-authority.types";

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe("ErrorCaptureService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.APP_ENV = "test";
    process.env.ERROR_AUTHORITY_REF_SECRET = "0123456789abcdef0123456789abcdef";
  });

  it("fails open when the storage layer rejects", async () => {
    const store = {
      record: jest.fn().mockRejectedValue(new Error("observability database unavailable")),
    } satisfies ErrorEventStore;
    const service = new ErrorCaptureService(store as never, logger as never);

    await expect(
      service.captureWithStore(
        {
          runtime: "api",
          service: "vexa-pim-api",
          environment: "test",
          error: new Error("Database exploded"),
        },
        store,
      ),
    ).resolves.toBeUndefined();

    expect(store.record).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      "Error authority custom store failed open.",
      expect.objectContaining({
        runtime: "api",
        service: "vexa-pim-api",
        errorMessage: "observability database unavailable",
      }),
    );
  });

  it("passes normalized safe events to the selected store", async () => {
    const store = {
      record: jest.fn().mockResolvedValue(undefined),
    } satisfies ErrorEventStore;
    const service = new ErrorCaptureService(store as never, logger as never);

    await service.captureWithStore(
      {
        runtime: "worker",
        service: "vexa-pim-api",
        environment: "test",
        rawTenantKey: "tenant-admin",
        error: new Error("Queue failed for product cm123456789abc"),
      },
      store,
    );

    expect(store.record).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "worker",
        service: "vexa-pim-api",
        environment: "test",
        safeTenantRef: expect.stringMatching(/^tenant_[a-f0-9]{24}$/),
        normalizedMessage: expect.stringContaining("{cuid}"),
      }),
    );
  });

  it("fires a best-effort ops alert only for newly-created P0/P1 issues", async () => {
    const store = {
      record: jest.fn().mockResolvedValue({
        stored: true,
        issueId: "iss_1",
        created: true,
        severity: "p1",
      }),
    } satisfies ErrorEventStore;
    const alerts = {
      captureNewP0P1Issue: jest.fn().mockResolvedValue({ alerted: true, reason: "queued" }),
    };
    const service = new ErrorCaptureService(store as never, logger as never, alerts as never);

    await service.captureUnexpected({
      runtime: "api",
      service: "vexa-pim-api",
      error: new Error("Unexpected API failure"),
      severity: "p1",
    });
    await Promise.resolve();

    expect(alerts.captureNewP0P1Issue).toHaveBeenCalledWith(expect.objectContaining({
      issueId: "iss_1",
      severity: "p1",
    }));
  });

  it("does not alert for existing or lower-severity Error Authority issues", async () => {
    const store = {
      record: jest.fn()
        .mockResolvedValueOnce({
          stored: true,
          issueId: "iss_existing",
          created: false,
          severity: "p1",
        })
        .mockResolvedValueOnce({
          stored: true,
          issueId: "iss_p2",
          created: true,
          severity: "p2",
        }),
    } satisfies ErrorEventStore;
    const alerts = {
      captureNewP0P1Issue: jest.fn(),
    };
    const service = new ErrorCaptureService(store as never, logger as never, alerts as never);

    await service.captureUnexpected({
      runtime: "api",
      service: "vexa-pim-api",
      error: new Error("Existing P1"),
      severity: "p1",
    });
    await service.captureUnexpected({
      runtime: "api",
      service: "vexa-pim-api",
      error: new Error("New P2"),
      severity: "p2",
    });

    expect(alerts.captureNewP0P1Issue).not.toHaveBeenCalled();
  });
});
