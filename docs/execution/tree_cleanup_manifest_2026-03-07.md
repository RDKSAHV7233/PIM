# Tree Cleanup Manifest - 2026-03-07

## Baseline
- Stable active baseline commit: `c577216`
- Cleanup rule: move only post-baseline material that is not part of runtime, tests, migrations, deploy, or active execution evidence.

## Moved To `unused/archive`

### Generated documentation
- `docs/architecture/enterprise-docs/**` -> `unused/archive/docs/architecture/enterprise-docs-20260307/**`
- `docs/product/user-guide/**` -> `unused/archive/docs/product/user-guide-20260307/**`

### Generation scripts
- `scripts/build_user_guide_pdf.py` -> `unused/archive/scripts/build_user_guide_pdf.py`
- `scripts/generate_page_action_playbooks.py` -> `unused/archive/scripts/generate_page_action_playbooks.py`

### Older untracked rollout snapshots
- `docs/execution/rollout/2026-03-05T11-07-05.228Z_CONTROLLED_ROLLOUT_SNAPSHOT.json` -> `unused/archive/docs/execution/rollout/`
- `docs/execution/rollout/2026-03-05T11-23-26.631Z_CONTROLLED_ROLLOUT_SNAPSHOT.json` -> `unused/archive/docs/execution/rollout/`
- `docs/execution/rollout/2026-03-05T15-07-23.074Z_CONTROLLED_ROLLOUT_SNAPSHOT.json` -> `unused/archive/docs/execution/rollout/`
- `docs/execution/rollout/2026-03-05T17-26-58.572Z_CONTROLLED_ROLLOUT_SNAPSHOT.json` -> `unused/archive/docs/execution/rollout/`

## Explicitly Kept
- `AGENTS.md`
- `docs/execution/INC01_ENTRY_DRY_RUN_2026-03-04.md`
- `docs/execution/INCREMENT_EXECUTION_MODEL.md`
- `docs/execution/PHASE_STATE.json`
- `docs/execution/PROD_READINESS_RISK_REGISTER.md`
- `docs/execution/TASK_EXECUTION_CHECKLIST.md`
- Gate artifacts still referenced by retained rollout evidence and increment tracking
