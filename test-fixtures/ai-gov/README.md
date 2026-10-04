# AI-GOV-001 Review Workflow Fixture

This directory contains the non-runtime human review workflow contract for `VEXA-AI-001`.

The contract is a design and validation fixture only. It does not add API routes, database tables, provider calls, Product Service writes, or production configuration.

Validate it with:

```powershell
node scripts/validate-ai-gov-review-workflow.cjs
node scripts/validate-ai-gov-review-workflow.test.cjs
```

The case fixture covers valid accept, edit, reject, stale blocked, tampered blocked,
unauthorized blocked, tenant mismatch blocked, unsupported evidence blocked, and
Product Service apply-boundary reference behavior.
