ALTER TABLE "social_unlink_jobs" ALTER COLUMN "provider_uid" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "social_unlink_jobs" ADD COLUMN "origin" text DEFAULT 'account_deleted' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_unlink_jobs" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_unlink_jobs" ADD COLUMN "first_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_unlink_jobs" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "social_unlink_jobs" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "social_unlink_jobs_due_idx" ON "social_unlink_jobs" USING btree ("next_attempt_at") WHERE "social_unlink_jobs"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "social_unlink_jobs" ADD CONSTRAINT "social_unlink_jobs_status_check" CHECK ("social_unlink_jobs"."status" IN ('pending', 'failed'));--> statement-breakpoint
ALTER TABLE "social_unlink_jobs" ADD CONSTRAINT "social_unlink_jobs_origin_check" CHECK ("social_unlink_jobs"."origin" IN ('signup', 'account_deleted'));--> statement-breakpoint
ALTER TABLE "social_unlink_jobs" ADD CONSTRAINT "social_unlink_jobs_identifier_check" CHECK ("social_unlink_jobs"."status" <> 'pending' OR "social_unlink_jobs"."provider_uid" IS NOT NULL);