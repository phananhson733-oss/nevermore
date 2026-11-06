-- Dramas filled in from 北斗 through the 选剧台 lookup (pick-workbench
-- deploy/lookup-api.md): the operator types a title and a platform, the rest
-- comes from there. All nullable or defaulted, so rows typed by hand before
-- this keep working and the image running during the deploy never writes them.

alter table task_center.dramas
  -- Tags as 北斗 gives them ("Romance", "Werewolf"); shown, not filtered on.
  add column tags text[] not null default '{}'
    check (cardinality(tags) <= 20 and array_position(tags, null) is null),
  -- Whether every episode is out. Null when nobody told us.
  add column finished boolean,
  -- Where the details came from. Null: an operator typed them.
  add column source text check (source is null or source = 'beidou'),
  -- The platform's own id for this drama (北斗's third_serial_id).
  add column source_drama_id text
    check (source_drama_id is null or source_drama_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  add constraint dramas_source_has_id
    check ((source is null) = (source_drama_id is null));

-- One listing per platform drama, so a second import of it finds the first.
create unique index dramas_platform_source_drama_idx
  on task_center.dramas (platform, source_drama_id)
  where source_drama_id is not null;
