# AI Visibility Results UX Design

Date: 2026-09-01
Authority baseline: `main@4a5baa9cfd0293f6830e08f8dee631c208d3ff68`
Status: approved by the owner as **Approach A**

## Goal

Keep the current provider, metric and persistence contracts intact while making the AI Visibility results easier for customers to scan. Fix one gap-classification truth bug before visual polish, surface the full five-layer intent taxonomy without inventing zeroes, add a truthful source-type field, reduce default technical copy and give key cards restrained visual differentiation.

## Evidence boundaries

The production report is built from DataForSEO observations plus independent public-page reads. Provider answer text, web-search state, citation annotations, model/task identity, observed time and cost are observations. Brand mentions, own citations, list positions, metrics, intent summaries, SOV and gap kinds are deterministic projections.

Unavailable citation evidence must stay unavailable. A missing intent layer means the frozen set contained no question for that layer; it is not a zero. Page type and own presence are page-level facts from independently read references and must not be promoted to a complete domain-level census.

The scenario Artifact and user screenshots are visual acceptance inputs. They do not expand the current API or database contract.

## Truth fix

`classifyVisibilityGaps()` currently treats `question.cited === 0` as a miss even when a demand-mode question has no citation denominator. A demand answer that mentions the brand but has `citationEvaluable === 0` must not become an A or C gap solely because `cited` is zero.

A citation miss is actionable only when:

- the question is retrieval mode;
- at least one sample is citation-evaluable; and
- the evaluated samples contain zero own citations.

A genuine mention miss remains actionable independently.

## Results hierarchy

### Headline metrics

Keep the existing order and computation:

1. Natural mentions (`questionsMentioned`)
2. Own-site citations (`questionsCited`)
3. Answer coverage (`promptCoverage`)
4. Brand-present answer share (`shareOfVoice`)

Values remain neutral. Only the title and a thin top rule receive a metric identity color from existing tokens. Colors must not imply that “not observed” is an error or that coverage is equivalent to visibility success.

Default card content is title, primary value, denominator and one short status. Long definitions, Wilson intervals, cluster assumptions and sample-level rates move into the existing “How to read these metrics” disclosure. The visible state must still distinguish unavailable, not observed and a reportable zero.

### Intent layers

Render the canonical order `problem / discovery / comparison / evaluation / branded` for every sufficient report. Existing rows retain their actual proportions, positions and sample counts. An absent layer renders “No questions in this run” and em dashes; it contributes to no denominator.

Desktop stays tabular. Mobile may use compact row cards if required for readability, but semantic table labels and keyboard accessibility must remain intact.

### Gaps

Keep five kinds: A, B, C, D and unattributed. Do not reclassify unattributed gaps to fill A-D.

Zero-count cards are visually muted. Any non-zero actionable A-D count uses the warning token. Non-zero unattributed uses the info token and the customer-facing label “Cause not yet known”. Success color is reserved for complete/healthy states, and error color for real errors.

### Citation sources

Keep the domain aggregate and independent reference-page evidence separate.

The domain table becomes:

- domain;
- answers citing the domain;
- recognized source type;
- identity (own / confirmed competitor / other).

Source type is derived only from retained independently read reference pages joined by normalized host. No matching read evidence renders “Not independently read”. Multiple page types render “Multiple”. It never infers site-wide own presence.

The page-level disclosure continues to show URL, page type, own presence and read time. Unsafe omitted URLs produce a count-only notice without exposing the rejected URL.

## Copy hierarchy

Visible by default:

- completion/partial/insufficient state;
- answered/planned count;
- not-observed-versus-zero state;
- incomplete evidence scope and omitted counts;
- total observed cost;
- one sentence: this is sampled observation and does not explain model causality.

Collapsed by default:

- identifiers, hashes and schema versions;
- requested/observed models and provider surface;
- complete confidence intervals, cluster assumptions and sample-level rates;
- evidence IDs, full URL lists and read timestamps;
- the full limitations list.

A single-engine breakdown is collapsed because it duplicates the headline; a multi-engine breakdown remains visible. A comparison with insufficient comparable questions becomes one compact state instead of a table filled with “cannot test”.

## Visual tokens and accessibility

Use existing GenGrowth tokens only. No raw hex values and no rainbow card backgrounds. Suggested metric title tokens are the existing series/accent/info/success palette; numbers stay `text-text-dark-primary`.

State meaning always has text. Color is supplemental. Keep table captions, header/row scopes, tabular numerals, focus rings, link underlines and disclosure keyboard behavior. Do not reduce body copy below the existing readable sizes.

## Non-goals

- No provider, pricing, sample-plan, database or report-schema change.
- No domain-level “own presence” conclusion.
- No invented rows with zero values.
- No new paid production run as part of visual QA.
- No refactor of adjacent GEO Brief or Page Citability components.

## Acceptance

- Demand-mode no-denominator regression cannot create A/C from citation zero alone.
- All five intent rows are visible; absent rows explicitly say no questions and show no numeric rate.
- Headline order and values remain unchanged while titles are visually distinct in light/dark and desktop/mobile.
- Gap summary preserves five kinds and visually prioritizes non-zero states.
- Citation sources show a truthful source type or explicit not-read/multiple state; page-level presence remains separate.
- Essential evidence limitations remain visible or one disclosure away.
- EN/ZH copy, accessibility, exports, historical V1 and V2 parsing remain compatible.
