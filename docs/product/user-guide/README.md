# PIM1 User Guide Bundle

This folder now includes procedural, action-oriented documentation.

- Current route baseline source: `apps/web/src/app/**/page.tsx`
- Current shell baseline source: `apps/web/src/components/nav/app-sidebar.tsx`
- Current execution snapshot: `docs/execution/CURRENT_STATE.md`
- Current repo head at last guide alignment: `5a64683`

## Primary documents
- `PAGE_ACTION_PLAYBOOK_INDEX.md` (page-by-page how-to index)
- `playbooks/*.md` (one step-by-step playbook per route)
- `FUNCTIONALITY_WISE_GUIDE.md` (workflow runbook by module)
- `PAGE_GUIDE_INDEX.md` and `pages/*.md` (reference inventory, kept for traceability)

## Coverage
- Route playbooks: 47
- Source scope: `apps/web/src/app/**/page.tsx` + first-level imported components

## Validation policy
- Uses only validated code references from current PIM1 source.
- If control labels are dynamic/not explicit, playbooks keep wording generic and reference action IDs.
