# Live SP-API Pilot Submission Runbook (EXE-P5-014)

Purpose:
- Execute one real Amazon SP-API validation/submission trace with pilot seller credentials.
- Capture evidence required to close `EXE-P5-014`.

## Preconditions

- `EXE-P5-011` completed (S3 + CloudFront baseline live).
- Pilot seller credentials received and stored securely.
- `FEATURE_REAL_SPAPI_VALIDATION=true` in staging.
- One pilot product selected with complete catalog/compliance data.

## Required environment

```bash
APP_ENV=staging
FEATURE_REAL_SPAPI_VALIDATION=true
AMAZON_CLIENT_ID=<provided>
AMAZON_CLIENT_SECRET=<provided>
PIM_AMAZON_VALIDATION_ENDPOINT=<live-validation-endpoint>
PIM_AMAZON_VALIDATION_TOKEN=<token-if-required>
```

## Step-by-step execution

1. Login to staging as pilot tenant admin.
2. Confirm product has:
   - title, brand, description
   - HSN, GST
   - required category attributes
   - valid media URL via CloudFront
3. Call simulation endpoint:
   - `GET /api/v1/marketplace/products/{productId}/simulate?channel=amazon`
4. Verify response:
   - `validationSource = amazon_sp_api`
   - `validationWarnings` present/empty as appropriate
5. Trigger export job:
   - `POST /api/v1/marketplace/products/{productId}/export-jobs`
6. Process job:
   - `POST /api/v1/marketplace/export-jobs/{jobId}/process`
7. Capture resulting submission artifacts:
   - job status and payload snapshot
   - channel response metadata (success/rejection)
   - normalized error mapping if rejected

## Evidence to record

- timestamped request/response logs (without secrets)
- product id, export job id, connector installation id
- channel outcome:
  - accepted / rejected
  - rejection code(s)
  - normalized seller message(s)
- screenshot or JSON dump of final state

## Gate sign-off format

```json
{
  "environment": "staging",
  "tenantId": "<pilot-tenant-id>",
  "productId": "<product-id>",
  "jobId": "<export-job-id>",
  "channel": "amazon",
  "outcome": "accepted|rejected",
  "runDate": "YYYY-MM-DD",
  "evidencePath": "docs/PHASE5_LIVE_SPAPI_EVIDENCE_YYYY-MM-DD.md"
}
```
