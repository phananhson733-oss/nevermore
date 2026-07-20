# SignalFrame MVP Progress

Last full local verification: **2026-07-20**

A full whole-worktree verification and repeated owner-audit loop was completed
on **2026-07-20**. The final loop closed additional defects in:

- `async_runs.contract_version` default drift (`0009_async_run_contract_version`)
- non-en/zh `finding_summary` generation + invocation persistence health latching
- persisted `finding_summary` run-budget enforcement across worker retries
- shared OpenAI transport shutdown-signal propagation plus no-new-summary
  behavior after worker shutdown begins
- `metadata_rewrite` current-metadata fidelity, including preservation of literal
  values such as `Unknown` / `N/A` when they are the real frozen crawl fields
- frozen-run evidence and diagnostic-metadata scoping, exact current/legacy job
  contract-version matching, and invalid recovery-candidate rejection
- bounded Artifact transport/prompt/envelope inputs plus a shared 40,000-character
  manual/LLM content budget enforced at contract, HTTP, service and UI boundaries
- report export-locale same-click behavior and blank-reset-to-project-default behavior
- report print CSS scoping: app shell chrome now hides only on report print media
  through stable data attributes plus a real-browser regression check

The counts below reflect the latest final-goal reruns, including full unit
coverage, real PostgreSQL integration, real and mock browser E2E, production
builds, platform-neutral visual baselines, the worker container, and actual
disposable restores. The production database backup/migration gates are
complete. Exact immutable-SHA Vercel/Railway evidence is recorded in the release
handoff after this file is frozen; live-provider, production-recovery,
authority-ratification and business-approval gates remain explicitly open.

## Executive status

Every currently known **locally code-closable implementation and acceptance gate is green**. It is not accurate to call the product pilot-ready solely from local evidence: each release must still prove that Vercel Web and the Railway Worker report the same immutable SHA, and the provider/recovery/business gates listed below remain open. The checked-in authority machine contracts also contain differences that require Owner ratification rather than a speculative local rewrite.

- Authority: `/Users/wzb/Code/nevermore/signalframe-mvp/implementation-spec-v0.2/MVP-IMPLEMENTATION-SPEC.md`
- Contract: product `0.2.0`, API/job contract `2026-07-18`
- Contract inventory: **26 API operations / 5 async operations / 28 app tables / 11 frozen rules**
- Repository: `/Users/wzb/Code/nevermore/signalframe-mvp-app`
- Release line: `main`; the exact immutable release SHA must be read from Git, `/api/mvp/health/version`, and Railway startup logs rather than copied into this file before the release commit exists.
- Legacy vendor source: `/Users/wzb/Code/signalframe` at `72af9300c6009a3912973b96b4789c89ad37db01`; the final vendor baseline check confirms this task did not modify it.
- Production state already changed under explicit Owner direction: the Supabase logical backup was restore-verified, migrations `0001`–`0009` were applied and replay-checked, and a Railway Hobby project with one worker-only service received production variables. Current-release deployment/promotion and deployed-origin smoke must always be repeated against the same immutable SHA; the release handoff is the authoritative record of that hosted evidence.

## Final local verification snapshot

| Gate | Final evidence |
| --- | --- |
| Toolchain/install | Node `24.12.0`, pnpm `10.32.1`; `pnpm install --frozen-lockfile` passed with an unchanged lockfile. |
| Frozen specification | `pnpm verify:spec` passed: 26 operations, 5 async operations, 28 tables, 11 rules, manifest schema and local links. |
| HTTP contracts | `pnpm openapi:lint` passed without errors; `pnpm contracts:check` regenerated and exactly diffed the OpenAPI TypeScript output. |
| Implementation/deploy consistency | `pnpm implementation:check` and `pnpm deploy:check` passed on the current convergence candidate: Vercel Web + Supabase state + Railway worker-only topology, root origin with no `/app`, worker start pinned in `railway.json`, and the existing Next 16 proxy/CSP and integration/E2E safety checks intact. |
| Security/provenance | `pnpm secrets:scan`, `pnpm vendor:check`, `pnpm audit --prod --audit-level=moderate`, and `pnpm audit --audit-level=moderate` passed; both audits reported no known vulnerabilities. |
| Static quality | Full `pnpm typecheck`, full `pnpm lint`, and `git diff --check` passed across the workspace. The root commands now explicitly include `typecheck:e2e` and `lint:e2e`, closing the prior gap where Playwright/config files were executable but outside recursive workspace static checks. |
| PostgreSQL schema | On disposable loopback PostgreSQL 16.12, migration ran successfully twice; migrate-check reported **28 app tables, 22 indexes, 28 triggers**; schema smoke passed and rolled all fixtures back. |
| Unit tests | **183 files / 2,117 tests passed** in the final release-candidate rerun. The most recent full coverage run remained above the enforced 80% gates: **87.19% statements (9,411/10,793), 80.68% branches (5,652/7,005), 90.97% functions (1,755/1,929), 88.61% lines (8,691/9,808)**. The branch gate was not lowered, ignored or excluded; `artifact-update.ts` has 100% statements/branches/functions/lines coverage. |
| Real PostgreSQL integration | **36 files / 255 tests passed** in the final full serial run against an explicitly guarded disposable loopback database, including the real disconnect/reconnect migration-progress regression; focused diagnostic, readiness, storage-reference and concurrency regressions also passed. |
| Real browser E2E | **42/42 passed on a fresh dedicated database** — project isolation, axe/keyboard/reduced-motion checks, the report-print regression, 390/768/1024/1440 responsive coverage, plus real B2B/B2C browser verticals through Next, PostgreSQL, pg-boss workers and local file blobs. Both diagnostic runs finished `completed`, exercised all 11 rules and had zero skipped/inconclusive rules. Crawl/GSC/GA4 use explicit deterministic offline seams; application persistence, queues, HTTP, UI and ZIP bytes are real. |
| Mock browser E2E | **60/60 passed**: navigation/locales, cursor pagination, Studio unsaved-change/back-forward protection, async collection polling, review→Action, stale Artifact revision, arbitrary valid BCP-47 output-locale deep-link/export behavior, same-click locale export, blank reset to project default, CSV mobile view, permission/rate-limit/partial/degraded/retry/error states, shell/project-switcher/report/sources/overview convergence coverage, plus a real `next dev` + Chromium assertion that hydration completes with the expected development CSP and zero console/page errors. |
| End-to-end aggregate coverage | **102/102 browser scenarios passed**: **42/42 real** plus **60/60 mock**. The canonical RelayOps chain also produced **12 platform-neutral visual baselines** spanning Overview, Sources, Studio and Report at 1920px, 1440px and 390px; a second independent fresh database matched those baselines without updating them. A hosted release still requires deployed-origin smoke on the same immutable SHA. |
| E2E teardown safety | Both web servers exited; the exact real/mock dist and blob directories were removed after server shutdown; `next-env.d.ts` was restored to the canonical `.next/types/routes.d.ts` import. |
| Disposable database closeout | The two exact databases created by the final rerun — `signalframe_codex_root_final_20260720_1316_a7c9e2` and `signalframe_e2e_root_final_20260720_1316_b4d8f1` — were dropped and a final `pg_database` query returned zero matches. The generated restore target `signalframe_restore_drill_20260720t052018_381c70896548` was also dropped and confirmed absent; unrelated pre-existing databases were left untouched. The retained restore evidence contains no connection secret. |
| Production web build | Next.js `16.2.10` optimized production build passed again after the final typography/visual-stability change. In the prior isolated runtime smoke with production-valid synthetic service URLs, `/api/mvp/health/live` returned 200, `/api/mvp/health/ready` correctly returned 503 with the stable `DEPENDENCY_UNAVAILABLE` problem body because its database/worker dependencies were deliberately absent, and `/login` returned 200. Response CSP used per-request nonces and contained no `unsafe-inline` or `unsafe-eval`. |
| Isolated visual/CSP audit | The credential-free visual/CSP audit kept **11/11 document responses at 200**, with zero browser errors, failed responses or measured horizontal overflow. The final real RelayOps visual gate adds 12 committed baselines across three viewports and verifies them on a second fresh database. The audit also closed a development-only CSP defect: Next DevTools nonce-less styles now use `style-src 'self' 'unsafe-inline'` only when `NODE_ENV === "development"`; production, test, staging, empty and unset modes remain nonce-gated without either unsafe relaxation. `e2e/csp-development.mock.spec.ts` makes the real Next-development-runtime browser/console check reproducible. |
| Worker container | Current `Dockerfile.worker` built successfully as `signalframe-worker:codex-final-20260720` (`sha256:41ebfec86ac6a45c5c2edb83902b64c294a4e1594186928d3c2644292734babd`); image metadata uses user `node` and the expected PID-1 Node/tsx command. Running without required env exited 1 with fixed JSON `{event, code, type}` and no dynamic exception text, as intended. |
| Legacy Railway shared image (non-production) | Historical `Dockerfile.railway` verification remains retained for provenance only. It is not selected by `railway.json`, CI, or the current release path. Production Railway builds only `Dockerfile.worker` and runs only the pinned pg-boss Worker command; Vercel owns the Web runtime. |
| Restore drill tests | **29/29 passed** with **94.30% line, 88.53% branch and 98.57% function coverage**. |
| Actual local restore | Using matching PostgreSQL 16 client binaries through `RESTORE_DRILL_PG_BIN`, a fresh drill restored `signalframe_restore_drill_20260720t052018_381c70896548`; the generated evidence records `Migration replay: passed`, `Schema smoke: passed`, **28** application tables, matching row counts and canonical/object-metadata SHA-256 checksums, no differences, removed dump/passfile artifacts, dropped only that generated target, and confirmed the target absent. Sanitized mode-0600 JSON/Markdown evidence is retained under `.data/restore-drills/final-goal-20260720-1320/`. |

The local production readiness response above is intentionally **not** counted as a hosted readiness pass. `/api/mvp/health/ready` is designed to be 200 only while a real worker holds its PostgreSQL session lease.

## Material fixes included in this candidate

- Request boundary: Next 16 `src/proxy.ts`, per-request nonce CSP, complete security headers, same-origin browser mutation checks, bounded JSON/multipart parsing, stable RFC 9457-style problems, and DB-backed replay-aware rate limiting. Only explicit `NODE_ENV === "development"` permits the Next DevTools style/eval relaxations; every other environment stays nonce-gated. The implementation gate executes both CSP branches and validates their effective directives instead of depending on the builder's source-code layout.
- SSRF/provider safety: fail-closed IPv4/IPv6 classification, DNS timeout and IP pinning, manual same-origin redirects, per-hop robots checks, bounded response bodies and operation deadlines for Crawl, Google and OpenAI paths.
- Crawl correctness: terminal redirect URL is the page identity and parse base; concurrent aliases deterministically deduplicate; pending body readers cannot exceed abort/deadline; total decoded data has a strict shared 128 MiB reservation; persisted projections are bounded.
- GA4 honesty: session and key-event reports share a 200,000-row budget; truncation is explicit/partial and incomplete key-event values remain `null`, never a fabricated zero.
- Idempotency/concurrency: DB-clock expiry/reuse, bounded pruning, immutable completed replay before mutable/external checks, cross-project request hashes, active-run winner re-reads, and project-scoped DB-time CAS for single-use CSV tokens. PostgreSQL `23505` mapping now traverses bounded/cycle-safe Drizzle `cause` chains, tolerates hostile getters, and accepts only the exact expected constraint for each operation.
- Async/data integrity: queue retry/recovery and canonical run reconciliation; Artifact generation ownership/revision CAS; stale generations cannot overwrite manual/new generations; deterministic project stage transitions.
- Evidence/output honesty: 11 deterministic rules, provider discrepancy confidence downgrade, generated-evidence invocation linkage, fixed rule failure codes, prompt/reference/number/Markdown validation, immutable Artifact revisions, and canonical report/export projections. Diagnostic reads now bind evidence and metadata to the Finding's frozen `last_seen_in_run_id`; lookup paths reject cross-run/cross-project leakage and preserve the exact diagnostic manifest that produced the Finding.
- Optional Finding summaries: non-en/zh summaries use a strict bounded OpenAI client, an explicit feature flag, a persisted per-run eight-call budget that survives retries, abort propagation, fixed failure classifications and persisted invocation health. Once worker shutdown starts, no new summary request can be issued.
- Artifact bounds: single-Artifact DTO transport is capped at 16 MiB; prompt and envelope collections have explicit count/size limits; manual and LLM-produced content share a 40,000-character budget. Text and compact-serialized JSON are checked in the contract, HTTP route, service defense, Studio UI and LLM client, including a direct-service test proving oversized content fails before database access.
- Delivery-locale implementation: the runtime parser and PostgreSQL migration implement the RFC 5646 structural grammar (including extlang, script, region, variants, extensions, private use and grandfathered tags), reject duplicate variants/singletons case-insensitively and enforce a 255-character protocol ceiling. Report export derives the locale from the current draft during the export click, eliminating the blur/router race; clearing the field removes the query override and restores the project default. The older authority OpenAPI/schema locale limits remain an explicit Owner-ratification gate below and are not represented here as already reconciled.
- Migration progress: every ordered file from `0001` through `0009` projects its own exact `app.schema_migration_version`; a real PostgreSQL integration applies `0001`–`0004`, disconnects/reconnects, verifies the stable interruption point, and resumes through the latest migration. This prevents an early migration from falsely claiming a later schema version.
- Job compatibility: newly queued jobs persist contract `2026-07-18`; worker execution and recovery accept only the exact canonical current form or the one explicit canonical legacy form, rejecting malformed/coerced candidates instead of silently executing them.
- Storage/export: local and Supabase private backends, bounded signing/listing, complete keyset pagination, post-upload rollback cleanup, daily fail-closed orphan sweep, and exact canonical object-reference checks across all application writers. The client export reader now filters hidden findings before budgeting, reads only visible-reachable evidence and ready/current Artifact revisions, gives internal finding/evidence history an independent 100,000-row safety bound, and never charges non-archive edges as archive items. JSON and manifest files use compact encoding; the STORE ZIP writer plans the exact archive before one final allocation, enforces all ZIP32 count/name/size/offset/central-directory bounds, and maps every structural/archive limit to the stable export-limit error.
- Privacy/observability: request/worker/rule/Crawl failures and production database CLI top-level failures log or persist stable codes only; customer/model/provider error text is not evaluated or propagated; telemetry and export allowlists are covered by sentinel scans. The secret scanner now ignores ephemeral `.next-e2e-*` runtime directories and tolerates transient `ENOENT` races during tree walks instead of crashing the verification gate. Schema smoke also removes the database password from `psql` argv, uses a mode-0600 temporary `PGPASSFILE`, and removes it after the child exits.
- Product UI: EN/zh-CN parity, explicit permission/partial/degraded/retry states, project-scoped routing, responsive alternatives, accessibility coverage, and real/mock E2E teardown isolation. A successful finding confirmation explicitly refetches the diagnosis list on mutation success so the real vertical chain surfaces `Confirmed` and the created Action deterministically in the same screen session. Report printing hides only the shell chrome through stable data attributes, and locale export/reset behavior is covered in Chromium. The final canonical RelayOps visual gate covers Overview, Sources, Studio and Report at 1920px, 1440px and 390px with 12 deterministic snapshots verified across independent fresh databases; the broader isolated audit still reports zero failed responses, console errors or document overflow after the CSP correction.
- Final confidence pass: full-result fixtures now include the robots observation required for an honest complete crawl; project-seeding E2E fixtures use stable-hashed public IP literals so the SSRF path stays exercised without live DNS, including distinct deterministic origins for the two-tab isolation case; real browser verticals fail closed unless their disposable pg-boss database starts empty, assert an exact `Completed` result and reject structured worker-shutdown failures; worker-readiness subprocess coverage inherits the parent PostgreSQL environment, budgets its outer deadline beyond the acquisition path and reports only stable error codes; provider metric accounting lives in a separately testable pure module so unit coverage includes meaningful behavior instead of runner bootstrap branches.
- Deployment truth: the approved production topology is Vercel Web + Supabase Auth/PostgreSQL/Storage + one Railway Hobby worker. Committed `railway.json` selects `Dockerfile.worker` and pins its start command; `NEXT_PUBLIC_BASE_PATH` stays unset and Render is not part of this release.

## AC-001–AC-048 evidence matrix

“Passed” below means the code-closable/local acceptance evidence is green. Hosted live proof remains a separate launch gate even where deterministic provider fixtures satisfy the AC locally.

| AC | Local status | Primary evidence |
| --- | --- | --- |
| AC-001 | Passed | Frozen-spec verifier: 26 operations / 5 async / 28 tables / 11 rules. |
| AC-002 | Passed | Redocly lint and exact regenerated OpenAPI TypeScript diff. |
| AC-003 | Passed | PostgreSQL 16 migration twice; 28 tables / 22 indexes / 28 triggers. |
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
| AC-020 | In progress — hosted proof pending | DataForSEO real adapter/queue/snapshot/vendor-observation tests cover enabled behavior, row caps, provider status codes and the disabled no-network path; production collection evidence is required before release. |
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
| AC-032 | Passed | LLM envelope/prompt allowlist, collection/size/deadline caps, shared 40,000-character content budget and secret-sentinel tests. |
| AC-033 | Passed | Evidence/reference/number forgery, active-content/HTML/script/URI, bounded metadata and missing-section validators. |
| AC-034 | Passed | Artifact stale base revision, identical hash+format no-op, format-sensitive revision, direct-service content-budget defense and ready→draft edit tests. |
| AC-035 | Passed locally; authority ratification pending | Output locale default/override, same-click export, blank-reset and UI-locale independence tests; runtime/DB/app OpenAPI/manifest validation covers RFC 5646 structure with a 255-character ceiling. The older authority machine-contract representation remains launch gate 1 below. |
| AC-036 | Passed | Canonical report/list projection integration and mapper tests. |
| AC-037 | Passed | Service bundle manifest schema, file hashes/counts/snapshot/ruleset lineage, full pagination, mapped evidence preflight, compact serialization, exact pre-allocation STORE sizing and ZIP32 boundary tests. |
| AC-038 | Passed | Client bundle redaction excludes observations, internal/ignored/draft/credential content at the read/budget layer; only visible-reachable evidence and ready/current Artifact revisions are materialized. |
| AC-039 | Passed locally | Project-scoped 900-second signer, exact 30-day signing cutoff, regeneration tests, application-owned export-byte retention, all-writer reference locking, independent per-kind 100,000-object/list safety boundaries, and the final local sweep/recovery verification; production private-bucket permissions, object-count alerting and live sweep evidence remain pending. |
| AC-040 | Passed | Secret scan plus logger, telemetry, export, rule and Crawl sentinel tests. |
| AC-041 | Passed | Transient/permanent maps, heartbeat/retry exhaustion, recovery and terminal-redelivery idempotency tests. |
| AC-042 | Passed | 28 real responsive page/viewport checks, the full B2C browser main chain at 390px with document-overflow assertions on every key screen, plus the accessible mobile CSV alternative. The final shared-worktree rerun passed. |
| AC-043 | Passed | Axe, contrast, non-colour status and reduced-motion checks, plus real keyboard activation across diagnosis/navigation/ready/export and evidence Enter/Escape focus restoration. The final shared-worktree rerun passed. |
| AC-044 | Passed locally | Real browser B2B chain: page create; Context + CSV through Next; `collect.csv`, diagnostic, template Artifact and service export through pg-boss workers; real PostgreSQL/local-blob persistence; ZIP bytes verified. The diagnostic completed all 11 rules with zero skipped/inconclusive results. Crawl/GSC/GA4 are deterministic offline snapshots; live providers and Owner walkthrough remain pending. |
| AC-045 | Passed locally | The same real chain runs as a B2C Ecommerce purchase fixture at 390px through the client report and client bundle, with ready deliverable and ZIP bytes verified. The diagnostic completed all 11 rules with zero skipped/inconclusive results. Crawl/GSC/GA4 are deterministic offline snapshots; live providers and Owner walkthrough remain pending. |
| AC-046 | Passed | Mock browser permission/rate-limit/partial/degraded/error/retry states. |
| AC-047 | Local/CI passed; production pending | Actual loopback restore with matching PostgreSQL 16 client binaries matched 28-table counts and canonical/integrity hashes and proved target/dump/credential cleanup; production Supabase PITR plus Storage-byte recovery requires Owner evidence. |
| AC-048 | Passed | Vendor manifest hashes current and legacy repository baseline unchanged. |

## External / Owner-gated launch checklist

These are the only known remaining release gates. They require external authority, credentials, production-like infrastructure, or business judgment and cannot be truthfully fabricated from local code:

1. Reconcile and have the Owner ratify the authority machine contracts before release freeze. The prose contract uses API/job version `2026-07-18`, while the authority schema still contains product default `0.2.0`; the authority migration view stops at `0006` while the application is at `0009`; authority `LocaleCode` remains `maxLength: 35` with a simplified pattern while the prose permits arbitrary valid BCP 47 and the application uses a 255-character structural grammar; and the application OpenAPI adds discriminator mappings absent from the authority OpenAPI. Record the chosen canonical representation, refresh the authority hashes, and rerun the spec lock rather than silently guessing which machine file should win.
2. Freeze this worktree and deploy **the same immutable SHA** to the approved Vercel web and Railway Hobby worker. The production Supabase backup, restore verification and additive `0001`–`0009` migration are complete. If any release predating canonical CSV `request_payload.sourceConnectionId` was ever deployed, first run the active-CSV audit in `docs/RUNBOOK.md` and drain/terminalize or separately migrate every matching legacy run.
3. Verify hosted `/api/mvp/health/version` reports that exact SHA on web and worker logs, and hosted `/api/mvp/health/ready` returns 200 only with DB, pg-boss schema and a live worker session lease.
4. Complete real Supabase Auth browser/session/callback proof on the deployed origin.
5. Exercise live Google OAuth, GSC property selection/sync and GA4 property/key-event sync with Owner-approved accounts; retain sanitized evidence without tokens or customer payloads.
6. Exercise one cost-capped hosted DataForSEO collection from Sources and retain sanitized evidence for the `collect.dataforseo` run, immutable snapshot, non-secret provider usage and vendor-grade observations. Confirm login/password exist only on Railway and no provider body or Authorization appears in logs.
7. Exercise the Railway worker's selected production OpenAI endpoint: direct OpenAI, or a separately reviewed all-or-nothing Azure manual configuration. Verify both structured-LLM Artifact generation and optional Finding summaries, with log/telemetry review.
8. Confirm both Supabase Storage buckets are private, grant worker list/delete access, prove each application-owned object kind stays at or below the explicit 100,000-object operational boundary (with alerting before the limit), validate aggregate retention-sweep evidence, and validate signed downloads from the deployed web service.
9. Perform the production recovery exercise described in `docs/RESTORE-DRILL.md`: Supabase PITR into an isolated project plus separate private Storage object-count/sample-byte-checksum recovery evidence and Owner sign-off.
10. Have the business Owner walk through EN and zh-CN B2B and B2C outputs, including evidence, priority, Action, Artifact and both bundle types, and explicitly approve pilot quality.

Until all ten are complete, describe the state as **“local implementation and acceptance gates passed; authority/hosted/Owner launch gates pending,”** not “production-ready” or “pilot-ready.”

## Safety notes for the next operator

- Never run database-backed tests against a hosted database. Use an explicit loopback disposable name accepted by `packages/db/src/test-database-safety.ts`.
- Give real database-backed Playwright verticals a fresh dedicated database. Their preflight intentionally refuses any database whose `pgboss.job` table already contains a job, preventing stale test jobs from starving or reordering the real chain.
- Do not infer or document what `.env.local` points to. Final tests supplied explicit isolated environment values and the safety guards fail closed.
- Run restore drills with client binaries matching the source PostgreSQL server major (for this baseline, `RESTORE_DRILL_PG_BIN=/opt/homebrew/opt/postgresql@16/bin`); newer `pg_dump` output is not assumed to be backward compatible with PostgreSQL 16.
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
