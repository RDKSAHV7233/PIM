# Node.js runtime baseline

Supported runtime floor: **Node.js 22** (`engines.node: ">=22"` in the root `package.json`).
Node 20 reached its scheduled end of life in April 2026 and is not a supported runtime for
the API.

| Surface | Node | Source |
|---|---|---|
| Production API service ("Vexa API" on Railway) | 24.x | Railway service runtime, recorded in `CURRENT_PRODUCTION_ARCHITECTURE.md`. The API deploy package (`scripts/prepare-railway-api-package.cjs`) carries `apps/api/package.json`, so no `engines` is set there: a range such as `>=22` could let the Railway builder resolve a newer, non-LTS major. |
| Local development | 24 | `.node-version` |
| Main CI jobs (`ci.yml`) | 22 | `NODE_VERSION: "22"` |

The API is released by `deploy-staging.yml`, which runs `scripts/railway-deploy.cjs`; that
script `railway up`s a package whose generated `railway.toml` defines the build and start
commands. There is no Docker image path for the API.

## Known Node 20 references not changed here

These predate this baseline; each needs its own review because changing it alters a different
build or job:

- `Dockerfile.web` (`node:20-alpine`, four stages).
- `scripts/prepare-railway-web-package.cjs` writes `.nvmrc` `20` into the web deploy package.
- Workflows pinned to `node-version: "20"`: `e2e-staging.yml`,
  `media-integrity-production-confirmation.yml`, `sellable-sku-variantless-backfill.yml`,
  `sellable-sku-variantless-production-audit.yml`.
