import { Injectable, OnModuleInit } from "@nestjs/common";

interface Counter {
  type: "counter";
  help: string;
  value: number;
}

interface Gauge {
  type: "gauge";
  help: string;
  value: number;
}

interface Histogram {
  type: "histogram";
  help: string;
  buckets: number[];
  counts: number[];
  sum: number;
  total: number;
}

type Metric = Counter | Gauge | Histogram;

const LATENCY_BUCKETS = [10, 25, 50, 100, 200, 500, 1000, 2500, 5000];

@Injectable()
export class ObservabilityService implements OnModuleInit {
  private readonly metrics = new Map<string, Metric>();
  private readonly startedAt = Date.now();

  onModuleInit() {
    this.registerCounter("pim_api_requests_total", "Total HTTP requests handled");
    this.registerCounter("pim_api_errors_total", "Total HTTP 5xx responses");
    this.registerCounter("pim_queue_jobs_enqueued_total", "Total jobs enqueued");
    this.registerCounter("pim_queue_jobs_completed_total", "Total jobs completed successfully");
    this.registerCounter("pim_queue_jobs_failed_total", "Total jobs that errored");
    this.registerGauge("pim_process_uptime_seconds", "Process uptime in seconds");
    this.registerHistogram("pim_api_request_duration_ms", "HTTP request duration in milliseconds", LATENCY_BUCKETS);
  }

  increment(name: string, by = 1): void {
    const m = this.metrics.get(name);
    if (m?.type === "counter" || m?.type === "gauge") {
      m.value += by;
    }
  }

  set(name: string, value: number): void {
    const m = this.metrics.get(name);
    if (m?.type === "gauge") {
      m.value = value;
    }
  }

  observe(name: string, value: number): void {
    const m = this.metrics.get(name);
    if (m?.type !== "histogram") return;
    m.sum += value;
    m.total += 1;
    for (let i = 0; i < m.buckets.length; i++) {
      if (value <= m.buckets[i]) {
        m.counts[i] += 1;
      }
    }
  }

  formatPrometheus(): string {
    this.set("pim_process_uptime_seconds", Math.floor((Date.now() - this.startedAt) / 1000));

    const lines: string[] = [];
    for (const [name, metric] of this.metrics.entries()) {
      lines.push(`# HELP ${name} ${metric.help}`);
      lines.push(`# TYPE ${name} ${metric.type}`);
      if (metric.type === "counter" || metric.type === "gauge") {
        lines.push(`${name} ${metric.value}`);
      } else {
        let cumulative = 0;
        for (let i = 0; i < metric.buckets.length; i++) {
          cumulative += metric.counts[i];
          lines.push(`${name}_bucket{le="${metric.buckets[i]}"} ${cumulative}`);
        }
        lines.push(`${name}_bucket{le="+Inf"} ${metric.total}`);
        lines.push(`${name}_sum ${metric.sum}`);
        lines.push(`${name}_count ${metric.total}`);
      }
    }
    return lines.join("\n") + "\n";
  }

  private registerCounter(name: string, help: string) {
    this.metrics.set(name, { type: "counter", help, value: 0 });
  }

  private registerGauge(name: string, help: string) {
    this.metrics.set(name, { type: "gauge", help, value: 0 });
  }

  private registerHistogram(name: string, help: string, buckets: number[]) {
    this.metrics.set(name, {
      type: "histogram",
      help,
      buckets,
      counts: new Array<number>(buckets.length).fill(0),
      sum: 0,
      total: 0,
    });
  }
}
