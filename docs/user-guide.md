# User Guide

Status: Canonical  
Last reviewed: 2026-05-28

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

## Login Guide

All human users sign in from `/login` with the same three fields:

- `Workspace`
- `User ID`
- `Password`

The `Pilot Role Alignment` card is a persona guide, not a list of seven separate shells. Today, customer access is handled through the current role model below plus delegated scopes where needed.

### Persona Mapping

| Persona in UI | How to log in today | What this user normally does |
|---|---|---|
| Product admin | `admin` user login | Full workspace governance, catalog, operations, connectors, users, API keys, webhooks, and audit |
| System admin | Not a normal customer-shell login | Internal/operator access outside the customer shell; hidden from normal tenant navigation |
| Editor | `editor` user login | Catalog updates, imports, bulk edit, connector setup, and quality triage |
| Reviewer | `reviewer` user login | Read catalog and operations data, then approve or reject review work where allowed |
| Vendor | Usually `viewer` plus delegated scopes | Read-only frontend access today; dedicated vendor write journeys are future scope |
| Category manager | Usually `editor` or `reviewer` plus delegated scopes | Category- or brand-bounded work; dedicated category-manager shell is future scope |
| API/client operations | Admin-issued API key | Machine access managed through `Admin > API Keys`, not a normal interactive login |

### Roles Available Today

| Role | Login type | Main use |
|---|---|---|
| `admin` | Human login | Full admin and workspace control |
| `editor` | Human login | Day-to-day catalog and operations write access |
| `publisher` | Human login where provisioned | Queue channel submissions for approved products |
| `approver` | Human login where provisioned | Approve or reject in-review products |
| `channel_manager` | Human login where provisioned | Manage mappings, readiness, and channel configuration |
| `connector_admin` | Human login where provisioned | Install and manage connector accounts and credentials |
| `reviewer` | Human login | Read-only review visibility with approval-oriented workflows |
| `viewer` | Human login | Read-only access |

Notes:

- The customer-facing invite form currently centers on the broad roles `admin`, `editor`, `reviewer`, and `viewer`.
- Specialist roles such as `publisher`, `approver`, `channel_manager`, and `connector_admin` exist in the RBAC model and can be provisioned through admin or seeded environment setup.
- `vendor` and `category_manager` are not separate first-class shells yet; they are handled through a base role plus delegated scopes.
- `system_admin` is an internal boundary role, not a standard tenant-facing user journey.

### Local Demo Logins

Repo-truth local and test harnesses commonly use workspace `default`, but the sample email pattern varies by bootstrap path. Use these only for local or demo environments that intentionally load seeded auth config:

| Context | Example account(s) | Notes |
|---|---|---|
| Playwright and test harness examples | `admin@vexa-pim.local`, `editor@vexa-pim.local`, `reviewer@vexa-pim.local`, `viewer@vexa-pim.local` | Common in E2E helpers and test setup |
| Local dev and rollout runbook examples | `admin@pim1.local` | Appears in local startup and staging verification docs |

Local/demo note:

- The repo evidence shows a shared local demo password of `vexa-pim-demo-password` for seeded test identities.
- Do not treat that shared password as a production credential pattern.
- Some environments may also seed specialist-role users through `PIM_AUTH_IDENTITIES_JSON`, but those accounts are environment-specific rather than guaranteed in every deployment.

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

Current import boundary:

- Standard mode:
  - CSV or JSON
  - up to `10,000` rows
  - uses the existing bulk import job flow
- Large import mode:
  - CSV only
  - `10,001` to `30,000` rows
  - automatically stages a parent import run with internal background batches
  - shows one run, one progress view, one repair surface, and one combined error report
- Out of scope today:
  - `>30,000` rows
  - `.xlsx` / `.xls`
  - direct browser-to-object-storage upload

