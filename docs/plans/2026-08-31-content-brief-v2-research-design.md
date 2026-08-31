# Content Brief v2 research and delivery design

Status: local implementation in progress, not shipped. The user approved the supplied Artifact as the result/UX baseline and requested repair of its business behavior. The implementation choices below are consolidated under that repair scope; current code/tests remain the evidence of what is actually implemented.

## Why an explicit version

The current v1 parser re-derives lexical clusters, requires three observed pages per question, rejects non-whitespace-language writing, and binds GSC query-page rows only to the primary keyword. Merely changing the producer will cause Draft intake to reject the result. Do not relax v1 validation or label new semantics as v1.

Use `gengrowth.content_brief/v2` for new generation and the corresponding explicit Draft contract version. Preserve historical v1 parsing and its real capabilities without synthesizing missing v2 evidence. GEO Brief (`marketing-geo-brief.v1`) is a different tool, not a legacy Content Brief version.

A release must also account for already-open v1 clients: either retain a versioned v1 route or explicitly negotiate the requested response contract before paid work. A successful paid response that the requesting old client cannot parse is not acceptable compatibility.

## Frozen source units and one assembly call

The source adapter now supports local `includePeopleAlsoAsk` retention from the existing advanced SERP response. Its consumer adapter still needs to request and forward that result. No paid PAA expansion is needed.

In a Marketing-owned extractor, use the already installed Cheerio dependency to select the main/article/body content, remove script/style and semantic navigation/footer/aside content, and derive bounded heading/body units. Avoid changing shared vendor crawler behavior. Existing `contextPageProse()` is bounded but includes navigation; `parse-page.ts` has an internal cleaner but only exposes a short 500-character excerpt.

Illustrative model input:

```ts
{
  primary, supporting, language,
  units: [
    { id: "U1", kind: "page", page_ref: "C1", heading: { level: "h2", text: "…" }, text: "…" },
    { id: "U2", kind: "page", page_ref: "C2", heading: null, text: "…" },
    { id: "U3", kind: "paa", paa_ref: "A1", text: "…" },
  ],
  facts, ownedPages, candidatePageEvidence,
}
```

Illustrative single-call output:

```ts
{
  questions: [{ anchor: "U1", q: "…", sources: ["U1", "U2", "U3"] }],
  outline: [{ h2: "…", h3: [], answers: ["U1"] }],
  page_plan, gap_angle, internal_links, do_not_cover,
}
```

The model selects and semantically groups actual source material; it cannot invent source IDs. It may return zero questions when the input is irrelevant. The server assigns final `Q*` and `O*` IDs, maps anchor references into the outline, and computes every displayed count. One relevant, supported question may produce an outline; no three-page or three-question hard gate. Do not infer a hidden-question count from the number of input source units.

PAA participates in the actual question, outline and Draft coverage workflow. A PAA-only question has zero observed competitor-page coverage; it is not factual support. Do not implement a disconnected supplemental PAA card as the final outcome.

## Machine-verifiable vs semantic guarantees

Machine checks: exact key sets; text and collection bounds; existing unique anchors; anchor contained in sources; unique source refs; every question answered by exactly one outline section; no orphan/unknown IDs; per-question distinct observed-page count derived from canonical final-page identity; PAA never increments that count. Freeze source type, acquisition status and truncation metadata into the causal fingerprint.

Semantic acceptance: cited text actually supports the question; paraphrases merge without mixing topics; irrelevant/template content is excluded; output language is correct; the outline genuinely answers its mapped questions. Valid IDs and a matching fingerprint do not establish these properties. Fixed human-authored oracle cases and real generated-output review are required.

## Page decision and rewrite delivery

Consider primary and supporting-query evidence separately. Retain the matched query and its scope beside each candidate; never describe supporting-term rankings as primary-term rankings. Low impressions or average position outside 30 cannot prove that creating another page is safe.

Bounded owned-page reads must precede claims about page coverage or rewrite instructions. A rewrite plan must bind to the observed target page and identify keep/add/rewrite work with reasons. If the target was unreadable or replaced by a redirect, the rewrite stays unresolved; do not silently change it to a new-page draft. Absence of a query in a bounded GSC sample remains absence in that sample, not site-wide absence.

Candidate selection is now pinned: normalized exact primary/supporting phrases are matched separately, preserving each raw provider query. Keep at most 30 matched query-page rows and three owned-page candidates; prioritize primary then supporting matches, then use remaining slots for observed GSC page rows. Low impressions and distant positions are retained, not filtered out. Duplicate raw-query/page observations are not summed; retain the first and report the omitted duplicate as partial. GSC property scope is checked before treating a URL as owned. The actual reporting window and profile snapshot identity travel with the evidence.

The model can recommend create only with a complete GSC sample and all scoped match pages represented by readable candidates. This remains a model recommendation about a bounded sample, never proof of site-wide absence. A grounded update can reference an observed candidate even if other evidence is partial. Otherwise return undecidable. The confirmation UI must offer an explicit `create_despite_uncertainty` choice before new-page writing; merely clicking a generic next button must not silently resolve an unknown action. Do not add consolidate/delete/publish operations or import the unrelated older six-state Artifact.

## Editing, provenance and Draft

Preserve generated question text and its evidence bindings. Allow outline wording and order edits, retaining stable section IDs and question mappings. Store the generated base separately from effective user edits so edited text is not mislabeled as model output. Confirm and fingerprint every Draft-affecting field, including final heading order, page action, target and edit plan. A content hash is not an authenticity signature.

`gengrowth.content_brief/v2` is the generated base, and `gengrowth.confirmed_brief/v2` wraps that exact base plus edited outline, revision, confirmation time, explicit resolution and its own fingerprint. The full base is limited to 224 KiB, leaving space under the 256 KiB confirmed-import ceiling for the bounded edited outline. Keep generated plan/source bindings frozen in this UI; editing scope is heading wording and order, not free-form alteration of questions or observed evidence.

Draft must consume the exact confirmed revision. Its question renderer and `sectionEvidenceScope()` currently read `cluster.members`; both must move to the new source graph. PAA refs may determine what a section answers but must never appear in its factual `bound` evidence set. Sections without factual support must retain explicit gaps rather than invent assertions. Rewrite mode must consume the current target content and plan, not merely rename the action badge.

Historical-v1 imports retain their own parser; incompatible GEO imports get a specific explanation and correct entry point. Do not coerce either into a fabricated v2 object.

Integration clarification: main subsequently introduced the explicit shared GEO Brief `gengrowth.content_brief/v1.1` in PR #261. Preserve that independent parser, owned-receipt verification and Draft behavior alongside SEO v1 and confirmed SEO v2. The rejected legacy GEO report remains `schemaVersion: marketing-geo-brief.v1`; do not label the new shared GEO Brief incompatible or bypass its server verification.

### Draft v2 implementation pins

Draft v2 accepts the exact confirmed envelope, not an unconfirmed generated Brief. Its section headers follow the effective confirmed order/wording, while questions and evidence stay frozen. Page U refs are granular factual citations; PAA U refs can identify questions but never authorize a bound claim. Profile P refs follow the explicit product-mention setting, and inferred profile facts cannot support bound claims. Supporting-page counts deduplicate canonical observed page identities (including an actual owned rewrite target), and must not be labeled competitor counts.

For rewrite, every section receives the observed target snapshot plus the applicable keep/add/rewrite instructions. Scope also includes page units behind that section's mapped questions and applicable plan steps. The gap-angle permission stays on its original generated section ID when headings are reordered, not whichever different section happens to become last. Confirmation covers the changed order and therefore changes the delivery fingerprint.

Confirmed H3 headings are structured paragraph headings in the actual Draft, not merely model hints. Their non-null sequence must equal the confirmed H3 list exactly; introductory/continuation paragraphs use null. Display and Markdown render those headings, while length measures sentence prose only. Draft prompts also receive approved intent/format and do-not-cover constraints. Confirmed internal links retain their observed target URLs, are not new factual citation permissions, and are presented once as a related-links block. Markdown retains failed/skipped section headings with explicit notes so export cannot conceal an incomplete outline.

Coverage checks all frozen questions against all successfully generated text, including questions originating only from PAA. Do not infer non-coverage solely from a failed/skipped planned owner if another generated section may answer it. With no generated text, all questions are deterministically uncovered and no coverage model call is needed. This is an explicit v2 behavior; legacy v1 keeps its original policy.

A section rerun takes the entire previous Draft v2 through the exact parser first, uses settings from it, changes only the selected section, rechecks coverage against the resulting whole text and binds the previous run ID/fingerprint plus confirmed revision. Initial and rerun usage remain distinguishable. Generated body length and total length use the existing truthful word/character measurement, not an English word counter for CJK.

Standalone Draft imports validate current structure, source bindings, counts and checksum; they do not authenticate a historical rerun without its prior document. Actual handler and client rerun paths must supply the exact previous document for continuity checks. Requiring an unbounded history chain would contradict the non-persistent tool boundary. Supported BCP-47 locale forms are resolved to the existing base-language set for adapters while preserving the original confirmed language tag/fingerprint and exact locale instruction.

## Language and bounded cost

Use the existing supported language set, not a new English-only restriction. Non-whitespace languages can enter question/outline/Draft stages. Length must state its actual measurement unit/tokenizer; do not call Chinese non-whitespace character counts English words. The exact cross-language measurement contract must be pinned by tests.

Proposed research bounds: at most 60 page units and 8 selected PAA units, at most 300 code points of excerpt per unit, round-robin page allocation with reported truncation, and an exact serialized prompt-byte cap (proposed 48 KiB). A byte cap is not a token estimate. Keep one assembly call and the current bounded run; record actual provider tokens/cost and do not silently add retries or PAA click expansion.

Before finalizing constants, derive a worst-case legal serialized Brief size under the handoff cap. Avoid storing the same long page content both in raw headings/excerpts and again in units. Retain original source identifiers/hash/provenance while explicitly counting omitted material.

## Required tests before rollout

- Three semantically similar English headings with different words merge to a relevant question.
- Chinese body without H2 still provides actual question material and correctly labeled length.
- One page plus matching PAA yields one grouped question with one-page coverage.
- PAA-only question reaches Draft/coverage, but cannot authorize a PAA-bound factual sentence.
- Navigation headings are excluded; two observations resolving to the same final page do not double-count coverage.
- Irrelevant sources may produce zero questions. Unknown anchors, duplicate refs, missing answers, over-cap text and stale edited fingerprints fail closed.
- Supporting-only match, low-position existing page, fetched rewrite target, unavailable target and unresolved page action follow their actual delivery branches.
- Legacy-v1 exports, new-v2 exports, edited revisions and section reruns remain exact and do not mix contracts.

See the full acceptance matrix for the remaining UI, browser, provider and release gates.
