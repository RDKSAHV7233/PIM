INSERT INTO connector_definitions (
  id,
  slug,
  display_name,
  auth_type,
  capabilities,
  marketplace_id,
  connector_version,
  is_active,
  created_at,
  updated_at
)
VALUES (
  'cdef_zoho_inventory',
  'zoho-inventory',
  'Zoho Inventory',
  'API_KEY',
  ARRAY['PUBLISH','VALIDATE','STATUS_SYNC']::TEXT[],
  NULL,
  '1.0.0',
  TRUE,
  NOW(),
  NOW()
)
ON CONFLICT (slug)
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  auth_type = EXCLUDED.auth_type,
  capabilities = EXCLUDED.capabilities,
  marketplace_id = EXCLUDED.marketplace_id,
  connector_version = EXCLUDED.connector_version,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();
