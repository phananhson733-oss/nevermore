# SEO Agent review remediation

Scope: the four defects found while accepting PR #309. Base: `1f7d4562` (PR #310).
Credit treatment is unchanged. Missing SEO crawl tier still executes `key-pages`.

## Changes and acceptance

1. Pre-tier SEO clients are identified by the absence of both `tier` and `extraKeyPages`.
   Their response keeps the old five-field candidate shape and 24-row transport limit,
   and maps `full_site_only` to the previously understood incomplete-crawl limitation.
   This only changes the response projection: collection still uses the key-pages budget,
   unverified findings stay unverified, and the cached neutral payload is not rewritten.
   Explicit-tier clients retain the full modern candidate list and specific limitation.
   Tech and On-Page response formats retain their existing behavior.
2. The shallow/deferred-sitemap frontier gives seeds and homepage navigation a priority lane.
   Ordinary links wait for the homepage to settle so fast manual-page discovery cannot
   consume the shallow budget before navigation is known. Duplicate queue references are
   discarded without duplicate fetches. The full-site frontier keeps its prior ordering.
3. Manual URLs are rebased to the final allowed origin and normalized using `canonical_url.v1`
   before matching successful crawl journeys. Tracking parameters and query order no longer
   lose a manual page. Matching retains exact slash-variant success/failure: a successful
   sibling URL cannot stand in for a requested URL that returned an error.
4. Excluded checks retain the explicit full-site requirement in the issue model. EN/ZH rows
   explain that the key-pages scope did not execute the check. The Full site action switches
   the form scope and focuses its selector; only a further confirmation starts a new audit.

The crawler vendor manifest hash changes because the local engine adaptation now includes
the shallow-profile priority lane. No upstream vendor checkout is modified.

## Regression coverage

- Real crawler → report producer → Agent response tests cover apex/www changes, HTTPS upgrade,
  tracking removal, query sorting, unavailable pages, both slash-variant directions,
  crowded-homepage navigation, legacy response bounds/vocabulary, and modern complete lists.
- The concurrent engine test keeps ordinary discovery behind a slow homepage and checks
  navigation collection, no duplicate requests, and the existing page budget.
- EN/ZH result tests exercise actual evaluator → issue model → rendered exclusion rows.
- EN/ZH browser regressions cover scope explanations, explicit scope selection, focus,
  no automatic rerun, confirmation, and responsive overflow.

Local validation and live deployment must be established separately. GitHub merge SHA,
Vercel READY state and current aliases are the release authority; this document does not
claim a deployment merely because these source changes exist.

## Verified local candidate

- Unit suite: 1,178 files / 18,854 tests passed with two workers.
- Full workspace typecheck and Marketing + Web production builds passed.
- Docs, authority, spec tests, implementation, contracts, OpenAPI, deploy configuration
  and vendor gates passed. Changed-file ESLint and diff whitespace checks passed.
- Agent browser suite: 9/9 passed, including both new scope-switch tests.
- A real, bounded public crawl from `www.gengrowth.ai` resolved to `gengrowth.ai` in
  26.9 seconds, collected 76 pages, retained all 11 homepage navigation URLs, and selected
  the requested `/pricing?utm_source=seo-review` as canonical `/pricing` with manual reason.
  The manual-unavailable list was empty; C1/C2/C5 remained unverified with zero tested units.
  This was a local crawler canary without authenticated provider or billing calls.
- Existing baseline exceptions remain: two public-tools lint errors and one JWT test-fixture
  secret-scan alert. Their files are outside this remediation diff.
