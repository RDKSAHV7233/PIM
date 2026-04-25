# FAQ

Status: Canonical  
Last reviewed: 2026-04-25

## Is The Documentation Or Code The Source Of Truth?

The codebase is the source of truth. Documentation must be corrected when it disagrees with implemented routes, controllers, tests, migrations, or runtime validation.

## Which Connector Docs Are Current?

Start with `docs/connectors/README.md`, then verify against `apps/api/src/connectors`, connector framework services, marketplace services, and web route contract tests.

## Is Meesho Publish Implemented?

No. The current Meesho connector is partial and does not implement direct product publish.

## Which Queue Backend Should Production Use?

Production and staging must use `QUEUE_BACKEND=bullmq` with `QUEUE_WORKER_ENABLED=true`.

## How Do I Verify API Docs?

Run `npm run openapi:check`. Commit generated OpenAPI files only when API changes are intentional.

## Can Old Execution Notes Be Deleted?

Do not delete them without an explicit cleanup task. The current recommendation is to archive legacy planning, transfer, and generated evidence documents after preserving useful content in canonical docs.
