# AI provider credential runbook (Stream B, B6)

Date: 2026-10-07
Baseline: `origin/main` at `a475cc0f`
Type: **documentation only.** This runbook creates, reveals and stores **no credential**. No provider account, workspace or key exists because of it.
Status: **proposal / not in force until approved by Security and the CTO.** Every name, interval and owner below is a proposal. Evidence for the design it implements: `docs/qa/ai-prov-004b-design-2026-10-05.md` (section 5, zone rule 4) and `docs/qa/ai-security-decision-pack-2026-10-07.md` (topic 8).

## 0. Hard rules

1. **No agent, script or assistant ever receives, reads, pastes, stores, logs or transmits the provider key.** Not an AI coding agent, not a CI job, not a chat. A human creates it in the provider console and enters it into the service's variable store. Verification is by **variable name present or absent**, never by value.
2. The key lives in **one** place: a variable on the **Vexa API service only**. Not in the repository, `.env` files, GitHub secrets or environments, the web service, build or deploy logs, tickets, chat, screenshots with the value visible, or the database.
3. The key is created **after** the gates in section 2, never speculatively.
4. At the moment the key is first set, the platform feature flag is **off** and the platform control row is **deny-all**. Setting the key never enables anything; enabling is a separate, recorded step.
5. One active key at a time (plus one pending during a rotation window).

## 1. Roles (proposed; names to be filled by humans)

| Role | Responsibility | Named person |
|---|---|---|
| **Key owner** | creates, stores, rotates and revokes the key; holds the key register | ____________________ |
| **Security approver** | approves creation, rotation and any exception; second person for emergency revoke | ____________________ |
| **Audit owner** | owns the key register, the quarterly review and the evidence record | ____________________ |
| **Break-glass delegate** | may perform an emergency revoke (section 7) when the key owner is unreachable | ____________________ |
| **FinOps** | owns the provider-side spend limit (B5) | ____________________ |

Creation requires **two people**: the key owner acts, the Security approver confirms each step in the record.

## 2. Preconditions: what must be true before a key exists

All must be recorded as satisfied, with who and when:

- [ ] Security decisions on the B2 pack are recorded (topics 5, 7, 8, 9 especially).
- [ ] Privacy decisions P1 to P6 on the B3 pack are recorded (DPA signed, ZDR decision, region, subprocessor notice).
- [ ] Provider and model approved (B4); the provider workspace exists with workspace geo `us`.
- [ ] Provider-side spend limit set by a human and its enforcement behaviour (stop or notify) verified and recorded (B5, section 4).
- [ ] 004b-ii merged as a shell that cannot send, with the zone validators and their negative tests green (B7, B8).
- [ ] Stream A signalled that the tenant-isolation boundary is ready; the dormant-state proof re-run and the kill-switch drill passed and recorded (B9, B10).
- [ ] The Vexa API service's variable-access list has been reviewed (section 3) and is acceptable.

If any box is empty, **stop**.

## 3. Where the key is stored

| Item | Proposal |
|---|---|
| Store | a variable on the **Vexa API service** in the single Railway environment (there is exactly one environment; it is what "production" means, `docs/runbooks/production-deploy.md`) |
| Variable name | `INTELLIGENCE_PROVIDER_API_KEY` (proposed; the name is fixed in the implementation PR and in `.env.example` with an **empty** value) |
| Read path | one credential-source function in the adapter zone; it returns nothing when the variable is unset, which is `adapter_unavailable`, a fail-closed result |
| Not stored | the web service (it has no database variables and must have no provider variable), GitHub repository, environment or organisation secrets (CI never calls the provider), the database, any file in the repository |
| Effect of a change | changing a Railway variable restarts the single API replica (design section 2.3); plan for a brief interruption of the whole API, not only the AI feature. This is also why the kill switch is a database row, not this variable |

**Access review (human, before creation).** Record who can read or edit variables on the API service. Variables are masked in the dashboard, but anyone with edit access can reveal or replace them. Reduce that list to the people in section 1 plus the on-call minimum, and record the result. This runbook cannot enforce it; the platform plan cannot enforce required reviews either (B2 finding F-2), so this is a recorded convention.

## 4. Provider-side setup (human, in the provider console)

1. Use a **workspace dedicated to Vexa**, workspace geo `us`, not shared with any other project.
2. Set the workspace spend limit to the approved figure and record the enforcement behaviour (B5, section 4).
3. Restrict the allowed inference geographies to those approved (B3, P4).
4. Set the notification contacts to a monitored group address, not an individual.
5. Create the key **inside that workspace** with the name in section 5, copy it once, and enter it into the variable store. Close the console tab; do not paste it anywhere else.

## 5. Key naming and register

Key name in the console: `vexa-ai-<yyyymm>-<n>`, for example `vexa-ai-202611-1` (proposed), where `<n>` increments within the month. The name carries no secret and no environment name other than what is true: there is one environment.

**Key register** (kept by the audit owner, outside the repository or in a restricted document; the register holds **no key material**):

| Field | Example |
|---|---|
| Key name | `vexa-ai-202611-1` |
| Provider workspace | the workspace id or name |
| Created by / confirmed by / date | two names, one date |
| Purpose and capability | `product_attribute_extraction`, pilot |
| Spend limit at creation | the approved figure |
| Rotation due | creation date plus the interval in section 6 |
| Revoked by / date / reason | filled at revocation |

## 6. Rotation

**Interval (proposed): every 90 days, and immediately on suspected exposure or when anyone with access to the variable store leaves the role.** FinOps and Security may change it.

Because the credential-source function reads one variable and the feature is dormant outside controlled windows, rotation does not need a dual-key code path:

1. Security approver confirms the rotation window; the platform control row is **deny-all** (kill switch on) for the whole window.
2. Key owner creates the **new** key in the same workspace (section 4, step 5) without revoking the old one.
3. Key owner replaces the variable value with the new key. The API restarts.
4. Confirm the variable is **present** (by name, in the dashboard) and the API is healthy. Do not display or copy the value.
5. Only when a controlled call is authorised (the first call after a rotation is part of a recorded controlled window, not an ad hoc test) is the new key exercised. The console's "last used" indicator for the new key is the evidence.
6. Revoke the **old** key (section 8).
7. Update the key register; the audit owner signs the record.

If step 5 shows the new key does not work, set the variable back only if the old key is still active; otherwise leave the feature off and create another key. Never leave two keys active beyond the window.

## 7. Emergency revoke

**Triggers:** a key or a string shaped like one found in a repository, log, ticket, chat or screenshot; unexpected provider spend or usage; the provider reports abuse; a person with access leaves under unclear circumstances; any Security instruction.

**Order (fastest independent stop first; each step is by a human, and the first two may be done in parallel by two people):**

1. **Revoke the key in the provider console.** This is the authoritative stop for provider spend and does not depend on Vexa code or a deploy. Record the time.
2. **Turn the platform kill switch on** (the database control row, read on every call). *Gap: there is no operator command for this today; the drill runbook (B10) must define the exact, tested procedure and who holds the access. Until it does, step 1 and step 3 carry the stop.*
3. **Unset the variable** on the API service (the API restarts; the feature is then `adapter_unavailable`).
4. Preserve evidence: provider usage and request ids, the Vexa execution and reservation records for the window, the Railway deployment log metadata. Do not copy the key.
5. Open the incident record (`docs/runbooks/incident-response.md`) and notify Security and Privacy; Privacy decides whether provider-held data raises a notification duty.
6. After review, create a new key only via sections 2 to 4 (the gates apply again).
7. Reconcile spend: expired reservations settle at the estimate; correct downward only from authoritative usage (B5, sections 6 and 7).

## 8. Planned revoke

1. Security approver confirms the key is no longer needed (rotation complete, or the pilot is ending).
2. Key owner revokes the key in the console; the console shows it as revoked (evidence: the page, dated).
3. Confirm the variable no longer holds that key (by replacement or removal) and record it.
4. Update the key register. Do **not** test revocation by sending a request with the revoked key; the console status is the evidence.

## 9. Detection and review

- **Repository scanning.** Whether GitHub secret scanning or push protection is enabled for this private repository on the current plan is **unverified**; a human checks and records it. The AI credential detector (`sk-` style prefixes) protects model inputs and outputs, not the repository.
- **Quarterly review (audit owner):** the register matches the console's key list one for one; no key past its rotation date; the variable-access list is current; spend against the limit; the last emergency drill date.
- **Alert on:** a key in the console that is not in the register; provider usage when the platform control row is deny-all; provider auth failures (the circuit opens and an alert fires, 004b design).

## 10. What an agent may and may not do

May: draft and update this runbook; check that a variable **name** is absent from a repository, `.env.example` or a workflow file; run the repository's credential-pattern validators; prepare the key register template.
May not: create a key, request one, read or set the variable, print it, paste it into a command, test a key, or receive it in chat.

## 11. Sign-off block (blank)

| Item | Decision | Name and date |
|---|---|---|
| Runbook approved as written (Security) | [ ] | |
| Runbook approved as written (CTO) | [ ] | |
| Key owner, Security approver, audit owner, break-glass delegate named | [ ] | |
| Variable name and 90-day interval accepted | [ ] | |
| Variable-access list reviewed and recorded | [ ] | |
| Emergency step 2 (kill-switch procedure) defined in B10 | [ ] | |
