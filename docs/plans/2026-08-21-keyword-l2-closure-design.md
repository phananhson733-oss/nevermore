# Keyword Opportunity L2 Closure Design

Date: 2026-08-21
Status: approved for local implementation
Base: `origin/main@39bddaa2aceaaa68e226221e2f73a8f5d2f26fe4`

## Authority and approved deltas

The acceptance source is the supplied 2026-08-19 data/field specification,
reconciled with the owner's later decisions:

1. Attempt SERP for every deduplicated candidate except a provider-confirmed
   explicit zero; do not impose an aggregate cost or elapsed-time cutoff during
   the initial implementation. Bounded provider concurrency and per-call safety
   limits remain.
2. Defer Blog Agent/writing-page handoff. Internal evidence may prepare for it,
   but no public AIO markdown or draft action is added.
3. Raise the L2 successful-page ceiling to 20.
4. Treat an AI Overview complete answer as a ranking discount, not a veto.
5. Keep coverage evidence honest: missing or truncated GSC/sitemap evidence
   never proves zero exposure or site-wide absence.

The supplied document is an acceptance input, not authorization to commit,
push, deploy, migrate, call paid providers, or write production data.

## Problem

The v2 release retained the legacy page-value frontier. That frontier explicitly
gave `/about` a product-like score and had no hard exclusion contract for common
utility/auth routes, single content pages, or pagination. It also merged
homepage links and sitemap URLs before ordering, so the required source order
was not representable, and the result did not retain the exact number of pages
omitted by the 20-page limit.

Separately, the generic error message promised that a run without a report was
not charged. Current credits are testing-only and are not deducted, while
provider/LLM costs can already have occurred. Stage-two cost telemetry was
emitted only after a successful report, hiding paid work from failed runs.

## Design

### L1 and L2 remain separate

L1 sitemap inventory stays URL-only and retains every valid same-origin URL,
including `/about`, legal pages, auth pages, articles, and pagination. Those URLs
are coverage evidence and must not disappear merely because they are poor L2
context.

L2 applies a pure eligibility classifier before a candidate can issue an HTTP
request or consume one of the 20 successful-page slots. The classifier reads the
full URL, removes a recognised locale prefix for route semantics, and returns an
explicit exclusion reason rather than encoding eligibility indirectly in a
numeric score.

Hard-excluded route families are:

- company/utility: about, contact, careers/jobs and common slug variants;
- legal/policy: privacy, terms, legal/impressum and common variants;
- auth/account: login/sign-in, signup/register, account/dashboard/admin/auth;
- content detail: descendants of blog/resource/article/post roots;
- pagination: `page`/`paged` query values greater than one and `/page/N`
  descendants.

Blog/resource list roots remain eligible. Unknown same-language shallow routes
remain a last-tier fallback so custom product slugs are not silently discarded.

### Source-aware priority

The homepage is always first. Remaining candidates are ordered by this explicit
priority before page-value/depth/URL tie-breakers:

1. homepage header/nav/footer internal targets;
2. product, tool, feature, solution and equivalent product-like routes;
3. pricing routes;
4. blog/resource list roots;
5. sitemap and other shallow fallbacks.

The HTML parser exposes navigation fetch targets as an ephemeral sidecar. It
does not change persisted crawl metrics. Duplicate URLs keep their highest
priority source.

### Selection statistics

The crawl returns a bounded selection summary:

```ts
{
  eligibleCandidates: number;
  excludedCandidates: number;
  attemptedCandidates: number;
  truncatedCandidates: number;
}
```

The homepage is not counted as a candidate. `truncatedCandidates` means eligible
URLs never attempted because 20 successful pages had already been obtained. A
failed fetch that causes replenishment does not inflate this value. Existing
`pagesFetched` remains the count of successfully projected pages including the
homepage.

Stage one displays the summary before the user starts keyword evidence work.
The sealed token carries the summary, and the final report repeats it. Older
ten-minute tokens and old fixtures remain readable through an optional public
projection, but every newly minted token supplies it.

### Error and cost honesty

The generic error says only that no usable report was produced and suggests a
retry. A separate global testing notice remains the only place that may say
user credits are free while testing.

Stage-two cost reporting moves to one `finally` boundary after billable work is
admitted. It emits exactly once on both success and failure and carries an
explicit `reportProduced` boolean. Provider costs remain booked at provider
response boundaries; LLM usage remains request-scoped. No user-credit charging,
refund promise, billing table, or new public billing state is introduced.

## Tests

- Pure route matrix: exact paths, locale prefixes, common variants, content
  list/detail distinction, query pagination and path pagination.
- Crawl integration: excluded URLs never issue requests; L1 still contains
  them; navigation/product/pricing/list/fallback priority is deterministic;
  failed candidates replenish; exact truncation statistics survive.
- Token/API/UI: new runs carry and render selection counts in both stages;
  old tokens remain tolerated.
- Cost/error: success and post-provider failure each emit one cost report;
  the failure report retains actual endpoint/LLM usage and says no report was
  produced; generic EN/ZH copy contains no charge/refund promise.
- Existing v2 provider, coverage, evidence, CSV and result tests remain green.

## Non-goals

- No Blog Agent handoff, draft generation, CMS write, App canonical write, or
  public AIO markdown.
- No new billing/credits consumption or refund implementation.
- No paid provider/GSC canary, commit, push, PR, deployment, or migration in
  this authorization.
