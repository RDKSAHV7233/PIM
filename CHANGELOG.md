# Changelog

All notable changes to PIM1. Format: [date] - commit SHA - summary.

---

## [2026-03-19] - bf77c26
### Changed
- Refreshed CURRENT_STATE.md, PRD.md, and the domain model reference to reflect the current increment ledger and release-readiness state.

## [2026-03-19] - d3ac876
### Changed
- Added connector implementation status metadata so Amazon India and Meesho are labeled honestly in connector surfaces.
- Sellers now see limited or export-only channel messaging before attempting publish workflows.

## [2026-03-19] - b0fdca2
### Changed
- Split api.ts into domain-focused modules under src/lib/api/ while keeping the public barrel stable for callers.

## [2026-03-19] - bd47041
### Changed
- Split the product detail page into tab components while preserving existing server-rendered behavior and actions.

## [2026-03-19] - ca268ca
### Added
- Added the security threat model, incident response runbook, and on-call guide for operations readiness.

## [2026-03-19] - 86abab7
### Security
- Replaced shared-password auth checks with per-user bcrypt verification and a constant-time legacy fallback.
- Step-up authentication now re-verifies the stored credential path instead of relying on an environment password.
- Password reset and unlock responses now describe the real admin-assisted recovery path.

## [2026-03-19] - a4b6095
### Added
- Added baseline legal and compliance documents for terms of service, privacy policy, data retention, and DPA.

## [2026-03-19] - a8505fc
### Changed
- Changed account export to an honest admin-only manual process instead of reporting a fake queued automation path.

## [2026-03-18] - df40d7f
### Added
- Added workspace user administration for listing users, changing roles, locking, unlocking, deactivating, and setting passwords with persistent AuthIdentity lock state.

## [2026-03-17] - 60f62bd
### Performance
- Served warm billing usage reads from the current-month cache row instead of recomputing usage on every request.

## [2026-03-17] - ebd7992
### Performance
- Removed the extra catalog stats call from the dashboard home path to reduce steady-state load and latency.
