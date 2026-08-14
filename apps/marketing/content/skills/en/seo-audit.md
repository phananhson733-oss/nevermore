---
title: SEO Audit
description: A point-in-time diagnosis of one site — what is blocking it, ordered by what would change most if fixed, with every finding naming how it was observed.
tagline: Know what is blocking one site — and what to fix first
category: seo
owner: seo
fileName: seo-audit.md
keywords: seo audit skill, website seo audit, technical seo diagnosis, site audit findings, seo issue prioritisation, crawl and index audit, seo audit report
relatedSkills: technical-seo-checklist, keyword-research
relatedPrompts: seo-content-audit-prompt, serp-competitor-analysis-prompt
status: published
publishedAt: 2026-08-14
---

## Skill file

```text
---
name: seo-audit
description: Diagnose one site at one point in time, ordering findings by stated severity rules and marking every check that could not be run as unchecked.
owner: GenGrowth SEO Agent
---

# SEO Audit

Your job is to produce a diagnosis of one site as it stands on one date. Every
finding names how it was observed. Every check that could not be run is listed
as unchecked, not as passed. There is no overall score.

## What counts as evidence

Five sources, in descending order of trust:

1. Retrieved — a response you fetched yourself: status code, headers,
   robots.txt, sitemap XML, raw HTML before JavaScript, rendered DOM after it.
   Quote the URL and say which of raw or rendered you read.
2. Measured — the site's own Search Console and analytics data: impressions,
   clicks, indexing status, average position over a named date range.
3. Observed — what live search results show for a query today.
4. Provider-supplied — third-party crawler or metrics output. An estimate,
   labelled as such everywhere it appears.
5. Reported — what the team told you about the CMS, the build, or the redirect
   layer. A claim. Either verify it and promote it to retrieved, or record it
   as unchecked.

A number you did not obtain is unavailable. Write "unavailable" and say what
would produce it. Never write zero in its place: zero is a measurement.

## Severity rules

Assign severity from these definitions, not from judgement:

- Blocking — the page cannot be reached, crawled, or indexed, or its main
  content is absent from what a crawler receives. Requires retrieved evidence:
  a status code, a directive, or a raw-HTML fetch.
- Major — the page is reachable and indexable, but the thing the searcher asked
  for is not on it, or the site competes against itself for the same query.
- Minor — the implementation deviates from convention with no observable effect
  on what a crawler or a searcher receives.
- Unchecked — the check could not be run with the access available.

## Procedure

1. Fix the boundary. Name the hostnames in scope, the sections in scope, the
   date, and the access you have. An audit is a photograph with a timestamp; a
   finding without a date cannot be re-tested later.

2. Take the delivery layer first. Fetch robots.txt and the sitemaps. Sample
   URLs from each sitemap and record the status code, the final URL after
   redirects, the canonical, and the robots directives. Discrepancies here
   invalidate everything measured downstream.

3. Read raw HTML before rendered DOM on the pages that carry measured demand.
   If the main content only exists after JavaScript runs, say so and name the
   URLs you checked.

4. Rank pages by measured impressions, not by your own sense of importance.
   Audit the top pages properly rather than every page shallowly. State how
   many you examined and how you chose them.

5. For the queries those pages already appear for, look at what ranks now and
   what those pages cover. A gap between the two is a Major finding with the
   query named.

6. Order findings by severity band, then within each band by measured demand on
   the affected URLs. Where demand is unavailable, order by internal link depth
   and say you used a proxy. Do not blend severity and demand into one number.

7. Write the unchecked list last, with the access or data that would settle
   each item.

## Output

A findings table: finding, severity and the rule that triggered it, evidence
type and the URL or query it came from, count of affected URLs and how that
count was obtained, and the change to make. Then the unchecked list. Then two
sentences on what the site's current constraint appears to be.

## Refuse to

- Emit an overall SEO score, grade, or percentage.
- Mark a check as passed when it could not be run.
- Present an estimate, a provider metric, or a claim as a measurement.
- Substitute zero for a number that was unavailable.
- Extrapolate an affected-URL count without labelling it an extrapolation.
- Promise a ranking, a traffic figure, revenue, or a timeline.
- Recommend a keyword density or a repetition count.
- Report a finding without naming how it was observed.
```

## What it does

The usual audit output is a PDF with two hundred rows and a number at the top. Nobody can act on it, because the rows are undifferentiated: a missing alt attribute sits beside a noindex directive on the money page, and the score at the top absorbs both into a figure that cannot be argued with. Worse, the rows that a tool could not evaluate — because the crawl hit a depth limit, or the analytics property does not cover that directory — are quietly rendered as green. The team fixes the alt attributes.

This skill produces a diagnosis instead. Each finding carries how it was observed, so a colleague can re-run the same fetch and get the same answer. Severity comes from four written definitions rather than from a weighting nobody sees, which means a disagreement about priority becomes a disagreement about a rule, not a disagreement about a number. Checks that could not be run appear in their own list with the access that would close them.

It is deliberately point-in-time. The continuous skills in this library watch a site over weeks and report what moved; this one answers a different question — what is wrong with this site as of today, and what would change most if fixed. That distinction matters when you are deciding whether to invest in a site at all, or inheriting one and needing a map before you touch anything.

There is no score, and this is not a stylistic choice. A single figure combining crawl health, content coverage, and link data implies those things trade off against each other. They do not. A site can be technically clean and still have nothing worth ranking.

## In action

### You ask

We are riverbend-supply.com, a plumbing parts distributor with about 4,000 product pages. Traffic has been flat for five months and we have no idea where the problem is. Search Console is connected.

### The agent does

Four findings, ordered by severity band, then by measured demand.

Blocking. The forty product pages with the highest impressions serve their specification tables client-side. I fetched raw HTML for twelve of them: the table markup is absent from the response and appears only in the rendered DOM. Thread size, material, and pressure rating — the things these queries are asking for — are all in that table.

Blocking. Discontinued products return 200 with an empty product body. I pulled 30 URLs from your sitemap; all 30 returned 200 and 18 had no product content. These are soft 404s.

Major. Category filters generate crawlable URLs (?brand=, ?size=, ?material=), each canonicalising to itself. My crawl reached 1,340 of them before hitting the depth limit. The true total is higher; I have not extrapolated it.

Minor. Every sitemap entry carries the same lastmod date, which looks like a generation artefact rather than real change data.

Unchecked. I cannot tell you how many of the 4,000 product pages are indexed. The connected Search Console property is a URL-prefix property covering /shop/, and product URLs live under /catalog/. A domain property would settle this.

Rendering comes first because it affects pages with measured impressions now. The filter URLs waste crawl on pages nobody searches for, which is real but slower.

## How it works

### Fix the boundary and the date

The agent states which hostnames and sections are in scope, what access it has, and the date the audit describes. Findings written this way can be re-tested later against the same evidence, which is what separates an audit from an opinion.

### Retrieve before judging

Delivery comes first: robots.txt, sitemaps, sampled status codes, final URLs after redirects, canonicals, and directives. Then raw HTML before rendered DOM on the pages that matter, because a page whose content only exists after JavaScript is a different problem from a page with thin content.

### Apply the severity rules

Each finding is matched against four written definitions — blocking, major, minor, unchecked — and the output names the rule that triggered it. Nothing is scored, weighted, or summed, so the ordering can be challenged on the rule rather than on the arithmetic.

### Order by demand, then declare the gaps

Within a severity band, findings are ordered by measured impressions on the affected URLs; where that is unavailable, the agent orders by internal link depth and says it used a proxy. The unchecked list closes the report, naming the access or data each item needs.

## What it covers

- Delivery-layer verification: status codes, redirect chains, canonicals, robots directives, sitemap accuracy
- Raw-HTML versus rendered-DOM comparison on the pages carrying measured demand
- Index coverage read from the site's own Search Console property, with the property's scope stated
- Query-level content gaps: what a page appears for versus what it actually covers
- Self-competition detection across near-duplicate pages, templates, and filter URLs
- An explicit unchecked list, each item paired with the access that would resolve it

## When to use it

- A site has been running for years and nobody currently on the team knows what state it is in
- Traffic is flat or declining and the cause has not been isolated to content, crawling, or indexing
- You are inheriting a site — an acquisition, a new client, a rebuilt team — and need a map before changing anything
- A previous audit produced a score and a long list, and the work that followed changed nothing observable
- A migration or replatform has completed and you need to know what it broke before the effects compound

## FAQ

### How is this different from the Technical SEO Checklist skill?

The checklist verifies a fixed set of conditions and reports each as met, not met, or unchecked. It is the right tool before a launch or after a deploy, when the question is whether known requirements hold. The audit is open-ended: it starts from the site's measured demand and works backwards to find what is standing between it and the searcher, including problems no checklist anticipated. In practice the audit will often invoke checklist-style verification for the delivery layer, then keep going.

### Why does it refuse to produce an SEO score?

Because a score merges things that do not trade off. Blocking a crawler from a page and using a slightly short title are not two amounts of the same quantity, and averaging them produces a number that moves for reasons nobody can name. A score also hides its own gaps: checks that could not be run have to be counted as something, and they almost always get counted as fine. Naming the findings and the rules keeps both problems visible.

### What happens to checks it cannot run?

They go in the unchecked list with a reason and a remedy — no log access, an analytics property that does not cover the directory, a crawl that hit a depth limit, a staging environment behind auth. This is the single most common place audits mislead people, because an unchecked item and a passed item look identical in most reports. Here they never do.

### How often should an audit be re-run?

Re-run it when the site changes materially — a replatform, a template rewrite, a large content migration — or when a new constraint appears that the last audit did not name. Running the same full audit monthly mostly reproduces its own previous output. If the question is whether last month's fixes moved anything, that is monitoring rather than diagnosis, and the audit's job at that point is only to confirm the specific finding is now observably resolved.
