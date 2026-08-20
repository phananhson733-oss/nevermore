# SEO Agent Production Remediation Design

Date: 2026-08-20

Status: approved by the owner through “按照建议去落地”; account-level cost limits are explicitly deferred to the future credit-per-use billing model.

Baseline: production deployment `dpl_3DdWnm76YEyKyHwBMdrjqRxFAWE2`, Git SHA `1ccc61465f6407004395bda370b2da9ece1cd796`.

## Outcome

Make `/agents/seo` truthfully behave as the unified SEO Agent already described by the product:

- a valid Search Console result must survive producer, API, client guard, and display vocabulary unchanged;
- a direct SEO Agent run must carry the confirmed target query, page role, market, and language into the same keyword and SERP layers used by the On-Page Checker;
- Product/ICP context must be described as interpretation and solution context, not as an ordering input while the ranking algorithm does not consume it;
- every visible readiness and navigation state must match the server contract;
- the 80-check production catalog must be the single current authority;
- all existing unit, type, lint, build, and browser gates must be green.

## Explicit non-goals

- No account-level, IP-volume, global daily, or dollar-based DataForSEO cost limit in this change. Usage will later consume credits per run.
- No billing, pricing, subscription, or credit deduction implementation.
- No automatic site edits, PR creation, deployment, project persistence, or App integration.
- No attempt to turn the current on-site audit into an off-page authority suite, JavaScript renderer, or full international SEO crawler.
- No commit, push, PR, or deployment without separate authorization.

## Decisions

### 1. Search evidence owns one combined ledger

The Search Console region already produces six search-performance records plus one index-coverage record. A new combined export is the only record/label/limitation authority consumed by:

- `isAgentSearchPerformance`;
- the Agent display seam;
- message completeness tests;
- producer/consumer round-trip tests.

The wire version remains `search_performance.agent.v2` because the producer already emits this seven-record shape; the defect is a stale consumer, not a new producer contract.

### 2. Direct SEO Agent uses its confirmed search context

The direct workbench request sends:

- `url` always;
- `pageRole`, `market`, and `language` from the confirmed run context;
- `targetQueries: [targetQuery]` only when the confirmed target query is non-empty.

The default SEO Agent dependency set attaches the existing bounded SERP reader. A blank query returns the existing `no_target_query` state and must not spend a provider request. The On-Page route remains the same engine with its own credit identity.

Coverage copy no longer presents global `inventoryReady` as a guarantee for every request. It explains total catalog size, currently wired detectors, and that the evaluated count depends on supplied context and connected sources. The result surface remains the authoritative per-run count.

### 3. Product/ICP is not an opaque priority score

Recommendation ordering stays deterministic and evidence-first. This change does not invent a weight for ICP, CTA, market, or page type.

The UI and method copy say exactly what is true:

- confirmed context frames the result and selected solution;
- evidence severity, availability, Agent ownership, and affected reach order recommendations;
- context does not replace observations and currently does not re-rank them.

The run gate requires a valid target URL, ISO-2 market, and canonical BCP-47 locale. Product name, CTA, and ICP remain reviewable context but do not block a crawl they do not control.

### 4. Refresh means cache-aware reread

Profile Search keeps its existing one-hour cache-first behavior. The action and supporting copy say it may reuse recent data and expose `observedAt`; no force-refresh flag is added. This avoids a hidden provider-cost expansion while account limits are intentionally deferred.

### 5. Unified IA has two peer Agents

SEO and GEO remain peer Agent products. Tech remains a reachable compatibility focus under SEO, but is removed from the top-level Agent submenu and the homepage peer-card grid. The `/agents` hub subordinate Tech link, cross-canonical, and sitemap exclusion remain unchanged.

### 6. UI validity mirrors server validity

Client validators reuse or mirror the server-owned URL, ISO-2, and locale rules without weakening the server check. Invalid values:

- set `aria-invalid`;
- show localized feedback;
- keep Profile refresh, search evidence, and final run actions disabled.

The mobile Sheet owns a `100dvh`-bounded scroll container so every navigation, sign-in, and CTA remains reachable at 390 px and shorter viewports.

### 7. Security and response contracts are symmetric

- All draft responses use `Cache-Control: no-store, private`.
- Authenticated Agent POST routes reject a present cross-origin `Origin` after authentication and before reading the body.
- The SERP supplemental region is actually validated by `isAgentResult`.
- Existing SameSite/CORS protections remain defense in depth, not substitutes for the server gate.

### 8. 80 is the current catalog authority

The removed 9.2 check is not restored. It required a domain-registration fact no wired provider supplies. The artifact bundle, verifier, messages, and review expectations are updated from 81 to 80 and from stale “24 of 81” language to the derived current contract.

## Data flow after remediation

```text
confirmed Profile
  -> client-valid URL / market / locale
  -> POST /api/agents/seo/audit
       url
       pageRole
       market
       language
       targetQueries? (one direct query; one-to-five from On-Page)
  -> server auth + same-origin + bounded body validation
  -> bounded crawl/cache
  -> per-request keyword records
  -> optional SERP records
  -> optional GSC search + index-coverage records
  -> optional PSI/CrUX/image records
  -> combined runtime guard
  -> display vocabulary guard
  -> per-run evaluated/excluded counts
  -> evidence-first recommendations
  -> context-framed solution preview
```

## Acceptance evidence

1. A real `readAgentSearchPerformance` seven-record result passes both runtime guards and renders A1.
2. Direct SEO Agent tests prove the request carries page role, market, language, and a non-empty target query.
3. Direct SEO Agent tests prove blank target query does not invent one and the SERP adapter makes no paid call.
4. Recommendation copy and tests no longer claim Product/ICP changes ordering.
5. Invalid URL/market/locale keep all relevant actions disabled and expose localized errors.
6. A 390 px browser test reaches the final mobile menu item, sign-in, and audit CTA.
7. Tech is absent from peer homepage/header entries but remains reachable through the compatibility path.
8. Draft success and every error response are `no-store, private`; present cross-origin headers are refused before body/provider work.
9. The design artifact verifier passes with 80 as the current authority.
10. Focused tests, full unit tests, lint, typecheck, production build, and relevant browser E2E pass.

## Deferred follow-up

When credit billing is introduced, Profile Search and any direct SEO SERP call must consume a server-owned credit entitlement before provider execution. That future change owns account limits, pricing, retries after credit refusal, and ledger persistence; none of those semantics are partially introduced here.
