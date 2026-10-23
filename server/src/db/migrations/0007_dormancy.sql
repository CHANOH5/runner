ALTER TABLE "users" ADD COLUMN "dormancy_notified_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "users_status_last_login_idx" ON "users" USING btree ("status","last_login_at");