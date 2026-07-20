# Candidate launch checklist — gengrowth.ai/app

This checklist is for the prepared Vercel + Render + `/app` candidate. It is not
authorization to deviate from frozen spec §3.2. The Owner must explicitly ratify
this topology first; otherwise stop here and deploy the Railway web+worker
topology required by the spec.

Operational runbook to take a frozen release candidate live at **`gengrowth.ai/app`**.
Milestone = a real user logs in at `gengrowth.ai/app/login` and uses the workbench.

- **Release SHA to deploy:** unset. Freeze a clean commit only after the final
  whole-worktree verification; record that immutable SHA here or in the release
  artifact. Vercel web, Render worker, and the migration job MUST all resolve to
  that one SHA.
- **Authority:** this checklist operationalizes `docs/DEPLOYMENT.md` and the
  "External / Owner-gated launch checklist" in `docs/PROGRESS.md`. On any conflict,
  the spec (`../signalframe-mvp/implementation-spec-v0.2`) wins.
- **Secrets:** never paste real secret values into git, logs, or a shared channel.
  Set them only in the Vercel / Render / Supabase / Google dashboards.
- Historical/local checkpoints are recorded in `docs/PROGRESS.md`; they do not
  certify a future release SHA. Rerun every final gate after the tree is frozen.

Legend: **[Owner]** needs your credentials/authority · **[me]** I can prep/verify.

---

## Phase 0 — Freeze & secrets

- [ ] Owner explicitly chooses either frozen-spec Railway web+worker, or ratifies
  the Vercel+Render+`/app` candidate and records the decision **[Owner]**
- [ ] Confirm the tree is clean, record `git rev-parse HEAD` as the release SHA,
  and bind every later evidence item to it **[me]**
- [ ] Have the target **Supabase project** chosen (the one behind `gengrowth.ai/app`) **[Owner]**
- [ ] Have these secret values ready (generate the encryption key if new):
  - `CREDENTIAL_ENCRYPTION_KEY` — 32-byte base64: `openssl rand -base64 32`
    (⚠ if you rotate this, every stored OAuth credential must be re-connected)
  - `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_URL`
  - `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
  - For this prepared candidate: `OPENAI_API_KEY` + `OPENAI_MODEL`. Azure is a
    separate manual variant requiring a new configuration review because it is
    not encoded in `render.yaml`; also record whether optional localized Finding
    summaries use `FINDING_SUMMARIES_ENABLED=true` or `false`. **[Owner]**

## Phase 1 — Supabase (DB + Storage)

- [ ] `DATABASE_URL` uses **session/direct mode** (or the session pooler), NOT the
  transaction pooler — pg-boss + the worker readiness lease need session mode **[Owner]**
- [ ] Run the additive migration against the target project, BEFORE any traffic:
  ```bash
  DATABASE_URL='<target-session-mode-url>' pnpm db:migrate
  DATABASE_URL='<target-session-mode-url>' pnpm db:migrate:check   # asserts 28 tables + indexes + append-only trigger
  ```
- [ ] Disable public user signup in Supabase Auth. Production membership is
  allowlisted; a valid Auth user without `app.operator_profiles` receives no
  application access and the app never creates that profile automatically **[Owner]**
- [ ] Create each approved operator in Supabase Authentication, copy its user UUID,
  then provision it into the singleton workspace through the SQL editor/service role
  (replace both placeholders and retain the change record) **[Owner]**:
  ```sql
  INSERT INTO app.workspaces (name)
  SELECT 'SignalFrame'
  WHERE NOT EXISTS (SELECT 1 FROM app.workspaces);

  INSERT INTO app.operator_profiles (user_id, workspace_id, display_name)
  SELECT '<auth-user-uuid>'::uuid, id, '<approved-display-name>'
  FROM app.workspaces
  ORDER BY created_at, id
  LIMIT 1;
  ```
- [ ] Create two **private** Storage buckets: `raw-imports` and `exports` **[Owner]**
- [ ] Grant the service role create/read/**list**/delete on both buckets
  (list+delete are needed by application-owned retention and orphan maintenance,
  not just uploads) **[Owner]**
- [ ] Verify worker aggregate retention evidence: raw-family bytes expire at 90
  days and export bytes at 30 days; no object key or customer content appears in
  logs. Supabase S3 lifecycle configuration is not an available substitute. **[Owner]**
- [ ] Record aggregate counts for `raw`, `raw-import`, `snapshot-raw`, and
  `export`; every kind is at or below the pilot hard limit of 100,000 objects.
  Configure warning headroom from successful-sweep `scannedCount` and page on
  `ORPHAN_CLEANUP_CAPACITY_EXCEEDED` or
  `STORAGE_RETENTION_CAPACITY_EXCEEDED`. These events do not self-recover. **[Owner]**

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
  `Dockerfile.worker`, no HTTP port. The frozen Railway topology is a separate
  shared-image path documented in `docs/DEPLOYMENT.md`. **[Owner]**
- [ ] Set worker env vars (`deploy/worker.env.template`; Blueprint prompts the secrets) **[Owner]**:
  - Shared: `APP_ORIGIN=https://gengrowth.ai` · `DATABASE_URL=<session-mode>` ·
    `DB_POOL_MAX=3` · `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` ·
    `CREDENTIAL_ENCRYPTION_KEY` · `GOOGLE_OAUTH_CLIENT_ID` · `GOOGLE_OAUTH_CLIENT_SECRET` ·
    `DATAFORSEO_ENABLED=false` · `RAW_IMPORT_BUCKET=raw-imports` · `EXPORT_BUCKET=exports` ·
    `LOG_LEVEL=info`
  - Storage: `SF_BLOB_BACKEND=supabase`  (do NOT set `SF_BLOB_DIR` in prod)
  - LLM: `LLM_PROVIDER=openai` + `OPENAI_API_KEY` + `OPENAI_MODEL` +
    `FINDING_SUMMARIES_ENABLED=true|false`
    (this Blueprint does not encode the runtime-supported Azure variant)
  - SHA: leave `APP_BUILD_SHA` unset — Render's `RENDER_GIT_COMMIT` auto-reports the deploy
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
  - SHA: leave `APP_BUILD_SHA` unset — Vercel's `VERCEL_GIT_COMMIT_SHA` auto-reports the deploy
  - ⚠ Do NOT set `SF_DEV_AUTH` (it is reserved for explicit loopback local
    development only; keep it absent in hosted environments)
- [ ] Deploy the target SHA; confirm the build succeeded with base path `/app` **[Owner]**
- [ ] Point the `gengrowth.ai` domain / route so `/app/*` reaches this deployment **[Owner]**

## Phase 5 — Deployed-origin verification (the login milestone)

Run against the live origin. `< >` means expected.

- [ ] Version + SHA match on web **[Owner/me]**:
  ```bash
  curl -s https://gengrowth.ai/app/api/mvp/health/version   # < reports the exact deployed release SHA in buildSha >
  curl -s -o /dev/null -w '%{http_code}\n' https://gengrowth.ai/app/api/mvp/health/live   # < 200 (liveness only) >
  curl -s -o /dev/null -w '%{http_code}\n' https://gengrowth.ai/api/mvp/health/live       # < 404 (root not served) >
  ```
- [ ] Treat `/api/mvp/health/live` only as a process-up check; never promote on
  liveness alone. Promotion requires the version SHA above plus readiness 200 **[Owner]**
- [ ] Readiness is 200 ONLY with DB + pg-boss schema + a live worker lease **[Owner]**:
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' https://gengrowth.ai/app/api/mvp/health/ready   # < 200 >
  ```
  (a 503 here means the worker lease isn't held — fix the worker, don't waive the gate)
- [ ] **Real Supabase Auth login** using a pre-provisioned operator at
  `https://gengrowth.ai/app/login` → lands in the app; session cookie is
  HttpOnly/Secure/SameSite=Lax; sign-out returns to login **[Owner]**
- [ ] A valid but deliberately unprovisioned Auth test user cannot enter the app and
  does not create a workspace or `operator_profiles` row **[Owner]**
- [ ] CSP: page HTML carries a per-request nonce; response headers contain no
  `unsafe-inline`/`unsafe-eval` **[me]**

## Phase 6 — Live provider + business gates (full pilot)

- [ ] Live **Google OAuth → GSC** property selection + a real collection on an
  Owner-approved property; retain sanitized evidence (no tokens/customer payloads) **[Owner]**
- [ ] Live **GA4** property + key-event sync **[Owner]**
- [ ] Production direct **OpenAI** structured-LLM Artifact generation succeeds
  with the prepared Blueprint (or, after a separate manual configuration review,
  the complete Azure variant succeeds) **[Owner]**
- [ ] Signed **export download** works from the deployed web (URL expires in 900s),
  buckets confirmed private, and the application-owned 30-day export retention
  sweep has sanitized success evidence, dual Storage/run-completion anchors, and
  no capacity-exceeded event **[Owner]**
- [ ] Recovery drill per `docs/RESTORE-DRILL.md` (Supabase PITR + Storage-byte
  recovery evidence) **[Owner]**
- [ ] Business Owner walkthrough of EN + zh-CN, B2B + B2C outputs (evidence, priority,
  Action, Artifact, both bundle types) and explicit pilot sign-off **[Owner]**

---

Until Phase 5 passes, describe the state as *"deployed; login/hosted verification
in progress."* Until Phase 6 passes, it is **not** pilot-ready.
