# On-Page Checker Entry Redirect Design

## Problem

The On-Page SEO Checker currently reports `target_page_not_captured` when a
submitted URL resolves to a different page before the site crawl starts. The
reported state is contract-valid but not actionable: the entry resolver knows
the final URL, then discards that fact and crawls the final site entry. The UI
can only say that no readable target page was collected.

The production example is:

```text
https://astrologywiki.com/rre3nynojk3o
  -> https://www.astrologywiki.com/rre3nynojk3o
  -> https://www.astrologywiki.com/?utm_source=maximum.fm&utm_medium=backlink
  -> 200 text/html
```

The homepage must not be scored as though its keyword evidence belonged to the
submitted random path. At the same time, a path-changing redirect is not a
generic crawl failure and should not consume a full crawl plus a SERP lookup.

## Approved behavior

The On-Page SEO Checker will require the entry resolver to finish on the same
canonical page subject that the visitor submitted. These normalizations still
count as the same page:

- HTTP to HTTPS;
- apex to `www` or `www` to apex;
- a trailing-slash difference;
- tracking-parameter removal and query ordering normalization.

If the canonical path or a non-tracking query changes, the checker will stop
after entry resolution and return:

- HTTP `422`;
- public error code `target_redirected`;
- a validated `Location` header containing the canonical final URL.

The browser will explain that the submitted URL resolves to a different page,
show the destination, and offer a button that replaces the form URL with that
destination. It will not automatically start another run.

## Boundaries

The strict entry policy applies only to `/api/tools/on-page-seo-check`.

The following behavior remains unchanged:

- the authenticated SEO Agent and its site-wide crawl;
- the standalone SEO Audit tool;
- Internal Link Audit;
- crawl budgets, SSRF rules, robots handling, cache storage, and rate limits;
- keyword evidence and score semantics for a real target page;
- Product App, Worker, database, migrations, and environment variables.

Because the successful audit payload does not change, no SEO-audit schema or
cache version bump is required. The new path is an error result produced before
a cacheable crawl exists.

## Data flow

```text
On-Page POST
  -> authenticate and validate request
  -> strict entry resolution
       -> same canonical subject: continue existing crawl
       -> different canonical subject: throw typed redirect outcome
  -> SEO audit handler maps outcome to 422 + Location
  -> Agent boundary validates and forwards only that safe Location
  -> browser renders target_redirected + destination action
```

The entry comparison is made after rebasing the submitted path and query onto
the allowed final origin. This preserves apex/`www` and scheme normalization
without treating an unrelated path on the same host as the same page.

## Safety

- The entry resolver continues to admit only HTTP(S), credential-free,
  same-host or apex/`www` transitions and never allows HTTPS downgrade.
- The error target is canonicalized before it leaves the crawler, which removes
  fragments and tracking parameters.
- The Agent boundary independently validates the `Location` header against the
  normalized submitted URL. A missing, malformed, credential-bearing, or
  cross-domain location becomes `audit_response_invalid` rather than reaching
  the browser.
- The browser validates the header again before rendering it as a link or using
  it to replace form state.
- No prompt, page body, provider response, credential, or token is logged.

## Verification

The change is test-driven at each boundary:

1. Sources: a same-host path-changing entry redirect is rejected before the
   crawl transport runs, while scheme/host/slash/tracking-only changes continue.
2. Public tools: the typed redirect becomes `target_redirected` with its safe
   destination.
3. Marketing handler: buffered On-Page responses return 422 and `Location`;
   ordinary SEO Audit requests retain existing behavior.
4. Agent boundary: the stable error code and safe location are forwarded;
   invalid locations fail closed.
5. Client: the destination is rendered and the explicit action replaces the
   URL without automatically submitting.
6. Release: focused tests, package lint/typecheck, repository gates, Marketing
   build, secret scan, production deployment identity, live route/bundle/log
   checks, and independent Product deployment verification.

