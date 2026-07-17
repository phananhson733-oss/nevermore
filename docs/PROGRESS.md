# SignalFrame MVP — Build Progress

> Crash-resilient status tracker. **On session resume, read this file first** to
> recover context instead of relying on memory. Update the AC checkboxes and the
> "Resume here" pointer whenever a Work Package advances.

- **Spec**: `../signalframe-mvp/implementation-spec-v0.2/MVP-IMPLEMENTATION-SPEC.md` (product/contract authority)
- **Contract version**: `0.2.0 / 2026-07-18`
- **Repo path**: `/Users/wzb/Code/nevermore/signalframe-mvp-app` (independent git repo inside nevermore, per user decision)
- **Old repo (read-only, vendor-copy source)**: `/Users/wzb/Code/signalframe` @ `72af9300c600` — NEVER modify (AC-048).

## Resume here 👉 **WP1 — 项目、Context 与 UI shell (AC-007~011)**

WP0 is complete and green. Next work package is WP1.

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

### WP1 — 项目、Context 与 UI shell ⏳ NEXT
- [ ] **AC-007** Safe-URL project create (project + site + crawl source); private/metadata/illegal URLs rejected (spec §6.1).
- [ ] **AC-008** `mode=draft` accepts partial/null; `mode=complete` returns pointer-level 422 per missing required field (spec §6.2).
- [ ] **AC-009** Same canonical profile → no new version; concurrent `baseVersion` → 409.
- [ ] **AC-010** `/p/A/...` and `/p/B/...` multi-tab parallel ops don't cross data.
- [ ] **AC-011** EN/zh-CN key parity; locale switch keeps URL; artifact/client content unchanged by UI locale.
- Scope: login, new-project, project-path shell + EN/zh-CN nav, Project/Site CRUD, ICP draft/complete immutable versions + optimistic conflict, Overview/Context aggregate read-models with loading/error/empty.

### WP2 — 数据中心 (AC-012~020) ⬜
### WP3 — 诊断、审核与计划 (AC-021~030) ⬜
### WP4 — Studio、Report 与 Export (AC-031~039) ⬜
### WP5 — 硬化与双客户 Pilot Gate (AC-040~048 + DoD) ⬜

## Guardrails (do not violate)

- Spec is sole authority; zero open implementation decisions. No Deferred capabilities, no half-built entry points.
- No RBAC / Billing / CMS publish / PDF / auto-deploy / auto-recheck / DataForSEO real calls.
- Old signalframe repo is read-only; every reuse is a recorded vendor-copy in `docs/vendor/signalframe-manifest.json`.
- Database, OpenAPI, and the state machine are merged by a single contract owner even when other work fans out.
