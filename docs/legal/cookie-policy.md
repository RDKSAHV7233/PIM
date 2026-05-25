---
title: Cookie Policy — Structure Skeleton
audience: internal-ops
status: draft
last_updated: 2026-05-26
owner: PO / Legal
---

> **NOTE:** This document contains the section structure and key decisions that legal counsel must populate. Claude has provided the skeleton only — including a technical inventory of cookies the platform sets. Do not publish without legal review and DPDP/IT Act alignment confirmation.

---

## 1. Scope

**[LEGAL TO FILL]**

Key decisions:
- This policy covers cookies and similar storage technologies set by the Vexa PIM web application (`yourvexa.com`)
- Applies to all users, including unauthenticated visitors to the marketing site (if any) and authenticated users of the web app

---

## 2. What Are Cookies

**[LEGAL TO FILL — standard explanation for user-facing document]**

Brief plain-language explanation: small text files stored by the browser; used for session management, preferences, and analytics.

---

## 3. Cookies Set by Vexa PIM

**Technical inventory (Claude-supplied from codebase analysis — legal must verify and supplement):**

| Cookie / Storage Key | Type | Purpose | Duration | Required |
|---------------------|------|---------|----------|----------|
| `pim_session` (or JWT in `httpOnly` cookie) | Authentication | Maintains authenticated session after login | Session / configurable expiry (JWT_EXPIRY) | Required |
| CSRF token (header-based) | Security | Prevents cross-site request forgery | Per-request | Required |
| `pim_oidc_state` | Authentication | Temporary state parameter during OIDC SSO flow | Short-lived (minutes) | Required when OIDC is used |
| `pim_oidc_nonce` | Authentication | Nonce for OIDC ID token validation | Short-lived (minutes) | Required when OIDC is used |

**[LEGAL TO CONFIRM AND SUPPLEMENT]:**
- Whether any analytics cookies are set (Vercel Analytics, PostHog, etc.)
- Whether any third-party scripts inject cookies (identify all third-party SDKs loaded in the web app)
- Whether `localStorage` or `sessionStorage` is used in place of cookies for any purpose
- Current JWT storage mechanism — `httpOnly` cookie vs. in-memory vs. `localStorage`

---

## 4. Cookie Categories

**[LEGAL TO FILL — map the inventory above to these categories]**

| Category | Description | Examples from inventory |
|----------|-------------|------------------------|
| Strictly necessary | Required for the platform to function; cannot be disabled | Session cookie, CSRF token |
| Functional | Remember preferences; optional but affect experience | [FILL if any] |
| Analytics | Measure usage patterns; require consent under DPDP | [FILL if analytics are used] |
| Marketing | Track users across sites; not currently used | None (confirm) |

---

## 5. Consent

**[LEGAL TO FILL — DPDP Act 2023 alignment required]**

Key decisions:
- Strictly necessary cookies: no consent required (legitimate interest / necessity for service delivery)
- Analytics/functional cookies: consent required under DPDP Act 2023 if they involve processing personal data
- How consent is obtained: [FILL — banner, checkbox at signup, settings page]
- How users can withdraw consent: [FILL]
- The platform currently captures DPDP consent at account creation via `acceptedTermsAt` and `dpdpConsentVersion` fields — confirm whether this covers cookie consent or if a separate mechanism is needed

---

## 6. Third-Party Cookies

**[LEGAL TO FILL]**

Key decisions:
- List all third-party services that may set cookies (Vercel, any analytics, Cloudflare, etc.)
- Confirm whether Cloudflare R2 CDN sets cookies on media serving domain
- Link to third-party privacy policies where applicable

---

## 7. How to Manage Cookies

**[LEGAL TO FILL]**

Standard section covering:
- Browser cookie settings (link to guidance for Chrome, Firefox, Safari, Edge)
- Impact of disabling strictly necessary cookies (platform will not function)
- Opt-out of analytics if applicable

---

## 8. Changes to This Policy

**[LEGAL TO FILL]**

Key decisions:
- Notice method for material changes (email notification recommended)
- Effective date and version tracking

---

## 9. Contact

**[LEGAL TO FILL]**

Data Protection contact for cookie-related queries: [FILL — cross-reference privacy policy contact]

---

## Related documents

- `docs/legal/privacy-policy.md` — Privacy Policy (covers broader data processing)
- `docs/legal/dpa.md` — Data Processing Agreement
- `docs/legal/terms-of-service.md` — Terms of Service
