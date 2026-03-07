# PIM1 Task Execution Checklist (Anti-Loop)

Use this before starting any task and before replying with "continue".

## A. Task Header
- Task ID:
- Increment ID:
- Objective:
- Allowed file scope:
- Acceptance criteria:

## B. Pre-Execution Checks
- [ ] Checked `docs/execution/INCREMENT_STATE.json` for lock status.
- [ ] Verified task is not already `completed + locked`.
- [ ] If locked, attached regression proof:
  - failing command:
  - failing output:
  - impacted file:

## C. Execution Controls
- [ ] Changes are within declared file scope.
- [ ] Any scope expansion is recorded with reason.
- [ ] No behavior removed without equivalent replacement.

## D. Validation
- Commands run:
```bash
# list exact commands used
```
- Results:
  - [ ] lint pass
  - [ ] build pass
  - [ ] required tests pass

## E. Closure
- [ ] Updated `INCREMENT_STATE.json` for this story.
- [ ] If complete: `status=completed`, `locked=true`, commit + tests recorded.
- [ ] If reopened: `reopened_reason` + `regression_evidence` recorded.

## F. Mandatory "Continue" Delta
- Last step changed:
- Next step:
- Why next step is not repetition:
