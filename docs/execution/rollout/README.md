# Controlled Rollout Snapshots

Use this folder for machine-readable daily release snapshots.

## Generate Snapshot

```powershell
npm run rollout:snapshot -- --environment staging --tenantId SMOKE_TENANT_LOCAL
```

Optional flags:
- `--apiBase` (default: `PIM_API_BASE_URL` or `http://127.0.0.1:4000/api/v1`)
- `--windowDays` (default: `14`)
- `--timeoutMs` (default: `5000`)

## Output

Each run writes:
- `<timestamp>_CONTROLLED_ROLLOUT_SNAPSHOT.json`

Snapshot includes:
1. Health probe result (`/health`)
2. Recent gate signoff artifacts in `docs/execution/gates`
3. Controlled rollout criteria status
4. Broad rollout remaining blockers
