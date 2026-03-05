# EXE-BUG-001 Runtime Stability Runbook (2026-02-28)

## Scope

Stabilize local web runtime when `.next` cache corruption or port conflicts cause startup/runtime failures.

## Recovery Procedure

```powershell
powershell -ExecutionPolicy Bypass -File tools\dev\recover-web-runtime.ps1
```

What it does:
1. Stops listeners bound to port `3000`.
2. Clears stale `apps/web/.next`.
3. Reinstalls dependencies (`npm install`).
4. Prints clean startup command.

## Validation Procedure

```powershell
powershell -ExecutionPolicy Bypass -File tools\dev\validate-web-runtime.ps1
```

Expected output:

```json
{"runtimeRecovery":"pass","port":3000,"status":"healthy"}
```

Sandbox/Codex note:

```json
{"runtimeRecovery":"blocked","status":"sandbox-spawn-eperm","port":3000,"action":"run validate-web-runtime.ps1 on local workstation shell"}
```

This means the sandbox could not launch Next.js dev child processes; run the same command in a normal workstation shell for live verification.

## Operational Notes

- Use this runbook whenever Next.js shows missing runtime modules, hydration runtime mismatch from stale artifacts, or repeated port `3000` collisions.
- After recovery, restart normal stacks:
  - `npm run dev:api`
  - `npm run dev:web`
