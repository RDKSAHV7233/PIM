---
title: Welcome / Onboarding Email
status: backlog
priority: medium
depends_on: email-production-readiness (branded template wrapper)
---

## Purpose

Send a welcome email after workspace verification completes. This is the first branded touchpoint post-signup and should orient the admin toward their next action.

## Trigger

After `SignupService.verifyWorkspace()` succeeds and the workspace + admin identity are provisioned.

## Content sketch

- **Subject:** Welcome to Vexa PIM — your workspace is ready
- **Signature type:** `default`
- **CTA:** "Go to your workspace" -> `{webBaseUrl}/{workspaceSlug}/dashboard`
- **Body (text):**
  - Confirm workspace name and admin email
  - Link to getting-started guide (if one exists) or first-steps checklist
  - Mention trial period length from `PIM_COMMERCIAL_TRIAL_DAYS`
- **Footer reason:** "You received this email because you created a Vexa PIM workspace."

## Design constraints

- Must use the shared `renderEmailHtml` / `renderEmailText` wrapper from `email-template.ts`
- No tracking pixels, no inline base64 images
- Plain text body must be fully readable without HTML
- Do not include password or sensitive data in the email body
- Only send if the workspace was actually created (idempotency: do not re-send on duplicate verify calls)

## Implementation notes

- Add `welcome_onboarding` to `AuthEmailMessage.category` union
- Consider making this a queued job (BullMQ) so verification response is not blocked by email delivery
- Trial days should come from env, not hardcoded
