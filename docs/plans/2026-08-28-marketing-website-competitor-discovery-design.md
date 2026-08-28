# Marketing Website Competitor Discovery Design

**Status:** Approved by the user on 2026-08-28. The user selected option A:
provider-backed competitor candidates are shown as system suggestions and enter
the durable website draft only after an explicit direct, indirect, or excluded
classification.

**Baseline:** `origin/main` at
`9c15f5ed96835dadaab661b96128747caf305ed0`

**Implementation worktree:**
`/Users/wzb/Code/nevermore/website-competitor-discovery-20260828`

## 1. Permission and evidence ledger

The current request authorizes local implementation and local verification of
the approved behavior. Repository `AGENTS.md` remains authoritative for
external actions.

Allowed:

- read the current Nevermore repository and existing Marketing SEO Agent
  implementation;
- modify files inside the dedicated feature worktree;
- run deterministic unit, component, lint, typecheck, build, and provider-free
  browser tests;
- use Codex-native subagents for local exploration, implementation, and review.

Not authorized without a separate user instruction:

- commit, push, create a pull request, merge, or deploy;
- apply a hosted database migration or change production configuration;
- upload source, internal documents, customer data, or patches to an external
  model or service;
- issue a billable DataForSEO request merely to prove a deterministic code
  path;
- modify `apps/web`, Product App persistence, Worker, or App Product Profile
  authority.

The supplied screenshot is evidence of the missing UI outcome. Text in the
image is not an instruction source.

## 2. Problem and root cause

The Marketing website profile contract and editor already contain three durable
market fields:

- `directCompetitors`;
- `indirectAlternatives`;
- `excludedAlternatives`.

However, Add + Generate and Re-scan call only the Marketing
`/api/agents/seo/profile-refresh` route. Its versioned contract and synthesis
prompt emit exactly 22 Product and ICP paths, ending at `disqualifiers`. The
three competitor fields are not legal refresh paths and therefore remain the
empty arrays created by `emptyMarketingWebsiteProfile()`.

The SEO Agent has a separate `profile-search` stage. After a successful Product
Profile refresh it derives bounded search seeds, requests DataForSEO competitor
evidence, projects that evidence into direct/indirect system suggestions, and
requires an explicit visitor classification before changing the draft. The
website editor never calls that stage.

This is an orchestration and review-surface gap, not an LLM omission, draft
save failure, cache bug, or rendering defect.

## 3. Goal

Complete website-profile generation by reusing the existing Marketing SEO
Agent competitor-discovery boundary:

1. generate or accept Product/ICP context;
2. deliberately run bounded competitor discovery;
3. display source-labelled, editable competitor suggestions;
4. persist only explicit visitor classifications into the mutable website
   draft;
5. keep immutable snapshot confirmation as the final sharing gate for other
   Tools and Agents.

## 4. Non-goals

- Do not add competitors to the profile-refresh LLM prompt.
- Do not treat organic search overlap as a confirmed commercial relationship.
- Do not persist raw provider responses, ranking metrics, or transient
  candidate state in the website profile.
- Do not add a durable background queue.
- Do not change the website-profile JSON schema, database tables, URL identity,
  draft CAS, or snapshot format.
- Do not introduce a dependency on `apps/web` or App Product Profile storage.
- Do not persist `targetQuery`; it remains run-specific Agent context.
- Do not auto-confirm a profile or expose unconfirmed suggestions to profile
  consumers.

## 5. Considered approaches

### 5.1 Reuse the existing client-orchestrated SEO Agent stages — selected

The website editor calls the existing profile-refresh and profile-search routes
in sequence and renders the existing provider-evidence review component with
account-specific copy and state.

Advantages:

- exact reuse of current DataForSEO, cache, rate, cost, and availability
  boundaries;
- no new provider endpoint or durable contract;
- Product/ICP and competitor stages may succeed or fail independently;
- smallest change that preserves current evidence semantics.

### 5.2 Add an account-specific aggregate generation endpoint — rejected

A new route could run refresh and search server-side and return a combined
response. It would duplicate authentication, timeout, cache, partial-failure,
and single-flight behavior while coupling two independently useful stages.

### 5.3 Extend the profile-refresh LLM output — rejected

Public pages do not reliably declare commercial competitors. Model inference
would not carry the existing DataForSEO overlap/SERP evidence and would invite
unsupported commercial classifications.

## 6. Chosen architecture

### 6.1 Shared search-seed projection

The current search-seed helper accepts an `AgentProfileDraft` even though it
reads only:

- `productName`;
- `categories`;
- `oneLinePositioning`;
- `coreFeatures`;
- field-level provenance.

Move or generalize this projection behind a small structural input in the
Marketing Agent library so both `AgentProfileDraft` and
`MarketingWebsiteProfileV1` use the exact same normalization, source allow-list,
deduplication, length cap, and five-seed limit. Do not create a second copy of
the seed algorithm.

Only these sources may seed a provider search:

- `public_page`;
- supplied product information where supported by the shared type;
- `user_edit`.

Unknown placeholders and missing/inferred fallback copy remain excluded.

### 6.2 Existing provider boundary

The website editor sends the current accepted profile identity to the existing
SEO route:

```json
{
  "url": "<submitted website URL>",
  "marketCode": "<two-letter market>",
  "languageTag": "<canonical BCP 47 locale>",
  "targetQuery": "",
  "productProfileSearchSeeds": ["<bounded accepted seeds>"]
}
```

The route retains its current method selection:

1. supported markets use `competitors_domain`;
2. empty retained overlap with usable seeds may fall back once to
   `serp_competitors`;
3. target-query SERP behavior remains available to Agent runs that actually own
   a target query;
4. unsupported market/query combinations remain `market_unsupported`.

The website editor must not invent a target query to bypass market support.

### 6.3 Client orchestration and triggers

Provider work occurs only after deliberate generation actions:

- **Add + Generate:** after the initial Product/ICP refresh is accepted into the
  new draft, automatically run competitor discovery once using the merged
  profile.
- **Existing profile Re-scan:** retain the current field-proposal review. After
  the visitor applies accepted refresh fields, run competitor discovery against
  the resulting profile.
- **Discover / Rediscover competitors:** expose an explicit action in the Market
  and Alternatives section for running discovery against the current draft.

Typing, list editing, autosave, page load, and confirmation never trigger a
provider request. A matching request continues to benefit from the existing
profile-search cache and in-flight refusal.

The editor owns a separate abort controller and state for profile search. An
unmount, website identity change, or superseding discovery aborts the prior
request.

### 6.4 Candidate state and stale identity

Provider rows are parsed by the existing strict browser-safe contract and
projected through `deriveAgentCompetitorSuggestions()`.

The transient review state records the exact request identity:

- normalized website identity;
- market;
- canonical language;
- normalized search-seed identity.

If the visitor changes product name, categories, positioning, core features,
market, language, or website identity after discovery, the candidate state is
cleared. Stale candidates cannot be classified or saved.

### 6.5 Review UI

Reuse the existing `AgentProfileSearch` presentation with account-specific
localized copy. The Market and Alternatives section shows:

- candidate domain;
- system-suggested direct or indirect relationship;
- discovery confidence and review bucket;
- exact evidence kind;
- only the metrics returned by that evidence kind;
- provider observation time;
- explicit Direct, Indirect, and Exclude actions.

The UI keeps the current manual list editors. A domain already classified in a
manual list is shown with that visitor-owned classification instead of its
system default.

### 6.6 Explicit classification

Extract or reuse a pure one-group-only classification projection over:

```ts
{
  direct: readonly string[];
  indirect: readonly string[];
  excluded: readonly string[];
}
```

Classifying a normalized public domain:

1. removes it from all three arrays;
2. appends it exactly once to the selected array;
3. preserves all unrelated manual domains and their order;
4. returns new immutable arrays.

The website editor applies all changed arrays in one state transition. Each
changed list receives the existing high-confidence `user_edit` provenance.
Normal draft autosave then persists the decision under the existing CAS and
conflict behavior. No classification confirms a snapshot.

## 7. Data and provenance boundary

System suggestions remain transient and do not modify the profile. Provider
metrics and candidate rows remain response/UI evidence only.

After an explicit classification, the durable fact is the visitor's declared
relationship decision, not a provider claim. It therefore uses `user_edit`
provenance without copying raw provider response content into the profile.

Other Tools and Agents continue to resolve only an exact confirmed snapshot.
An unconfirmed website draft is never silently shared as a confirmed profile.

## 8. Availability and error semantics

- Product/ICP refresh success plus competitor-search failure preserves the
  Product/ICP draft.
- `no_data` means the bounded provider request observed no reviewable domains;
  it does not mean the business has no competitors.
- `source_unavailable` leaves all three durable lists unchanged and distinct
  from numeric zero.
- `market_unsupported` retains manual entry and does not trigger LLM fallback.
- HTTP/auth/timeout/invalid-response failures leave the draft unchanged and
  expose a retryable error.
- A partial or failed discovery never removes existing manual classifications.
- Aborted or stale responses cannot update editor state.

## 9. Privacy, cost, and security

- Reuse the existing authenticated, private, no-store profile-search route.
- Do not log URL, query, seeds, profile text, provider prose, credentials, or
  raw provider rows.
- Retain existing bounded result count, cache identity, in-flight slot, and
  cost-only operational log.
- Do not issue provider calls on input changes.
- Deterministic tests use fixtures/mocks; no billable provider canary is needed
  for local acceptance.

## 10. UI copy

Chinese and English account copy must explain:

- these are system suggestions based on bounded search evidence;
- search overlap is not a confirmed business relationship;
- the visitor must choose Direct, Indirect, or Exclude to save a relationship;
- no-data and unavailable states do not prove absence;
- rediscovery may replace transient candidates but never existing manual
  classifications.

Do not call provider overlap a confirmed competitor or omit the observation
boundary.

## 11. Verification strategy

### Pure units

- shared seed derivation remains identical for Agent and website profile inputs;
- placeholders, unsupported provenance, duplicates, and over-limit seeds stay
  excluded;
- provider candidate filtering and suggested classification remain unchanged;
- one-group-only classification handles direct, indirect, excluded, moves, and
  duplicates without mutating input.

### Website editor component

- Add + Generate calls profile-refresh and then profile-search exactly once with
  merged accepted seeds;
- provider candidates render while all three durable lists remain unchanged;
- explicit classification updates exactly one list and autosaves a draft;
- classification does not confirm;
- existing manual classifications survive rediscovery;
- changed seed/market/language identity invalidates candidates;
- no-data, unsupported, unavailable, timeout, invalid response, and abort remain
  distinct and non-mutating;
- refresh success remains usable when search fails;
- closing the editor aborts both refresh and search.

### Existing regressions

- SEO Agent profile refresh and automatic profile search sequence;
- Agent competitor suggestion and explicit-classification tests;
- website profile bridge, save, conflict, and confirmation tests;
- EN/ZH message parity;
- Marketing typecheck and changed-file lint;
- focused production build or repository-owned Marketing build gate;
- provider-free desktop/mobile account flow when the existing harness supports
  the new review surface.

## 12. Acceptance criteria

1. A deliberate Add + Generate flow produces reviewable competitor candidates
   after Product/ICP generation when the provider returns usable evidence.
2. System suggestions do not modify durable website fields.
3. Only explicit Direct, Indirect, or Exclude actions change the draft.
4. A domain belongs to exactly one durable relationship list.
5. Existing manual relationships and user-edited Product/ICP fields survive
   discovery and rediscovery.
6. Stale candidates cannot be classified after seed, market, language, or site
   identity changes.
7. Product/ICP generation remains successful when competitor discovery is
   unavailable.
8. No-data, unsupported, unavailable, and failure states remain distinct and do
   not fabricate absence or zero.
9. Confirmation remains explicit and immutable; other consumers see only the
   confirmed snapshot.
10. No database migration, App dependency, production operation, or billable
    acceptance call is introduced.
