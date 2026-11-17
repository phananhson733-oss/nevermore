-- The day the drama went live on its theater (上线时间), as the 选剧台 lookup
-- gives it: 北斗's publish_at, or 选剧台's own 剧库 date (for MoboReels, the
-- day MoboBoost's catalog first lists it). A day, no time: the lookup sends
-- YYYY-MM-DD. Null when nobody told us, and for dramas typed by hand.
--
-- listed_at stays what it was, the moment we published the drama here.
--
-- Nullable with no default, so adding it rewrites no rows and the image
-- running during the deploy, which never names it, keeps working.

set local lock_timeout = '5s';

alter table task_center.dramas
  add column launched_on date;
