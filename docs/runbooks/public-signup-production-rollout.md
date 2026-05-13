---
title: Vexa PIM Public Signup Production Rollout Runbook
audience: internal-ops
status: active
last_updated: 2026-03-26
owner: DevOps + Product
---

## 1. Purpose

Use this runbook when enabling or disabling Vexa PIM public self-serve signup in production.

This runbook is for controlled production rollout only. It assumes signup has already passed:

- local integration validation
- staging deploy validation
- staging nightly E2E validation

## 2. Current production contract

Public signup is controlled by runtime flags on both services:

- API: `FEATURE_PUBLIC_SIGNUP_ENABLED=true|false`
- Web: `NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED=true|false`
- Web: `FEATURE_PUBLIC_SIGNUP_ENABLED=true|false`

When enabling signup, set all three flags to `true`.

Why both web flags matter:

- `NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED` controls client-side exposure, including the login CTA
- `FEATURE_PUBLIC_SIGNUP_ENABLED` is still used by server-side route gating, so `/signup` can remain hidden if this fallback flag is left `false`

## 3. Preconditions before enabling

1. Latest `CI` run is green on the exact commit you plan to deploy.
2. Latest `Deploy Staging` run is green with `Public signup smoke check` passing.
3. Latest `E2E - Staging User Journey` run is green with signup enabled.
4. Production email delivery is ready:
   - `AUTH_EMAIL_PROVIDER=resend`
   - `AUTH_EMAIL_RESEND_API_KEY` present
   - `AUTH_EMAIL_FROM` present and verified
5. Auth remains in database mode:
   - `AUTH_MODE=db`
6. Queue and Redis production contract remains healthy:
   - `QUEUE_BACKEND=bullmq`
   - `QUEUE_WORKER_ENABLED=true`
   - `REDIS_URL` present

## 4. Enable production rollout

1. In Railway production:
   - API service: set `FEATURE_PUBLIC_SIGNUP_ENABLED=true`
   - Web service: set `NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED=true`
   - Web service: set `FEATURE_PUBLIC_SIGNUP_ENABLED=true`
2. Redeploy both services on the same git SHA.
3. Wait for API health to recover:
   - `GET /api/v1/health`
4. Confirm the production login page now shows the signup CTA.
5. Confirm `/signup` loads on the deployed web app.

## 5. Non-destructive production validation

These checks do not create a real tenant:

1. `GET /api/v1/signup/workspace/availability?workspaceSlug=<unused-slug>`
   - expect `200`
2. `POST /api/v1/signup/workspace` with `acceptedTerms=false`
   - expect `400`
   - expect `TERMS_ACCEPTANCE_REQUIRED`
3. `POST /api/v1/signup/verify` with a bogus token
   - expect `401`
   - expect `SIGNUP_VERIFICATION_TOKEN_INVALID`
4. `GET /signup`
   - expect the `Create your Vexa PIM workspace` heading

If production email delivery is available and you want full validation:

5. Complete one real controlled signup using an internal test mailbox.
6. Verify the new workspace can sign in.
7. Confirm the new tenant resolves to `STARTER`.

If a non-production environment is intentionally using `AUTH_EMAIL_PROVIDER=console`, you can still validate the full flow by extracting the verification link from Railway API logs:

5. Set:
   - `RAILWAY_TOKEN`
   - `STAGING_BASE_URL`
   - `STAGING_WEB_URL`
6. Run:
   - `npm run release:staging:signup-console-verify`
7. Expect:
   - signup create -> `pending_verification`
   - signup verify -> `verified`
   - login -> `201`

## 6. Post-enable monitoring

Watch these signals for the first 24 hours:

1. Railway logs for auth or email-delivery failures.
2. Production health endpoint:
   - `status: "ok"`
   - correct `env`
3. Unexpected spikes in:
   - `401`
   - `429`
   - signup email delivery failures
4. Signup KPI trends for newly created tenants through `/metrics/kpi-trends`:
   - `signupRequests`
   - `signupVerifications`
   - `signupVerificationRate`
   - `signupMedianTimeToVerifyHours`
5. Support reports about:
   - workspace slug confusion
   - verification emails not arriving
   - already-pending signup confusion

## 7. Rollback

If rollout must be reversed:

1. Set these runtime flags to `false`:
   - API: `FEATURE_PUBLIC_SIGNUP_ENABLED=false`
   - Web: `NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED=false`
   - Web: `FEATURE_PUBLIC_SIGNUP_ENABLED=false`
2. Redeploy both services.
3. Validate:
   - `/api/v1/signup/*` returns `404`
   - `/signup` is hidden or `404`
   - login CTA no longer offers workspace creation

Rolling back the public entry point does not remove existing workspaces created during rollout.

## 8. Known limits

Current v1 signup behavior still has these constraints:

1. one email address maps to one workspace account
2. teammate invites happen after admin login, not during signup
3. there is no public billing checkout during signup
4. production rollout still relies on manual production validation; there is not yet a dedicated production signup smoke workflow

## 9. References

- `docs/auth/VEXA_PIM_TENANT_LOGIN_SPEC.md`
- `docs/execution/STAGING_LIVE_EVIDENCE_RUNBOOK.md`
- `docs/runbooks/on-call-guide.md`
- `docs/runbooks/incident-response.md`
