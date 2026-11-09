-- GoodShort's drama ids in 北斗 are base64 ("157KwomEt0CA6EFVXKKgcQ==",
-- checked 2026-11-08), which 0004's check refused, so 查剧 dropped every
-- GoodShort result. They are not the ids GoodShort's own site uses, and the
-- site refuses the production server, so 北斗's id is what the drama is keyed
-- on: still one listing per platform drama.
--
-- Only widens the check: everything 0004 took still passes, and the image
-- running during the deploy never writes a base64 id.

alter table task_center.dramas
  drop constraint dramas_source_drama_id_check,
  add constraint dramas_source_drama_id_check
    check (source_drama_id is null
      or source_drama_id ~ '^([A-Za-z0-9_-]{1,64}|[A-Za-z0-9+/]{1,62}={0,2})$');
