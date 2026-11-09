-- A promoter's link now opens our own drama page (/watch/<drama id>), which is
-- built from the uploaded cover and clips, so a drama can be listed before
-- anyone has a platform link for it. The platform link (promo_target_url)
-- becomes optional: when set, the drama page shows 去看全集 and sends the
-- reader there with the promoter's code; when null, the page is the whole
-- landing. Its https check from 0001 stays.
--
-- Only drops a check, so the image still running during a deploy (which
-- always sends a target when publishing) keeps working. Dropping it takes a
-- brief exclusive lock on dramas; waiting behind a long query would stall the
-- live site, so give up after five seconds and let the next deploy retry.

set local lock_timeout = '5s';

alter table task_center.dramas
  drop constraint dramas_published_has_target;
