# apps/marketing/db/tasks

The task center's own PostgreSQL schema, `task_center`, in the TencentDB database `gengrowth_tasks`. It is not the product database and has nothing to do with `packages/db` or Supabase; Supabase only supplies the signed-in user's id. `deploy/deploy.sh` runs `migrate.sh` before every deploy, and the SQL tests run it against a disposable database.

- `migrate.sh` — applies each `NNNN_name.sql` not yet in `task_center.schema_migrations`, one transaction per file, and stops at the first failure so the next run retries it. POSIX sh and psql only, so it runs inside the stock `postgres` image.
- `0001_task_center.sql` — dramas (draft/published/archived, a published drama must have an https promo target and a listing time), their R2 assets (pending until the server has seen the object), one promo code per user, drama and channel, raw promo clicks, settlement imports, and per-code per-day earnings whose unknown figures stay null.
- `0002_one_link_and_accounts.sql` — adds the claim channel `all` (one link per person and drama, what new claims use; per-channel codes from before keep working) and `promoter_accounts`: TikTok/Facebook accounts a promoter submits for whitelisting, with the email copied from the session, one row per handle in any letter case, and who reviewed it and when.

Applied files are never edited. A change is a new, higher-numbered file that only adds, so the image still running during a deploy keeps working against the new schema.
