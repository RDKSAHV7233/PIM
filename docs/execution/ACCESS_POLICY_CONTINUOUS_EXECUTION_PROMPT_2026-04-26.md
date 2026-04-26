# Vexa PIM Access Policy Continuous Execution Prompt

Use this prompt when you want a coding agent to execute the access-policy program continuously across a bounded release slice without stopping after analysis.

This prompt is intentionally designed for bounded continuous execution, not for pretending that the entire multi-release program can be collapsed into one unsafe batch.

## Recommended Use

Use this prompt for one of these scopes:

- `P0 Security Release`
- `P1 Enterprise Authorization hardening for currently supported scope dimensions`
- `P0 + current supported P1 validation/gating follow-through`
- `remaining pending access-policy execution for the current bounded slice, including PO validation`

Do not use this prompt to force all of `P0`, `P1`, `P2`, and `P3` into one unreviewed batch.

## One-Go Rule

Yes, you can use a single prompt for the remaining pending execution, but only if the scope is explicitly bounded.

Safe one-go target:

- remaining implementation follow-through for the current access-policy slice
- validation reruns if needed
- CI or gate wiring follow-through if still missing
- gate or signoff evidence
- PO validation update based on actual executed evidence

Unsafe one-go target:

- trying to collapse all of `P0`, `P1`, `P2`, and `P3` into one run
- claiming enterprise-ready completion beyond the implemented and validated slice

## Continuous Execution Prompt

```text
You are executing the Vexa PIM access-policy plan continuously in the real repo until the bounded execution slice is fully completed.

Repository:
- Use the real codebase, not the docs-only workspace.
- Read and obey AGENTS.md.
- Read and obey docs/execution/INCREMENT_STATE.json before editing anything.

Mission:
- Execute the assigned access-policy slice end to end.
- Do not stop after analysis, partial implementation, or a single fix.
- Continue through code changes, test updates, validation, CI/gating updates, execution evidence, and PO validation until the bounded slice is actually complete.

Execution rules:
- Respect existing uncommitted work. Do not revert unrelated changes.
- Do not rebuild or replace existing access-policy work unless regression proof exists.
- Keep changes within the current execution slice unless a direct dependency forces a scope expansion.
- If scope expands, state exactly why.
- Prefer finishing one safe release slice completely over starting a larger unfinished redesign.

Default bounded scope:
- P0 hardening and validation follow-through
- supported delegated-access enforcement already implemented in current branch
- standard command wiring
- CI/gating integration
- PO/CTO execution evidence
- PO validation based on real executed evidence

In scope for continuous execution:
- session invalidation validation and stale-token rejection coverage
- audit endpoint protection validation
- workflow content-lock validation
- connector preview/export policy validation
- denial-audit validation
- supported delegated-access validation for category, brand, channel, and connector account
- npm script wiring
- governance suite wiring
- CI workflow wiring
- execution and PO/CTO evidence docs
- PO checkpoint update from current evidence

Out of scope unless explicitly assigned:
- full role migration
- super_admin/system_admin/product_admin rollout
- unsupported scope dimensions like vendor, supplier, locale/market, team, assignee
- universal read-redaction redesign
- broad deny-by-default rewrite of all authenticated GET behavior

Required working pattern:
1. Inspect current repo state and overlapping in-flight changes.
2. Identify what is already implemented versus what is still missing in the assigned slice.
3. Implement only the missing parts.
4. Run focused tests immediately after each meaningful change.
5. Run the final validation bundle for the slice.
6. Update execution evidence docs so product and engineering can sign off on facts, not assumptions.
7. Update PO validation only after the execution evidence is current and real.
8. Report:
   - changed files
   - commands run
   - pass/fail results
   - blockers
   - whether the slice is actually complete

Stopping conditions:
- Stop only if:
  - the bounded slice is complete and validated, or
  - a real blocker prevents safe continuation, such as missing secrets, migration drift that requires destructive reset, or conflicting unowned in-progress changes.

When blocked:
- Do not vaguely say "cannot continue."
- State the exact blocker, the exact file or system involved, and the smallest next action needed to unblock.

Validation minimum for access-policy slice:
- API build passes
- web build passes when touched
- workspace-user stale-token protections pass
- workflow-lock tests pass
- access-policy remediation test passes
- delegated-access scope test passes if delegated scope code is in scope
- any new npm/CI/gating wiring is verified by local readback or command success

Truthfulness rule:
- Do not claim enterprise-ready completion if the slice only covers current supported protections.
- Separate "implemented and validated now" from "planned later."
- PO validation must be based only on commands and artifacts actually executed in the current repo state.
```

## PO/CTO Usage Note

Best practice is to pair this prompt with an explicit scope header such as:

```text
Execute continuously for P0 + supported delegated-access validation/gating only.
Do not start P2 or P3 role-maturity work.
```

That keeps the run aggressive but still safe.

## Recommended Next Invocation

```text
Execute continuously for the Vexa PIM access-policy slice covering:
- P0 hardening validation follow-through
- supported delegated-access validation
- governance suite wiring
- CI workflow wiring
- execution evidence updates
- PO validation update from current evidence

Use the real repo. Respect AGENTS.md and INCREMENT_STATE.json. Continue until this bounded slice is complete or you hit a concrete blocker with exact evidence.
```

## Single Prompt For Pending Execution With PO Validation

Use this when you want one prompt to finish the remaining pending work for the current slice:

```text
Execute continuously in one go for the remaining pending Vexa PIM access-policy slice.

Scope:
- finish any remaining implementation follow-through for the current bounded access-policy slice only
- rerun or verify the required validation bundle where needed
- ensure npm, governance, CI, increment gate, and sprint gate coverage are wired and consistent
- record gate or signoff evidence that is truthful for the current run context
- update execution evidence docs
- perform PO validation based only on the evidence executed in this run or already verified in the current branch

Do not:
- start P2 or P3 role-maturity work
- claim unsupported scope dimensions are complete
- claim full enterprise-ready authorization
- fabricate deploy-backed staging proof from local-only execution

Use the real repo. Read and obey AGENTS.md and docs/execution/INCREMENT_STATE.json. Respect existing in-flight changes. Continue until this bounded slice is actually complete or you hit a concrete blocker with exact evidence.
```
