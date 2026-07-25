-- 有料職業紹介特化：監督職判定・スコア・選考段階・問い合わせ(Stage0)を追加
-- Paid-placement specialization: supervisor gate, scoring, selection stages, inquiries (Stage 0)
-- Spesialisasi penyaluran berbayar: gerbang pengawas, skor, tahap seleksi, inquiry (Stage 0)

CREATE TYPE "public"."score_grade" AS ENUM('S', 'A', 'B', 'C');--> statement-breakpoint
CREATE TYPE "public"."supervisor_gate_result" AS ENUM('allowed_supervisor', 'blocked_construction_site', 'blocked_port', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."selection_stage" AS ENUM('registered', 'screening', 'interview', 'offer', 'placed');--> statement-breakpoint
CREATE TYPE "public"."placement_pattern" AS ENUM('P1', 'P2', 'P3', 'P4');--> statement-breakpoint
CREATE TYPE "public"."application_channel" AS ENUM('sugukuru_job', 'win_job', 'sns_application', 'other_agency', 'direct_referral', 'internal_conversion');--> statement-breakpoint
CREATE TYPE "public"."inquiry_status" AS ENUM('open', 'set_sent', 'promoted', 'closed');--> statement-breakpoint

ALTER TABLE "job_orders" ADD COLUMN "job_title" text;--> statement-breakpoint
ALTER TABLE "job_orders" ADD COLUMN "actual_duties" text;--> statement-breakpoint
ALTER TABLE "job_orders" ADD COLUMN "supervisor_assessment" jsonb;--> statement-breakpoint
ALTER TABLE "job_orders" ADD COLUMN "supervisor_gate_result" "supervisor_gate_result";--> statement-breakpoint
ALTER TABLE "job_orders" ADD COLUMN "zcareer_job_id" text;--> statement-breakpoint
ALTER TABLE "job_orders" ADD COLUMN "score_grade" "score_grade";--> statement-breakpoint
ALTER TABLE "job_orders" ADD COLUMN "score_total" integer;--> statement-breakpoint
ALTER TABLE "job_orders" ADD COLUMN "score_breakdown" jsonb;--> statement-breakpoint

ALTER TABLE "job_order_referrals" ADD COLUMN "selection_stage" "selection_stage" DEFAULT 'registered' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_order_referrals" ADD COLUMN "placement_pattern" "placement_pattern";--> statement-breakpoint
ALTER TABLE "job_order_referrals" ADD COLUMN "registered_at" date;--> statement-breakpoint
ALTER TABLE "job_order_referrals" ADD COLUMN "screening_at" date;--> statement-breakpoint
ALTER TABLE "job_order_referrals" ADD COLUMN "interview_at" date;--> statement-breakpoint
ALTER TABLE "job_order_referrals" ADD COLUMN "offer_at" date;--> statement-breakpoint
ALTER TABLE "job_order_referrals" ADD COLUMN "placed_at" date;--> statement-breakpoint

ALTER TABLE "job_seekers" ADD COLUMN "application_channel" "application_channel";--> statement-breakpoint
ALTER TABLE "job_seekers" ADD COLUMN "inquiry_id" uuid;--> statement-breakpoint

CREATE TABLE "inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"channel" "application_channel" NOT NULL,
	"status" "inquiry_status" DEFAULT 'open' NOT NULL,
	"dm_answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dm_complete" boolean DEFAULT false NOT NULL,
	"has_application_form" boolean DEFAULT false NOT NULL,
	"has_resume" boolean DEFAULT false NOT NULL,
	"has_residence_card" boolean DEFAULT false NOT NULL,
	"has_qualification_docs" boolean DEFAULT false NOT NULL,
	"has_t2p_prior_consent" boolean DEFAULT false NOT NULL,
	"wants_t2p" boolean DEFAULT false NOT NULL,
	"set_sent_at" timestamp with time zone,
	"set_received_at" date,
	"last_contact_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"promoted_job_seeker_id" uuid,
	"notes" text,
	"extras" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
