# AI-POL-001 Data Classification Provider Policy

Status: Draft Privacy/Security foundation for VEXA-AI-001

Scope: Non-runtime provider payload classification policy

## Goal

Define and validate the first AI-001 data classification contract before any provider payload can be built.

The policy uses three classifications:

```text
AI_ALLOWED
AI_ALLOWED_WITH_REDACTION
AI_BLOCKED
```

This PR is intentionally static. It does not add schema, persistence, API routes, tenant runtime behavior, provider SDKs, or model execution.

## Existing Vexa Conventions Reused

- Audit metadata redacts keys or values containing token, secret, credential, API key, access key, refresh token, private key, or key.
- Read access policy already distinguishes unredacted, redacted, human-only, and API-client access surfaces.
- Product read redaction already removes sensitive fields such as vendor scope and pricing for unprivileged actors.

AI-001 provider payload policy is stricter: blocked fields must not be serialized at all, and redactable fields must carry explicit redaction evidence before any future provider call.

## Non-Goals

- No `AiTenantPolicy` database table in this slice
- No provider integration
- No runtime payload builder
- No Product Service mutation
- No OpenAPI/Postman changes
- No production AI claim

## Verification

```powershell
node --check scripts/validate-ai-pol-provider-payload-policy.cjs
node --check scripts/validate-ai-pol-provider-payload-policy.test.cjs
node scripts/validate-ai-pol-provider-payload-policy.test.cjs
node scripts/validate-ai-pol-provider-payload-policy.cjs
git diff --name-only -- apps packages prisma .github docs/openapi.yaml docs/openapi.json docs/vexa-pim.postman_collection.json
```

The final scope command should produce no output.
