-- V2 retains bounded per-sample evidence for exact downstream GEO handoffs.
-- The legacy summary-only table is deliberately unchanged.
create table if not exists public.marketing_geo_visibility_runs_v2 (
  id uuid primary key,
  user_id uuid not null,
  kb_id uuid not null,
  snapshot_id uuid not null,
  question_set_hash text not null check (question_set_hash ~ '^[a-f0-9]{64}$'),
  report jsonb not null check (jsonb_typeof(report) = 'object' and octet_length(report::text) <= 4194304),
  created_at timestamptz not null default now(),
  constraint marketing_geo_visibility_v2_kb_fk foreign key (kb_id, user_id)
    references public.marketing_geo_knowledge_bases(id, user_id) on delete restrict,
  constraint marketing_geo_visibility_v2_snapshot_fk foreign key (snapshot_id, kb_id, user_id)
    references public.marketing_geo_kb_snapshots(id, kb_id, user_id) on delete restrict
);

create index if not exists marketing_geo_visibility_v2_baseline_idx
  on public.marketing_geo_visibility_runs_v2(user_id, kb_id, question_set_hash, created_at desc, id desc);
create index if not exists marketing_geo_visibility_v2_snapshot_idx
  on public.marketing_geo_visibility_runs_v2(snapshot_id, kb_id, user_id);

drop trigger if exists marketing_geo_visibility_v2_immutable_row on public.marketing_geo_visibility_runs_v2;
create trigger marketing_geo_visibility_v2_immutable_row before update or delete
  on public.marketing_geo_visibility_runs_v2 for each row
  execute function public.marketing_geo_visibility_runs_immutable();
drop trigger if exists marketing_geo_visibility_v2_immutable_truncate on public.marketing_geo_visibility_runs_v2;
create trigger marketing_geo_visibility_v2_immutable_truncate before truncate
  on public.marketing_geo_visibility_runs_v2 for each statement
  execute function public.marketing_geo_visibility_runs_immutable();

alter table public.marketing_geo_visibility_runs_v2 enable row level security;
revoke all on public.marketing_geo_visibility_runs_v2 from public, anon, authenticated, service_role;
grant select on public.marketing_geo_visibility_runs_v2 to service_role;

create or replace function public.marketing_geo_record_visibility_run_v2(
  p_run_id uuid, p_user_id uuid, p_kb_id uuid, p_snapshot_id uuid,
  p_question_set_hash text, p_report jsonb
)
returns table(outcome text, run_id uuid, recorded_at timestamptz)
language plpgsql security definer set search_path = '' set timezone = 'UTC'
as $$
declare
  v_snapshot public.marketing_geo_kb_snapshots;
  v_existing public.marketing_geo_visibility_runs_v2;
begin
  select s.* into v_snapshot from public.marketing_geo_kb_snapshots s
   where s.id = p_snapshot_id and s.kb_id = p_kb_id and s.user_id = p_user_id;
  if not found then
    outcome := 'not_found'; return next; return;
  end if;
  if v_snapshot.question_set_hash is distinct from p_question_set_hash then
    outcome := 'question_set_mismatch'; return next; return;
  end if;
  -- Application parsing validates every measurement. The write boundary also
  -- binds the immutable envelope to the owner-scoped snapshot it really used.
  if p_run_id is null or jsonb_typeof(p_report) is distinct from 'object'
     or octet_length(p_report::text) > 4194304
     or p_report #>> '{manifest,schemaVersion}' is distinct from 'marketing-geo-visibility.v2'
     or p_report #>> '{manifest,runId}' is distinct from p_run_id::text
     or p_report #>> '{manifest,kbId}' is distinct from p_kb_id::text
     or p_report #>> '{manifest,snapshotId}' is distinct from p_snapshot_id::text
     or p_report #>> '{manifest,snapshotRevision}' is distinct from v_snapshot.revision::text
     or p_report #>> '{manifest,questionSetHash}' is distinct from p_question_set_hash then
    outcome := 'report_mismatch'; return next; return;
  end if;
  insert into public.marketing_geo_visibility_runs_v2(id, user_id, kb_id, snapshot_id, question_set_hash, report)
    values(p_run_id, p_user_id, p_kb_id, p_snapshot_id, p_question_set_hash, p_report)
    on conflict (id) do nothing
    returning marketing_geo_visibility_runs_v2.id, marketing_geo_visibility_runs_v2.created_at
      into run_id, recorded_at;
  if found then
    outcome := 'recorded'; return next; return;
  end if;
  -- Another durable-step invocation may have won the insert. Only an exact
  -- replay is idempotent; a reused UUID must never overwrite evidence.
  select r.* into v_existing from public.marketing_geo_visibility_runs_v2 r where r.id = p_run_id;
  if v_existing.user_id = p_user_id and v_existing.kb_id = p_kb_id
     and v_existing.snapshot_id = p_snapshot_id and v_existing.question_set_hash = p_question_set_hash
     and v_existing.report = p_report then
    outcome := 'recorded'; run_id := v_existing.id; recorded_at := v_existing.created_at;
  else
    outcome := 'run_conflict'; run_id := null; recorded_at := null;
  end if;
  return next;
end;
$$;
revoke all on function public.marketing_geo_record_visibility_run_v2(uuid,uuid,uuid,uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.marketing_geo_record_visibility_run_v2(uuid,uuid,uuid,uuid,text,jsonb) to service_role;
