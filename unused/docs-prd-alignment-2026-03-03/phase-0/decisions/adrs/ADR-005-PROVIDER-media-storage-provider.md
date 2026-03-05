# ADR-005-PROVIDER: Media Storage Provider

Status: Accepted  
Date: 2026-03-01

## Context
Phase 5 DAM requires a concrete object storage provider decision (ADR-005 only defined abstraction).  
PIM1 seller workflows require:
- India-first latency profile.
- Publicly retrievable media URLs for channel payloads (not private blob-only URLs).
- Signed URL support for controlled upload/read workflows.
- Predictable cost at SMB scale.

## Options considered
1. AWS S3 (`ap-south-1`) + CloudFront
2. Cloudflare R2
3. GCP GCS (`asia-south1`) + Cloud CDN

## Decision
Use **AWS S3 (`ap-south-1`) with CloudFront** as the Phase 5 provider baseline.

## Rationale
- Best operational fit with current Node/NestJS stack and common India marketplace integration patterns.
- Native IAM + presigned upload URL support with minimal adapter risk.
- Stable path to public CDN URL delivery for Amazon/Flipkart payload media references.
- Lower implementation risk than introducing a new storage semantics layer while Phase 5 is still stabilizing.

## Consequences
- DAM implementation will expose CloudFront URL form in seller-facing export paths.
- Upload APIs will use presigned S3 URLs for direct client upload where possible.
- Media validator/publisher must treat S3 object key as source of truth and CloudFront URL as delivery URL.
- Add cost controls:
  - lifecycle rule for stale media variants.
  - object size guardrails.
  - monthly egress monitoring in ops checklist.

## Follow-up tasks
- `EXE-P5-011`: Provision S3 bucket, IAM policy, and CloudFront distribution.
- `EXE-P5-012`: Implement signed upload URL API and URL normalization.
- `EXE-P5-013`: Add delivery URL checks in marketplace export validation.
