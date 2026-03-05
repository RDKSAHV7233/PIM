# Phase 4 Evidence - EXE-P4-006 Benchmark (2026-02-28)

Scope:
- Objective benchmark for 1,000-SKU import stability and throughput
- Record success/failure/retry metrics for MVP gate evidence

Benchmark command:
- `powershell -ExecutionPolicy Bypass -File tools/phase4/benchmark-1000.ps1`

Result:
```json
{"benchmarkJobId":"cmm5qp15o0003uxqcli4dzt18","targetRows":1000,"totalRows":1000,"successRows":1000,"failedRows":0,"deadLetterRows":0,"retryingRows":0,"totalRetryAttempts":0,"completedChunks":5,"estimatedChunks":5,"checkpointRow":1000,"iterations":5,"elapsedMs":18596,"elapsedSec":18.596,"throughputRowsPerSec":53.78,"successRatePercent":100,"checkedAt":"2026-02-28T08:36:49"}
```

Derived KPI values:
- Rows processed: `1000/1000`
- Success rate: `100%`
- Throughput: `53.78 rows/sec`
- Retries: `0`
- Failed rows: `0`
- Dead-letter rows: `0`
- Chunk runs: `5/5`

Supporting validation:
- `powershell -ExecutionPolicy Bypass -File tools/phase4/smoke-test.ps1` -> pass

Result:
- `EXE-P4-006` is complete.
