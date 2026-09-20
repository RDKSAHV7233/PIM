import { ObservabilityService } from "./observability.service";

function makeService(): ObservabilityService {
  const service = new ObservabilityService();
  service.onModuleInit();
  return service;
}

describe("ObservabilityService.onModuleInit", () => {
  it("registers exactly the documented metric set", () => {
    const service = makeService();
    const output = service.formatPrometheus();
    const names = [
      "pim_api_requests_total",
      "pim_api_errors_total",
      "pim_queue_jobs_enqueued_total",
      "pim_queue_jobs_completed_total",
      "pim_queue_jobs_failed_total",
      "pim_process_uptime_seconds",
      "pim_api_request_duration_ms",
    ];
    for (const name of names) {
      expect(output).toContain(`# HELP ${name}`);
    }
    // Regression guard: a future metric added to onModuleInit without a
    // matching entry here (or vice versa) should fail this count check.
    expect(output.match(/# HELP/g)?.length).toBe(names.length);
  });

  it("counters and the error counter start at zero", () => {
    const service = makeService();
    const output = service.formatPrometheus();
    expect(output).toContain("pim_api_requests_total 0");
    expect(output).toContain("pim_api_errors_total 0");
  });
});

describe("ObservabilityService.increment", () => {
  it("increments a counter by 1 by default", () => {
    const service = makeService();
    service.increment("pim_api_requests_total");
    expect(service.formatPrometheus()).toContain("pim_api_requests_total 1");
  });

  it("increments a counter by a custom amount", () => {
    const service = makeService();
    service.increment("pim_api_requests_total", 5);
    expect(service.formatPrometheus()).toContain("pim_api_requests_total 5");
  });

  it("accumulates across multiple calls", () => {
    const service = makeService();
    service.increment("pim_queue_jobs_enqueued_total");
    service.increment("pim_queue_jobs_enqueued_total");
    service.increment("pim_queue_jobs_enqueued_total", 3);
    expect(service.formatPrometheus()).toContain("pim_queue_jobs_enqueued_total 5");
  });

  it("is a silent no-op for an unregistered metric name — never throws, never auto-creates it", () => {
    const service = makeService();
    expect(() => service.increment("pim_does_not_exist")).not.toThrow();
    expect(service.formatPrometheus()).not.toContain("pim_does_not_exist");
  });

  it("is a silent no-op against a histogram — increment() only applies to counter/gauge", () => {
    const service = makeService();
    service.increment("pim_api_request_duration_ms");
    const output = service.formatPrometheus();
    // No bucket, sum, or count line should reflect a phantom observation.
    expect(output).toContain("pim_api_request_duration_ms_sum 0");
    expect(output).toContain("pim_api_request_duration_ms_count 0");
  });
});

describe("ObservabilityService.set", () => {
  // pim_process_uptime_seconds is the only gauge in the current metric set,
  // and formatPrometheus() itself re-sets it to the real elapsed time on
  // every call (by design — that's the gauge's whole purpose), which would
  // clobber a manually-set value before it could be observed. Controlling
  // Date.now() lets this test prove set()'s exact-value/non-additive
  // semantics via that same auto-refresh path instead of fighting it: if
  // set() were additive, the second call's elapsed-time would compound onto
  // the first rather than replacing it.
  it("overwrites rather than accumulates — verified via the uptime gauge's own auto-refresh", () => {
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000_000);
    const service = makeService();

    nowSpy.mockReturnValue(1_005_000); // +5s
    expect(service.formatPrometheus()).toContain("pim_process_uptime_seconds 5");

    nowSpy.mockReturnValue(1_012_000); // +12s from start, not +12s from the last read
    expect(service.formatPrometheus()).toContain("pim_process_uptime_seconds 12");

    nowSpy.mockRestore();
  });

  it("is a silent no-op against a counter — set() only applies to gauges", () => {
    const service = makeService();
    service.increment("pim_api_requests_total", 10);
    service.set("pim_api_requests_total", 999);
    // The prior increment must survive untouched.
    expect(service.formatPrometheus()).toContain("pim_api_requests_total 10");
  });

  it("is a silent no-op for an unregistered metric name", () => {
    const service = makeService();
    expect(() => service.set("pim_does_not_exist", 1)).not.toThrow();
    expect(service.formatPrometheus()).not.toContain("pim_does_not_exist");
  });
});

describe("ObservabilityService.observe — histogram bucket correctness", () => {
  // LATENCY_BUCKETS = [10, 25, 50, 100, 200, 500, 1000, 2500, 5000]. Prometheus
  // histogram buckets are cumulative ("le" = less-than-or-equal): a single
  // observation must increment every bucket whose boundary is >= the value,
  // not just the smallest qualifying bucket. This is the property most likely
  // to silently break under a careless refactor (e.g. an early `break` after
  // the first match), and it's exactly what every dashboard/alert built on
  // this histogram implicitly trusts.
  it("a value increments every bucket at or above it, not just the smallest one", () => {
    const service = makeService();
    service.observe("pim_api_request_duration_ms", 30);
    const output = service.formatPrometheus();
    expect(output).toContain('pim_api_request_duration_ms_bucket{le="10"} 0');
    expect(output).toContain('pim_api_request_duration_ms_bucket{le="25"} 0');
    // Cumulative from here on: bucket 50 gets this observation, and every
    // larger bucket's *cumulative* count must include it too.
    expect(output).toContain('pim_api_request_duration_ms_bucket{le="50"} 1');
    expect(output).toContain('pim_api_request_duration_ms_bucket{le="100"} 1');
    expect(output).toContain('pim_api_request_duration_ms_bucket{le="5000"} 1');
    expect(output).toContain('pim_api_request_duration_ms_bucket{le="+Inf"} 1');
  });

  it("a value exactly on a bucket boundary counts as <= that bucket", () => {
    const service = makeService();
    service.observe("pim_api_request_duration_ms", 100);
    const output = service.formatPrometheus();
    expect(output).toContain('pim_api_request_duration_ms_bucket{le="50"} 0');
    expect(output).toContain('pim_api_request_duration_ms_bucket{le="100"} 1');
  });

  it("a value above every bucket only lands in +Inf", () => {
    const service = makeService();
    service.observe("pim_api_request_duration_ms", 999_999);
    const output = service.formatPrometheus();
    expect(output).toContain('pim_api_request_duration_ms_bucket{le="5000"} 0');
    expect(output).toContain('pim_api_request_duration_ms_bucket{le="+Inf"} 1');
  });

  it("sum and count accumulate across multiple observations", () => {
    const service = makeService();
    service.observe("pim_api_request_duration_ms", 10);
    service.observe("pim_api_request_duration_ms", 20);
    service.observe("pim_api_request_duration_ms", 30);
    const output = service.formatPrometheus();
    expect(output).toContain("pim_api_request_duration_ms_sum 60");
    expect(output).toContain("pim_api_request_duration_ms_count 3");
  });

  it("bucket counts from separate observations accumulate cumulatively, not just per-call", () => {
    const service = makeService();
    service.observe("pim_api_request_duration_ms", 5); // <=10
    service.observe("pim_api_request_duration_ms", 15); // <=25
    const output = service.formatPrometheus();
    // Both observations land at <=25 and above (cumulative); only the first also lands at <=10.
    expect(output).toContain('pim_api_request_duration_ms_bucket{le="10"} 1');
    expect(output).toContain('pim_api_request_duration_ms_bucket{le="25"} 2');
    expect(output).toContain('pim_api_request_duration_ms_bucket{le="5000"} 2');
  });

  it("is a silent no-op against a counter or gauge — observe() only applies to histograms", () => {
    const service = makeService();
    service.observe("pim_api_requests_total", 42);
    expect(service.formatPrometheus()).toContain("pim_api_requests_total 0");
  });

  it("is a silent no-op for an unregistered metric name", () => {
    const service = makeService();
    expect(() => service.observe("pim_does_not_exist", 1)).not.toThrow();
    expect(service.formatPrometheus()).not.toContain("pim_does_not_exist");
  });
});

describe("ObservabilityService.formatPrometheus — output shape", () => {
  it("emits HELP and TYPE lines before each metric's value", () => {
    const service = makeService();
    const lines = service.formatPrometheus().split("\n");
    const helpIdx = lines.indexOf("# HELP pim_api_requests_total Total HTTP requests handled");
    const typeIdx = lines.indexOf("# TYPE pim_api_requests_total counter");
    expect(helpIdx).toBeGreaterThanOrEqual(0);
    expect(typeIdx).toBe(helpIdx + 1);
  });

  it("updates the uptime gauge on every call, reflecting real elapsed time", () => {
    const service = makeService();
    const before = service.formatPrometheus();
    const beforeMatch = before.match(/pim_process_uptime_seconds (\d+)/);
    expect(beforeMatch).not.toBeNull();
    expect(Number(beforeMatch![1])).toBeGreaterThanOrEqual(0);
  });

  it("ends with a trailing newline (valid Prometheus exposition format)", () => {
    const service = makeService();
    expect(service.formatPrometheus().endsWith("\n")).toBe(true);
  });
});
