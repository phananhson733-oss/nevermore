-- @input  -- task_center.dramas and task_center.drama_assets from 0001
-- @output -- a drama's audience (female/male) and genre, a clip's type and poster frame, and an index for the newest-clips list
-- @pos    -- third migration of gengrowth_tasks: what the clip grid on /tasks filters and shows
-- 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
--
-- Every column is nullable and added without a default, so rows written by
-- the image still running during a deploy stay valid. Null means nobody said:
-- an untagged clip shows no type rather than a guessed one.

alter table task_center.dramas
  add column audience text check (audience is null or audience in ('female', 'male')),
  -- A free slug like romance or werewolf, faceted like platform: genres differ
  -- per language and platform, so a fixed list would always be missing one.
  add column genre    text check (genre is null or genre ~ '^[a-z0-9][a-z0-9-]{0,31}$');

alter table task_center.drama_assets
  add column clip_type  text check (clip_type is null
                                    or clip_type in ('recap', 'mixcut', 'highlight', 'trailer', 'episode')),
  -- A still the admin's browser cut from the video at upload. Null for images
  -- (the image is its own still) and for videos uploaded before this, which
  -- the grid shows with the drama's cover instead. Only the clip's own still
  -- path is allowed, so deleting a clip can never delete some other object.
  add column poster_key text check (poster_key is null
                                    or poster_key = 'dramas/' || drama_id::text || '/posters/' || id::text || '.jpg');

create index drama_assets_ready_uploaded_idx
  on task_center.drama_assets (uploaded_at desc)
  where status = 'ready';
