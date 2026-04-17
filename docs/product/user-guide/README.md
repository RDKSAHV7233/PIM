# Vexa PIM User Guide Bundle

This folder now includes procedural, action-oriented documentation.

## Primary documents
- `PAGE_ACTION_PLAYBOOK_INDEX.md` (page-by-page how-to index)
- `playbooks/*.md` (one step-by-step playbook per route)
- `FUNCTIONALITY_WISE_GUIDE.md` (workflow runbook by module)
- `PAGE_GUIDE_INDEX.md` and `pages/*.md` (reference inventory, kept for traceability; connector-critical routes are manually aligned to the current lifecycle mapping flow)

## Coverage
- Route playbooks: 47
- Source scope: `apps/web/src/app/**/page.tsx` + first-level imported components

## Validation policy
- Uses only validated code references from current TEJ PIM source.
- If control labels are dynamic/not explicit, playbooks keep wording generic and reference action IDs.
