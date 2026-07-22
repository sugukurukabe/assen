CREATE TYPE "public"."party_type" AS ENUM('company', 'worker', 'tenant_self');--> statement-breakpoint
CREATE TYPE "public"."snapshot_taken_reason" AS ENUM('job_order_accept', 'contract_approve', 'placement_confirm');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('email', 'pdf', 'slack_post', 'manual');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('unverified', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."obligation_evidence_type" AS ENUM('document', 'ledger_row', 'artifact');--> statement-breakpoint
CREATE TYPE "public"."deadline_classification" AS ENUM('legal', 'internal_target');--> statement-breakpoint
CREATE TYPE "public"."rule_set_status" AS ENUM('draft', 'approved', 'retired');--> statement-breakpoint
CREATE TYPE "public"."rule_severity" AS ENUM('info', 'warning', 'blocking');--> statement-breakpoint
CREATE TYPE "public"."employment_period_type" AS ENUM('indefinite', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."fee_type" AS ENUM('uketsuke', 'todokede', 'jogen');--> statement-breakpoint
CREATE TYPE "public"."job_order_source" AS ENUM('zcareer', 'exord', 'direct', 'sns');--> statement-breakpoint
CREATE TYPE "public"."job_order_status" AS ENUM('open', 'filled', 'closed');--> statement-breakpoint
CREATE TYPE "public"."job_seeker_status" AS ENUM('active', 'placed', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."referral_outcome" AS ENUM('hired', 'rejected', 'withdrawn', 'pending');--> statement-breakpoint
CREATE TYPE "public"."referral_phase" AS ENUM('F1', 'F2', 'F3', 'F4', 'F5', 'F6');--> statement-breakpoint
CREATE TYPE "public"."referral_type" AS ENUM('t2p', 'pure', 'direct');--> statement-breakpoint
CREATE TYPE "public"."wage_unit" AS ENUM('hour', 'day', 'month', 'year');--> statement-breakpoint
CREATE TYPE "public"."approval_decision" AS ENUM('approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('draft', 'under_review', 'approved', 'superseded', 'voided');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('not_sent', 'queued', 'sent', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."execution_status" AS ENUM('unsigned', 'partially_signed', 'executed');--> statement-breakpoint
CREATE TYPE "public"."ledger_status" AS ENUM('unposted', 'posted', 'corrected');--> statement-breakpoint
CREATE TYPE "public"."retention_status" AS ENUM('active', 'eligible_for_deletion', 'legal_hold', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'processing', 'done', 'dead');--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"company_name" text NOT NULL,
	"placement_license_number" text NOT NULL,
	"dispatch_license_number" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_settings_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "party_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_type" "party_type" NOT NULL,
	"party_ref_id" text NOT NULL,
	"schema_version" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"taken_reason" "snapshot_taken_reason" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fact_assertions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"field_path" text NOT NULL,
	"candidate_value" jsonb NOT NULL,
	"source_artifact_id" uuid NOT NULL,
	"source_locator" text,
	"extraction_method" text NOT NULL,
	"model_version" text NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"verification_status" "verification_status" DEFAULT 'unverified' NOT NULL,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_type" "source_type" NOT NULL,
	"source_uri" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"immutable_object_uri" text NOT NULL,
	"pii_classification" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deadline_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"policy_key" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"due_date" date NOT NULL,
	"fulfilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deadline_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"trigger_event" text NOT NULL,
	"calculation_method" text NOT NULL,
	"legal_or_internal" "deadline_classification" NOT NULL,
	"jurisdiction" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deadline_policies_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "legal_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_key" text NOT NULL,
	"version" text NOT NULL,
	"legal_source_id" uuid NOT NULL,
	"jurisdiction" text NOT NULL,
	"trigger_schema" jsonb NOT NULL,
	"required_fields_schema" jsonb NOT NULL,
	"severity" "rule_severity" NOT NULL,
	"deadline_policy_id" text,
	"remediation" text,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"authority" text NOT NULL,
	"title" text NOT NULL,
	"source_url" text NOT NULL,
	"published_at" date NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"sha256" text NOT NULL,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"supersedes_source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "obligation_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"obligation_key" text NOT NULL,
	"subject_id" text NOT NULL,
	"evidence_type" "obligation_evidence_type" NOT NULL,
	"evidence_ref" text NOT NULL,
	"acquired_at" timestamp with time zone NOT NULL,
	"acquired_from" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"status" "rule_set_status" DEFAULT 'draft' NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"checksum" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_sets_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_type" text NOT NULL,
	"locale" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"rule_set_version" text NOT NULL,
	"template_version" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"checksum" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatch_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" text NOT NULL,
	"company_id" text NOT NULL,
	"t2p_flag" boolean DEFAULT false NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"org_unit" text,
	"teishokubi" date,
	"conditions_typed" jsonb NOT NULL,
	"extras" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatch_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"dispatch_assignment_id" uuid NOT NULL,
	"staff_id" text NOT NULL,
	"worker_snapshot_id" uuid NOT NULL,
	"client_snapshot_id" uuid NOT NULL,
	"kyotei_taisho" boolean NOT NULL,
	"mukikoyo" boolean NOT NULL,
	"contract_period" text,
	"over_60" boolean DEFAULT false NOT NULL,
	"client_office" text,
	"client_address" text,
	"org_unit" text,
	"dispatch_period" text,
	"work_days" text,
	"work_hours_start" text,
	"work_hours_end" text,
	"work_detail" text NOT NULL,
	"responsibility_level" text,
	"t2p_flag" boolean DEFAULT false NOT NULL,
	"t2p_matters" text,
	"hakenmoto_sekininsha" text,
	"hakensaki_sekininsha" text,
	"overtime_terms" text,
	"social_insurance" jsonb NOT NULL,
	"kyoiku_kunren" jsonb,
	"career_consulting" jsonb,
	"koyou_antei_sochi" jsonb,
	"complaints" jsonb,
	"actual_vs_plan" jsonb,
	"extras" jsonb,
	"retention_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"referral_id" uuid NOT NULL,
	"payer_snapshot_id" uuid NOT NULL,
	"fee_type" "fee_type" NOT NULL,
	"amount_incl_tax" numeric(12, 2) NOT NULL,
	"calc_basis_wage" numeric(12, 2),
	"calc_basis_rate" numeric(6, 4),
	"collected_at" date,
	"correction_of" uuid,
	"correction_reason" text,
	"freee_invoice_ref" text,
	"retention_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_order_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_order_id" uuid NOT NULL,
	"job_seeker_id" text NOT NULL,
	"referred_at" date NOT NULL,
	"outcome" "referral_outcome" DEFAULT 'pending' NOT NULL,
	"hired_at" date,
	"indefinite_employment" boolean,
	"no_poaching_until" date,
	"early_leave_check_at" date,
	"early_leave_check_method" text,
	"early_leave_check_result" text,
	"type" "referral_type" NOT NULL,
	"phase" "referral_phase",
	"dispatch_assignment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" text NOT NULL,
	"employer_snapshot_id" uuid NOT NULL,
	"accepted_at" date NOT NULL,
	"valid_until" date NOT NULL,
	"headcount" integer NOT NULL,
	"occupation" text NOT NULL,
	"work_location" text NOT NULL,
	"employment_period_type" "employment_period_type" NOT NULL,
	"employment_period_detail" text,
	"wage_amount_min" numeric(12, 2),
	"wage_amount_max" numeric(12, 2),
	"wage_unit" "wage_unit" NOT NULL,
	"t2p_flag" boolean DEFAULT false NOT NULL,
	"refund_system" boolean DEFAULT false NOT NULL,
	"source" "job_order_source" NOT NULL,
	"source_artifact_id" uuid,
	"status" "job_order_status" DEFAULT 'open' NOT NULL,
	"extras" jsonb,
	"retention_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_seekers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" text,
	"seeker_snapshot_id" uuid NOT NULL,
	"name_enc" text NOT NULL,
	"address_enc" text NOT NULL,
	"birth_date_enc" text NOT NULL,
	"desired_occupation" text NOT NULL,
	"accepted_at" date NOT NULL,
	"valid_until" date NOT NULL,
	"pii_consent" jsonb NOT NULL,
	"status" "job_seeker_status" DEFAULT 'active' NOT NULL,
	"extras" jsonb,
	"retention_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"subject_version" integer NOT NULL,
	"requested_action" text NOT NULL,
	"artifact_sha256" text NOT NULL,
	"proposed_diff" jsonb,
	"required_role" text NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"nonce" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"decision" "approval_decision",
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_requests_nonce_unique" UNIQUE("nonce")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"logical_document_id" text NOT NULL,
	"version" integer NOT NULL,
	"doc_type" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"template_version" text NOT NULL,
	"rule_set_version" text NOT NULL,
	"input_snapshot_hash" text NOT NULL,
	"generated_object_uri" text,
	"generated_sha256" text,
	"executed_object_uri" text,
	"executed_sha256" text,
	"content_status" "content_status" DEFAULT 'draft' NOT NULL,
	"execution_status" "execution_status" DEFAULT 'unsigned' NOT NULL,
	"delivery_status" "delivery_status" DEFAULT 'not_sent' NOT NULL,
	"ledger_status" "ledger_status" DEFAULT 'unposted' NOT NULL,
	"retention_status" "retention_status" DEFAULT 'active' NOT NULL,
	"superseded_by_document_id" text,
	"delivery_meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"chain_sequence" bigserial NOT NULL,
	"event_id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"aggregate_version" integer NOT NULL,
	"event_type" text NOT NULL,
	"before_hash" text,
	"after_hash" text NOT NULL,
	"actor_principal_id" text NOT NULL,
	"actor_role" text NOT NULL,
	"auth_method" text NOT NULL,
	"request_id" text NOT NULL,
	"trace_id" text,
	"source_ip_or_runtime" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"previous_event_hash" text,
	"event_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactional_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"last_error" text,
	"external_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactional_outbox_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "fact_assertions" ADD CONSTRAINT "fact_assertions_source_artifact_id_source_artifacts_id_fk" FOREIGN KEY ("source_artifact_id") REFERENCES "public"."source_artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_instances" ADD CONSTRAINT "deadline_instances_policy_key_deadline_policies_key_fk" FOREIGN KEY ("policy_key") REFERENCES "public"."deadline_policies"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_rules" ADD CONSTRAINT "legal_rules_legal_source_id_legal_sources_id_fk" FOREIGN KEY ("legal_source_id") REFERENCES "public"."legal_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_rule_set_version_rule_sets_version_fk" FOREIGN KEY ("rule_set_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_ledger_entries" ADD CONSTRAINT "dispatch_ledger_entries_dispatch_assignment_id_dispatch_assignments_id_fk" FOREIGN KEY ("dispatch_assignment_id") REFERENCES "public"."dispatch_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_ledger_entries" ADD CONSTRAINT "dispatch_ledger_entries_worker_snapshot_id_party_snapshots_id_fk" FOREIGN KEY ("worker_snapshot_id") REFERENCES "public"."party_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_ledger_entries" ADD CONSTRAINT "dispatch_ledger_entries_client_snapshot_id_party_snapshots_id_fk" FOREIGN KEY ("client_snapshot_id") REFERENCES "public"."party_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_records" ADD CONSTRAINT "fee_records_referral_id_job_order_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."job_order_referrals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_records" ADD CONSTRAINT "fee_records_payer_snapshot_id_party_snapshots_id_fk" FOREIGN KEY ("payer_snapshot_id") REFERENCES "public"."party_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_order_referrals" ADD CONSTRAINT "job_order_referrals_job_order_id_job_orders_id_fk" FOREIGN KEY ("job_order_id") REFERENCES "public"."job_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_employer_snapshot_id_party_snapshots_id_fk" FOREIGN KEY ("employer_snapshot_id") REFERENCES "public"."party_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_source_artifact_id_source_artifacts_id_fk" FOREIGN KEY ("source_artifact_id") REFERENCES "public"."source_artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_seekers" ADD CONSTRAINT "job_seekers_seeker_snapshot_id_party_snapshots_id_fk" FOREIGN KEY ("seeker_snapshot_id") REFERENCES "public"."party_snapshots"("id") ON DELETE no action ON UPDATE no action;