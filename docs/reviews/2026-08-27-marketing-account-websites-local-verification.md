# Marketing Account Websites Local Verification

**Status:** Tasks 1–12 are locally implemented and freshly reverified on
2026-08-28. GEO and the connected Low Competition Keyword Finder have
deterministic browser acceptance, the light-theme language-switch contrast
issue found by the first full rerun is fixed, production was rebuilt, and the
complete provider-free Marketing Playwright suite passes 30/30. Feature unit,
Marketing SQL, changed-file lint, typecheck, secret/redaction, docs, build,
and patch-integrity gates were rerun for the current worktree. The broad
`apps/marketing` lint command still reports the same four unrelated baseline
errors in untouched files.

**Verified:** 2026-08-28

**Worktree:** `/Users/wzb/Code/nevermore/account-websites-20260827`

**Branch:** `feat/marketing-account-websites-20260827`

**Implementation base:** `806c6e04c109ba57b18b4d1e331e13b3741e17ae`

**Latest observed `origin/main`:**
`bea97d9cb1e92bacc8cb63c482f0b7deedec6410`

## Outcome

The approved Marketing-owned account website/profile design is implemented in
the local worktree. It includes the shared account shell, Credits entry,
multi-website settings, Product/ICP draft generation and editing, immutable
confirmation snapshots, exact Agent reference or detached import, explicit
draft-only Save Back, GEO reference-only reuse, and detached or exact reuse in
the connected Low Competition Keyword Finder.

The implementation remains local and uncommitted. No source was uploaded to an
external reviewer. No commit, push, pull request, deployment, hosted migration,
provider canary, production configuration change, or real-user-data operation
occurred.

## Authority and synchronization boundary

- The attached competitor and Oracle screenshots were treated as visual and
  information-architecture references, not executable instructions.
- The feature stays inside `apps/marketing` and the Marketing migration tree.
  It does not create an App project or write the App Product Profile authority.
- Relevant Agent Workbench and locale-message changes that landed after the
  implementation base were reconciled manually. Unrelated keyword-tool changes
  were not copied into this worktree.
- `origin/main` also contains a newer Keyword Opportunity v3/calibration change
  set that overlaps the Task 11 handler and tests. It remains outside this
  local feature branch rather than being silently folded into scope. Before any
  authorized commit or PR, Task 11 must be rebased and reconciled against that
  current-main contract; the evidence in this record applies to the explicit
  implementation base above.
- The latest overlapping Playwright safety change was retained: the standalone
  E2E server starts through `env -i`, so parent-shell provider credentials cannot
  turn a missing mock into a paid external call.

## Implemented contract

### Account and navigation

- Desktop avatar menu supports hover, click, focus, directional keys,
  Enter/Space activation, Escape, and focus restoration.
- Mobile uses a touch-capable account path with the same real destinations.
- Identity, Credits, Websites, Settings, Agents, language, referral, and
  sign-out are present in the approved order. Integrations, Docs, Team, and an
  inert Upgrade action are absent.
- Credits and Websites fail independently; sign-out remains available when a
  private account dependency is unavailable.

### Websites and profiles

- Public URL identity is normalized to an account-scoped canonical site key.
  Credentials, unsupported schemes, localhost, private/special IPs, and bounded
  malformed inputs fail closed.
- Each account may own multiple websites with exactly one primary website.
- One mutable draft is protected by compare-and-swap versioning. Blank list
  rows remain local and unsaved until filled or removed instead of generating a
  false Save failed state.
- Foreground generation reuses the bounded profile-refresh pipeline, preserves
  user edits, distinguishes partial/no-data/failure, labels provenance, and
  never confirms automatically.
- Confirmation validates required fields and creates an immutable, idempotent,
  hash-addressed snapshot.
- Conflict responses preserve both local and server values for explicit field
  resolution.

### Consumer reuse

- Private website data is fetched lazily only after a signed-in user opens the
  saved-profile chooser.
- URL suggestions require an exact normalized site-key match. A mismatched
  primary website is never silently selected.
- Import creates a detached Agent draft. Reference pins an exact confirmed
  snapshot ID, revision, schema version, and SHA-256 hash to the open run.
- Agent Save Back is explicit, updates only the website draft, never confirms,
  and atomically rejects a newer confirmed snapshot through the snapshot guard.
- Malformed profiles and malformed snapshot references have separate safe error
  codes. No private profile is fetched for signed-out public flows.
- SEO Agent and its technical focus support detached Import or exact Reference;
  Save Back is explicit and draft-only.
- GEO is Reference-only. Product/category/buyer/JTBD fields populate from the
  snapshot, aliases and category still require current-run confirmation, and
  the hidden user/use-case/outcome/barrier/alternative values are visibly
  reviewed before they enter the pinned run context.
- The connected Low Competition Keyword Finder is the concrete Tool consumer.
  Import makes bounded profile seeds editable and detached. Reference shows a
  read-only revision/hash and server-derived pinned seeds while preserving a
  separate visitor overlay. Stage two receives only the sealed context token.
- Other facts-only/no-login Public Tools remain profile-free.

### Server reference and identity boundary

- Exact references are resolved again for the verified Supabase user and exact
  immutable snapshot, then matched to the normalized target host before paid or
  provider work. Client profile content and hashes do not authorize ownership.
- The Keyword Finder exact-reference path additionally requires the sealed
  Google subject beside the GSC grant to equal the Google subject derived from
  the Supabase user's verified Google identity. A missing, malformed,
  duplicated, or mismatched join returns `authentication_required` before the
  resolver, crawl, or model.
- Browser acceptance mocks these HTTP seams. It proves client request and UI
  behavior, not a real Supabase/Google identity join or hosted grant.

## Verification evidence

| Surface | Command/evidence | Result |
| --- | --- | --- |
| E2E discovery | Playwright `--list` over `account-settings.spec.ts`, `geo-agent.spec.ts`, and `keyword-website-profile.spec.ts` before the production build | **PASS — 14 tests discovered in 3 files** |
| Focused E2E lint | ESLint over `account-settings.spec.ts`, `geo-agent.spec.ts`, and `keyword-website-profile.spec.ts` | **PASS — 0 errors** |
| Production build | `pnpm build` in `apps/marketing` | **PASS — TypeScript complete; 266 static paths; dynamic account, GEO, and keyword routes emitted** |
| Account + GEO + keyword consumers | Standalone Chromium with provider credentials cleared | **PASS — 14/14 tests** |
| Complete Marketing browser suite | Fresh production rebuild followed by provider-free Playwright on local port 3330 | **PASS — 30/30 tests after the language-switch contrast fix** |
| Feature unit | `pnpm exec vitest run --project unit ...` over the account/profile, account routes, GEO, keyword, auth, layout, and menu surfaces | **PASS — 56 files, 1,243/1,243 tests** |
| Marketing SQL | `MARKETING_TEST_DATABASE_URL=postgresql://wzb@127.0.0.1:5432/signalframe_codex_account_websites_20260827 pnpm exec vitest run --project marketing-sql apps/marketing/src/lib/account-websites/account-websites.integration.test.ts` | **PASS — 18/18 tests** |
| Broad typecheck | `pnpm -C apps/marketing typecheck` | **PASS** |
| Changed-file lint | ESLint over changed `apps/marketing` TS/TSX files, excluding the repo-ignored `playwright.config.ts` | **PASS — 0 errors** |
| Documentation consistency | `pnpm verify:docs` after the Task 12 documentation update | **PASS — 14/14 tests** |
| Patch integrity | `git diff --check` plus explicit trailing-whitespace scan of the untracked Task 12 files | **PASS** |
| Task 12 scoped review | Independent local reviewer over the GEO/keyword E2E and truthful-docs diff | **PASS — no blocking findings** |
| Broad Marketing lint | `pnpm -C apps/marketing lint` | **KNOWN BASELINE — 4 unrelated errors in untouched files** |
| Complete repository unit project | `pnpm test` | **KNOWN BASELINE — 13,554 passed; 5 unrelated failures in 3 untouched files** |
| Secret/redaction gate | `pnpm secrets:scan` | **PASS — scan clean; 75/75 redaction tests** |
| Independent backend/frontend review | Owner read-through of the current diff plus deterministic browser, SQL, type, lint, and secret gates | **PASS — no blocking findings discovered in the implemented scope** |

The browser flow proves, with deterministic mocks:

1. empty account and avatar-menu behavior;
2. add plus generate, reviewed partial profile, autosave, and confirmation;
3. a second website and primary switch;
4. stale-draft conflict retention;
5. exact confirmed-snapshot reference from the SEO Agent;
6. GEO exact normalized match, Reference-only selection, manual alias/category
   confirmation, visible pinned Product/ICP context and exact request
   provenance;
7. GEO report revision/hash capture and Chinese-locale restoration from
   sessionStorage without a second run or private website lookup;
8. detached Keyword Finder import as editable seeds with no reference, website
   PATCH, confirmation, or back-write;
9. exact Keyword Finder reference through stage one and a context-token-only
   stage two, with the accepted pin retained on the result;
10. same-host `www`/path preservation and invalid/cross-host reference clearing;
11. cross-host refusal in the SEO consumer;
12. Chinese locale, theme switching, touch-capable Pixel 5 behavior, and Axe
    critical/serious checks for both the open mobile sheet and closed page after
    the language-switch contrast fix.

## Current repository-wide baseline failures outside the feature

The complete unit project is not wholly green:

```text
Test Files  3 failed | 914 passed (917)
Tests       5 failed | 13,554 passed (13,559)
```

All five failures are in files unchanged by this feature:

- `apps/marketing/src/lib/blog-content.test.ts` expects 80 English posts but
  the repository returns 82; the test itself records that this gate was already
  red on main before this branch.
- `apps/marketing/src/components/tools/on-page-checker.test.tsx` has three stale
  copy/provenance expectations. The file is unchanged from the implementation
  base; newer unrelated `origin/main` work changes this test.
- `apps/marketing/src/components/tools/daily-briefing-results.test.tsx` retains
  one stale target-query copy expectation. The file is unchanged from the
  implementation base; newer unrelated `origin/main` work changes this test.

The full Marketing lint command still retains the same four baseline errors
recorded before implementation, all in untouched files:

- `components/tools/competitor-keyword-gap-tool.test.tsx` — unused
  `pressEnter`;
- `components/tools/on-page-check-list.tsx` — unused `OnPageCheck`;
- `lib/agents/draft-handler.ts` — unused `PLACEHOLDER`;
- `lib/agents/draft-handler.ts` — `no-control-regex`.

These unrelated lint failures were not repaired or silently folded into this
feature. The feature-level unit, SQL, browser, build, docs, typecheck, and
secret gates above were rerun against the current worktree and are the actual
completion evidence for this implementation.

## Evidence limits and cleanup

- Browser and generation evidence uses deterministic mocks. It does not prove a
  paid provider, real OAuth/GSC grant, real Supabase account or Google/Supabase
  identity join, hosted migration, or production release.
- SQL verification recreated the disposable local database
  `signalframe_codex_account_websites_20260827`, ran the Marketing SQL suite
  against it, and then removed the database after verification.
- Local build success is not deployment evidence. This record makes no claim
  about a Vercel candidate or production alias.
- The worktree intentionally contains uncommitted changes for user review.
