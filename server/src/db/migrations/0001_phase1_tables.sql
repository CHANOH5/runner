CREATE TABLE "auth_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_uid" text NOT NULL,
	"revoke_token_enc" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_identities_provider_uid_key" UNIQUE("provider","provider_uid")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"family_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_hash_key" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"push_token" text,
	"app_version" text,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "privacy_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"age_visibility" text DEFAULT 'participants' NOT NULL,
	"gender_visibility" text DEFAULT 'private' NOT NULL,
	"region_visibility" text DEFAULT 'participants' NOT NULL,
	"records_visibility" text DEFAULT 'friends' NOT NULL,
	"listed_in_participants" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"nickname" varchar(12) NOT NULL,
	"nickname_changed_at" timestamp with time zone,
	"avatar_url" text,
	"gender" text,
	"region_code" text,
	"running_since" smallint,
	"bio" varchar(100),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"status" text DEFAULT 'active' NOT NULL,
	"birth_year" smallint NOT NULL,
	"last_login_at" timestamp with time zone,
	"records_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terms_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"version" text NOT NULL,
	"required" boolean NOT NULL,
	"content_url" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	CONSTRAINT "terms_versions_kind_version_key" UNIQUE("kind","version")
);
--> statement-breakpoint
CREATE TABLE "user_consents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"terms_version_id" uuid NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" varchar(30) NOT NULL,
	"body" varchar(500) NOT NULL,
	"send_push" boolean DEFAULT false NOT NULL,
	"link_type" text NOT NULL,
	"link_race_id" uuid,
	"scheduled_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"sent_count" integer,
	"failed_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notices_marketing_daytime" CHECK ("notices"."kind" <> 'marketing' OR "notices"."scheduled_at" IS NULL OR ("notices"."scheduled_at" AT TIME ZONE 'Asia/Seoul')::time BETWEEN '08:00' AND '20:59:59')
);
--> statement-breakpoint
CREATE TABLE "notification_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"race_id" uuid NOT NULL,
	"race_event_id" uuid,
	"kind" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "notification_schedules_race_event_kind_key" UNIQUE NULLS NOT DISTINCT("race_id","race_event_id","kind")
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"registration_alerts" boolean DEFAULT true NOT NULL,
	"dday_alerts" boolean DEFAULT true NOT NULL,
	"social_alerts" boolean DEFAULT true NOT NULL,
	"marketing" boolean DEFAULT false NOT NULL,
	"night_marketing" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"race_id" uuid,
	"notice_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"push_group_key" text,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_deletion_stats" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"reason_code" text,
	"reason_text" varchar(200),
	"deleted_on" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"admin_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_enc" "bytea" NOT NULL,
	"failed_login_count" smallint DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"mfa_enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "admin_users_email_key" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "app_configs" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deletion_jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_name" text NOT NULL,
	"deleted_count" integer NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_unlink_jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_uid" text NOT NULL,
	"revoke_token_enc" "bytea",
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "race_interests" (
	"user_id" uuid NOT NULL,
	"race_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "race_interests_user_id_race_id_pk" PRIMARY KEY("user_id","race_id")
);
--> statement-breakpoint
CREATE TABLE "race_registrations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"race_id" uuid NOT NULL,
	"race_event_id" uuid NOT NULL,
	"goal_time_sec" integer,
	"goal_pace_sec_per_km" integer,
	"verification_level" smallint DEFAULT 0 NOT NULL,
	"finish_time_sec" integer,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "race_registrations_user_race_key" UNIQUE("user_id","race_id")
);
--> statement-breakpoint
CREATE TABLE "race_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"race_id" uuid,
	"origin" text NOT NULL,
	"source_url" text,
	"proposed" jsonb NOT NULL,
	"diff" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "race_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"race_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"distance_m" integer NOT NULL,
	"start_at" timestamp with time zone,
	"time_limit_min" integer,
	"fee_krw" integer,
	"capacity" integer,
	"registration_opens_at" timestamp with time zone,
	"registration_closes_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "race_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"race_id" uuid NOT NULL,
	"user_id" uuid,
	"field" text,
	"message" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "race_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"race_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_name" text NOT NULL,
	"source_url" text,
	"external_id" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"content_hash" text,
	"fetched_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_changed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "races" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"organizer" text,
	"region_code" text NOT NULL,
	"venue_name" text,
	"venue_address" text,
	"race_date" date NOT NULL,
	"timezone" text DEFAULT 'Asia/Seoul' NOT NULL,
	"registration_opens_at" timestamp with time zone,
	"registration_opens_time_known" boolean DEFAULT true NOT NULL,
	"registration_closes_at" timestamp with time zone,
	"course_url" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"publish_status" text DEFAULT 'draft' NOT NULL,
	"race_type" text DEFAULT 'road' NOT NULL,
	"registration_method" text DEFAULT 'unknown' NOT NULL,
	"dedupe_key" text NOT NULL,
	"official_url" text,
	"registration_url" text,
	"last_verified_at" timestamp with time zone,
	"cloned_from" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "races_slug_key" UNIQUE("slug"),
	CONSTRAINT "races_publish_requirements" CHECK ("races"."publish_status" <> 'published' OR ("races"."official_url" IS NOT NULL AND "races"."last_verified_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"race_registration_id" uuid,
	"target_distance_m" integer NOT NULL,
	"predicted_sec" integer NOT NULL,
	"range_min_sec" integer NOT NULL,
	"range_max_sec" integer NOT NULL,
	"confidence" text NOT NULL,
	"model_version" text NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"splits" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"distance_m" integer NOT NULL,
	"duration_sec" integer NOT NULL,
	"run_date" date NOT NULL,
	"category" text NOT NULL,
	"kind" text NOT NULL,
	"race_registration_id" uuid,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_settings" ADD CONSTRAINT "privacy_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_terms_version_id_terms_versions_id_fk" FOREIGN KEY ("terms_version_id") REFERENCES "public"."terms_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_link_race_id_races_id_fk" FOREIGN KEY ("link_race_id") REFERENCES "public"."races"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_schedules" ADD CONSTRAINT "notification_schedules_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_schedules" ADD CONSTRAINT "notification_schedules_race_event_id_race_events_id_fk" FOREIGN KEY ("race_event_id") REFERENCES "public"."race_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_interests" ADD CONSTRAINT "race_interests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_interests" ADD CONSTRAINT "race_interests_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_registrations" ADD CONSTRAINT "race_registrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_registrations" ADD CONSTRAINT "race_registrations_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_registrations" ADD CONSTRAINT "race_registrations_race_event_id_race_events_id_fk" FOREIGN KEY ("race_event_id") REFERENCES "public"."race_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_candidates" ADD CONSTRAINT "race_candidates_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_events" ADD CONSTRAINT "race_events_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_reports" ADD CONSTRAINT "race_reports_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_reports" ADD CONSTRAINT "race_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_sources" ADD CONSTRAINT "race_sources_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_cloned_from_races_id_fk" FOREIGN KEY ("cloned_from") REFERENCES "public"."races"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_race_registration_id_race_registrations_id_fk" FOREIGN KEY ("race_registration_id") REFERENCES "public"."race_registrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_records" ADD CONSTRAINT "run_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_records" ADD CONSTRAINT "run_records_race_registration_id_race_registrations_id_fk" FOREIGN KEY ("race_registration_id") REFERENCES "public"."race_registrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_push_token_key" ON "devices" USING btree ("push_token") WHERE "devices"."push_token" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_profiles_nickname_lower_key" ON "user_profiles" USING btree (lower("nickname"));--> statement-breakpoint
CREATE INDEX "user_consents_user_terms_idx" ON "user_consents" USING btree ("user_id","terms_version_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_schedules_pending_idx" ON "notification_schedules" USING btree ("scheduled_at") WHERE "notification_schedules"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_key" ON "notifications" USING btree ("user_id","race_id","kind","scheduled_at") WHERE "notifications"."race_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_scheduled_idx" ON "notifications" USING btree ("scheduled_at") WHERE "notifications"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "race_registrations_event_pace_idx" ON "race_registrations" USING btree ("race_event_id","goal_pace_sec_per_km");--> statement-breakpoint
CREATE INDEX "race_candidates_status_idx" ON "race_candidates" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "race_events_race_id_idx" ON "race_events" USING btree ("race_id");--> statement-breakpoint
CREATE UNIQUE INDEX "race_sources_primary_key" ON "race_sources" USING btree ("race_id") WHERE "race_sources"."is_primary";--> statement-breakpoint
CREATE INDEX "races_race_date_idx" ON "races" USING btree ("race_date");--> statement-breakpoint
CREATE INDEX "races_region_date_idx" ON "races" USING btree ("region_code","race_date");--> statement-breakpoint
CREATE INDEX "races_registration_opens_at_idx" ON "races" USING btree ("registration_opens_at");--> statement-breakpoint
CREATE INDEX "races_dedupe_key_idx" ON "races" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "predictions_user_created_idx" ON "predictions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "run_records_user_date_idx" ON "run_records" USING btree ("user_id","run_date" DESC NULLS LAST);