ALTER TABLE "race_registrations" ADD COLUMN "goal_source" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
-- 기존 행: 목표가 있으면 출처를 알 수 없으므로 manual로 둔다 (goal_source CHECK를 걸기 전에 채움). 접수 상태는 기본값 not_registered
UPDATE "race_registrations" SET "goal_source" = 'manual' WHERE "goal_time_sec" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "race_registrations" ADD COLUMN "entry_status" text DEFAULT 'not_registered' NOT NULL;--> statement-breakpoint
ALTER TABLE "race_registrations" ADD COLUMN "entry_status_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "race_registrations" ADD COLUMN "entry_status_source" text;--> statement-breakpoint
CREATE INDEX "race_registrations_race_entry_status_idx" ON "race_registrations" USING btree ("race_id","entry_status");--> statement-breakpoint
ALTER TABLE "race_registrations" ADD CONSTRAINT "race_registrations_entry_status_check" CHECK ("race_registrations"."entry_status" IN ('not_registered', 'registered', 'missed'));--> statement-breakpoint
ALTER TABLE "race_registrations" ADD CONSTRAINT "race_registrations_entry_status_source_check" CHECK ("race_registrations"."entry_status_source" IN ('form', 'return_prompt', 'race_detail', 'my_races'));--> statement-breakpoint
ALTER TABLE "race_registrations" ADD CONSTRAINT "race_registrations_goal_source_check" CHECK ("race_registrations"."goal_source" IN ('prediction', 'manual', 'none') AND ("race_registrations"."goal_source" = 'none') = ("race_registrations"."goal_time_sec" IS NULL));