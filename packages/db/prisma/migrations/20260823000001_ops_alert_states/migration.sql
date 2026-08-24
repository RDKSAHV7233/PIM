CREATE TABLE "ops_alert_states" (
  "id" TEXT NOT NULL,
  "alert_key" TEXT NOT NULL,
  "alert_type" TEXT NOT NULL,
  "first_observed_at" TIMESTAMP(3) NOT NULL,
  "last_observed_at" TIMESTAMP(3) NOT NULL,
  "last_sent_at" TIMESTAMP(3),
  "cooldown_until" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ops_alert_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ops_alert_states_alert_key_key" ON "ops_alert_states"("alert_key");
CREATE INDEX "idx_ops_alert_states_type_updated" ON "ops_alert_states"("alert_type", "updated_at" DESC);
