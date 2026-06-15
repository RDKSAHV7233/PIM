# Admin Guide

Status: Canonical
Last reviewed: 2026-06-15

## Admin Areas

Implemented admin pages include:

- `/admin`
- `/admin/plan`
- `/admin/users`
- `/admin/api-keys`
- `/admin/auth-policy`
- `/admin/auth-policy/oidc`
- `/admin/oidc`
- `/admin/webhooks`
- `/admin/privacy`
- `/admin/audit`
- `/admin/connectors`
- `/admin/commercial`
- `/admin/workspace`

## Role Model

Source of truth:

- app roles: `apps/api/src/common/rbac/roles.ts`
- admin audience tiers: `apps/web/src/lib/admin-navigation.ts`

App roles:

- `admin`
- `editor`
- `publisher`
- `approver`
- `channel_manager`
- `connector_admin`
- `reviewer`
- `viewer`

Admin boundary roles:

- `product_admin`
- `system_admin`
- `super_admin`

Blocked foundation roles defined in code:

- `category_manager`
- `vendor`

## Admin Navigation Audiences

The admin sidebar uses five visibility tiers:

- `all`
- `editor_plus`
- `connector_admin_plus`
- `admin`
- `system_admin_gated`

Important repo-truth note:

- navigation visibility is not identical to direct-route behavior
- some pages are hidden from normal admin navigation unless a boundary role is present, even though page code may still allow an `admin` app-role direct visit

## Current Access Nuances

- `admin/users` page code currently allows the `admin` app role and then loads governance data
- `admin/api-keys` is plan-tier gated and shows upgrade messaging for `TRIAL` and `STARTER`
- `admin/commercial` requires all of:
  - authenticated admin app role
  - `system_admin` or `super_admin` boundary role
  - configured commercial ops token
- when the commercial ops token is absent, `/admin/commercial` renders a not-configured state instead of loading the operator console

## Connector And Governance Admin

`/admin/connectors` is the main governance surface for connector permissions and access policies.

Connector setup, installation detail, mappings, and recovery continue to live under the connector and channel route groups rather than only under `/admin`.

## Privacy And Security

- `/admin/privacy` covers privacy-export and deletion status
- `/admin/auth-policy` and `/admin/oidc` cover auth policy and OIDC configuration
- `/admin/audit` covers governance and audit visibility

## Testing Guidance

When validating admin behavior, test both:

1. sidebar visibility by role and boundary-role claims
2. direct URL access for the page itself

