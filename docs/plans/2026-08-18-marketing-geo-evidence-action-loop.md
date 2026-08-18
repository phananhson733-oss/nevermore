# Marketing GEO Evidence and Action Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the existing Marketing-only ChatGPT citation probe into an honest, evidence-preserving GEO observation and action-handoff loop without claiming cross-platform coverage, durable recheck, publication, or guaranteed LLM citation.

**Architecture:** Keep the feature inside `apps/marketing`. First version the query and report contracts, then preserve provider annotations, derive orthogonal sample outcomes, reuse a locally confirmed Product/ICP context, render exact evidence, and generate a bounded 0–5 action packet for another Code Agent or Chatbot. Keep the paid run at eight selected questions × three samples; treat those eight as a versioned sentinel cohort, not complete demand coverage. Defer durable history, paired recheck, and additional engines until their storage/provider authority is separately approved.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, next-intl, Vitest, existing DataForSEO ChatGPT LLM Responses adapter.

---

## 0. Handoff identity

This handoff was prepared against the following read-only baseline on 2026-08-18:

- Repository: `/Users/wzb/Code/nevermore/geo-agent`
- Branch: `fix/marketing-geo-question-retrieval-20260817`
- Commit: `a029ac8c500900b9523713d69f6dce2559564f01`
- Remote: `https://github.com/phananhson733-oss/nevermore.git`
- Worktree at handoff start: clean
- Customer surface in scope: `gengrowth.ai`, implemented in `apps/marketing`
- Current collector: DataForSEO ChatGPT LLM Responses live endpoint
- Current upstream/model pin: OpenAI-derived response, server-pinned `gpt-5-2025-08-07`
- Current report contract: `agent_geo_report.v2`
- Current run size: 8 questions × 3 samples
- Current persistence: exactly `none`

The implementation agent must re-run the preflight below. If branch, HEAD, active instructions, or relevant files have materially drifted, stop and report the drift before editing.

The ChatGPT Pro review is an advisory second opinion, not product authority or validation evidence:

- <https://chatgpt.com/c/6a83c8af-b49c-83e8-8810-61b15ad12cf3>

No source files, internal documents, secrets, cookies, or user data were uploaded to that conversation.

## 1. Authority, permission, and hard boundaries

Read these files completely before changing code:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- root `package.json`
- `apps/marketing/package.json`
- every GEO source and test listed in §4

This task authorizes local implementation and local verification only. It does **not** authorize:

- commit;
- push;
- pull request creation;
- deploy or production verification;
- database migration;
- production environment-variable/provider-account changes;
- external CMS, GitHub, review-site, community, or customer-site writes;
- uploading repository material to ChatGPT Pro or another external service;
- operating a logged-in consumer ChatGPT, Claude, Perplexity, Gemini, or Grok UI as a product collection pipeline.

In-scope code is Marketing-owned code under `apps/marketing` plus directly related Marketing tests and this plan. Do not modify or wire through:

- `apps/web` (`app.gengrowth.ai`);
- `apps/worker`;
- canonical App OpenAPI or database authority;
- `packages/db` repositories or migrations;
- App Product Profile persistence;
- App Growth Map, Content Shadow, Approval, Publication, Measurement Window, or Results state machines;
- Supabase App tables;
- external publishing connectors.

The authenticated App chain may be consulted for concepts only. This Marketing Agent remains a noncanonical, private, short-lived acquisition surface.

If implementation requires any excluded surface, stop at a written decision record. Do not solve the boundary by importing an App repository into Marketing.

## 2. Product decisions that are already made

The implementation should not reopen these decisions unless current code proves one impossible.

### 2.1 Honest product name and scope

The current paid run is a **ChatGPT citation observation** collected through a DataForSEO API surface. It is not equivalent to:

- a logged-in consumer ChatGPT Pro answer;
- ChatGPT Search or Deep Research UI behavior;
- a measurement of Claude, Perplexity, Gemini, Google AI Overviews/AI Mode, or Grok;
- a complete GEO score;
- proof that a page was retrieved internally;
- proof that a brand was recommended;
- proof that a content change caused a later outcome.

UI and contracts must carry separate provenance fields for collector, upstream, surface, model label, market, language, and search mode. Never render the collector as if it were consumer ChatGPT.

### 2.2 The eight questions

Eight remains the **paid sentinel cohort size** in P0 because the current cost/time guard is calibrated for 24 calls. Eight is not a claim of comprehensive query coverage.

The contract must distinguish:

- `core`: stable sentinel query used for comparable baselines;
- `explore`: an optional candidate used for discovery, excluded from a core-cohort comparison unless promoted in a new query-set version;
- `natural_demand`: a natural buyer question where mention/consideration matters even if search is not triggered;
- `retrieval_probe`: a current/source-seeking question deliberately used to observe citations.

P0 should ship one deterministic `core_8` cohort with one question per intent slot:

1. category discovery;
2. JTBD / desired outcome;
3. pain, how-to, or workflow;
4. constraint-based fit;
5. alternative/status quo/build-versus-buy;
6. brand-versus-competitor comparison;
7. one due-diligence axis: review, pricing, integration, security, or trust;
8. negative fit, objection, or trust boundary.

Default mix: five unbranded questions and three brand/mixed questions. Each query has exactly one primary intent. Do not combine “which should I pick?” with “what do reviews say?” in one query.

A later version may maintain 20–40 candidates per market/language, recommended initial library size 32. Do not multiply paid calls to 32 × 3 in this task. P0 only needs a versioned query contract that can represent a larger library and deterministically select/confirm eight.

### 2.3 Observation dimensions

Do not keep a single mutually exclusive `GeoSampleState` as the only truth. The new contract must represent independently:

- provider call status;
- answer availability;
- web-search execution;
- citation evaluability;
- exact visible citations;
- target-domain citation;
- third-party brand-source citation, when deterministically supportable;
- brand mention;
- recommendation/evaluation status;
- limitations.

Important P0 honesty rule: brand mention can be deterministically observed from bounded aliases and answer text. Recommendation stance cannot be safely inferred from a generic substring heuristic. Unless the implementation adds a separately specified, tested, source-labeled evaluator without changing the measured answer, set recommendation to `not_evaluated`. Do not turn “not evaluated” into “not recommended”.

### 2.4 Evidence semantics

Current code parses DataForSEO message-section annotations. Those annotations are visible citations. They are not automatically complete OpenAI `sources`, retrieval traces, or related links.

- Emit `cited` only for a valid message annotation actually attached to answer prose.
- Emit `retrieved` only if a future provider adapter exposes an explicit retrieval record with documented semantics and a contract fixture.
- Emit `related_link` only if the provider exposes that distinct record.
- When neither exists, set retrieval/related-link availability to `unavailable`; do not infer retrieval from a citation or cited host.
- Preserve exact URL, title, annotation text, and valid start/end indices when supplied.
- If a field is absent, use `null`; do not synthesize title, annotation text, source-page excerpt, or index.
- Never preserve the full answer in the client report. Use the existing answer only inside the server sampling boundary, and keep bounded citation/mention evidence.

### 2.5 Action loop

The report may generate **0–5** actions. Zero is valid when evidence is insufficient, no controllable gap exists, an existing page already fits, or the required action is an offsite/legal/product decision.

Action selection follows existing-page-first:

| Observed gap | Preferred action |
| --- | --- |
| crawl/index/render blocker | fix the existing page or technical surface |
| matching existing page lacks a concise supported answer | enhance that page |
| explanatory or how-to gap | blog/guide |
| persona/use-case fit gap | landing page |
| brand-versus-alternative gap | comparison page |
| price/integration/security/current-fact gap | pricing, integration docs, security, or trust page |
| repeatable user task with real utility | public tool |
| missing unique evidence | research/dataset/methodology asset |
| recommendation depends on independent consensus | human-led case study, review, community, analyst, media, or partner plan |

Do not default every gap to a blog. Do not generate thin programmatic pages. Do not promise citation or recommendation.

“Existing-page-first” also needs evidence. In P0 the entered URL is the only page identity known with certainty. Recommend enhancing it only when confirmed context/page type makes the fit explicit. Otherwise return `needs_page_inventory` as an unknown/next decision; do not invent a matching page and do not recommend a new page merely because no inventory was collected.

### 2.6 Delivery boundary

P0 produces a reviewed, copyable prompt packet for a Code Agent or Chatbot. It does not publish.

Keep these facts separate:

`suggested → selected → packet_generated → user_copied`

The following facts do not exist in P0 and must not be implied:

`approved_revision → authorized_delivery → published → delivery_verified → outcome_observed`

## 3. Definition of done

P0 is done only when all of the following are true:

1. A confirmed, source-labeled Marketing profile produces a versioned `core_8` query set for one explicit market and language.
2. The UI labels `core_8` as a sentinel cohort and separates natural-demand queries from retrieval probes.
3. Paid-call count remains bounded and shown before execution.
4. The server rejects unconfirmed or contract-invalid query sets before budget claim/provider work.
5. Provider citation annotations retain exact URL, optional title, optional annotation text, and optional valid span.
6. A no-search answer can still record a brand mention while citation evaluation remains not applicable.
7. Citation, mention, search execution, recommendation evaluation, and availability are independent fields.
8. Report denominators show scheduled/answered/search-executed/citation-evaluable/unavailable separately.
9. The report shows exact evidence links, not only host chips.
10. Collector/upstream/surface/model/market/language/query-set version are visible.
11. The report generates 0–5 deterministic action candidates from observed gaps and lets the user explicitly select them.
12. A selected action produces a bounded, human-reviewable `GeoActionHandoffV1` packet with evidence IDs and limitations, not the whole report or full provider answer.
13. The UI clearly states that the report is not stored and that durable paired recheck is unavailable in P0.
14. No App DB, migration, multi-platform adapter, consumer-browser automation, CMS write, deploy, or production operation is added.
15. Focused unit tests, Marketing lint/typecheck/build, and the repository secret scan pass.

## 4. Existing implementation map

Primary files:

- `apps/marketing/src/components/agents/geo/geo-workbench.tsx`
  - local context/question/run/report stages;
  - currently asks for URL/category/buyer/rivals;
  - currently hardcodes market `US`;
  - currently passes no explicit brand aliases.
- `apps/marketing/src/lib/agents/geo-questions.ts`
  - deterministic English-only eight-question generator;
  - currently optimized mostly for search triggering, not intent coverage.
- `apps/marketing/src/lib/agents/geo-provider.ts`
  - only DataForSEO transport;
  - parses message annotations but discards title/text/span and returns only URLs.
- `apps/marketing/src/lib/agents/geo-sampling.ts`
  - currently collapses an answer into one mutually exclusive state;
  - currently returns early to `search_not_performed`, losing mention semantics.
- `apps/marketing/src/lib/agents/geo-report-contract.ts`
  - strict public `agent_geo_report.v2` guard;
  - 8 questions × 3 samples;
  - exact-key validation and recomputed aggregates;
  - `persistence: "none"`.
- `apps/marketing/src/lib/agents/geo-run-handler.ts`
  - auth, pre-billing validation, budget, provider execution, report assembly;
  - current single provider/model pin.
- `apps/marketing/src/components/agents/geo/geo-report-view.tsx`
  - current host/count report.
- `apps/marketing/src/i18n/messages/en.json`
- `apps/marketing/src/i18n/messages/zh.json`

Existing tests:

- `apps/marketing/src/lib/agents/geo-questions.test.ts`
- `apps/marketing/src/lib/agents/geo-provider.test.ts`
- `apps/marketing/src/lib/agents/geo-sampling.test.ts`
- `apps/marketing/src/lib/agents/geo-report-contract.test.ts`
- `apps/marketing/src/lib/agents/geo-run-handler.test.ts`
- `apps/marketing/src/app/api/agents/geo/run/route.test.ts`
- `apps/marketing/src/lib/agents/geo-cost-guard.test.ts`

Reusable Marketing-only context seam:

- `apps/marketing/src/components/agents/agent-profile.ts`
  - `AgentProfileDraft` already contains Product, ICP, JTBD, use cases, outcomes, barriers, competitors, country, locale, source labels, per-field provenance, and local confirmation;
  - `confirmAgentProfile`, `isAgentProfileReady`, and strict browser guards already exist;
  - its current `AgentKind` only admits SEO/Tech. Do not casually add GEO to all shared flows. Prefer extracting/reusing browser-safe profile primitives or adding a narrow GEO adapter with tests.
- `apps/marketing/src/components/agents/agent-profile-search-seeds.ts`
  - existing source-aware seed derivation.
- `apps/marketing/src/components/agents/agent-intent.ts`
  - ten-minute `sessionStorage` handoff used only for auth/resume UX;
  - this is not durable report storage and must not be relabeled as such.

Reference-only App query cohort:

- `packages/db/src/repositories/product-profile-ai-cohort.ts`
  - may inform taxonomy wording;
  - must not be imported into Marketing or used to introduce App persistence.

## 5. Target contracts

Names may be adjusted to local style, but semantics and boundaries are required.

### 5.1 Confirmed context snapshot

Create a Marketing-owned pure contract, suggested file:

- `apps/marketing/src/lib/agents/geo-context.ts`
- `apps/marketing/src/lib/agents/geo-context.test.ts`

Suggested shape:

```ts
export interface GeoContextSnapshotV1 {
  readonly schemaVersion: "geo_context.v1";
  readonly targetUrl: string;
  readonly targetHost: string;
  readonly productName: string;
  readonly brandAliases: readonly string[];
  readonly category: string;
  readonly buyer: string;
  readonly user: string;
  readonly jtbd: string;
  readonly useCases: readonly string[];
  readonly outcomes: readonly string[];
  readonly barriers: readonly string[];
  readonly directCompetitors: readonly string[];
  readonly indirectAlternatives: readonly string[];
  readonly marketCode: string;
  readonly languageTag: string;
  readonly sourceProfileVersion: string;
  readonly sourceSummary: readonly {
    readonly field: string;
    readonly source: string;
    readonly limitation: string | null;
  }[];
  readonly confirmedAt: string;
  readonly contextHash: string;
}
```

Requirements:

- derive only from a locally confirmed Marketing profile;
- show source/limitation to the user before paid sampling;
- derive the hash deterministically from canonical JSON;
- never treat an inferred/missing field as declared fact;
- target URL normalization remains server-authoritative;
- no broad new crawler or SSRF surface in this task;
- if public-page refresh is used, reuse the existing Marketing-safe refresh seam and its evidence provenance.

### 5.2 Versioned query set

Replace free-floating `questionId/question/stage` with a strict query unit. Suggested file:

- `apps/marketing/src/lib/agents/geo-query-contract.ts`
- `apps/marketing/src/lib/agents/geo-query-contract.test.ts`

```ts
export type GeoQueryMode = "natural_demand" | "retrieval_probe";
export type GeoQueryCohort = "core" | "explore";
export type GeoBrandStance = "unbranded" | "brand" | "mixed";

export interface GeoQueryUnitV1 {
  readonly queryId: string;
  readonly slot:
    | "category_discovery"
    | "jtbd_outcome"
    | "pain_how_to"
    | "constraint_fit"
    | "alternative_status_quo"
    | "brand_comparison"
    | "due_diligence"
    | "negative_fit_objection";
  readonly text: string;
  readonly cohort: GeoQueryCohort;
  readonly mode: GeoQueryMode;
  readonly brandStance: GeoBrandStance;
  readonly buyerStage: "awareness" | "consideration" | "decision";
  readonly marketCode: string;
  readonly languageTag: string;
  readonly timeSensitive: boolean;
  readonly asOf: string | null;
  readonly expectedAssetTypes: readonly GeoAssetType[];
  readonly source: "profile" | "user_edit" | "llm_candidate";
  readonly userConfirmed: boolean;
}

export interface GeoQuerySetV1 {
  readonly schemaVersion: "geo_query_set.v1";
  readonly querySetId: string;
  readonly version: number;
  readonly templateVersion: string;
  readonly contextHash: string;
  readonly marketCode: string;
  readonly languageTag: string;
  readonly queries: readonly GeoQueryUnitV1[];
  readonly querySetHash: string;
  readonly confirmedAt: string | null;
}
```

Rules:

- exact eight `core` slot identities for a paid P0 run;
- no duplicate slot in `core_8`;
- each query has one primary intent;
- no accidental mixed-language templates except proper nouns;
- time-sensitive query requires `asOf`;
- editing text, market, language, or slot creates a new set hash/version;
- a paid run requires all selected queries `userConfirmed: true`;
- `explore` queries cannot silently alter a core verdict;
- query-set hash is recomputed by server/guard, never trusted from client.

### 5.3 Provider citation annotation

Extend `GeoProviderObservation` in `geo-provider.ts`:

```ts
export interface GeoProviderCitationAnnotation {
  readonly url: string;
  readonly title: string | null;
  /** Text attached to the answer annotation, not a source-page excerpt. */
  readonly annotationText: string | null;
  readonly messageIndex: number;
  readonly sectionIndex: number;
  readonly startIndex: number | null;
  readonly endIndex: number | null;
  readonly spanBasis: "provider_message_section_text";
}

export interface GeoProviderObservation {
  readonly observedAt: string;
  readonly webSearchPerformed: boolean;
  readonly answerText: string; // server-only sampling input
  readonly citations: readonly GeoProviderCitationAnnotation[];
  readonly costUsd: number | null;
  readonly model: string;
}
```

Parsing rules:

- only message-section annotations;
- `type` absent or `url_citation`, matching current verified provider behavior;
- HTTP(S) URL only;
- validate index pair: integers, `0 <= start <= end <= section.text.length`; otherwise both null;
- bounded title/annotation text; do not copy unbounded provider prose;
- retain the message/section location because provider indices are section-relative, not offsets into the newline-joined answer;
- deterministic dedup key should include normalized exact URL, message/section location, and span, not host alone;
- preserve distinct citations to different paths on the same host;
- do not add `retrieved` from these annotations.

### 5.4 Report v3 sample

Bump the report schema because existing strict clients must reject changed semantics before billing.

Suggested contract:

```ts
export type GeoCallStatus = "answered" | "unavailable";
export type GeoCitationStatus =
  | "observed_target"
  | "observed_others_only"
  | "observed_none"
  | "not_applicable"
  | "unavailable";
export type GeoMentionStatus = "observed" | "not_observed" | "unavailable";
export type GeoRecommendationStatus =
  | "not_evaluated"
  | "considered"
  | "recommended"
  | "conditionally_recommended"
  | "recommended_against";

export interface GeoEvidenceRefV1 {
  readonly evidenceId: string;
  readonly kind: "cited" | "mention" | "evaluation";
  readonly exactUrl: string | null;
  readonly domain: string | null;
  readonly title: string | null;
  /** Bounded answer-annotation text; never label it a source-page excerpt. */
  readonly annotationText: string | null;
  readonly messageIndex: number | null;
  readonly sectionIndex: number | null;
  readonly startIndex: number | null;
  readonly endIndex: number | null;
  readonly ownership: "target" | "competitor" | "third_party" | "unknown";
  readonly matchedAlias: string | null;
  readonly sourceType:
    | "owned_page"
    | "competitor_owned_page"
    | "marketplace"
    | "review_site"
    | "community"
    | "editorial"
    | "documentation"
    | "other"
    | "unknown";
}

export interface GeoSampleV3 {
  readonly sampleId: string;
  readonly sampleIndex: number;
  readonly callStatus: GeoCallStatus;
  readonly observedAt: string | null;
  readonly webSearchPerformed: boolean | null;
  readonly citationStatus: GeoCitationStatus;
  readonly mentionStatus: GeoMentionStatus;
  readonly recommendationStatus: GeoRecommendationStatus;
  readonly evidence: readonly GeoEvidenceRefV1[];
  readonly limitation: GeoSampleLimitation | null;
}
```

P0 recommendation rule:

- use `not_evaluated` for every sample unless a separately reviewed evaluator is implemented;
- do not infer `recommended` merely because a brand is cited or mentioned;
- do not infer `recommended_against` from a generic negative word near the brand.

Aggregate counts must be derived from samples and recomputed by the strict browser/server guard. At minimum show:

- `scheduledSamples`;
- `answeredSamples`;
- `searchPerformedSamples`;
- `citationEvaluableSamples`;
- `targetCitedIn`;
- `mentionEvaluableSamples`;
- `targetMentionedIn`;
- `unavailableSamples`.

Do not turn these into a single score. Small samples render as raw counts such as `1 / 3 citation-evaluable samples`.

### 5.5 Run provenance

Replace the ambiguous provider label with explicit provenance:

```ts
export interface GeoSurfaceProvenanceV1 {
  readonly collector: "dataforseo";
  readonly upstream: "openai";
  readonly surface: "dataforseo_chat_gpt_llm_responses_api";
  readonly searchMode: "web_search_permitted";
  readonly modelRequested: string;
  readonly modelObserved: readonly string[];
  readonly marketCode: string;
  readonly languageTag: string;
  readonly samplesPerQuery: number;
  readonly costUsd: number;
}
```

If actual observed model labels differ across samples, preserve the deduped list. Do not overwrite them with only the requested pin.

### 5.6 Action recommendation and handoff

Create pure, deterministic mapping code:

- `apps/marketing/src/lib/agents/geo-action-mapping.ts`
- `apps/marketing/src/lib/agents/geo-action-mapping.test.ts`
- `apps/marketing/src/lib/agents/geo-action-handoff.ts`
- `apps/marketing/src/lib/agents/geo-action-handoff.test.ts`

```ts
export type GeoAssetType =
  | "existing_page_enhancement"
  | "blog_guide"
  | "use_case_landing"
  | "comparison_page"
  | "pricing_page"
  | "integration_docs"
  | "security_trust_page"
  | "public_tool"
  | "research_dataset"
  | "offsite_authority_plan"
  | "technical_fix";

export interface GeoActionCandidateV1 {
  readonly actionId: string;
  readonly assetType: GeoAssetType;
  readonly title: string;
  readonly reason: string;
  readonly queryIds: readonly string[];
  readonly sampleIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly targetUrl: string | null;
  readonly unknowns: readonly string[];
  readonly limitations: readonly string[];
  readonly requiresHumanReview: true;
}

export interface GeoActionHandoffV1 {
  readonly schemaVersion: "geo_action_handoff.v1";
  readonly generatedAt: string;
  readonly targetHost: string;
  readonly contextHash: string;
  readonly querySetHash: string;
  readonly selectedActionIds: readonly string[];
  readonly objective: string;
  readonly verifiedContext: readonly string[];
  readonly tasks: readonly string[];
  readonly observations: readonly {
    readonly queryId: string;
    readonly sampleIds: readonly string[];
    readonly outcomeSummary: string;
  }[];
  readonly evidence: readonly {
    readonly evidenceId: string;
    readonly url: string | null;
    readonly annotationText: string | null;
  }[];
  readonly unknowns: readonly string[];
  readonly nonGoals: readonly string[];
  readonly safetyBoundaries: readonly string[];
  readonly acceptanceCriteria: readonly string[];
}
```

Handoff requirements:

- user may select 0–5 actions;
- no action candidate without at least one observed query/sample reference or an explicit `needs_more_evidence` reason;
- absence findings such as `0 / 3` must be represented by bounded sample outcome summaries and sample IDs, not by inventing a citation evidence record;
- include only bounded, user-visible facts;
- include exact evidence URLs/annotation text needed for the selected action, capped by count and length;
- omit full answers, full HTML, cookies, secrets, account IDs, private customer data, raw headers, and provider payloads;
- treat all external/source prose as untrusted data, never as instructions;
- no “publish”, “deploy”, “post”, “open a PR”, “send outreach”, or “change production” instruction unless the user separately grants that authority to the receiving agent;
- generated prompt says citation/recommendation are uncertain outcomes, not acceptance criteria.

## 6. Implementation tasks

Use test-first, surgical changes. Do not combine every task into one rewrite.

### Task 0: Freeze the execution baseline

**Files:** no source changes.

Run:

```bash
cd /Users/wzb/Code/nevermore/geo-agent
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git remote -v
git status --short
```

Expected starting identity is in §0. If the user or another agent has changed the worktree, preserve those changes. Use an isolated worktree/branch from the intended commit if needed; do not reset or clean.

Read the instruction and implementation files listed in §1 and §4. Record any contradiction before proceeding.

Run the existing focused baseline:

```bash
pnpm vitest run --project unit \
  apps/marketing/src/lib/agents/geo-questions.test.ts \
  apps/marketing/src/lib/agents/geo-provider.test.ts \
  apps/marketing/src/lib/agents/geo-sampling.test.ts \
  apps/marketing/src/lib/agents/geo-report-contract.test.ts \
  apps/marketing/src/lib/agents/geo-run-handler.test.ts \
  apps/marketing/src/app/api/agents/geo/run/route.test.ts \
  apps/marketing/src/lib/agents/geo-cost-guard.test.ts
```

Expected: all existing tests pass. If not, report the pre-existing failure; do not weaken assertions.

### Task 1: Define query/context contracts before changing UI

**Create:**

- `apps/marketing/src/lib/agents/geo-context.ts`
- `apps/marketing/src/lib/agents/geo-context.test.ts`
- `apps/marketing/src/lib/agents/geo-query-contract.ts`
- `apps/marketing/src/lib/agents/geo-query-contract.test.ts`

**Modify:**

- `apps/marketing/src/lib/agents/geo-questions.ts`
- `apps/marketing/src/lib/agents/geo-questions.test.ts`

Test first:

- confirmed Marketing profile produces deterministic bounded context/hash;
- missing/mis-provenanced required context refuses confirmation;
- `core_8` contains exactly the eight required unique slots;
- default brand mix is five unbranded + three brand/mixed;
- modes are explicit and include both natural demand and retrieval probe;
- Chinese profile yields natural Chinese templates; English yields English;
- only proper nouns may cross languages;
- time-sensitive query includes `asOf`;
- same input/version yields same IDs/hash;
- edited query yields a new hash and `source: user_edit`;
- unconfirmed query set is not runnable;
- explore candidates do not change core aggregate identity.

Implement the smallest pure contract/generator that passes. Do not add an LLM call for question generation. Do not add a crawl.

Checkpoint command:

```bash
pnpm vitest run --project unit \
  apps/marketing/src/lib/agents/geo-context.test.ts \
  apps/marketing/src/lib/agents/geo-query-contract.test.ts \
  apps/marketing/src/lib/agents/geo-questions.test.ts
```

### Task 2: Preserve provider annotation evidence

**Modify:**

- `apps/marketing/src/lib/agents/geo-provider.ts`
- `apps/marketing/src/lib/agents/geo-provider.test.ts`

Write failing fixtures for:

- annotation with missing `type` and valid URL/title/text/span;
- `url_citation` annotation;
- two different paths on one host;
- same URL at two answer spans;
- invalid URL/protocol;
- invalid or out-of-range span;
- overlong title/text bounded or rejected per the chosen contract;
- annotation from a reasoning item ignored;
- bare `{url}` without title/text ignored, preserving existing safety behavior;
- actual model label retained.

Replace URL-only extraction with annotation extraction. Keep full answer text server-only. Do not log provider prose.

Checkpoint:

```bash
pnpm vitest run --project unit apps/marketing/src/lib/agents/geo-provider.test.ts
```

### Task 3: Introduce report v3 and orthogonal sampling

**Modify:**

- `apps/marketing/src/lib/agents/geo-report-contract.ts`
- `apps/marketing/src/lib/agents/geo-report-contract.test.ts`
- `apps/marketing/src/lib/agents/geo-sampling.ts`
- `apps/marketing/src/lib/agents/geo-sampling.test.ts`

Start by writing v3 guard/derivation tests for:

- no-search answer that mentions the brand:
  - `callStatus: answered`;
  - `webSearchPerformed: false`;
  - `citationStatus: not_applicable`;
  - `mentionStatus: observed`;
  - `recommendationStatus: not_evaluated`;
- searched answer citing target and third parties;
- searched answer citing multiple target paths;
- searched answer with no citations;
- provider failure with null observation fields and typed limitation;
- exact evidence URL/title/annotation text/section-relative span survives;
- competitor ownership does not erase third-party evidence;
- unknown source type remains `unknown`, never guessed as review/editorial;
- aggregate/coverage numbers are recomputed and inconsistent payloads rejected;
- `unavailable` and `not_applicable` never enter a positive/negative denominator;
- legacy v2 payload is rejected by the v3 guard.

Then replace the mutually exclusive classification as the primary contract. A compatibility helper may exist only inside tests/migration-free local code if needed; do not continue rendering the old state as the source of truth.

Source-type classification must use a small explicit allowlist for known classes and return `unknown` otherwise. Do not build a speculative web taxonomy service.

Checkpoint:

```bash
pnpm vitest run --project unit \
  apps/marketing/src/lib/agents/geo-report-contract.test.ts \
  apps/marketing/src/lib/agents/geo-sampling.test.ts
```

### Task 4: Update the paid run boundary

**Modify:**

- `apps/marketing/src/lib/agents/geo-run-handler.ts`
- `apps/marketing/src/lib/agents/geo-run-handler.test.ts`
- `apps/marketing/src/app/api/agents/geo/run/route.test.ts`

The request must carry the report schema version, confirmed context snapshot, and confirmed query set. Server validation must happen before provider creation, daily-budget claim, or paid calls.

Tests:

- v2 client rejected before billing;
- unconfirmed profile/query set rejected before billing;
- client-supplied target host/hash/aggregate mismatch rejected;
- market/language mismatch between context and query set rejected;
- exact eight confirmed `core` queries accepted;
- call count remains 24;
- provider observed model labels appear in run provenance;
- cost and time ceiling behavior remains partial, not discarded;
- complete v3 envelope passes the same strict guard the browser uses;
- full answer text is absent from serialized response;
- `Cache-Control: no-store, private` remains.

Keep one provider and the server-side model pin. Do not add a generic multi-provider abstraction in this task.

Checkpoint:

```bash
pnpm vitest run --project unit \
  apps/marketing/src/lib/agents/geo-run-handler.test.ts \
  apps/marketing/src/app/api/agents/geo/run/route.test.ts \
  apps/marketing/src/lib/agents/geo-cost-guard.test.ts
```

### Task 5: Rework the workbench around confirmed context and core_8

**Modify:**

- `apps/marketing/src/components/agents/geo/geo-workbench.tsx`
- the smallest Marketing profile component/helper files needed for narrow reuse
- `apps/marketing/src/i18n/messages/en.json`
- `apps/marketing/src/i18n/messages/zh.json`

**Create if useful:**

- `apps/marketing/src/components/agents/geo/geo-workbench.test.tsx`
- `apps/marketing/src/components/agents/geo/geo-query-review.tsx`

Required UX sequence:

1. enter public URL;
2. build/reuse Product + ICP + JTBD + competitor + market + language context;
3. show field provenance and limitations;
4. user confirms context;
5. generate deterministic versioned `core_8`;
6. show slot, mode, brand stance, and editable text;
7. edits create a new query-set identity;
8. user confirms the query set;
9. show exact paid-call count and surface identity;
10. authenticate, validate, and run.

Remove the hardcoded `US`. Market and language come from confirmed context. Do not silently infer market from UI locale. Make brand aliases visible/editable and bounded; do not rely only on hostname-derived tokens.

Copy requirements:

- “8 core questions are a reproducible sentinel cohort, not the complete question space.”
- distinguish natural-demand and retrieval-probe labels;
- identify collector/API surface;
- explain 3 samples as variability evidence, not probability;
- do not promise that a search will occur merely because web search is permitted.

Keep sign-in and double-submit/cancellation guards intact.

### Task 6: Render evidence and honest denominators

**Modify:**

- `apps/marketing/src/components/agents/geo/geo-report-view.tsx`
- `apps/marketing/src/i18n/messages/en.json`
- `apps/marketing/src/i18n/messages/zh.json`

**Create:**

- `apps/marketing/src/components/agents/geo/geo-report-view.test.tsx`

Required report hierarchy:

1. run identity: collector, upstream, API surface, requested/observed model, market, language, query-set version/hash prefix, sample date;
2. coverage: scheduled, answered, searched, citation-evaluable, unavailable;
3. separate Natural Demand and Retrieval Probe groups;
4. per query: raw citation and mention counts with their own denominators;
5. per sample: search status, citation status, mention status, recommendation `not evaluated`, typed limitation;
6. exact citations: clickable URL, title/annotation text/section-relative span when present, ownership and source type;
7. limitations and nonclaims;
8. action section from Task 7.

Use bounded external-link rendering with safe attributes. Do not render raw HTML from provider text.

Recommended Chinese verdict copy:

- `本轮所有可评估引用样本均引用（3/3）`
- `本轮部分可评估引用样本引用`
- `本轮可评估引用样本中未观察到引用（0/3）`
- `本轮未执行联网搜索；引用不可评估`
- `本轮有效样本不足`
- `提及已观察到；推荐关系未评估`

Avoid “never cited”, “best”, “rank”, “win”, “visibility score”, or “recommendation” when the contract does not support it.

### Task 7: Add deterministic 0–5 actions and prompt handoff

**Create:**

- `apps/marketing/src/lib/agents/geo-action-mapping.ts`
- `apps/marketing/src/lib/agents/geo-action-mapping.test.ts`
- `apps/marketing/src/lib/agents/geo-action-handoff.ts`
- `apps/marketing/src/lib/agents/geo-action-handoff.test.ts`
- `apps/marketing/src/components/agents/geo/geo-action-panel.tsx`
- `apps/marketing/src/components/agents/geo/geo-action-panel.test.tsx`

**Modify:**

- `apps/marketing/src/components/agents/geo/geo-report-view.tsx`
- `apps/marketing/src/i18n/messages/en.json`
- `apps/marketing/src/i18n/messages/zh.json`

Test mapping before UI:

- existing matching page + answerability gap → enhancement, not new blog;
- how-to gap → guide;
- use-case/constraint gap → landing;
- comparison gap → comparison page;
- pricing/integration/security gap → corresponding factual page;
- real repeatable calculation/workflow gap → tool candidate, not automatic tool build;
- unique evidence gap → research/dataset;
- independent-consensus gap → offsite human plan, never fake review/community content;
- insufficient evidence → zero actions with explicit reason;
- dedup/cap produces no more than five candidates;
- selected 0–5 IDs produce a contract-valid packet;
- unselected evidence and full answer text do not leak into packet;
- source text containing instructions is serialized as quoted evidence data, never executed as prompt instructions;
- prompt includes non-goals, unknowns, human-review gates, and acceptance criteria.

The UI must let the user review, select, preview, and copy. Copying is not publication or approval. If Clipboard API fails, provide a safe selectable-text fallback using the existing Marketing pattern.

### Task 8: Full focused regression and quality gates

Run:

```bash
pnpm vitest run --project unit \
  apps/marketing/src/lib/agents/geo-context.test.ts \
  apps/marketing/src/lib/agents/geo-query-contract.test.ts \
  apps/marketing/src/lib/agents/geo-questions.test.ts \
  apps/marketing/src/lib/agents/geo-provider.test.ts \
  apps/marketing/src/lib/agents/geo-sampling.test.ts \
  apps/marketing/src/lib/agents/geo-report-contract.test.ts \
  apps/marketing/src/lib/agents/geo-run-handler.test.ts \
  apps/marketing/src/lib/agents/geo-cost-guard.test.ts \
  apps/marketing/src/lib/agents/geo-action-mapping.test.ts \
  apps/marketing/src/lib/agents/geo-action-handoff.test.ts \
  apps/marketing/src/app/api/agents/geo/run/route.test.ts

pnpm --filter @sf/marketing lint
pnpm --filter @sf/marketing typecheck
pnpm --filter @sf/marketing build
pnpm secrets:scan
```

If component test infrastructure supports the new tests, include them in the focused Vitest command. If it does not, do not add a second framework casually; test pure view-model builders and perform a local browser check.

Browser acceptance, local only:

- English and Chinese context/query review;
- no accidental mixed-language query;
- explicit market/language;
- exactly eight confirmed core queries and 24 call preview;
- signed-out run opens auth and does not bill;
- report shows exact citation links and distinct denominators;
- no-search + brand mention is visible and not called a citation/recommendation;
- zero-action state renders legitimately;
- selecting actions produces a bounded copyable handoff;
- refresh/close messaging still says the report is not stored.

Finally run:

```bash
git status --short
git diff --check
git diff --stat
git diff -- apps/marketing docs/plans/2026-08-18-marketing-geo-evidence-action-loop.md
```

Review every changed line against this handoff. Do not commit, push, PR, deploy, or migrate without new explicit authorization.

## 7. Stop gates and follow-up phases

### 7.1 Durable baseline/recheck stop gate

A genuine before/after loop requires immutable, private, Marketing-owned report persistence. Current code truthfully says `persistence: "none"`.

Do not fake durability with `sessionStorage`, an expiry label, or a client-only “saved” badge. Before implementing persistence, present a separate decision with:

- data classification and retention period;
- authenticated ownership/access rules;
- schema and immutable cohort identity;
- deletion/export behavior;
- cost ledger linkage;
- storage service and migration authority;
- whether this remains Marketing-owned without App DB coupling.

Until approved, P0 must say paired recheck/history is unavailable. A user can copy/export the handoff, but that is not a stored baseline.

### 7.2 Multi-platform stop gate

Do not add Perplexity, Anthropic, Gemini, Google AI Overviews, or xAI in this implementation. Each requires a separate adapter and terms/compliance review.

Recommended later sequence:

1. retain the current API-derived surface as one explicit adapter;
2. add official API surfaces independently, preserving provider/surface provenance;
3. consider Perplexity Agent API, Anthropic Web Search, and xAI Web Search only after credentials/cost/terms approval;
4. treat Gemini grounding separately and obtain legal/terms review before using results for product benchmarking;
5. treat Google AI Overviews/AI Mode as a separate Search surface, not a Gemini proxy;
6. consider a compliant consumer/search panel only after automation, account, personalization, geography, and retention rules are explicit.

Never merge platform results into a single GEO score. Compare only matching query text/version, market, language, surface/search mode, sample policy, and time window.

### 7.3 Recommendation evaluator stop gate

Before adding automated `recommended`, `conditionally_recommended`, or `recommended_against` outcomes, specify:

- evaluator method and version;
- supported languages;
- bounded input;
- gold-set labels and human adjudication;
- abstention/unknown behavior;
- false-positive tolerance;
- cost and latency impact;
- whether evaluator output is deterministic inference or provider-observed fact.

Until that gate passes, P0 reports recommendation as `not_evaluated`.

### 7.4 Publication stop gate

The action packet may suggest a page/tool/research task. It may not publish, request fake reviews, post to community sites, contact media, or edit a customer site. Any external write needs exact target, exact revision, user approval, idempotency, rollback, receipt, and post-write verification under a separately authorized task.

## 8. Later product roadmap, not P0 acceptance

### V1: durable paired observation

- approved Marketing-owned private store;
- immutable context/query-set/report revisions;
- publication receipt supplied by user and publicly rechecked;
- same-cohort paired resample;
- explicit comparability breaks;
- D+14/D+28 observed deltas;
- no causal claim from a simple before/after change.

### V1.5: 20–40 query library

- stable `core_8` plus versioned explore pool;
- source-labeled candidates from confirmed profile, Search Console/search evidence, support/sales questions, competitor evidence, and user input;
- no LLM candidate presented as measured demand;
- per-market/per-language libraries;
- set-cover selection rather than Cartesian-product page/query generation.

### V2: multiple explicit surfaces

- independent adapters and provenance;
- fixed comparison cohorts;
- retrieval/citation/mention/recommendation ladder;
- cross-surface reporting without a blended score;
- trend windows and change alerts;
- business outcome kept separate from GEO observation.

## 9. Required final handoff from the implementation agent

Return an evidence-based completion report containing:

1. exact checkout, branch, start/end HEAD, and dirty-state disclosure;
2. assumptions and any deviations from this plan;
3. files changed, grouped by contract/provider/sampling/UI/action;
4. contract version changes and backward-compatibility behavior;
5. test commands actually run and exact results;
6. local browser scenarios actually exercised;
7. what remains unavailable or unverified;
8. proof that no App/DB/migration/deploy/external-write scope was touched;
9. `git diff --stat` and a concise risk list;
10. explicit statement that no commit/push/PR/deploy/migration occurred unless separately authorized.

Do not describe local code, green unit tests, or a copied prompt as production deployment, durable storage, publication, citation improvement, or recommendation improvement.

## 10. Primary external references

Use official/primary documentation when an adapter behavior or platform claim needs current verification:

- OpenAI web search and source/citation concepts: <https://developers.openai.com/api/docs/guides/tools-web-search>
- DataForSEO ChatGPT LLM Responses endpoint: <https://docs.dataforseo.com/v3/ai_optimization-chat_gpt-llm_responses-live/>
- DataForSEO LLM Responses versus scraper surfaces: <https://dataforseo.com/help-center/what-is-llm-scraper-api-and-what-data-does-it-provide>
- Google AI features in Search: <https://developers.google.com/search/docs/appearance/ai-features>
- Gemini API terms: <https://ai.google.dev/gemini-api/terms>
- OpenAI consumer terms: <https://openai.com/policies/terms-of-use/>

Do not freeze numeric quality thresholds from advisory reviews without a gold set and user pilot. Preserve raw counts and limitations first.
