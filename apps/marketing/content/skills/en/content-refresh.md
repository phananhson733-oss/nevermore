---
title: Content Refresh
description: Run a recurring loop over pages that already exist, separating decay from intent mismatch from a query that moved, because each one needs a different fix.
tagline: Fix the pages that actually declined, and leave the rest alone
category: content
owner: seo
fileName: content-refresh.md
keywords: content refresh skill, content decay analysis, refresh old blog posts, content audit workflow, search intent mismatch, content pruning, page update prioritisation
relatedSkills: content-brief, seo-audit
relatedPrompts: content-refresh-rewrite-prompt, seo-content-audit-prompt
status: published
publishedAt: 2026-08-14
---

## Skill file

```text
---
name: content-refresh
description: Decide which existing pages to update, rewrite, retarget, or leave alone, by naming the cause of each decline before naming the fix.
owner: GenGrowth SEO Agent
---

# Content Refresh

Your job is to look at pages that already exist and decide, page by page,
whether anything should be done to them. Name the cause of the decline before
you name the fix. A refresh queue with no cause attached is a rewrite roster,
and rewriting is the most expensive way to find out a page was fine.

## What counts as evidence

Four sources, in descending order of trust:

1. Measured — the site's own Search Console history for the page and for its
   queries, compared across equal-length windows and against the same window a
   year earlier. Seasonality is the most common reason a page looks broken.
2. Observed — the live results for the page's main queries today, and the page
   as it currently renders, including content that only appears after load.
3. Recorded — the site's own change history: publish and edit dates, template
   changes, URL moves, redirects, migrations, and index status. A drop that
   lines up with a migration date is a migration, not decay.
4. Estimated — third-party traffic or difficulty figures. Usable as context,
   labelled as estimates, and never entered in the same column as measured data.

When a number is not available for a page, write that it is unavailable and
what would make it available. Do not substitute zero. Zero clicks is a
measurement; "the history does not join across the URL change" is not zero.

## The three causes

Every declining page belongs to one of these, and they take different work:

- Decay. The page still answers the query, but its substance aged out:
  superseded facts, old pricing, discontinued features, screenshots of an
  interface that no longer exists. Position slides gradually while the page
  keeps appearing for the same queries. The fix is substance, not structure.
- Intent mismatch. The page never matched what searchers wanted. It collects
  impressions but has never held a competitive position, and the pages that do
  rank are a different type entirely — a calculator where you published an
  essay, a comparison where you published a definition. The fix is a different
  page, or moving the query to a page that already suits it.
- Displacement. The query moved out from under the page. Demand shifted to
  another phrasing, the result surface changed, or the search stopped
  happening. Editing does not reach this. The fix is to retarget the page at a
  query that still exists, consolidate it, or retire it deliberately.

## Procedure

1. Set the window. Choose a comparison period long enough to survive weekly
   noise, and pull the same window one year earlier. State both in the output.

2. List pages that lost measured visibility — not pages that are old. Age is a
   reason to look, never evidence. A page from 2019 holding its position needs
   nothing.

3. For each declining page, read the recorded history first. Rule out
   migrations, redirects, template changes, canonical changes, and deindexing
   before you diagnose the writing.

4. Classify the cause using the three definitions above and cite the specific
   evidence that put the page in that class. If the evidence supports two
   classes, say so, and say which check would separate them.

5. Read the live results for the page's main query. Note which page types rank
   now and whether the result surface changed since the page was written.

6. Assign exactly one action per page: update, rewrite, retarget, consolidate,
   retire, or leave alone. Leave alone is a real outcome and must be used.

7. Order the queue by how close each page already is to its former position,
   and state the ordering rule so it can be argued with.

## Output

A table with: page, main query, cause class, the evidence cited, the proposed
action, and what specifically changes on the page. Then a second list of pages
examined and deliberately left alone, each with its reason. Then the gaps: what
could not be determined and what data would settle it.

## Refuse to

- Queue a page for work because of its age, with no measured decline.
- Present an estimate as a measurement, or fill an unavailable number with zero.
- Assign a cause the cited evidence does not support.
- Promise a recovery, a ranking, a traffic number, or a timeline.
- Recommend a keyword density or a repetition count.
- Change a publish date to signal freshness without changing the content.
- Send a page to rewrite without naming what is specifically wrong with it.
```

## What it does

Most refresh programmes run on a calendar. Someone sorts the library by publish date, takes the oldest forty posts, and works through them. The predictable result is that effort lands on pages that were healthy, the pages that genuinely lost visibility stay in the queue behind them, and the pages that never worked in the first place get rewritten in better prose against the same mismatch. Nobody can tell afterwards which edits mattered, because no page ever had a stated reason for being touched.

This skill inverts the order. It starts from measured decline, not from age, and it refuses to propose a fix until it has named a cause. Three causes are treated as genuinely different problems: content that aged out while still serving the query, a page that never matched the intent behind the query, and a query that moved or stopped being searched. Only the first is repaired by editing. The second needs a different page type or a different home for the query. The third often needs the page retargeted, consolidated, or retired, and saying so early saves the two rewrites that would otherwise happen first.

Site-level explanations are ruled out before content-level ones. A drop that coincides with a URL migration, a template change, or a canonical change is not decay, and diagnosing it as decay produces months of pointless editing.

Every page comes back with the evidence that classified it, and pages the loop deliberately left alone are listed with their reasons — so the next run does not re-examine them from scratch, and so a decision to leave something alone can be challenged rather than silently repeated.

## In action

### You ask

We refresh content every quarter on atlas-fieldwork.com — field service scheduling software, about 240 published articles. We work through the oldest posts first and traffic keeps sliding anyway. What should we actually be refreshing?

### The agent does

Oldest-first is part of the problem: of the 30 oldest posts, 19 held their position year over year and needed nothing.

Sorting by measured decline instead gives three groups. Ordering below is by how close each page already sits to its former position, which is why decay leads — those pages still rank.

Eleven pages lost position gradually while still appearing for the same queries. The scheduling-compliance posts cite 2023 state overtime thresholds; the pages ranking above them cite current ones. That is decay, and it is the narrowest work: replace the facts, keep the structure.

Six pages draw impressions but have never held a position above the low twenties. For *field service dispatch software* the results are comparison pages and product pages; you published an 1,800-word explainer. That is intent mismatch, and editing the explainer repeats it. Those queries want a comparison page or belong on the product pages.

Four pages lost the query itself. *Best route planner app 2024* shows almost no impressions in any window this year — the year-stamped phrasing stopped being searched, rather than losing to a competitor.

One figure is unavailable: I cannot give before-and-after clicks for anything published before March. The /blog/ to /resources/ move split the history across two URL sets and Search Console reports them separately, so any joined number would be constructed. What exists is impressions on the current URLs from April onward.

## How it works

### Compare like windows, not calendar age

The agent fixes a comparison window long enough to survive weekly noise and pulls the same window a year earlier before reading anything as a decline. Both windows are stated in the output, because a seasonal business and a decaying page look identical over a single quarter.

### Rule out the site before blaming the content

Recorded history comes next: publish and edit dates, URL moves, redirects, canonical and template changes, index status. If a drop lines up with a migration date, the finding is a migration and the page goes to the technical queue, not the writing queue.

### Separate decay from mismatch from displacement

Each declining page is classified against the three definitions, with the specific evidence cited. Gradual slide while still appearing for the same query reads as decay; impressions without a competitive position against a different ranking page type reads as mismatch; the query thinning out across every window reads as displacement.

### Assign one action per page, including leave alone

Every page leaves with exactly one action — update, rewrite, retarget, consolidate, retire, or leave alone — and a note on what specifically changes. The leave-alone list is published alongside the queue, so healthy pages are visibly decided rather than quietly skipped.

## What it covers

- Equal-window and year-over-year Search Console comparison at page and query level
- Change-history reconciliation against migrations, redirects, canonicals, and template changes
- Three-way cause classification, with the evidence cited for every page
- Live result reading for page types and result-surface changes since publication
- One action per page: update, rewrite, retarget, consolidate, retire, or leave alone
- An explicit leave-alone list and an explicit unavailable-data list with what would close each gap

## When to use it

- A refresh programme runs on a calendar and nobody has checked whether the pages it touches were declining
- A library has hundreds of pages and no one can say which lost visibility this year
- Site-wide traffic is falling but no individual page looks obviously broken
- A migration happened and page-level history no longer joins across the URL change
- Pages have been rewritten more than once without changing anything, and the cause was never diagnosed

## FAQ

### How is this different from the Content Brief skill?

A brief specifies a page that should exist and does not yet. This skill makes decisions about pages that already do. They connect at the handoff: when the classification lands on rewrite or retarget, the page, its evidence, and the mismatch it needs to resolve become the input to a brief. Update-class pages usually skip the brief entirely, because their structure is not the problem.

### Does the age of a page matter at all?

Only as a reason to look. Age tells you a page has had time to go stale; it does not tell you it has. Plenty of older pages hold position for years because nothing better was published against the query, and touching them spends effort with no evidence behind it. The queue is built from measured decline, and publish date is metadata on the row rather than a sort key.

### What if clicks dropped but nothing on the page or in the results changed?

Then the honest output says the cause is undetermined and names the checks that would separate the remaining possibilities — a query-level split to see whether one term carried the loss, a device or country split, and a comparison against the same window a year earlier for seasonality. An undetermined page stays out of the rewrite queue. Guessing a cause here is how sites end up editing pages that were fine.

### Can it tell me whether AI answer surfaces took the clicks?

It can tell you that impressions held while clicks fell, and it can note that the result surface for a query now shows a generated answer where it previously did not. It will not convert that into an attributed number, because no available data joins a specific lost click to a specific surface. The distinction matters: the observation is real and worth acting on, and a percentage attached to it would be invented.
