---
title: Cookie Policy
audience: sellers
status: draft — legal review required before publication
last_updated: 2026-09-03
owner: PO / Legal
---

> **NOTE:** This document contains the section structure and a verified technical
> inventory of cookies the platform sets. Legal counsel must review the regulatory
> language, consent mechanism, and DPDP Act alignment before publication.

---

## 1. Scope

This policy covers cookies and similar storage technologies set by the Vexa PIM
web application. It applies to all authenticated users of the web app. The
platform does not currently serve a public marketing site with its own cookie
behavior.

---

## 2. What Are Cookies

Cookies are small text files stored by the browser when you use a web
application. Vexa PIM uses cookies for session management, security, and locale
preferences. The platform does not use cookies for advertising or cross-site
tracking.

---

## 3. Cookies Set by Vexa PIM

Technical inventory (verified from codebase on 2026-09-03):

| Cookie | Type | Purpose | httpOnly | Secure | SameSite | Duration | Required |
|--------|------|---------|----------|--------|----------|----------|----------|
| `pim_access_token` | Authentication | JWT access token for authenticated sessions | Yes | Yes (production) | Lax | Configurable (default 4 hours) | Required |
| `pim_refresh_token` | Authentication | Refresh token for silent session renewal | Yes | Yes (production) | Strict | 7 days | Required |
| `pim_csrf_token` | Security | CSRF protection — client echoes in `x-csrf-token` header | No | Yes (production) | Lax | Matches access token | Required |
| `pim_locale` | Functional | User locale preference for i18n | Read-only | — | — | Browser session | Optional |
| `pim_mfa_pending_token` | Authentication | Temporary token during MFA login verification | Yes | Yes (production) | Strict | Short-lived (minutes) | Required during MFA |
| `pim_mfa_enrollment_token` | Authentication | Temporary token during MFA enrollment | Yes | Yes (production) | Strict | Short-lived (minutes) | Required during MFA enrollment |

**Browser storage:** The platform uses `localStorage` in one location
(`login-page-client.tsx`) for remembering the last workspace identifier. No
sensitive data is stored in `localStorage` or `sessionStorage`.

**Third-party cookies:** The platform does not load third-party analytics SDKs
(no Vercel Analytics, PostHog, Google Analytics, or similar). Cloudflare R2 is
used for media serving but does not set cookies on the media domain. No
marketing or tracking cookies are set.

---

## 4. Cookie Categories

| Category | Description | Cookies |
|----------|-------------|---------|
| Strictly necessary | Required for the platform to function; cannot be disabled | `pim_access_token`, `pim_refresh_token`, `pim_csrf_token`, `pim_mfa_pending_token`, `pim_mfa_enrollment_token` |
| Functional | Remember preferences; optional but improve experience | `pim_locale`, `localStorage` workspace identifier |
| Analytics | Measure usage patterns | None currently set |
| Marketing | Track users across sites | None — not used |

---

## 5. Consent

The platform captures DPDP consent at account creation via `acceptedTermsAt`
and `dpdpConsentVersion` fields on the user account. All cookies set by the
platform are strictly necessary for authentication and security, or functional
for locale preferences.

**[LEGAL TO CONFIRM]:**
- Whether strictly necessary cookies require separate consent under DPDP Act 2023
- Whether a cookie consent banner is required given only strictly necessary and
  functional cookies are set
- How users can withdraw consent for functional cookies (locale preference)

---

## 6. Third-Party Cookies

The platform does not currently set or rely on third-party cookies. The
following third-party services are used but do not inject cookies into the
application domain:

- **Cloudflare R2** — media file storage and serving
- **Railway** — application hosting (does not set user-facing cookies)
- **Stripe** — payment processing (loaded only on checkout pages when enabled;
  Stripe's own cookie policy applies to Stripe-hosted elements)

---

## 7. How to Manage Cookies

You can manage cookies through your browser settings. Note that disabling
strictly necessary cookies (`pim_access_token`, `pim_refresh_token`,
`pim_csrf_token`) will prevent the platform from functioning — you will not be
able to sign in or maintain a session.

Clearing the `pim_locale` cookie will reset your locale preference to the
default.

---

## 8. Changes to This Policy

Material changes to this cookie policy will be communicated to active users
before taking effect. The effective date and version are tracked in the document
metadata.

---

## 9. Contact

For cookie-related queries, contact the Data Protection contact listed in the
Privacy Policy (`docs/legal/privacy-policy.md`).

---

## Related documents

- `docs/legal/privacy-policy.md` — Privacy Policy (covers broader data processing)
- `docs/legal/dpa.md` — Data Processing Agreement
- `docs/legal/terms-of-service.md` — Terms of Service
