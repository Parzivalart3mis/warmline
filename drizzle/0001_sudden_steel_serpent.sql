ALTER TABLE "messages" ADD COLUMN "resume_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auto_select_resume" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;