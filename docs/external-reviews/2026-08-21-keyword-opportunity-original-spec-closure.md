# Keyword Opportunity Original-Spec Closure Review

Date: 2026-08-21
Reviewed base: `origin/main@39bddaa2aceaaa68e226221e2f73a8f5d2f26fe4`
Acceptance input: `/Users/wzb/Downloads/2026-08-19-低竞争关键词工具 —— 数据与字段规格.md`

## Status vocabulary

- `implemented`: present in code with deterministic local test evidence.
- `partial`: useful implementation exists but one stated boundary is absent.
- `superseded`: a later owner-approved decision intentionally replaced the
  original wording.
- `deferred`: explicitly postponed and intentionally absent.
- `unverified`: code/contract exists, but the required calibration or live
  provider/production evidence has not been produced.

The source document is treated as acceptance evidence, not as authorization to
commit, deploy, migrate, call paid providers, or write production data.

## Approved changes to the 2026-08-19 wording

The approved v2 design in
`docs/plans/2026-08-20-keyword-opportunity-v2-design.md` freezes these changes:

1. Keep the generator's 150-row output ceiling. “Run every candidate” means
   every deduplicated candidate in that bounded generated set, except a
   provider-confirmed explicit zero; 150 is not a SERP sampling quota.
2. Remove aggregate provider-cost admission and the account daily breaker for
   v2, but retain per-call timeouts, bounded concurrency, no replay after an
   outcome-unknown request, and provider cost telemetry.
3. Defer Blog Agent/writing-page handoff.
4. Raise the L2 successful-page ceiling to 20.
5. Treat an AI Overview complete answer as a ranking discount rather than an
   exclusion.
6. Replace definitive zero-exposure/site-wide-absence wording with bounded,
   positive-evidence coverage states.

## Data collection

| Requirement | Status | Evidence and boundary |
| --- | --- | --- |
| L1 reads sitemap URLs only, including one-level sitemap indexes | `implemented` | `packages/sources/src/crawl/context-profile.ts` keeps URL-only `sitemapInventory`; bodies are fetched only for sitemap documents, not inventory pages. |
| L1 can represent a complete ten-thousand-page site | `superseded` | v2 deliberately bounds the inventory to 500 URLs and three child documents, then publishes `complete` plus exact truncation reasons. It no longer claims unlimited/site-wide completeness. |
| Missing sitemap must be visible rather than become “no page exists” | `implemented` | `packages/public-tools/src/keyword-opportunity/coverage.ts` emits `inventory_unavailable`/`inventory_truncated`; UI and locale completeness tests render both. |
| L2 order: homepage, homepage navigation, product/tool/feature, pricing, list roots, shallow fallback | `implemented` | `packages/sources/src/crawl/parse-page.ts` exposes navigation targets; `context-profile.ts` applies explicit source/kind priority before score/depth/URL tie-breakers. |
| L2 excludes about/contact/legal/careers/auth/account pages before quota | `implemented` | `context-profile-candidate.ts` uses locale-aware semantic route families; crawl tests prove the URLs issue no page request and consume no L2 slot. |
| L2 includes blog/resource list roots but excludes single content pages | `implemented` | The classifier distinguishes list-root depth from descendants and covers blog/resources/articles/posts plus locale variants. |
| L2 excludes `?page=2`, `/page/2`, and nested pagination | `implemented` | The full-URL classifier checks page/paged/page-number/offset query forms and path pagination before ranking. |
| L2 cap is 20 and exact omission count is shown | `implemented` | `ContextProfileSelectionSummary` distinguishes eligible, excluded, attempted, and unattempted-after-cap candidates; stage one, token, final result, EN and ZH UI carry it. Failed requests replenish and do not inflate truncation. |
| L1 retains URLs that L2 excludes | `implemented` | Integration tests keep `/about` and other excluded URLs in `sitemapInventory` while proving they were never fetched as L2 pages. |
| L3 reads GSC query and query-page positive evidence | `implemented` | `keyword-coverage-reader.ts` reads both dimensions with bounded paging; `coverage.ts` attributes only observed positive rows and preserves truncated/unavailable states. |
| Every non-explicit-zero candidate receives one SERP attempt | `implemented` | `keyword-opportunity-handler.ts` builds the immutable deduplicated plan; `keyword-providers.ts` executes fixed waves of at most ten; the 150-candidate regression proves no 20-item sampling slice remains. |
| No business aggregate cost/time cutoff during initial implementation | `implemented` | v2 does not call legacy `admitStage` or daily budget admission. Per-call deadlines and the hosting route ceiling remain safety/infrastructure boundaries, not candidate-selection gates. |
| A production run is guaranteed to finish all 150 candidates inside one synchronous request | `unverified` | Offline orchestration tests pass, but no paid 150-keyword provider canary or durable async executor was authorized. The route still has the platform `maxDuration` boundary. |
| SERP failures stay outside the eligible table | `implemented` | Per-keyword gaps become the separate `incomplete` section with a typed reason; successes survive partial provider failures. |

## External evidence sources

| Requirement | Status | Evidence and boundary |
| --- | --- | --- |
| RDAP reads the `registration` event without owner/contact data | `implemented` | `packages/sources/src/rdap/domain-registration.ts` distinguishes registration from reregistration/last-changed and fails closed on malformed/missing dates. |
| Registration dates are permanently cached | `deferred` | The source adapter explicitly leaves durable caching to callers; current Marketing wiring deduplicates only request-local in-flight lookups. No hosted cache migration was authorized. |
| Domain traffic uses a confirmed DataForSEO metric | `superseded` | v2 froze market/language-scoped DataForSEO Labs organic ETV, not an invented total-site “monthly visits” number. Parser/chunking contracts exist in `labs-traffic.ts`. |
| Traffic cache refreshes monthly | `deferred` | Cache identity/version/month are designed, but current implementation is request-local and no hosted cache migration was authorized. |
| Keyword volume, KD, provider intent and rank use the existing provider | `implemented` | Typed DataForSEO adapters preserve `explicit_zero`, `provider_no_data`, null KD/intent, and rank 0 as unavailable rather than measured weakness. |
| The user's own provider rank selects the traffic threshold tier | `implemented` | `keywordSiteTrafficThreshold` maps rank 1–200/201–500/501–1000 to 5k/50k/100k; rank 0/null is unavailable. |
| UGC whitelist costs no additional request | `implemented` | Provider community item types are preferred; conservative domain fallback now includes Reddit, Quora, Stack Exchange, Stack Overflow, Medium and Hacker News. Discourse-class forums rely on provider `discussions_and_forums`/`forum` items rather than guessed hostnames. |
| Real DataForSEO traffic/SERP and public RDAP behavior is production-verified for this closure | `unverified` | This change uses deterministic fixtures only and deliberately makes no paid/live provider call. |

## Display and internal fields

| Requirement | Status | Evidence and boundary |
| --- | --- | --- |
| Keyword, volume three-state, KD | `implemented` | Public v2 types, UI and CSV preserve numbers/null and never turn unavailable into zero. |
| Weakest page-one rank plus domain and position | `implemented` | `KeywordOpportunitySerpEvidence` and result cells carry all three facts. |
| AI Overview presence | `implemented` | Public evidence distinguishes observed/not observed/unavailable; provider markdown remains server-only. |
| Site coverage conclusion | `superseded` | The original three definitive labels were replaced by bounded positive-evidence states, because missing/truncated GSC or sitemap rows cannot prove zero exposure or site-wide absence. Actions remain explicit. |
| Lexical related-term groups in a separate table | `implemented` | Existing clustering is shown separately and explicitly says it does not prove page-one overlap. |
| Remove “check before acting” | `superseded` | v2 retains `remainingDecisions`, because coverage can settle only the overlap question and must not erase commercial-fit or uncertain-intent decisions. |
| Youngest domain, weakest traffic domain, and UGC position stay as decision evidence | `implemented` | `keyword-signal-evidence.ts` creates three provenance-bearing observations; UI/CSV expose their raw states and values. |
| Decision result is not a redundant eligible-table column | `implemented` | Eligible rows are already the passed set; excluded and incomplete candidates live in separate reasoned sections. |
| AI summary markdown remains internal | `implemented` | Provider markdown reaches server interpretation/discount logic but is removed through an explicit public allow-list; payload tests reject the property and hostile content. |
| SERP top-ten title/URL facts and inferred intent | `implemented` | Organic rows retain bounded title/URL/domain/position; versioned LLM interpretation derives aggregate SERP intent without overwriting provider intent. |
| Per-result “page type” classification | `superseded` | v2 uses provider page item types plus aggregate versioned SERP intent; it does not fabricate a page-type label for each organic result. |

## Decision policy

| Requirement | Status | Evidence and boundary |
| --- | --- | --- |
| Youngest usable registration is no more than 24 calendar months old | `implemented` | Calendar-month boundary and unavailable siblings are covered in `keyword-signal-evidence.test.ts`. |
| Weakest known organic ETV is below the site-tier threshold | `implemented` | Positive evidence survives unresolved siblings; a negative is legal only when all required domains resolve. |
| Community result is present with a reportable position | `implemented` | Concrete provider items take precedence over conservative domain fallback; suffix spoofing is rejected. |
| At least one positive signal admits; three completed negatives exclude | `implemented` | `packages/public-tools/src/keyword-opportunity/signals.ts` keeps any unavailable required signal incomplete rather than false. |
| AI Overview complete answer excludes the keyword | `superseded` | Owner approved discount-only behavior; complete non-empty private markdown adds `ai_overview_answer_discount` and never vetoes. |
| KD has no gate; low KD with three negatives has an exact exclusion reason | `implemented` | KD remains evidence only; `all_signals_not_observed` is a visible excluded reason. |
| Search volume has no positive lower bound; provider no-data still proceeds | `implemented` | Only `explicit_zero` skips SERP. Provider silence remains null/no-data and enters the same evidence plan. |
| Eligible ordering uses positive-signal strength, AI discount, volume and stable keyword tie-break | `implemented` | UI/CSV share the deterministic order from `keyword-opportunity/csv.ts`. |
| Proposed traffic thresholds were backtested against human labels before release | `unverified` | The repository labels these tiers `calibration-pending`; no labelled backtest dataset/result was found. Threshold values must not be presented as calibrated truth. |

## Blog handoff and release boundary

| Requirement | Status | Evidence and boundary |
| --- | --- | --- |
| One-click handoff to the writing page | `deferred` | Explicit owner decision; no button, route, App write, draft, Artifact or CMS action was added. |
| Evidence is shaped for a later Blog Agent | `implemented` | Target keyword, clusters, validation, intents, top-ten facts, signals and decision basis are typed; private AIO markdown is intentionally not public handoff data yet. |
| Current closure is committed/pushed/deployed | `deferred` | This audit and repair remain local until separate authorization. No provider canary or production claim is made here. |

## Remaining decisions

The implementation contract is closed for the deterministic local scope. Three
items remain intentionally outside this repair:

1. Calibrate the 5k/50k/100k thresholds against an owner-approved labelled
   dataset before calling them validated cutoffs.
2. Authorize and design durable RDAP/traffic caches if cross-run persistence is
   still required; request-local deduplication is not permanent/monthly cache.
3. If a real 150-candidate canary cannot reliably finish inside the platform
   ceiling, authorize a durable asynchronous executor without changing the
   per-keyword evidence/result contract.
