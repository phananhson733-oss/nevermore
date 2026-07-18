# SignalFrame MVP — Build Progress

> Crash-resilient status tracker. **On session resume, read this file first** to
> recover context instead of relying on memory. Update the AC checkboxes and the
> "Resume here" pointer whenever a Work Package advances.

- **Spec**: `../signalframe-mvp/implementation-spec-v0.2/MVP-IMPLEMENTATION-SPEC.md` (product/contract authority)
- **Contract version**: `0.2.0 / 2026-07-18`
- **Repo path**: `/Users/wzb/Code/nevermore/signalframe-mvp-app` (independent git repo inside nevermore, per user decision)
- **Old repo (read-only, vendor-copy source)**: `/Users/wzb/Code/signalframe` @ `72af9300c600` — NEVER modify (AC-048).

## Resume here 👉 **WP2→WP5 full build (code-first, goal-driven 2026-07-18)**

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
### WP3 — 诊断、审核与计划 (AC-021~030) ⬜
### WP4 — Studio、Report 与 Export (AC-031~039) ⬜
### WP5 — 硬化与双客户 Pilot Gate (AC-040~048 + DoD) ⬜

## Guardrails (do not violate)

- Spec is sole authority; zero open implementation decisions. No Deferred capabilities, no half-built entry points.
- No RBAC / Billing / CMS publish / PDF / auto-deploy / auto-recheck / DataForSEO real calls.
- Old signalframe repo is read-only; every reuse is a recorded vendor-copy in `docs/vendor/signalframe-manifest.json`.
- Database, OpenAPI, and the state machine are merged by a single contract owner even when other work fans out.
