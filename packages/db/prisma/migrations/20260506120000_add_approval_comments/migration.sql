-- CreateTable: approval_comments
CREATE TABLE "approval_comments" (
    "id" TEXT NOT NULL,
    "tenant_key" TEXT NOT NULL DEFAULT 'default',
    "product_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_approval_comments_tenant_product_created" ON "approval_comments"("tenant_key", "product_id", "created_at" DESC);
