# Content Brief v2 research and delivery design

Status: implementation proposal for the remaining business-contract work. It does not describe capabilities already shipped. The user approved the supplied Artifact as the result/UX baseline and requested that the business logic be clarified and repaired; the choices below must be consolidated before schema implementation.

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

The exact candidate selection and unresolved-action confirmation UX still require final specification. Do not add consolidate/delete/publish operations or import the unrelated older six-state Artifact.

## Editing, provenance and Draft

Preserve generated question text and its evidence bindings. Allow outline wording and order edits, retaining stable section IDs and question mappings. Store the generated base separately from effective user edits so edited text is not mislabeled as model output. Confirm and fingerprint every Draft-affecting field, including final heading order, page action, target and edit plan. A content hash is not an authenticity signature.

Draft must consume the exact confirmed revision. Its question renderer and `sectionEvidenceScope()` currently read `cluster.members`; both must move to the new source graph. PAA refs may determine what a section answers but must never appear in its factual `bound` evidence set. Sections without factual support must retain explicit gaps rather than invent assertions. Rewrite mode must consume the current target content and plan, not merely rename the action badge.

Historical-v1 imports retain their own parser; incompatible GEO imports get a specific explanation and correct entry point. Do not coerce either into a fabricated v2 object.

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
