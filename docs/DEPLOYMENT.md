# Deployment decision record — authority and prepared candidates

The frozen implementation spec remains authoritative: §3.2 requires Railway
`web` + `worker` services built from the same image/commit. This repository also
contains a prepared Vercel-web + Render-worker candidate and optional `/app`
mount support. The repository does **not** contain independently verifiable
Owner approval for those topology changes, so their presence is not an
override. Before any hosted mutation, the Owner must choose one topology and
record that decision with the immutable release SHA. Until then, use the frozen
Railway topology as the release authority and treat the alternative files below
as unapproved candidates.

## Frozen-spec Railway topology

The repository contains one shared-image path for the two required Railway
services:

1. Both `web` and `worker` use the repository root, `/railway.json`, and the
   same immutable commit. `railway.json` builds `Dockerfile.railway`; that image
   contains both the prebuilt Next application and the worker workspace.
2. The `web` service uses the image default command,
   `node apps/web/.next/standalone/apps/web/server.js`. The image copies Next's
   static assets into the standalone tree, and the server reads Railway's
   injected `PORT`. `/api/mvp/health/live` is liveness only: use it, if needed,
   to restart a wedged container, but never as hosted promotion evidence.
   Promotion must prove `/api/mvp/health/ready`.
3. The `worker` service overrides only its service-level start command in the
   Railway dashboard with
   `node --enable-source-maps --import tsx apps/worker/src/index.ts`. It has no
   domain or HTTP healthcheck.
4. Do not put a `startCommand` in shared `railway.json`: Railway supports
   service-level start-command overrides for shared monorepos, and a Docker
   override replaces the image command in exec form. Record both deployed image
   digests and verify they resolve to the same source SHA before promotion.

The local build proves both entrypoints exist in one image. Creating the hosted
services, setting their commands/secrets, and proving image/SHA/readiness remain
external launch gates.

## Delta 1 — Repository location
- Spec §3.1 fixes the path to `/Users/wzb/Code/signalframe-mvp-app`.
- **Current workspace placement:** development occurs inside the local `nevermore` workspace at
  `/Users/wzb/Code/nevermore/signalframe-mvp-app`.
- Everything else in §3.1 still holds: independent Git repo, **zero runtime/build
  dependency** on `/Users/wzb/Code/signalframe`, vendor-copy only.

## Candidate delta 2 — Deployment substrate (Owner decision pending)

- Spec §3.2 fixes deployment to **Railway** (two services `web` + `worker`, same
  image/commit).
- **Prepared candidate:** web runs on **Vercel**, the persistent worker runs on **Render**
  (Background Worker), and
  Supabase remains the shared Auth/Postgres/Storage substrate.
- Both compute services must be built from the same immutable commit even though
  they use different build artifacts.

### Prepared candidate topology

1. **Web → Vercel.** `apps/web/vercel.json` selects Next.js; the Vercel project
   uses `apps/web` as its Root Directory and includes workspace sources outside
   that directory. Next's standalone trace root is the monorepo root.
2. **Worker → Render.** `render.yaml` declares a Background Worker built from
   `Dockerfile.worker`. Node is PID 1,
   so SIGTERM reaches the worker's pg-boss and readiness-lease shutdown handler.
   This process intentionally has no HTTP healthcheck port. `pnpm deploy:check`
   validates render.yaml (worker type, docker runtime, Dockerfile, secrets as
   `sync:false`) as well as the separate shared-image Railway path.
3. **State → Supabase.** Both services share the same database, encryption key,
   OAuth configuration, service role, and private raw/export Storage buckets.
   Local filesystem blob storage is rejected in production.

The worker service role must be able to create/read/list/delete objects in both
private buckets. Listing and delete are required by the conservative orphan
maintenance and application-owned retention loops, not just by user-facing
uploads/downloads. Keep both buckets private. The worker enforces raw-family
90-day byte retention and dual-anchored export 30-day byte retention from the
database clock; do not replace lifecycle/recovery policy with public object
URLs. The current pilot sweep has a hard 100,000-object-per-kind capacity bound
and no durable resume cursor. Before promotion, prove each of `raw`,
`raw-import`, `snapshot-raw`, and `export` is at or below that bound, configure a
warning from aggregate successful-sweep counts, and alert on
`ORPHAN_CLEANUP_CAPACITY_EXCEEDED` and
`STORAGE_RETENTION_CAPACITY_EXCEEDED`. A capacity event is a release/operations
failure, not a self-healing retry state.

### Connection routing

pg-boss and the live-worker readiness lease require a **session-mode** database
connection. The web readiness probe also acquires and releases a session advisory
lock on one checked-out connection. Therefore both service `DATABASE_URL` values
must use Supabase direct/session mode (or the session pooler), never the
transaction pooler. Keep web and worker pool sizes conservative and monitor
Supabase connection saturation.

Run `pnpm deploy:check` and build the selected topology's Dockerfile before
release. Deployment itself remains an external launch gate: migration first,
then worker and web from the same SHA, then verify `/api/mvp/health/version`
and require `/api/mvp/health/ready` before promotion. A 200 from
`/api/mvp/health/live` proves only process liveness.

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
5. Disable public Supabase Auth signup, pre-provision each approved Auth user in
   `app.operator_profiles`, and prove an unprovisioned valid user remains denied
   without creating a workspace/profile. Then complete deployed-origin Auth,
   Google GSC/GA4 and the selected LLM smoke flow with
   Owner-approved test data.
6. Verify both buckets are private, signed downloads expire in 900 seconds, the
   worker reports successful aggregate retention/orphan sweeps, and it can perform
   bounded list and idempotent delete operations. Verify a database-clock-expired
   export is not signed and is reported as regeneratable. Record per-kind object
   counts at or below 100,000 and prove the two capacity-exceeded codes are wired
   to operator alerting before promotion.
7. Retain the production PITR and separate Storage-byte recovery evidence from
   `docs/RESTORE-DRILL.md`, plus the EN/zh-CN B2B/B2C Owner walkthrough sign-off.

Do not promote the implementation as pilot-ready until all seven items have
evidence tied to the same release SHA.

## Candidate delta 3 — Base path mount (`gengrowth.ai/app`, Owner decision pending)

- **Prepared candidate:** serve the app under a host sub-path so it
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
  bare `/api/mvp/health/live` → 404; this confirms the mount and liveness only.
  Promotion still requires `GET /app/api/mvp/health/ready` → 200. Confirm login
  lands at `/app/login` and the async status URLs a 202 returns are
  `/app/api/mvp/...`.
