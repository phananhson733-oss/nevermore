# SignalFrame MVP Progress

Last locally verified: **2026-07-18**

## Executive status

The implementation is **locally code-complete against the frozen MVP v0.2 contract** and all code-closable release gates are green. It is not yet accurate to call the product pilot-ready: the current worktree is uncommitted, there is no immutable release SHA, and the hosted/provider/production-recovery/Owner gates listed below have not been performed from this task.

- Authority: `/Users/wzb/Code/nevermore/signalframe-mvp/implementation-spec-v0.2/MVP-IMPLEMENTATION-SPEC.md`
- Contract: product `0.2.0`, API/job contract `2026-07-18`
- Contract inventory: **26 API operations / 5 async operations / 28 app tables / 11 frozen rules**
- Repository: `/Users/wzb/Code/nevermore/signalframe-mvp-app`
- Current Git base: `27871476957bfc786e8bd40cd82f7bd4b38a9375` on `main`; the release candidate exists only as a shared dirty worktree, not a deployable immutable SHA.
- Legacy vendor source: `/Users/wzb/Code/signalframe` at `72af9300c6009a3912973b96b4789c89ad37db01`; the final vendor baseline check confirms this task did not modify it.
- No hosted Supabase, Vercel, Railway, Google, OpenAI, or Azure state was mutated during the final local verification.

## Final local verification snapshot

| Gate | Final evidence |
| --- | --- |
| Toolchain/install | Node `24.12.0`, pnpm `10.32.1`; `pnpm install --frozen-lockfile` passed with an unchanged lockfile. |
| Frozen specification | `pnpm verify:spec` passed: 26 operations, 5 async operations, 28 tables, 11 rules, manifest schema and local links. |
| HTTP contracts | `pnpm openapi:lint` passed without errors; `pnpm contracts:check` regenerated and exactly diffed the OpenAPI TypeScript output. |
| Implementation/deploy consistency | `pnpm implementation:check` and `pnpm deploy:check` passed, including shared 202 envelopes, status polling, Next 16 proxy/CSP, integration/E2E safety, Vercel web and Railway worker topology. |
| Security/provenance | `pnpm secrets:scan`, `pnpm vendor:check`, and `pnpm audit --audit-level=moderate` passed; audit reported no known vulnerabilities. |
| Static quality | Full `pnpm typecheck`, full `pnpm lint`, and `git diff --check` passed across the workspace. |
| PostgreSQL schema | On disposable loopback PostgreSQL 16.12, migration ran successfully twice; migrate-check reported **28 app tables, 22 indexes, 25 triggers**; schema smoke passed and rolled all fixtures back. |
| Unit tests | **121 files / 1,079 tests passed**. Coverage: **87.48% statements, 80.76% branches, 89.51% functions, 88.97% lines**. |
| Real PostgreSQL integration | **31 files / 175 tests passed** in three consecutive full serial runs against the explicitly guarded disposable loopback database; the formerly flaky active-key race also passed its dedicated repeated stress loop. |
| Real browser E2E | **37/37 passed**: project isolation, axe/keyboard/reduced-motion checks, and 390/768/1024/1440 responsive coverage. |
| Mock critical-flow E2E | **12/12 passed**: navigation/locales, async collection polling, review→Action, stale Artifact revision, export download, CSV mobile view, permission/rate-limit/partial/degraded/retry/error states. |
| E2E teardown safety | Both web servers exited; the exact real/mock dist and blob directories were removed after server shutdown; `next-env.d.ts` was restored to the canonical `.next/types/routes.d.ts` import. |
| Production web build | Next.js `16.2.10` standalone production build passed. Live/version returned 200; the isolated readiness probe correctly returned 503 because no worker lease was started. CSP smoke proved the per-request nonce reached the HTML and production policy contains neither `unsafe-inline` nor `unsafe-eval`. |
| Worker container | `Dockerfile.worker` built successfully as `signalframe-worker:codex-verify`; image metadata uses user `node` and the expected PID-1 Node/tsx command. Running without required env failed fast with fixed JSON `{event, code, type}` and no dynamic exception text, as intended. |
| Restore drill tests | **16/16 passed** with 91.04% line, 85.14% branch and 92.00% function coverage. |
| Actual local restore | A fresh PostgreSQL 16 drill restored `signalframe_restore_drill_20260718t190112_1e57a167ec5d`, replayed migration, passed smoke, matched all 28 table counts/canonical SHA-256 hashes/object-metadata probes, found no differences, removed its private dump, dropped only that generated target, and confirmed the target absent. |

The local production readiness response above is intentionally **not** counted as a hosted readiness pass. `/api/mvp/health/ready` is designed to be 200 only while a real worker holds its PostgreSQL session lease.

## Material fixes included in this candidate

- Request boundary: Next 16 `src/proxy.ts`, per-request nonce CSP, complete security headers, same-origin browser mutation checks, bounded JSON/multipart parsing, stable RFC 9457-style problems, and DB-backed replay-aware rate limiting.
- SSRF/provider safety: fail-closed IPv4/IPv6 classification, DNS timeout and IP pinning, manual same-origin redirects, per-hop robots checks, bounded response bodies and operation deadlines for Crawl, Google and OpenAI paths.
- Crawl correctness: terminal redirect URL is the page identity and parse base; concurrent aliases deterministically deduplicate; pending body readers cannot exceed abort/deadline; total decoded data has a strict shared 128 MiB reservation; persisted projections are bounded.
- GA4 honesty: session and key-event reports share a 200,000-row budget; truncation is explicit/partial and incomplete key-event values remain `null`, never a fabricated zero.
- Idempotency/concurrency: DB-clock expiry/reuse, bounded pruning, immutable completed replay before mutable/external checks, cross-project request hashes, active-run winner re-reads, and project-scoped DB-time CAS for single-use CSV tokens. PostgreSQL `23505` mapping now traverses bounded/cycle-safe Drizzle `cause` chains, tolerates hostile getters, and accepts only the exact expected constraint for each operation.
- Async/data integrity: queue retry/recovery and canonical run reconciliation; Artifact generation ownership/revision CAS; stale generations cannot overwrite manual/new generations; deterministic project stage transitions.
- Evidence/output honesty: 11 deterministic rules, provider discrepancy confidence downgrade, generated-evidence invocation linkage, fixed rule failure codes, prompt/reference/number/Markdown validation, immutable Artifact revisions, and canonical report/export projections.
- Storage/export: local and Supabase private backends, bounded signing/listing, complete keyset pagination, post-upload rollback cleanup, daily fail-closed orphan sweep, exact canonical object-reference checks, export redaction, schema/hash/count lineage.
- Privacy/observability: request/worker/rule/Crawl failures and production database CLI top-level failures log or persist stable codes only; customer/model/provider error text is not evaluated or propagated; telemetry and export allowlists are covered by sentinel scans. Schema smoke also removes the database password from `psql` argv, uses a mode-0600 temporary `PGPASSFILE`, and removes it after the child exits.
- Product UI: EN/zh-CN parity, explicit permission/partial/degraded/retry states, project-scoped routing, responsive alternatives, accessibility coverage, and real/mock E2E teardown isolation.

## AC-001–AC-048 evidence matrix

“Passed” below means the code-closable/local acceptance evidence is green. Hosted live proof remains a separate launch gate even where deterministic provider fixtures satisfy the AC locally.

| AC | Local status | Primary evidence |
| --- | --- | --- |
| AC-001 | Passed | Frozen-spec verifier: 26 operations / 5 async / 28 tables / 11 rules. |
| AC-002 | Passed | Redocly lint and exact regenerated OpenAPI TypeScript diff. |
| AC-003 | Passed | PostgreSQL 16 migration twice; 28 tables / 22 indexes / 25 triggers. |
| AC-004 | Passed | pg-boss remains outside app migrations; queue and live-worker readiness integration tests pass. |
| AC-005 | Passed | Auth/isolation tests, project-scoped repositories, browser app-schema denial and real two-tab isolation E2E. |
| AC-006 | Passed | Transactional enqueue/full-chain integrations prove run+job rollback symmetry. |
| AC-007 | Passed | Project integration plus URL guard, DNS pin, private/metadata/special-address rejection tests. |
| AC-008 | Passed | ICP draft/complete pointer-level validation and contract tests. |
| AC-009 | Passed | Canonical profile dedup and deterministic concurrent base-version conflict integration. |
| AC-010 | Passed | Real Playwright two-project/two-tab URL, query and aggregate isolation. |
| AC-011 | Passed | EN/zh-CN key parity, locale routing and stored-output locale tests. |
| AC-012 | Passed | Crawl engine/adapter/parse/robots/sitemap fixtures; Sources package 396 tests. |
| AC-013 | Passed | Redirect SSRF, rebinding, IPv4/IPv6 special ranges, decompression/body/run caps and non-HTTP rejection. |
| AC-014 | Passed locally | Google OAuth state/expiry/replay/project/property selection and GSC chain integrations; live hosted credential smoke pending. |
| AC-015 | Passed locally | GA4 client/adapter/normalization and 56-day/key-event/null/truncation integrations; live hosted credential smoke pending. |
| AC-016 | Passed | CSV preview/confirm/token replay, exact idempotent replay, stale-read CAS and transaction rollback integrations. |
| AC-017 | Passed | DB unavailable-number check, normalization and serializer contract tests; unavailable values stay `null`. |
| AC-018 | Passed | Source/read-model freshness and unavailable/stale UI tests. |
| AC-019 | Passed | Provider active-key conflict, winner status URL and concurrent exact replay integrations. |
| AC-020 | Passed | DataForSEO flag/API/UI tests prove stable disabled behavior and no request path. |
| AC-021 | Passed | All 11 rule fixtures and canonical output snapshots; Engine 112 tests. |
| AC-022 | Passed | B2B/B2C fixtures exercise all domains and exact missing-provider degradation. |
| AC-023 | Passed | Pipeline-order tests keep deterministic rules before optional summaries/LLM work. |
| AC-024 | Passed | Evidence linkage tests and PostgreSQL generated-evidence invocation constraint. |
| AC-025 | Passed | Diagnostic input/merge/finding-key dedup integrations. |
| AC-026 | Passed | Completed/partial/skipped/inconclusive resolve behavior and regression persistence tests. |
| AC-027 | Passed | Finding-review validation and append-only review-event integrations. |
| AC-028 | Passed | Confirmed Finding→single template Action transaction/idempotency integrations. |
| AC-029 | Passed | Frozen priority ordering fixtures; no weighted-score field. |
| AC-030 | Passed | Action override reason, revision conflict and old/new audit integrations. |
| AC-031 | Passed | Three Artifact types share 202/status URL; worker generation/revision integrations. |
| AC-032 | Passed | LLM envelope/prompt allowlist, size/deadline and secret-sentinel tests. |
| AC-033 | Passed | Evidence/reference/number forgery, HTML/script/URI and missing-section validators. |
| AC-034 | Passed | Artifact stale base revision, identical hash and ready→draft edit tests. |
| AC-035 | Passed | output locale default/override and UI-locale independence tests. |
| AC-036 | Passed | Canonical report/list projection integration and mapper tests. |
| AC-037 | Passed | Service bundle manifest schema, file hashes/counts/snapshot/ruleset lineage and full pagination tests. |
| AC-038 | Passed | Client bundle redaction excludes observations, internal/ignored/draft/credential content. |
| AC-039 | Passed locally | Project-scoped 900-second signer, missing/dependency distinctions and regeneration tests; production 30-day bucket lifecycle configuration pending. |
| AC-040 | Passed | Secret scan plus logger, telemetry, export, rule and Crawl sentinel tests. |
| AC-041 | Passed | Transient/permanent maps, heartbeat/retry exhaustion, recovery and terminal-redelivery idempotency tests. |
| AC-042 | Passed | 28 real responsive page/viewport checks plus mobile CSV alternative. |
| AC-043 | Passed | Axe, contrast, keyboard focus, non-colour status and reduced-motion checks. |
| AC-044 | Passed locally | Real PostgreSQL B2B full-chain integration and critical-flow browser fixture; Owner walkthrough pending. |
| AC-045 | Passed locally | Real PostgreSQL B2C full-chain integration and client-report/export browser fixture; Owner walkthrough pending. |
| AC-046 | Passed | Mock browser permission/rate-limit/partial/degraded/error/retry states. |
| AC-047 | Local/CI passed; production pending | Actual loopback restore matched 28-table counts and canonical/integrity hashes and proved cleanup; production Supabase PITR plus Storage-byte recovery requires Owner evidence. |
| AC-048 | Passed | Vendor manifest hashes current and legacy repository baseline unchanged. |

## External / Owner-gated launch checklist

These are the only known remaining release gates. They require external authority, credentials, production-like infrastructure, or business judgment and cannot be truthfully fabricated from local code:

1. Freeze and commit this worktree, then deploy **the same immutable SHA** to Vercel web and Railway worker; run the migration job against the intended Supabase project first.
2. Verify hosted `/api/mvp/health/version` reports that exact SHA on web and worker logs, and hosted `/api/mvp/health/ready` returns 200 only with DB, pg-boss schema and a live worker session lease.
3. Complete real Supabase Auth browser/session/callback proof on the deployed origin.
4. Exercise live Google OAuth, GSC property selection/sync and GA4 property/key-event sync with Owner-approved accounts; retain sanitized evidence without tokens or customer payloads.
5. Exercise the chosen production OpenAI endpoint (direct OpenAI or the complete Azure OpenAI configuration), both structured-LLM Artifact generation and optional Finding summaries, with log/telemetry review.
6. Confirm both Supabase Storage buckets are private, configure/verify the 30-day export lifecycle, and validate signed downloads from the deployed web service.
7. Perform the production recovery exercise described in `docs/RESTORE-DRILL.md`: Supabase PITR into an isolated project plus separate private Storage object-count/sample-byte-checksum recovery evidence and Owner sign-off.
8. Have the business Owner walk through EN and zh-CN B2B and B2C outputs, including evidence, priority, Action, Artifact and both bundle types, and explicitly approve pilot quality.

Until all eight are complete, describe the state as **“local implementation and acceptance gates passed; hosted/Owner launch gates pending,”** not “production-ready” or “pilot-ready.”

## Safety notes for the next operator

- Never run database-backed tests against a hosted database. Use an explicit loopback disposable name accepted by `packages/db/src/test-database-safety.ts`.
- Do not infer or document what `.env.local` points to. Final tests supplied explicit isolated environment values and the safety guards fail closed.
- Do not reuse an unknown server in Playwright; a port collision must fail instead of sending mutations to an existing process.
- Do not replace `apps/web/src/proxy.ts` with the removed `middleware.ts`; Next 16 request-boundary behavior and nonce propagation live in `src/proxy.ts`.
- Do not weaken stable error/log fields by adding `error.message`, `String(error)`, provider bodies, model output, object keys or customer text.
- Keep the legacy `/Users/wzb/Code/signalframe` repository read-only; any future reuse must be vendor-copied with commit/path/SHA-256 provenance.

## Read first on resume

- `/Users/wzb/Code/nevermore/signalframe-mvp-app/docs/PROGRESS.md`
- `/Users/wzb/Code/nevermore/signalframe-mvp-app/docs/RUNBOOK.md`
- `/Users/wzb/Code/nevermore/signalframe-mvp-app/docs/DEPLOYMENT.md`
- `/Users/wzb/Code/nevermore/signalframe-mvp-app/docs/RESTORE-DRILL.md`
- `/Users/wzb/Code/nevermore/signalframe-mvp/implementation-spec-v0.2/MVP-IMPLEMENTATION-SPEC.md`
