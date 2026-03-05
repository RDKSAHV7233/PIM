# Media CDN Baseline Runbook (EXE-P5-011)

Purpose:
- Provision and validate AWS S3 (`ap-south-1`) + CloudFront baseline for media delivery.
- Produce evidence for `EXE-P5-011` acceptance (`bucket/CDN created`, `signed URL flow validated`).

## Prerequisites

- AWS CLI v2 installed.
- AWS credentials configured (`aws configure` or role-based auth).
- Permission set includes:
  - `cloudformation:*` (or stack-scoped deploy permissions)
  - `s3:*` on target media bucket
  - `cloudfront:*` for distribution creation/read
  - `iam:PassRole` if org policy requires deployment roles

## 1) Provision infrastructure

```powershell
powershell -ExecutionPolicy Bypass -File tools/dev/provision-media-baseline.ps1 `
  -StackName pim1-media-baseline `
  -Region ap-south-1
```

Expected output:
- `bucketName`
- `distributionId`
- `distributionDomain`
- `mediaBaseUrl` (`https://<distribution-domain>`)
- env hints for `R2_PUBLIC_URL` and AWS vars

Template used:
- `deploy/aws/media-baseline.yaml`

## 2) Validate delivery and signed URL flow

```powershell
powershell -ExecutionPolicy Bypass -File tools/dev/validate-media-baseline.ps1 `
  -BucketName <bucketName> `
  -CloudFrontDomain <distributionDomain> `
  -Region ap-south-1
```

What this checks:
- Uploads a temporary smoke object to S3.
- Verifies CloudFront `HEAD` returns 2xx for the object URL.
- Verifies signed S3 `GET` URL returns 2xx.
- Deletes smoke object after validation.

## 3) Configure application environment

Set these values in `.env.staging` and deployment secrets:

```bash
AWS_REGION=ap-south-1
AWS_S3_MEDIA_BUCKET=<bucketName>
AWS_CLOUDFRONT_DISTRIBUTION_ID=<distributionId>
R2_PUBLIC_URL=https://<distributionDomain>
```

Note:
- `R2_PUBLIC_URL` remains the application delivery URL key for compatibility with existing media code paths.

## 4) Evidence capture

Save command outputs in release evidence notes:
- provision output JSON
- validation output JSON
- stack screenshot (CloudFormation + CloudFront status `Deployed`)

Attach to:
- `docs/PHASE5_EVIDENCE_YYYY-MM-DD.md`

## 5) Rollback

If validation fails and resources must be removed:

```powershell
aws cloudformation delete-stack --stack-name pim1-media-baseline --region ap-south-1
aws cloudformation wait stack-delete-complete --stack-name pim1-media-baseline --region ap-south-1
```
