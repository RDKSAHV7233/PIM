# PIM1 — Codex Execution Instructions
**Project:** PIM1 Connector-First Architecture  
**Stack:** TypeScript · NestJS · Prisma · PostgreSQL · BullMQ · Cloudflare R2  
**Repo root assumption:** `apps/api/src/` for all NestJS source

---

## HOW TO USE THIS PACKAGE

Feed tasks **one sprint at a time**. Do not attempt the full plan in one
prompt — each sprint has a gate check that must pass before the next sprint
is valid input.

**Workflow per sprint:**
1. Read `tasks.json` — filter to the current sprint ID
2. Read the relevant files in `src/` as starting stubs
3. Implement all tasks for that sprint
4. Run the gate check listed in `tasks.json[].gateCheck`
5. If gate passes → commit with tag `{sprintId}-GATE` → start next sprint
6. If gate fails → fix before proceeding

---

## ABSOLUTE RULES — READ BEFORE WRITING ANY CODE

| # | Rule |
|---|------|
| R1 | `strict: true` in tsconfig. Zero type errors. Never cast to `any`. |
| R2 | Every Prisma query on a tenant-scoped model **must** include `tenantId` in `where`. No exceptions. |
| R3 | `ConnectorCredential` encrypted values are **never** logged. Log `installationId` and `credentialType` only. |
| R4 | Webhook endpoints must verify signatures **before** any payload parsing. Reject with 403 on failure. |
| R5 | `idempotencyKey` must be **stable across all retry attempts** for the same logical operation. Format: `${jobId}:PUBLISH`. Never embed `attemptNumber` in the key. |
| R6 | `externalEventId` uniqueness is scoped to `(installationId, externalEventId)` — NOT globally unique. Use compound `@@unique`. |
| R7 | `normaliseError()` returns `ConnectorIssue` (structured), not `string`. |
| R8 | `processExportJob` must check `installation.capabilities.includes('PUBLISH')` before calling publish. Meesho path calls `generateExportFile()` only. |
| R9 | Access tokens are **never** stored in the database. Only `refreshToken` / `apiKey` stored (encrypted). Access tokens in memory per-request only. |
| R10 | All list endpoints must use cursor-based pagination. No unbounded queries. Default page 50, max 200. |
| R11 | Every new public endpoint must have rate limiting. |
| R12 | No `console.log()` in production code paths. Structured JSON logs only. |
| R13 | Migrations are append-only. Never edit an applied migration. |
| R14 | Payload fields storing raw JSON (`payloadSnapshot`, `payload`) must have the governance comment: `// GOVERNANCE: may contain PII. Redact after 90 days, purge after 365 days.` |

---

## REPO STRUCTURE (target state after all sprints)

```
apps/api/src/
├── connector-framework/
│   ├── connector.interface.ts        ← DO NOT MODIFY INTERFACE SHAPE
│   ├── connector.registry.ts
│   ├── connector.context.ts
│   ├── connector-framework.module.ts
│   └── connector-framework.service.ts
├── connectors/
│   ├── amazon/
│   │   ├── amazon.connector.ts
│   │   ├── amazon-lwa.client.ts
│   │   ├── amazon-sp-api.client.ts
│   │   └── amazon.module.ts
│   ├── flipkart/
│   │   ├── flipkart.connector.ts
│   │   ├── flipkart-api.client.ts
│   │   └── flipkart.module.ts
│   └── meesho/
│       ├── meesho.connector.ts
│       ├── meesho-excel.generator.ts
│       └── meesho.module.ts
├── connector-installer/
│   ├── connector-installer.controller.ts
│   ├── connector-installer.module.ts
│   └── connector-installer.service.ts
├── webhook-receiver/
│   ├── webhook-receiver.controller.ts
│   ├── webhook-receiver.module.ts
│   └── webhook-receiver.service.ts
├── workers/
│   ├── publish.worker.ts
│   ├── webhook-processor.worker.ts
│   ├── status-sync.worker.ts
│   └── credential-heartbeat.worker.ts
└── marketplace/
    └── marketplace.service.ts        ← UPDATE processExportJob only
prisma/
└── schema.prisma                     ← AUTHORITATIVE — use as-is
```

---

## ENVIRONMENT VARIABLES REQUIRED

See `.env-templates/.env.example` for all keys. The following must be
present before any connector code runs:

```
DATABASE_URL=
JWT_SECRET=
CREDENTIAL_ENCRYPTION_KEY=   # openssl rand -base64 32
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=
AMAZON_CLIENT_ID=            # from Amazon Developer Console
AMAZON_CLIENT_SECRET=
AMAZON_MARKETPLACE_ID=A21TJRUUN4KGV
FLIPKART_CLIENT_ID=
FLIPKART_CLIENT_SECRET=
MEESHO_API_BASE_URL=
FEATURE_REAL_SPAPI_VALIDATION=false
```

> ⚠️ **R&D BLOCKERS** — See `RD_CONNECTORS.md` for what cannot be
> implemented without external credentials and research. Do not attempt
> those tasks until R&D is complete.

---

## SPRINT ORDER

```
Foundation → P5-S1 → P5-S2 → P5-S3 → P5-S4 → P5-S5
           → P6-S1 → P6-S2 → P6-S3
           → P7-S1 → P7-S2 → P7-S3
```

Each sprint's tasks, acceptance criteria, and gate checks are in `tasks.json`.
