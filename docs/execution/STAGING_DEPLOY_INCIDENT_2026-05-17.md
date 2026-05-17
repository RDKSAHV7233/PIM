## Incident: staging deployment wiring drift contained
Date: 2026-05-17 10:46 UTC
Severity: P1
Duration: 2h 12m (from first failed deploy signal to restored green deploy lane)
Impact: staging deploy validation was blocked; release evidence and post-deploy confidence checks could not complete reliably until service-targeting and rollout expectation drift were corrected
Root cause: configuration drift across GitHub staging secrets, Railway service targeting, and staging public-signup expectation caused otherwise-correct deploy code to point at the wrong runtime contract

### Timeline
- 08:29 UTC - `Deploy Staging` run `25985888363` failed because `RAILWAY_WEB_SERVICE='PIM1'` did not exist in the target Railway project
- 08:35 UTC - `Deploy Staging` run `25986028067` fell back to `RAILWAY_WEB_SERVICE_ID`, but the resolved service still targeted the wrong Railway runtime
- 09:37 UTC - GitHub staging Railway service secrets were corrected to `App Vexa` and `Vexa API`
- 09:37-10:38 UTC - follow-up runs isolated secondary drift in auth hash backfill, web API base URL propagation, and public-signup expectation
- 10:41 UTC - `STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED` was aligned to `false` to match the live staging rollout posture
- 10:41-10:46 UTC - `Deploy Staging` run `25988595126` completed successfully end-to-end and became the new recovery baseline

### Root cause detail
The application-side deploy fixes on `cto/staging-web-api-reconnect` were already sufficient to support a healthy staging deploy, but GitHub Actions secrets were still pointing at stale or incorrect Railway services. The web deploy first targeted a missing service name, then a valid but incorrect service ID associated with the API service. After the service mapping was repaired, staging still failed because the live environment carried additional operational drift:

- auth identities still relied on legacy shared-password state until hash backfill ran in the workflow
- the deployed web runtime resolved an unusable API base URL until the package-preparation fallback logic was corrected
- GitHub expected public signup to be enabled while the live staging services intentionally exposed signup-disabled behavior

The final recovery did not require new feature work. It required aligning secrets, runtime expectations, and verification logic with the actual staging operating posture.

### Fix
- Corrected the GitHub staging Railway service mapping:
  - web: `App Vexa`
  - api: `Vexa API`
- Hardened the deploy workflow and helper scripts so service overlap and missing web-target resolution fail earlier
- Added auth hash backfill to the staging workflow before post-deploy auth verification
- Injected and validated the correct web API base URL contract for the Railway web package
- Switched staging verification to resolve the live Railway web URL rather than trusting a stale fallback
- Set `STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED=false` to match the current staging rollout posture

### Current baseline
- Recovery reference run: `25988595126`
- Recovery URL: `https://github.com/RDKSAHV7233/PIM1/actions/runs/25988595126`
- Known-good staging posture as of 2026-05-17:
  - deployment lane validates platform health
  - public signup remains disabled in staging
  - any future signup-enabled rehearsal must align both Railway flags and the GitHub expectation secret

### Follow-up actions
- [x] DevOps - correct GitHub staging Railway service mapping - 2026-05-17
- [x] Engineering - restore green staging deploy and post-deploy verification - 2026-05-17
- [x] Engineering - publish the recovery baseline and root cause narrative - 2026-05-17
- [ ] DevOps - revoke the exposed GitHub PAT and replace it if still needed - 2026-05-17
- [ ] DevOps - confirm Railway staging runtime flags remain aligned with signup-disabled posture - 2026-05-18
- [ ] Product - decide separately whether to schedule a future controlled signup-enabled staging window - 2026-05-19
