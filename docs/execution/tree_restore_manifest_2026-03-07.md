# Tree Restore Manifest - 2026-03-07

## Reason
Restore UI and connector work from 2026-03-06 that was moved into `unused/archive` but is still needed as active TEJ PIM working material.

## Restored Paths
- `unused/archive/docs/architecture/enterprise-docs-20260307/**` -> `docs/architecture/enterprise-docs/**`
- `unused/archive/docs/product/user-guide-20260307/**` -> `docs/product/user-guide/**`
- `unused/archive/scripts/build_user_guide_pdf.py` -> `scripts/build_user_guide_pdf.py`
- `unused/archive/scripts/generate_page_action_playbooks.py` -> `scripts/generate_page_action_playbooks.py`
- `unused/archive/ports/orbit-TEJ PIM-transfer-2026-03-06/**` -> `docs/ports/orbit-TEJ PIM-transfer-2026-03-06/**`

## Not Restored
- `unused/archive/docs/execution/rollout/**`
- `unused/archive/temp/qa-ui-crawl.json`

## Validation Plan
- `npm run build`
- `npm test`
