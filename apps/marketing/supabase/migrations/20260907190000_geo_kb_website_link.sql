-- ---------------------------------------------------------------------------
-- D10 -- link the GEO knowledge base to the Website row it is about
--
-- Two registries describe the same site today: `marketing_websites` (the
-- Profile's own row) and `marketing_geo_knowledge_bases`. Nothing joins them
-- except the `canonical_site_key` text, and nothing enforces that the two
-- strings stay equal. So a knowledge base can point at a site that has no
-- Website row at all, and a Profile revision the frozen context claims to have
-- read can belong to a different row than the one the knowledge base is about.
--
-- This installs the join as a real foreign key, and makes it a key that cannot
-- disagree: the reference carries `canonical_site_key` as a third column, so
-- the database itself refuses a pair whose site keys differ. A trigger would
-- have been the other option; a composite key needs nothing to run.
--
-- `website_id` is nullable on purpose. A knowledge base may legitimately exist
-- before its Website row does (the GEO tools accept a URL and mint a knowledge
-- base without requiring a confirmed Profile), and inventing a Website row to
-- satisfy a constraint would put a record in the Profile registry that no
-- person created. NULL means "not linked yet", and `marketing_geo_upsert_kb`
-- links it the first time both rows exist.
--
-- Forward-only: every existing pair is backfilled before the constraint is
-- validated, and a knowledge base with no matching Website simply stays NULL.
-- No row is rewritten into failure.
-- ---------------------------------------------------------------------------

-- An ACCESS EXCLUSIVE lock that has to queue behind an open reader stalls every
-- query that arrives after it. `marketing_websites` is the Profile registry the
-- signed-in app reads on nearly every page, so waiting is the risk here, not the
-- scans -- measured, the validations below are single-digit milliseconds at this
-- product's scale while an 8s reader made the un-timeout'd ALTER stall 7s and
-- everything behind it with it. Three seconds, then a clean abort that
-- ON_ERROR_STOP halts on; every add below is preceded by a drop-if-exists, so
-- the file is re-runnable from the top.
set lock_timeout = '3s';

-- The dependent foreign key goes first. It is built on the unique constraint
-- below, so dropping that one while the FK still stands raises
-- `dependent_objects_still_exist` -- and `if exists` does not suppress a
-- dependency error. Ordering it this way is what lets an interrupted apply be
-- re-run instead of hand-unpicked.
alter table public.marketing_geo_knowledge_bases
  drop constraint if exists marketing_geo_kb_website_fk;

-- The FK target. `(id, user_id)` is already unique; adding the site key makes
-- the reference able to check agreement. `canonical_site_key` is never updated
-- on this table -- only `is_primary` and `current_confirmed_snapshot_id` are --
-- so this key is stable and the FK will not fight a legitimate rename.
alter table public.marketing_websites
  drop constraint if exists marketing_websites_id_user_site_key;
alter table public.marketing_websites
  add constraint marketing_websites_id_user_site_key
  unique (id, user_id, canonical_site_key);

alter table public.marketing_geo_knowledge_bases
  add column if not exists website_id uuid;

update public.marketing_geo_knowledge_bases as k
   set website_id = w.id
  from public.marketing_websites as w
 where k.website_id is null
   and w.user_id = k.user_id
   and w.canonical_site_key = k.canonical_site_key;

-- Installed NOT VALID, then validated under a weaker lock. The backfill above
-- means validation cannot fail. This bounds the exclusive window independently
-- of row count only when the file is applied statement by statement
-- (`psql -f`, autocommit); pasted whole into the Supabase SQL Editor every lock
-- in the file is held together until the end of it. The FK was already dropped
-- at the top of this file, ahead of the unique constraint it depends on.
alter table public.marketing_geo_knowledge_bases
  add constraint marketing_geo_kb_website_fk
  foreign key (website_id, user_id, canonical_site_key)
  references public.marketing_websites (id, user_id, canonical_site_key)
  on delete restrict
  not valid;
alter table public.marketing_geo_knowledge_bases
  validate constraint marketing_geo_kb_website_fk;

-- Every other reference to marketing_websites is ON DELETE RESTRICT, and this
-- one is too: a Website row whose knowledge base still exists must not vanish
-- and leave the knowledge base describing a site the account no longer has.
create index if not exists marketing_geo_kb_website_idx
  on public.marketing_geo_knowledge_bases (website_id)
  where website_id is not null;

-- ---------------------------------------------------------------------------
-- marketing_geo_upsert_kb -- link on create, and link late when the Website
-- row arrives afterwards.
--
-- The body is otherwise unchanged. The lookup is by the same
-- (user_id, canonical_site_key) unique key the previous string join used, so
-- this adopts exactly the pair that join already implied -- it does not widen
-- what counts as the same site.
-- ---------------------------------------------------------------------------
create or replace function public.marketing_geo_upsert_kb(
  p_user_id uuid,
  p_origin text,
  p_host text,
  p_canonical_site_key text
)
returns table (
  kb_id uuid,
  created boolean
)
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_existing public.marketing_geo_knowledge_bases;
  v_website_id uuid;
begin
  select w.id into v_website_id
    from public.marketing_websites as w
   where w.user_id = p_user_id
     and w.canonical_site_key = p_canonical_site_key;

  select k.* into v_existing
    from public.marketing_geo_knowledge_bases as k
   where k.user_id = p_user_id
     and k.canonical_site_key = p_canonical_site_key
   for update;
  if found then
    -- A knowledge base created before its Website row is linked the first time
    -- both exist. Only ever null -> value: an existing link is never repointed,
    -- because the site key is part of the key and cannot have changed.
    if v_existing.website_id is null and v_website_id is not null then
      update public.marketing_geo_knowledge_bases as k
         set website_id = v_website_id,
             updated_at = pg_catalog.now()
       where k.id = v_existing.id
         and k.user_id = p_user_id
         and k.website_id is null;
    end if;
    kb_id := v_existing.id;
    created := false;
    return next;
    return;
  end if;

  insert into public.marketing_geo_knowledge_bases (
    user_id, canonical_site_key, origin, host, website_id
  ) values (
    p_user_id, p_canonical_site_key, p_origin, p_host, v_website_id
  )
  returning id into kb_id;
  created := true;
  return next;
end;
$$;

-- The browser roles must not reach the new column any more than the old ones.
-- (The table-level revoke from the GEO migrations still stands; this is here so
-- a reader of this file does not have to go looking for it.)
revoke all on public.marketing_geo_knowledge_bases from anon, authenticated;
