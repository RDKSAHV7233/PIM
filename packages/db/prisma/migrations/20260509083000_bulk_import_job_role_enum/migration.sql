DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'BulkImportJobRole'
  ) THEN
    CREATE TYPE "BulkImportJobRole" AS ENUM ('standard', 'large_batch');
  END IF;
END $$;

ALTER TABLE "BulkImportJob"
  ALTER COLUMN "jobRole" DROP DEFAULT,
  ALTER COLUMN "jobRole" TYPE "BulkImportJobRole"
    USING ("jobRole"::text::"BulkImportJobRole"),
  ALTER COLUMN "jobRole" SET DEFAULT 'standard';
