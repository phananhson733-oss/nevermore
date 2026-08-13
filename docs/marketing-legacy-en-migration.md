# GenGrowth legacy English URL migration

This record freezes the English URL inventory that existed before GenGrowth
changed its default English locale from `/en/...` to unprefixed routes on
2026-07-31. It is the authority for the temporary legacy migration sitemap
surface; it does not change the normal sitemap, robots policy, or
application-host routing.

## Input provenance

- Marketing cutover: repository commit `423d267`, dated 2026-07-31.
- Indexed URL register: the connected `gengrowth.ai` Google Sheet,
  `index-tracking` tab, read-only snapshot on 2026-08-13. It contained 64
  populated `/en/blog/...` rows sourced from the former live sitemap.
- Repository history: the English marketing routes and Markdown articles
  present at cutover, reconciled with the indexed register.
- Repair evidence: the 2026-08-05 SEO audit and 2026-08-10 migration closeout
  notes that identified still-indexed legacy blog URLs, broken legacy tool
  destinations, and the need for a dedicated legacy sitemap.

This inventory is **not** an exact raw GSC two-window export. It is the
reproducible union of:

- 75 legacy blog URLs supported by the connected 64-row blog register plus
  repair-evidence additions that remained indexed after cutover;
- 20 cutover-era site/tool hub URLs;
- 50 cutover-era glossary detail URLs;
- 4 cutover-era compare detail URLs;
- 6 cutover-era playbook detail URLs;
- 4 cutover-era use-case detail URLs;
- 3 cutover-era extra tool URLs.

The resulting auditable inventory is **162 legacy `/en` URLs**.

Known post-cutover pages are intentionally excluded because they never had a
public `/en` route:

- `how-to-find-low-hanging-fruit-keywords`
- `pagerank-sculpting`
- `seo-content-clusters-draft`
- `striking-distance-keywords`
- `zero-search-volume-keywords`
- `/en/tools/low-competition-keywords`

The executable inventory and final destinations live in
`apps/marketing/src/lib/legacy-en-migration.ts`. Tests fail on count drift,
duplicates, malformed paths, query strings, or accidental inclusion of the
known post-cutover URLs.

## Disposition

Every frozen URL has an explicit terminal outcome: a permanent single-hop
redirect to a semantically equivalent `200` page, or a direct `410 Gone` when
no defensible equivalent remains. Generic redirects to `/blog` or `/pricing`
are not accepted as terminal outcomes because search engines can classify them
as soft 404s.

- Direct cutover-history routes keep the same canonical path without the `/en`
  prefix and carry migration cohort `2026-07-31`.
- Repair-evidence routes carry migration cohort `2026-08-13`.
- Existing duplicate or renamed articles redirect to their maintained page:
  `free-seo-consultation`, `free-white-label-seo`,
  `marketing-attribution-for-saas`, `serankings`, and
  `whitelabel-seo-tool`.
- The pre-cutover audit routes redirect to their current Agent pages:
  `/en/tools/seo-audit` → `/agents/seo` and
  `/en/tools/internal-link-audit` → `/agents/tech`.
- The retired comparison hub redirects to the maintained comparison section:
  `/en/compare` → `/blog#comparisons`.
- Recovered legacy articles remain explicit repaired entries. Their final
  canonical target can change later, but the repaired 2026-08-13 cohort itself
  is part of the authority.
- Seventy-five retired URLs return `410`, including the unverified glossary
  corpus, retired playbook/use-case/compare leaves, two obsolete calculators,
  and the Blaze, Cometly, and Okara comparison articles that the 2026-08-12
  handoff classified as no longer wanted.

## Sitemap behavior

`https://gengrowth.ai/sitemap-legacy-en.xml` contains only the legacy `/en`
URLs in this inventory. Each `<lastmod>` is the fixed migration cohort date for
that entry:

- `2026-07-31` for the default-locale cutover cohort
- `2026-08-13` for the repaired override cohort

These are migration dates, not article publication or content-update dates.

The old URLs remain absent from the normal sitemap, and `/en` remains
crawlable so search engines can observe the redirects. After production
deployment, submit the exact legacy sitemap URL in Google Search Console and
monitor crawl/indexing evidence there. Retire the temporary sitemap only after
the `/en/` exposure share has fallen below 5% (68.9% in the 2026-08-12
handoff), and never retain it for more than six months after production
submission. The owner must remove the route and its GSC submission at that
point; the canonical sitemap remains the permanent surface.

## Verification boundary

Repository tests and local HTTP checks prove inventory, XML output, redirect
hop count, redirect targets, and `410` classifications. They do not prove that
a commit has been deployed, that Google has fetched the sitemap, or that
indexing has converged. Those are separate post-deployment checks.
