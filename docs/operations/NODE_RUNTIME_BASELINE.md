# Node.js runtime baseline

Supported runtime floor: **Node.js 22** (`engines.node: ">=22"` in the root `package.json`).
Node 20 reached its scheduled end of life in April 2026 and is not a supported runtime for
the API.

| Surface | Node | Source |
|---|---|---|
| Production API service ("Vexa API" on Railway) | 24.x | Railway service runtime, recorded in `CURRENT_PRODUCTION_ARCHITECTURE.md`. The API deploy package (`scripts/prepare-railway-api-package.cjs`) carries `apps/api/package.json`, so no `engines` is set there: a range such as `>=22` could let the Railway builder resolve a newer, non-LTS major. |
| Local development | 24 | `.node-version` |
| Main CI jobs (`ci.yml`) | 22 | `NODE_VERSION: "22"` |
| `Dockerfile.api` | 24 | `node:24-alpine` (all four stages) |

`Dockerfile.api` is **not** the normal release path: `deploy-staging.yml` runs
`scripts/railway-deploy.cjs`, which `railway up`s a package whose generated `railway.toml`
defines the build and start commands. It is still a buildable deployment surface because the
root `railway.json` points Railway at it (`build.dockerfilePath`), so it is kept aligned with
the supported runtime rather than left on an unsupported Node major. Whether the root
Railway/Docker surface is intentionally supported is a separate deployment-governance
decision and is not made here.

## Known Node 20 references not changed here

These predate this baseline and are outside the API image; each needs its own review because
changing it alters a different build or job:

- `Dockerfile.web` (`node:20-alpine`, four stages).
- `scripts/prepare-railway-web-package.cjs` writes `.nvmrc` `20` into the web deploy package.
- Workflows pinned to `node-version: "20"`: `e2e-staging.yml`,
  `media-integrity-production-confirmation.yml`, `sellable-sku-variantless-backfill.yml`,
  `sellable-sku-variantless-production-audit.yml`.

## Verification status

`npm ci --dry-run` against the updated lockfile succeeds. The `node:24-alpine` image build
itself has not been run.
