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

-- Verify seed applied correctly
SELECT slug, "displayName", "authType", capabilities FROM "ConnectorDefinition";
