-- AI visibility check: one append-only summary row per run.
--
-- The comparison between two runs is decided on the server (ruling D5), which
-- is the only reason this table exists. A run costs real money, so "did this
-- move since last time" cannot depend on the user still having the previous
-- report open in a tab.
--
-- Same privilege shape as 0005 and 0006: browser roles get no table privileges
-- and no policies, service_role reads with an explicit user_id predicate, and
-- the single write path is a SECURITY DEFINER RPC.
--
-- What a row holds is deliberately narrow: the manifest, the aggregate metrics,
-- per-question counts, and the domains the answers cited. No answer text, no
-- excerpt, no credential. The question wording is stored because a comparison
-- has to name the question that changed, and because the wording is already
-- frozen in the snapshot this run points at.
--
-- Requires 0006: the composite foreign keys below resolve at install time, so
-- unlike 0006's dependency on 0005 this one fails loudly rather than at first
-- use.

create table if not exists public.marketing_geo_visibility_runs (
  id                   uuid        primary key default gen_random_uuid(),
  user_id              uuid        not null,
  kb_id                uuid        not null,
  snapshot_id          uuid        not null,
  -- The comparison key. Two runs are comparable only when they asked the same
  -- questions, and this is what says so; a knowledge base edited between runs
  -- produces a different hash and therefore no baseline, which is correct.
  question_set_hash    text        not null
                                   check (question_set_hash ~ '^[a-f0-9]{64}$'),
  samples_per_question integer     not null
                                   check (samples_per_question between 1 and 50),
  manifest             jsonb       not null
                                   check (octet_length(manifest::text) <= 8192),
  metrics              jsonb       not null
                                   check (octet_length(metrics::text) <= 32768),
  per_question         jsonb       not null
                                   check (octet_length(per_question::text) <= 262144),
  cited_domains        jsonb       not null
                                   check (octet_length(cited_domains::text) <= 262144),
  created_at           timestamptz not null default now(),
  -- Bound to the knowledge base by the pair, not by kb_id alone: a run that
  -- names one account's knowledge base and another account's user_id must not
  -- be storable at all.
  constraint marketing_geo_visibility_runs_kb_fk
    foreign key (kb_id, user_id)
    references public.marketing_geo_knowledge_bases (id, user_id)
    on delete restrict,
  -- And to the frozen version it actually asked. The snapshot carries the
  -- question set; a run pointing at a snapshot of some other knowledge base
  -- would make its `question_set_hash` describe questions it never asked.
  constraint marketing_geo_visibility_runs_snapshot_fk
    foreign key (snapshot_id, kb_id, user_id)
    references public.marketing_geo_kb_snapshots (id, kb_id, user_id)
    on delete restrict
);

-- The only read this table serves: the newest run of one knowledge base that
-- asked one particular question set. `id` is in the key because it is also the
-- ordering tiebreak, so the index covers the sort the reader asks for.
create index if not exists marketing_geo_visibility_runs_baseline_idx
  on public.marketing_geo_visibility_runs
     (user_id, kb_id, question_set_hash, created_at desc, id desc);

-- Append-only. Row-level covers update and delete; the statement-level trigger
-- covers TRUNCATE, which row triggers never see.
create or replace function public.marketing_geo_visibility_runs_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'GEO visibility runs are append-only (attempted %)', tg_op;
end;
$$;

drop trigger if exists marketing_geo_visibility_runs_immutable_row
  on public.marketing_geo_visibility_runs;
create trigger marketing_geo_visibility_runs_immutable_row
  before update or delete on public.marketing_geo_visibility_runs
  for each row execute function public.marketing_geo_visibility_runs_immutable();

drop trigger if exists marketing_geo_visibility_runs_immutable_truncate
  on public.marketing_geo_visibility_runs;
create trigger marketing_geo_visibility_runs_immutable_truncate
  before truncate on public.marketing_geo_visibility_runs
  for each statement
  execute function public.marketing_geo_visibility_runs_immutable();

alter table public.marketing_geo_visibility_runs enable row level security;

revoke all on public.marketing_geo_visibility_runs from anon, authenticated;

-- service_role carries BYPASSRLS, so the write ban has to be a privilege ban.
revoke insert, update, delete, truncate on public.marketing_geo_visibility_runs
  from service_role;

grant select on public.marketing_geo_visibility_runs to service_role;

-- Record one finished run.
--
-- The knowledge base and the snapshot are re-checked here rather than left to
-- the foreign keys, because a violation has to come back as an outcome the
-- caller can render. A foreign key failure reaches PostgREST as an opaque
-- transport error, and "this knowledge base is not yours" and "the database is
-- down" must not look alike.
--
-- The OUT parameters are named `run_id` and `recorded_at` rather than `id` and
-- `created_at` on purpose. In 0006 an OUT parameter that shared a column name
-- made the `returning` clause ambiguous and every freeze failed; naming them
-- apart removes that whole class instead of relying on each `returning` target
-- staying qualified. They are qualified below as well.
create or replace function public.marketing_geo_record_visibility_run(
  p_user_id uuid,
  p_kb_id uuid,
  p_snapshot_id uuid,
  p_question_set_hash text,
  p_samples_per_question integer,
  p_manifest jsonb,
  p_metrics jsonb,
  p_per_question jsonb,
  p_cited_domains jsonb
)
returns table (
  outcome text,
  run_id uuid,
  recorded_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_snapshot public.marketing_geo_kb_snapshots;
begin
  -- One lookup answers both questions: the snapshot row is reachable only
  -- through the pair (kb_id, user_id), so a knowledge base that is not this
  -- user's yields nothing, exactly as a missing one does. Existence is not
  -- leaked, which is the same choice 0006 made.
  select s.* into v_snapshot
    from public.marketing_geo_kb_snapshots as s
   where s.id = p_snapshot_id
     and s.kb_id = p_kb_id
     and s.user_id = p_user_id;
  if not found then
    outcome := 'not_found';
    run_id := null;
    recorded_at := null;
    return next;
    return;
  end if;

  -- The fingerprint has to be the one the frozen version really carries.
  -- Without this a row could claim a hash the snapshot never had, and two runs
  -- that asked different questions would then be found comparable - a diff
  -- computed across two different question sets is worse than no diff.
  if v_snapshot.question_set_hash is distinct from p_question_set_hash then
    outcome := 'question_set_mismatch';
    run_id := null;
    recorded_at := null;
    return next;
    return;
  end if;

  insert into public.marketing_geo_visibility_runs (
    user_id, kb_id, snapshot_id, question_set_hash, samples_per_question,
    manifest, metrics, per_question, cited_domains
  ) values (
    p_user_id, p_kb_id, p_snapshot_id, p_question_set_hash,
    p_samples_per_question, p_manifest, p_metrics, p_per_question,
    p_cited_domains
  )
  returning
    marketing_geo_visibility_runs.id,
    marketing_geo_visibility_runs.created_at
    into run_id, recorded_at;

  outcome := 'recorded';
  return next;
end;
$$;

revoke all on function public.marketing_geo_record_visibility_run(
  uuid, uuid, uuid, text, integer, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.marketing_geo_record_visibility_run(
  uuid, uuid, uuid, text, integer, jsonb, jsonb, jsonb, jsonb
) to service_role;
