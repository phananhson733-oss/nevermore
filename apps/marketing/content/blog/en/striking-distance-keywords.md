---
title: How Striking Distance Keywords Reveal the Right Pages to Fix First
excerpt: Striking distance keywords are queries where your pages already rank close to the top — typically the 5–20 position range, though published definitions vary
author: GenGrowth Team
category: methodology
pillar: seo_content
status: published
publishedAt: 2026-08-07
updatedAt: 2026-08-07
heroImage: /images/blog/striking-distance-keywords.jpg
heroImageAlt: A dartboard with four darts landed in the ring just outside the bullseye, and one hand drawing a fifth dart back for another throw.
localeExclusive: true
---

## What Is a Striking Distance Keyword?

Striking distance keywords are **queries where your pages already rank close to the top — typically the 5–20 position range, though published definitions vary** — existing pages close enough to the top that targeted on-page changes tend to move them up, rather than requiring new content. The phrase reflects the idea that you are already in range; closing the gap is faster than starting from scratch.

- These queries appear in GSC with average positions in the 5–20 band, often with solid impression counts but low click-through rates
- Top-five results generally attract a larger share of clicks than page-two results, but the curve is not uniform — SERP features and AI Overviews can flatten or even invert it on an individual site, so measure your own click-through rate by position band rather than assuming a standard curve
- Unlike entirely new keyword targets, these pages are already indexed and already surfacing for the query; the work is about signaling relevance more precisely

This is the diagnostic half of keyword work; the selection half is covered in the [pillar guide to low hanging fruit keywords and keyword difficulty](/blog/how-to-find-low-hanging-fruit-keywords), which is about picking terms worth ranking for in the first place.

## Why It Matters for Your Workflow

When a team decides what to work on next, the instinct is often to publish new content or build more links. Striking distance keywords point to a faster alternative: pages that already exist, already rank, and already attract impressions — but are leaking clicks because they sit just outside the positions where users consistently click through.

The practical value is prioritization. This workflow answers a direct question: which pages carry striking distance keywords worth acting on right now, and in what order? For agencies on monthly retainers, data-backed prioritization like this is what separates a defensible content plan from a list of tasks. For in-house teams, it shortens the distance between "we need more traffic" and "here is exactly what to fix this week."

For a structured starting point before prioritizing, [how to segment a traffic drop before diagnosing it](/blog/google-july-2026-update) walks through how to segment GSC data as a first diagnostic step before drawing any conclusions about which pages to fix.

## How Striking Distance Keywords Work in Real Agency Scenarios

The standard advice is simple: export GSC, filter for average position between 11 and 20, and refresh those pages. In practice, the workflow has several more steps — and a statistical trap worth naming before you hit it.

Here is how this typically plays out across agency and in-house teams:

1. **Export GSC performance data** for a rolling 90-day window grouped by query. Set an impressions floor before you filter anything else — the sizing rule is in "How to Evaluate" below, and applying it here saves you from carrying rows you will drop later.
2. **Apply your position filter in the export, not in Search Console** — position is a metric there, not a filterable dimension, so the band has to be applied in your spreadsheet. Use a consistent band; 5–20 is the most common starting point. Note what the figure you are filtering on actually is: GSC averages the topmost position your property held across every impression, not across the distinct positions you can see. Two queries both showing "average position 15" can have very different distributions: one might show your page 1,000 times consistently at position 15; the other might show it 500 times at position 8 and 500 times at position 22 — the same aggregate of 15, meaning something very different for your optimization decision.
3. **Segment by country and device** before trusting any row in the export. A query showing average position 14 in aggregate might already rank position 4 in your primary market and position 24 everywhere else. The aggregate obscures that difference entirely.
4. **Group remaining queries by landing page URL** to find which pages have the highest concentration of striking distance keywords. A single page with eight qualifying queries is a better candidate than eight separate pages each with one qualifying query.
5. **Prioritize by impressions and click-through gap.** A query at position 6 with high impressions and a below-average click-through rate has more upside than one at position 18 with minimal traffic potential.

## Common Implementation Misreadings

Teams running this analysis often make the same four mistakes. Here is what each one looks like and what to do instead:

1. **Averaging the positions you can see instead of the impressions behind them.** GSC averages the topmost position across every impression. A query that returns your page 90 times at position 20 and once at position 2 reports about 19.8 — not the midpoint of the two positions. In the audits we run, this is a recurring reason a page gets re-optimized with no movement: it already ranked well for the queries that mattered, while low-intent impressions from off-target geographies pulled the aggregate number down.
2. **Using inconsistent position bands across reporting periods.** Published guides use ranges from 5–20, 8–20, and 11–20 — none is universally wrong, but switching between them makes period-over-period comparison meaningless. Pick one band and hold it for at least a quarter before reconsidering.
3. **Skipping country and device segmentation.** Filtering by position without breaking down by geography or device produces a list that mixes pages already performing well in your core market with pages that are genuinely stuck — with no way to tell them apart.
4. **Optimizing for the aggregate query instead of specific query variants.** If a page appears because 10 different queries place it in range, the right fix is likely different for each variant. Refreshing the title for the highest-volume query and ignoring the others leaves clear wins on the table.

## Striking Distance Keywords at a Glance — Quick Reference

| Scenario | Default Move | What GSC Segmentation Changes | How to Know Which Applies |
|---|---|---|---|
| Page shows average position 11–20, single primary market | Refresh page copy for the top query in range | Confirms whether the page genuinely ranks mid-page or already ranks top 5 for your core geography | Export country-filtered data and compare to the aggregate position |
| Page shows position 14 in aggregate, serves multiple geographies | Treat as uniformly mid-page; commission new supporting content | Reveals whether the page ranks well in the primary market while lower-position impressions from other countries pull the aggregate down | As a rough cut: country breakdown shows more than 8 positions of variance across geographies |
| Multiple queries landing on one URL, all in range | Optimize for the single highest-volume query | Identifies which sub-topics are genuinely stuck versus already ranking well | Match each query to the H2 or section it aligns to most directly; fix only the stuck sub-topics |
| Page ranking 6–10 with high impressions but low CTR | Assume ranking is healthy and deprioritize | Flags the page as a candidate where the gap is in the title or meta description, not content depth | CTR is noticeably below what the rest of your own site earns at that position band |

## How to Evaluate Striking Distance Keywords

Not every query in the 5–20 band qualifies as a striking distance keyword worth acting on. Five criteria help separate high-signal candidates from low-priority noise:

1. **Impressions above a meaningful floor.** A query with 40 impressions over 90 days won't move the business regardless of position. Set your floor based on what a top-five click-through rate would produce in monthly visits — as a rough cut, if the answer is under 15 visits per month, deprioritize.
2. **Click-through rate below your own baseline for that band.** If a page ranks at position 7 but its click-through rate sits well below what the rest of your site earns at that position band, the problem is likely in the title or meta description — a faster fix than a content overhaul. Build that comparison from your own Search Console data: published CTR tables describe a plain blue-link results page and rarely match a real site.
3. **Stable ranking with low variance over the period.** A query bouncing between position 8 and 26 over 90 days signals a different problem than one sitting consistently at position 14. Volatile rankings often mean the result set itself is unsettled for that query, or that two pages on your own site are competing for it. Stable rankings in the mid-range usually have a more mechanical fix available, like a title tag update or a new internal link from a higher-authority page.
4. **Alignment between query intent and landing page format.** If the query reads as a comparison search and the page is structured as a definition post, the ranking ceiling is set by content format — not on-page signals you can tune in isolation.
5. **No active cannibalization conflict.** Search Console reports only the topmost position your property held for a query, so a query-level export will never show two of your own pages competing. Filter to the query, then switch to the Pages view to see whether more than one URL is picking up impressions for it. Resolve that overlap before writing any new copy: either consolidate the weaker URL into the stronger one, or differentiate the two pages by intent so they stop competing for the same query.

## How to Implement Striking Distance Keywords Step by Step

The steps below work directly from GSC — no third-party tool required.

1. **Export 90-day query data** from GSC Performance grouped by query. Use the date-comparison feature to pull the equivalent prior period so you can track position changes, not just static snapshots.
2. **Apply your position band in the export, not in Search Console.** Export to CSV first, then filter to your chosen band (5–20 is the most common starting point) and drop rows below the impressions floor you set in step 1. Two limits to know before you trust that export: the Search Console UI caps exports at 1,000 rows, so a larger site needs the Search Analytics API or the bulk data export; and Search Console withholds low-volume "anonymized" queries from the table entirely, which on some properties is a large share of total impressions.
3. **Run a second export filtered to your primary market country.** Merge both to find queries where the aggregate and in-market positions differ by more than five positions — as a rough cut, those are your priority candidates.
4. **Group by landing page URL.** Pages carrying three or more qualifying striking distance keywords in range deserve attention before any page with a single qualifying query.
5. **Diagnose the likely fix for each high-priority page.** Common fix types include: title tag alignment, H1 or header restructuring, internal links pointing to the page, or added depth on the specific sub-topic the query is targeting.
6. **Make one change at a time and record the date.** Search Console data is normally available within two to three days (the 24-hour view shows preliminary figures that can still change), and position changes take a few weeks to settle — batching multiple edits on the same day makes it impossible to attribute what moved.
7. **Re-export and compare after 30 days.** Track both position and CTR independently — a title-tag fix often improves CTR before it changes position, which is a useful diagnostic signal in itself.

One of those fix types deserves its own workflow: when the lever is internal links rather than copy, the [guide to internal link structure and link equity](/blog/pagerank-sculpting) covers how to find the pages that are already wasting the authority you have.

## Common Questions About Striking Distance Keywords

**What position range counts as "striking distance"?**

There is no universal standard — published guides use ranges from 5–20, 8–20, and 11–20, and some use "page two" as the criterion. The specific range matters less than applying a consistent one across reporting periods. Pick a band that reflects your site's competitive situation and hold it for at least a quarter before revisiting.

**Why do my GSC positions look different from what Ahrefs or Semrush reports?**

GSC reports impression-weighted average positions across all queries, countries, and devices that triggered your page during the period. Third-party tools sample from specific geographies and query sets. For this type of analysis, GSC is the authoritative source because it reflects your actual traffic patterns, not an estimated proxy.

**Can a page have too many qualifying queries to be worth optimizing?**

Not exactly — but a page with 15 qualifying queries spread across very different intents may need structural changes (splitting into separate pages or adding targeted sections) rather than a single content refresh. The value of this workflow is focusing effort on pages with concentrated upside, not maximum raw impression count.

**How often should this analysis run?**

Monthly is standard for active content programs; quarterly works for lower-traffic sites. What matters more than frequency is consistency — applying the same filter to the same date-range structure each time so period-over-period comparisons stay meaningful.

## Related Reading

- [guide to pagerank sculpting and link equity](/blog/pagerank-sculpting) — for whether pointing more internal links at a striking-distance page is still a lever that works
- [series walkthrough of zero search volume keywords](/blog/zero-search-volume-keywords) — for the opposite problem: a term the tools report as having no demand at all
- [pillar guide to low hanging fruit keywords and keyword difficulty](/blog/how-to-find-low-hanging-fruit-keywords) — for choosing which terms are worth this workflow in the first place

## Take Action

Connect Search Console read-only and [find your SEO opportunities in Search Console](https://gengrowth.ai/tools/seo-quick-wins). It reads your last 28 days, builds your site's own click-through baseline, and returns the non-brand queries collecting impressions while converting below that baseline — ranked by click gap, with the observed numbers and the expected-versus-actual clicks, exportable as CSV. It also drafts up to five titles per run, on the largest gaps, and only where your own site already has a comparable higher-CTR page to model one on. One thing to expect: the report reads queries rather than pages — so the page-level grouping in step 4 above stays a manual step in your export. It hands you a shortlist to check, not a ranking forecast: the judgment about which query is worth an afternoon still belongs to you, but you start from your own evidence instead of a spreadsheet filter.

## Sources

- [Google Search Console Help: impressions, position, and clicks](https://support.google.com/webmasters/answer/7042828)
- Based on patterns GenGrowth has observed across agency and in-house SEO audits; no third-party study is cited
