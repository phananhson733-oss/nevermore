# Marketing Account Websites Implementation Plan

**Execution status:** Tasks 1–12 are locally implemented and freshly reverified
as of 2026-08-28. The same-day completion audit that reopened GEO and the
signed-in keyword/context Tool consumer is closed for those deterministic
browser paths. The light-theme language-switch contrast issue found by the
first full rerun was fixed, production was rebuilt, and the complete
provider-free Marketing Playwright suite now passes 30/30. Feature unit,
Marketing SQL, changed-file lint, typecheck, docs, build, and secret/redaction
gates were rerun for the current worktree. The broad `apps/marketing` lint
command still retains four unrelated baseline errors in untouched files.
Nothing has been committed, pushed, deployed, or migrated to a hosted database.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Marketing-owned account Settings surface where a signed-in user can manage multiple websites, generate/edit/confirm reusable Product/ICP profiles, and explicitly reuse a confirmed snapshot from SEO/Tech, GEO, and the connected Low Competition Keyword Finder without coupling Marketing to App persistence.

**Architecture:** Keep identity, drafts, immutable snapshots, APIs, and UI inside `apps/marketing` and its Marketing Supabase migration tree. Reuse the current safe profile-refresh pipeline for foreground generation, keep no-login Public Tools profile-free, and add typed adapters rather than coupling Marketing to App Product Profile persistence.

**Tech Stack:** Next.js 16 App Router, React 19, next-intl, Zod, Supabase Auth/admin client, PostgreSQL 15 Marketing migrations, Vitest unit + Marketing SQL, Playwright.

**Permission note:** The user explicitly exempted this task from ChatGPT Pro external review and authorized Codex plus local subagents for local implementation and tests. Do not commit, push, open a PR, deploy, apply a hosted migration, or upload source externally without separate authorization. The commit steps normally required by this planning skill are intentionally replaced with local diff checkpoints.

---

## Task 1: Freeze the shared URL, profile, and reference contracts

**Files:**

- Create: `apps/marketing/src/lib/account-websites/contracts.test.ts`
- Create: `apps/marketing/src/lib/account-websites/contracts.ts`
- Create: `apps/marketing/src/lib/account-websites/agent-profile-bridge.test.ts`
- Create: `apps/marketing/src/lib/account-websites/agent-profile-bridge.ts`
- Modify: `apps/marketing/src/components/agents/agent-profile.ts`
- Test: `apps/marketing/src/components/agents/agent-profile.test.ts`

### Step 1: Write the failing URL identity tests

Pin these cases before implementation:

```ts
expect(normalizeAccountWebsiteUrl("example.com/pricing?utm=x#hero")).toEqual({
  submittedUrl: "https://example.com/pricing?utm=x",
  origin: "https://example.com",
  host: "example.com",
  canonicalSiteKey: "example.com",
});
expect(normalizeAccountWebsiteUrl("https://www.Example.com.")?.canonicalSiteKey)
  .toBe("example.com");
expect(normalizeAccountWebsiteUrl("https://docs.example.com")?.canonicalSiteKey)
  .toBe("docs.example.com");
expect(normalizeAccountWebsiteUrl("https://u:p@example.com")).toBeNull();
```

Also cover default ports, IDN/Punycode, unsupported protocols, overlong input, query retention in `submittedUrl`, and path/query/fragment exclusion from `canonicalSiteKey`.

### Step 2: Run RED

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/account-websites/contracts.test.ts
```

Expected: FAIL because the module does not exist.

### Step 3: Implement the strict reusable profile contract

Add a client-safe contract with these public literals and shapes:

```ts
export const MARKETING_WEBSITE_PROFILE_VERSION =
  "marketing-website-profile.v1" as const;
export const WEBSITE_PROFILE_REFERENCE_VERSION =
  "website-profile-reference.v1" as const;

export interface MarketingWebsiteProfileV1 {
  readonly schemaVersion: typeof MARKETING_WEBSITE_PROFILE_VERSION;
  readonly productName: string;
  readonly oneLinePositioning: string;
  readonly valueProposition: string;
  readonly coreFeatures: readonly string[];
  readonly categories: readonly string[];
  readonly businessModel: string;
  readonly primaryCta: string;
  readonly trustSignals: readonly string[];
  readonly primaryIcp: string;
  readonly buyer: string;
  readonly user: string;
  readonly triggerPain: string;
  readonly icpInterests: readonly string[];
  readonly icpPain: string;
  readonly icpBehavior: string;
  readonly icpPositioning: string;
  readonly jtbd: string;
  readonly useCases: readonly string[];
  readonly outcomes: readonly string[];
  readonly barriers: readonly string[];
  readonly qualificationSignals: readonly string[];
  readonly disqualifiers: readonly string[];
  readonly directCompetitors: readonly string[];
  readonly indirectAlternatives: readonly string[];
  readonly excludedAlternatives: readonly string[];
  readonly firstOutcome: string;
  readonly country: string;
  readonly locale: string;
  readonly fieldProvenance: readonly WebsiteProfileFieldProvenance[];
}

export interface WebsiteProfileReferenceV1 {
  readonly schemaVersion: typeof WEBSITE_PROFILE_REFERENCE_VERSION;
  readonly websiteId: string;
  readonly snapshotId: string;
  readonly snapshotRevision: number;
  readonly profileSchemaVersion: typeof MARKETING_WEBSITE_PROFILE_VERSION;
  readonly profileHash: string;
}
```

Use Zod at API/DB boundaries. Reject unknown keys, invalid UUIDs, malformed canonical timestamps, non-canonical locales, overly long strings/lists, and non-public evidence URLs. Provide:

- `emptyMarketingWebsiteProfile()`;
- `parseMarketingWebsiteProfile()`;
- `isMarketingWebsiteProfileReady()`;
- canonical JSON serialization with stable object-key ordering and array-order preservation;
- authoritative SHA-256 computation in the server store rather than a Node import in client code; a browser-safe Web Crypto consistency check may additionally reject a mismatched private response, but never authorizes ownership or snapshot identity;
- `profileState(draftHash, confirmedHash)`;
- strict parsers for list/detail/reference DTOs.

Do not persist `agent`, `device`, `pageType`, `targetQuery`, `auditScope`, report data, or provider answers.

### Step 4: Implement the Agent bridge under RED tests

The bridge must:

- project a confirmed website profile into an `AgentProfileDraft` plus run-local fields;
- extract reusable fields from an Agent draft without copying run fields;
- convert `AgentProfileRefreshData.fields` to a source-labelled website draft;
- preserve user-edited provenance when applying refresh proposals;
- distinguish detached import from an exact snapshot reference.

Keep existing exports from `agent-profile.ts` source-compatible. Shared types may move into the new contract only when the Agent file re-exports them.

### Step 5: Run GREEN and checkpoint

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/account-websites/contracts.test.ts \
  apps/marketing/src/lib/account-websites/agent-profile-bridge.test.ts \
  apps/marketing/src/components/agents/agent-profile.test.ts
git diff --check
```

Expected: all targeted tests pass. Do not commit.

## Task 2: Add Marketing SQL invariants for identities, drafts, and snapshots

**Files:**

- Create: `apps/marketing/supabase/migrations/0005_account_websites.sql`
- Create: `apps/marketing/src/lib/account-websites/account-websites.integration.test.ts`
- Reuse: `apps/marketing/src/lib/credits/sql-test-harness.ts`

### Step 1: Write the failing Marketing SQL tests

Use the existing harness and create disposable users/sites. Prove:

1. first site becomes primary;
2. same user + same canonical site key is unique;
3. different users may store the same site key;
4. concurrent adds cannot create two primary sites;
5. concurrent primary switches finish with exactly one primary;
6. foreign-user set-primary/save/confirm cannot see the row;
7. draft create uses base version `0`, then CAS increments exactly once;
8. stale CAS changes no row;
9. unchanged draft save is a semantic no-op or a documented version increment, consistently tested;
10. confirmation creates revision 1 and sets the current pointer;
11. identical confirmation reuses the same snapshot;
12. concurrent changed confirmations produce unique monotonic revisions;
13. snapshot update/delete/truncate fail;
14. anon/authenticated/service-role direct writes fail;
15. service-role RPC execution succeeds.

### Step 2: Run RED against a disposable database

Run with an explicit local database:

```bash
createdb signalframe_codex_account_websites_20260827
MARKETING_TEST_DATABASE_URL=postgresql://wzb@127.0.0.1:5432/signalframe_codex_account_websites_20260827 \
  pnpm exec vitest run --project marketing-sql \
  apps/marketing/src/lib/account-websites/account-websites.integration.test.ts
```

Expected: FAIL because migration 0005 and RPCs do not exist.

### Step 3: Implement the migration

Create:

- `marketing_websites`;
- `marketing_website_profile_drafts`;
- `marketing_website_profile_snapshots`.

Required database invariants:

- partial unique index on `(user_id) WHERE is_primary`;
- unique `(user_id, canonical_site_key)`;
- bounded text and JSON payload sizes;
- website/snapshot ownership duplicated where needed for same-statement scoping;
- no hard-delete cascade that can erase immutable history;
- immutable snapshot row and truncate triggers;
- RLS enabled with no browser policies;
- direct writes revoked from anon/authenticated/service_role;
- SECURITY DEFINER RPCs with fixed `search_path` and UTC timezone;
- advisory or row locking around first-primary choice and revision allocation.

RPCs:

```text
marketing_add_website
marketing_set_primary_website
marketing_save_website_profile_draft
marketing_confirm_website_profile
```

Return stable machine-readable states instead of relying on English exception text wherever PostgreSQL permits it.

### Step 4: Run GREEN, idempotency, and checkpoint

Run the SQL suite twice from a freshly rebuilt schema through the harness, then:

```bash
MARKETING_TEST_DATABASE_URL=postgresql://wzb@127.0.0.1:5432/signalframe_codex_account_websites_20260827 \
  pnpm exec vitest run --project marketing-sql \
  apps/marketing/src/lib/account-websites/account-websites.integration.test.ts
git diff --check
```

Expected: all SQL tests pass. Keep the disposable database until Task 8, then drop it explicitly. Do not apply this migration to hosted Supabase.

## Task 3: Build the server store and authenticated account APIs

**Files:**

- Create: `apps/marketing/src/lib/account-websites/store.test.ts`
- Create: `apps/marketing/src/lib/account-websites/store.ts`
- Create: `apps/marketing/src/app/api/account/websites/route.test.ts`
- Create: `apps/marketing/src/app/api/account/websites/route.ts`
- Create: `apps/marketing/src/app/api/account/websites/by-url/route.test.ts`
- Create: `apps/marketing/src/app/api/account/websites/by-url/route.ts`
- Create: `apps/marketing/src/app/api/account/websites/[websiteId]/route.test.ts`
- Create: `apps/marketing/src/app/api/account/websites/[websiteId]/route.ts`
- Create: `apps/marketing/src/app/api/account/websites/[websiteId]/confirm/route.test.ts`
- Create: `apps/marketing/src/app/api/account/websites/[websiteId]/confirm/route.ts`

### Step 1: Write failing store tests

Mock the Supabase admin client only at the transport seam. Prove row mapping fails closed for malformed UUIDs, versions, hashes, timestamps, booleans, or profiles. Prove every query includes `user_id`, and foreign/missing are distinct from store unavailable.

Store results use discriminated outcomes:

```ts
type WebsiteStoreResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "missing" }
  | { readonly kind: "duplicate"; readonly website: WebsiteSummary }
  | { readonly kind: "conflict"; readonly current: WebsiteDetails }
  | { readonly kind: "unavailable"; readonly reason: string };
```

Never log full profile content.

### Step 2: Run store RED

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/account-websites/store.test.ts
```

### Step 3: Implement list/read/create/primary/save/confirm/by-URL

Reads may use service-role PostgREST only with authenticated `user_id` predicates. All writes use the migration RPCs. Compute SHA-256 from canonical parsed profile JSON server-side before saving.

List responses contain summaries only. Detail responses contain the owned draft and current confirmed snapshot. By-URL returns an exact confirmed reference and a consumer-safe profile only after ownership validation.

### Step 4: Write route tests before each handler

For every route, pin:

- auth unavailable -> 503;
- signed out -> 401;
- foreign/missing -> 404;
- malformed JSON/content-type/size -> stable 400/413/415;
- duplicate -> 409 plus existing website summary;
- stale base -> 409 plus current safe details;
- incomplete confirmation -> 422 field errors;
- store unavailable -> 503;
- success -> exact envelope and `Cache-Control: private, no-store`;
- no profile text in error logs.

Use `readPublicToolJson` or an equivalent bounded same-origin request reader for mutating routes. Require same-origin POST/PATCH protection.

### Step 5: Run route GREEN and checkpoint

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/account-websites/store.test.ts \
  apps/marketing/src/app/api/account/websites/route.test.ts \
  apps/marketing/src/app/api/account/websites/by-url/route.test.ts \
  'apps/marketing/src/app/api/account/websites/[websiteId]/route.test.ts' \
  'apps/marketing/src/app/api/account/websites/[websiteId]/confirm/route.test.ts'
git diff --check
```

Expected: pass. Do not commit.

## Task 4: Add the account Settings layout and website list

**Files:**

- Create: `apps/marketing/src/app/[locale]/account/page.test.ts`
- Create: `apps/marketing/src/app/[locale]/account/page.tsx`
- Create: `apps/marketing/src/app/[locale]/account/layout.test.ts`
- Create: `apps/marketing/src/app/[locale]/account/layout.tsx`
- Create: `apps/marketing/src/app/[locale]/account/websites/page.test.ts`
- Create: `apps/marketing/src/app/[locale]/account/websites/page.tsx`
- Create: `apps/marketing/src/components/account/account-settings-shell.test.tsx`
- Create: `apps/marketing/src/components/account/account-settings-shell.tsx`
- Create: `apps/marketing/src/components/account/websites-account-client.test.tsx`
- Create: `apps/marketing/src/components/account/websites-account-client.tsx`
- Create: `apps/marketing/src/components/account/add-website-dialog.test.tsx`
- Create: `apps/marketing/src/components/account/add-website-dialog.tsx`
- Modify: `apps/marketing/src/app/[locale]/account/credits/page.tsx`
- Modify: `apps/marketing/src/app/[locale]/account/credits/page.test.ts`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`

### Step 1: Write page-contract RED tests

Pin that `/account` redirects locale-safely to `/account/websites`, account pages are dynamic/noindex, the shared layout provides Websites/Credits/Agents only, and account routes stay out of the sitemap.

### Step 2: Write component RED tests

Cover:

- loading, signed-out, unavailable, empty, and ready list states;
- first website marked primary;
- Add Website dialog validation;
- duplicate opens the existing site;
- Add Only and Add + Generate paths;
- Set Primary;
- status labels: not generated, draft, confirmed, unconfirmed changes;
- no Integrations, Docs, Team, Devices, or inert Upgrade control.

### Step 3: Implement the shared layout and list

Keep account copy under one `account` namespace so the shell need not serialize a second private catalog. Reuse current Card/Dialog/Input/Button primitives and brand tokens. Do not add new global CSS unless an existing token cannot express the approved layout.

The Credits page moves inside the shared layout without changing its fetch/failure behaviour.

### Step 4: Run GREEN and checkpoint

```bash
pnpm exec vitest run --project unit \
  'apps/marketing/src/app/[locale]/account/page.test.ts' \
  'apps/marketing/src/app/[locale]/account/layout.test.ts' \
  'apps/marketing/src/app/[locale]/account/websites/page.test.ts' \
  apps/marketing/src/components/account/account-settings-shell.test.tsx \
  apps/marketing/src/components/account/websites-account-client.test.tsx \
  apps/marketing/src/components/account/add-website-dialog.test.tsx \
  'apps/marketing/src/app/[locale]/account/credits/page.test.ts'
git diff --check
```

## Task 5: Add the profile editor, generation, autosave, refresh review, and confirmation

**Files:**

- Create: `apps/marketing/src/app/[locale]/account/websites/[websiteId]/page.test.ts`
- Create: `apps/marketing/src/app/[locale]/account/websites/[websiteId]/page.tsx`
- Create: `apps/marketing/src/components/account/website-profile-editor.test.tsx`
- Create: `apps/marketing/src/components/account/website-profile-editor.tsx`
- Create: `apps/marketing/src/components/account/profile-refresh-review.test.tsx`
- Create: `apps/marketing/src/components/account/profile-refresh-review.tsx`
- Reuse: `apps/marketing/src/lib/agents/profile-refresh-contract.ts`
- Reuse: `apps/marketing/src/app/api/agents/seo/profile-refresh/route.ts`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`

### Step 1: Write editor RED tests

Use fake timers and mocked fetch to prove:

- generated profile response maps to a draft and never auto-confirms;
- four approved sections render;
- multi-value fields are editable lists, not comma-only storage;
- user edits become `user_edit` provenance;
- autosave waits 800–1000 ms and displays unsaved -> saving -> saved only after 200;
- failed save preserves local input and shows retry;
- before-unload warning exists only for unsaved/failed state;
- 409 retains local values and displays local/server field comparison;
- refresh proposals do not overwrite user edits;
- confirmation validates the five core fields and previews a delta;
- unchanged confirmation reuses the current snapshot;
- source URLs are safe external links.

### Step 2: Run RED

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/account/website-profile-editor.test.tsx \
  apps/marketing/src/components/account/profile-refresh-review.test.tsx
```

### Step 3: Implement foreground generation by composition

Do not duplicate the crawler/model pipeline. For Add + Generate or Re-scan:

1. create/open the website;
2. call the existing signed-in SEO profile-refresh route with URL, market, language, output locale, and explicit mode;
3. validate `AgentProfileRefreshData` client-side;
4. map it through the Task 1 bridge;
5. save the resulting website draft with the current base version;
6. keep partial/no-data/error states distinct;
7. rely on the existing crawl gate for same-host single-flight protection.

Generation remains foreground. Closing the page may interrupt the request; the website identity and prior draft remain durable.

### Step 4: Implement conflict and confirmation UI

Use a reducer or narrowly scoped state machine rather than unrelated booleans. Conflict review must not expose force-overwrite. After user choices, save against the current server version.

Confirmation calls the dedicated confirm route only after the draft is saved and ready. Existing open Agent sessions stay pinned to their earlier reference.

### Step 5: Run GREEN and checkpoint

```bash
pnpm exec vitest run --project unit \
  'apps/marketing/src/app/[locale]/account/websites/[websiteId]/page.test.ts' \
  apps/marketing/src/components/account/website-profile-editor.test.tsx \
  apps/marketing/src/components/account/profile-refresh-review.test.tsx \
  apps/marketing/src/lib/agents/profile-refresh-contract.test.ts \
  apps/marketing/src/components/agents/agent-profile.test.ts
git diff --check
```

## Task 6: Unify the avatar menu without making it hostage to private modules

**Files:**

- Modify: `apps/marketing/src/lib/auth/use-account.test.tsx`
- Modify: `apps/marketing/src/lib/auth/use-account.ts`
- Modify: `apps/marketing/src/components/auth/account-menu.test.tsx`
- Modify: `apps/marketing/src/components/auth/account-menu.tsx`
- Modify: `apps/marketing/src/components/layout/header.tsx`
- Reuse: `apps/marketing/src/components/layout/theme-toggle.tsx`
- Reuse: `apps/marketing/src/components/layout/language-switcher.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`

### Step 1: Write account-state RED tests

Add a third independent `/api/account/websites` summary request after identity succeeds. Prove:

- identity renders even when Websites is unavailable;
- sign-out renders even when Credits and Websites are both unavailable;
- primary website is parsed strictly;
- malformed website summary is absent, not fabricated;
- signed-out and unknown render no account menu.

Do not widen `/api/auth/profile`; identity, Credits, and Websites remain independently degradable.

### Step 2: Write menu RED tests

Pin identity, Credits, primary/add-website shortcut, Settings, Agents, language, referral, and sign-out order. Assert Integrations, Docs, Team, and Upgrade are absent. Cover hover, click, focus, ArrowUp/ArrowDown, Enter/Space, Escape focus restoration, outside click, and mobile click-only parity.

### Step 3: Implement with Radix menu primitives or equivalent complete roving focus

Preserve current Google-image safety and monogram fallback. Move signed-in theme/language controls inside the menu; retain standalone controls for unknown/signed-out. Avoid duplicate visible controls once account status is signed in.

### Step 4: Run GREEN and checkpoint

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/auth/use-account.test.tsx \
  apps/marketing/src/components/auth/account-menu.test.tsx \
  apps/marketing/src/components/layout/page-shell.test.ts
git diff --check
```

## Task 7: Add exact snapshot import/reference to SEO and Tech Agents

**Files:**

- Create: `apps/marketing/src/components/account/website-profile-picker.test.tsx`
- Create: `apps/marketing/src/components/account/website-profile-picker.tsx`
- Modify: `apps/marketing/src/components/agents/agent-workbench.test.tsx`
- Modify: `apps/marketing/src/components/agents/agent-workbench.tsx`
- Modify: `apps/marketing/src/components/agents/agent-profile-panel.test.tsx`
- Modify: `apps/marketing/src/components/agents/agent-profile-panel.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`

### Step 1: Write picker and workbench RED tests

Prove:

- exact normalized URL match is suggested;
- a mismatched primary website is never auto-applied;
- draft-only websites cannot be referenced;
- Import creates a detached local Agent draft with source metadata;
- Reference pins exact snapshot ID/revision/hash;
- later website versions do not mutate the open run;
- Agent-local edits never write back without the explicit Save Back action;
- no-login state fetches no private profile;
- SEO and Tech share the same integration path.

### Step 2: Implement the picker and workbench state

The picker uses summary list data, then fetches exact owned details only after selection. `AgentWorkbench` stores an optional exact `WebsiteProfileReferenceV1` beside the local draft. The current audit remains non-canonical and report contents remain non-persistent.

The first implementation shows and pins the exact reference in the client run context. Do not claim server-side audit lineage unless the audit request/response contract is separately extended and validated.

### Step 3: Implement explicit Save Back to Website Draft

Map the reusable fields from the Agent draft, preserve the exact current website draft base version, and call the website PATCH route. Never auto-confirm.

### Step 4: Run GREEN and checkpoint

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/account/website-profile-picker.test.tsx \
  apps/marketing/src/components/agents/agent-workbench.test.tsx \
  apps/marketing/src/components/agents/agent-profile-panel.test.tsx \
  apps/marketing/src/lib/account-websites/agent-profile-bridge.test.ts
git diff --check
```

## Task 8: Add browser acceptance, update truthful documentation, and run gates

**Files:**

- Create: `apps/marketing/e2e/account-settings.spec.ts`
- Modify: `apps/marketing/playwright.config.ts`
- Modify: `README.md`
- Modify: `docs/plans/2026-08-27-marketing-account-websites-design.md`
- Create: `docs/reviews/2026-08-27-marketing-account-websites-local-verification.md`
- Modify only when required: `apps/marketing/src/app/[locale]/shell-messages.contract.test.ts`

### Step 1: Write the browser spec before final UI wiring

Mock only external/auth/DB HTTP seams and cover:

1. signed-in avatar menu destinations;
2. empty Websites settings;
3. first add + generate + partial draft;
4. edit, autosave, and confirm;
5. second website and primary switch;
6. conflict state;
7. SEO/Tech exact-match reference and detached import;
8. cross-host refusal;
9. mobile viewport with click-only account access;
10. Chinese/English and light/dark smoke;
11. keyboard menu navigation and an axe scan of account routes.

Before the new spec can run, add a focused Playwright config regression that
proves Vitest-only `e2e/**/*.test.ts` files are ignored. Current `origin/main`
discovers `e2e/fixtures/agent-envelope.test.ts` as a Playwright test and fails
inside Vitest's `describe()` before any browser spec starts. Fix only that test
discovery boundary; do not rewrite unrelated fixtures.

### Step 2: Update the repository truth boundary

README must state that private Marketing website-profile context may persist separately from runs. Preserve these truths:

- no-login facts-only Public Tools do not read profiles;
- Marketing Agent runs remain non-canonical;
- report/provider contents remain non-persistent;
- the profile store does not create an App project or App Product Profile.

No App OpenAPI/schema/authority inventory change is required unless implementation crosses into `apps/web`, `packages/contracts`, or the App database tree. If such a need appears, stop rather than silently widening scope.

### Step 3: Run focused and broad verification

Run fresh, in this order:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/account-websites \
  apps/marketing/src/app/api/account/websites \
  apps/marketing/src/components/account \
  apps/marketing/src/components/auth/account-menu.test.tsx \
  apps/marketing/src/lib/auth/use-account.test.tsx \
  apps/marketing/src/components/agents/agent-workbench.test.tsx \
  apps/marketing/src/components/agents/agent-profile-panel.test.tsx

MARKETING_TEST_DATABASE_URL=postgresql://wzb@127.0.0.1:5432/signalframe_codex_account_websites_20260827 \
  pnpm exec vitest run --project marketing-sql \
  apps/marketing/src/lib/account-websites/account-websites.integration.test.ts

pnpm --filter @sf/marketing lint
pnpm --filter @sf/marketing typecheck
pnpm --filter @sf/marketing build
pnpm --filter @sf/marketing test:e2e -- account-settings.spec.ts
pnpm secrets:scan
git diff --check
```

Then run the full unit project to identify unrelated baseline failures:

```bash
pnpm test
```

Do not fix an unrelated pre-existing failure without separate evidence that this change caused it. Record exact counts and the current baseline.

### Step 4: Review the complete requirement matrix

For every acceptance criterion in the design, link it to SQL output, a focused test, a rendered/browser observation, or a precise unverified limitation. Inspect `git diff --stat`, `git diff`, and untracked files. Run the verification-before-completion skill before any completion claim.

### Step 5: Clean up the disposable database and stop at the authorization boundary

After verification:

```bash
dropdb signalframe_codex_account_websites_20260827
```

Report the worktree path, baseline SHA, modified files, test evidence, and that the work remains uncommitted/unpushed/undeployed with no hosted migration applied.

## Task 9: Resolve exact confirmed references server-side

**Files:**

- Modify: `apps/marketing/src/lib/account-websites/store.ts`
- Modify: `apps/marketing/src/lib/account-websites/store.test.ts`
- Modify: `apps/marketing/src/lib/account-websites/store-adapter.test.ts`

### Step 1: Write exact-reference resolver RED tests

Prove that `resolveAccountWebsiteProfileReference(userId, reference)`:

- reads only the referenced owned website and exact immutable snapshot;
- accepts an older immutable snapshot even when a newer snapshot is current;
- recomputes the profile hash and checks schema, website ID, snapshot ID, and
  revision;
- returns missing for another user or unknown snapshot without revealing which
  identity failed;
- fails closed on malformed service-role rows and never returns profile text
  from a mismatched row.

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/account-websites/store.test.ts \
  apps/marketing/src/lib/account-websites/store-adapter.test.ts
```

Expected RED: the resolver and `readSnapshot` transport do not exist.

### Step 2: Add the scoped snapshot transport and strict resolver

Add a service-role `readSnapshot(userId, websiteId, snapshotId)` dependency.
The production adapter must constrain all three IDs in the database query. The
resolver first parses the reference, re-reads the owned website, reads the exact
snapshot, recomputes SHA-256 from the parsed profile, and returns a typed
projection only when every identity agrees.

### Step 3: Run GREEN and diff check

Run the two tests above and `git diff --check`.

## Task 10: Reference an exact website profile from GEO Agent

**Files:**

- Create: `apps/marketing/src/lib/account-websites/geo-context-bridge.ts`
- Create: `apps/marketing/src/lib/account-websites/geo-context-bridge.test.ts`
- Modify: `apps/marketing/src/components/account/website-profile-picker.tsx`
- Modify: `apps/marketing/src/components/account/website-profile-picker.test.tsx`
- Modify: `apps/marketing/src/lib/agents/geo-context.ts`
- Modify: `apps/marketing/src/lib/agents/geo-context.test.ts`
- Modify: `apps/marketing/src/lib/agents/geo-run-handler.ts`
- Modify: `apps/marketing/src/lib/agents/geo-run-handler.test.ts`
- Modify: `apps/marketing/src/components/agents/geo/geo-workbench.tsx`
- Modify: `apps/marketing/src/components/agents/geo/geo-workbench.test.tsx`
- Modify: `apps/marketing/src/components/agents/geo/geo-report-view.tsx`
- Modify: `apps/marketing/src/components/agents/geo/geo-report-view.test.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`

### Step 1: Write bridge and context-identity RED tests

Pin these rules:

- only a confirmed snapshot may be referenced;
- the bridge verifies the snapshot hash before projecting Product/ICP fields;
- aliases and category remain proposals requiring the current visitor's GEO
  confirmation;
- the exact `WebsiteProfileReferenceV1` participates in `geoContextHash`;
- malformed references fail the strict GEO context guard;
- changing only snapshot revision/hash changes context identity.

### Step 2: Add a reference-only picker path to GEO

Allow `WebsiteProfilePicker` to omit Import when no `onImport` callback is
provided. In `GeoWorkbench`, render it in the context stage. An explicit
Reference action fills the local GEO form through the GEO bridge, retains the
exact reference, and never confirms category, aliases, queries, or a run.
Changing the target host clears the reference.

### Step 3: Carry and display the pinned reference

Add optional `websiteProfileReference` to `GeoContextInputV1` and
`GeoContextSnapshotV1`. Validate it strictly and include it in the canonical
hash projection. Because session restoration already carries the complete
context object, the exact reference then survives query confirmation, run,
report display, language switch, and same-tab restoration without a parallel
state channel.

### Step 4: Re-authenticate and resolve before billing

Change the GEO run dependency to return the verified Supabase user ID. When a
context carries a reference, call the Task 9 resolver after request validation
but before provider construction or the daily budget claim. Require the owned
website canonical key to match the context target host. Return stable
pre-billing reference-invalid or profile-unavailable errors; never fall through
to a provider call.

### Step 5: Run focused GREEN

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/account-websites/geo-context-bridge.test.ts \
  apps/marketing/src/lib/agents/geo-context.test.ts \
  apps/marketing/src/lib/agents/geo-run-handler.test.ts \
  apps/marketing/src/components/agents/geo/geo-workbench.test.tsx \
  apps/marketing/src/components/agents/geo/geo-report-view.test.tsx
```

## Task 11: Import or reference a website profile in Keyword Opportunity Map

**Chosen consumer:** `/tools/low-competition-keywords`, because its two-stage
pipeline already uses site positioning and Product/ICP-like context to generate
candidates. Competitor Gap mainly compares domains, while On-Page Checker is a
page/query facts tool and stays profile-free.

**Files:**

- Create: `apps/marketing/src/lib/account-websites/keyword-profile-bridge.ts`
- Create: `apps/marketing/src/lib/account-websites/keyword-profile-bridge.test.ts`
- Modify: `apps/marketing/src/components/tools/keyword-map-tool.tsx`
- Modify: `apps/marketing/src/components/tools/keyword-map-tool.test.tsx`
- Modify: `apps/marketing/src/lib/tools/keyword-opportunity-handler.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-opportunity-handler.test.ts`
- Modify: `apps/marketing/src/app/api/tools/hidden-keywords/context/route.ts`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`

### Step 1: Write projection and UI RED tests

Prove:

- detached Import maps only bounded categories, features, use cases, ICP
  interests, primary ICP, and JTBD into editable seed terms;
- Import carries no reference and never writes back;
- Reference retains the exact reference and target website but still lets the
  visitor edit run-local seeds/market/language;
- changing the target host clears a reference;
- opening the picker remains explicit and signed-out state reads no private
  website API.

### Step 2: Extend stage-one request and sealed token under RED tests

Allow an optional strict `websiteProfileReference` in the context request and
`KeywordContextToken`. If present, resolve it with the verified Supabase user
through Task 9, require canonical host equality, derive the bounded seed
projection server-side, and merge it with visitor seeds deterministically under
the existing 10 x 80 limits. Seal the exact reference into the identity-bound
token so stage two cannot silently switch versions.

Detached Import sends only ordinary editable seeds; exact Reference sends the
reference and relies on the server-derived projection. Profile text does not
enter logs, analytics, URL parameters, GSC calls, or the result contract.

### Step 3: Wire the shared picker and truthful context badge

Render `WebsiteProfilePicker` only on the signed-in/GSC-connected Tool surface.
Show detached-import versus exact-reference status and the pinned revision/hash.
Do not add private profile access to On-Page, Internal Link Audit, or other
facts-only/no-login tools.

### Step 4: Run focused GREEN

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/account-websites/keyword-profile-bridge.test.ts \
  apps/marketing/src/components/tools/keyword-map-tool.test.tsx \
  apps/marketing/src/lib/tools/keyword-opportunity-handler.test.ts
```

## Task 12: Prove the complete consumer matrix and re-close verification

**Files:**

- Modify: `apps/marketing/e2e/account-settings.spec.ts`
- Modify: `apps/marketing/e2e/geo-agent.spec.ts`
- Create: `apps/marketing/e2e/keyword-website-profile.spec.ts`
- Modify: `docs/plans/2026-08-27-marketing-account-websites-design.md`
- Modify: `docs/plans/2026-08-27-marketing-account-websites-implementation.md`
- Modify: `docs/reviews/2026-08-27-marketing-account-websites-local-verification.md`
- Modify: `README.md`

Add deterministic browser flows for:

1. GEO exact reference -> manual GEO confirmation -> pinned run/report context;
2. language-switch restoration retaining the same GEO reference;
3. detached Keyword Tool import with no reference or back-write;
4. exact Keyword Tool reference carried through stage-one context and stage-two
   result without a profile fetch from a facts-only public tool.

Then rerun feature unit tests, Marketing SQL, typecheck, changed-file lint,
build, the complete Marketing Playwright suite under the provider-free
environment, secret scan, docs verification, and independent backend/frontend
reviews. Only after this evidence is green may the implementation and active
goal be marked complete.

### Browser acceptance evidence (2026-08-28)

- Production Marketing build: PASS, including TypeScript and 266 generated
  static paths plus the dynamic account, GEO, and keyword routes.
- GEO plus keyword-profile specs: PASS, 12/12 tests. The added GEO path proves
  reference-only selection, current alias/category confirmation, visible pinned
  Product/ICP review, exact reference/provenance in the run request, captured
  revision/hash in the report, and locale restoration with no second run or
  website lookup.
- Existing account-settings spec: PASS, 2/2 tests.
- Complete Marketing Playwright suite under the provider-free standalone
  server: **PASS, 30/30 tests** after the language-switch contrast fix and a
  fresh production rebuild. The final run used the isolated local server on
  port 3330 with provider credentials cleared.
- Keyword detached Import sends editable ordinary seeds with no reference and
  performs no website write; exact Reference sends only its strict reference
  plus the visitor overlay in stage one, receives an exact acceptance echo,
  sends only `contextToken` in stage two, and keeps the pin visible in the
  result. Same-host `www`/path changes preserve it; invalid or cross-host input
  clears it.

The browser fixtures seal only `gg_id` and `gg_sites` with the same test-only
key as the standalone server, mock the account and hidden-keyword HTTP seams,
and invoke no real OAuth, Supabase, GSC, crawl, model, or paid provider. The
documentation consistency gate passed 14/14 after these updates. The final
Task 12 E2E/docs reviewer found no blocking issue; it explicitly treated the
browser's isolated auth mocks as mock evidence rather than a real identity-join
canary. The contrast failure was fixed in application source without weakening
Axe, and the required production rebuild plus complete 30-test browser rerun is
green. Feature unit, Marketing SQL, typecheck, changed-file lint, and
secret/redaction gates were rerun on 2026-08-28. The only remaining broad gate
that is not fully green is the existing `apps/marketing` lint baseline with
four unrelated errors in untouched files.
