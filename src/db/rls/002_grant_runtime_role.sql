-- runtimeロール（assen_app）へのGRANT：migration権限とruntime権限を分離する（設計書§2.3）。
-- assen_appはsuperuser/BYPASSRLSを持たない前提のため、001_enable_rls.sqlのRLSポリシーが実際に効く。
-- Grants for the runtime role (assen_app): separates migration privileges from runtime privileges (design doc §2.3).
-- assen_app is assumed to have no superuser/BYPASSRLS, so the RLS policies in 001_enable_rls.sql actually take effect.
-- Grant untuk role runtime (assen_app): memisahkan privilege migrasi dari privilege runtime (dokumen desain §2.3).
-- assen_app diasumsikan tidak memiliki superuser/BYPASSRLS, sehingga kebijakan RLS di 001_enable_rls.sql benar-benar berlaku.
--
-- 前提: assen_appロールは事前に作成されていること（ローカルはdocker-compose起動時のinitdbスクリプトで自動作成、
-- CI/本番は別途プロビジョニングする。詳細はREADME.mdの「ローカル開発ロールとRLS」節参照）
-- Prerequisite: the assen_app role must already exist (auto-created locally via the docker-compose initdb script;
-- provisioned separately in CI/production — see README.md "Local dev role & RLS" section for details)
-- Prasyarat: role assen_app harus sudah ada (dibuat otomatis secara lokal via skrip initdb docker-compose;
-- diprovisikan terpisah di CI/produksi — lihat bagian "Role dev lokal & RLS" di README.md)

do $$
begin
  if not exists (select from pg_roles where rolname = 'assen_app') then
    raise exception 'ロール assen_app が存在しません。先に作成してください（docker-composeのinitdbスクリプト、またはCI/本番での事前プロビジョニング） / role assen_app does not exist; create it first (docker-compose initdb script, or provision it beforehand in CI/production)';
  end if;
end $$;

grant usage on schema public to assen_app;
grant usage, select on all sequences in schema public to assen_app;
grant select, insert, update, delete on all tables in schema public to assen_app;

-- audit_eventsは改ざん防止のためUPDATE/DELETEを与えない（001_enable_rls.sqlのpublicからのrevokeと合わせ、
-- 明示的にassen_appからも剥奪する。publicからのrevokeだけでは特定ロールへの明示的なgrantを打ち消せないため）
-- audit_events never gets UPDATE/DELETE, to prevent tampering (in addition to 001_enable_rls.sql's revoke from
-- public, explicitly revoke from assen_app too — a revoke from public alone does not undo an explicit grant to a
-- specific role)
-- audit_events tidak pernah mendapat UPDATE/DELETE, untuk mencegah perubahan (selain revoke dari public di
-- 001_enable_rls.sql, secara eksplisit revoke juga dari assen_app — revoke dari public saja tidak membatalkan
-- grant eksplisit ke role tertentu)
revoke update, delete on audit_events from assen_app;

-- 今後のマイグレーションで追加されるテーブルにも自動的に同じ権限を付与する（migrate.tsを実行するロールが対象）
-- Automatically grants the same privileges to tables added by future migrations (applies to the role running migrate.ts)
-- Secara otomatis memberikan privilege yang sama ke tabel yang ditambahkan migrasi mendatang (berlaku untuk role yang menjalankan migrate.ts)
alter default privileges in schema public grant select, insert, update, delete on tables to assen_app;
alter default privileges in schema public grant usage, select on sequences to assen_app;
