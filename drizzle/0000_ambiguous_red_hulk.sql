CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE TYPE "public"."check_status" AS ENUM('pending', 'pass', 'flag', 'error');--> statement-breakpoint
CREATE TYPE "public"."contact_status" AS ENUM('not_sent', 'queued', 'sent', 'replied', 'failed', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('queued', 'generated', 'gate_passed', 'gate_flagged', 'sending', 'sent', 'failed', 'replied', 'suppressed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('draft', 'needs_review', 'queued', 'sending', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."run_kind" AS ENUM('daily', 'manual');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('planning', 'waiting', 'sending', 'done', 'cancelled', 'failed');--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"email" "citext" NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"contact_role" text DEFAULT '' NOT NULL,
	"target_role" text DEFAULT '' NOT NULL,
	"job_url" text,
	"hook" text,
	"linkedin_url" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"resume_id" text,
	"research" jsonb,
	"researched_at" timestamp with time zone,
	"research_opt_in" boolean DEFAULT true NOT NULL,
	"status" "contact_status" DEFAULT 'not_sent' NOT NULL,
	"replied_at" timestamp with time zone,
	"suppressed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"contact_id" text,
	"message_id" text,
	"type" "event_type" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"step" integer DEFAULT 1 NOT NULL,
	"run_id" text,
	"status" "message_status" DEFAULT 'draft' NOT NULL,
	"check_status" "check_status" DEFAULT 'pending' NOT NULL,
	"check_issues" jsonb,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"grounded" boolean DEFAULT false NOT NULL,
	"scheduled_for" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"rfc_message_id" text,
	"in_reply_to" text,
	"references" text,
	"error_code" text,
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resumes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"file_name" text NOT NULL,
	"blob_url" text NOT NULL,
	"extracted_text" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workflow_run_id" text,
	"kind" "run_kind" NOT NULL,
	"status" "run_status" DEFAULT 'planning' NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"planned_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"held_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"email" "citext" NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"clerk_user_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"send_time" time DEFAULT '09:00' NOT NULL,
	"window_start" time DEFAULT '08:00' NOT NULL,
	"window_end" time DEFAULT '18:00' NOT NULL,
	"weekdays_only" boolean DEFAULT true NOT NULL,
	"daily_cap" integer DEFAULT 30 NOT NULL,
	"interval_seconds" integer DEFAULT 120 NOT NULL,
	"jitter_seconds" integer DEFAULT 30 NOT NULL,
	"followup_days" integer DEFAULT 5 NOT NULL,
	"max_followups" integer DEFAULT 2 NOT NULL,
	"tone" text DEFAULT 'warm-direct' NOT NULL,
	"default_resume_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_clerk_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_clerk_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_user_id_users_clerk_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_user_id_users_clerk_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_user_id_users_clerk_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_user_email_unique" ON "contacts" USING btree ("user_id","email");--> statement-breakpoint
CREATE INDEX "contacts_user_status_idx" ON "contacts" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "events_user_created_idx" ON "events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_idempotency_key_unique" ON "messages" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_contact_step_unique" ON "messages" USING btree ("contact_id","step") WHERE status <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "messages_one_pending_per_contact" ON "messages" USING btree ("contact_id") WHERE status IN ('queued', 'sending');--> statement-breakpoint
CREATE INDEX "messages_user_status_scheduled_idx" ON "messages" USING btree ("user_id","status","scheduled_for");--> statement-breakpoint
CREATE INDEX "messages_run_idx" ON "messages" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resumes_one_default_per_user" ON "resumes" USING btree ("user_id") WHERE is_default;--> statement-breakpoint
CREATE INDEX "runs_user_started_idx" ON "runs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_user_email_unique" ON "suppressions" USING btree ("user_id","email");