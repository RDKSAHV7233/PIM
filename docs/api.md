# API Guide

Status: Canonical  
Last reviewed: 2026-04-25

The generated OpenAPI files are `docs/openapi.yaml` and `docs/openapi.json`. Regenerate and compare them with:

```bash
npm run openapi:check
```

## Base URL

Local API base URL:

```text
http://localhost:4000/api/v1
```

## Main Endpoint Families

Implemented controller families include:

- Health: `/health`
- Auth and account privacy: `/auth/*`
- Public signup: `/signup/*`
- Catalog and products: `/catalog/*`
- Taxonomy: `/taxonomy/*`
- Compliance and issue inbox: `/compliance/*`, `/issues/*`
- Connector installer and webhook relay: `/connectors/*`
- Marketplace channels, mappings, readiness, submissions, and export jobs: `/marketplace/*`, `/submissions/*`
- Media: `/media/*`
- Bulk import and bulk edit: `/bulk-import/*`, `/bulk-edit/*`
- Billing and commercial operations: `/billing/*`
- Admin API keys, webhooks, and users: `/admin/*`
- Dashboard and metrics: `/dashboard/*`, `/metrics/*`
- Notifications: `/notifications/*`
- ONDC, when feature-gated on: `/ondc/*`
- Platform tenant operations: `/platform/*`

## Authentication

Most APIs require authenticated access. Local development can use local auth mode; staging and production require DB-backed auth. Admin and high-risk connector actions may require role checks or step-up authentication.

## Tenant Context

The API is multi-tenant. Tenant context is enforced by database and service-level checks. Use the current auth/session flow and route tests as the source of truth for tenant headers, cookies, and legacy header compatibility.

## API Change Process

When changing controllers or DTOs:

1. Update implementation and tests.
2. Run focused integration tests.
3. Run `npm run openapi:check`.
4. Commit regenerated `docs/openapi.yaml` and `docs/openapi.json` only when the API contract intentionally changed.

