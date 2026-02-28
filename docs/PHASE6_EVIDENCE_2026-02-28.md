# Phase 6 Evidence (2026-02-28)

Scope delivered:
- Rejection risk score endpoint and UI console.
- Heuristic predictor for major rejection patterns.
- Fix suggestions tied to high-risk signals.

Validation command:

```powershell
powershell -ExecutionPolicy Bypass -File tools\phase6\rejection-intelligence-smoke-test.ps1
```

Result:

```json
{"productId":"cmm60y1iu0003uxv86pw7wj18","channel":"amazon","riskScore":100,"riskBand":"high","suggestionCount":7,"checkedAt":"2026-02-28T13:23:27"}
```

Gate outcome: `PASS`
