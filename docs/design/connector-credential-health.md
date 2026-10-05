# Connector credential health (heartbeat)

Provider availability is not credential validity. The heartbeat records what it actually
learned, and only an explicit rejection may expire credentials.

## Outcomes

| Outcome | Meaning | Installation `status` | `last_validated_at` |
|---|---|---|---|
| `VALID` | the verifier succeeded | `CREDENTIAL_EXPIRED` is promoted back to `ACTIVE` | set |
| `INVALID` | explicit rejection (401/403, `invalid_client`, `invalid_grant`, an expired refresh token) | set to `CREDENTIAL_EXPIRED` | untouched |
| `INDETERMINATE` | no evidence either way: timeout, DNS, reset, 429, 5xx, outage, a verifier that threw | unchanged | untouched |
| `CONFIGURATION_ERROR` | the configured target is refused (unsafe or non-HTTPS URL, blocked redirect) | unchanged | untouched |

Every outcome sets `last_validation_attempt_at`, `last_validation_outcome` and a short safe
`last_validation_reason` code (never a message, URL or credential). `updated_at` moves only
on a status transition. Columns live on `connector_installations`; they are separate from
the per-credential `connector_credentials.last_validated_at` / `failure_reason`.

## Where the verdict comes from

The heartbeat uses `validateStoredCredentialsDetailed` (`valid` / `invalid` / `unavailable`)
when the connector has it; `not_supported` falls back to the legacy boolean. Twelve registered
connectors have it: amazon-in, bigcommerce, dynamics-365, ebay, etsy, flipkart, odoo,
prestashop, shopify, shopware, woocommerce, zoho-inventory.

For a connector with only the boolean, `true` is `VALID` and `false` is `INDETERMINATE`
(`LEGACY_BOOLEAN_FALSE`), because a bare `false` cannot be told apart from an outage. A slug
may be added to `BOOLEAN_FALSE_MEANS_REJECTION` only after an audit proves its `false` is
always an explicit rejection; the list is empty today (meesho and nykaa return a constant
`false`; myntra returns `false` for a 401 and for any exception). The inventory spec fails if a
registered connector has no detailed verifier, no audited entry and no parked entry, or if a
parked slug later gains a verifier.

The four tenant-URL connectors (Odoo, WooCommerce, PrestaShop, Shopware) mark refusals of the
configured target with `category: "configuration"`; the heartbeat records those as
`CONFIGURATION_ERROR` rather than a credential verdict.

## Evidence level

Most verifiers end in an authenticated provider call. Two do not: `amazon-in` and `flipkart`
report `valid` once a usable access token is obtained, and a cached unexpired token needs no
provider round trip (Flipkart also checks its refresh token's stored expiry). They return
`evidence: "token_only"` and the heartbeat records `VALID` with reason `TOKEN_ONLY`, so the
weaker evidence is never presented as a live check. A provider call happens for them only when
the token has to be refreshed.

## Who writes the facts

- **Heartbeat** (every outcome above).
- **Credential replacement** (`update<Connector>Credentials`, same transaction as the saved
  credentials): records `VALID`, because it requires an explicit `valid` from
  `verifyCandidateCredentials`, which for every connector ends in an authenticated provider
  call. Anything other than an explicit `valid` (including `not_supported`) is rejected.
- **OAuth callback and reconnect**: clear all four facts to unknown (and the attempt time to
  NULL, which sorts first in the next heartbeat batch). They never record `VALID`: a callback
  can merely store keys (WooCommerce app-auth does), and reconnect's check is a gate, not a
  recorded provider verdict. No `VALID` without provider-authenticated evidence.

## Batch order

`ORDER BY last_validation_attempt_at ASC NULLS FIRST, id ASC`, 50 per tick, so a fleet larger
than the batch is visited once before any installation is visited twice (previously ordered by
`updated_at`, which healthy installations never moved, so the same 50 were rechecked forever).

## Where the facts surface

The four facts are returned on every installation record as `validation`
(`{ lastValidatedAt, lastAttemptAt, outcome, reason }`; ISO strings or null, all null until
the first recorded check) by the framework `getInstallation`, the installer list and the
installer detail. Unknown outcomes and reasons that are not short safe codes are dropped, not
echoed.

| Surface | What it shows |
|---|---|
| Connectors list, connector detail | A credential-health chip next to the status, a one-line detail, and "Last verified" |
| Internal ops summary (`readiness.connector`) | `inconclusiveInstallations` and `configurationProblemInstallations`, counted over `ACTIVE` installations only, so an expired installation is never counted twice. Neither is a blocker; `CREDENTIAL_EXPIRED` stays the only blocking status |

| State | Chip | Tone |
|---|---|---|
| `ACTIVE`, no recorded check | Not yet verified | neutral |
| `VALID` | Verified (`TOKEN_ONLY` adds that the provider was not contacted) | success |
| `INDETERMINATE` on `ACTIVE` | Check inconclusive (provider unreachable) | warning |
| `CONFIGURATION_ERROR` | Configuration problem | warning |
| `INVALID` | Credentials rejected | danger |
| `CREDENTIAL_EXPIRED` (any later outcome) | Credentials expired | danger |

An `INDETERMINATE` result never clears an expired installation: the chip stays "Credentials
expired" and the detail says the earlier rejection still stands. Paused and disabled
installations show no credential-health chip because the heartbeat does not check them.
