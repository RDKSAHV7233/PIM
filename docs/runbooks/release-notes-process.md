---
title: Release notes process
audience: internal-engineering
status: active
last_updated: 2026-03-19
owner: Engineering Lead
---

## Two audiences, two files

- `CHANGELOG.md` - engineering audience, one entry per deploy, includes SHA
- `docs/product/RELEASE_NOTES.md` - seller audience, grouped by week, plain language only, omit internal-only changes

## When to update

Update both files as part of every PR that goes to main. Add the entry in the same commit as the feature, not after deploy.

## Commit convention for changelog entries

Use this format in the PR description so entries can be extracted later:

```text
changelog: [Section] One-sentence description
```

Examples:

```text
changelog: [Security] Replace shared-password auth with per-user bcrypt
changelog: [Added] Workspace user invite, lock, and deactivate flows
changelog: [Performance] Dashboard billing cache reduces cold-path recompute
```

## What goes in RELEASE_NOTES.md

Include if: sellers see the change in the UI, a flow changes, a new feature is available, or a limitation is resolved.

Omit if: internal refactor only, test coverage, documentation, CI change, or a performance improvement that is not visible to sellers.

## Backfill policy

When a significant unreleased change is discovered without a changelog entry, backfill it in a `docs:` commit with the original deploy date. Do not omit it to keep the log clean - an honest late entry is better than a gap.
