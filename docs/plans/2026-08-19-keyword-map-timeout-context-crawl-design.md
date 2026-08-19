# Keyword Map Timeout and Context Crawl Design

## Problem

The public Keyword Opportunity Map has two production defects on the same user
journey.

1. Candidate expansion asks the configured model for as many as 150 structured
   rows and allows 6,000 output tokens, but it inherits the same 45-second
   deadline as the much smaller proposition extraction call. Production logs on
   2026-08-19 recorded five `expand_candidates` timeouts while the surrounding
   context calls succeeded. One expansion did succeed with 5,627 output tokens,
   proving configuration and authentication were healthy and that the deadline
   was the failing boundary.
2. The context profiler describes `maxUrls: 14` as a page budget, but it can
   return fewer pages even when the site has enough safe candidates. It rejects
   custom depth-two product paths whose only negative term is the depth penalty,
   then slices the first 13 candidates before fetching and never replaces a
   failed fetch. A production-equivalent run against `aistorygenerator.work`
   returned 10 pages from a 34-URL sitemap with `stopReason: null`.

## Considered approaches

### 1. Raise every LLM timeout and add site-specific path words

This is small but wrong. A global timeout makes the lightweight context call
slower to fail, while adding `story-generators` and `rpg-tools` only fixes one
site and creates an endless taxonomy.

### 2. Retry every timeout and crawl all sitemap URLs

This may hide intermittent failures, but an aborted provider request has an
unknown billing outcome and an identical retry can double cost. Crawling every
sitemap URL also defeats the bounded public-tool contract and can fill context
with articles and legal pages.

### 3. Stage-specific deadline plus bounded, ranked crawl replenishment

This is the selected design. It changes only the boundaries contradicted by
production evidence while preserving all safety, cost, and relevance caps.

## Decisions

### Candidate expansion

- Keep the default LLM deadline at 45 seconds for proposition extraction.
- Give candidate expansion a request-level 90-second deadline. The route keeps
  its existing 300-second ceiling, so search-data validation and SERP sampling
  retain headroom.
- Do not retry transport timeouts. Schema-invalid and empty replies retain their
  existing bounded retry behavior.
- Keep the 150-candidate and 6,000-token product contracts unchanged.

### Context candidate eligibility

- Keep homepage, same-origin, robots, depth-three, locale, body, request, byte,
  concurrency, and wall-clock boundaries unchanged.
- Permit paths down to score `-4`, which is the maximum depth-only penalty. This
  admits custom depth-two and depth-three product paths after higher-value pages.
- Continue excluding off-topic paths such as blog, privacy, terms, careers, and
  news (`-6` or worse), and foreign-locale paths (`-8` or worse).
- Preserve deterministic ordering by score, depth, then URL.

### Successful-page replenishment

- Interpret `maxUrls: 14` as the maximum number of successfully projected
  context pages, including the homepage.
- Fetch the highest-ranked batch first. If a candidate fails, fetch the next
  ranked candidates in deterministic batches sized only to the remaining page
  slots.
- Stop when 14 pages succeed, all eligible candidates are exhausted, or an
  existing request, byte, wall-clock, or caller-abort budget stops the crawl.
- Defer `max_urls` until the end. A real budget stop takes precedence; `max_urls`
  is reported only when the result reached 14 pages while eligible candidates
  remained unattempted.
- Do not invent missing pages. A site with fewer than 14 safe, readable pages
  returns the smaller honest count.

## Data flow

```text
entry + robots + homepage + sitemap
                 |
                 v
safe ranked candidates (score >= -4)
                 |
                 v
batch fetch -> keep 2xx pages -> replenish failures from ranked tail
                 |
                 v
14 successes OR candidates exhausted OR existing budget stop
```

The resulting pages continue through the unchanged sealed context token,
proposition extraction, candidate expansion, search-data validation, GSC
coverage, and SERP sampling.

## Verification

- RED/GREEN unit test for request-level expansion deadline while the default
  extraction deadline remains 45 seconds.
- RED/GREEN page-value test for depth-only custom paths, with explicit blog and
  foreign-locale exclusions.
- RED/GREEN context-profile test matching the 34-URL sitemap shape and producing
  14 successful pages.
- RED/GREEN failure-replenishment test proving 404, 500, and transport failures
  are replaced from the ranked tail.
- Stop-reason regression proving wall-clock/request/byte stops are not relabeled
  `max_urls`.
- Focused tests, package typechecks/lint, full unit suite, and a bounded live
  crawl of `aistorygenerator.work`. No paid LLM or DataForSEO replay is required.

