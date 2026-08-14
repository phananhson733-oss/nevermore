---
title: Search Intent Classification Prompt
description: Sort a keyword list by what the searcher wants and what page type each implies, reading intent from the results that currently rank and marking it unverified where nobody looked.
category: research
useCase: Keyword triage
outputFormat: Table
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: search intent classification prompt, keyword intent analysis, serp intent prompt, informational vs transactional keywords, keyword triage prompt, search intent taxonomy
relatedSkill: keyword-research
relatedPrompts: seo-keyword-clustering-prompt, topical-map-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are a search analyst sorting a keyword list by what the searcher wants and
what page each keyword implies.

# Scope
Read intent from evidence, not from wording. Where the operator pasted what
currently ranks, read intent from those results. Where they did not, mark the
intent unverified rather than presenting a guess as a finding. Do not invent
results, titles, domains, positions, volumes or difficulty scores.

# Inputs
What the site sells and to whom: {{site_context}}
Market and language the results were read in: {{market_and_language}}
Keywords, one per line: {{keyword_list}}
What currently ranks, for the keywords the operator looked at:
{{serp_observations}}

# What to produce
One row per keyword giving its intent, the evidence that intent rests on, the
page type it implies, and the next step. Every row must make clear whether the
intent was read from live results or from wording alone.

# Steps
1. For each keyword, check whether observations were supplied for it. Handle the
   two groups differently and never blur them.
2. For an observed keyword, count the results by what each is there to do, not
   by its format: explain a concept, walk through a procedure, compare options,
   hand over a file, or sell a product. A guide explaining a term and a guide
   walking through steps are two intents wearing the same word.
3. If one intent holds a clear majority — six or more of ten results, or the
   same share of a shorter list — that is the keyword's intent. Label the row
   observed and put the count in the basis.
4. If no intent reaches that majority, label the row split and name the two
   largest. A split is a decision, not a classification: one page cannot serve
   both, so say which slice this site can serve and state plainly that the
   other is given up.
5. For a keyword with no observations, give a provisional intent only when the
   wording carries a single reading — "how to ..." is a procedure, "... template"
   wants a file. Where the wording carries more than one reading, write uncertain
   and stop there. Either way, label the row unverified.
6. Map intent to page type: concept page, procedure, roundup naming the
   alternatives, working tool page, product page. Where the results are held by
   a kind of site this one is not — marketplaces, review sites, code hosts,
   forums — say so; the page type is still achievable, but the slot is
   contested by a different sort of page.
7. Order the rows: observed first, then split, then unverified.

# Output format
A table: Keyword | Intent | Evidence | Basis | Page type | Next step.
Evidence is exactly one of observed, split, or unverified.
Then two short lists: the split keywords with the choice each one forces, and
the unverified keywords with what to look at to settle them.
Close with one line naming the market, language and date the observations were
read in, and stating that the rows do not carry over to another market.

# Quality checks before you answer
- Every input keyword appears exactly once in the table.
- No row is labelled observed unless observations for that keyword were pasted.
- Every observed row's basis names counts that were actually supplied.
- No result, title, domain or position appears that was not in the input.
- No volume, difficulty, traffic or position figure appears anywhere.
- The same wording in two markets is kept as two rows, not merged.

# When the input is thin
If no observations were supplied at all, classify anyway, label every row
unverified, and say at the top that nothing has been checked against live
results. If the market and language are missing, say that intent for the same
words differs by market and that the reading applies only to the market the
operator had in mind. Do not close either gap with an assumption.

# Boundaries
Do not describe results you were not shown. Do not promise rankings or traffic.
Do not recommend a keyword density or a repetition count. Do not upgrade an
unverified row to observed because the classification looks obvious.
```

## Variables

### site_context
Required. What the site sells and to whom, in one sentence. This decides which slice of a split result the site can actually serve.
Example: Ridgeline, a self-hosted status page and uptime monitoring tool sold to engineering teams at companies of 50-500 people

### keyword_list
Required. One keyword per line, exactly as typed by searchers. Leave metrics out; this prompt classifies intent and does not use volume.
Example: statuspage.io alternatives / what is an slo / uptime monitoring

### market_and_language
Optional. The country and language the results were read in. Intent for identical wording differs by market, so this stops two markets being merged into one row.
Example: United States, English

### serp_observations
Optional. For each keyword you checked, a counted summary of the top results by type. A count is enough; full URLs are not needed.
Example: uptime monitoring — 7 vendor product or homepage results, 2 review-site category pages, 1 encyclopedia entry

## How to use

The observations variable carries the whole page, and counting is the work. You do not need to paste full result pages — one line per keyword in the form `keyword — N of the top ten are <type>, M are <type>` is enough. Read the results logged out and in the market you are targeting; a logged-in read from the wrong country will hand you a confident classification of results your searchers never see. Keywords you did not check are still worth including, because the output tells you which ones to check first.

The failure you will actually hit is the model quietly promoting an unverified row. The symptom is a basis cell that reads like a real observation — "results are dominated by product pages" — for a keyword you pasted nothing for. Scan the Evidence column before you read anything else, then check each observed row's basis against what you pasted. If a count appears that you did not supply, discard the row rather than the number: a model that invented one count usually invented the reasoning around it too.

When the counts disagree with your own reading, it is almost always because the model counted formats instead of intents. A long article explaining what an SLO is and a long article walking through how to set one are the same format and different intents. Re-paste that keyword's observations with the purpose named per result rather than the layout, and rerun only that keyword.

Act on the split rows first. They are where a content plan goes wrong silently: nobody notices that a page was built to serve two intents until it has been live for a quarter and serves neither.

## Example input

```text
What the site sells and to whom: Ridgeline, a self-hosted status page and uptime monitoring tool sold to engineering teams at companies of 50-500 people
Market and language: United States, English
Keywords:
self hosted status page
statuspage.io alternatives
what is an slo
uptime monitoring
free status page
status page software
how to write an incident postmortem
best uptime monitoring tools
What currently ranks (top ten, read 2026-08-12, United States, logged out):
self hosted status page — 6 roundups of open-source options, 2 GitHub repositories, 1 vendor self-hosted product page, 1 forum thread
statuspage.io alternatives — 6 roundup posts on vendor blogs, 2 review-site category pages, 2 vendor comparison landing pages
what is an slo — 4 long-form explainers on vendor blogs, 3 glossary pages, 2 vendor documentation pages, 1 video
uptime monitoring — 7 vendor product or homepage results, 2 review-site category pages, 1 encyclopedia entry
free status page — 4 vendor free-plan landing pages, 3 "best free" roundups, 2 GitHub repositories, 1 vendor pricing page
```

## Example output

| Keyword | Intent | Evidence | Basis | Page type | Next step |
| --- | --- | --- | --- | --- | --- |
| self hosted status page | Comparison | observed | 6 of 10 are roundups of open-source options; 2 repositories, 1 vendor page, 1 forum thread | Roundup naming the alternatives | Publish an honest roundup listing the open-source tools with Ridgeline among them. A product page here competes with six lists. |
| statuspage.io alternatives | Comparison | observed | 6 of 10 are roundups; the other 4 also compare (2 review-site category pages, 2 vendor comparison pages) | Alternatives page naming statuspage.io | Build it. Two slots are held by vendors, so a vendor page is not excluded here. |
| what is an slo | Definition | observed | 9 of 10 explain the concept: 4 explainers, 3 glossary pages, 2 documentation pages | Concept page, long form | Write a full explanation: the shortest ranking result is still a whole page, so a glossary entry will not match. |
| uptime monitoring | Purchase | observed | 7 of 10 are vendor product or homepage results; 2 review-site category pages, 1 encyclopedia entry | Product page | Point the existing product page here. A guide competes with seven product pages. |
| free status page | Mixed: purchase and comparison | split | No intent reaches six: 5 vendor pages (4 free-plan, 1 pricing), 3 roundups, 2 repositories | One page cannot serve both | See the decision below. |
| status page software | Uncertain | unverified | No results supplied; the wording reads both as a category to browse and a product to buy | Undecided | Read the top ten before commissioning. |
| how to write an incident postmortem | How-to | unverified | Wording carries one reading; no results supplied | Procedure with a worked example | Check whether templates hold the top slots; if so, the page needs a file, not prose. |
| best uptime monitoring tools | Comparison | unverified | "Best" means a list, but who owns the list is unknown; no results supplied | Roundup | Check whether review sites hold most slots; if so, the slot is contested. |

**Decision forced by the split result**

- `free status page` — 5 of 10 slots are vendor pages selling a free plan, 3 are roundups. Ridgeline can serve either, but not on one URL. If a free tier exists, build the free-plan page and give up the roundup. If it does not, build neither: the page would have to imply something the product does not offer.

**Unverified keywords and what would settle them**

- `status page software`, `how to write an incident postmortem`, `best uptime monitoring tools` — read the top ten in the United States, logged out, and count the results by purpose. Nothing observed above has been carried across to these.

**Market note:** all observed rows were read in the United States in English on 2026-08-12. The same words in another market or language can return a different mix; these rows do not carry over.

## Safety notes

Check the Evidence column before you trust any row. A reviewer's job here is narrow and mechanical: confirm that every row marked observed corresponds to observations you actually pasted, that every count in a basis cell matches your paste, and that no domain, title, position or volume figure appears anywhere in the output. Intent read from results is a reading of one snapshot, taken on one date, in one market, logged out — results move, and a classification from six months ago deserves a fresh look before a page is commissioned from it.

The output deliberately does not say whether the site can win any of these slots. It says what the searcher wants and which page type answers that; how contestable the result is, and whether the site has the standing to enter it, are separate questions this prompt refuses to answer from the input it is given. An observed label means the results were counted, not that the classification will hold.

## FAQ

### Do I have to paste results for every keyword?

No. Unverified rows are still useful for triage, and the output ranks them by what would settle each one. The rule is narrower than that: do not commission a page from an unverified row. Checking a keyword takes a couple of minutes; writing a definition page for a query owned by product pages costs a page and the time of whoever wrote it.

### Why does the same keyword classify differently in the UK and the US?

Because results are localised, and intent follows the results rather than the words. A query returning mostly vendor product pages in one country can return mostly roundups in another, which changes the page type you should build. That is why the prompt keeps markets as separate rows and refuses to merge them, and why the market note at the end of the output is not decoration.

### What do I do with a split result?

You choose, and you accept the loss. The prompt names the two intents and refuses to average them, because a page built to serve both usually serves neither. Pick the slice your product can genuinely serve, and if neither slice is one you can serve honestly — a free-plan page for a product with no free plan — the correct answer is to leave the keyword alone rather than build the page anyway.

### When does this not work?

Three cases. Queries with thin or unstable results, where ten results do not represent a settled intent and next month's reading will differ. Queries with strong local intent, where results vary by city and a single national read is misleading. And ambiguous brand or acronym queries, where the results reflect a meaning you did not intend. It also cannot tell you when the results last changed, so an old observation looks exactly like a fresh one unless you record the date.
