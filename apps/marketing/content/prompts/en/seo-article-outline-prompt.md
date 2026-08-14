---
title: SEO Article Outline Prompt
description: Turn a topic and its search intent into a section-by-section outline where every heading states what it proves, with unequal word budgets and an explicit cut list.
category: writing
useCase: Drafting
outputFormat: Outline
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: seo article outline prompt, content outline prompt, blog post outline generator, seo content outline, article structure prompt, outline from search intent
relatedSkill: content-brief
relatedPrompts: seo-content-brief-prompt, seo-blog-post-writing-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are an editor turning a topic into a section-by-section article outline.

# Scope
Outline one article. Every section must earn its place by what it proves to the
reader, not by what it is nominally about. Do not invent statistics, study
results, customer quotes, dates, or product capabilities. Work only from the
evidence listed below. If a section needs evidence you were not given, mark it
as missing rather than writing a plausible-looking number.

# Inputs
Topic and the query it targets: {{topic_and_query}}
What the searcher wants and when they would stop reading: {{search_intent}}
Evidence the author can actually bring: {{available_evidence}}
Total word budget for the finished draft: {{word_budget}}
What the currently ranking pages already cover, if known: {{competing_pages}}

# What to produce
A section list where each section carries a claim, the evidence behind it, and a
word allocation. Allocations must be unequal. The section that answers the query
most directly takes the largest share; sections that only add context take a
small share or get cut. An outline where every section weighs roughly the same
is a failed outline, because it means no decision was made about what the
article is for.

# Steps
1. Write one sentence saying what the reader must be able to do or decide after
   reading. Judge every section below against that sentence.
2. List the claims the article has to land to get the reader there. A claim is
   arguable and checkable; a topic is not. "Annual plans distort your monthly
   revenue chart" is a claim. "About annual plans" is a topic.
3. Attach evidence to each claim from {{available_evidence}}. A claim with
   nothing behind it is labelled EVIDENCE MISSING. Do not quietly drop it and do
   not patch it with a generic industry statistic.
4. Rank the claims by how much of {{search_intent}} each one satisfies, then
   split {{word_budget}} in proportion to that ranking, never evenly. The top
   section must be at least three times the smallest surviving section.
5. Cut. Remove any section that exists only because the topic "should" cover it,
   any section that repeats what {{competing_pages}} already does well without
   adding new evidence, and any section a reader would skip once they have the
   answer. Name every cut and give the reason in one line.
6. Rewrite each surviving heading so it states its claim rather than its subject.
   If a heading would fit equally well on any other article about this topic, it
   is too generic; rewrite it.
7. Order sections by what the reader needs first. The answer to the query comes
   early, not after a build-up.

# Output format
1. A one-sentence purpose statement.
2. A table: Section heading | What it proves | Evidence used | Words | Why here.
3. A "Cut" list: section considered, reason, one line each.
4. An "Evidence missing" list, if any: the claim, and what the author would have
   to obtain before that section can be written.

# Quality checks before you answer
- Word allocations are unequal and sum to the stated budget.
- Every heading states a claim; none is a bare noun phrase.
- Every section names its evidence or appears under Evidence missing.
- At least one section was cut, with a specific reason.
- No number, source, date, or quote appears that was not in the input.

# When the input is thin
If no evidence was supplied, return the claim list with every section marked
EVIDENCE MISSING instead of assembling an outline that looks finished. If the
competing pages field is empty, say that the cuts were made on intent alone and
may remove something worth keeping. Do not estimate search volume, difficulty,
or what the ranking pages contain.

# Boundaries
Do not predict rankings or traffic. Do not specify keyword counts, keyword
density, or where to repeat a phrase. Do not pad the outline to hit a section
count. Do not write the draft: headings, claims, evidence, and word counts only.
```

## Variables

### topic_and_query
Required. The article subject plus the exact query it is written for. Write the query the way a person types it, not the way a keyword tool formats it.
Example: How to read your restaurant's labor cost percentage, targeting "restaurant labor cost percentage"

### search_intent
Required. Who the reader is, what pushed them to search, and the moment they would stop reading. The stopping point is what decides which section goes first.
Example: An owner of 3-6 restaurants who just saw labor at 34% and wants to know whether that is bad before next week's schedule goes out

### available_evidence
Required. Everything the author can actually open and cite, with sample sizes and dates where they exist. List what you do not have as well, so the model cannot quietly assume it.
Example: Shiftwell aggregate, 412 locations, 12 months to June 2026; nine owner interviews, Q2 2026; not available: revenue or cover counts

### word_budget
Required. The real total length you will write to. This is what forces the allocation trade-off, so use the number you mean.
Example: 1600

### competing_pages
Optional. What the pages currently ranking for the query already cover. Without it the model still cuts, but on intent alone.
Example: Results 1-3 are a glossary definition, a "15 ways to cut costs" listicle, and a payroll calculator page

## How to use

Fill `available_evidence` with things a reader could be pointed at: a dataset with a row count and a date range, an interview set, a screenshot, a public series you can link. Entries like "internal data" or "customer feedback" produce sections whose evidence column is equally vague, and you will not notice until drafting, when there is nothing to cite. Listing what you do not have matters as much as listing what you do; it is what stops the model from building a section around a cover-count analysis you cannot run.

The failure you will actually hit is near-equal allocations. Ask for 1600 words across five sections and a model will often return 400/350/350/300/200, which technically varies but dodges the decision. When that happens, say the budget out loud again and ask which single section it would delete if the budget dropped to 1000. The answer to that question is the real ranking, and the allocation usually fixes itself once it has been forced to name a loser.

The second failure is a number in the "What it proves" column that you never supplied. Read the output for digits, percent signs, and years, and trace each one back to your evidence list. A model asked to make a claim sound solid will reach for a plausible benchmark, and a plausible benchmark is indistinguishable from a real one at a glance. The cut list deserves the same suspicion: if the only thing cut is "Introduction" or "Conclusion", it is a strawman cut. Push back by naming a section that a ranking competitor covers and asking whether it earns its words here.

When the claims are right but the order is wrong, reorder by hand. Rerunning the whole prompt tends to regenerate claims you had already accepted, and you spend the second pass re-reviewing work you finished.

## Example input

```text
Topic and the query it targets: How to read your restaurant's labor cost percentage, targeting "restaurant labor cost percentage"

What the searcher wants and when they would stop reading: An owner of 3-6 independent restaurants who just saw labor at 34% on a weekly report and wants to know whether that is bad and what to change before next week's schedule goes out. They stop reading once they know whether 34% is a problem for their service type and have one change they can make this week.

Evidence the author can actually bring:
- Shiftwell aggregate across 412 locations, 12 months to June 2026: median labor cost percentage 26.4% quick service, 31.8% full service
- Nine recorded owner interviews, Q2 2026, on what they changed to bring labor down
- Product screenshot: Shiftwell overtime forecast for the coming week
- US Bureau of Labor Statistics published wage series for food service occupations
- Not available: revenue, margin, or cover counts for those 412 locations

Total word budget for the finished draft: 1600

What the currently ranking pages already cover, if known: Results 1-3 are a POS vendor glossary defining the formula, a "15 ways to cut restaurant labor costs" listicle, and a payroll vendor calculator. None of them break the benchmark out by service type.
```

## Example output

**Purpose:** after reading, an owner looking at 34% can say whether that number is a problem for their service type and name one change to make before the next schedule goes out.

**Outline**

| Section heading | What it proves | Evidence used | Words | Why here |
| --- | --- | --- | --- | --- |
| 34% is ordinary for full service and a problem for quick service | The reader's number is uninterpretable until it is read against service type | Shiftwell aggregate, 412 locations, 12 months to June 2026 (26.4% QSR, 31.8% full service) | 520 | This is the question they typed; anything before it delays the answer |
| Three things move the number, and they move at very different speeds | Schedule shape changes within a week, wage floor does not change at all this quarter | Nine owner interviews, Q2 2026; BLS food service wage series | 430 | Sets up the choice of what to touch before next week's schedule |
| Overtime is usually the largest line you can cut this week | Overtime concentrates in a few shifts, so it is reachable without cutting headcount | Overtime forecast screenshot; four of the nine interviews | 340 | Delivers the one action the reader came for |
| Cutting hours can raise your cost per cover | Removing hours from a busy shift can cost more than it saves | EVIDENCE MISSING | 190 | Stops the reader acting on section three without a check |
| The number moves when revenue moves, not only when labor does | A good sales week can hide a scheduling problem | Arithmetic on the two medians already cited; no new data | 120 | Closes the loop without introducing a new claim |

Total: 1600 words. Largest section is 4.3 times the smallest.

**Cut**

- What is labor cost percentage (formula walkthrough) — the ranking glossary page already covers it, and a reader who typed a number already has one. Fold the formula into a single line in section one.
- Fifteen ways to reduce labor cost — we hold evidence for three levers and none for the other twelve; the remaining twelve would be padding dressed as thoroughness.
- Predictive scheduling laws by state — a compliance intent, not this one, and we have had no legal review. Belongs on its own page.
- Regional benchmarks — the 412 locations do not split into regions large enough to publish, and publishing them anyway would mean inventing a sample.

**Evidence missing**

- Claim: cutting hours from a busy shift can raise cost per cover. Needed: labor hours joined to cover counts. Shiftwell holds hours but not covers. Either pull covers from the POS integration for the subset of locations that have it, or drop this section and note the risk in one line inside section three.

## Safety notes

Before you trust the outline, open every item in the Evidence used column and confirm it says what the claim says it says. The prompt forbids invented figures, but that instruction cannot verify itself; the only real check is a person tracing each number back to its source. Pay particular attention to sections where a specific figure has attached itself to evidence you described only in general terms, and to any section that gained a source between drafts.

The outline claims nothing about performance. Word allocations are editorial decisions about where the argument needs room, not ranking inputs, and the cut list reflects what this author can evidence today rather than what the topic requires in general. A section marked EVIDENCE MISSING is a decision to make, not a gap to fill with prose.

## FAQ

### Why force unequal word counts instead of letting the writer allocate later?

Because the allocation is the outline. Once every section is roughly the same size, the article has no centre of gravity and the reader has to work out which part answers their question. Forcing the split at outline stage surfaces the disagreement early, when moving 200 words between sections costs nothing.

### The model cut a section I want to keep. What should I do?

Read its reason first. If the reason is that a ranking page already covers it, the useful question is what you would add that the other page does not, and the answer is usually a piece of evidence you hold. If you have that evidence, put it in `available_evidence` and rerun; if you do not, the cut was probably right.

### Does this work when I have no first-party data?

Partly, and it will tell you so. With no evidence supplied, the output is a claim list where every section is marked EVIDENCE MISSING, which is honest but is not an outline you can hand to a writer. Public sources count as evidence, so a topic you can support with published data, documentation, or your own product behaviour still works. A topic where you can support nothing is a signal to pick a different topic rather than to write it anyway.

### Can I skip the competing pages input?

Yes, and the prompt says what it lost. Without it, cuts are made on search intent alone, so the outline may keep a section that three ranking pages already handle better, or cut one that is your only real differentiator. Ten minutes of reading the top results and pasting a two-line summary of each changes the cut list more than any other input on this page.
