-- RLS（Row Level Security）ポリシー：tenant_idを持つ全テーブルにテナント分離を強制する
-- RLS policies: enforce tenant isolation on every table that carries tenant_id
-- Kebijakan RLS: menegakkan isolasi tenant pada setiap tabel yang memiliki tenant_id
--
-- 適用方法 / How to apply / Cara menerapkan:
--   psql "$DATABASE_URL" -f src/db/rls/001_enable_rls.sql

do $$
declare
  tenant_scoped_table text;
begin
  foreach tenant_scoped_table in array array[
    'party_snapshots',
    'source_artifacts',
    'fact_assertions',
    'job_orders',
    'job_order_referrals',
    'job_seekers',
    'fee_records',
    'dispatch_assignments',
    'dispatch_ledger_entries',
    'deadline_instances',
    'documents',
    'approval_requests',
    'audit_events',
    'transactional_outbox'
  ]
  loop
    execute format('alter table %I enable row level security', tenant_scoped_table);
    execute format('alter table %I force row level security', tenant_scoped_table);
    execute format('drop policy if exists tenant_isolation on %I', tenant_scoped_table);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = current_setting(''app.tenant_id'', true)::uuid) with check (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      tenant_scoped_table
    );
  end loop;
end $$;

-- audit_eventsはUPDATE/DELETEをruntimeロールから完全に剥奪する（改ざん防止の要）
-- audit_events fully revokes UPDATE/DELETE from the runtime role (core tamper-prevention control)
-- audit_events sepenuhnya mencabut UPDATE/DELETE dari role runtime (kontrol inti pencegahan perubahan)
revoke update, delete on audit_events from public;

comment on table audit_events is
  '改ざん困難なハッシュチェーン監査ログ。UPDATE/DELETEはruntimeロールに許可しない。 / Tamper-resistant hash-chained audit log. UPDATE/DELETE are never granted to the runtime role. / Log audit berantai hash yang tahan perubahan. UPDATE/DELETE tidak pernah diberikan ke role runtime.';
