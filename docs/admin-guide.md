# Admin Guide

Status: Canonical  
Last reviewed: 2026-04-25

## Admin Areas

Implemented admin pages and APIs cover:

- Workspace user management
- API keys
- Outbound webhooks
- Connector administration
- Plan, billing, and commercial upgrade requests
- Privacy export and account deletion controls
- Audit exploration
- Platform tenant visibility for platform-level operations

## Roles

The application uses role-aware route and API behavior. Current documented defaults include `admin`, `editor`, `reviewer`, and `viewer`; verify any new role against the auth guards and route tests before documenting it.

## User Management

Admins can manage workspace users through admin user routes and APIs. Relevant tests include workspace user CRUD and admin users route contracts.

## API Keys And Webhooks

Admin APIs expose API key and outbound webhook management under `/api/v1/admin/api-keys` and `/api/v1/admin/webhooks`.

## Connector Administration

Connector administration includes definitions, installation flows, credential validation, permissions, OAuth callbacks, publication targets, payload previews, and account health. Connector setup is capability-gated; disabled or missing installs should not make a connector lane appear healthy.

## Commercial And Plan Controls

Billing and commercial controls exist for plan overview, upgrade requests, commercial governance, tenant search, suspension, and related notifications. Staging and production require commercial contact configuration and `PIM_COMMERCIAL_OPS_TOKEN`.

## Privacy Controls

Account privacy APIs support export and deletion workflows. Production behavior should be validated with the account privacy integration tests before release.

