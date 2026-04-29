DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccessScopeType') THEN
    ALTER TYPE "AccessScopeType" ADD VALUE IF NOT EXISTS 'vendor';
    ALTER TYPE "AccessScopeType" ADD VALUE IF NOT EXISTS 'owner';
    ALTER TYPE "AccessScopeType" ADD VALUE IF NOT EXISTS 'supplier';
    ALTER TYPE "AccessScopeType" ADD VALUE IF NOT EXISTS 'locale';
    ALTER TYPE "AccessScopeType" ADD VALUE IF NOT EXISTS 'market';
    ALTER TYPE "AccessScopeType" ADD VALUE IF NOT EXISTS 'catalog';
    ALTER TYPE "AccessScopeType" ADD VALUE IF NOT EXISTS 'team';
    ALTER TYPE "AccessScopeType" ADD VALUE IF NOT EXISTS 'assignee';
  END IF;
END $$;
