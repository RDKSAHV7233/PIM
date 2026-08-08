import { classifyWorkerError, extractSafePayloadRef, isTerminalBullFailure } from "./worker-error-classifier";

describe("worker error classifier", () => {
  it("captures unexpected worker failures with useful categories", () => {
    expect(classifyWorkerError(new Error("Prisma database connection failed"))).toEqual({
      capture: true,
      category: "database",
      reason: "unexpected_database_failure",
    });
    expect(classifyWorkerError(new Error("Unexpected timeout while processing"))).toEqual({
      capture: true,
      category: "timeout",
      reason: "unexpected_timeout",
    });
  });

  it("excludes expected domain and rate-limit failures", () => {
    const rateLimit = new Error("rate_limit_exceeded");
    rateLimit.name = "QueueRateLimitError";
    expect(classifyWorkerError(rateLimit).capture).toBe(false);
    expect(classifyWorkerError(new Error("Marketplace validation rejection")).capture).toBe(false);
    expect(classifyWorkerError(new Error("Credential expired for connector account")).capture).toBe(false);
    expect(classifyWorkerError(new Error("No eligible products for bulk publish")).capture).toBe(false);
  });

  it("identifies terminal BullMQ failures from attempts", () => {
    expect(isTerminalBullFailure(1, 3)).toBe(false);
    expect(isTerminalBullFailure(3, 3)).toBe(true);
    expect(isTerminalBullFailure(1, undefined)).toBe(true);
  });

  it("extracts only short scalar payload references", () => {
    expect(extractSafePayloadRef({ jobId: "job-123" }, "jobId")).toBe("job-123");
    expect(extractSafePayloadRef({ jobId: { nested: true } }, "jobId")).toBeUndefined();
    expect(extractSafePayloadRef({ jobId: "x".repeat(200) }, "jobId")).toHaveLength(120);
  });
});
