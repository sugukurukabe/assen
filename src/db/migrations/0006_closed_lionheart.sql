CREATE TYPE "public"."placement_revenue_category" AS ENUM('pure_placement', 'dispatch_hire', 'win_management');--> statement-breakpoint
ALTER TABLE "fee_records" ALTER COLUMN "fee_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_records" ALTER COLUMN "amount_incl_tax" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "job_order_referrals" ADD COLUMN "revenue_category" "placement_revenue_category";--> statement-breakpoint
ALTER TABLE "job_order_referrals" ADD COLUMN "expected_revenue_min" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "job_order_referrals" ADD COLUMN "expected_revenue_max" numeric(12, 2);--> statement-breakpoint
INSERT INTO "deadline_policies" ("key", "trigger_event", "calculation_method", "legal_or_internal", "jurisdiction", "effective_from")
VALUES
  ('t2p_month_4', 'dispatch_assignment.confirmed', '紹介予定派遣開始日から4ヶ月。転換意思確認を開始する / 4 months from T2P start / 4 bulan dari mulai T2P', 'internal_target', 'JP', '2026-07-01'),
  ('t2p_month_5', 'dispatch_assignment.confirmed', '紹介予定派遣開始日から5ヶ月。最終条件確認を行う / 5 months from T2P start / 5 bulan dari mulai T2P', 'internal_target', 'JP', '2026-07-01'),
  ('t2p_month_6', 'dispatch_assignment.confirmed', '紹介予定派遣開始日から6ヶ月。法定上限として転換/終了を確定する / 6 months from T2P start / 6 bulan dari mulai T2P', 'legal', 'JP', '2026-07-01')
ON CONFLICT ("key") DO UPDATE SET
  "trigger_event" = EXCLUDED."trigger_event",
  "calculation_method" = EXCLUDED."calculation_method",
  "legal_or_internal" = EXCLUDED."legal_or_internal",
  "jurisdiction" = EXCLUDED."jurisdiction",
  "effective_from" = EXCLUDED."effective_from";--> statement-breakpoint
DELETE FROM "deadline_instances"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      row_number() OVER (
        PARTITION BY "tenant_id", "subject_id", "policy_key"
        ORDER BY "created_at" ASC, "id" ASC
      ) AS rn
    FROM "deadline_instances"
  ) duplicates
  WHERE rn > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "deadline_instances_tenant_subject_policy_uq" ON "deadline_instances" USING btree ("tenant_id","subject_id","policy_key");