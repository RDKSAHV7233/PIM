# Connection Pool Runbook

## Environment Variables
- `DATABASE_URL_POOLED`: Application query traffic (PgBouncer / transaction pooling).
- `DATABASE_URL_DIRECT`: Direct Postgres connection for migration-adjacent operations.
- `DB_POOL_APP_NAME`: Optional application name tag for pool telemetry. Default: `pim1-api`.

## PgBouncer Baseline
Use transaction pooling in production:

```
pool_mode = transaction
max_client_conn = 100
default_pool_size = 20
server_idle_timeout = 60
```

## Runtime Checks
- `/api/v1/health` returns `db_pool.active`, `db_pool.idle`, `db_pool.waiting`.
- All app services resolve Prisma via `PrismaService` (pooled URL).
- Direct client is exposed as `PrismaDirectService` for controlled maintenance paths.

## Troubleshooting
1. If `db_pool.waiting` remains non-zero, verify PgBouncer process and pool size.
2. If queries connect directly, check `DATABASE_URL_POOLED` value and deployment secrets.
3. If migrations fail, verify `DATABASE_URL_DIRECT` connectivity and credentials.
