---
title: Internal Links Not Improving Rankings — What Our Own Audit Could and Could Not Prove
excerpt: Three of our pages showed 68 pages linking to them — the highest count on the domain, 3.8 times the next-highest page at 18.
author: GenGrowth Team
category: methodology
pillar: seo_content
status: published
publishedAt: 2026-08-28
updatedAt: 2026-08-28
heroImage: /images/blog/internal-links-not-improving-rankings.jpg
heroImageAlt: Technical blueprint illustration of a ballot box being filled by one automated dispenser feeding a tall stack of identical printed slips, while a few hand-written slips drop in separately from the side glowing green and cyan against the grey stack.
localeExclusive: true
---

## What Is Actually Being Counted When Internal Links Are Not Improving Rankings?

**Three of our pages showed 68 pages linking to them — the highest count on the domain, 3.8 times the next-highest page at 18. Grouped by anchor text, one boilerplate string accounted for 67 of those references, alongside two to four genuine editorial links per page** (crawl of all 88 English pages, August 2026).

- **The repeated anchor came from one Related Articles card in the post template**, carrying an identical string — methodology label, full title, excerpt — on every page it rendered during that window.
- **Split by target**: striking-distance-keywords had 3 editorial links, pagerank-sculpting 2, how-to-find-low-hanging-fruit-keywords 4.
- **The technical side was already clean on all four pages** — 200 status, self-referencing canonicals, no noindex, single H1, server-rendered HTML, Article and BreadcrumbList schema, present in the sitemap.
- **Nothing here is a spam question.** A Related Articles component is ordinary navigation. The issue is what the number means, not whether it is allowed.

So when internal links are not improving rankings, the first question is not "how do I fix my internal links." It is whether the number you are reading counts links or counts one link repeated. The Search Console side of that diagnosis is covered in [the pillar on reading your own Search Console data](/blog/striking-distance-keywords).

## Why It Matters That a Component Is Not an Editorial Judgement

When internal links are not improving rankings, the first suspect is usually the links themselves. It is worth suspecting the count instead. A count treats every inbound link as an independent signal, while a templated component is one editorial decision — made once, in code — that renders across a whole set of pages.

Sixty-eight hand-written links would be sixty-eight separate judgements that a page was worth pointing at. Sixty-seven identical anchors are one judgement, made once, in a layout file. Neither is a third-party vote — no internal link is — but the first is evidence of editorial relevance and the second is evidence of a template.

The advice we found on this query mostly skips to anchor-text tactics and link placement. That advice assumes the count is real.

## How Internal Links Not Improving Rankings Shows Up in Real Data

Here is what internal links not improving rankings looked like in our own numbers. Four methodology articles shipped the same day, in the same cluster, by the same author. Three landed in the Related Articles component; the fourth was squeezed out because the card renders exactly three slots.

### Link Count and Position Did Not Line Up in Either Direction

| Page | Pages linking in | Of those, editorial | Average position | Head term position |
|---|---:|---:|---:|---:|
| pagerank-sculpting | 68 | 2 | 17.5 | 19.2 |
| striking-distance-keywords | 68 | 3 | 18.1 | 20.5 |
| zero-search-volume-keywords | 4 | not broken out | 23.2 | 21.5 |
| how-to-find-low-hanging-fruit-keywords | 68 | 4 | 32.1 | 45.3 |

The tempting read is the first and last rows — seventeen times the inbound pages, nine positions worse. That is one pair out of three, and the rest of the table does not support it.

Averaged, the three heavily-linked pages sat at 22.6 and the lightly-linked page at 23.2 — a gap of about half a position, which is nothing.

Meanwhile the spread *inside* the 68-page group ran 17.5 to 32.1 — 14.6 positions at an identical link count, wider than the gap in the cherry-picked pair above. The editorial-link column runs backwards too: among the three pages we broke out by anchor type, 2 links ranked best and 4 ranked worst. A variable that produces both the best and the worst outcome at the same value is not the variable doing the work.

### What We Could Not Rule Out

Four things were held constant: publication date, cluster, author, domain. One important thing was not — the four pages target different queries with different competition, visible in the head-term column, where three pages sat between 19.2 and 21.5 while the outlier sat at 45.3. We did not measure keyword difficulty, so that column points at a hypothesis rather than establishing one — a worse head-term position could equally be relevance or intent mismatch.

Average position also aggregates a different query set for every page, so comparing 23.2 against 32.1 compares four different races rather than four runners. These are four-day averages on newly published pages over a few dozen impressions each; differences of a couple of positions are noise.

What this rules out is a strong, clean relationship between link count and position on this cluster. It does not establish that internal links are irrelevant, and we are not claiming it does.

### The Finding That Actually Stopped the Work

The ranking comparison was suggestive at best. The check that settled it needed no statistics: we scanned all 88 pages for passages already discussing a target concept but not linking to it.

For two of the three targets there were **zero** such passages. For the third there were six, of which three were genuinely on topic. There was no backlog of missing links to add — so "add more internal links" was not an available action, whatever the ranking data did or did not show.

## Common Misreadings When Internal Links Do Not Move Rankings

1. **Trusting the headline inbound count.** Most tools show a raw total by default; some desktop crawlers will segment by where a link sits on the page if you configure them, and ours will not. Either way the first number you see counts a template and an editorial mention the same. Group by anchor text before you believe it.
2. **Reading zero clicks as a quality problem.** Our audit put click-through at roughly half a percent to one percent around position 18, so the 104 impressions our best-placed page earned in four days predicts zero or one click. Observing zero says nothing about the writing.
3. **Assuming more internal links is always the next move.** On our set the count had no visible relationship to position in either direction, and there were no natural places left to add links.
4. **Fixing the three-slot defect and expecting a ranking change.** The card strands one page out of every four-article batch, which is worth fixing for coverage. The stranded page landed mid-pack — better than one linked sibling, worse than two — so a ranking gain is not the reason to fix it.

## Our Internal Link Audit at a Glance

| What we measured | Result |
|---|---|
| Page age when measured | 4 days |
| Highest inbound page count on the domain | 68 pages (three targets tied), against 18 for the next-highest |
| References from one repeated boilerplate anchor | 67 |
| Genuine editorial in-content links | 2 to 4 per page |
| Spread within the 68-page group | 17.5 to 32.1 — 14.6 positions at one link count |
| Heavily-linked group vs lightly-linked page | 22.6 average vs 23.2 — about half a position |
| Pages where a genuinely on-topic editorial link could be added | 0 for two targets, 6 (3 truly on topic) for a third |
| What we did | Stopped adding internal links to this cluster; still fixing the three-slot defect for coverage |

Source: our own crawl of 88 English pages plus Google Search Console performance data, August 2026. Your site will differ — the method is the transferable part, not the numbers.

## How to Evaluate Whether Internal Links Are Your Constraint

If internal links are not improving rankings on your site, two checks settle whether they are the constraint — run them in order, before any linking work:

1. **Split the count.** Crawl inbound links to the target and group them by anchor text and containing element. If one anchor string repeats across dozens of pages, it is one component. For us, a 68-page count left two, three and four editorial links on the three targets.
2. **Look for somewhere to put a new link.** Scan your own pages for passages already discussing the concept without linking to it. If there are none, the linking work you were planning does not exist, and no ranking analysis is needed to reach that conclusion.

Only if both checks leave you with real, unlinked opportunities is a positional comparison worth running — and if you run one, match on target-query difficulty as well as age and topic, or the comparison will not mean what you want it to mean.

Our own working hypothesis for what the real constraint is — domain authority and cluster depth — is exactly that: a hypothesis this audit did not test.

## How to Run the Two Checks Step by Step

1. **Get inbound links per target with the anchor text attached.** [Run our free internal link audit](https://gengrowth.ai/tools/internal-link-audit) — no sign-up, no Search Console, any public site; it covers up to roughly 950 pages, bounded at four minutes, and reports orphan candidates, pages with one or fewer observed inbound links, homepage click depth, and unresolved targets, with source page and anchor evidence on the relationships it observes. Two limits to know first: it produces an on-screen report rather than a CSV, so on a large site run a desktop crawler for this step; and it reads static same-origin HTML, so links injected by client-side JavaScript are invisible to it — if your internal links are client-rendered, the count is low before you start.
2. **Group the anchors yourself.** Neither our tool nor a default crawler view sorts a templated component from an editorial mention — some desktop crawlers will segment by where a link sits on the page if you configure it, ours does not. Any anchor appearing on more than a handful of pages is a component.
3. **Recount using only the unique editorial anchors** and compare that number against the headline total you started with.
4. **Search your own pages for the concept** and list every passage that discusses it without linking. That list is your actual work queue; if it is empty, you are done.
5. **Check the boring explanations before the interesting one** — status codes, canonicals, indexability, single H1, server-rendered content, schema, sitemap membership. The volatility side is covered in [our august 2026 volatility walkthrough](/blog/google-algorithm-update-august-2026), and where links genuinely do move authority is in [how internal link structure moves authority](/blog/pagerank-sculpting).

## Common Questions About Internal Links Not Improving Rankings

**Do internal links still matter for SEO?**

They matter for crawl paths and for passing context. What our data disputes is narrower: that adding more of them is the highest-value work when a page is stuck at position 30 and there is nowhere natural left to add one.

**Why does my audit tool show so many internal links?**

Because the default view counts every inbound HTML link, including the ones a template renders sitewide. Group by anchor text and the number usually collapses — ours went from a 68-page count to two, three and four editorial links.

**Are boilerplate links bad?**

No. They help crawlers reach pages and they help readers navigate, and a Related Articles card is ordinary navigation rather than anything Google's spam policies address. The mistake is counting them as independent endorsements.

**How many editorial internal links should a page have?**

We do not have a number worth publishing, and neither does anyone quoting one. Our three pages carried two, three and four — and finished 17.5, 18.1 and 32.1, in that order. The count did not predict the outcome.

**Did fewer links rank better on your site?**

No, and it would be convenient to claim otherwise. The lightly-linked page finished mid-pack, and the heavily-linked group averaged marginally ahead of it. The honest finding is no relationship, not an inverse one.

**Should I fix a recommendation component that strands pages?**

Fix it for coverage — a page with no path from anywhere is a genuine problem. Do not expect a ranking change from it.

**What if my pages get zero clicks?**

Check the position first. Below the top 15, zero clicks on a few dozen impressions is the expected outcome, not a signal about the writing.

## Related Reading

- [how internal link structure moves authority](/blog/pagerank-sculpting)
- [our bounded internal link crawl method](/blog/bounded-internal-link-crawl)
- [multiple pages ranking for the same keyword](/blog/multiple-pages-ranking-for-same-keyword)

## Take Action

Before you spend a week adding internal links, find out how many you actually have and whether there is anywhere left to put one. [Run our free internal link audit](https://gengrowth.ai/tools/internal-link-audit) — it takes any public URL with no sign-up and no Search Console connection, and returns orphans, weakly-linked pages, click depth and unresolved targets with the anchor evidence attached. Then do the sorting step it does not do for you: group those anchors, and see how much of your inbound count is one component repeating itself. We sell SEO work, so weigh a recommendation to do less of it accordingly.

## Sources

- Our own crawl of 88 English pages on gengrowth.ai — inbound page counts by target, anchor-text grouping, and the scan for unlinked on-topic passages, August 2026.
- Our own Google Search Console performance data — impressions, clicks, average positions and head-term positions for the four-article cohort over its first four days, and the click-through range around position 18 quoted above.
- [Google Search Central: In-Depth Guide to How Google Search Works](https://developers.google.com/search/docs/fundamentals/how-search-works) — background on discovery, crawling and ranking signals.
- [GenGrowth internal link audit tool](https://gengrowth.ai/tools/internal-link-audit) — the crawl scope, page and time limits, and reported fields quoted above, checked 25 August 2026.
