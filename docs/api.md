# API Guide

Status: Canonical
Last reviewed: 2026-06-15

The generated API contract files are:

- `docs/openapi.yaml`
- `docs/openapi.json`

Regenerate and compare them with:

```bash
npm run openapi:check
```

## Base URL

Local base URL:

```text
http://localhost:4000/api/v1
```

## Main Endpoint Families

Implemented API families include:

- Health: `/health`
- Auth, MFA, OIDC, and account privacy: `/auth/*`
- Public signup: `/signup/*`
- Catalog and workflow: `/catalog/*`
- Taxonomy: `/taxonomy/*`
- Compliance and issue inbox: `/compliance/*`, `/issues/*`
- Connector installer and connector callbacks: `/connectors/*`
- Marketplace, mappings, readiness, submissions, and install detail APIs: `/marketplace/*`, `/submissions/*`
- Media: `/media/*`
- Bulk import and bulk edit: `/bulk-import/*`, `/bulk-edit/*`
- Billing and commercial operations: `/billing/*`
- Admin users, API keys, webhooks, auth policy, and related governance APIs: `/admin/*`
- Dashboard and metrics: `/dashboard/*`, `/metrics/*`
- Notifications: `/notifications/*`
- ONDC: `/ondc/*` when enabled
- Platform tenant operations: `/platform/*`

## Authentication And Tenant Context

- Most APIs require authenticated access.
- Local development can use local auth mode.
- Staging and production must use DB-backed auth.
- Tenant context is enforced in service and DB layers; do not rely on docs alone for tenant behavior.

## API Change Process

1. Update implementation and tests.
2. Run focused integration coverage.
3. Run `npm run openapi:check`.
4. Commit regenerated OpenAPI only when the contract intentionally changed.
