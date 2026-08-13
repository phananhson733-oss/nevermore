# GenGrowth legacy English URL migration

This record freezes the English URL inventory that existed before GenGrowth
changed its default English locale from `/en/...` to unprefixed routes on
2026-07-31. It is the authority for
`/sitemap-legacy-en.xml`; it does not change the normal sitemap, robots policy,
or application-host routing.

## Input provenance

- Marketing cutover: repository commit `423d267`, dated 2026-07-31.
- Indexed URL register: the connected `gengrowth.ai` Google Sheet,
  `index-tracking` tab, read-only snapshot on 2026-08-13. It contained 64
  populated `/en/blog/...` rows sourced from the former live sitemap.
- Repository history: the English marketing routes and Markdown articles
  present at cutover, reconciled with the indexed register.
- Recovery evidence: the AstrologyWiki legacy slug that appeared outside the
  connected register and repository-backed pre-cutover route evidence.

The source union produced 79 candidate legacy blog paths. Four articles were
first published on 2026-08-07 and never had a public `/en` route, so they are
excluded:

- `how-to-find-low-hanging-fruit-keywords`
- `pagerank-sculpting`
- `striking-distance-keywords`
- `zero-search-volume-keywords`

The resulting frozen inventory is **75 blog URLs + 20 site/tool URLs = 95 old
English URLs**. `/en/tools/low-competition-keywords` is also excluded because
the tool first shipped after the locale cutover.

The executable inventory and final destinations live in
`apps/marketing/src/lib/legacy-en-migration.ts`. Tests fail on count drift,
duplicates, malformed paths, query strings, or accidental inclusion of the
known post-cutover URLs.

## Disposition

Every frozen URL has a permanent, single-hop redirect to a current unprefixed
page that is expected to return `200`.

- Seven missing indexed articles were rewritten as current, evidence-bounded
  English Markdown rather than restored from unverified historical copy.
- `astrologywiki-zero-to-5000-users` redirects to the reviewed
  `astrologywiki-case-study` article. The older draft is not republished because
  its metrics conflict with the reviewed case study.
- Existing duplicate or renamed articles redirect to their maintained page:
  `free-seo-consultation`, `free-white-label-seo`,
  `marketing-attribution-for-saas`, `serankings`, and
  `whitelabel-seo-tool`.
- Retired English hubs redirect directly to the relevant current page:
  `/pricing`, `/blog`, or `/blog#comparisons`, without an intermediate locale
  redirect.
- The pre-cutover audit routes redirect directly to their current Agent pages:
  `/en/tools/seo-audit` → `/agents/seo` and
  `/en/tools/internal-link-audit` → `/agents/tech`. This avoids an intermediate
  redirect through the retired unprefixed tool pages.

## Sitemap behavior

`https://gengrowth.ai/sitemap-legacy-en.xml` contains only the 95 old `/en`
URLs. It intentionally omits `lastmod`: the migration records when routing was
fixed, not when each old URL's source content was last modified.

The old URLs remain absent from the normal sitemap, and `/en` remains
crawlable so search engines can observe the redirects. The legacy sitemap is
not advertised in `robots.txt`; after production deployment, submit its exact
URL in Google Search Console and monitor crawl/indexing evidence there. Retire
the temporary sitemap only after the owner has enough GSC evidence that the old
URL cohort has been recrawled and the redirects have settled.

## Verification boundary

Repository tests and local HTTP checks prove inventory, XML output, redirect
hop count, and local final-page availability. They do not prove that a commit
has been deployed, that Google has fetched the sitemap, or that indexing has
converged. Those are separate post-deployment checks.
