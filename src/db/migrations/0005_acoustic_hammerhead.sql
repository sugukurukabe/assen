CREATE TYPE "public"."business_flag" AS ENUM('sugukuru', 'win', 'shared');--> statement-breakpoint
CREATE TYPE "public"."conversion_type" AS ENUM('t2p_conversion', 'win_transition', 'standard_placement_hire');--> statement-breakpoint
CREATE TYPE "public"."fee_invoice_draft_status" AS ENUM('draft', 'approved', 'void');--> statement-breakpoint
CREATE TYPE "public"."fee_status" AS ENUM('billable', 'pending_negotiation', 'on_hold');--> statement-breakpoint
ALTER TYPE "public"."placement_pattern" ADD VALUE 'P5';--> statement-breakpoint
CREATE TABLE "fee_invoice_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"referral_id" uuid NOT NULL,
	"fee_record_id" uuid,
	"status" "fee_invoice_draft_status" DEFAULT 'draft' NOT NULL,
	"payer_company_id" text NOT NULL,
	"payer_name" text NOT NULL,
	"amount_incl_tax" numeric(12, 2),
	"fee_status" "fee_status" DEFAULT 'billable' NOT NULL,
	"title" text NOT NULL,
	"body_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dispatch_assignments" ADD COLUMN "business_flag" "business_flag" DEFAULT 'sugukuru' NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_records" ADD COLUMN "fee_status" "fee_status" DEFAULT 'billable' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_order_referrals" ADD COLUMN "business_flag" "business_flag" DEFAULT 'sugukuru' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_order_referrals" ADD COLUMN "conversion_type" "conversion_type";--> statement-breakpoint
ALTER TABLE "job_orders" ADD COLUMN "business_flag" "business_flag" DEFAULT 'sugukuru' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_seekers" ADD COLUMN "business_flag" "business_flag" DEFAULT 'sugukuru' NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_invoice_drafts" ADD CONSTRAINT "fee_invoice_drafts_referral_id_job_order_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."job_order_referrals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoice_drafts" ADD CONSTRAINT "fee_invoice_drafts_fee_record_id_fee_records_id_fk" FOREIGN KEY ("fee_record_id") REFERENCES "public"."fee_records"("id") ON DELETE set null ON UPDATE no action;