-- @input  -- task_center.drama_assets from 0001 and 0003
-- @output -- a clip's 推荐文案 (the caption we suggest posting it with) and its hashtags
-- @pos    -- eighth migration of gengrowth_tasks: what the clip dialog on /tasks offers to copy under each clip
-- 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
--
-- The caption is the post's text: a title line, a line or two about the
-- episode, maybe a question. Hashtags are kept apart, without the #, so the
-- page can show them as tags and copy them after the caption. 2200 is
-- TikTok's caption limit; 30 tags is more than any post carries.
--
-- caption is nullable with no default and hashtags has a constant default,
-- so neither rewrites a row, and the image running during the deploy, which
-- never names them, keeps inserting valid rows.

set local lock_timeout = '5s';

alter table task_center.drama_assets
  add column caption  text check (caption is null or char_length(caption) between 1 and 2200),
  add column hashtags text[] not null default '{}' check (cardinality(hashtags) <= 30);
