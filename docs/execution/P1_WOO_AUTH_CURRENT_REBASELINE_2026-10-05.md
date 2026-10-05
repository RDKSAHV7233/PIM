---
title: P1 Woo/Auth Current Re-Baseline
status: current — evidence audit and decision request; supersedes the forward-looking conclusions of the earlier dated P1 records
owner: CTO / PO / Security / QA / SRE
prepared_by: Claude (evidence audit only — not a substitute for named sign-off)
last_updated: 2026-10-05
baseline: origin/main 7d109d0d9b44cbe392fda774366c071b35c32e78
supersedes: the forward-looking conclusions and requirements of P1_WOO_AUTH_READINESS_FOLLOWUP_2026-09-11.md and the 2026-09-03 to 2026-09-05 P1 records (those records are preserved unchanged as point-in-time evidence)
---

# P1 Woo/Auth Current Re-Baseline — 2026-10-05

## Scope and authority

This is a Claude-run audit. It reports what the repository records, what evidence exists, which class of
evidence each item is, and what is still unverified. It does **not** approve, close, reopen or move any launch
stage, and it does not change `p1_blocker_hold` or any other launch policy. Per
`REQUIRED_TEAM_AGENT_HANDOFF_2026-09-04.md`, an AI-run audit cannot constitute named CTO, PO, Security, QA or
SRE approval; treat this as input to that decision.

The dated records from 2026-09-03 to 2026-09-11 are left exactly as written. They were accurate for their
date. Where this document disagrees with their forward-looking conclusions, this document is the current one,
and says so explicitly below.

## 1. What the repository records about P1 today

| When (UTC) | Change | What it records |
|---|---|---|
| 2026-10-02 19:32 | #1048 portfolio review | WooCommerce selected as the next onboarding workstream. States WooCommerce "remains in `p1_blocker_hold` until its authentication and tenant-binding controls have current staging and runtime evidence", with fresh CTO, PO, Security, QA and SRE sign-off, and that no launch-stage change is authorized by the review. |
| 2026-10-02 20:32 | #1052 | "close P1-1/P1-2 blockers — advance to `controlled_pilot`". Removes the temporary staging-proof override. Label `cto-required-team-approved`; no GitHub review approvals recorded; merged by `doteswithvb-alt`. |
| 2026-10-03 06:11 | #1059 | "advance WooCommerce to `early_access`". States a QA/PO/required-team sign-off after an end-to-end battery against live `app.vexapim.com`. New customer installs open. No labels and no GitHub review approvals recorded; merged by `doteswithvb-alt`. |

Consequences in code on `main`: the launch policy resolves WooCommerce to `early_access`; no connector is
assigned `p1_blocker_hold` any more (the stage still exists in the type). `INCREMENT_STATE.json` records
INC-85 for the closure.

**What the repository does not record:** named per-role approvals (CTO, PO, Security, QA, SRE), a deploy
artifact, a controlled-rollout snapshot, or the redacted credential-row and outage evidence the dated P1
records asked for. Approvals may exist outside the repository; this audit cannot see them.

**Documents that still say the hold is open (stale against the code):** `docs/execution/CURRENT_STATE.md`
(2026-09-14), `docs/pilot-scope.md` (2026-09-14), `docs/connectors/README.md` (2026-09-14),
`docs/product/known-limitations.md` (2026-09-27), `docs/connectors/CONNECTOR_INVENTORY.md` (generated,
2026-09-27), and `P1_WOO_AUTH_READINESS_FOLLOWUP_2026-09-11.md`. Only the last is updated here (its forward
requirement, see section 6). The others are listed for the owners to reconcile once the decision in section 7 is
made; changing them now would assert a conclusion this audit is not entitled to reach.

## 2. What was closed versus how P1 was defined

| Item | Dated definition | Evidence #1052 cites for "closed" | Evidence added since |
|---|---|---|---|
| P1-1 tenant-owned credential persistence and reads | Credentials written and read under the owning `tenant_key` and installation; ownership proven end to end | Runtime observation on `app.vexapim.com`: installation Healthy, credentials masked, admin password to replace, six real publishes; code reads with `{tenantKey, installationId, credentialType}` | Section 3, evidence 1: a sandbox proof of tenant-owned encrypted persistence, cross-tenant denial at both the application and the database layer, collision fail-closed, and signed-state binding |
| P1-2 auth revocation failure policy | **JWT revocation-authority failure behavior** (`AUTH_REVOCATION_FAILURE_POLICY_DECISION_2026-09-03.md`): fail closed on a Redis outage for mutating, admin, step-up and unclassified routes; one bounded degraded-read allowlist; `refresh()` fails closed. The dated records asked for executable outage proof | Connector credential revocation: `reconnectRequestedAt` metadata, `validateCredentials()` false on 401/403, atomic installation delete | Section 3, evidence 2: the existing real-Redis outage proof, run at this SHA |
| P1-3 Woo customer setup/install hold | Hidden from setup and install lanes while P1-1 and P1-2 are open | Hold lifted by #1052 and #1059 | None; this is a decision, not evidence |

The P1-2 evidence cited in #1052 is about WooCommerce credential revocation, which is a different control from
the JWT revocation-authority policy that the dated records define as P1-2. That mismatch is why the outage
proof in section 3 matters: it is the evidence the dated definition asked for, and none was recorded before.

## 3. Evidence, by class

Each row names its class so a reviewer can tell what kind of claim it supports.

### CODE / CI EVIDENCE
- CI is green on `main`. The recent merged PRs each passed `detect-changes`, `build`,
  `connector-network-transport` (Node 22 and 24), `backend-tests` and, where relevant, `e2e` on their exact head.
  This closes the 2026-09-11 finding that `main`'s CI was red.
- Network boundary for tenant-supplied URLs (applies to the WooCommerce site URL): unsafe-address guard fixes
  (#1112), authenticated-redirect handling (#1113, #1117, #1118, #1119), neutral target-security error codes
  (#1120), runtime baseline (#1130, #1131), DNS-rebinding pinning for connectors (#1134) and webhooks (#1138).
  Design records: `docs/design/connector-ssrf-redirect-handling.md`, `docs/design/connector-dns-pinning.md`.
- Credential health (#1141, #1144, #1149): a WooCommerce outage no longer reads as expired credentials or
  promotes an expired installation; a refused URL is `CONFIGURATION_ERROR`; facts surface in the API and UI.
  Design record: `docs/design/connector-credential-health.md`.
- Write safety (#1156, #1157, #1159, #1162): the WooCommerce create is a single attempt with no silent retry;
  a PENDING intent is recorded before the provider write and a lost response is an unknown outcome, not a
  failure. Design record: `docs/design/connector-write-retry-policy.md`.

### LOCAL / SANDBOX EVIDENCE (this audit ran both at `7d109d0d`, 2026-10-05)
1. **WooCommerce credential ownership and tenant isolation** — `scripts/p1-woo-credential-ownership-proof.cjs`
   (#1168). **35/35 proof checks passed, 5/5 product gaps confirmed.** Real WooCommerce 11.1 sandbox, throwaway
   database, random per-run secrets.
   - Provider issuance: WooCommerce itself performed its app-auth callback: `POST`, `application/json`, body
     keys `key_id, user_id, consumer_key, consumer_secret, key_permissions`.
   - Authenticated Vexa credential ingestion, using genuine WooCommerce-issued credentials: stored encrypted
     under the owning tenant and installation; the stored credentials authenticate to the sandbox; a
     wrong-credentials control is refused.
   - Isolation, one layer at a time: application layer alone PASS (API running as the owner role); database
     layer alone PASS (restricted non-bypass role, RLS enforced, direct SQL); combined cross-tenant access DENIED.
   - Collision guard fails closed; forged, replayed, expired, re-targeted, cross-tenant, swapped and
     wrong-connector signed state are all refused, with the credential table unchanged after each.
   - Sensitivity: 13/13 deliberate guard mutations were detected (recorded in #1168).
   - Output file: `evidence/p1-woo-credential-ownership-proof-2026-10-05.txt`.
2. **JWT revocation outage behavior (P1-2 as defined)** — `scripts/p1-auth-revocation-outage-proof.cjs`.
   **9 passed, 0 failed** against a real Redis container that the script stops mid-run: mutating, admin,
   step-up, admin-boundary and unannotated routes are denied; the single `taxonomy_safe_metadata` read is the one
   bounded degraded path; `AuthService.refresh()` fails closed. Output file:
   `evidence/p1-auth-revocation-outage-proof-2026-10-05.txt`.

What these do **not** show: anything about production or any deployed environment; and (item 1) a real
WooCommerce-initiated onboarding into Vexa, which cannot happen (section 5).

### PRODUCTION READ-ONLY EVIDENCE
None collected by this audit (no production access). Candidates for a human to collect safely, read-only:
- the role the tenant-scoped (pooled) client connects as: `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE
  rolname = current_user` on that connection, plus `relrowsecurity` for `connector_credentials` and
  `connector_installations`;
- redacted credential rows for the pilot installation (`tenant_key`, `installation_id`, `credential_type`,
  key version only; never values);
- the installation health and validation facts for the pilot installation (`GET /connectors/installations/health`).

### HUMAN-OWNED EVIDENCE
- Named CTO, PO, Security, QA and SRE approvals for the closure, recorded the way the dated records recorded
  their per-role verdicts.
- Production configuration facts that no sandbox can establish: that the pooled database role is non-bypass,
  and that Redis revocation authority and its monitoring are configured as the policy assumes.
- A controlled production onboarding observation for a consenting tenant (see section 6).

### NOT YET VERIFIED
- Production behavior of any item above; the deployed SHA and its runtime configuration.
- Whether named approvals exist outside the repository.
- Production RLS posture for the tenant-scoped client.
- Multi-variant WooCommerce publishing (a known limitation in the launch policy).
- Dynamics 365 and other connectors (out of scope here).

## 4. Network hardening since the 2026-09-11 record
The 09-11 record could not credit any network-boundary hardening, because none existed. A tenant-supplied
WooCommerce site URL now passes an unsafe-address guard, redirects are validated hop by hop and never carry
credentials cross-origin, and each connection is pinned to the validated address (DNS-rebinding defence). These
are CODE / CI evidence; they are not runtime evidence for any deployed environment.

## 5. Findings

Product gap, recorded as a finding, not as failed engineering evidence. **WooCommerce app-auth onboarding is not
implemented end to end.** Five pieces are missing:

1. **No app-auth URL generation.** `initiateOAuth` throws `CONNECTOR_OAUTH_NOT_SUPPORTED` for WooCommerce (the
   URL builder exists only for Shopify).
2. **No receiver WooCommerce can call.** WooCommerce POSTs JSON to the callback URL. Vexa's only routes to the
   WooCommerce callback method are an authenticated `POST` (needs a Vexa user session) and a public `GET` that needs
   a signed state.
3. **No web initiation.** No API or web code builds or handles a `/wc-auth` URL; the "Authorize" button is
   Shopify-only.
4. **No valid state can be minted for WooCommerce** (consequence of 1), so the public signed-state route cannot
   be used by a real flow.
5. **No install-start for the app-auth path.** The installer requires the consumer key and secret at install
   time, so the documented design ("site URL and webhook secret captured at install start, keys arrive later")
   cannot complete.

Consequences: every WooCommerce onboarding to date used manual API keys. The dated P1 records asked for "real
Woo app-auth onboarding proof"; no such proof was ever obtainable, in any environment.

Other findings:
- **F2 BUG-WOO-OAUTH-QUERY-SECRET.** The public callback accepts `consumer_secret` from the URL query string
  (it would land in access logs and browser history), and the code comment describes WooCommerce delivering
  query parameters, which is wrong. The route is unreachable through any supported initiation today, but its
  contract should be corrected before app-auth is enabled. Not fixed here.
- **F3 Nonce side effect.** A failed `initiate` for WooCommerce still persists an OAuth nonce hash on the
  installation although no state is returned.
- **F4 Closure basis.** See section 2: the cited P1-2 evidence does not address P1-2 as defined; the P1-1
  evidence is an observation, not an ownership proof. Sections 3 evidence 1 and 2 now supply both, in a sandbox.
- **F5 Stale documents.** Six documents still describe the hold as open (section 1).
- **F6 Production RLS posture unverified** (section 3). The sandbox proof shows what holds when the tenant-scoped
  client uses a restricted role; it cannot show that production does.
- **F7 Sequence.** #1052 merged about one hour after #1048 recorded that the hold must stay until named
  sign-offs and current staging and runtime evidence exist. #1052 cites a runtime observation and does not
  record named approvals. This audit records the sequence; it does not judge it.

## 6. The "staging onboarding" requirement, replaced
The earlier records require a "real Woo app-auth onboarding proof in staging". Vexa has no separate staging
environment (the environment named "Staging" serves production traffic), and the flow that proof assumed does
not exist. The requirement is replaced as follows:

**Controlled production onboarding evidence is required, and only for a flow that exists.**
- *Manual-key onboarding (the only flow in use):* controlled production onboarding evidence for a consenting
  tenant or test installation is possible now: redacted ownership evidence, authenticated validation, and named
  sign-offs. No product publish is needed just to prove credential ownership.
- *App-auth onboarding:* there is nothing honest for a human to prove in production until a supported flow
  exists (section 5). It requires a separate product decision and work item, and is **not** part of this audit.

## 7. Decision request (human-owned)
1. **Closure.** Does the 2026-10-03 closure stand? Options: (A) accept it and treat sections 3 and 5 as
   post-closure assurance and open risks; or (B) restore the hold until the human-owned evidence in section 3
   exists. This audit does not choose.
2. **Named approvals.** Record the CTO, PO, Security, QA and SRE verdicts for the closure, or state where they
   are recorded.
3. **SRE.** Collect the production read-only role and RLS evidence in section 3, or confirm the pooled client
   uses a non-bypass role.
4. **App-auth.** Decide whether to build WooCommerce app-auth at all. If yes, correct the callback contract
   (F2) before enabling it; if no, record that manual-key onboarding is the supported path.
5. **Documents.** Reconcile the stale documents in section 1 to whichever way (1) is decided.
6. **Controlled production onboarding.** If a consenting tenant is available, run a manual-key onboarding
   observation per section 6.

## Reproduction
```
npm run build --workspace @pim1/api
# P1-1 ownership and isolation (needs Docker, the WooCommerce sandbox containers, openssl)
P1_PROOF_ADMIN_DATABASE_URL=postgresql://<role with CREATEDB/CREATEROLE>@host:5432/postgres \
  node scripts/p1-woo-credential-ownership-proof.cjs --out evidence.json
# P1-2 outage behavior
docker run -d --name p1-outage-proof-redis -p 16379:6379 redis:7
node scripts/p1-auth-revocation-outage-proof.cjs
docker rm -f p1-outage-proof-redis
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
