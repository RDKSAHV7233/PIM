ALTER TABLE "ChannelMappingTemplate"
ADD COLUMN IF NOT EXISTS "isSystemPack" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "ChannelMappingTemplate"
ADD COLUMN IF NOT EXISTS "createdBy" TEXT NULL;

ALTER TABLE "ChannelMappingTemplate"
ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "ChannelMappingTemplate"
ADD COLUMN IF NOT EXISTS "parentTemplateId" TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'ChannelMappingTemplate_parentTemplateId_fkey'
      AND table_name = 'ChannelMappingTemplate'
  ) THEN
    ALTER TABLE "ChannelMappingTemplate"
    ADD CONSTRAINT "ChannelMappingTemplate_parentTemplateId_fkey"
      FOREIGN KEY ("parentTemplateId") REFERENCES "ChannelMappingTemplate"(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ChannelMappingTemplate_tenant_channel_version_idx"
  ON "ChannelMappingTemplate" ("tenantKey", channel, version);

CREATE INDEX IF NOT EXISTS "ChannelMappingTemplate_parent_template_idx"
  ON "ChannelMappingTemplate" ("parentTemplateId");
