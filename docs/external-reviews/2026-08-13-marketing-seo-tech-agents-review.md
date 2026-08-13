# Marketing SEO / Tech Agents — external review and verification record

- Date: 2026-08-13
- Scope: `gengrowth.ai` marketing application only (`apps/marketing`)
- Excluded product: `app.gengrowth.ai`
- Worktree: `/Users/wzb/.config/superpowers/worktrees/signalframe-mvp-app/marketing-seo-tech-agents-v1-20260812`
- Branch: `codex/marketing-seo-tech-agents-v1-20260812`
- Implementation baseline: `e284f32efa34abc6da7a2e93342158db161fb8f6`
- External review: [ChatGPT Pro conversation](https://chatgpt.com/c/6a7c9b85-2d44-83e8-b5fc-81462dda717e)

## Authority and review boundary

The executable authority for this implementation is
`docs/plans/2026-08-12-marketing-seo-tech-agents-mvp.md`, followed by current
source and executable tests. The approved Artifact is a visual and interaction
reference; it is not proof of authentication, crawling, persistence, provider
access, or production behavior.

ChatGPT Pro was used as a secondary, advisory reviewer because the user
explicitly authorized it. Codex independently reproduced every accepted
finding and reran the local gates. The external reviewer had no repository,
database, browser profile, credential, Supabase, Vercel, or production access.

## Material supplied to ChatGPT Pro

A sanitized review archive was prepared locally but was **not transmitted**
because the in-app browser file chooser could not complete through the
supported upload flow:

- local archive: `/tmp/gengrowth-seo-tech-agents-review.XwTvt1/gengrowth-seo-tech-agents-review.zip`
- size: `574426` bytes
- entries: `152`
- SHA-256: `d05391f9ba9813d9ea4e39fdee8e7f04395e49e2c2dee4d80a4ac52584dd40c0`
- local `unzip -tq`: no errors

The material actually transmitted was a pasted text attachment containing
`69,628` characters and `2,094` lines from these twelve files:

1. `docs/external-reviews/2026-08-12-marketing-seo-tech-agents-task.md`
2. `apps/marketing/src/lib/agents/audit-handler.ts`
3. `apps/marketing/src/lib/agents/audit-contract.ts`
4. `apps/marketing/src/lib/tools/seo-audit-handler.ts`
5. `apps/marketing/src/components/agents/agent-intent.ts`
6. `apps/marketing/src/components/agents/agent-workbench.tsx`
7. `apps/marketing/src/components/agents/agent-result-helpers.ts`
8. `apps/marketing/src/components/auth/google-sign-in-button.tsx`
9. `apps/marketing/src/app/api/tools/seo-audit/route.ts`
10. `apps/marketing/src/app/api/tools/internal-link-audit/route.ts`
11. `apps/marketing/src/app/api/tools/legacy-audit-routes.test.ts`
12. `apps/marketing/src/components/agents/agent-workbench.test.tsx`

The reviewer correctly reported that it had not received the ZIP and could not
verify the archive metadata, other source files, or local command results.

## External findings and dispositions

The initial external verdict was `FAIL`. The two generated candidate responses
had partly overlapping findings; the union was independently assessed and
resolved as follows.

| Finding | Disposition | Implemented contract |
| --- | --- | --- |
| P1: nested success objects could carry unapproved fields | Resolved | `coverage`, `siteResources`, records, observations, and value entries are reconstructed field by field before serialization. Adversarial sentinels for scores, severity, raw pages/HTML, and debug data are excluded. |
| P1: non-2xx upstream responses were returned directly | Resolved | Errors use a 4 KiB bounded JSON reader, exact `{error:{code}}` shape, code/status allowlist, and safe retry/rate-limit header allowlist. Unknown, oversized, non-JSON, extra-field, or mismatched responses become `502 audit_response_invalid`. |
| P1: SEO state/result/resume data could survive a prop change into Tech | Resolved | The workbench is keyed by Agent, pending intent keys are Agent-specific, displayed success envelopes must match the current Agent, and operation-scoped cancellation prevents stale completion. |
| P2: unavailable collection evidence could display as numeric zero | Resolved | The helper returns `null` for unavailable coverage and the EN/ZH UI renders `Unavailable` / `不可用`. |
| P2: manual, resume, and focus requests lacked complete cancellation | Resolved | Every operation owns an `AbortController`; replacement, unmount, Agent remount, and dialog dismissal abort stale work. Same-render double-submit and dialog-close races have direct tests. |
| P2: storage failure could open an unrecoverable login flow | Resolved | Storage failure returns a truthful `intent_unavailable` error and does not open the sign-in dialog or submit an audit. |
| P2: cache eligibility checked only the target URL | Resolved | A hit requires a canonical capture time, the complete current `seo_audit.sitewide.v3` payload contract, and exact normalized target URL. Old, wrong-scope, malformed, or same-host/different-path entries are misses before target quota and lead to a fresh crawl. |
| P2: all errors set URL `aria-invalid` | Resolved | Only `invalid_url`, `invalid_request`, and `payload_too_large` mark the input invalid. Authentication, rate-limit, quota, crawl, and service errors remain described alerts. |
| P2: authentication service failure was represented as signed out | Resolved | Server authentication is explicitly `authenticated`, `unauthenticated`, or `unavailable`. Only the second returns `401 auth_required`; service/configuration failures return `503 auth_unavailable` before body read or delegation. Client session preflight and One Tap fail closed on unavailable state. |
| P2: cache timestamps/provenance combinations were too permissive | Resolved | `completedAt`, `scannedAt`, and hit `capturedAt` require canonical `Date#toISOString()` form. Hit requires a time; miss requires `null`. Invalid combinations fail closed. |
| P1: acquiring `sessionStorage` itself could throw before the existing storage guards ran | Resolved in final whole-diff review | A safe accessor catches getter-level `SecurityError`. The homepage still navigates when storage is unavailable; signed-in Agent runs still execute; signed-out runs show `intent_unavailable` only when a resumable handoff is required. |
| P2: homepage cards said every run was a live crawl even when a completed-crawl cache could be used | Resolved in final whole-diff review | EN/ZH now say `Bounded crawl evidence` / `有边界的抓取证据`, covering both a fresh capture and a validated completed-crawl cache. |
| P2: shape-valid but relationally contradictory records could reach the UI | Resolved in final whole-diff review | One exported public runtime guard now enforces `affected === observations.length`, `affected <= tested`, `observed => affected > 0`, and `not_observed/unverified => affected === 0`; the Agent contract reuses it and fails closed. |

After receiving a concise remediation and fresh-local-evidence report, ChatGPT
Pro revised its advisory verdict to:

> **PASS** — Remaining P0: none; Remaining P1: none; Remaining P2: none.

It explicitly retained these items as unverified rather than treating them as
code blockers: the updated source and ZIP were not attached; the archive and
diff were not directly inspected; the reported tests were not executed by
ChatGPT; and no real authenticated Supabase session, live crawl, production
deployment, or production configuration was exercised.

The three final whole-diff findings above were discovered after that first
advisory `PASS`. After they were fixed and fresh local evidence was reported,
ChatGPT Pro returned a second advisory `PASS` with no remaining P0/P1/P2. It
again stated that the updated source, diff, ZIP, test execution, real
authentication, live crawl, and production environment remained unverified by
ChatGPT itself.

## Independent local review

The first reconciliation passes cleared the external candidate findings. A
subsequent whole-diff review then found the getter-level storage failure, the
cache-incompatible `live crawl` claim, and missing record relationship checks.
All three were reproduced with failing tests and fixed before completion.

A fresh read-only reviewer then inspected the post-fix whole diff and returned
`PASS`, with no actionable P0/P1/P2. That reviewer directly ran a focused
`10 files / 105 tests` suite and independently checked authentication ordering,
state isolation and cancellation, storage-unavailable behavior, strict cache
and payload boundaries, routes, i18n, accessibility semantics, and active
marketing claims.

Residual coverage limits noted by reviewers:

- no dedicated automated axe/keyboard traversal suite for the header Agents
  menu and sign-in dialog;
- the header sign-in control's session-503 degradation is code-reviewed but
  does not have its own focused component test.

## Fresh local verification

All commands below were executed after the final storage, claim, record,
cache, authentication, and accessibility changes.

| Gate | Result |
| --- | --- |
| `pnpm exec vitest run --project unit apps/marketing/src` | PASS — 103 files, 1245/1245 tests |
| focused public/Agent record-invariant regression set | PASS — 4 files, 123/123 tests |
| focused storage/homepage degradation regression set | PASS — 3 files, 40/40 tests |
| final read-only reviewer focused set | PASS — 10 files, 105/105 tests |
| `pnpm --filter @sf/marketing typecheck` | PASS |
| `pnpm --filter @sf/public-tools typecheck` | PASS |
| `pnpm --filter @sf/marketing lint` | PASS |
| `pnpm --filter @sf/public-tools lint` | PASS |
| `pnpm --filter @sf/marketing build` | PASS — Next 16.2.11, 150/150 static pages, SEO/Tech Agent pages and APIs present |
| `pnpm --filter @sf/marketing test:e2e` | PASS — Chromium 9/9 |
| `pnpm secrets:scan` | PASS — scan plus 75/75 redaction tests |
| `git diff --check` and EN/ZH JSON parsing | PASS |

Production-build runtime checks against `127.0.0.1:4320` with no configured
Supabase environment returned `503 auth_unavailable` and
`Cache-Control: no-store, private` from both new Agent APIs, both legacy audit
APIs, and `/api/auth/session`. This proves the unavailable-auth branch, not the
signed-out or signed-in production branch.

In the in-app browser, the hydrated homepage accepted `example.com` and routed
to the exact SEO Agent with the URL handoff. In the same unavailable-auth
environment, `/agents/seo` showed the localized `auth_unavailable` alert,
opened no sign-in dialog, left `aria-invalid=false`, and stayed on the SEO
Agent URL. The homepage rendered in English by default with one actual `h1`,
one `main`, one URL input, direct `/agents`, `/agents/seo`, and `/agents/tech`
links, and the cache-compatible `Bounded crawl evidence` claim. Earlier
responsive verification found no horizontal overflow (`1434 / 1434`); the
final Playwright run independently passed its responsive Agent checks.

## Capability and release boundary

This local MVP implements two independent, registration-gated marketing Agents
over the existing bounded public-static-HTML crawl. It does not prove or claim:

- a real production login or live authenticated crawl;
- Product/ICP synthesis, country, language, device, page type, or target-query
  confirmation;
- the 77-check roadmap, a global health score, PSI/CrUX, JavaScript rendering,
  GSC/GA4/DataForSEO, or traffic forecasting;
- saved projects/runs in `app.gengrowth.ai`;
- generated patches, repository writes, PR creation, deployment, or automated
  recheck;
- the requested future light theme.

This review record was finalized before Git publication was authorized. The
reviewed implementation performed no manual deployment, database migration,
production setting change, or production customer crawl. Because this document
is itself part of the release commit, publication identity must be verified
from the containing Git commit and its remote ref rather than a self-referential
SHA embedded here.
