---
title: SEO Blog Post Writing Prompt
description: Turn a content brief into a full first draft that marks where first-hand evidence is needed instead of inventing statistics, customer names, or study citations.
category: writing
useCase: First draft
outputFormat: Draft
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: seo blog post prompt, ai blog post writing prompt, content brief to draft, first draft prompt, blog post outline to draft, seo writing prompt, chatgpt blog post prompt
relatedSkill: content-brief
relatedPrompts: seo-article-outline-prompt, humanize-ai-content-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are a staff writer producing a first draft from a brief. You write what the
brief and the supplied evidence support, and nothing else.

# Scope
Produce a draft an editor can mark up. Do not invent facts. You may not write a
statistic, a percentage, a currency figure, a study, a named researcher, a named
customer, a case study, a quote, or a survey result unless it appears in the
inputs below. Where the argument needs evidence you were not given, mark the gap
instead of filling it.

# Inputs
Brief or outline: {{content_brief}}
Who is reading this: {{target_reader}}
Evidence I can actually use: {{available_evidence}}
Voice and style constraints: {{brand_voice}}
Target length and structure: {{draft_length}}

# What to produce
One draft that follows the brief's section order, written for the reader
described above, plus a ledger of every evidence gap you marked.

# Steps
1. Restate the brief's angle in one sentence for yourself. Every section must
   serve that angle. Drop sections that do not and say which.
2. Open by naming the situation the reader is in and the decision this article
   helps them make. No throat-clearing paragraph, no definition of a term the
   reader already uses at work.
3. Write each section in the brief's order. Use the primary and secondary terms
   where they read naturally in a heading or a sentence. Never repeat a term to
   reach a count and never bend a sentence to fit one in.
4. Every time you reach a claim that needs a number, a source, a customer
   example, or a screenshot you were not given, stop and write a marker in place
   of the evidence:
   [EVIDENCE NEEDED: what to supply | what the sentence claims without it]
   Write the surrounding sentence so the draft still reads, but do not write the
   number.
5. Use the items in the evidence input exactly as given. Do not round them,
   widen them into ranges, generalise your own measurement into an industry
   claim, or attribute anything to a party other than the source named.
6. Close with the next step the brief specifies. Do not invent an offer, a
   price, a discount, or a deadline.
7. Collect every marker into the evidence ledger, keyed to the section it came
   from.

# Output format
1. A header block: working title, one alternative title, and a meta description
   under 155 characters.
2. The draft in Markdown with H2 and H3 headings, in the brief's order.
3. "Evidence to supply before publishing" - a table with columns: Section |
   What is needed | Who can provide it | What the sentence claims without it.
4. "Cut from the brief" - anything you dropped, and why. Omit if nothing.

# Quality checks before you answer
- Every number, date, percentage, study, company name and quote in the draft
  traces to a specific line in the inputs. If you cannot point at the line,
  delete the claim.
- Every [EVIDENCE NEEDED] marker in the draft appears in the ledger, and every
  ledger row appears in the draft.
- No sentence promises a result the product cannot be shown to produce.
- No heading and no sentence exists only to carry a search term.
- The draft reads as one voice, not a stack of summary paragraphs.

# When the input is thin
If the brief has no angle, say so, write against the most defensible angle the
inputs support, and name the substitution at the top. If the evidence input is
empty, write the draft entirely with markers and state plainly that it is
unpublishable until they are filled. Do not soften a missing number into "many",
"most", or "studies show" - that is the same fabrication with less precision.
Do not estimate.

# Boundaries
Do not promise rankings, traffic, revenue, or a timeline. Do not state a keyword
density or a repetition count. Do not write testimonials, review text, or a
customer story unless the words were given to you. Do not cite a source you
cannot name from the inputs.
```

## Variables

### content_brief
Required. The brief or outline the draft is built from: working title, primary and secondary terms, search intent, the angle, and the section order.
Example: Working title "How to Schedule HVAC Technicians Without Losing the Afternoon to Drive Time"; primary term "how to schedule hvac technicians"; angle: dispatch order, not headcount, decides afternoon capacity

### target_reader
Required. Who reads this and what they already know. This decides how much you explain and where the article can start.
Example: Owner-operator or dispatcher at a residential HVAC company with 5 to 40 technicians, currently scheduling on a whiteboard or a shared calendar

### available_evidence
Required. The specific facts, figures, screenshots and quotes you are cleared to use, written out as you would paste them. Also state what you do not have, so the model marks the gap instead of filling it.
Example: Our own anonymised product data: median first job starts 8:10am, median last job starts 3:40pm. No third-party benchmarks. Two customer interviews on file, quotes not cleared for attribution.

### brand_voice
Optional. Style rules the draft must obey, including words you never use.
Example: Second person, short paragraphs, no exclamation marks, never use "solution" or "revolutionize"

### draft_length
Optional. Target length and heading structure. Leave blank and the model follows the brief's section count.
Example: 900 to 1200 words, H2 per brief section, H3 only where a section needs steps

## How to use

Fill `available_evidence` before anything else, and fill it with the actual lines you can paste rather than a description of your data. "We have customer data" is read as permission and produces specific figures that came from nowhere; "median first job starts 8:10am, from our own account data" is read as a fact and gets used as written. The sentence that saves the most editing time is the one naming what you do not have, because it converts every claim depending on that missing evidence into a marker rather than a plausible invention.

Check the output mechanically before you read it for style. Search the draft for digits and for the percent sign, and confirm every hit traces to a line in your inputs. Then confirm the marker count in the body matches the row count in the ledger. The failure you will actually hit is a hybrid sentence: the model writes the marker and also writes an illustrative number beside it, usually a round one. Delete the number, keep the marker.

The second common failure comes from the brief. If your brief already contains an unsourced statistic, the prompt treats it as supplied evidence and repeats it, because it cannot tell the difference between a fact you verified and a fact a previous draft invented. Clean the brief first or the fabrication survives into the draft with your own byline on it.

When a section is wrong, ask for that section to be rewritten against the same inputs rather than rerunning the whole prompt. A full rerun reshuffles the sections you already accepted and renumbers every marker, which means re-checking the ledger from scratch.

## Example input

```text
Brief or outline:
  Working title: How to Schedule HVAC Technicians Without Losing the Afternoon to Drive Time
  Primary term: how to schedule hvac technicians
  Secondary: hvac dispatch schedule, technician routing
  Intent: how-to, practitioner looking for a working method
  Angle: dispatch order, not headcount, decides afternoon capacity
  Sections: 1 Why afternoon jobs run long / 2 Build the day around the two fixed
  appointments / 3 Group jobs by drive time, not job type / 4 What to say when a
  tech runs late / 5 Leave one slot open for the same-day call / 6 When to stop
  scheduling by hand
  Internal links: /guides/dispatch-board, /pricing
  Next step: book a 20-minute walkthrough
Who is reading this: Owner-operator or dispatcher at a residential HVAC company
  with 5 to 40 technicians, currently scheduling on a whiteboard or a shared
  calendar
Evidence I can actually use:
  - Kestrel Field product screenshots: dispatch board, drive-time grouping,
    same-day slot
  - Our own anonymised account data: median first job starts 8:10am, median last
    job starts 3:40pm
  - Two customer interviews on file, quotes NOT cleared for attribution
  - No third-party research, no industry benchmarks, no survey data
Voice and style constraints: Second person, short paragraphs, no exclamation
  marks, never use "solution" or "revolutionize"
Target length and structure: 900 to 1200 words, H2 per brief section, H3 only
  where a section needs steps
```

## Example output

**Working title:** How to Schedule HVAC Technicians Without Losing the Afternoon to Drive Time
**Alternative:** HVAC Technician Scheduling: Build the Day Around Drive Time
**Meta description:** A dispatch method for residential HVAC teams: anchor the fixed appointments, group by drive time, and keep one slot open for the same-day call.

---

**H2: Why afternoon jobs run long**

By two o'clock the board still looks reasonable and every truck is still moving. By four, the last two calls have slid to tomorrow. Most owners read that as a headcount problem and start pricing a sixth technician.

Across Kestrel Field accounts, the median first job starts at 8:10am and the median last job starts at 3:40pm. That is a seven and a half hour working window, and the jobs themselves do not expand to fill it. What expands is the distance between them. [EVIDENCE NEEDED: share of that window spent driving, from our route logs | the sentence claims drive time is the binding constraint and currently cannot show it]

**H2: Build the day around the two fixed appointments**

Most days have one or two calls that cannot move: the maintenance visit the customer took a morning off for, the install with a delivery window. Place those first, then build outward. Scheduling them last is what forces a truck across town at 1pm.

*[Sections 3 to 6 continue in the same shape and are omitted here for length.]*

---

**Evidence to supply before publishing**

| Section | What is needed | Who can provide it | What the sentence claims without it |
| --- | --- | --- | --- |
| Why afternoon jobs run long | Share of the 8:10am to 3:40pm window spent driving | Data team, from route logs | That drive time, not headcount, is the constraint |
| Group jobs by drive time | A before-and-after from one named account, with written permission | Customer success | That regrouping recovers capacity per truck |
| Group jobs by drive time | An industry figure for jobs per technician per day | Not available - no third-party source in the inputs | That the reader's current number is below normal |
| When to stop scheduling by hand | One dispatcher quote cleared for attribution | Customer success - two interviews on file, neither cleared | That hand-scheduling breaks at a specific team size |

**Cut from the brief**

Section 4, "What to say when a tech runs late", is customer communication rather than dispatch order. It does not serve the drive-time angle and reads as a page of its own.

## Safety notes

Before publishing, a reviewer has to close every marker one of three ways: supply the evidence, cut the claim, or rewrite the sentence so it no longer depends on the missing number. Softening a marker into "many contractors find" is the failure this prompt exists to prevent, and it is the easiest one to commit at the end of an editing pass. Check the ledger against the final draft, not against the version you first received.

The prompt suppresses fabrication; it does not fact-check. Anything you supplied in `available_evidence` is reproduced on your authority, including any figure that was wrong when you pasted it. Nothing in the output claims the draft will rank, attract traffic, or convert, and nothing in the output can tell you whether the angle in your brief was the right one.

## FAQ

### Will it still invent statistics?

Sometimes, and the highest-risk input is your own brief. A figure sitting in the brief is treated as supplied evidence and repeated without a marker, because the prompt has no way to distinguish a number you verified from one an earlier draft made up. The mechanical check is faster than reading for it: search the finished draft for digits and the percent sign, and trace every hit to an input line.

### Can I publish with the markers left in?

No, and the markers are deliberately ugly so that shipping one is embarrassing rather than easy to overlook. If a marker cannot be filled, delete the claim it supports instead of hedging it. A paragraph that survives losing its number was never making an evidence-based argument.

### Does this work for product pages and category pages?

Not well. It is built for a brief with a section order and a reader who wants an explanation, so it assumes prose. Pages built from specifications, pricing tables, or filtered listings have their content determined by structured data, and the useful constraint there is completeness rather than fabrication control.

### Why does it never tell me how many times to use the keyword?

Because no repetition count exists that changes how a page performs, and writing to one produces sentences that read as written to a quota. The prompt instead requires that the terms appear where they read naturally and forbids adding a heading or sentence whose only job is to carry a term. If a term genuinely does not fit anywhere in the draft, that is a signal the brief's angle and its primary term are describing two different pages.
