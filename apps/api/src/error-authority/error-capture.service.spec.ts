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
});
