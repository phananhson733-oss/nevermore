# Launch execution checklist — gengrowth.ai/app

Operational runbook to take the frozen release candidate live at **`gengrowth.ai/app`**.
Milestone = a real user logs in at `gengrowth.ai/app/login` and uses the workbench.

- **Release SHA to deploy:** `eabaab3` (freeze `cde8309` + `/app` base path `eabaab3`).
  Vercel web, the Render worker, and the migration job MUST all resolve to this one SHA.
- **Authority:** this checklist operationalizes `docs/DEPLOYMENT.md` and the
  "External / Owner-gated launch checklist" in `docs/PROGRESS.md`. On any conflict,
  the spec (`../signalframe-mvp/implementation-spec-v0.2`) wins.
- **Secrets:** never paste real secret values into git, logs, or a shared channel.
  Set them only in the Vercel / Render / Supabase / Google dashboards.
- Local gates already green at this SHA: `typecheck · ~1082 unit · verify:spec ·
  implementation:check · deploy:check · vendor:check`.

Legend: **[Owner]** needs your credentials/authority · **[me]** I can prep/verify.

---

## Phase 0 — Freeze & secrets

- [ ] Confirm `git rev-parse HEAD` = the SHA above and the tree is clean **[me]**
- [ ] Have the target **Supabase project** chosen (the one behind `gengrowth.ai/app`) **[Owner]**
- [ ] Have these secret values ready (generate the encryption key if new):
  - `CREDENTIAL_ENCRYPTION_KEY` — 32-byte base64: `openssl rand -base64 32`
    (⚠ if you rotate this, every stored OAuth credential must be re-connected)
  - `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_URL`
  - `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
  - `OPENAI_API_KEY` + `OPENAI_MODEL` **or** the 4 Azure fields (all-or-nothing) **[Owner]**

## Phase 1 — Supabase (DB + Storage)

- [ ] `DATABASE_URL` uses **session/direct mode** (or the session pooler), NOT the
  transaction pooler — pg-boss + the worker readiness lease need session mode **[Owner]**
- [ ] Run the additive migration against the target project, BEFORE any traffic:
  ```bash
  DATABASE_URL='<target-session-mode-url>' pnpm db:migrate
  DATABASE_URL='<target-session-mode-url>' pnpm db:migrate:check   # asserts 28 tables + indexes + append-only trigger
  ```
- [ ] Create two **private** Storage buckets: `raw-imports` and `exports` **[Owner]**
- [ ] Grant the service role create/read/**list**/delete on both buckets
  (list+delete are needed by the orphan-maintenance loop, not just uploads) **[Owner]**
- [ ] Configure the `exports` bucket **30-day lifecycle** policy in Supabase **[Owner]**

## Phase 2 — Google Cloud Console (OAuth)

- [ ] Add the EXACT production redirect URI to the OAuth client **[Owner]**:
  ```
  https://gengrowth.ai/app/api/mvp/oauth/google/callback
  ```
  (note the `/app` prefix — without it the deployed OAuth fails with redirect_mismatch)
- [ ] Confirm the OAuth consent screen lists the read-only scopes
  `webmasters.readonly` + `analytics.readonly` **[Owner]**

## Phase 3 — Render worker (persistent pg-boss consumer)

- [ ] Create a **Render Background Worker** from `render.yaml` (Blueprint) — builds
  `Dockerfile.worker`, no HTTP port. (Railway `railway.json` is an equal fallback.) **[Owner]**
- [ ] Set worker env vars (`deploy/worker.env.template`; Blueprint prompts the secrets) **[Owner]**:
  - Shared: `APP_ORIGIN=https://gengrowth.ai` · `DATABASE_URL=<session-mode>` ·
    `DB_POOL_MAX=3` · `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` ·
    `CREDENTIAL_ENCRYPTION_KEY` · `GOOGLE_OAUTH_CLIENT_ID` · `GOOGLE_OAUTH_CLIENT_SECRET` ·
    `DATAFORSEO_ENABLED=false` · `RAW_IMPORT_BUCKET=raw-imports` · `EXPORT_BUCKET=exports` ·
    `LOG_LEVEL=info`
  - Storage: `SF_BLOB_BACKEND=supabase`  (do NOT set `SF_BLOB_DIR` in prod)
  - LLM: `LLM_PROVIDER=openai` + `OPENAI_API_KEY` + `OPENAI_MODEL`
    (or the 4 `AZURE_OPENAI_*`/`OPENAI_API_VERSION` fields — all four, or none)
  - SHA pin: `APP_BUILD_SHA=eabaab3…`  (explicit, so web+worker match)
  - Worker does NOT need `NEXT_PUBLIC_BASE_PATH` / `SUPABASE_ANON_KEY`
- [ ] Deploy from the target SHA; confirm startup logs show the SHA, a successful
  recovery sweep, and a held **worker readiness lease** — with NO env values,
  provider bodies, model output, or customer text in the logs **[Owner]**

## Phase 4 — Vercel web (Next standalone)

- [ ] Project **Root Directory = `apps/web`**; framework auto-detected (Next) **[Owner]**
- [ ] Set web env vars (Vercel dashboard, **Production**) **[Owner]**:
  - **Build-time:** `NEXT_PUBLIC_BASE_PATH=/app`
  - Shared: `APP_ORIGIN=https://gengrowth.ai` (origin only, no `/app`) · `DATABASE_URL=<session-mode>` ·
    `DB_POOL_MAX=3` · `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` ·
    `CREDENTIAL_ENCRYPTION_KEY` · `GOOGLE_OAUTH_CLIENT_ID` · `GOOGLE_OAUTH_CLIENT_SECRET` ·
    `DATAFORSEO_ENABLED=false` · `RAW_IMPORT_BUCKET=raw-imports` · `EXPORT_BUCKET=exports` ·
    `LOG_LEVEL=info`
  - Web: `SUPABASE_ANON_KEY` · `SF_BLOB_BACKEND=supabase`
  - SHA pin: `APP_BUILD_SHA=eabaab3…` (match the worker)
  - ⚠ Do NOT set `SF_DEV_AUTH` (prod ignores it, but keep it absent)
- [ ] Deploy the target SHA; confirm the build succeeded with base path `/app` **[Owner]**
- [ ] Point the `gengrowth.ai` domain / route so `/app/*` reaches this deployment **[Owner]**

## Phase 5 — Deployed-origin verification (the login milestone)

Run against the live origin. `< >` means expected.

- [ ] Version + SHA match on web **[Owner/me]**:
  ```bash
  curl -s https://gengrowth.ai/app/api/mvp/health/version   # < reports eabaab3… >
  curl -s -o /dev/null -w '%{http_code}\n' https://gengrowth.ai/app/api/mvp/health/live   # < 200 >
  curl -s -o /dev/null -w '%{http_code}\n' https://gengrowth.ai/api/mvp/health/live       # < 404 (root not served) >
  ```
- [ ] Readiness is 200 ONLY with DB + pg-boss schema + a live worker lease **[Owner]**:
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' https://gengrowth.ai/app/api/mvp/health/ready   # < 200 >
  ```
  (a 503 here means the worker lease isn't held — fix the worker, don't waive the gate)
- [ ] **Real Supabase Auth login** at `https://gengrowth.ai/app/login` → lands in the
  app; session cookie is HttpOnly/Secure/SameSite=Lax; sign-out returns to login **[Owner]**
- [ ] CSP: page HTML carries a per-request nonce; response headers contain no
  `unsafe-inline`/`unsafe-eval` **[me]**

## Phase 6 — Live provider + business gates (full pilot)

- [ ] Live **Google OAuth → GSC** property selection + a real collection on an
  Owner-approved property; retain sanitized evidence (no tokens/customer payloads) **[Owner]**
- [ ] Live **GA4** property + key-event sync **[Owner]**
- [ ] Production **OpenAI/Azure** structured-LLM Artifact generation succeeds
  (this is the path that returned 401 locally — needs the real prod key) **[Owner]**
- [ ] Signed **export download** works from the deployed web (URL expires in 900s),
  buckets confirmed private, 30-day lifecycle active **[Owner]**
- [ ] Recovery drill per `docs/RESTORE-DRILL.md` (Supabase PITR + Storage-byte
  recovery evidence) **[Owner]**
- [ ] Business Owner walkthrough of EN + zh-CN, B2B + B2C outputs (evidence, priority,
  Action, Artifact, both bundle types) and explicit pilot sign-off **[Owner]**

---

Until Phase 5 passes, describe the state as *"deployed; login/hosted verification
in progress."* Until Phase 6 passes, it is **not** pilot-ready.
