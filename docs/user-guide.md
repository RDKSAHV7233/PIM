# User Guide

Status: Canonical  
Last reviewed: 2026-04-25

## Main Areas

Vexa PIM is organized around these implemented web areas:

- Dashboard: catalog, quality, signup, and operational summaries.
- Catalog and Products: product lists, product detail, variants, completeness, and workflow actions.
- Quality: overview, approvals, issue queues, compliance, and rejection intelligence.
- Channels: marketplace health, connector detail pages, mapping, publish readiness, and submissions.
- Connectors: connector catalog, setup entry points, catalog mapping, account details, and install health.
- Media: asset upload, validation, associations, and approval-related metadata.
- Operations: imports, jobs, bulk edit, repair, and operational recovery.
- Admin: users, API keys, webhooks, connectors, plan, privacy, and audit access.
- Settings: workspace and account settings.

## Product Workflow

1. Create or import products through Catalog, Products, or Operations.
2. Review completeness and required attributes.
3. Attach or validate media assets.
4. Resolve quality issues and approval requirements.
5. Map product/category fields for target channels.
6. Validate publish readiness.
7. Publish to supported connectors where capability and account setup allow it.
8. Track submissions, status sync, and channel errors.

## Connector Workflow

1. Open Connectors or Channels.
2. Review each connector lane and install footprint.
3. Start setup for connectors without installed accounts.
4. Open account details for installed accounts that need attention.
5. Open catalog mapping to manage channel taxonomy and field mappings.
6. Use publish readiness before submitting products.

Current connector implementation status:

| Connector | Slug | Status | Capabilities |
|---|---|---|---|
| Amazon India | `amazon-in` | Full | publish, validate, status sync, webhook receive |
| Flipkart | `flipkart` | Full | publish, validate, status sync, webhook receive |
| Shopify | `shopify` | Full | publish, validate, status sync, webhook receive |
| Meesho | `meesho` | Partial | local validation and planned Excel export; direct publish is not implemented |

## Quality Workflow

Use Quality pages to review completeness, issue inbox items, approval queues, rejection intelligence, and compliance defects. Reviewer-specific behavior is covered by integration tests and route contracts in `apps/web/test/integration`.

## Operations Workflow

Use Operations pages for bulk imports, job visibility, bulk edit, and repair actions. Long-running marketplace work is processed by queue workers; staging and production require BullMQ.

