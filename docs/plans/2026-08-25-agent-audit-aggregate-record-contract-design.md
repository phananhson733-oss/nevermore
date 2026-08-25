# Agent Audit aggregate-record contract fix

Date: 2026-08-25
Status: approved — option A
Scope: GenGrowth Marketing SEO/Tech Agent audit response validation

## Problem

The production SEO Agent audit returns HTTP 200, but the browser rejects the
success envelope as `audit_response_invalid`. The exact live response fails on
`abandoned_url_impression_share`: it carries one aggregate summary observation
plus three affected-URL observations, while `affected` correctly remains three.
The shared record guard currently requires `affected === observations.length`
for every record, so it rejects the valid `3 affected / 4 observations` shape.

`sitemap_url_not_indexed` uses the same aggregate-summary-plus-detail model when
Google Index Coverage is available and would fail for the same reason. Missing
or unavailable source states do not expose the bug because they carry no
observations.

## Approved design

Keep the default record invariant unchanged and fail closed. Add a narrow,
strict validation path for exactly these two Search Performance record IDs:

- `abandoned_url_impression_share`
- `sitemap_url_not_indexed`

An observed record using this path must satisfy all of the following:

- `tested` is positive and `0 <= affected <= tested`;
- observations contain exactly one aggregate summary followed by exactly
  `affected` detail observations;
- the summary publishes the record's required finite aggregate values and
  respects their numeric bounds;
- each detail has a non-empty URL and the expected evidence values;
- the record uses its exact population, unit, target-test state, and limitation;
- all other records continue through the existing invariant without widening.

Unverified forms remain governed by the existing record validator. No response
schema or method version changes because this change aligns the consumer guard
with the already-published producer shape; it does not change the wire data.

## Alternatives rejected

1. Rewrite the producer by folding aggregate evidence into one affected URL.
   This loses or distorts the zero-affected aggregate and conflates site-level
   evidence with one URL.
2. Relax the invariant for every record. This would turn a narrow producer-
   consumer mismatch into a broad fail-open contract.

## Test strategy

RED must be captured before production changes:

1. Build an actual Search Performance region with a resolved 410 or redirected
   URL and prove the complete Agent envelope is currently rejected.
2. Build actual Index Coverage records with inspected and excluded URLs and
   prove the Search Performance record guard currently rejects them.
3. Add malformed aggregate-summary/detail cases that must remain rejected.

GREEN requires the focused producer/contract/handler suites, targeted lint,
Marketing and Public Tools typechecks, Marketing production build, secret scan,
and diff checks. Production verification uses the authenticated URL-only audit
request, with no target queries and therefore no LLM or DataForSEO call.

## Non-goals

- Do not change Profile refresh, competitor classification, or target-query
  ownership.
- Do not change the audit handler response, evaluator thresholds, provider
  calls, cache namespace, UI copy, or public schema version.
- Do not relax unknown record IDs, evidence labels, limitation codes, or any
  non-aggregate count invariant.
