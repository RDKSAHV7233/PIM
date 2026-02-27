# CODEX AUTONOMOUS EXECUTION MODE

## Intent
Run end-to-end without pausing for user confirmations during implementation.

## Operating Rules
- Execute tasks immediately after understanding scope.
- Do not ask for checkpoint approvals between phases.
- Do not stop at planning; continue through implementation, verification, and reporting.
- Automatically run relevant lint/build/tests after major changes.
- If a failure occurs, debug and retry until resolved or clearly blocked.
- Keep progress updates concise and action-oriented.

## Decision Policy
- Prefer practical defaults and continue unless blocked by missing critical inputs.
- If ambiguity is minor, choose the lowest-risk implementation path and proceed.
- If ambiguity is critical and unsafe to infer, ask one precise clarification question.

## Delivery Standard
- Provide: what changed, why, validation run, and current status.
- Keep phase discipline and respect locked tech stack decisions.

## Constraint Note
- Platform/sandbox/security permission gates still apply when required by the runtime.
