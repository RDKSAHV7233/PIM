WITH ranked_by_workspace AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "workspaceSlug"
      ORDER BY
        CASE
          WHEN "status" = 'verified' THEN 0
          WHEN "status" = 'pending' THEN 1
          ELSE 2
        END,
        "updatedAt" DESC,
        "createdAt" DESC,
        "id" DESC
    ) AS row_rank
  FROM "PublicSignupRequest"
),
workspace_duplicates AS (
  SELECT "id" FROM ranked_by_workspace WHERE row_rank > 1
)
DELETE FROM "PublicSignupRequest"
WHERE "id" IN (SELECT "id" FROM workspace_duplicates);

WITH ranked_by_email AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "adminEmail"
      ORDER BY
        CASE
          WHEN "status" = 'verified' THEN 0
          WHEN "status" = 'pending' THEN 1
          ELSE 2
        END,
        "updatedAt" DESC,
        "createdAt" DESC,
        "id" DESC
    ) AS row_rank
  FROM "PublicSignupRequest"
),
email_duplicates AS (
  SELECT "id" FROM ranked_by_email WHERE row_rank > 1
)
DELETE FROM "PublicSignupRequest"
WHERE "id" IN (SELECT "id" FROM email_duplicates);

CREATE UNIQUE INDEX IF NOT EXISTS "PublicSignupRequest_workspaceSlug_key"
  ON "PublicSignupRequest" ("workspaceSlug");

CREATE UNIQUE INDEX IF NOT EXISTS "PublicSignupRequest_adminEmail_key"
  ON "PublicSignupRequest" ("adminEmail");
