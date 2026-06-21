# Vexa PIM — Pilot Scope

This document defines the authoritative scope for the first pilot. Operations must review this before onboarding any customer.

## Connector Availability

| Connector | Launch Stage | Customer Access | Notes |
|-----------|-------------|----------------|-------|
| **Shopify** | GA | ✅ Direct product publish | OAuth install + publish fully supported |
| **Flipkart** | GA | ✅ API-key flows | Credential install + publish supported |
| **Amazon India** | Planned | ❌ Not available | Install + credential validation only; publish not available |
| **WooCommerce** | Planned | ❌ Not available | Contact account manager for early access |
| **Meesho** | Not implemented | ❌ Not available | — |
| **ONDC** | Internal | Internal only | API mapping only; not exposed in pilot UI |

## Onboarding

- **Self-serve signup is disabled** (`FEATURE_PUBLIC_SIGNUP_ENABLED=false`) in all pilot environments.
- All pilot customers are provisioned by operations. No customer should reach the `/signup` page.
- Customers who click a signup link are redirected to the contact page (`PIM_COMMERCIAL_CONTACT_URL`).

## Publish Flows Supported in Pilot

- **Shopify**: Full direct publish via `productSet` mutation. Per-installation OAuth tokens. Webhook receipt verified via HMAC.
- **Flipkart**: API-key credential install + product listing publish.

## Out of Scope for Pilot

- WooCommerce webhook receive or publish (shared webhook secret not per-installation — W5 not shipped)
- Amazon publish (connector `implementationStatus: stub`)
- Meesho (not implemented)
- Self-serve tenant signup
- Stripe billing / paid plan upgrades (ops-manual commercial terms only)

## Operations Checklist Before First Pilot Customer

- [ ] This document reviewed and signed off by PO
- [ ] `FEATURE_PUBLIC_SIGNUP_ENABLED=false` confirmed in Railway environment
- [ ] Pilot customer provisioned via ops account creation flow
- [ ] Shopify OAuth redirect URI registered for pilot domain
- [ ] Trial period configured (`PIM_COMMERCIAL_TRIAL_DAYS`)
- [ ] `PIM_COMMERCIAL_CONTACT_EMAIL` set to ops inbox
