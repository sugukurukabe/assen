ALTER TYPE "public"."snapshot_taken_reason" ADD VALUE 'job_seeker_accept';--> statement-breakpoint
ALTER TABLE "job_order_referrals" ALTER COLUMN "job_seeker_id" SET DATA TYPE uuid USING job_seeker_id::uuid;--> statement-breakpoint
ALTER TABLE "job_order_referrals" ADD COLUMN "conditions_typed" jsonb;--> statement-breakpoint
ALTER TABLE "job_order_referrals" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "job_order_referrals" ADD COLUMN "rejection_reason_received_at" date;--> statement-breakpoint
ALTER TABLE "job_order_referrals" ADD CONSTRAINT "job_order_referrals_job_seeker_id_job_seekers_id_fk" FOREIGN KEY ("job_seeker_id") REFERENCES "public"."job_seekers"("id") ON DELETE no action ON UPDATE no action;