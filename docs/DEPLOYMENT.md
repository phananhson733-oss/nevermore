# Deployment — deltas from frozen spec §3.1 / §3.2

The implementation spec freezes repo path and deploy topology, but the product
owner has issued two explicit overrides (user instruction > spec, per spec §0.1
conflict handling being about *contract* conflicts; a product-owner override of a
fixed environment decision is authoritative and recorded here).

## Delta 1 — Repository location
- Spec §3.1 fixes the path to `/Users/wzb/Code/signalframe-mvp-app`.
- **Override:** develop inside the local `nevermore` workspace at
  `/Users/wzb/Code/nevermore/signalframe-mvp-app`.
- Everything else in §3.1 still holds: independent Git repo, **zero runtime/build
  dependency** on `/Users/wzb/Code/signalframe`, vendor-copy only.

## Delta 2 — Deployment substrate

- Spec §3.2 fixes deployment to **Railway** (two services `web` + `worker`, same
  image/commit).
- **Override:** web runs on **Vercel**, the persistent worker runs on **Render**
  (Background Worker; `railway.json` is kept as an equivalent fallback host), and
  Supabase remains the shared Auth/Postgres/Storage substrate.
- Both compute services must be built from the same immutable commit even though
  they use different build artifacts.

### Implemented topology

1. **Web → Vercel.** `apps/web/vercel.json` selects Next.js; the Vercel project
   uses `apps/web` as its Root Directory and includes workspace sources outside
   that directory. Next's standalone trace root is the monorepo root.
2. **Worker → Render.** `render.yaml` declares a Background Worker built from
   `Dockerfile.worker` (Railway `railway.json` is an equal fallback). Node is PID 1,
   so SIGTERM reaches the worker's pg-boss and readiness-lease shutdown handler.
   This process intentionally has no HTTP healthcheck port. `pnpm deploy:check`
   validates render.yaml (worker type, docker runtime, Dockerfile, secrets as
   `sync:false`) and railway.json.
3. **State → Supabase.** Both services share the same database, encryption key,
   OAuth configuration, service role, and private raw/export Storage buckets.
   Local filesystem blob storage is rejected in production.

The worker service role must be able to create/read/list/delete objects in both
private buckets. Listing and delete are required by the conservative orphan
maintenance loop, not just by user-facing uploads/downloads. Keep both buckets
private, configure the export bucket's 30-day lifecycle in Supabase, and do not
replace lifecycle/recovery policy with public object URLs.

### Connection routing

pg-boss and the live-worker readiness lease require a **session-mode** database
connection. The web readiness probe also acquires and releases a session advisory
lock on one checked-out connection. Therefore both service `DATABASE_URL` values
must use Supabase direct/session mode (or the session pooler), never the
transaction pooler. Keep web and worker pool sizes conservative and monitor
Supabase connection saturation.

Run `pnpm deploy:check` and build `Dockerfile.worker` before release. Deployment
itself remains an external launch gate: migration first, then worker and web from
the same SHA, then verify `/api/mvp/health/ready` and `/api/mvp/health/version`.

### Promotion evidence (required, not satisfied by a local build)

1. Commit and record one immutable SHA. The Vercel deployment, Render (worker)
   image and migration job must all resolve to that SHA; a dirty local worktree is
   not a release identifier.
2. Run the additive migration job against the intended Supabase project before
   promoting worker or web traffic. Record the successful migrate-check without
   exposing the database URL.
3. Start the Render worker and confirm its startup/ready logs report the immutable
   SHA, successful recovery sweep and a held worker readiness lease. Logs must not
   contain env values, provider bodies, model output or customer content.
4. Verify web `/api/mvp/health/version` reports the same SHA. Verify
   `/api/mvp/health/ready` returns 200 only after DB, pg-boss schema and the live
   worker lease are all present; a local/hosted 503 without a worker is expected
   fail-closed behavior, not evidence to waive the gate.
5. Complete deployed-origin Supabase Auth, Google GSC/GA4 and the selected
   OpenAI/Azure OpenAI smoke flows with Owner-approved test data.
6. Verify both buckets are private, signed downloads expire in 900 seconds, the
   30-day export lifecycle is active, and the worker can perform bounded list and
   delete operations needed by orphan maintenance.
7. Retain the production PITR and separate Storage-byte recovery evidence from
   `docs/RESTORE-DRILL.md`, plus the EN/zh-CN B2B/B2C Owner walkthrough sign-off.

Do not promote the implementation as pilot-ready until all seven items have
evidence tied to the same release SHA.

## Delta 3 — Base path mount (`gengrowth.ai/app`)

- **Override:** the product owner serves the app under a host sub-path so it
  reuses the `gengrowth.ai/app` route space rather than a bare origin.
- **Lever:** set `NEXT_PUBLIC_BASE_PATH=/app` at **build time** for the web build.
  Unset = origin root (local dev, tests, and the current localhost OAuth redirect
  URI are unchanged). Next auto-prefixes `<Link>`, `redirect()` and assets; the
  hand-built URLs (OAuth redirect URI, async status/`Location`, the client `fetch`
  base, the OAuth callback 303) mirror it through `apps/web/src/lib/base-path.ts`.
- `APP_ORIGIN` stays **origin-only** (`https://gengrowth.ai`); the base path is
  added by the code, not by `APP_ORIGIN`.
- **External coupling (Owner action):** register the exact redirect URI
  `https://gengrowth.ai/app/api/mvp/oauth/google/callback` in Google Cloud Console
  before the deployed OAuth smoke, or GSC/GA4 connect will fail with a redirect
  mismatch. Session cookies are path `/`, so they cover `/app/*` without change.
- **Verify on the deployed origin:** `GET /app/api/mvp/health/live` → 200 and the
  bare `/api/mvp/health/live` → 404; confirm login lands at `/app/login` and the
  async status URLs a 202 returns are `/app/api/mvp/...`.
