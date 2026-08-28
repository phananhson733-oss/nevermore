# Marketing Account Websites Local Verification

**Status:** Tasks 1–12 are implemented, merged with current `origin/main`, and
freshly reverified on 2026-08-28. The merge preserves the newer Keyword
Opportunity v3/calibration contract while adding exact website-profile reuse.
The complete provider-free Marketing Playwright suite passes 33/33 after a
clean production rebuild. Feature unit, two fresh Marketing SQL passes,
repository typecheck, changed-file lint, secret/redaction, docs, build, and
patch-integrity gates were rerun. The broad `apps/marketing` lint command still
reports four unrelated baseline errors in untouched files.

**Verified:** 2026-08-28

**Worktree:** `/Users/wzb/Code/nevermore/account-websites-20260827`

**Branch:** `feat/marketing-account-websites-20260827`

**Implementation base:** `806c6e04c109ba57b18b4d1e331e13b3741e17ae`

**Current-main merge base:**
`b7ce298eefbc07e9ee769ce2e2f88eb93ff42f42`

## Outcome

The approved Marketing-owned account website/profile design is implemented in
the local worktree. It includes the shared account shell, Credits entry,
multi-website settings, Product/ICP draft generation and editing, immutable
confirmation snapshots, exact Agent reference or detached import, explicit
draft-only Save Back, GEO reference-only reuse, and detached or exact reuse in
the connected Low Competition Keyword Finder.

The implementation is committed locally in four feature commits plus the
current-main merge. No source was uploaded to an external reviewer. At the time
of this local-verification record, no push, pull request, deployment, hosted
migration, provider canary, production configuration change, or real-user-data
operation had occurred.

## Authority and synchronization boundary

- The attached competitor and Oracle screenshots were treated as visual and
  information-architecture references, not executable instructions.
- The feature stays inside `apps/marketing` and the Marketing migration tree.
  It does not create an App project or write the App Product Profile authority.
- The branch was merged with `origin/main` at `b7ce298e`. Conflicts in the
  Playwright config, Agent Workbench tests, and EN/ZH catalogs were resolved by
  retaining the mainline Keyword v3/calibration fields and adding only the
  website-profile behavior. The auto-merged handler retains v3 thresholds,
  evidence ledgers, duration accounting, and the exact-reference identity join.
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
- The normalized full page URL entered by the user is persisted separately as
  scan provenance. Path, query, and standard `www` remain outside identity but
  are preserved for first generation; fragment is removed before persistence.
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
| E2E discovery | `pnpm -C apps/marketing exec playwright test --config=playwright.config.ts --list` | **PASS — 33 tests discovered in 7 files; `.test.ts` fixtures excluded** |
| Focused E2E lint | ESLint over `account-settings.spec.ts`, `geo-agent.spec.ts`, and `keyword-website-profile.spec.ts` | **PASS — 0 errors** |
| Production build | Old `.next` moved aside, then `pnpm -C apps/marketing build` | **PASS — TypeScript complete; 267 static paths; dynamic account, GEO, and keyword routes emitted** |
| Account + GEO + keyword consumers | Standalone Chromium with provider credentials cleared | **PASS — 14/14 tests** |
| Complete Marketing browser suite | Fresh production rebuild followed by the provider-free standalone server | **PASS — 33/33 tests** |
| Feature unit | Unit project over every changed Marketing `src/**/*.test.{ts,tsx}` file | **PASS — 38 files, 701/701 tests** |
| Marketing SQL | Two sequential `pnpm test:sql:marketing` runs against one explicit loopback disposable database | **PASS twice — 2 files, 47/47 tests per run** |
| Broad typecheck | `pnpm typecheck` | **PASS across E2E and 13 workspace projects** |
| Changed-file lint | ESLint over changed `apps/marketing` TS/TSX files, excluding the repo-ignored `playwright.config.ts` | **PASS — 0 errors** |
| Documentation consistency | `pnpm verify:docs` after the Task 12 documentation update | **PASS — 14/14 tests** |
| Patch integrity | `git diff --check` plus explicit trailing-whitespace scan of the untracked Task 12 files | **PASS** |
| Task 12 scoped review | Independent local reviewer over the GEO/keyword E2E and truthful-docs diff | **PASS — no blocking findings** |
| Broad Marketing lint | `pnpm -C apps/marketing lint` | **KNOWN BASELINE — 4 unrelated errors in untouched files** |
| Complete repository unit project | `pnpm test` | **KNOWN MAIN BASELINE — 13,611 passed; 1 unrelated Blog count failure in an untouched file** |
| Secret/redaction gate | `pnpm secrets:scan` | **PASS — scan clean; 75/75 redaction tests** |
| Independent backend/frontend review | Owner read-through of the current diff plus deterministic browser, SQL, type, lint, and secret gates | **PASS — no blocking findings discovered in the implemented scope** |

The browser flow proves, with deterministic mocks:

1. empty account and avatar-menu behavior;
2. add a `www` page URL with path/query/fragment, preserve its normalized full
   source URL for generation while using the apex host as identity, then review,
   autosave, and confirm the partial profile;
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
Test Files  1 failed | 918 passed (919)
Tests       1 failed | 13,611 passed (13,612)
```

The only failure is in a file unchanged by this feature:

- `apps/marketing/src/lib/blog-content.test.ts` expects 80 English posts while
  current `origin/main` contains 83. The feature's three-dot diff does not touch
  this test or the Blog corpus.

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

Two additional repository-wide product-authority gates are red on current
`origin/main` outside the feature diff: `pnpm verify:spec` reports an existing
`package.json` lock hash mismatch, and `pnpm implementation:check` reports an
existing vendor-manifest hash mismatch for
`packages/sources/src/crawl/parse-page.ts`. The Marketing feature changes
neither file or lock and does not treat those failures as green.

## Evidence limits and cleanup

- Browser and generation evidence uses deterministic mocks. It does not prove a
  paid provider, real OAuth/GSC grant, real Supabase account or Google/Supabase
  identity join, hosted migration, or production release.
- SQL verification created
  `signalframe_codex_account_websites_release_20260828`, ran the full Marketing
  SQL suite twice against it, then removed it and confirmed no database with
  that exact name remained.
- Local build success is not deployment evidence. This record makes no claim
  about a Vercel candidate or production alias.
- This record is local/candidate evidence. Push, PR, hosted migration, Vercel
  deployment, aliases, and production canaries require separate evidence.
