-- READ ONLY. Run through an authorized production connection before approving migration.
-- No customer row contents, credentials or mutations.
select current_database() as database_name, current_setting('server_version') as server_version;

select c.relname, c.relrowsecurity,
       has_table_privilege('anon', c.oid, 'select') as anon_select,
       has_table_privilege('authenticated', c.oid, 'select') as authenticated_select,
       has_table_privilege('service_role', c.oid, 'select') as service_select,
       has_table_privilege('service_role', c.oid, 'insert') as service_insert,
       has_table_privilege('service_role', c.oid, 'update') as service_update,
       has_table_privilege('service_role', c.oid, 'delete') as service_delete
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in
 ('marketing_websites','marketing_website_profile_snapshots',
  'marketing_geo_knowledge_bases','marketing_geo_kb_drafts','marketing_geo_kb_snapshots',
  'marketing_geo_snapshot_contexts','marketing_geo_visibility_runs','marketing_geo_visibility_runs_v2')
order by c.relname;

select c.relname, con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con join pg_class c on c.oid=con.conrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in
 ('marketing_website_profile_snapshots','marketing_geo_kb_drafts','marketing_geo_kb_snapshots')
and con.contype='c' order by c.relname, con.conname;

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       md5(pg_get_functiondef(p.oid)) as definition_digest,
       position('profileCopy' in pg_get_functiondef(p.oid)) > 0 as has_profile_copy_guard,
       has_function_privilege('anon',p.oid,'execute') as anon_execute,
       has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
       has_function_privilege('service_role',p.oid,'execute') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('marketing_canonical_jsonb_text','marketing_geo_validate_profile_copy',
  'marketing_geo_save_kb_draft','marketing_geo_freeze_kb','marketing_geo_freeze_kb_with_context')
order by p.proname;

select c.relname,t.tgname,t.tgenabled
from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in
 ('marketing_website_profile_snapshots','marketing_geo_kb_snapshots','marketing_geo_snapshot_contexts')
and not t.tgisinternal order by c.relname,t.tgname;
