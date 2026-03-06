CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email               TEXT NOT NULL,
  phone_e164          TEXT,
  password_hash       TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  is_email_verified   BOOLEAN NOT NULL DEFAULT false,
  mfa_enabled         BOOLEAN NOT NULL DEFAULT false,
  mfa_type            TEXT CHECK (mfa_type IN ('totp','email_otp') OR mfa_type IS NULL),
  mfa_secret          TEXT,
  failed_login_count  INT NOT NULL DEFAULT 0,
  locked_until        TIMESTAMPTZ,
  last_login_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS tenant_configs (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  is_enterprise BOOLEAN NOT NULL DEFAULT false,
  mfa_recovery_channels TEXT[] NOT NULL DEFAULT ARRAY['email']::text[],
  trusted_device_exemption_days INT NOT NULL DEFAULT 30 CHECK (trusted_device_exemption_days BETWEEN 1 AND 180),
  max_key_overlap_seconds INT NOT NULL DEFAULT 604800 CHECK (max_key_overlap_seconds BETWEEN 1 AND 2592000),
  max_concurrent_executions INT NOT NULL DEFAULT 5 CHECK (max_concurrent_executions BETWEEN 1 AND 500),
  max_queue_depth INT NOT NULL DEFAULT 1000 CHECK (max_queue_depth BETWEEN 10 AND 200000),
  scheduler_weight INT NOT NULL DEFAULT 1 CHECK (scheduler_weight BETWEEN 1 AND 10),
  mode TEXT NOT NULL DEFAULT 'standard' CHECK (mode IN ('standard', 'strict')),
  sync_enabled BOOLEAN NOT NULL DEFAULT true,
  mfa_required_for_changes BOOLEAN NOT NULL DEFAULT true,
  api_read_per_minute INT NOT NULL DEFAULT 200 CHECK (api_read_per_minute BETWEEN 50 AND 5000),
  audit_retention_years INT NOT NULL DEFAULT 1 CHECK (audit_retention_years BETWEEN 1 AND 7),
  require_reauth_after_inactivity_days INT NOT NULL DEFAULT 30 CHECK (require_reauth_after_inactivity_days BETWEEN 1 AND 365),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  is_system   BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  granted_by  UUID REFERENCES users(id),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  family      UUID NOT NULL,
  is_revoked  BOOLEAN NOT NULL DEFAULT false,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replaced_by UUID REFERENCES refresh_tokens(id),
  user_agent  TEXT,
  ip_address  INET
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code_hash     TEXT NOT NULL,
  purpose       TEXT NOT NULL,
  attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count <= 5),
  max_attempts  INT NOT NULL DEFAULT 5,
  is_used       BOOLEAN NOT NULL DEFAULT false,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE otp_codes DROP CONSTRAINT IF EXISTS otp_codes_attempt_count_check;
ALTER TABLE otp_codes ADD CONSTRAINT otp_codes_attempt_count_check CHECK (attempt_count <= 5);

CREATE TABLE IF NOT EXISTS mfa_backup_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code_index  INT NOT NULL CHECK (code_index BETWEEN 0 AND 9),
  code_hash   TEXT NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trusted_devices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fingerprint_hash  TEXT NOT NULL,
  device_label      TEXT,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL,
  revoked_at        TIMESTAMPTZ,
  UNIQUE (user_id, tenant_id, fingerprint_hash)
);

CREATE TABLE IF NOT EXISTS mfa_reset_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  target_user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by       UUID NOT NULL REFERENCES users(id),
  first_approved_by  UUID NOT NULL REFERENCES users(id),
  second_approved_by UUID REFERENCES users(id),
  status             TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'expired', 'rejected')),
  reason             TEXT,
  expires_at         TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connector_id TEXT,
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  key_prefix   TEXT NOT NULL,
  scopes       TEXT[] NOT NULL DEFAULT '{}'::text[],
  is_active    BOOLEAN NOT NULL DEFAULT true,
  expires_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at   TIMESTAMPTZ,
  revoked_by   UUID REFERENCES users(id),
  rotated_from UUID REFERENCES api_keys(id),
  replaced_by  UUID REFERENCES api_keys(id),
  overlap_expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS access_policies (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID REFERENCES tenants(id) ON DELETE CASCADE,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'role', 'service')),
  principal_id   TEXT NOT NULL,
  action         TEXT NOT NULL,
  domain         TEXT NOT NULL,
  effect         TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
  reason         TEXT,
  expires_at     TIMESTAMPTZ,
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at     TIMESTAMPTZ,
  revoked_by     UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS access_policy_history (
  id         BIGSERIAL PRIMARY KEY,
  policy_id  UUID REFERENCES access_policies(id) ON DELETE CASCADE,
  tenant_id  UUID REFERENCES tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('granted', 'revoked', 'evaluated')),
  actor_id   UUID REFERENCES users(id),
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID REFERENCES tenants(id),
  user_id       UUID REFERENCES users(id),
  actor_type    TEXT NOT NULL,
  actor_id      TEXT NOT NULL,
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  status        TEXT NOT NULL,
  ip_address    INET,
  user_agent    TEXT,
  metadata      JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ
);

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS rotated_from UUID REFERENCES api_keys(id);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS replaced_by UUID REFERENCES api_keys(id);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS overlap_expires_at TIMESTAMPTZ;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS connector_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_e164 TEXT;
ALTER TABLE tenant_configs ADD COLUMN IF NOT EXISTS api_read_per_minute INT NOT NULL DEFAULT 200;
ALTER TABLE tenant_configs ADD COLUMN IF NOT EXISTS max_concurrent_executions INT NOT NULL DEFAULT 5;
ALTER TABLE tenant_configs ADD COLUMN IF NOT EXISTS max_queue_depth INT NOT NULL DEFAULT 1000;
ALTER TABLE tenant_configs ADD COLUMN IF NOT EXISTS scheduler_weight INT NOT NULL DEFAULT 1;
ALTER TABLE tenant_configs ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE tenant_configs ADD COLUMN IF NOT EXISTS sync_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE tenant_configs ADD COLUMN IF NOT EXISTS mfa_required_for_changes BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE connector_event_queue ADD COLUMN IF NOT EXISTS queue_group TEXT NOT NULL DEFAULT 'default';
ALTER TABLE tenant_configs DROP CONSTRAINT IF EXISTS tenant_configs_api_read_per_minute_check;
ALTER TABLE tenant_configs ADD CONSTRAINT tenant_configs_api_read_per_minute_check CHECK (api_read_per_minute BETWEEN 50 AND 5000);
ALTER TABLE tenant_configs DROP CONSTRAINT IF EXISTS tenant_configs_max_concurrent_executions_check;
ALTER TABLE tenant_configs ADD CONSTRAINT tenant_configs_max_concurrent_executions_check CHECK (max_concurrent_executions BETWEEN 1 AND 500);
ALTER TABLE tenant_configs DROP CONSTRAINT IF EXISTS tenant_configs_max_queue_depth_check;
ALTER TABLE tenant_configs ADD CONSTRAINT tenant_configs_max_queue_depth_check CHECK (max_queue_depth BETWEEN 10 AND 200000);
ALTER TABLE tenant_configs DROP CONSTRAINT IF EXISTS tenant_configs_scheduler_weight_check;
ALTER TABLE tenant_configs ADD CONSTRAINT tenant_configs_scheduler_weight_check CHECK (scheduler_weight BETWEEN 1 AND 10);
ALTER TABLE tenant_configs DROP CONSTRAINT IF EXISTS tenant_configs_mode_check;
ALTER TABLE tenant_configs ADD CONSTRAINT tenant_configs_mode_check CHECK (mode IN ('standard', 'strict'));

CREATE TABLE IF NOT EXISTS auth_rate_limit_events (
  id          BIGSERIAL PRIMARY KEY,
  scope       TEXT NOT NULL,
  subject     TEXT NOT NULL,
  tenant_id   UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS executions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connector_id    TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'dead')),
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  replay_of       UUID REFERENCES executions(id),
  retry_count     INT NOT NULL DEFAULT 0,
  max_retries     INT NOT NULL DEFAULT 3 CHECK (max_retries BETWEEN 1 AND 10),
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS execution_events (
  id            BIGSERIAL PRIMARY KEY,
  execution_id  UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  seq           INT NOT NULL,
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (execution_id, seq)
);

CREATE TABLE IF NOT EXISTS control_commands (
  id                   UUID PRIMARY KEY,
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type                 TEXT NOT NULL CHECK (type IN ('RETRY_EXECUTION', 'CANCEL_EXECUTION')),
  target_execution_id  UUID NOT NULL,
  issued_by            TEXT NOT NULL,
  issued_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_command_results (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  command_id   UUID NOT NULL REFERENCES control_commands(id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('ACCEPTED', 'APPLIED', 'REJECTED')),
  at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS connector_event_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  execution_id    UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  connector_id    TEXT NOT NULL,
  queue_group     TEXT NOT NULL DEFAULT 'default',
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'processed', 'failed')),
  attempts        INT NOT NULL DEFAULT 0,
  max_attempts    INT NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  last_error      TEXT,
  available_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS connector_event_idempotency (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connector_id      TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL,
  execution_id      UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, connector_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS tenant_queue_cursors (
  tenant_id         UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  last_dequeued_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dlq_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  execution_id    UUID NOT NULL UNIQUE REFERENCES executions(id) ON DELETE CASCADE,
  connector_id    TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  failure_reason  TEXT NOT NULL,
  failure_count   INT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS connector_runtime_signals (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  signal_type   TEXT NOT NULL CHECK (signal_type IN ('connector_config_reload')),
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS connector_instance_state (
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connector_id   TEXT NOT NULL,
  instance_id    TEXT NOT NULL,
  cursor         JSONB NOT NULL DEFAULT '{}'::jsonb,
  cursor_version INT NOT NULL DEFAULT 1 CHECK (cursor_version >= 1),
  sync_status    TEXT NOT NULL DEFAULT 'ok' CHECK (sync_status IN ('ok', 'needs_resync', 'error')),
  etag           TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, connector_id, instance_id)
);

CREATE TABLE IF NOT EXISTS circuit_breaker_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connector_id  TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('forced_open', 'forced_closed', 'auto_open', 'auto_half_open', 'auto_closed')),
  state         TEXT NOT NULL CHECK (state IN ('open', 'half_open', 'closed')),
  reason        TEXT,
  actor_id      UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE circuit_breaker_events ADD COLUMN IF NOT EXISTS reason TEXT;

CREATE TABLE IF NOT EXISTS connector_definition_registry (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id         TEXT NOT NULL,
  version              TEXT NOT NULL,
  event_schema_version TEXT NOT NULL,
  sdk_contract_version TEXT NOT NULL DEFAULT '1.0',
  role                 TEXT NOT NULL CHECK (role IN ('source', 'sink')),
  source_type          TEXT NOT NULL CHECK (source_type IN ('poll', 'webhook', 'push')),
  auth_method          TEXT NOT NULL CHECK (auth_method IN ('api_key', 'oauth2', 'basic', 'none')),
  display_name         TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  capabilities         TEXT[] NOT NULL DEFAULT '{}'::text[],
  is_active            BOOLEAN NOT NULL DEFAULT true,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by           UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connector_id, version)
);

CREATE TABLE IF NOT EXISTS connector_definitions (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  version        TEXT NOT NULL,
  category       TEXT NOT NULL,
  capabilities   JSONB NOT NULL DEFAULT '[]'::jsonb,
  config_schema  JSONB NOT NULL DEFAULT '{}'::jsonb,
  secrets_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  event_types    JSONB NOT NULL DEFAULT '[]'::jsonb,
  auth_method    TEXT NOT NULL,
  network_policy JSONB,
  rate_limits    JSONB,
  is_enabled     BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS connector_marketplace_listings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id         TEXT NOT NULL,
  connector_version    TEXT NOT NULL,
  listing_slug         TEXT NOT NULL UNIQUE,
  publisher_name       TEXT NOT NULL,
  trust_tier           TEXT NOT NULL DEFAULT 'community' CHECK (trust_tier IN ('community', 'verified', 'enterprise')),
  visibility           TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'unlisted', 'public')),
  support_contact      TEXT,
  docs_url             TEXT,
  pricing_model        TEXT NOT NULL DEFAULT 'custom',
  install_count        INT NOT NULL DEFAULT 0,
  rating               NUMERIC(3,2),
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (connector_id, connector_version)
    REFERENCES connector_definition_registry(connector_id, version)
    ON DELETE CASCADE
);

INSERT INTO roles (tenant_id, name, description, is_system)
SELECT NULL, 'super_admin', 'Full system access', true
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND name = 'super_admin');

INSERT INTO roles (tenant_id, name, description, is_system)
SELECT NULL, 'admin', 'Tenant admin - manage users/config', true
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND name = 'admin');

INSERT INTO roles (tenant_id, name, description, is_system)
SELECT NULL, 'tenant_admin', 'Tenant admin - scoped to one tenant', true
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND name = 'tenant_admin');

INSERT INTO roles (tenant_id, name, description, is_system)
SELECT NULL, 'operator', 'Issue commands, view everything', true
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND name = 'operator');

INSERT INTO roles (tenant_id, name, description, is_system)
SELECT NULL, 'viewer', 'Read-only access', true
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND name = 'viewer');

INSERT INTO roles (tenant_id, name, description, is_system)
SELECT NULL, 'connector', 'Machine identity for connector APIs', true
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND name = 'connector');

INSERT INTO roles (tenant_id, name, description, is_system)
SELECT NULL, 'connector_dev', 'Connector developer access', true
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND name = 'connector_dev');

INSERT INTO permissions (name, description) VALUES
  ('executions:read',   'View execution list and detail'),
  ('executions:write',  'Trigger and manage executions'),
  ('commands:write',    'Issue retry/cancel commands'),
  ('ledger:read',       'View command ledger and results'),
  ('config:read',       'View connector configuration'),
  ('config:write',      'Update connector configuration'),
  ('connectors:manage', 'Manage connector security and runtime controls'),
  ('access:read',       'View access policies and grants'),
  ('access:grant',      'Create access policy grants'),
  ('access:revoke',     'Revoke access policy grants'),
  ('access:review',     'Evaluate effective access decisions'),
  ('users:manage',      'Create/update/deactivate users'),
  ('api_keys:manage',   'Create/rotate/revoke API keys'),
  ('audit:read',        'View audit logs'),
  ('connectors:health', 'View connector health status')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p
  ON (
    r.name = 'super_admin'
    OR (r.name = 'admin' AND p.name = ANY (ARRAY[
      'executions:read', 'executions:write', 'commands:write', 'ledger:read',
      'config:read', 'config:write', 'users:manage', 'api_keys:manage',
      'access:read', 'access:grant', 'access:revoke', 'access:review',
      'audit:read', 'connectors:health', 'connectors:manage'
    ]::text[]))
    OR (r.name = 'tenant_admin' AND p.name = ANY (ARRAY[
      'executions:read', 'executions:write', 'commands:write', 'ledger:read',
      'config:read', 'config:write', 'users:manage', 'api_keys:manage',
      'audit:read', 'connectors:health', 'connectors:manage'
    ]::text[]))
    OR (r.name = 'operator' AND p.name = ANY (ARRAY[
      'executions:read', 'executions:write', 'commands:write', 'ledger:read',
      'config:read', 'connectors:health', 'access:read', 'access:review'
    ]::text[]))
    OR (r.name = 'viewer' AND p.name = ANY (ARRAY[
      'executions:read', 'ledger:read', 'config:read', 'connectors:health'
    ]::text[]))
    OR (r.name = 'connector_dev' AND p.name = ANY (ARRAY[
      'connectors:health', 'connectors:manage'
    ]::text[]))
    OR (r.name = 'connector' AND p.name = ANY (ARRAY['connectors:health']::text[]))
  )
ON CONFLICT DO NOTHING;

INSERT INTO connector_definitions (
  id, name, version, category, capabilities, config_schema, secrets_schema, event_types, auth_method, network_policy, rate_limits, is_enabled
) VALUES
  (
    'flipkart',
    'Flipkart',
    '1.0.0',
    'commerce',
    '["orders:read","events:emit","idempotency"]'::jsonb,
    '{"type":"object","required":["sellerId","apiKey"]}'::jsonb,
    '{"type":"object","required":["apiKey"]}'::jsonb,
    '["order.created","order.updated","order.cancelled"]'::jsonb,
    'api_key',
    '{"egress":["api.flipkart.com"]}'::jsonb,
    '{"requestsPerMinute":100}'::jsonb,
    true
  ),
  (
    'tally',
    'Tally ERP',
    '1.0.0',
    'erp',
    '["vouchers:write","credit_notes:write","health:ping"]'::jsonb,
    '{"type":"object","required":["host","port","companyName"]}'::jsonb,
    '{"type":"object","required":[]}'::jsonb,
    '["invoice.created","credit_note.created","ledger.updated"]'::jsonb,
    'basic',
    '{"egress":["tally.local"]}'::jsonb,
    '{"requestsPerMinute":60}'::jsonb,
    true
  ),
  (
    'ondc',
    'ONDC',
    '1.0.0',
    'commerce',
    '["events:ingest","orders:sync","settlement:read"]'::jsonb,
    '{"type":"object","required":["subscriberId","oauthClientId"]}'::jsonb,
    '{"type":"object","required":["oauthClientSecret","privateKey"]}'::jsonb,
    '["ondc.search","ondc.confirm","ondc.status"]'::jsonb,
    'oauth2',
    '{"egress":["api.ondc.org"]}'::jsonb,
    '{"requestsPerMinute":80}'::jsonb,
    true
  ),
  (
    'razorpay',
    'Razorpay',
    '1.0.0',
    'payments',
    '["payments:ingest","refunds:ingest","hmac:verify"]'::jsonb,
    '{"type":"object","required":["webhookSecret"]}'::jsonb,
    '{"type":"object","required":["webhookSecret"]}'::jsonb,
    '["payment.captured","payment.failed","refund.processed"]'::jsonb,
    'api_key',
    '{"egress":["api.razorpay.com"]}'::jsonb,
    '{"requestsPerMinute":120}'::jsonb,
    true
  ),
  (
    'whatsapp',
    'WhatsApp Business',
    '1.0.0',
    'communications',
    '["messages:send","templates:render","delivery:track"]'::jsonb,
    '{"type":"object","required":["businessPhoneNumberId","accessToken"]}'::jsonb,
    '{"type":"object","required":["accessToken"]}'::jsonb,
    '["notification.dispatch"]'::jsonb,
    'oauth2',
    '{"egress":["graph.facebook.com"]}'::jsonb,
    '{"requestsPerMinute":30}'::jsonb,
    true
  ),
  (
    'generic-rest-sdk',
    'Generic REST SDK',
    '1.5.0',
    'sdk',
    '["events:ingest","schema:validate","sdk:register"]'::jsonb,
    '{"type":"object","required":["baseUrl"]}'::jsonb,
    '{"type":"object","required":[]}'::jsonb,
    '["custom.event"]'::jsonb,
    'none',
    '{"egress":["public"]}'::jsonb,
    '{"requestsPerMinute":200}'::jsonb,
    true
  )
ON CONFLICT (id)
DO UPDATE SET
  name = EXCLUDED.name,
  version = EXCLUDED.version,
  category = EXCLUDED.category,
  capabilities = EXCLUDED.capabilities,
  config_schema = EXCLUDED.config_schema,
  secrets_schema = EXCLUDED.secrets_schema,
  event_types = EXCLUDED.event_types,
  auth_method = EXCLUDED.auth_method,
  network_policy = EXCLUDED.network_policy,
  rate_limits = EXCLUDED.rate_limits,
  is_enabled = EXCLUDED.is_enabled,
  updated_at = NOW();

CREATE INDEX IF NOT EXISTS idx_users_tenant_email ON users (tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_configs_tenant ON tenant_configs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_tenant_user ON user_roles (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_rt_token_hash ON refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_rt_user ON refresh_tokens (user_id, is_revoked);
CREATE INDEX IF NOT EXISTS idx_rt_family ON refresh_tokens (family);
CREATE INDEX IF NOT EXISTS idx_rt_expires ON refresh_tokens (expires_at);
CREATE INDEX IF NOT EXISTS idx_otp_user_expires ON otp_codes (user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_otp_tenant_user ON otp_codes (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_mfa_backup_codes_tenant_user ON mfa_backup_codes (tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mfa_backup_codes_tenant_user_used ON mfa_backup_codes (tenant_id, user_id, used_at);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_tenant_user ON trusted_devices (tenant_id, user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_mfa_reset_requests_tenant_target ON mfa_reset_requests (tenant_id, target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mfa_reset_requests_tenant_status ON mfa_reset_requests (tenant_id, status, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_active ON api_keys (tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys (key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_prefix ON api_keys (tenant_id, key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_connector ON api_keys (tenant_id, connector_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_overlap_expires ON api_keys (tenant_id, overlap_expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_policies_tenant_action_domain ON access_policies (tenant_id, action, domain, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_policies_principal ON access_policies (principal_type, principal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_policies_active ON access_policies (revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_access_policy_history_policy_time ON access_policy_history (policy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_policy_history_tenant_time ON access_policy_history (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limit_scope_subject_time ON auth_rate_limit_events (scope, subject, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limit_tenant_time ON auth_rate_limit_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_executions_tenant_created ON executions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_events_execution_seq ON execution_events (execution_id, seq);
CREATE INDEX IF NOT EXISTS idx_execution_events_tenant_time ON execution_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_commands_tenant_time ON control_commands (tenant_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_commands_tenant_target ON control_commands (tenant_id, target_execution_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_command_results_tenant_time ON control_command_results (tenant_id, at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_control_command_results_command_time ON control_command_results (command_id, at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_connector_event_queue_pending ON connector_event_queue (status, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_connector_event_queue_tenant ON connector_event_queue (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_event_idempotency_lookup ON connector_event_idempotency (tenant_id, connector_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_tenant_queue_cursors_dequeued ON tenant_queue_cursors (last_dequeued_at);
CREATE INDEX IF NOT EXISTS idx_dlq_entries_tenant_time ON dlq_entries (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_definition_registry_lookup ON connector_definition_registry (connector_id, is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_definitions_enabled ON connector_definitions (is_enabled, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_marketplace_visibility ON connector_marketplace_listings (visibility, trust_tier, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_runtime_signals_pending ON connector_runtime_signals (tenant_id, signal_type, consumed_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_instance_state_sync ON connector_instance_state (tenant_id, connector_id, sync_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_circuit_breaker_events_tenant_connector_time ON circuit_breaker_events (tenant_id, connector_id, created_at DESC);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_queue_group()
RETURNS TRIGGER AS $$
DECLARE
  current_group TEXT;
BEGIN
  current_group := COALESCE(current_setting('orbit.queue_group', true), 'default');
  IF NEW.queue_group IS DISTINCT FROM current_group THEN
    RAISE EXCEPTION 'queue_group_mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_tenant_security_defaults()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_enterprise THEN
    NEW.audit_retention_years := 7;
  ELSE
    NEW.audit_retention_years := 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_tenant_configs_updated_at ON tenant_configs;
CREATE TRIGGER trg_tenant_configs_updated_at
BEFORE UPDATE ON tenant_configs
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_connector_event_queue_group ON connector_event_queue;
CREATE TRIGGER trg_connector_event_queue_group
BEFORE INSERT OR UPDATE ON connector_event_queue
FOR EACH ROW EXECUTE FUNCTION enforce_queue_group();

DROP TRIGGER IF EXISTS trg_tenant_configs_security_defaults ON tenant_configs;
CREATE TRIGGER trg_tenant_configs_security_defaults
BEFORE INSERT OR UPDATE ON tenant_configs
FOR EACH ROW EXECUTE FUNCTION enforce_tenant_security_defaults();

DROP TRIGGER IF EXISTS trg_connector_instance_state_updated_at ON connector_instance_state;
CREATE TRIGGER trg_connector_instance_state_updated_at
BEFORE UPDATE ON connector_instance_state
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron extension unavailable, skipping cron setup';
  END;
END
$$;

CREATE OR REPLACE FUNCTION generate_ulid()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  encoding TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  ts_ms BIGINT := FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000);
  ts_part TEXT := '';
  rand_part TEXT := '';
  idx INT;
BEGIN
  FOR i IN 1..10 LOOP
    idx := (ts_ms % 32)::INT;
    ts_part := SUBSTRING(encoding, idx + 1, 1) || ts_part;
    ts_ms := ts_ms / 32;
  END LOOP;

  FOR i IN 1..16 LOOP
    idx := get_byte(gen_random_bytes(1), 0) % 32;
    rand_part := rand_part || SUBSTRING(encoding, idx + 1, 1);
  END LOOP;

  RETURN ts_part || rand_part;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'audit_logs'
      AND c.relkind = 'r'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'audit_logs_legacy'
  ) THEN
    ALTER TABLE audit_logs RENAME TO audit_logs_legacy;
  END IF;
END
$$;

DROP INDEX IF EXISTS idx_audit_tenant_time;
DROP INDEX IF EXISTS idx_audit_user_time;
DROP INDEX IF EXISTS idx_audit_action;

CREATE TABLE IF NOT EXISTS audit_logs (
  id            TEXT NOT NULL DEFAULT generate_ulid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID REFERENCES users(id),
  actor_type    TEXT NOT NULL,
  actor_id      TEXT NOT NULL,
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  status        TEXT NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address    INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, tenant_id)
) PARTITION BY LIST (tenant_id);

CREATE TABLE IF NOT EXISTS audit_logs_default PARTITION OF audit_logs DEFAULT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'audit_logs_legacy'
  ) THEN
    INSERT INTO audit_logs (id, tenant_id, user_id, actor_type, actor_id, action, resource_type, resource_id, status, ip_address, user_agent, metadata, created_at)
    SELECT
      CASE WHEN LENGTH(id::text) >= 26 THEN id::text ELSE generate_ulid() END,
      COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
      user_id,
      actor_type,
      actor_id,
      action,
      resource_type,
      resource_id,
      status,
      ip_address,
      user_agent,
      COALESCE(metadata, '{}'::jsonb),
      created_at
    FROM audit_logs_legacy
    ON CONFLICT (id, tenant_id) DO NOTHING;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS audit_logs_archive (
  id            TEXT PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  user_id       UUID,
  action        TEXT NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address    INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL
);

-- Execution records for autonomous task audit trail and idempotency tracking
CREATE TABLE IF NOT EXISTS execution_records (
  execution_id  TEXT PRIMARY KEY,
  task_name     TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'validating', 'running', 'succeeded', 'failed', 'rolled_back', 'dry_run')),
  started_at    TIMESTAMPTZ NOT NULL,
  completed_at  TIMESTAMPTZ,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS execution_records_task_status_idx ON execution_records(task_name, status);
CREATE INDEX IF NOT EXISTS execution_records_created_at_idx ON execution_records(created_at DESC);

CREATE TABLE IF NOT EXISTS jwt_signing_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_type      TEXT NOT NULL CHECK (key_type IN ('user', 'internal')),
  kid           TEXT NOT NULL,
  algorithm     TEXT NOT NULL DEFAULT 'RS256',
  private_pem   TEXT NOT NULL,
  public_jwk    JSONB NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('active', 'retiring', 'retired')),
  activate_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retire_after  TIMESTAMPTZ,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (key_type, kid)
);

CREATE TABLE IF NOT EXISTS connector_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connector_slug  TEXT NOT NULL,
  host            TEXT,
  port            INT,
  auth_type       TEXT NOT NULL DEFAULT 'basic',
  auth_payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  encrypted_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  oauth_token_expires_at TIMESTAMPTZ,
  oauth_refresh_token_hash TEXT,
  min_required_resource TEXT,
  circuit_breaker JSONB NOT NULL DEFAULT jsonb_build_object(
    'failure_threshold', 5,
    'detection_window_seconds', 60,
    'half_open_probe_interval_seconds', 30,
    'recovery_timeout_seconds', 300,
    'forced_state', 'auto'
  ),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, connector_slug)
);

CREATE TABLE IF NOT EXISTS connector_mapping_versions (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                    UUID REFERENCES tenants(id) ON DELETE CASCADE,
  connector_slug               TEXT NOT NULL,
  category_scope               TEXT NOT NULL DEFAULT '*',
  mapping_level                TEXT NOT NULL CHECK (
    mapping_level IN (
      'connector_default_template',
      'tenant_connector_default',
      'tenant_connector_category_mapping'
    )
  ),
  lifecycle_state              TEXT NOT NULL DEFAULT 'draft' CHECK (
    lifecycle_state IN ('draft', 'validated', 'published', 'superseded', 'archived')
  ),
  connector_definition_id      TEXT NOT NULL,
  connector_definition_version TEXT NOT NULL,
  compatibility_state          TEXT NOT NULL DEFAULT 'compatible' CHECK (
    compatibility_state IN ('compatible', 'deprecated', 'remap_required', 'blocked')
  ),
  mapping_rules                JSONB NOT NULL DEFAULT '{}'::jsonb,
  fallback_policy              JSONB NOT NULL DEFAULT '{}'::jsonb,
  fallback_ack_required        BOOLEAN NOT NULL DEFAULT false,
  published_at                 TIMESTAMPTZ,
  superseded_by                UUID REFERENCES connector_mapping_versions(id),
  created_by                   UUID REFERENCES users(id),
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at                  TIMESTAMPTZ
);

ALTER TABLE connector_mapping_versions DROP CONSTRAINT IF EXISTS connector_mapping_versions_scope_check;
ALTER TABLE connector_mapping_versions
  ADD CONSTRAINT connector_mapping_versions_scope_check
  CHECK (
    (
      mapping_level = 'connector_default_template'
      AND tenant_id IS NULL
      AND category_scope = '*'
    )
    OR (
      mapping_level = 'tenant_connector_default'
      AND tenant_id IS NOT NULL
      AND category_scope = '*'
    )
    OR (
      mapping_level = 'tenant_connector_category_mapping'
      AND tenant_id IS NOT NULL
      AND category_scope <> '*'
    )
  );

CREATE TABLE IF NOT EXISTS connector_mapping_events (
  id                 BIGSERIAL PRIMARY KEY,
  tenant_id          UUID REFERENCES tenants(id) ON DELETE CASCADE,
  mapping_version_id UUID NOT NULL REFERENCES connector_mapping_versions(id) ON DELETE CASCADE,
  event_type         TEXT NOT NULL CHECK (
    event_type IN (
      'created',
      'validated',
      'published',
      'superseded',
      'archived',
      'resolution_evaluated'
    )
  ),
  actor_id           UUID REFERENCES users(id),
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS connector_metrics (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connector_id   UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
  latency_p50_ms NUMERIC(10,2) NOT NULL,
  latency_p95_ms NUMERIC(10,2) NOT NULL,
  latency_p99_ms NUMERIC(10,2) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS login_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ip_address   INET NOT NULL,
  country      TEXT NOT NULL DEFAULT 'unknown',
  asn          TEXT NOT NULL DEFAULT 'unknown',
  user_agent   TEXT,
  logged_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION archive_expired_audit_logs()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO audit_logs_archive (id, tenant_id, user_id, action, metadata, ip_address, user_agent, created_at)
  SELECT
    al.id,
    al.tenant_id,
    al.user_id,
    al.action,
    al.metadata,
    al.ip_address,
    al.user_agent,
    al.created_at
  FROM audit_logs al
  JOIN tenant_configs tc ON tc.tenant_id = al.tenant_id
  WHERE al.created_at < NOW() - make_interval(years => tc.audit_retention_years)
  ON CONFLICT (id) DO NOTHING;

  DELETE FROM audit_logs al
  USING tenant_configs tc
  WHERE tc.tenant_id = al.tenant_id
    AND al.created_at < NOW() - make_interval(years => tc.audit_retention_years);
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'orbit-audit-archive-daily') THEN
      PERFORM cron.schedule('orbit-audit-archive-daily', '15 2 * * *', $cron$SELECT archive_expired_audit_logs();$cron$);
    END IF;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_expires_at ON audit_logs (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jwt_signing_keys_type_status ON jwt_signing_keys (key_type, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_configs_tenant_slug ON connector_configs (tenant_id, connector_slug);
CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_mapping_published_tenant_scope
  ON connector_mapping_versions (tenant_id, connector_slug, category_scope)
  WHERE tenant_id IS NOT NULL AND lifecycle_state = 'published';
CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_mapping_published_template_scope
  ON connector_mapping_versions (connector_slug)
  WHERE tenant_id IS NULL AND mapping_level = 'connector_default_template' AND lifecycle_state = 'published';
CREATE INDEX IF NOT EXISTS idx_connector_mapping_lookup
  ON connector_mapping_versions (tenant_id, connector_slug, category_scope, lifecycle_state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_mapping_compatibility
  ON connector_mapping_versions (tenant_id, connector_slug, compatibility_state, lifecycle_state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_mapping_events_tenant_time
  ON connector_mapping_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_mapping_events_version_time
  ON connector_mapping_events (mapping_version_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_metrics_recent ON connector_metrics (tenant_id, connector_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_user_recent ON login_history (tenant_id, user_id, logged_in_at DESC);

DROP TRIGGER IF EXISTS trg_connector_configs_updated_at ON connector_configs;
CREATE TRIGGER trg_connector_configs_updated_at
BEFORE UPDATE ON connector_configs
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_connector_mapping_versions_updated_at ON connector_mapping_versions;
CREATE TRIGGER trg_connector_mapping_versions_updated_at
BEFORE UPDATE ON connector_mapping_versions
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_connector_marketplace_listings_updated_at ON connector_marketplace_listings;
CREATE TRIGGER trg_connector_marketplace_listings_updated_at
BEFORE UPDATE ON connector_marketplace_listings
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_connector_definitions_updated_at ON connector_definitions;
CREATE TRIGGER trg_connector_definitions_updated_at
BEFORE UPDATE ON connector_definitions
FOR EACH ROW EXECUTE FUNCTION update_updated_at();
-- Alert Tables
CREATE TABLE IF NOT EXISTS alerts (
  id            TEXT PRIMARY KEY DEFAULT generate_ulid(),
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,
  alert_type    TEXT NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('P0', 'P1', 'P2')),
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id            TEXT PRIMARY KEY DEFAULT generate_ulid(),
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,
  alert_type    TEXT NOT NULL,
  channel       TEXT NOT NULL CHECK (channel IN ('webhook', 'email', 'slack', 'pagerduty')),
  endpoint      TEXT NOT NULL,
  severity_min  TEXT NOT NULL DEFAULT 'P1' CHECK (severity_min IN ('P0', 'P1', 'P2')),
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ,
  UNIQUE (tenant_id, alert_type, channel)
);

CREATE INDEX IF NOT EXISTS idx_alerts_tenant_created ON alerts (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_type_severity ON alerts (alert_type, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_rules_tenant ON alert_rules (tenant_id, enabled);
