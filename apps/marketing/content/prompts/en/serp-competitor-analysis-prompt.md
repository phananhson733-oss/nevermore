---
title: SERP Competitor Analysis Prompt
description: Read the pages actually ranking for a query, get the requirements a page must meet to belong there, and a straight verdict on whether your site should target it at all.
category: research
useCase: Competitive review
outputFormat: Analysis
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: serp analysis prompt, serp competitor analysis, competitor analysis prompt seo, analyze search results prompt, serp intent analysis, search results competitor research
relatedSkill: seo-audit
relatedPrompts: search-intent-classification-prompt, seo-content-brief-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are a search analyst reading one result page to decide what a page must
contain to belong on it, and whether the query is worth contesting at all.

# Scope
Analyse only the results pasted below. You have not browsed the web. Do not add
results you were not shown, do not describe content you were not given, and do
not invent domain ratings, backlink counts, traffic figures, word counts, or
publication dates. If a result was supplied as a title and URL only, say what
can be read from a title and stop there.

# Inputs
Query, market and device: {{target_query}}
Our site and what it can credibly publish: {{our_site}}
The ranking results, pasted: {{ranking_pages}}
Other elements on the result page: {{serp_features}}
Our page for this query, if we have one: {{our_page}}

# What to produce
Two things. The shared requirements a page needs to belong on this result page,
and a direct verdict on whether our site should target the query.

# Steps
1. Classify every result by publisher type — marketplace, retailer, forum or
   other user-generated content, news, data publisher, vendor or brand,
   independent publisher, training provider, government or standards body — and
   by page type, meaning what kind of page it actually is.
2. For each result, name the one asset the page could not have been written
   without: a proprietary dataset, live inventory, first-hand accounts, an
   institutional mandate, or nothing beyond ordinary research.
3. List the elements that recur across the results, each with a count out of the
   number of results you were shown. Write "5 of 8", never "most pages". An
   element on one or two pages is a variation, and label it as one.
4. Decide who the searcher is, and name the pasted result that is the clearest
   evidence for that reading.
5. Judge contestability. Can a page of our type carry the asset the leading
   results carry? If the top results hold data, inventory, or user testimony we
   cannot obtain, say so plainly and recommend against the query. "Do not target
   this" is a valid answer and often the correct one.
6. Separately from difficulty, check audience. State whether the person this
   result page serves is the person our site sells to. A contestable query
   aimed at the wrong reader is still the wrong query.
7. Give the verdict in one of three forms — target it, target a different query
   in this area, or do not target it — with the reason in one sentence.

# Output format
The verdict line first. Then a table: Position | Publisher type | Page type |
Asset we would have to match. Then the requirements list with counts. Then the
intent read. Then the recommendation, including what our page would have to
carry if the verdict is to target it. Close with a short list of what this
analysis cannot tell you from the input you were given.

# Quality checks before you answer
- Every claim about a page traces to text that was pasted to you.
- Every requirement carries a count out of the results shown.
- No authority, traffic, or page-age figure appears that was not supplied.
- The verdict is one sentence and picks one option rather than hedging across
  all three.
- Where the results are dominated by page types our site cannot publish, the
  verdict says do not target instead of proposing a way to compete.

# When the input is thin
Fewer than five results, or results given as titles alone, still get an
analysis, but open by saying the sample is too small or too shallow to
establish a requirement and mark every requirement as provisional. Never fill a
missing result in from memory of what usually ranks for queries like this one.

# Boundaries
Do not predict positions, traffic, or timelines. Do not recommend a keyword
density or a number of repetitions. Do not describe any page you were not
shown, including our own page when its content was not pasted.
```

## Variables

### target_query
Required. The exact query, plus the market, language, and device the sample was taken on. Add the sampling date so the analysis is dated.
Example: hvac technician salary — United States, English, desktop, sampled 2026-08-12 in a logged-out session

### our_site
Required. What the site sells, who to, and what kind of page it could credibly publish. State what you do not have, such as a dataset or user reviews, because that is what decides contestability.
Example: Fernpost — scheduling software for HVAC contractors running 5 to 50 technicians; no compensation dataset, no job listings

### ranking_pages
Required. The results as they appear, one per line: position, URL, title, and what is actually on the page. The more you record about page structure and stated data sources, the less the model has to guess.
Example: 3. ziprecruiter.com/Salaries/HVAC-Technician-Salary — "HVAC Technician Salary" — percentile bands, city comparison table, count of open postings

### serp_features
Optional. Everything on the result page that is not a blue link: AI Overview and what it cites, People Also Ask, ads, local pack, shopping carousel, video block.
Example: AI Overview citing bls.gov, indeed.com and ziprecruiter.com; People Also Ask with four questions; no ads

### our_page
Optional. The URL and title of the page you already have for this query, and where it sits, if anywhere, in the sample.
Example: /learn/hvac-technician-pay-guide — "What HVAC Technicians Earn" — not in the top ten sampled

## How to use

Sample the SERP yourself before you fill anything in. Take it logged out, with the market set explicitly, and record the date in `target_query` — a result page read in a personalised session is a different result page, and the analysis inherits whatever you sampled. Then fill `ranking_pages` by opening each result and writing down what is on it: the data it shows, whether it names a source, whether it carries a date. Titles alone are not enough input for a requirement.

The failure you will hit is a model that quietly describes pages from memory. Paste eight titles with no page detail and you will get a confident list of what those pages contain, because the model has seen thousands of pages like them. The prompt tells it to stop at what a title can support, but check the output against your paste line by line. Anything in the analysis that is not in your input is invented, and the sample size or update date is usually where it starts.

The second failure is hedging. Ask a model whether a query is contestable and the default answer is that it is competitive but achievable with strong content. That is not an answer. If you get it, reply with two questions: which of the pasted results would our page displace, and what asset would it carry that the result does not have. If neither has an answer, the honest verdict is do not target, and the prompt is written to reach it directly.

When the verdict is do not target, do not rerun the prompt with a softer framing. Rerun it on the adjacent query the recommendation names — usually the same subject asked by the person who actually buys from you — and treat the original query as closed.

## Example input

```text
Query, market and device: hvac technician salary — United States, English, desktop, sampled 2026-08-12 in a logged-out session
Our site and what it can credibly publish: Fernpost — scheduling and dispatch software for HVAC contracting businesses running 5 to 50 technicians. We publish operations guides for owners on /learn. We have no compensation dataset and no job listings.
The ranking results, pasted:
1. indeed.com/career/hvac-technician/salaries — "HVAC Technician salary in United States" — salary profile; average hourly rate "based on 24,318 salaries reported"; top-paying cities table; links to open jobs; updated 4 August 2026
2. bls.gov/ooh/installation-maintenance-and-repair/heating-air-conditioning-and-refrigeration-mechanics-and-installers.htm — "Heating, Air Conditioning, and Refrigeration Mechanics and Installers" — Occupational Outlook Handbook entry; median annual wage, wage percentiles, state employment and wage data, employment projections; updated April 2026
3. ziprecruiter.com/Salaries/HVAC-Technician-Salary — "HVAC Technician Salary" — percentile bands at the 25th, 50th, 75th and 90th, city comparison table, count of open postings
4. glassdoor.com/Salaries/hvac-technician-salary-SRCH_KO0,15.htm — "HVAC Technician Salary" — total pay estimate split into base pay and additional pay, confidence range, employee-submitted figures
5. salary.com/research/salary/benchmark/hvac-technician-salary — "HVAC Technician Salary" — benchmark percentile chart, pay by years of experience, related job titles; updated July 2026
6. reddit.com/r/HVAC/comments/1k2p8xq — "What are you guys actually making?" — discussion thread, 340 comments, technicians posting regional pay, union and non-union, overtime detail
7. servicetitan.com/blog/hvac-technician-salary — "HVAC Technician Salary Guide" — vendor blog post; national average, pay by experience level and certification, state table attributed to BLS; updated June 2026
8. rsi.edu/blog/hvac-tech-salary-guide — "How Much Do HVAC Techs Make?" — training provider blog; salary range, apprentice to journeyman progression, certification and licensing requirements
Other elements on the result page: AI Overview at the top citing bls.gov, indeed.com and ziprecruiter.com; People Also Ask with four questions; no ads, no local pack, no shopping carousel
Our page for this query, if we have one: /learn/hvac-technician-pay-guide — "What HVAC Technicians Earn" — published March 2026; not present in the top ten sampled above
```

## Example output

**Verdict: do not target this query with a Fernpost page.** Six of the eight results are built on compensation data Fernpost does not hold, and the reader this page serves is a technician checking their own pay, not the contractor who buys scheduling software.

| Position | Publisher type | Page type | Asset we would have to match |
| --- | --- | --- | --- |
| 1 | Job board and data publisher | Salary profile | 24,318 self-reported salaries |
| 2 | Government body | Occupational handbook entry | A federal wage survey and the mandate to run it |
| 3 | Job board | Percentile salary page | Live posting volume, continuously refreshed |
| 4 | Job board | Total-pay estimate | Employee-submitted base and additional pay |
| 5 | Data publisher | Benchmark report | Licensed compensation benchmark data |
| 6 | Forum, user-generated | Discussion thread | 340 first-hand pay reports, union and non-union |
| 7 | Software vendor | Blog guide | Nothing we could not obtain; ordinary research over BLS figures |
| 8 | Training provider | Blog guide | Licensing and apprenticeship detail from running the school |

**Requirements, counted out of the 8 results shown**

- A stated wage figure, as an average, a range, or percentiles: 7 of 8 — every result except the Reddit thread
- Where the numbers came from, named on the page: 5 of 8 — results 1, 2, 4, 5, 7
- A breakdown by state or city: 4 of 8 — results 1, 2, 3, 7
- A visible last-updated date: 4 of 8 — results 1, 2, 5, 7
- A route to open job listings: 3 of 8 — results 1, 3, 4
- Pay by experience level or certification: 3 of 8 — results 5, 7, 8. A variation, not a requirement.

**Intent:** job seekers and working technicians checking their own pay. The clearest evidence is result 6, a 340-comment thread of technicians comparing paychecks, supported by the AI Overview citing BLS, Indeed and ZipRecruiter — three wage-data holders and no vendor.

**Recommendation:** result 7 shows a software vendor can appear here, so this is not impossible. But it sits below every data holder, and the readers it reaches are employees rather than the owners Fernpost sells to. Stop treating /learn/hvac-technician-pay-guide as an acquisition page. If it earns support questions or sales conversations, keep it and rewrite it for the employer side — what to budget per technician, how pay bands affect retention — which is a different query and a different page.

**What this analysis cannot tell you:** no authority, backlink or traffic figures were supplied, so these results are not ordered by difficulty. Page content was summarised in the paste rather than given in full, so the counts describe what you recorded, not everything the pages contain. Nothing here explains why /learn/hvac-technician-pay-guide is absent from the sample, because that page was not among the results shown.

## Safety notes

Check the output against your paste before you act on it. Every publisher type, sample size and update date in the analysis should be traceable to a line you wrote; anything else is the model reconstructing a page it has seen before. The counts are the easiest thing to verify and the most load-bearing, because a requirement is only a requirement if it recurs.

The analysis describes what pages on this result page have in common on the day you sampled it. It does not predict positions, does not estimate traffic, and a verdict of "target it" is a judgement that your site could carry the same asset, not a forecast that it will rank. Where data was missing, the output says so rather than filling the gap, and you should treat any version that reads more confident than your input as wrong.

## FAQ

### How many results should I paste?

The top ten is the working sample, and that is what the counts are calibrated for. Below five results the prompt marks every requirement as provisional, which is correct but not very useful — two pages sharing an element tells you nothing about whether it is expected. Going past the first page rarely changes the verdict and adds pages the searcher never sees.

### Why paste the results instead of letting the model browse?

Because you cannot audit what a browsing tool returned. It fetches a personalised, cached or differently geolocated result page, and the model then blends what it fetched with what it already believes about those domains, with no marker separating the two. Pasting makes the input fixed and checkable, which is the only reason the "every claim traces to the paste" check means anything.

### The verdict came back "do not target". Now what?

Take it seriously; that is the output the prompt exists to produce. Read the asset column and find which results the searcher actually wants — if they want a dataset or first-hand accounts, no amount of writing substitutes. Then run the prompt again on the adjacent query the recommendation names, the one your buyer would type rather than your buyer's employee, and see whether that result page is populated by publishers of your own type.

### Does this work on local and shopping queries?

Less well. When the result page is dominated by a local pack, a shopping carousel, or a video block, the organic results underneath are not where the click goes, and analysing them tells you about the wrong competition. Record what you see in `serp_features` anyway, and read the verdict as applying only to the organic slice — for those queries the real decision is usually about listings, feeds or reviews, which this prompt does not cover.
