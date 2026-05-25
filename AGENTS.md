# PIM1 Agent Guardrails (Anti-Loop Policy)

These rules are mandatory for any coding agent working in this repository.

## 1) No Rebuild Loop Rule
- Do not rebuild, rewrite, or remove completed work unless a regression is proven.
- Regression proof must include:
  - exact failing command
  - failing output snippet
  - file path likely responsible

## 2) Increment Lock Rule
- Source of truth: `docs/execution/INCREMENT_STATE.json`.
- If a story is marked `"locked": true`, edits are blocked unless regression proof is attached in the task notes.

## 3) Edit Scope Rule
- Every task must define an explicit file scope.
- Do not edit files outside scope unless:
  - required to fix compile/test break caused by your change
  - listed in completion report as "scope expansion"

## 4) Continue Guard Rule
- Before acting on "continue", print:
  - what changed in last step
  - what remains
  - why next step is different (not repeating prior step)

## 5) No Silent Revert Rule
- Do not remove existing behavior without equivalent replacement and passing tests.
- Any removal requires justification in final report.

## 6) Completion Lock Rule
- When a story passes acceptance, update `INCREMENT_STATE.json`:
  - `status = completed`
  - `locked = true`
  - `commit`
  - `tests_passed`

## 7) Reopen Rule
- A locked story can be reopened only with:
  - `status = in_progress`
  - `reopened_by`
  - `reopened_reason`
  - `regression_evidence`

## 8) Required Final Report Format
- Changed files
- Commands run
- Pass/fail results
- Remaining blockers (if any)
- Lock updates made in `INCREMENT_STATE.json`

## 9) PR Split Rule
- Prefer single-purpose PRs with one dominant risk domain.
- Split broad changes before review when they mix product behavior with auth, deploy, CI, or test-harness work.
- CI blocks default PRs that exceed scope bounds or span too many risk domains.
- A deliberately large PR requires explicit CTO review and the `cto-large-pr-approved` label.
