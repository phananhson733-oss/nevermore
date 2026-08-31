# Content Brief v2 research foundation — local acceptance

Date: 2026-08-31. Code commit: `377e0e4a`. Status: accepted local research-foundation batch, not a deployed or complete Brief/Draft product.

## Baseline and scope

The worktree remains `fix/content-brief-artifact-20260831`. Existing UI work (`1705aa31`) and initial PAA source retention (`5180b875`) are preserved. Remote main advanced to `d4ebb110` with only a blog post/image; merge `1cbbe70e` incorporated that unrelated change without rewriting prior work.

This batch contains:

- Explicit opt-in PAA retention in the Marketing Brief SERP adapter, preserving the v1 default request/response shape.
- Local-only HTML main-content extraction, including non-p/non-heading text and non-whitespace languages.
- A separate v2 research source graph, strict model research validation and recomputed question/outline/coverage fields.

It does not activate a v2 route, invoke an actual model, implement page ownership/rewriting/editing, or complete Draft consumption. These remaining requirements must not be inferred from the name “v2” or from test counts.

## Implemented behavior and proof

| Surface | Fixed-input proof |
| --- | --- |
| SERP/PAA adapter | Only explicit true enables local retention. Defaults/false keep exact old shapes. PAA survives zero/unreadable organic rows; unknown/missing/empty/timeout/provider-error remain distinct. No new request or paid click expansion. |
| HTML extraction | Main/article/body preference, navigation/executable/hidden content removal, explicit template scopes, heading-less and div/span prose, no nested duplicate counting, bounded 300-code-point excerpts / 160-code-point headings / 12 retained segments. |
| Deep HTML | Real 10,000-level div and inline-heading failures were reproduced, then closed with iterative entry/exit traversal and iterative heading text extraction rather than catching errors and returning empty data. |
| Observation measurement | Full cleaned main text is measured, including omitted segments and headings. Known or detected CJK/Thai scripts use non-whitespace character/code-point units instead of mislabeled whitespace words. |
| Source graph | Canonical C/T/A source ordering, deterministic round-robin retention, explicit PAA deduplication/omission counts and a 128 KiB serialized bundle budget. Unit objects reference stored source text rather than duplicating it. |
| Question/outline validation | One source-backed question can have an outline; PAA-only questions are representable. Anchors/references must exist and be unique where required; every question maps to exactly one section. Server assigns Q/O IDs. |
| Derived coverage | Counts distinct competitor final URLs without fragments. Owned pages and PAA contribute no competitor coverage. Exported research results must match recomputed coverage, PAA refs and Q/O mappings. |

The semantic research tests use explicit expected model-output fixtures. They prove the validator can accept the intended grouping and reject invalid bindings; they do **not** prove that a real LLM performs the grouping correctly. Actual prompt/model/output acceptance remains open.

## Review-driven corrections

1. Nested same-level headings incorrectly ended template exclusion; fixed by requiring the actual peer scope.
2. Recursive extraction and Cheerio heading text overflowed on deep HTML; replaced with iterative traversal and regression cases.
3. Missing/mixed language tags could mislabel CJK/Thai length; added script detection with RED-to-GREEN cases.
4. Source input order changed U IDs; added canonical source ordering and rejection of non-canonical frozen graphs.
5. PAA source whitespace was incorrectly subjected to normalized model-text constraints; raw bounded source text is retained, while model/frozen-result text has its separate exact rules.
6. Observed length could contradict retained text; added a measurable lower-bound and visible-script consistency check. Test fixtures were corrected to truthful lengths, not weakened.

All three module groups passed separate spec and code-quality reviews. No remaining scoped P1/P2 finding was reported.

## Authenticity boundary

`segments_total`, omitted counts and observed full-main-text length are acquisition metadata produced before truncation. Retained excerpts cannot authenticate omitted original text. The parser checks their arithmetic and observable lower bounds, and independently re-derives all retained graph edges and result counts. A local JSON object or content hash is not a signed observation receipt. No cryptographic source-authenticity claim is made.

## Fresh primary-agent verification

```text
Relevant v1/v2 core, source, handler and UI regressions: 43 files, 1000/1000 passed
Marketing typecheck: exit 0
public-tools typecheck: exit 0
Changed-file ESLint: exit 0
Secret scan: passed
Redaction tests: 75/75 passed
git diff --check: passed
```

New focused coverage includes 31 extractor tests, 30 v2 contract/research tests, and 27 SERP-adapter tests with 54 existing source-client tests.

This batch had no real provider call, browser production action, push, PR, merge to main, deployment or database/CMS change. Previous UI browser evidence remains limited to its recorded UI bytes; no new browser/production acceptance is claimed here.

## Remaining full-goal work

1. Final v2 Brief envelope and one complete assembly-model call using the frozen research graph, page plan and bounded full prompt.
2. Primary/supporting query scope, actual owned-page reading and honest create/update/undecidable handling.
3. Real keep/add/rewrite plan, editable/confirmed outline and exact causal identity.
4. Version-aware Brief/Draft import/handoff and source-scoped Draft generation; explicit unsupported GEO-import guidance.
5. Actual semantic output review, full product browser tests, final gates, reviewed PR/Marketing release and real combined canary with retained Product identity.

The active goal remains incomplete.
