-- AlterTable
ALTER TABLE "ChannelMappingTemplate"
  ALTER COLUMN "channel" TYPE VARCHAR(64) USING "channel"::varchar(64);

-- AlterTable
ALTER TABLE "MarketplaceExportJob"
  ALTER COLUMN "channel" TYPE VARCHAR(64) USING "channel"::varchar(64);

-- DropEnum
DROP TYPE "MarketplaceChannel";
