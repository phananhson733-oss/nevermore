# Marketing Website Competitor Discovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete Marketing website-profile generation with the existing SEO Agent DataForSEO competitor-discovery and explicit review flow, without automatically persisting system suggestions.

**Architecture:** Keep the existing `profile-refresh` and `profile-search` routes independent. Add a small website-profile-to-search adapter, reuse the SEO Agent seed, suggestion, and review projections, and let the account editor orchestrate deliberate discovery after accepted Product/ICP generation. Provider candidates remain transient until the visitor explicitly classifies a normalized domain into exactly one durable relationship list.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, next-intl, Vitest, Playwright, existing Marketing DataForSEO profile-search route.

**Permission note:** Repository `AGENTS.md` forbids commit, push, PR, deploy, migration, production configuration, real customer-data mutation, and external source upload without separate authorization. The usual per-task commit steps are intentionally replaced with local diff checkpoints. No billable provider call is part of acceptance.

---

## Task 1: Generalize the existing search-seed and relationship projections

**Files:**

- Modify: `apps/marketing/src/components/agents/agent-profile-search-seeds.test.ts`
- Modify: `apps/marketing/src/components/agents/agent-profile-search-seeds.ts`
- Modify: `apps/marketing/src/components/agents/agent-competitor-candidates.test.ts`
- Modify: `apps/marketing/src/components/agents/agent-competitor-candidates.ts`

### Step 1: Write a failing generic seed-projection test

Add a runtime export named `deriveProfileSearchSeeds` and test it against the
small structural shape shared by Agent and website profiles:

```ts
import {
  deriveProfileSearchSeeds,
  deriveProductProfileSearchSeeds,
} from "./agent-profile-search-seeds";

it("derives the same bounded seeds from a website-shaped profile", () => {
  const websiteProfile = {
    productName: "Astrology Wiki",
    categories: ["Astrology reference"],
    oneLinePositioning: "Evidence-led astrology explanations",
    coreFeatures: ["Natal chart guides"],
    fieldProvenance: [
      { path: "/productName", source: "public_page" },
      { path: "/categories", source: "user_edit" },
      { path: "/oneLinePositioning", source: "public_page" },
      { path: "/coreFeatures", source: "not_available" },
    ],
  };

  expect(deriveProfileSearchSeeds(websiteProfile)).toEqual([
    "Astrology Wiki",
    "Astrology reference",
    "Evidence-led astrology explanations",
  ]);
});
```

Keep the existing Agent-specific assertions. Add one assertion that both public
exports return the same output for an `AgentProfileDraft`.

### Step 2: Run the test to verify RED

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/agents/agent-profile-search-seeds.test.ts
```

Expected: FAIL because `deriveProfileSearchSeeds` is not exported.

### Step 3: Implement the minimal structural input

Replace the `AgentProfileDraft` dependency with a narrow public type:

```ts
export interface ProfileSearchSeedInput {
  readonly productName: string;
  readonly categories: readonly string[];
  readonly oneLinePositioning: string;
  readonly coreFeatures: readonly string[];
  readonly fieldProvenance: readonly {
    readonly path: string;
    readonly source: string;
  }[];
}

export function deriveProfileSearchSeeds(
  profile: ProfileSearchSeedInput,
): readonly string[] {
  // Move the current implementation here unchanged.
}

export function deriveProductProfileSearchSeeds(
  profile: ProfileSearchSeedInput,
): readonly string[] {
  return deriveProfileSearchSeeds(profile);
}
```

Retain the current source allow-list, placeholder rejection, NFKC/whitespace
normalization, case-insensitive deduplication, 200-character cap, and five-seed
limit. Do not add `local_inference`, `not_available`, or other sources.

### Step 4: Write a failing pure relationship-classification test

Add a new pure export named `classifyCompetitorRelationships`:

```ts
it("moves a normalized domain into exactly one relationship without mutating input", () => {
  const before = {
    direct: ["direct.example"],
    indirect: ["rival.example", "keep.example"],
    excluded: ["ignored.example"],
  } as const;

  const after = classifyCompetitorRelationships(
    before,
    "WWW.Rival.Example.",
    "direct",
  );

  expect(after).toEqual({
    direct: ["direct.example", "rival.example"],
    indirect: ["keep.example"],
    excluded: ["ignored.example"],
  });
  expect(before.indirect).toEqual(["rival.example", "keep.example"]);
});
```

Also cover indirect, excluded, a repeated same-group choice, and invalid public
hostnames.

### Step 5: Run the classification test to verify RED

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/agents/agent-competitor-candidates.test.ts
```

Expected: FAIL because the pure classification export does not exist.

### Step 6: Implement the pure classification and reuse it for Agent drafts

Implement:

```ts
export function classifyCompetitorRelationships(
  classifications: AgentCompetitorClassifications,
  domain: string,
  classification: AgentCompetitorClassification,
): AgentCompetitorClassifications {
  const normalized = normalizeAgentProfileSearchDomain(domain);
  if (normalized === null) {
    throw new TypeError("Competitor domain must be a normalized public hostname.");
  }
  const direct = withoutDomain(classifications.direct, normalized);
  const indirect = withoutDomain(classifications.indirect, normalized);
  const excluded = withoutDomain(classifications.excluded, normalized);
  return {
    direct:
      classification === "direct" ? [...direct, normalized] : direct,
    indirect:
      classification === "indirect" ? [...indirect, normalized] : indirect,
    excluded:
      classification === "excluded" ? [...excluded, normalized] : excluded,
  };
}
```

Refactor `classifyAgentCompetitorProfile()` to call the pure function and then
pass its three outputs to `updateAgentProfile()`. Keep all existing suggestion
derivation and display-frame behavior unchanged.

### Step 7: Run GREEN and checkpoint

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/agents/agent-profile-search-seeds.test.ts \
  apps/marketing/src/components/agents/agent-competitor-candidates.test.ts
pnpm --filter @sf/marketing typecheck
git diff --check
```

Expected: focused tests and Marketing typecheck pass. Inspect the diff and do
not commit.

---

## Task 2: Add a typed website-profile competitor-discovery adapter

**Files:**

- Create: `apps/marketing/src/lib/account-websites/competitor-discovery.test.ts`
- Create: `apps/marketing/src/lib/account-websites/competitor-discovery.ts`
- Reuse: `apps/marketing/src/lib/account-websites/contracts.ts`
- Reuse: `apps/marketing/src/lib/agents/profile-search-contract.ts`

### Step 1: Write failing request-projection tests

Pin the exact browser request shape without adding a new HTTP contract:

```ts
it("projects an accepted website draft into the existing SEO profile-search request", () => {
  const profile = readyWebsiteProfile({
    productName: "Astrology Wiki",
    categories: ["Astrology reference"],
    country: "US",
    locale: "en-US",
  });

  expect(
    websiteCompetitorSearchRequest(
      profile,
      "https://astrologywiki.com/learn?source=account",
    ),
  ).toEqual({
    url: "https://astrologywiki.com/learn?source=account",
    marketCode: "US",
    languageTag: "en-US",
    targetQuery: "",
    productProfileSearchSeeds: ["Astrology Wiki", "Astrology reference"],
  });
});
```

Add cases for:

- non-canonical locale -> `null`;
- invalid two-letter country -> `null`;
- empty but legal seed list -> valid domain-overlap request;
- exact submitted URL preservation;
- stable identity across cosmetic whitespace/casing changes;
- changed seed, market, locale, or URL -> changed identity.

### Step 2: Write failing explicit-classification adapter tests

The website adapter must produce user-owned durable fields only after an
explicit decision:

```ts
it("records one explicit classification with user-edit provenance", () => {
  const before = readyWebsiteProfile({
    directCompetitors: [],
    indirectAlternatives: ["astro.com"],
  });

  const after = classifyWebsiteCompetitor(
    before,
    "astro.com",
    "direct",
  );

  expect(after.directCompetitors).toEqual(["astro.com"]);
  expect(after.indirectAlternatives).toEqual([]);
  expect(after.excludedAlternatives).toEqual([]);
  expect(after.fieldProvenance).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "/directCompetitors",
        derivation: "declared",
        confidence: "high",
        source: "user_edit",
        observedAt: null,
        evidenceUrls: [],
      }),
    ]),
  );
});
```

Assert that unrelated lists, manual domains, list order, and unrelated
provenance remain unchanged and that input is not mutated.

### Step 3: Run the new suite to verify RED

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/account-websites/competitor-discovery.test.ts
```

Expected: FAIL because the module does not exist.

### Step 4: Implement the adapter minimally

Export:

```ts
export interface WebsiteCompetitorSearchRequest {
  readonly url: string;
  readonly marketCode: string;
  readonly languageTag: string;
  readonly targetQuery: "";
  readonly productProfileSearchSeeds: readonly string[];
}

export function websiteCompetitorSearchRequest(
  profile: MarketingWebsiteProfileV1,
  submittedUrl: string,
): WebsiteCompetitorSearchRequest | null;

export function websiteCompetitorSearchIdentity(
  request: WebsiteCompetitorSearchRequest,
): string;

export function classifyWebsiteCompetitor(
  profile: MarketingWebsiteProfileV1,
  domain: string,
  classification: AgentCompetitorClassification,
): MarketingWebsiteProfileV1;
```

Implementation requirements:

- parse the website profile at entry and exit;
- canonicalize the language with `Intl.getCanonicalLocales` and require exact
  canonical spelling;
- require an uppercase two-letter market;
- call `deriveProfileSearchSeeds()` rather than duplicate it;
- call `classifyCompetitorRelationships()` rather than duplicate grouping;
- replace provenance only for relationship lists whose values changed;
- use the existing declared/high-confidence/user-edit provenance shape;
- do not copy provider metrics, observed time, or raw search rows into the
  website profile.

### Step 5: Run GREEN and checkpoint

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/account-websites/competitor-discovery.test.ts \
  apps/marketing/src/lib/account-websites/contracts.test.ts
pnpm --filter @sf/marketing typecheck
git diff --check
```

Expected: tests and typecheck pass. Inspect the diff and do not commit.

---

## Task 3: Add explicit discovery and transient review state to the website editor

**Files:**

- Modify: `apps/marketing/src/components/account/website-profile-editor.test.tsx`
- Modify: `apps/marketing/src/components/account/website-profile-editor.tsx`
- Reuse: `apps/marketing/src/components/agents/agent-profile-search.tsx`
- Reuse: `apps/marketing/src/lib/agents/profile-search-contract.ts`
- Reuse: `apps/marketing/src/i18n/messages/en.json`
- Reuse: `apps/marketing/src/i18n/messages/zh.json`

### Step 1: Add a failing explicit-discovery component test

Extend the test harness with a valid `agent_profile_search.v1` envelope and
capture fetch calls. Starting from a ready website draft:

```ts
it("discovers reviewable competitors without changing the website draft", async () => {
  // GET website -> existing draft with Product/ICP provenance.
  // POST /profile-search -> one organic-search-overlap candidate.
  render(<WebsiteProfileEditor websiteId={WEBSITE_ID} />);

  await act(async () => button("Refresh search landscape").click());

  expect(profileSearchBody()).toEqual({
    url: "https://example.com/pricing",
    marketCode: "US",
    languageTag: "en-US",
    targetQuery: "",
    productProfileSearchSeeds: expect.arrayContaining(["Example"]),
  });
  expect(host.textContent).toContain("rival.example");
  expect(host.textContent).toContain("System suggestion");
  expect(latestSavedProfile()?.directCompetitors ?? []).toEqual([]);
  expect(latestSavedProfile()?.indirectAlternatives ?? []).toEqual([]);
  expect(latestSavedProfile()?.excludedAlternatives ?? []).toEqual([]);
});
```

Assert the candidate row exposes the same DataForSEO boundary and metrics as
the SEO Agent component.

### Step 2: Run the component test to verify RED

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/account/website-profile-editor.test.tsx
```

Expected: FAIL because the account editor has no discovery action or
profile-search request.

### Step 3: Add the minimal transient state

Extend `ReadyEditor` with a separate state, not part of the durable profile:

```ts
type CompetitorSearchState =
  | { readonly status: "idle" | "pending" | "loading" }
  | {
      readonly status: "result";
      readonly requestIdentity: string;
      readonly data: AgentProfileSearchData;
    }
  | {
      readonly status: "error";
      readonly requestIdentity: string | null;
      readonly code: string;
    };
```

Initialize it to `idle` when website details load. Add a dedicated
`AbortController` ref, abort it on unmount, and never reuse the profile-refresh
controller.

### Step 4: Implement `runCompetitorSearch()`

Use `websiteCompetitorSearchRequest()` and the existing endpoint:

```ts
const response = await fetch("/api/agents/seo/profile-search", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json",
  },
  body: JSON.stringify(requestBody),
  signal: controller.signal,
});
```

Requirements:

- use a 35-second client timeout, matching the SEO Agent;
- guard the response with `isAgentProfileSearchEnvelope()`;
- require `agent === "seo"`, exact target host, and exact market;
- ignore an aborted, superseded, foreign-host, stale-identity, or invalid
  response;
- map non-2xx stable error codes without logging response/profile content;
- keep all three durable relationship lists unchanged.

### Step 5: Render the existing review component

Create the same `AgentProfileSearchCopy` projection already used by
`AgentProfilePanel`, using the existing
`agents.workbench.profile.search.*` EN/ZH messages. Do not duplicate the
catalog.

Render `AgentProfileSearch` immediately after the Market and Alternatives field
card with:

```tsx
<AgentProfileSearch
  locale={locale}
  loading={search.status === "loading"}
  data={search.status === "result" ? search.data : null}
  errorCode={search.status === "error" ? search.code : null}
  onDiscover={() => void runCompetitorSearch(state.profile)}
  disabled={websiteCompetitorSearchRequest(
    state.profile,
    state.details.submittedUrl,
  ) === null}
  classifications={{
    direct: state.profile.directCompetitors,
    indirect: state.profile.indirectAlternatives,
    excluded: state.profile.excludedAlternatives,
  }}
  copy={profileSearchCopy}
/>
```

Do not pass `onClassify` yet; Task 4 drives durable classification.

### Step 6: Cover availability and request failures under RED

Add table-driven component cases for:

- `no_data`;
- `market_unsupported`;
- `source_unavailable`;
- `auth_required`;
- `auth_unavailable`;
- `search_timeout`;
- malformed success envelope.

For every case, assert existing competitor lists and save state are unchanged.

### Step 7: Run GREEN and checkpoint

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/account/website-profile-editor.test.tsx \
  apps/marketing/src/components/agents/agent-profile-search.test.tsx \
  apps/marketing/src/components/agents/agent-competitor-candidates.test.ts
pnpm --filter @sf/marketing typecheck
git diff --check
```

Expected: explicit discovery and typed failures pass; no draft write occurs from
system suggestions. Inspect the diff and do not commit.

---

## Task 4: Persist only explicit classifications through the existing draft flow

**Files:**

- Modify: `apps/marketing/src/components/account/website-profile-editor.test.tsx`
- Modify: `apps/marketing/src/components/account/website-profile-editor.tsx`
- Reuse: `apps/marketing/src/lib/account-websites/competitor-discovery.ts`

### Step 1: Write a failing explicit-classification test

After rendering a provider candidate, click its Direct action:

```ts
await act(async () =>
  host
    .querySelector<HTMLButtonElement>(
      '[data-profile-competitor-action="direct"]',
    )
    ?.click(),
);

expect(fieldValues("directCompetitors")).toEqual(["rival.example"]);
expect(fieldValues("indirectAlternatives")).toEqual([]);
expect(fieldValues("excludedAlternatives")).toEqual([]);
```

Advance the fake autosave timer and assert the PATCH profile:

```ts
expect(saved.profile.directCompetitors).toEqual(["rival.example"]);
expect(saved.profile.fieldProvenance).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      path: "/directCompetitors",
      source: "user_edit",
    }),
  ]),
);
expect(fetchCallsEndingWith("/confirm")).toHaveLength(0);
```

Add a move test: classify the same domain indirect, then excluded, and prove it
exists in exactly one list after each decision. Preserve unrelated manual
domains.

### Step 2: Run the classification component test to verify RED

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/account/website-profile-editor.test.tsx
```

Expected: FAIL because review controls are disabled without `onClassify`.

### Step 3: Implement one state transition per visitor decision

Add:

```ts
function classifyCompetitor(
  domain: string,
  classification: AgentCompetitorClassification,
): void {
  setState((current) => {
    if (current.phase !== "ready" || current.competitorSearch.status !== "result") {
      return current;
    }
    const request = websiteCompetitorSearchRequest(
      current.profile,
      current.details.submittedUrl,
    );
    if (
      request === null ||
      websiteCompetitorSearchIdentity(request) !==
        current.competitorSearch.requestIdentity
    ) {
      return { ...current, competitorSearch: { status: "idle" } };
    }
    return {
      ...current,
      profile: classifyWebsiteCompetitor(
        current.profile,
        domain,
        classification,
      ),
      saveState: "unsaved",
      confirmError: null,
    };
  });
}
```

Pass `onClassify={classifyCompetitor}` to `AgentProfileSearch`. Keep the search
result because relationship-list changes do not change the request identity.
Let the existing autosave effect and CAS conflict flow persist the new draft.

### Step 4: Run GREEN and checkpoint

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/account/website-profile-editor.test.tsx \
  apps/marketing/src/lib/account-websites/competitor-discovery.test.ts
pnpm --filter @sf/marketing typecheck
git diff --check
```

Expected: classifications persist to the draft, never auto-confirm, and preserve
one-group-only membership. Inspect the diff and do not commit.

---

## Task 5: Chain discovery after accepted generation and invalidate stale candidates

**Files:**

- Modify: `apps/marketing/src/components/account/website-profile-editor.test.tsx`
- Modify: `apps/marketing/src/components/account/website-profile-editor.tsx`

### Step 1: Write the failing Add + Generate sequence test

Extend the existing test `honors Add + Generate with a foreground prefer-cache
refresh`:

```ts
const calls = fetchCalls();
const refreshIndex = calls.findIndex(
  (call) =>
    call.path === "/api/agents/seo/profile-refresh" && call.method === "POST",
);
const searchIndex = calls.findIndex(
  (call) =>
    call.path === "/api/agents/seo/profile-search" && call.method === "POST",
);
const saveIndex = calls.findIndex(
  (call) =>
    call.path === `/api/account/websites/${WEBSITE_ID}` &&
    call.method === "PATCH",
);
expect(refreshIndex).toBeGreaterThanOrEqual(0);
expect(searchIndex).toBeGreaterThan(refreshIndex);
expect(saveIndex).toBeGreaterThanOrEqual(0);

expect(profileSearchBody().productProfileSearchSeeds).toContain(
  "Crawler suggestion",
);
expect(host.textContent).toContain("rival.example");
expect(savedProfile.directCompetitors).toEqual([]);
expect(savedProfile.indirectAlternatives).toEqual([]);
```

The search must use the merged accepted refresh profile, not the empty initial
profile.

### Step 2: Write failing accepted-refresh and no-call tests

Add cases proving:

- applying all remaining manual Re-scan proposals queues exactly one discovery
  using the resulting profile;
- dismissing proposals does not auto-run discovery;
- changing an ordinary non-seed field does not call discovery;
- typing/editing/autosave never calls discovery;
- `no_data` Product/ICP first generation does not create an empty draft and
  does not run competitor search;
- refresh error leaves search idle;
- refresh success remains usable when competitor search fails.

### Step 3: Run the sequence tests to verify RED

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/account/website-profile-editor.test.tsx
```

Expected: FAIL because refresh completion never queues profile search.

### Step 4: Add the pending-discovery transition

Use `competitorSearch: { status: "pending" }` as a state transition, not a side
effect inside a React state updater:

- initial `prefer_cache` generation sets `pending` only after a usable proposal
  is accepted into a previously empty draft;
- refresh-review application sets `pending` only when all accepted proposal
  changes have been consumed and the resulting profile is current;
- a `useEffect` observes `pending` and calls
  `runCompetitorSearch(state.profile)` once;
- `runCompetitorSearch` moves state to `loading` synchronously before awaiting.

Retain the current late-refresh rebase behavior and its regression test. Do not
call async work from inside the `setState` updater.

### Step 5: Write failing stale-candidate tests

After receiving candidates, edit each request-identity field:

- `productName`;
- `categories`;
- `oneLinePositioning`;
- `coreFeatures`;
- `country`;
- `locale`.

Assert the old candidate row disappears and clicking a stale element cannot
change any relationship list. Add a case where a late search response arrives
after a seed edit and is ignored.

### Step 6: Implement request-identity invalidation

Derive the current request and identity from the live profile and submitted URL.
Whenever `ReadyEditor` has a result whose `requestIdentity` differs from the
current identity:

- abort the old controller if still active;
- replace competitor state with `idle`;
- do not auto-run a new provider request.

Relationship-list edits must not invalidate the identity. A different website
ID, unmount, or newer discovery always aborts the old request.

### Step 7: Run GREEN and checkpoint

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/account/website-profile-editor.test.tsx \
  apps/marketing/src/components/agents/agent-workbench.test.tsx \
  apps/marketing/src/components/agents/agent-profile-search-seeds.test.ts \
  apps/marketing/src/components/agents/agent-competitor-candidates.test.ts
pnpm --filter @sf/marketing typecheck
git diff --check
```

Expected: automatic discovery, rebase, stale-response refusal, and existing SEO
Agent orchestration all pass. Inspect the diff and do not commit.

---

## Task 6: Extend provider-free desktop and mobile browser acceptance

**Files:**

- Modify: `apps/marketing/e2e/account-settings.spec.ts`

### Step 1: Add a deterministic profile-search fixture under RED

Teach `installAccountApi()` to answer
`/api/agents/seo/profile-search` with an exact
`agent_profile_search.v1` overlap response for the created website. Capture the
request body and search call count.

Before changing application code, extend the desktop flow:

```ts
await expect(page.locator('[data-profile-competitor-candidate="rival.example"]'))
  .toBeVisible();
expect(account.sites[0]?.draft?.directCompetitors).toEqual([]);

await page
  .getByRole("button", { name: "Direct: rival.example" })
  .click();
await expect.poll(() => account.sites[0]?.draft?.directCompetitors)
  .toEqual(["rival.example"]);
expect(account.sites[0]?.snapshot).toBeNull();
```

Then confirm and reference the exact snapshot from SEO Agent. Assert the
referenced profile contains `rival.example` only after confirmation.

Add a mobile assertion that the candidate actions are visible, tappable, and
have no critical/serious axe violation.

### Step 2: Run the browser acceptance as a second evidence tier

Run:

```bash
pnpm --filter @sf/marketing exec playwright test \
  --config=playwright.config.ts \
  e2e/account-settings.spec.ts
```

Expected after Tasks 3–5: PASS. The production behavior was already driven by
the failing component tests in Tasks 3–5; this browser flow verifies the same
contract across real routing, rendering, autosave, confirmation, and exact
reference boundaries rather than introducing behavior after implementation.

### Step 3: Make only fixture/assertion adjustments required by real behavior

Do not loosen existing Add, save, confirm, conflict, exact-reference, language,
theme, or accessibility assertions. Keep the fixture provider-free and do not
intercept more routes than the flow owns.

### Step 4: Run GREEN and checkpoint

Run:

```bash
pnpm --filter @sf/marketing exec playwright test \
  --config=playwright.config.ts \
  e2e/account-settings.spec.ts
git diff --check
```

Expected: desktop and mobile account-settings tests pass. Inspect the diff and
do not commit.

---

## Task 7: Run the complete bounded verification ledger

**Files:**

- Verify: all changed source, tests, and the two plan documents

### Step 1: Run all focused unit and component regressions

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/agents/agent-profile-search-seeds.test.ts \
  apps/marketing/src/components/agents/agent-competitor-candidates.test.ts \
  apps/marketing/src/components/agents/agent-profile-search.test.tsx \
  apps/marketing/src/components/agents/agent-workbench.test.tsx \
  apps/marketing/src/lib/account-websites/contracts.test.ts \
  apps/marketing/src/lib/account-websites/competitor-discovery.test.ts \
  apps/marketing/src/lib/account-websites/agent-profile-bridge.test.ts \
  apps/marketing/src/components/account/website-profile-editor.test.tsx
```

Expected: all focused tests pass with no unhandled rejection or warning.

### Step 2: Run Marketing static gates

Run:

```bash
pnpm --filter @sf/marketing typecheck
pnpm exec eslint \
  apps/marketing/src/components/agents/agent-profile-search-seeds.ts \
  apps/marketing/src/components/agents/agent-profile-search-seeds.test.ts \
  apps/marketing/src/components/agents/agent-competitor-candidates.ts \
  apps/marketing/src/components/agents/agent-competitor-candidates.test.ts \
  apps/marketing/src/lib/account-websites/competitor-discovery.ts \
  apps/marketing/src/lib/account-websites/competitor-discovery.test.ts \
  apps/marketing/src/components/account/website-profile-editor.tsx \
  apps/marketing/src/components/account/website-profile-editor.test.tsx \
  apps/marketing/e2e/account-settings.spec.ts
```

Expected: typecheck and exact changed-file lint pass. Keep unrelated broad lint
baseline failures separate if the broad command is additionally run.

### Step 3: Run repository-owned docs and security gates

Run:

```bash
pnpm verify:docs
pnpm secrets:scan
git diff --check
```

Expected: documentation consistency, secret/redaction tests, and whitespace
checks pass.

### Step 4: Run the provider-free browser flow again

Run:

```bash
pnpm --filter @sf/marketing exec playwright test \
  --config=playwright.config.ts \
  e2e/account-settings.spec.ts
```

Expected: desktop and mobile flow pass. This proves only the deterministic
fixture boundary, not a real DataForSEO call.

### Step 5: Build Marketing

Run:

```bash
pnpm --filter @sf/marketing build
```

Expected: clean Marketing production build. If environment-owned configuration
is unavailable, report the exact build blocker instead of substituting an old
build.

### Step 6: Review the final local diff and permission state

Run:

```bash
git status --short
git diff --stat
git diff -- \
  apps/marketing/src/components/agents/agent-profile-search-seeds.ts \
  apps/marketing/src/components/agents/agent-competitor-candidates.ts \
  apps/marketing/src/lib/account-websites/competitor-discovery.ts \
  apps/marketing/src/components/account/website-profile-editor.tsx \
  apps/marketing/e2e/account-settings.spec.ts \
  docs/plans/2026-08-28-marketing-website-competitor-discovery-design.md \
  docs/plans/2026-08-28-marketing-website-competitor-discovery-implementation.md
```

Verify every changed line traces to the approved request. Confirm there is no
database migration, `apps/web`, Worker, configuration, package, generated
contract, or unrelated formatting change. Stop with local uncommitted changes;
do not commit, push, open a PR, deploy, or call a real provider without new
authorization.
