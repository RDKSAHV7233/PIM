# Vexa PIM Documentation Structure

Last updated: 2026-06-15

The codebase is the source of truth. Start with the canonical docs below and use dated execution or review files only as historical evidence.

## Canonical Entry Points

- `../README.md`
- `getting-started.md`
- `installation.md`
- `configuration.md`
- `user-guide.md`
- `admin-guide.md`
- `api.md`
- `developer-guide.md`
- `architecture.md`
- `connectors/README.md`
- `execution/CURRENT_STATE.md`
- `../qa/realistic-data/README.md`
- `troubleshooting.md`
- `faq.md`

## Canonical By Area

- `docs/connectors/README.md`
  - Current connector index and launch-state summary
  - Use this before opening any dated connector planning file
- `docs/product/PRD.md`
  - Product reference document
  - Supporting reference only; code and tests still win on behavior
- `docs/execution/CURRENT_STATE.md`
  - Stable current-state summary
  - Use this instead of older "Vx addendum" style status notes
- `docs/openapi.yaml` and `docs/openapi.json`
  - Generated API contract
  - Do not hand-edit
- `qa/realistic-data/README.md`
  - Canonical realistic QA data pack guide

## Historical Or Supporting Material

These folders are intentionally retained, but they are not the live documentation set:

- `docs/execution/CURRENT_STATE.md`
  - Canonical current-state summary retained inside the execution folder for discoverability
- `docs/execution/INCREMENT_STATE.json`
  - Active delivery-governance ledger
- `docs/execution/**` except `CURRENT_STATE.md` and `INCREMENT_STATE.json`
  - Dated evidence, rollout snapshots, gate outputs, and review records
- `docs/review/**`
  - Review packs, PR summaries, and signoff memos
- `docs/product/user-guide/**`
  - Older generated playbook bundle; useful for traceability, not canonical
- `docs/ports/**`
  - Historical transfer material
- `docs/architecture/*.docx`, `docs/design/*.html`, `docs/*.pdf`
  - Imported or exported reference artifacts
- `unused/docs-legacy/**`
  - Explicit legacy storage

## Cleanup Rule

When a document becomes superseded:

1. Remove it from canonical entry points.
2. Either delete the duplicate outright or move it under `unused/docs-legacy/` if it still has audit value.
3. Update this file and `README.md` in the same change.
