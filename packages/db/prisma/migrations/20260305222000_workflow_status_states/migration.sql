-- Add explicit product workflow states for Draft/Review/Approved/Rejected lifecycle
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'RecordStatus' AND e.enumlabel = 'in_review'
  ) THEN
    ALTER TYPE "RecordStatus" ADD VALUE 'in_review';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'RecordStatus' AND e.enumlabel = 'approved'
  ) THEN
    ALTER TYPE "RecordStatus" ADD VALUE 'approved';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'RecordStatus' AND e.enumlabel = 'rejected'
  ) THEN
    ALTER TYPE "RecordStatus" ADD VALUE 'rejected';
  END IF;
END $$;
