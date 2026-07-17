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
- **Override:** local testing first; later run on **Vercel + Supabase**.
- Data/auth/storage layer is **unchanged** — the spec already uses Supabase
  Postgres / Auth / Storage (§3.2). Only the compute host changes.

### Implications carried forward (resolved at deploy time — "后续")
1. **Web → Vercel.** Next.js App Router is Vercel-native. No code change.
2. **Worker host is the open item.** pg-boss is a *persistent* consumer process;
   Vercel serverless cannot host it. Options to decide at deploy time: a small
   always-on container (Fly.io / Render / a Supabase-adjacent VM), or replacing
   pg-boss consumption with a scheduled drain. The queue itself lives in
   Postgres (Supabase), so the storage side is fine.
3. **Connection routing.** pg-boss needs a **session-mode** connection
   (direct 5432, LISTEN/NOTIFY + advisory locks). Supabase's transaction pooler
   (6543) does **not** support this. Therefore:
   - Worker `DATABASE_URL` → Supabase **direct** connection (session mode).
   - Web enqueue (transactional INSERT into the pgboss + canonical tables) can
     use either; keep `DATABASE_URL` per-service configurable.
   The code already separates `apps/web` (enqueue) from `apps/worker` (consume),
   so the substrate can change without touching domain logic.

Until deploy time, `railway.json` / `Dockerfile` are placeholders; do not invest
in Railway-specific config. No Vercel config is added yet (deferred per "后续").
