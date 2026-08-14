---
title: Keyword Research
description: Turn a site and a market into a keyword set you can defend, separating what was measured from what was inferred.
tagline: Find the searches worth writing for — and say where each number came from
category: seo
owner: seo
keywords: keyword research skill, seo keyword workflow, search demand analysis, keyword prioritisation, search console keywords
relatedSkills: seo-audit, content-brief
relatedPrompts: seo-keyword-clustering-prompt, search-intent-classification-prompt
status: published
publishedAt: 2026-08-14
---

## Skill file

```text
---
name: keyword-research
description: Build a keyword set for a site from measured demand and observed competitors, keeping unavailable data explicitly unavailable. Use when someone asks for keyword research, a keyword list, search volumes, or what they should target, and when a keyword tool export needs turning into a set of pages somebody can actually build.
metadata:
  owner: GenGrowth SEO Agent
  source: https://gengrowth.ai/skills/keyword-research
---

# Keyword Research

Your job is to produce a keyword set a team can act on, where every keyword
carries the reason it is on the list and every number carries its source.

## What counts as evidence

Three sources, in descending order of trust:

1. Measured — the site's own Search Console data. Queries here are proof the
   site is already visible for something.
2. Observed — what ranking pages for a query actually cover, read from live
   results.
3. Provider-supplied — volume and difficulty estimates from a keyword tool.
   These are estimates, and they are labelled as such wherever they appear.

Never present provider estimates as measured data. When a metric is not
available for a keyword, write that it is unavailable. Do not substitute zero:
zero is a measurement, and "we do not have this" is not zero.

## Procedure

1. Establish what the site is for. Read the homepage and the top pages by
   traffic. Write one sentence on what the site sells and to whom. Everything
   downstream is judged against this sentence.

2. Pull what is already measured. From Search Console, take queries with
   impressions over the last three months. These are grouped into: ranking and
   converting, ranking without clicks, and appearing but not ranking. Each
   group implies different work.

3. Read the competitive picture. For the ten queries that matter most, look at
   what currently ranks: the page type, how deep the coverage goes, and whether
   the results are dominated by sites of a different kind — marketplaces,
   forums, or major publishers. A query where every result is a marketplace is
   not a content opportunity for a software site, whatever its volume.

4. Expand deliberately. Add keywords only when they pass two tests: the site
   could publish a page that genuinely serves the searcher, and the searcher
   could plausibly become a customer. Volume alone is not a reason.

5. Assign intent to every keyword: definition, how-to, comparison, tool, or
   purchase. Intent decides page type, and page type decides whether an
   existing page can be updated or a new one is needed.

6. Order by opportunity, not by volume. Rank on: existing visibility (a page on
   result page two is closer to traffic than a page that does not exist),
   commercial proximity, and how contestable the current results look. State
   the ordering rule you used, so the order can be argued with.

## Output

A keyword table with: keyword, intent, evidence source, current position if
measured, target page, and status (new page, update existing, or watch only).
Then a short list of what you could not determine and what data would settle it.

## Refuse to

- Present an estimate as a measurement.
- Fill an unavailable metric with zero or with a guess.
- Promise a ranking, a traffic number, or a timeline.
- Recommend a keyword density or a repetition count.
- Keep a keyword on the list without a reason attached to it.
```

## What it does

Keyword research fails in two familiar ways. It produces a list nobody can act on, because every row is a keyword and a volume estimate with no indication of what to do about it. Or it produces a list nobody can trust, because measured data and vendor estimates were pasted into the same column and the difference is no longer visible.

This skill addresses both. Every keyword arrives with the reason it is on the list, the page it belongs to, and the source of any number attached to it. Where a metric was not available, the output says so rather than filling the gap — a habit that matters most when someone later builds a plan on top of the list and needs to know which numbers will hold up.

The ordering rule is stated rather than hidden. Keywords are ranked on how close the site already is to the result, not on search volume, and the skill writes down which rule it applied so the order can be argued with instead of merely accepted.

## In action

### You ask

Here is our site: example-invoicing.com. We sell invoicing software to freelance designers in the US and UK. Search Console is connected. Where should our content focus next quarter?

### The agent does

Three things stand out from the measured data, before we look at any new keywords.

Twelve queries about invoice templates already generate impressions, and four of them sit between positions 8 and 14. That is the closest available traffic — a page that is nearly ranking is a shorter path than a page that does not exist yet.

Payment-terms queries (*net 30*, *net 15 meaning*, *late payment fee freelance*) show impressions with almost no clicks. The site appears for them through a pricing page that does not answer the question. These need a definition page, not an update.

Comparison queries against named competitors show no impressions at all. Nothing on the site targets them today, and the current results are review sites rather than vendors — contestable, but slower than the first two.

I have not attached volume estimates to the second and third groups: Search Console reports impressions, not search volume, and no keyword tool is connected to this project. Ordering here is by measured proximity to ranking, which is why templates come first despite likely being the smaller market.

## How it works

### Read the site before the keywords

The agent reads the homepage and the top pages by traffic and writes one sentence on what the site sells and to whom. Every later decision is judged against that sentence, which is what stops high-volume, irrelevant keywords from entering the list.

### Take what is already measured

Search Console queries come first, grouped by whether they rank and convert, rank without clicks, or appear without ranking. Each group implies a different action, so the grouping is the first half of the recommendation.

### Read the live results

For the queries that matter most, the agent looks at what actually ranks — page type, depth, and whether the results belong to a different kind of site entirely. A query owned by marketplaces is not an opportunity for a software site, whatever a volume estimate says.

### Order by proximity, then hand off

Keywords are ranked on existing visibility, commercial proximity, and how contestable the results look, with the rule written down. The result is a table where each row names its target page and its status, which is the input a content brief needs.

## What it covers

- Search Console query analysis, grouped into ranking, appearing, and converting
- Live result reading for page type and contestability
- Intent assignment across definition, how-to, comparison, tool, and purchase
- Deliberate expansion, with a relevance and a commercial test on every addition
- Opportunity ordering with an explicitly stated rule
- Explicit unavailable-data reporting, with what would settle each gap

## When to use it

- A site has Search Console data nobody has turned into a plan
- A keyword list exists but no one can say why any given keyword is on it
- Content is being published steadily without visible search results
- Volume estimates and measured data have been mixed in the same spreadsheet
- A new market or language needs a keyword set built from scratch

## FAQ

### How is this different from the SEO Audit skill?

The audit looks at pages that exist and finds what is holding them back. Keyword research looks at demand and decides what should exist. They meet at the handoff: the audit tells you which pages are nearly ranking, and this skill decides whether those pages are worth pushing or whether the demand sits elsewhere.

### Does it need Search Console access?

It works better with it and still works without it. With Search Console, the strongest evidence is the site's own impression data. Without it, the skill falls back on live result reading and says plainly that measured visibility was unavailable — rather than substituting vendor estimates and presenting them as the site's own performance.

### Why does it refuse to fill in missing search volume?

Because a plan built on invented numbers fails silently. An estimate that turns out to be wrong is recoverable if everyone knew it was an estimate; a fabricated figure that entered a spreadsheet as fact is not. Marking a metric unavailable keeps the gap visible until real data closes it.

### Can I run this without the agent?

Yes — the file is a plain-language procedure, and the prompts linked from this page cover individual steps like clustering and intent classification. The agent handles the parts that need data access and repetition across a whole site.
