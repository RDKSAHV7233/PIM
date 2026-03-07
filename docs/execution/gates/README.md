# Gate Sign-off Artifacts

Each gate sign-off artifact must include:
- `environment` (must be `staging`)
- `tenantId`
- `date`
- `gitTag`
- `runUrl`
- `suite`

Generate a sign-off artifact with:

```powershell
$env:APP_ENV="staging"
npm run gate:signoff -- --suite E7-ST-OPS-005 --tenantId SMOKE_TENANT --runUrl "https://github.com/<org>/<repo>/actions/runs/<id>"
```

Artifacts are written to this directory as timestamped JSON files.

## Increment Core Gate Runner

Run the named core suites and lint/build gates with one command:

```powershell
npm run gate:run:increment
```

Integration suites in this runner have one automatic retry to absorb transient startup flake.

This executes:
1. API lint + build
2. Web lint + build
3. API build refresh before integration suites
4. `test:integration:connector-idempotency-semantics`
5. `test:integration:webhook-dedupe-scope`
6. `test:integration:rls-isolation`
7. `test:integration:rejection-notification`
8. `test:integration:metrics-kpi-trends`
9. `guard:unsafe-raw`
