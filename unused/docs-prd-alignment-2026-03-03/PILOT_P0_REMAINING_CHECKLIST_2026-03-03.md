# Pilot P0 Remaining Checklist (as of 2026-03-03)

Scope:
- Remaining `P0` items in `docs/EXECUTION_BACKLOG_BOARD.md` required for pilot release closure.

## Current status summary

- `EXE-P5-009` Done
- `EXE-P5-010` Done
- `EXE-P5-011` Blocked (external AWS execution pending)
- `EXE-P5-014` Blocked (pilot Amazon credentials pending)
- `EXE-P5-015` Blocked (pilot participant scheduling pending)

## Validation baseline (already green)

Run completed on this repo state:

```bash
npm run test:integration:rls-isolation
npm run test:integration:amazon-authoritative-validation
npm run test:integration:catalog-completeness
npm run tenant:verify-rls:ci
npm run guard:unsafe-raw
powershell -ExecutionPolicy Bypass -File tools/phase5/media-smoke-test.ps1
powershell -ExecutionPolicy Bypass -File tools/phase8/ai-smoke-test.ps1
```

## EXE-P5-011 (S3 + CloudFront baseline)

Prepared artifacts:
- `deploy/aws/media-baseline.yaml`
- `tools/dev/provision-media-baseline.ps1`
- `tools/dev/validate-media-baseline.ps1`
- `docs/runbooks/media-cdn-baseline.md`

Required execution (AWS workstation):

```powershell
powershell -ExecutionPolicy Bypass -File tools/dev/provision-media-baseline.ps1 `
  -StackName pim1-media-baseline `
  -Region ap-south-1
```

Then validate:

```powershell
powershell -ExecutionPolicy Bypass -File tools/dev/validate-media-baseline.ps1 `
  -BucketName <bucketName> `
  -CloudFrontDomain <distributionDomain> `
  -Region ap-south-1
```

Evidence to attach:
- Provision output JSON
- Validation output JSON
- CloudFormation + CloudFront deployment proof

## EXE-P5-014 (live SP-API pilot submission)

Prepared artifact:
- `docs/runbooks/live-spapi-pilot-test.md`

Blocked until:
- Pilot Amazon credentials available

Execution once unblocked:
- Follow runbook end-to-end in staging
- Capture one real submission/validation trace and outcome evidence

## EXE-P5-015 (pilot workflow observation + pricing decision)

Prepared artifacts:
- `docs/templates/pilot-session-notes-template.md`
- `docs/templates/pricing-decision-template.md`

Blocked until:
- Pilot participant scheduled

Execution once unblocked:
- Run 2-hour observation session
- Complete friction ranking
- Finalize pricing decision record

## Sign-off format for each P0 close

```json
{
  "environment": "staging",
  "tenantId": "<tenant-id>",
  "date": "YYYY-MM-DD",
  "gitTag": "<tag>",
  "runUrl": "<ci-or-evidence-link>"
}
```
