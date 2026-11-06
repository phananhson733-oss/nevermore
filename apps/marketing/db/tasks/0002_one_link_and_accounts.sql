-- @input  -- the task_center schema from 0001_task_center.sql
-- @output -- the 'all' claim channel (one promo link per person and drama), and task_center.promoter_accounts for whitelisting
-- @pos    -- second task center migration; only widens and adds, so the image still running during a deploy keeps working
-- 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

-- A promoter now takes one link per drama and posts it wherever they like, so
-- new claims use 'all'. Codes already handed out per channel stay valid.
alter table task_center.task_claims drop constraint task_claims_channel_check;
alter table task_center.task_claims add constraint task_claims_channel_check
  check (channel in ('tiktok', 'facebook', 'instagram', 'youtube', 'all'));

-- Accounts a promoter posts from, which the operators whitelist on the
-- platform by hand. The email is copied from the verified session when the
-- account is submitted: user_id alone names nobody the operators can reach.
create table task_center.promoter_accounts (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null,
  user_email    text,
  platform      text        not null check (platform in ('tiktok', 'facebook')),
  handle        text        not null check (char_length(handle) between 1 and 200 and handle = btrim(handle)),
  status        text        not null default 'submitted' check (status in ('submitted', 'whitelisted', 'rejected')),
  submitted_at  timestamptz not null default now(),
  reviewed_at   timestamptz,
  reviewed_by   text,
  check ((status = 'submitted') = (reviewed_at is null)),
  check ((reviewed_at is null) = (reviewed_by is null))
);

create unique index promoter_accounts_one_per_handle
  on task_center.promoter_accounts (user_id, platform, lower(handle));
create index promoter_accounts_status_idx
  on task_center.promoter_accounts (status, submitted_at);
