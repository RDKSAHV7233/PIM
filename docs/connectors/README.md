# PIM1 Connector Documentation Index

Status: Canonical connector-documentation entry point  
Date: 2026-03-08

## Purpose

This file is the entry point for connector-development documentation in PIM1.

Use this page first to determine:
- which connector documents are current
- which documents are historical only
- which code surfaces are the live implementation truth

## Canonical current-state document

- `docs/connectors/PIM1_CONNECTOR_CURRENT_STATE_2026-03-08.md`

This is the current connector planning baseline for PIM1.

## Historical / superseded external artifacts

These documents are retained as historical reference only. Do not use them as current sprint-planning or implementation authority.

- `C:\Users\Om Computers\Downloads\PIM1_connector_plan_review_2026-03-04.docx`
- `C:\Users\Om Computers\Downloads\PIM1_CONNECTOR_DEVELOPER_GUIDE_FINAL_2026-03-06.pdf`

Reason:
- they reference older file paths and older route surfaces
- they predate the current mapping lifecycle, rollback, step-up re-auth, and canonical mapping UI implementation

## Live implementation truth

For connector engineering, trust the current repo code in this order:

### API and connector domain
- `apps/api/src/marketplace/**`
- `apps/api/src/auth/**`
- `apps/api/src/connector-framework/**`

### Web connector UX
- `apps/web/src/app/channels/mappings/**`

### Database contracts
- `packages/db/prisma/**`

### Product and release control
- `docs/product/PRD.md`
- `docs/execution/INCREMENT_STATE.json`

## Important non-authoritative surfaces

These are currently behind the live connector implementation and must not be treated as sole truth:

- `docs/openapi.json`
- `docs/openapi.yaml`
- `docs/product/user-guide/**`

## Current connector state summary

As of 2026-03-08:
- mapping lifecycle exists
- rollback exists
- step-up re-auth exists for high-risk mapping actions
- canonical editable mapping path is `/channels/mappings`
- legacy connector mapping path is transition-only
- runtime discovery is hybrid, not plugin-dynamic
- broad rollout readiness is still blocked by open release gates

For the full current-state detail, use:
- `docs/connectors/PIM1_CONNECTOR_CURRENT_STATE_2026-03-08.md`
