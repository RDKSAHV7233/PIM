---
title: Responsible Disclosure Policy
audience: sellers
status: skeleton — Security/Legal to complete
last_updated: 2026-05-25
owner: Engineering + Legal
---

> **Note to Engineering/Legal:** This skeleton contains the standard structure for a responsible disclosure (bug bounty) policy. Legal must review the safe-harbour language and scope exclusions. Engineering must confirm the contact channel and response SLAs before publishing.

---

## Our Commitment

Vexa PIM is committed to keeping our platform and our customers' data secure. We welcome reports from security researchers and the community about potential vulnerabilities.

If you discover a security vulnerability in Vexa PIM, please report it to us. We will:
- acknowledge your report within **[Engineering: set — e.g., 2 business days]**;
- investigate and keep you informed of our progress;
- credit you in our security acknowledgements if you wish; and
- not take legal action against researchers who follow this policy.

---

## How to Report

Send your report to: **admin@vexapim.com**

Include in your report:
- A description of the vulnerability
- Steps to reproduce
- The potential impact
- Any proof-of-concept code or screenshots (do not include actual customer data)

For sensitive reports, use our PGP key: **[Engineering: publish PGP public key or link]**

---

## In Scope

The following systems are in scope for responsible disclosure:

- `app.vexapim.com` — production API and web application
- `api.vexapim.com` — API endpoints
- Authentication and session management
- API key and JWT handling
- Multi-tenant data isolation
- Stripe webhook endpoint

---

## Out of Scope

The following are **not** in scope:

- Denial of service attacks or resource exhaustion
- Social engineering of Vexa PIM employees
- Physical access to our infrastructure
- Vulnerabilities in third-party services (Neon, Cloudflare, Railway, Stripe) — report these directly to those providers
- Automated scanning without prior written permission
- Vulnerabilities already reported by another researcher
- Issues in non-production or staging environments
- **[Engineering: add any other exclusions]**

---

## Safe Harbour

We will not pursue legal action against researchers who:
- make a good-faith effort to avoid privacy violations, data destruction, or service disruption;
- report the issue to us before public disclosure;
- do not access or modify data belonging to other users; and
- follow this policy.

**[Legal: review and expand this safe-harbour clause to ensure it is legally sound under Indian jurisdiction]**

---

## Disclosure Timeline

We ask that you:
- **Do not publicly disclose the vulnerability** before we have had a reasonable opportunity to fix it.
- Give us at least **[Engineering: set — e.g., 90 days]** from your initial report before public disclosure.
- Notify us before disclosing, even after the 90-day window, if you believe a fix has not been deployed.

We will aim to:
- Acknowledge your report within **[Engineering: set]** business days.
- Confirm whether the report is in scope within **[Engineering: set]** business days.
- Provide a timeline for remediation within **[Engineering: set]** days of confirmation.
- Notify you when the fix has been deployed.

---

## Recognition

Researchers who responsibly disclose valid vulnerabilities will be acknowledged in our security hall of fame **[Engineering: create page or section]**, unless they prefer to remain anonymous.

We do not currently offer a paid bug bounty program. **[Product: decide if/when to introduce bounties]**

---

## Contact

Security reports: **[Engineering: set email]**  
General security questions: **[Engineering: set email or link to support]**

---

## Key Decisions

- [ ] Set contact email address for security reports
- [ ] Decide on PGP key publication
- [ ] Set response SLA commitments (acknowledgement, triage, timeline)
- [ ] Set disclosure timeline (90 days is standard)
- [ ] Legal: review safe-harbour language for India jurisdiction
- [ ] Decide on paid bug bounty (no / future / amounts)
- [ ] Create security acknowledgements / hall of fame page
