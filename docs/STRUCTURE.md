# PIM1 Documentation Structure (Canonical)

- Current canonical snapshot: `docs/execution/CURRENT_STATE.md`
- Connector documentation entry point: `docs/connectors/README.md`

## Active canonical structure
- `docs/connectors/`
  - `README.md` (canonical connector-documentation entry point)
  - `PIM1_CONNECTOR_CURRENT_STATE_2026-03-08.md` (current connector implementation baseline)
- `docs/product/`
  - `PRD.md`
  - `PRD_SOURCES.md`
  - `FIRST_SELLER_ONBOARDING_PLAYBOOK.md`
- `docs/architecture/`
  - `PIM1_Final_Architecture_March2026_v3.docx`
  - `PIM1_Connector_First_Redesign_March2026.docx`
  - `enterprise-docs/` (generated reference bundle; useful reviewer material, not canonical source-of-truth)
- `docs/execution/`
  - `CURRENT_STATE.md`
  - `INCREMENT_STATE.json`
  - `INCREMENT_EXECUTION_MODEL.md`
  - `PIM1_Execution_Plan_March2026_v2_(1)_tracked.docx`
  - `PRD_TO_ENGINEERING_BACKLOG.md`
  - execution evidence files under `E*.md`
  - gate artifacts under `gates/`
  - rollout artifacts under `rollout/`
- `docs/strategy/`
  - `PIM1_Enhanced_CTO_PO_Plan_March2026.docx`
- `docs/design/`
  - `PIM1_UI_Design_Review.html` (reference design review, not the live route/source contract)
- `docs/product/user-guide/`
  - generated operational guide bundle
  - regenerated against the current mapping lifecycle and canonical `/channels/mappings` flow
  - supporting reference only; not the primary connector implementation truth over PRD/code/INCREMENT state
- `docs/ports/`
  - `orbit-pim1-transfer-2026-03-06/` (historical transfer pack retained for traceability; not current implementation truth)
- `docs/runbooks/`
  - `auth-bootstrap-admin.md`
  - `credential-key-rotation.md`
  - `test-data-governance.md`

## Archived (legacy / duplicate)
- `unused/docs-legacy/2026-03-03/` (older and duplicate imported document variants)
- `unused/docs-legacy/codex-handoff-2026-03-02/` (older handoff pack)
- `unused/docs-legacy/imports/` (previous import staging folder)

## Rule
When a newer canonical version is adopted, move superseded variants to `unused/docs-legacy/<date>/` and update this file.
