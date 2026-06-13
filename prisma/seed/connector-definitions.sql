-- prisma/seed/connector-definitions.sql
-- Seed ConnectorDefinition records for Amazon, Flipkart, Meesho
-- Idempotent: safe to re-run on every deploy
-- Run after schema migration in CI/CD pipeline

INSERT INTO "ConnectorDefinition" (
  id, slug, "displayName", "authType", capabilities,
  "marketplaceId", "connectorVersion", "schemaVersion",
  "isActive", "isDeprecated", "createdAt", "updatedAt"
) VALUES
(
  'cdef_amazon_in',
  'amazon-in',
  'Amazon India',
  'OAUTH2_LWA',
  ARRAY['PUBLISH', 'VALIDATE', 'STATUS_SYNC', 'WEBHOOK_RECEIVE']::"ConnectorCap"[],
  'A21TJRUUN4KGV',
  '1.0.0',
  '2021-08-01',
  true,
  false,
  NOW(),
  NOW()
),
(
  'cdef_flipkart',
  'flipkart',
  'Flipkart',
  'OAUTH2_AUTHCODE',
  ARRAY['PUBLISH', 'VALIDATE', 'STATUS_SYNC']::"ConnectorCap"[],
  NULL,
  '1.0.0',
  'v3',
  true,
  false,
  NOW(),
  NOW()
),
(
  'cdef_meesho',
  'meesho',
  'Meesho',
  'API_KEY',
  ARRAY['VALIDATE', 'EXCEL_EXPORT']::"ConnectorCap"[],
  NULL,
  '1.0.0',
  NULL,
  true,
  false,
  NOW(),
  NOW()
)
ON CONFLICT (slug) DO NOTHING;

-- Myntra and Nykaa connectors (INC-40, INC-41)
-- Myntra: live publish connector — Myntra account-manager API enablement required
-- Nykaa:  export/manual connector — portal-upload only in v1; API in v2 requires partner deal
INSERT INTO "ConnectorDefinition" (
  id, slug, "displayName", "authType", capabilities,
  "marketplaceId", "connectorVersion", "schemaVersion",
  "isActive", "isDeprecated", "createdAt", "updatedAt"
) VALUES
(
  'cdef_myntra',
  'myntra',
  'Myntra',
  'API_KEY',
  ARRAY['PUBLISH', 'VALIDATE', 'STATUS_SYNC']::"ConnectorCap"[],
  NULL,
  '1.0.0',
  NULL,
  true,
  false,
  NOW(),
  NOW()
),
(
  'cdef_nykaa',
  'nykaa',
  'Nykaa',
  'NONE',
  ARRAY['VALIDATE', 'EXCEL_EXPORT']::"ConnectorCap"[],
  NULL,
  '1.0.0',
  NULL,
  true,
  false,
  NOW(),
  NOW()
)
ON CONFLICT (slug) DO NOTHING;

-- WooCommerce connector (INC-42, W1)
-- launchStage resolved to "manual" in connector-launch-policy.ts.
-- Capabilities: full publish + webhook. W1 is scaffold + credentials + preflight + validate.
-- Manual-key install: site_url (externalAccountRef) + consumer_key + consumer_secret + webhook_secret.
-- App-auth install: handleOAuthCallback stores consumer_key + consumer_secret from /wc-auth/v1/authorize.
INSERT INTO "ConnectorDefinition" (
  id, slug, "displayName", "authType", capabilities,
  "marketplaceId", "connectorVersion", "schemaVersion",
  "isActive", "isDeprecated", "createdAt", "updatedAt"
) VALUES
(
  'cdef_woocommerce',
  'woocommerce',
  'WooCommerce',
  'API_KEY',
  ARRAY['PUBLISH', 'VALIDATE', 'STATUS_SYNC', 'WEBHOOK_RECEIVE']::"ConnectorCap"[],
  NULL,
  '1.0.0',
  NULL,
  true,
  false,
  NOW(),
  NOW()
)
ON CONFLICT (slug) DO NOTHING;

-- Verify seed applied correctly
SELECT slug, "displayName", "authType", capabilities FROM "ConnectorDefinition";
