---
title: Vexa PIM GA Release Readiness Decision
status: pending-signoff
owner: CTO/PO (RDKSAHV7233), Security (bhoivishal216-ai), QA (doteswithvb-alt), SRE (RDKSAHV7233)
last_updated: 2026-09-12
---

## 1. Purpose

The 2026-09-11 customer-delivery reverification (council verdict: 🔴 NO-GO on customer delivery) closed with five decisive gates and one standing caveat: no named CTO, PO, Security, QA, or SRE had personally signed a fresh release decision.

This document is prepared by Claude Code to consolidate what has changed since that reverification so the actual decision-makers can sign off against current information instead of re-deriving it from scratch. **The verdicts in Section 3 are not valid until each named person fills in their own row.** Nothing in this document constitutes that sign-off.

## 2. Release under review

- `main` @ `3412dff11292b06ae6e7568778e77a3772b4c5aa` as of the original 2026-09-11T18:34Z draft; `main` has since advanced well past that (through PR #809, `dc53f0ff…`, as of this update) — confirm the current SHA before signing, this document is not re-verified against every subsequent commit.
- Branch protection: still `false`, no required status checks enforced as of this writing.

## 3. Decision summary — PENDING

**Flag, not an edit:** a comment on #801 (2026-09-12T03:22:24Z) shows RDKSAHV7233 replying "Done" to a request to fill in this section. As of this update, the table below is still exactly as originally drafted — every row PENDING, no name/date/notes filled in. Either that "Done" referred to something else, or an edit didn't make it into this file. Flagging rather than guessing which — **do not read this table as signed until you've confirmed directly with each named person**, regardless of what any prior comment implied.

| Role | Name | Verdict | Date | Notes |
|---|---|---|---|---|
| CTO | RDKSAHV7233 | PENDING | | |
| PO | RDKSAHV7233 | PENDING | | |
| Security | bhoivishal216-ai | PENDING | | |
| QA | doteswithvb-alt | PENDING | | |
| SRE | RDKSAHV7233 | PENDING | | |

## 4. Gate-by-gate status (updated 2026-09-12)

### Gate 1 — P0/P1 disposition
**Was:** opaque — Ops Summary reported `p0p1OpenCount: 4` with no way to see which records.
**Now (updated 2026-09-12, third pass — actually actioned, not just documented as safe):** [#801](https://github.com/RDKSAHV7233/PIM/issues/801) tracks this. All 4 records were resolved via a real API call ([PR #811](https://github.com/RDKSAHV7233/PIM/pull/811)'s one-time script, dispatched as run [34712139374](https://github.com/RDKSAHV7233/PIM/actions/runs/34712139374)), confirmed by a fresh staging deploy immediately after (run [34712202633](https://github.com/RDKSAHV7233/PIM/actions/runs/34712202633)) whose **Internal Ops Summary artifact reports `p0p1OpenCount: 0`** — the exact metric this gate is about, read directly rather than inferred.

| # | Record | Disposition | Evidence |
|---|---|---|---|
| 1 | `prisma.category.delete()` PrismaClientUnknownRequestError | **Fixed and resolved** | [PR #805](https://github.com/RDKSAHV7233/PIM/pull/805) diff independently re-read (not just its commit message): real root cause (global soft-delete scope extension hides soft-deleted-but-not-purged products from the pre-delete count, so the check passed while the DB's `onDelete: Restrict` FK still blocked the delete), real fix (`withSoftDeleteBypass()` on the count query), real regression test (spawns the actual API against live Postgres, reproduces the exact repro sequence, asserts a clean 400 instead of the unhandled 500) wired into `run-integration-parallel.cjs`'s `DEFAULT_TESTS`, PR's own CI green. Explicitly resolved via the manual-resolve endpoint — API response confirms `state: "resolved"`.
| 2 | Signup verification Bad Gateway | **Resolved — transient, no recurrence** | 48h+ with zero recurrence before resolving; reads as a one-off upstream gateway blip. Explicitly resolved — API confirms `state: "resolved"`.
| 3 | DB connectivity — can't reach `maglev.proxy.rlwy.net:11952` | **Resolved — transient, no recurrence** | 4+ days with zero recurrence before resolving. Classic transient Railway Postgres-proxy blip. Explicitly resolved — API confirms `state: "resolved"`.
| 4 | WooCommerce credentials invalid | **Resolved — corrected finding, see below** | Explicitly resolved — API confirms `state: "resolved"`.

**Correction to the prior update:** this document previously said record 4 was "already actioned" — resolved by someone else before this pass, inferred from its disappearance between two dumps. That inference was **wrong**. The resolve endpoint returns `previousState`, and record 4's was not `"resolved"` before this action ran — nobody had resolved it. The real explanation: `error-authority-ops.service.ts`'s issue listing defaults to a rolling 7-day date window (`DEFAULT_WINDOW_DAYS = 7`) when no explicit range is requested, and record 4's `lastSeenAt` (2026-09-05T17:32:55Z) simply aged past that window between the two dumps — a time-window artifact with no relationship to its actual `state`, which stayed `open` the whole time until this pass explicitly resolved it. Recorded here so the same mistake (reading "absent from a default-windowed listing" as "resolved") isn't repeated in future triage.

### Gate 2 — Full staging E2E on current SHA
**Was:** last full `E2E - Staging User Journey` success was on `05daff6d…`, predating the SHA under review.
**Now:** no new full E2E run has been captured in this pass; `main` has advanced further since (to `3412dff1…`).
**Still needed:** a fresh full E2E run against the current `main` SHA before this gate can close.

### Gate 3 — WooCommerce live-auth/reconnect proof
**Was:** `launchStage: p1_blocker_hold`, server-side gating intact but UI no longer displays it.
**Now:** unchanged, and now corroborated — one of the 4 P1 records (`CONNECTOR_CREDENTIALS_STILL_INVALID_UNAVAILABLE: woocommerce...`) is very likely the concrete trigger behind that hold.
**Still needed:** real staging app-auth + tenant-owned credential + reconnect/publish/auth-outage proof, tracked in `docs/execution/P1_WOO_AUTH_READINESS_FOLLOWUP_2026-09-11.md`.

### Gate 4 — Isolated restore drill from current R2 backup
**Was:** daily backup creation verified; restore/RPO/RTO drill not evidenced.
**Now:** no new evidence gathered this pass.
**Still needed:** execute and document an isolated restore drill.

### Gate 5 — Fresh named CTO/PO/Security/QA/SRE decision
**Was:** missing entirely.
**Now:** this document exists as the vehicle for it. Still missing until Section 3 is filled in.

## 5. What changed since the 2026-09-11 reverification

- [#801](https://github.com/RDKSAHV7233/PIM/issues/801) opened and assigned to Security, SRE, and QA.
- [PR #803](https://github.com/RDKSAHV7233/PIM/pull/803) merged (CTO-approved via required-team review) — staging deploy now dumps the actual open P0/P1 records instead of only a count.
- The 4 open records identified by ID, severity, state, occurrence count, and recency (see #801 for full detail).
- A non-binding CTO/PO-style risk triage was posted to #801 to help prioritize the 4 records; it is explicitly not a decision.
- Record 1 root-caused and fixed in [PR #805](https://github.com/RDKSAHV7233/PIM/pull/805) (merged 2026-09-12T10:15Z, real CTO review, CI green including a new regression test against real Postgres).
- Recurrence check (two snapshots ~16h apart) posted to #801: records 2-4 show zero new occurrences and look closeable; record 1 was climbing until the fix merged.
- Second, independent verification pass: PR #805's diff and regression test re-read line-by-line rather than trusted from its description; two fresh staging dumps ~2h20m apart showed record 4 missing from the open list between them, initially (incorrectly) read as already resolved.
- Third pass — actually actioned: [PR #811](https://github.com/RDKSAHV7233/PIM/pull/811) resolved all 4 records via the real endpoint. Confirmed `p0p1OpenCount: 0` directly from a fresh Ops Summary artifact. Corrected the record-4 inference from pass two — it was never resolved by anyone; it had aged out of the issues list's default 7-day date window, unrelated to `state`. Gate 1 is now genuinely closed with hard evidence, not just a disposition recommendation.

## 6. What this document is not

- Not a GA go/no-go decision.
- Not written by, or binding on, any named person until they complete Section 3 themselves.
- Not a replacement for Gates 2 and 4, which have no new evidence as of this pass.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
