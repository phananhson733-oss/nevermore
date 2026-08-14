---
title: SEO Keyword Clustering Prompt
description: Group a raw keyword list into topic clusters you can actually build pages around, with one page intent per cluster.
category: research
useCase: Content planning
outputFormat: Table
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: keyword clustering prompt, seo keyword grouping, topic cluster prompt, keyword map, search intent grouping
relatedSkill: keyword-research
relatedPrompts: search-intent-classification-prompt, topical-map-prompt, seo-content-brief-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are a search strategist grouping keywords into publishable topic clusters.

# Scope
Cluster the keywords given below. Do not invent keywords, search volumes, or
difficulty scores. If a number was not provided to you, leave it out rather
than estimating it.

# Inputs
Site or product: {{site_topic}}
Who the site sells to: {{target_user}}
Keyword list (one per line, optionally with metrics): {{keyword_list}}
Pages that already exist, if any: {{existing_pages}}

# What to produce
Group the keywords so that every cluster maps to exactly one page a writer
could sit down and write. Two keywords belong together only when a single page
would satisfy both searchers. When two keywords look similar but imply
different page types — a definition versus a comparison, a how-to versus a
product page — split them.

# Steps
1. Discard keywords that are irrelevant to the site or product, and say why in
   one line each.
2. Read each remaining keyword for what the searcher wants: a definition, a
   how-to, a comparison, a tool, or a purchase.
3. Group by that intent first, by topic second. Intent is the stronger signal;
   two keywords about the same subject with different intents are two pages.
4. Name each cluster after the page it implies, not after its biggest keyword.
5. Pick one primary keyword per cluster — the one that best describes the whole
   page — and list the rest as secondary.
6. Check each cluster against the existing pages. Mark it as new, or as a
   candidate to fold into a page that already covers the same intent.

# Output format
A table with these columns: Cluster name | Page intent | Primary keyword |
Secondary keywords | New page or existing page | Note.
Then a short list of any keywords you dropped and why.

# Quality checks before you answer
- Every input keyword appears exactly once: in a cluster or in the dropped list.
- No cluster mixes two page intents.
- No cluster would need two separate pages to satisfy it.
- Cluster names read like page titles, not like keyword strings.
- You have added no metric that was not in the input.

# When the input is thin
If the keyword list is under 20 keywords, say so and cluster anyway. If the
list has no metrics, cluster on intent alone and say that ordering by
opportunity is not possible from this input. Do not fill the gap with
estimates.

# Boundaries
Do not promise rankings or traffic. Do not recommend repeating a keyword a
fixed number of times. Do not merge clusters just to reach a round number.
```

## Variables

### site_topic
Required. What the site sells or writes about, in one sentence. The more specific this is, the better the model can drop irrelevant keywords.
Example: Invoicing software for freelance designers in the US and UK

### target_user
Required. Who the pages are for. This decides intent when a keyword could be read two ways.
Example: Solo designers who bill hourly and currently invoice with spreadsheets

### keyword_list
Required. One keyword per line. Include volume or difficulty if you have them; leave them out if you do not.
Example: freelance invoice template / how to invoice as a designer / best invoicing software for freelancers

### existing_pages
Optional. URLs and titles of pages already published, so the model can tell a new page from an update.
Example: /templates/invoice — "Free freelance invoice template"

## How to use

Paste the prompt, replace the four placeholders, and run it. The list can be pasted straight from a Search Console export or a keyword tool — the prompt does not require a particular column layout, and it will ignore metrics it was not given.

Read the output against the quality checks that ship inside the prompt. The two that catch the most problems are "every input keyword appears exactly once" and "no cluster mixes two page intents" — a cluster holding both *what is X* and *X vs Y* will produce a page that ranks for neither.

If a cluster looks too large to write as one page, ask for that cluster to be split by intent and rerun only that part. Rerunning the whole list tends to reshuffle groups you were happy with.

## Example input

```text
Site or product: Invoicing software for freelance designers in the US and UK
Who the site sells to: Solo designers who bill hourly and currently invoice with spreadsheets
Keyword list:
freelance invoice template
how to invoice as a freelance designer
invoice template google docs
best invoicing software for freelancers
freshbooks vs wave
what is net 30
net 30 payment terms
how to charge late fees freelance
Pages that already exist: /templates/invoice — "Free freelance invoice template"
```

## Example output

**Clusters**

| Cluster name | Page intent | Primary keyword | Secondary keywords | New or existing | Note |
| --- | --- | --- | --- | --- | --- |
| Free invoice templates for freelancers | Download a template | freelance invoice template | invoice template google docs | Existing — /templates/invoice | Add a Google Docs variant to the existing page rather than building a second one |
| How to invoice as a freelance designer | Step-by-step how-to | how to invoice as a freelance designer | — | New page | Sits above the template page and links down to it |
| Payment terms explained | Definition | what is net 30 | net 30 payment terms | New page | Both keywords are the same question asked two ways; one definition page answers both |
| Charging late fees | How-to with a policy angle | how to charge late fees freelance | — | New page | Different intent from payment terms: the searcher already knows the terms and wants to enforce them |
| Invoicing software comparison | Comparison | best invoicing software for freelancers | freshbooks vs wave | New page | Keep the head-to-head comparison inside this page; a separate freshbooks-vs-wave page would compete with it |

**Dropped:** none — every keyword mapped to a page this site could publish.

**Note on ordering:** no volume or difficulty figures were supplied, so these clusters are grouped by intent only and are not ranked by opportunity.

## Safety notes

The prompt is written to refuse invented metrics, but the refusal is only as good as your review — check that no volume or difficulty number appears in the output unless you supplied it. A model asked to "prioritise" a list it has no data for will happily produce plausible-looking numbers.

Clustering is a planning step, not a ranking prediction. Nothing in the output says a page will rank; it says which pages are worth writing and which searchers each one serves.

## FAQ

### How many keywords can I paste at once?

A few hundred works in one pass. Past that, the model starts dropping keywords silently rather than clustering them, and the "every keyword appears exactly once" check becomes the only way you would notice. Split large lists by topic and run them separately.

### Why does it split keywords that look identical?

Because search intent, not wording, decides what a page has to contain. *What is net 30* and *how to charge late fees* are both about payment terms, but one wants a definition and the other wants a policy to copy. A single page trying to do both usually satisfies neither searcher.

### Can I use the clusters as page titles directly?

The cluster names are written to read like page titles, so they are a reasonable starting point — but they are internal labels, not headline copy. Rewrite them for the reader before publishing.

### What if a cluster overlaps a page I already have?

The output marks it as an existing page, which means the recommendation is to update rather than publish. Publishing a second page for an intent you already cover splits your own internal links between two URLs.
