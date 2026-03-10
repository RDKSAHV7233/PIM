CREATE TABLE "WorkspaceDirectory" (
  "id" TEXT NOT NULL,
  "tenantKey" TEXT NOT NULL,
  "workspaceSlug" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WorkspaceDirectory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceDirectory_tenantKey_key" ON "WorkspaceDirectory"("tenantKey");
CREATE UNIQUE INDEX "WorkspaceDirectory_workspaceSlug_key" ON "WorkspaceDirectory"("workspaceSlug");
