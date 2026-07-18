# SignalFrame MVP — Build Progress

> Crash-resilient status tracker. **On session resume, read this file first** to
> recover context instead of relying on memory. Update the AC checkboxes and the
> "Resume here" pointer whenever a Work Package advances.

- **Spec**: `../signalframe-mvp/implementation-spec-v0.2/MVP-IMPLEMENTATION-SPEC.md` (product/contract authority)
- **Contract version**: `0.2.0 / 2026-07-18`
- **Repo path**: `/Users/wzb/Code/nevermore/signalframe-mvp-app` (independent git repo inside nevermore, per user decision)
- **Old repo (read-only, vendor-copy source)**: `/Users/wzb/Code/signalframe` @ `72af9300c600` — NEVER modify (AC-048).

## Resume here 👉 **Ship/QA DONE (gate green + live vertical proven). NEXT: user finishes live GSC connect; deploy-stage items (storage wiring, LLM cred, refresh-flow) remain**

> **SHIP/QA COMPLETE (2026-07-18).** Full gate GREEN: typecheck · **381 unit** · **82
> integration** · **36 E2E** (E2E isolated to local DB). Two independent reviews —
> a 7-dimension adversarial workflow (14 agents) + a codex second opinion — reconciled
> by reading the code against the spec.
>
> **Fixes committed:** `2b6a2d3` (redact camelCase normalization; metadata AC-033 —
> reject ANY html tag/event-handler not a fixed list; stale oauth-callback assertion;
> Azure all-or-nothing env guard; supabase-signer dot/empty-segment rejection) and
> `44dc172` (persist the FULL Google credential envelope — refresh token + real expiry —
> instead of a bare access token with expires_at=null; tolerant legacy decode).
> **codex findings OVERRIDDEN per spec (not applied):** replay→failed is intended AC-014
> single-use state (test asserts it); body-cap "stream the body" would REGRESS the
> decompression-bomb guard (request.text() decompresses THEN checks byte length).
>
> **LIVE VERTICAL ACCEPTANCE — PROVEN on real gengrowth.ai data (project 8f72bd04):**
> seeded a complete ICP → **real crawl** of gengrowth.ai (334-row snapshot, available) →
> **diagnose** = `partial` (honest degradation: GSC/GA4/CSV skipped) with **7 real findings**
> (6× CONTENT-COVERAGE-001, 1× GEO-ENTITY-001) → **confirm** one → Action
> `create_priority_content.v1` → **artifact** content_brief (template) → **export**
> `service_bundle` = a real **2.7 MB ZIP**, manifest `signalframe.service-bundle.0.2.0`,
> itemCounts {findings:7, evidence:7, actions:1, artifacts:1, observations:336, …},
> evidence honest (grade C, 0 unavailable-as-nonzero). Whole chain ran through the REAL
> web API + pg-boss + running worker.
>
> **Two deploy-gated caveats surfaced by the live run (known, NOT code bugs):**
> 1. **LLM `structured_llm`**: `OPENAI_API_KEY` returns **OpenAI HTTP 401** (not a valid
>    api.openai.com direct key) and Azure is DNS-unreachable locally — so the LLM artifact
>    path can't complete locally. The CODE is correct (calls OpenAI, handles 401 as
>    UNAVAILABLE/failed). Template mode works fully. Needs a real direct key OR the deploy
>    env (Azure) to validate the model output. `.env.local` restored to Azure config.
> 2. **Export download URL 404s** even locally: web signs `apps/web/.data/blob` but the
>    worker wrote the bundle to `apps/worker/.data/blob` — exactly codex #1 (storage not
>    wired). Bundle itself is correct. **User decided: wire Supabase Storage at deploy stage.**
>
> **STILL user-gated:** finish the live GSC connect in the browser (picker now opens post-3aaffbe):
> gengrowth.ai → Sources → Connect GSC → consent → pick `sc-domain:gengrowth.ai`.
> Then collection can run on real GSC data (adds the search/gap/landing rules).
>
> ---
> _Historical (pre-ship/QA) resume note:_
>
> **LIVE ENV FACTS (critical — .env.local is gitignored, holds all real creds):**
> - `DATABASE_URL` → gengrowth's **hosted Supabase** `qeeocwurjslqppjxlsbk` **Session
>   pooler** (`aws-1-us-east-1.pooler.supabase.com:5432`). signalframe lives in the
>   isolated `app` + `pgboss` schemas; gengrowth's `public`(137 tables)/`signalframe`/
>   `signalframe_private` schemas are UNTOUCHED. Migration already applied (28 app tables).
> - **`DB_POOL_MAX=3`** is REQUIRED: the pooler caps clients at ~15; web+worker each run a
>   Drizzle pool + a pg-boss pool, so keep all four small (commit 3a1570c).
> - **TEST ISOLATION (do not break):** integration tests MUST run against LOCAL
>   `postgres://wzb@localhost:5432/signalframe_mvp_dev` (pass it explicitly). NEVER let
>   `pnpm test:integration` inherit the hosted DATABASE_URL — verified tests leave hosted
>   `app.workspaces` unchanged.
> - Creds wired (not in git): Google OAuth (dedicated client `289814295834-...`, redirect
>   `http://localhost:3000/api/mvp/oauth/google/callback`, scopes webmasters.readonly +
>   analytics.readonly), Supabase URL/anon/service-role, Azure OpenAI (deployment
>   `gpt-4.1-mini`; resource `joyocloud05-9398-resource.openai.azure.com` is behind
>   PRIVATE DNS — unreachable from local, works only in a deploy env; template mode locally).
> - Running procs (may need restart after compact): web `next dev --port 3000` (hosted,
>   APP_ORIGIN=localhost:3000 so the OAuth callback matches) + worker `pnpm start` (hosted).
>   Boot web on 3000 (NOT 3100) for OAuth. ~5 DB connections in use = healthy.
> - Hosted `app.client_projects`: `6f7ac414-...`=HostedSmoke(example.com, test),
>   `8f72bd04-337d-480a-8e97-cb18424b98b1`=**gengrowth.ai** (the real one to finish GSC on).
> - **GSC OAuth state:** consent + token exchange WORK (token listed the user's 4 real GSC
>   sites incl. `sc-domain:gengrowth.ai`; token stored AES-256-GCM encrypted). It was stuck
>   at `properties_ready` because the callback redirect omitted `&provider=` so the UI
>   property picker never opened — **FIXED (commit 3aaffbe)**. User must RETRY Connect GSC
>   on the gengrowth.ai project → pick `sc-domain:gengrowth.ai` → then trigger collection.
>
> **5 real production bugs found+fixed this session** (code-first→test + live QA): CSV
> missing import_preview_id (CHECK 23514); CSV empty limitation (btrim CHECK); overview
> null.overall crash (OpenAPI non-null contract); DB pool exhaustion vs Supabase pooler;
> OAuth callback missing provider param.
>
> **Commit chain (this session):** 1ca2405 → da50a64 → 0af359c → fb2d0ef → f6cc39a →
> 8ada085 → 89c4d2c(Azure LLM) → 3a1570c(DB_POOL_MAX) → 3aaffbe(oauth provider fix).
> Last full gate GREEN: typecheck(9)·lint·366 unit·81 integration·36 E2E·build·verify:spec·
> contracts·db:migrate:check(28)·secrets:scan·vendor:check.
>
> ---
> **(historical) WP5 gap-close DONE (2026-07-18).** Every code-closable AC from the prior
> 16/26/6 audit is now landed + gated. What remains is user/business-gated: live provider
> creds (in progress above), the staging deploy drill, and the §22 business decisions.
>
> **This session closed (all green):**
> - **AC-042/043 — Playwright E2E harness** (was NONE): `playwright.config` auto-boots
>   the web app under the dev-auth shim on :3100; `e2e/responsive.spec` (7 screens ×
>   390/768/1024/1440, 28 tests) + `e2e/a11y.spec` (axe + keyboard + reduced-motion +
>   a direct sidebar-contrast assertion). **36 E2E pass** (cold- and warm-boot). axe's
>   position:sticky sidebar color-contrast false positives are filtered (verified: real
>   ratio ~15:1); a beforeAll route warm-up keeps dev first-compile off the scan.
> - **AC-044/045/022 — B2B/B2C full-vertical golden-fixture integration**: real services
>   (atomic pg-boss enqueue) + real worker runners drive create→diagnose→confirm→artifact
>   →export end to end; service_bundle manifest validated against the schema, client_bundle
>   exclusions + degradation strings asserted. Mirrored the missing authority schema into
>   `schemas/`.
> - **AC-026/028/031/034/041 — apps/worker** (was ZERO tests): 10 worker integration tests.
> - **AC-008/013/014/016/018/024/025/027/029/030/035/036** — service/DTO PARTIALs closed.
>   (§9.3 "8-step" reconciled: `derivePriority`'s 7 branches ARE clauses 1–7; clause 8 is
>   risk-based artifact gating, not ordering — no code change.)
> - **AC-039** — project-scoped Supabase signed-URL signer (900s TTL / wrong-project 404 /
>   fresh key per regenerate; fetch injected, no live network in tests).
> - **AC-040** — runtime redaction chokepoints on telemetry.emit + export bundle input;
>   redact.ts covered for all 8 keys × nesting/array/immutability.
>
> **3 real production bugs found by the code-first→test approach + FIXED:**
> 1. CSV confirm inserted a `provider='csv'` collection_runs placeholder WITHOUT
>    `import_preview_id` → `collection_runs_check` (23514) → every first CSV confirm failed.
> 2. CSV adapter emitted an empty `limitation` → `btrim>=1` CHECK → every CSV collection
>    failed as UNAVAILABLE.
> 3. Overview crashed client-side (`null.overall`) — the workspace overview projection
>    returned `coverage: null` but OpenAPI `OverviewView.coverage` is required non-nullable;
>    now substitutes honest empty `unavailable` coverage. (Surfaced by the a11y E2E.)
>
> **STILL REMAINING (user/business-gated, NOT code):**
> 1. **Live-cred flows** (need real creds): GSC/GA4 OAuth sync, OpenAI artifact gen, hosted
>    Supabase auth. Code paths are built + unit/integration-covered; only a live exercise is left.
> 2. **DoD**: staging same-commit web+worker deploy; 2-fixture owner walkthrough.
> 3. **§22 open decisions D1–D7** (business owner) + deferred codex P2s (provider_discrepancies
>    detection §7.6; studio/sources/report error-state refinements; pipeline async rule contract §8.3).
>
> **Full green gate (this milestone)**: typecheck(9 pkgs)·lint·365 unit·81 integration·
> 36 E2E·build·verify:spec·contracts:check·db:migrate:check(28 tables)·secrets:scan·vendor:check.
> **Commit chain**: …1ca2405(AC-033) → da50a64(gap audit) → 0af359c(WP5 worker/service/engine
> +131 tests + CSV fixes + AC-039/040) → fb2d0ef(E2E harness AC-042/043 + overview fix) →
> f6cc39a(full-chain AC-044/045/022).

## (superseded) All WP1–WP5 code written; env + full E2E landing in progress

> **Status (2026-07-18)**: WP1–WP4 product code COMPLETE (backend + UI, all 7 screens
> build, all 26 operationIds routed). Local env ready (.env.local + dev auth shim +
> local blob). Green: typecheck (8 pkgs) · lint · 267 unit + 24 integration · build ·
> verify:spec · contracts:check · db:migrate:check · secrets:scan · vendor:check ·
> i18n parity. Built via 18 fan-out subagents (5 WP2 adapters · 5 WP3 rule domains ·
> 3 WP4 modules · 5 UI screens).
>
> **Local boot + smoke test DONE**: web dev server boots with the real env (root
> `.env.local` symlinked into apps/web + apps/worker so Next loads it); the vertical
> works through real HTTP + DB via the dev-auth shim — create project 201, GET /sources
> returns the 5 provider slots (dataforseo featureEnabled=false), findings empty with
> honest meta, report projection, diagnostic-run without a complete ICP → 422
> CONTEXT_INCOMPLETE. Browser-verified Sources + Diagnosis screens (zh-CN chrome, honest
> empty/gated states). Two real bugs the smoke/integration tests caught + fixed: evidence
> link role violated a CHECK constraint (would fail every diagnostic run); the dev server
> wasn't loading the root .env.local. `/health/ready` is 503 until the worker creates the
> pgboss schema (start the worker).
>
> **Codex acceptance DONE (2026-07-18)**: read-only codex review of backend (16 findings,
> 7 P1) + frontend (6, 2 P1). Fixed all P1s + most P2s — notably 3 `async_runs.result_type`
> CHECK violations that would have rolled back EVERY collection/artifact/export completion,
> the confidence/contradiction §8.7 gap, cross-run resolve strictness, active-run + review
> baseRevision TOCTOU→409, transient-retry stuck-running, and the `_finding-card` client
> ENTRY function-prop error. Regression tests added (confidence, merge, diagnostic-persist).
> **Live worker E2E**: crawl of example.com completes with result_type='collection_run' +
> writes a snapshot; diagnostic-persist integration test runs the real pipeline → finding →
> evidence with a valid role. 6 integration files / 25 tests.
>
> **Remaining (WP5 hardening — partial)**: SSRF (crawl engine + url-safety guard tests DONE),
> LLM allowlist + reference-integrity (DONE), secret scan (gate DONE). NOT DONE: Playwright
> 390/768/1024/1440 + keyboard/reduced-motion a11y E2E (AC-042/043); B2B/B2C full-chain golden
> fixtures (AC-044/045); provider failure/retry fixtures (AC-046); backup-restore drill (AC-047).
> Deferred codex P2s: provider_discrepancies detection (§7.6); studio/sources/report error-state
> refinements; pipeline async rule contract. Live-cred flows (Google OAuth, OpenAI, hosted
> Supabase) need real creds.



> **Active goal (2026-07-18)**: write ALL WP2–WP5 code first (adapters, engine, rules,
> artifacts, routes, worker handlers, UI), THEN configure env + land tests. Fan-out
> subagents + codex allowed. Contract owner (this session) merges DB/OpenAPI/state
> machine + observation vocabulary (the WP2↔WP3 seam). Keep `pnpm typecheck` green
> incrementally; defer the full integration/browser debug loop to the final phase.
>
> Build order: WP2 spine → adapters (fan-out) → services/routes/worker → Sources UI →
> WP3 engine/rules → WP4 artifacts/report/export → WP5 hardening + env + tests.

WP0 ✅. WP1 ✅ backend (`dc626fb`) + UI (`e3be3c0`) + browser-verified end-to-end.
- Backend: 6 project/context API operations, repos, services, url-safety vendor, idempotency; AC-007/008/009/010 tested (21 unit + 15 integration).
- UI: design system, i18n (6 ns, parity test = AC-011), API hooks, 11 primitives, login/new-project/shell/overview/context. Builds clean; **browser-verified**: login + LocaleSwitch (中↔EN keeps URL, AC-011), new-project form, shell (nav active/disabled + logout), overview (honest empty coverage/metrics), context (ICP form + Profile Lens), and a full-stack **draft save round-trip** (form → PATCH 200 → version 1 → refetch → UI). Screenshots taken during QA.
- **Dev auth**: local browser QA used a double-gated shim (`apps/web/src/lib/auth/dev.ts`; `NODE_ENV!==production` + `SF_DEV_AUTH=true`, in `.env.local` only). Real auth = Supabase (needs Docker up / hosted).

### WP1 residual polish (non-blocking, fold into WP2 or a cleanup pass)
- 2 context-form labels ("Target markets"/"Site languages") render static English — add `context.fields.marketCodes/siteLanguageCodes/...` keys and wire them for full zh-CN.
- Formal Playwright E2E for AC-010 multi-tab + AC-011 switch is deferred until local Supabase (isolation is service-tested: foreign workspace → 404; projectId-in-URL scoping is architectural).
- `middleware.ts` works in Next 16.2 (labeled "Proxy"); optional rename to `proxy.ts` per Next 16 convention.

### ICP content-hash decision (WP1)
`icp_profiles.content_hash = sha256(canonical({status, profile}))`, NOT profile-only. Reconciles append-only + `UNIQUE(project_id, content_hash)` with draft→complete transitions of identical content. Same status+profile re-save → dedup (AC-009); draft→complete of same content → new version. Implemented in `apps/web/src/lib/services/context.ts`.

### workspace view (WP1)
`getProjectWorkspaceView` implements `overview` fully; `plan`/`studio`/`report` return valid empty projections (no actions/artifacts/findings until WP3/WP4, where they'll share projections per AC-036).

## Local dev environment

- Node `24.12.0` (`.nvmrc`), pnpm `10.32.1`. Docker/colima currently **down** — `supabase start` unavailable, so local DB uses the bare Postgres 16 on `:5432`.
- DB: `postgres://wzb@localhost:5432/signalframe_mvp_dev` (create with `createdb signalframe_mvp_dev`, then `DATABASE_URL=... pnpm db:migrate`).
- `.env.local` holds local dev config (gitignored). Supabase Auth/Storage values are placeholders until Docker/hosted Supabase is wired; WP0 health endpoints and DB/queue work without real Supabase. Auth-dependent flows (WP1+) need a real/local Supabase project.
- Full green gate command:
  ```bash
  DATABASE_URL=postgres://wzb@localhost:5432/signalframe_mvp_dev \
    pnpm verify:spec && pnpm openapi:lint && pnpm contracts:check && \
    pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration && \
    pnpm build && pnpm db:migrate:check && pnpm secrets:scan && pnpm vendor:check
  ```

## Local E2E / auth status (WP1 UI verification)

Docker/colima is **down**, so local Supabase (GoTrue auth) can't `supabase start`. UI **build/typecheck/lint** need no auth and are verified. But auth-gated browser flows (login → new-project → overview → context) and the AC-010 multi-tab + AC-011 locale-switch **Playwright E2E** need a running authenticated app. Path options, decide when doing E2E:
1. Bring up colima + `supabase start` (real GoTrue; also needed for WP2 OAuth) — preferred once Docker is available.
2. A **dev-only** auth shim gated on `NODE_ENV !== 'production'` + explicit `SF_DEV_AUTH=true` (never in prod), seeding a fixed dev operator — for offline local QA only.
The login page + LocaleSwitch render without auth and can be browser-checked now.

## Key decisions (this build)

- **Repo location**: user chose `nevermore/signalframe-mvp-app` (independent git repo inside the nevermore workspace) over the spec's sibling path `/Users/wzb/Code/signalframe-mvp-app`. All "零依赖旧仓 / vendor-copy provenance" invariants still hold.
- **Deployment target**: user plans **Vercel + Supabase** (not the spec's Railway). Supabase aligns fully. Open item: the worker is a long-running pg-boss consumer with LISTEN/NOTIFY — Vercel serverless can't host a persistent process. Decide the worker host at deploy time (persistent host, Vercel Cron drain, or Supabase pg_cron/edge). Code stays deployment-portable; not blocking local build.

## Work Packages & Acceptance Criteria

### WP0 — 基座与合同 ✅ COMPLETE
- [x] **AC-001** `verify:spec` passes — 26 operationId / 5 async / 28 tables consistent.
- [x] **AC-002** Redocly lint clean + `contracts:check` (generated types, no manual `any`).
- [x] **AC-003** `schema.sql` applies to empty Postgres, idempotent on 2nd run; 28 tables + indexes + triggers (`db:migrate:check`).
- [x] **AC-004** pg-boss owns `pgboss` schema, not in Drizzle migration (`queue.integration.test.ts`).
- [x] **AC-005** unauth → 401; cross-workspace/project child id → 404; browser roles can't read `app` schema (`auth-guard.test.ts` + `isolation.integration.test.ts`).
- [x] **AC-006** Run + enqueue atomic; failure on either side rolls back whole tx — no queued-without-job / job-without-run (`queue.integration.test.ts`).
- Notes: worker bootstrap (`apps/worker/src/index.ts`) stands up env fail-fast + pg-boss + graceful shutdown; job handlers land in WP2. `secrets-scan.mjs` + `check-vendor-baseline.mjs` added.

### WP1 — 项目、Context 与 UI shell ✅ COMPLETE (backend + UI, browser-verified)
- [x] **AC-007** Safe-URL project create (project + site + crawl source); non-http + SSRF-blocked URLs rejected 422 — `projects.integration.test.ts`. (Full SSRF matrix: vendored `guard.test.ts` 7/7.)
- [x] **AC-008** `mode=draft` accepts partial/null; `mode=complete` returns pointer-level 422 per missing field — `icp-validation.test.ts`.
- [x] **AC-009** Same canonical profile → no new version; stale `baseVersion` → 409 — `projects.integration.test.ts`.
- [x] **AC-010** cross-workspace read → 404 (service level) — `projects.integration.test.ts`. UI multi-tab Playwright still pending.
- [x] **AC-011** EN/zh-CN key parity (parity test); locale switch keeps URL (browser-verified). Delivery/artifact content is locale-independent by design (outputLocale ≠ uiLocale).
- [x] UI: login, new-project, project shell + EN/zh-CN nav, Overview/Context screens, loading/error/empty states — built + browser-verified.
- Backend: `@sf/sources` url-safety, repos, services, 6 route handlers, idempotency.

### WP2 — 数据中心 (AC-012~020) 🟢 BACKEND CODE-COMPLETE (UI pending)
**Adapters (`@sf/sources`, all typecheck+unit green, 115 pkg tests)**: crawl engine+adapter
(vendor-copy from old `packages/crawler`, provenance in manifest, 9 entries); GSC adapter
(`createGscAdapter`+`HttpGscClient`, 56d window, top-10 queries, decay prev-28d); GA4 adapter
(`createGa4Adapter`+`HttpGa4Client`, session+keyEvent reports, unmapped→null not 0); CSV
(`parseCsv`/`clusterKey`/`previewCsv`/`normalizeCsv`, RFC4180, cluster_key.v1); DataForSEO
disabled stub (AC-020); AES-256-GCM credential crypto (§14.3); `BlobStore` (Memory + LocalFs).
Plus contract seam: `canonical-url.ts` (canonical_url.v1), `observations.ts` (metric vocab).
**DB repos**: data-snapshots, observations (batch), oauth-intents, import-previews,
source-credentials, provider-discrepancies; extended source-connections (insert/list/disconnect/
setLastSnapshot) + collection-runs (finalize/findById) + async-runs (listActive/request_payload).
**Zod**: connect 3-phase union, ImportConfirmRequest, CreateDiagnosticRunRequest, ReviewFindingRequest.
**Services + routes**: `GET /sources` (5-slot + freshness/stale), `GET /snapshots`,
`DELETE /sources/{id}`, `POST /sources/{provider}/connect` (OAuth 3-phase), `GET /oauth/google/callback`
(303), `POST /sources/csv/import` (preview 200 + confirm 202 atomic enqueue).
**Worker**: `buildWorkerContext` + `run-collection` dispatcher (all 4 providers) + `persist`
(upload raw → tx: snapshot+observations+finalize+connection+terminal+telemetry) + `collect.*`
handlers registered.
**Still TODO for WP2**: Sources UI (cards, connect flow, CSV upload, coverage/freshness);
integration/browser tests (AC-012~020); local Supabase for live OAuth; GA4 property timezone
currently defaults to America/Los_Angeles (refine at env-config).
**Live-cred items (build done, needs creds to exercise)**: GSC/GA4 OAuth (AC-014/015) needs a real
`GOOGLE_OAUTH_CLIENT_ID/SECRET` + running Supabase session.
### WP3 — 诊断、审核与计划 (AC-021~030) 🟢 BACKEND CODE-COMPLETE (UI pending)
**Engine (`@sf/engine`, pure; 11 test files / 56 tests green)**: 11-rule registry in fixed
order (tech-http/canonical/linkgraph, search-ctr/decay, content-coverage/gap, cro-path/landing,
geo-entity/crawler); `DiagnosticContext` (indexed pages/gsc/ga4/csv/robots/sitemap + derived
internal inlinks + coverage + helpers); util page_role.v1 / intent_match.v1 / ctr-benchmark /
proof_block / canonical hash; `runPipeline` (§8.2 fixed order → rule results + merged findings +
coverage); `merge` (run-internal key + cross-run `findingKey` sha256); `confidence` (§8.7,
low→needs_more_data); `derivePriority` (§9.3 deterministic 8-step); `ACTION_TEMPLATES` (EN/zh-CN);
`summaries` (deterministic EN/zh-CN).
**DB repos**: diagnostic-runs (+rule results), findings (cross-run upsert/resolve/regress),
evidence (+finding_observations), actions (+override audit), finding-review-events.
**Services + routes**: `POST /diagnostic-runs` (freeze §8.1 manifest, CONTEXT_INCOMPLETE /
CRAWL_SNAPSHOT_REQUIRED gates), `GET /findings` (+meta: latestRun/coverage/11 ruleResults),
`PATCH /findings/{id}` (confirm→same-tx Action upsert; ignored/nmd FINDING_ACTION_ACTIVE gate),
`GET /actions`, `PATCH /actions/{id}` (override + audit, VERSION_CONFLICT).
**Worker**: `diagnose` handler → `run-diagnostic` (build context from frozen snapshots →
runPipeline → persist rule results/findings/evidence + cross-run resolve + coverage + telemetry).
**TODO for WP3**: Diagnosis + Plan UI; integration/fixture tests (AC-021~030: 11-rule fixtures,
B2B/B2C degradation, pipeline-order, merge determinism, priority 8-step).

### WP4 — Studio、Report 与 Export (AC-031~039) 🟢 BACKEND CODE-COMPLETE (UI pending)
**`@sf/artifacts` (~70 tests green)**: OpenAI LLM adapter (`createOpenAIClient`, allowlist
prompt envelope + untrusted-evidence wrapping + reference-integrity check + AnalysisInvocation,
§10.2/§14.4); deterministic templates (content_brief/technical_ticket markdown + metadata_rewrite
json, EN/zh-CN, §10.1); validators (markdown section + sanitize + metadata Zod, validation/rollback
gate §9.3-8); export assembler (dependency-free STORE zip + manifest matching
service-bundle-manifest.schema.json + client_bundle exclusions, §10.5).
**DB repos**: execution-artifacts (+revisions), analysis-invocations, export-bundles.
**Services + routes**: `POST /actions/{id}/artifacts` (async 202, regenerate reuse, ACTION_NOT_EXECUTABLE),
`GET/PATCH /artifacts/{id}` (revision append, STALE_REVISION, ready-needs-valid),
`GET /artifacts`, `GET /report` (§10.4 projection), `POST /exports` + `GET /exports/{id}`
(signed URL 15min). **All 26 operationIds now have route handlers.**
**Worker**: artifact.generate (build allowlisted prompt → template/LLM → validate → revision +
invocation) + export.bundle (load+redact → assembleBundle → upload → finalize + telemetry).
**AC-036 wired**: workspace-view plan/studio/report delegate to the same Actions/Artifacts/Report
projections.
**TODO for WP4**: Studio + Report UI (print CSS); AC-031~039 fixture tests.

### WP5 — 硬化与双客户 Pilot Gate (AC-040~048 + DoD) ⬜
**TODO**: all UI screens (Sources/Diagnosis/Plan/Studio/Report + nav wiring); env config
(local Supabase auth/storage, Google OAuth creds, OpenAI key, blob dir); integration/fixture/
Playwright E2E across AC-012~048; SSRF/secret/prompt-injection security tests; B2B/B2C full-chain
fixtures; runbook. Backend for WP2/WP3/WP4 is code-complete + typecheck/lint/unit/integration green.

## Guardrails (do not violate)

- Spec is sole authority; zero open implementation decisions. No Deferred capabilities, no half-built entry points.
- No RBAC / Billing / CMS publish / PDF / auto-deploy / auto-recheck / DataForSEO real calls.
- Old signalframe repo is read-only; every reuse is a recorded vendor-copy in `docs/vendor/signalframe-manifest.json`.
- Database, OpenAPI, and the state machine are merged by a single contract owner even when other work fans out.
