-- @input  -- schema task_center, which migrate.sh creates before running any file
-- @output -- dramas, their clip assets, promoter claims, promo clicks and imported settlement rows
-- @pos    -- first migration of the gengrowth_tasks database on TencentDB, apart from supabase/migrations
-- 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
--
-- Only the app's own role connects to this database, so there are no grants
-- and no row-level security: every read and write goes through server code
-- that has already checked the Supabase session or the admin allowlist.
-- gen_random_uuid() is core PostgreSQL since 13; no extension is needed, and
-- the owner is not a superuser so it could not create one anyway.

create table task_center.dramas (
  id                uuid        primary key default gen_random_uuid(),
  title             text        not null check (char_length(title) between 1 and 200),
  title_cn          text        check (title_cn is null or char_length(title_cn) between 1 and 200),
  platform          text        not null check (platform ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
  language          text        not null check (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$'),
  episodes          integer     check (episodes is null or episodes between 1 and 2000),
  -- The first paid episode. Null when nobody told us, which the page shows as
  -- no lock at all rather than guessing every episode is free.
  pay_start         integer     check (pay_start is null or pay_start >= 1),
  synopsis          text        check (synopsis is null or char_length(synopsis) <= 4000),
  cover_key         text        check (cover_key is null or char_length(cover_key) between 1 and 512),
  -- Where /t/<code> sends a visitor: the distribution link the platform gave us.
  promo_target_url  text        check (promo_target_url is null
                                       or (promo_target_url ~ '^https://[^[:space:]]+$'
                                           and char_length(promo_target_url) <= 2048)),
  -- The platform's sub-channel query parameter, when it has one. Set, the
  -- promo code rides along on the redirect so settlement can be matched back.
  promo_code_param  text        check (promo_code_param is null or promo_code_param ~ '^[A-Za-z0-9_]{1,32}$'),
  status            text        not null default 'draft'
                                check (status in ('draft', 'published', 'archived')),
  -- Set on first publish and kept, so "newest" means first listed, not last edited.
  listed_at         timestamptz,
  created_by        text        not null check (char_length(created_by) between 3 and 320),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint dramas_pay_start_within_episodes
    check (pay_start is null or episodes is null or pay_start <= episodes),
  constraint dramas_published_has_target
    check (status <> 'published' or promo_target_url is not null),
  constraint dramas_published_was_listed
    check (status <> 'published' or listed_at is not null)
);

create index dramas_published_listed_idx
  on task_center.dramas (listed_at desc)
  where status = 'published';

create table task_center.drama_assets (
  id            uuid        primary key default gen_random_uuid(),
  drama_id      uuid        not null references task_center.dramas (id) on delete cascade,
  kind          text        not null check (kind in ('video', 'image')),
  title         text        not null check (char_length(title) between 1 and 200),
  object_key    text        not null unique check (char_length(object_key) between 1 and 512),
  content_type  text        not null check (content_type ~ '^(video|image)/[a-z0-9.+-]{1,64}$'),
  -- R2 takes a single PUT up to about 5 GiB; the app caps below that.
  byte_size     bigint      not null check (byte_size between 1 and 5368709120),
  -- pending: an upload URL was handed out. ready: the object was found in R2
  -- with this size and type. Only ready assets are shown to promoters.
  status        text        not null default 'pending' check (status in ('pending', 'ready')),
  sort          integer     not null default 0,
  created_by    text        not null check (char_length(created_by) between 3 and 320),
  created_at    timestamptz not null default now(),
  uploaded_at   timestamptz,
  constraint drama_assets_kind_matches_type
    check ((kind = 'video') = (content_type like 'video/%')),
  constraint drama_assets_ready_has_time
    check ((status = 'ready') = (uploaded_at is not null))
);

create index drama_assets_drama_idx on task_center.drama_assets (drama_id, sort, created_at);

create table task_center.task_claims (
  id          uuid        primary key default gen_random_uuid(),
  -- The Supabase auth user id from the verified session. There is no foreign
  -- key: that table lives in another database.
  user_id     uuid        not null,
  drama_id    uuid        not null references task_center.dramas (id),
  channel     text        not null check (channel in ('tiktok', 'facebook', 'instagram', 'youtube')),
  -- Lowercase, without 0/o/1/l/i, so it survives being read aloud or retyped.
  code        text        not null unique check (code ~ '^[a-hjkmnp-z2-9]{8}$'),
  claimed_at  timestamptz not null default now(),
  constraint task_claims_one_per_channel unique (user_id, drama_id, channel)
);

create index task_claims_drama_idx on task_center.task_claims (drama_id);

-- One row per followed promo link. No IP, no user agent: the count is all the
-- promoter is shown, and nothing here needs to identify a visitor.
create table task_center.promo_clicks (
  id          bigint      generated always as identity primary key,
  claim_id    uuid        not null references task_center.task_claims (id) on delete cascade,
  clicked_at  timestamptz not null default now()
);

create index promo_clicks_claim_idx on task_center.promo_clicks (claim_id);

create table task_center.earning_imports (
  id           uuid        primary key default gen_random_uuid(),
  imported_by  text        not null check (char_length(imported_by) between 3 and 320),
  file_name    text        not null check (char_length(file_name) between 1 and 255),
  currency     text        not null check (currency ~ '^[A-Z]{3}$'),
  row_count    integer     not null check (row_count >= 1),
  imported_at  timestamptz not null default now()
);

-- Settlement as the platform reported it, one row per promo code per day. A
-- later import of the same day replaces the earlier row. A figure the file did
-- not carry stays null; it is never written as 0.
create table task_center.earnings (
  claim_id         uuid    not null references task_center.task_claims (id),
  day              date    not null,
  import_id        uuid    not null references task_center.earning_imports (id),
  currency         text    not null check (currency ~ '^[A-Z]{3}$'),
  orders           integer check (orders is null or orders >= 0),
  -- Integer minor units (cents for USD), so sums are exact.
  ad_amount_minor  bigint  check (ad_amount_minor is null or ad_amount_minor >= 0),
  income_minor     bigint  check (income_minor is null or income_minor >= 0),
  primary key (claim_id, day),
  constraint earnings_has_a_figure
    check (orders is not null or ad_amount_minor is not null or income_minor is not null)
);

create index earnings_import_idx on task_center.earnings (import_id);
