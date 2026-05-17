# ADR-010: OIDC SSO is Opt-In for Pilot; Enforcement Awaits Gate C

- Date: 2026-05-17
- Status: Accepted

## Problem

PR #71 (INC-39) shipped OIDC SSO backend: `OidcConfig` model, OIDC login flow at `GET /auth/oidc/login` and `GET /auth/oidc/callback`, and admin CRUD endpoints `POST/GET/DELETE /auth/oidc-config`.

The question was whether to (a) claim OIDC support immediately with operator-mediated configuration, (b) gate any OIDC claim behind an admin UI, or (c) treat OIDC as roadmap-only.

## Options Considered

1. Claim "OIDC supported" with operator-mediated API configuration.
2. Build admin UI page before any OIDC claim. Block the claim until shipped.
3. Roadmap-only — do not surface OIDC to customers until enterprise readiness ships.

## Decision

Originally **Option 1**: bounded claim — "OIDC SSO login is available; IdP configuration is operator-mediated for the pilot period."

**Amended 2026-05-17 (same day) to a strengthened Option 1**: the admin IdP configuration UI at `/admin/auth-policy/oidc` shipped within the same sprint along with a new `auth_config_high_risk` step-up scope. The current bounded claim is: "OIDC SSO login is available with self-serve admin IdP configuration; OIDC enforcement (require-OIDC) remains gated on Gate C closure."

Sales may now describe OIDC as self-serve for IdP configuration. The "OIDC enforced" claim remains forbidden until Gate C closes.

A tenant requiring SSO during the pilot now follows the self-serve path: admin logs in, visits `/admin/auth-policy/oidc`, fills in IdP issuer/clientId/clientSecret/callbackUrl plus their password to satisfy step-up, saves, and the workspace is OIDC-enabled. Operator assistance is no longer required for the configuration step.

## Consequences

Positive:
- Customers can self-configure their identity provider without operator API access.
- Step-up password confirmation on every config mutation defends against hijacked-admin-session attacks rewiring sign-in silently.
- Admin role gate + step-up scope + parent-session-binding (StepUpGuard) is defense-in-depth equivalent to the existing mapping-high-risk pattern.

Negative / mitigations:
- The "OIDC enforced" claim remains forbidden because tenant-level enforcement (require-OIDC-for-all-users) is part of Gate C, not this admin UI. Mitigated by V4 PO sign-off keeping "OIDC fully enforced" on the forbidden list.
- Step-up tokens are short-lived; admins doing back-to-back changes must re-enter their password. Acceptable for an auth-critical surface.

## Revisit when

- Gate C closes (RG-C4 / RG-C5 / RG-C6), at which point "OIDC enforcement" can be claimed.
- A future product decision adds tenant-level "require OIDC for all users" toggle. That requires a separate ADR because it changes the security posture for non-admin users.
