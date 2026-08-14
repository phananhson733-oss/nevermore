---
title: Internal Linking
description: Audit and rebuild a site's internal link graph — orphaned pages, misleading anchors, and pages competing for one intent — including when the answer is to merge rather than link.
tagline: Route readers and authority to the pages that earn them
category: technical
owner: tech
fileName: internal-linking.md
keywords: internal linking skill, internal link audit, orphan pages, anchor text audit, site architecture seo, keyword cannibalisation, link graph analysis
relatedSkills: technical-seo-checklist, on-page-seo
relatedPrompts: internal-linking-suggestions-prompt, topical-map-prompt
status: published
publishedAt: 2026-08-14
---

## Skill file

```text
---
name: internal-linking
description: Audit a site's internal link graph and decide, per page, whether to link, merge, retire, or leave it alone — with the evidence for each verdict attached.
owner: GenGrowth Tech Agent
---

# Internal Linking

Your job is to change the link graph, not to add links. Adding a link is one of
four possible verdicts, and often the wrong one. Every change you propose
carries the reader-facing reason it exists and the evidence behind it.

## What counts as evidence

Four sources, in descending order of trust:

1. Crawled — the link graph as a crawler sees it after rendering. An edge only
   counts if the source page returns 2xx, is indexable, and the link is in body
   content. This is the only source that proves a link exists.
2. Measured — Search Console. Which queries each URL actually appears for, and
   with what impressions. This is how you tell which of two overlapping pages
   search engines have already chosen.
3. Declared — sitemaps, navigation config, CMS taxonomy. Proves intent, not
   reachability. A page in the sitemap with no body link pointing at it is an
   orphan regardless of what the CMS thinks.
4. Inferred — topical similarity read from page content. Use it to propose
   candidate links. Never use it alone to assert that two pages duplicate each
   other; that claim needs measured query overlap.

Templated links — global navigation, footers, sidebars, related-post widgets —
are counted separately from contextual body links, and never reported as the
same number. A page linked from every footer on the site is not linked to; it
is boilerplate.

When the crawl could not reach a page, its inbound count is unavailable. Do not
report it as zero. Zero inbound links is a finding; a failed request is not.

## Procedure

1. Crawl and build the graph. For each URL record: status code, indexability,
   canonical target, click depth from the homepage, contextual inbound links,
   templated inbound links, and outbound contextual links.

2. Split boilerplate from context. Compute inbound counts twice, with and
   without templated edges. The contextual count is the one that describes
   whether anyone chose to link to the page.

3. Find orphans and near-orphans. List pages with zero contextual inbound
   links, then pages reachable only through deep pagination. Group them by
   topic — orphans usually arrive in clusters, and the cluster tells you which
   hub page failed to link out.

4. Find intent collisions. For each pair of pages with substantially
   overlapping Search Console query sets and the same page type, name the
   incumbent: the URL that already receives the impressions. Two pages
   splitting one intent do not need links between them.

5. Audit anchors. Read the anchor and the sentence containing it. Flag anchors
   that promise something the destination does not cover, bare URLs, "read
   more" and "click here", and any link whose destination is noindex,
   redirecting, or returning an error.

6. Assign one verdict per page: promote (add contextual inbound links from
   pages that genuinely reference it), consolidate (merge into the incumbent
   and redirect), retire (remove and redirect, with no replacement), or leave.
   State the verdict before proposing any edge.

7. Write the edges last, and only for pages with a promote verdict. Each
   proposed link names the source URL, the destination, the anchor, and the
   sentence it sits in. If you cannot write the sentence, the link does not
   belong there.

## Output

An edge-change list: source, destination, anchor, surrounding sentence, reason.
A consolidation table: page, verdict, incumbent URL, redirect target, evidence.
An orphan list grouped by topic, with the hub that should have linked out.
An anchor-repair list. Finally, what you could not determine and what data
would settle it.

## Refuse to

- Propose a link because a phrase matched a page title, with no reader-facing
  reason for the link.
- Count navigation, footer, or widget links as evidence a page is linked.
- Recommend a number of links per page, an anchor repetition count, or a
  keyword density.
- Report an inbound count of zero when the crawl failed to reach the page.
- Recommend a merge without naming the incumbent and the measured evidence for
  it.
- Add a reciprocal link between two pages that compete for the same intent.
- Link to a URL that is noindex, redirecting, or returning an error.
- Promise a ranking movement, a traffic figure, or a timeline.
```

## What it does

The usual failure looks productive. Somebody runs a plugin or a prompt that matches phrases in body copy against page titles and inserts a link wherever they collide. A week later the site has two hundred new internal links, a dozen reciprocal loops where two posts point at each other because they share a word, links from a paragraph about filing deadlines to the pricing page, and not one of the orphaned pages has been fixed. Worse, the two pages that were quietly splitting the same intent are now linked to each other, which makes the split look deliberate to anyone reviewing it.

This skill treats the link graph as something to be decided, not decorated. Every page gets one of four verdicts — promote, consolidate, retire, or leave — and the verdict is assigned before any anchor text is written. Pages that should not exist do not get links; they get merged into whichever page search engines have already chosen, and that choice is read from measured query data rather than argued from opinion.

The distinction that does most of the work is between contextual links and boilerplate. A page reachable from the global footer is not internally linked in any useful sense, and counting those edges is how sites convince themselves they have no orphan problem. The skill counts inbound links twice and reports both numbers, so the gap between them is visible.

## In action

### You ask

We run cadence-payroll.com, payroll software for UK small businesses. About sixty blog posts and eight product pages, built up over three years by different writers. Search Console is connected. Our internal linking has never been audited — where do we start?

### The agent does

Three findings, ordered by how much work each one removes rather than adds. Merges change the graph most, and it is wasteful to add links to pages that may not survive the merge.

Two pages compete for one intent. `/blog/statutory-sick-pay-explained` and `/guides/ssp-calculator-walkthrough` appear for the same fourteen queries in Search Console, and the guide has never outranked the post on any of them. The post is the incumbent. The recommendation is a merge — fold the calculator steps into the post and redirect the guide — not more links between them. They already link to each other, which is the loop that made this look like a connected cluster rather than a split one.

Nine posts have zero contextual inbound links. They sit in the sitemap and are reachable from `/blog` at page four and deeper. Seven are about auto-enrolment, and your auto-enrolment pillar page links out to none of them. That is one hub failing, not nine unrelated problems.

Twenty-three links use "read more" or a bare URL as the anchor. Six of those point to `/pricing` from sentences about compliance deadlines; the pricing page does not mention deadlines.

I could not report inbound counts for `/guides/2024-rates` and four sibling pages. The crawl received 403 responses for that directory, so those counts are unavailable, not zero. Allowing the crawler user agent through and re-running would settle it.

## How it works

### Build the graph from a crawl, not from the CMS

The agent crawls the site and records what a crawler can actually see: status codes, indexability, canonical targets, click depth, and every body link. A CMS export tells you what the site intends to link; only a crawl tells you what it does, after templates, rendering, and years of edits.

### Separate boilerplate from contextual links

Inbound links are counted twice, once including navigation, footers, and related-post widgets and once excluding them. The contextual number is the one that means something, because it reflects a decision somebody made in a sentence rather than a template that fires on every page.

### Test overlapping pages against measured queries

Where two pages look like they cover the same ground, the agent compares the query sets each one actually appears for in Search Console and names the incumbent — the URL already receiving impressions. Topical similarity alone proposes the question; measured overlap answers it.

### Assign a verdict, then write the edges

Each page receives one verdict: promote, consolidate, retire, or leave. Only promoted pages get proposed links, and each proposed link comes with the sentence it belongs in. If the sentence cannot be written naturally, the link is dropped rather than forced.

## What it covers

- Full contextual link graph construction from a crawl, with boilerplate edges counted separately
- Orphan and near-orphan detection, grouped by topic and traced back to the hub that should have linked out
- Intent collision detection using measured Search Console query overlap, with the incumbent page named
- Anchor text audit covering misleading anchors, bare URLs, and generic phrases
- Broken destination detection: links pointing at noindex, redirecting, or erroring URLs
- Consolidation and retirement recommendations with redirect targets, not just link additions

## When to use it

- A site has published for years under several writers and nobody has ever mapped what links to what
- Two pages keep swapping positions for the same queries and no one has decided which should win
- Pages exist in the sitemap and get no impressions, and it is unclear whether that is a demand problem or a reachability problem
- An automated linking plugin has been running and the link count has grown without anything else changing
- A section is about to be migrated or restructured and the inbound links to it need to be known before URLs move

## FAQ

### How is this different from the Technical SEO Checklist skill?

The checklist asks whether an individual page can be crawled, rendered, and indexed — mostly binary questions with per-page answers. This skill assumes the pages are reachable and asks how attention moves between them. They meet at the handoff: the checklist finds that a page is set to noindex, and this skill is what notices twelve other pages are still linking to it.

### When does it recommend merging instead of adding a link?

When two pages overlap substantially in the queries they actually appear for, share a page type, and one of them has never outranked the other. At that point linking them together entrenches the split rather than resolving it. The skill names the incumbent from measured impressions and proposes folding the weaker page into it with a redirect, because the alternative is maintaining two half-answers indefinitely.

### Does it need Search Console access?

It runs without it and is materially weaker. The crawl alone finds orphans, broken destinations, and misleading anchors. Naming an incumbent between two competing pages needs measured query data; without it the skill reports that two pages look like they overlap and states plainly that it could not determine which one search engines currently prefer, rather than guessing from word counts or publish dates.

### What about very large sites where a per-page verdict is impossible?

It works at template and section level. The agent samples within each template, reports which conclusions came from a sample rather than a full crawl, and states the sample size. A finding like "product pages in this category link out to no supporting content" is a template decision and can be acted on once; it does not need every URL enumerated first.
