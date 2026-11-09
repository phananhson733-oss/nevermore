# apps/marketing/db/tasks

The task center's own PostgreSQL schema, `task_center`, in the TencentDB database `gengrowth_tasks`. It is not the product database and has nothing to do with `packages/db` or Supabase; Supabase only supplies the signed-in user's id. `deploy/deploy.sh` runs `migrate.sh` before every deploy, and the SQL tests run it against a disposable database.

- `migrate.sh` — applies each `NNNN_name.sql` not yet in `task_center.schema_migrations`, one transaction per file, and stops at the first failure so the next run retries it. POSIX sh and psql only, so it runs inside the stock `postgres` image.
- `0001_task_center.sql` — dramas (draft/published/archived, a published drama must have an https promo target and a listing time), their R2 assets (pending until the server has seen the object), one promo code per user, drama and channel, raw promo clicks, settlement imports, and per-code per-day earnings whose unknown figures stay null.
- `0002_one_link_and_accounts.sql` — adds the claim channel `all` (one link per person and drama, what new claims use; per-channel codes from before keep working) and `promoter_accounts`: TikTok/Facebook accounts a promoter submits for whitelisting, with the email copied from the session, one row per handle in any letter case, and who reviewed it and when.
- `0003_material_plaza.sql` — what the clip grid on `/tasks` filters and shows: a drama's audience (`female`/`male`) and genre (a free slug), a clip's type (`recap`, `mixcut`, `highlight`, `trailer`, `episode`) and poster frame, all nullable so null means untagged; plus an index on ready clips by upload time.
- `0004_drama_source.sql` — what 查剧 fills from 北斗 through 选剧台: a drama's tags (at most 20), whether it is finished (null: unknown), and where its details came from (`source = 'beidou'` with the platform's own drama id, or both null when typed by hand); one listing per platform and platform drama id.
- `0005_base64_drama_ids.sql` — widens 0004's check on the platform drama id to also take base64 (`[A-Za-z0-9+/]`, up to two `=` at the end, 64 at most), which is what 北斗 gives for GoodShort; everything 0004 took still passes.
- `0006_publish_without_target.sql` — drops 0001's rule that a published drama must have a promo target: promoters' links now open our own drama page, and the platform link (still https when set) is only where its 去看全集 button goes.

Applied files are never edited. A change is a new, higher-numbered file that only adds, so the image still running during a deploy keeps working against the new schema.
