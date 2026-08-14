---
title: Content Brief
description: Turn a target query into a brief a writer can act on, carrying the claim the page makes, the evidence to gather first-hand, and what the page must not say.
tagline: Hand a writer an argument, not a list of headings
category: content
owner: seo
fileName: content-brief.md
keywords: content brief skill, seo content brief, content brief template, article brief for writers, search intent brief, content outline process, editorial brief
relatedSkills: keyword-research, content-refresh
relatedPrompts: seo-content-brief-prompt, seo-article-outline-prompt
status: published
publishedAt: 2026-08-14
---

## Skill file

```text
---
name: content-brief
description: Turn a target query into a brief a writer can act on, carrying the claim the page makes, the first-hand evidence to gather, and what the page must not say.
owner: GenGrowth SEO Agent
---

# Content Brief

Your job is to hand a writer an argument, the evidence needed to support it,
and the boundary of what the page may claim. Headings come last and matter
least.

## What counts as evidence

Four sources, in descending order of trust:

1. First-hand — something only this team can produce: a timed test, a
   screenshot of the real product, a support ticket, a figure from the
   company's own systems. This is what makes a page hard to copy.
2. Measured — the site's own Search Console data for this query and its
   neighbours, plus how any existing page on the topic performs today.
3. Observed — what currently ranks: what those pages assume the reader
   already knows, and the point at which every one of them stops.
4. Provider-supplied — volume and difficulty estimates. Estimates, labelled
   as estimates wherever they appear.

You may not create evidence. If a statistic, a quote, or a benchmark would
strengthen the page, name it as something the writer must go and get, and
name the source to get it from. Never write a plausible number into a brief.
When a metric is unavailable, say it is unavailable. Zero is a measurement;
missing is not zero.

## Procedure

1. Write the reader in one sentence: who types this query, and what has
   already gone wrong for them by the time they type it. A brief for "how to
   cancel a domain transfer" written for someone comparing registrars is a
   different page from one written for someone whose transfer is already in
   flight.

2. Write the claim. One sentence the page exists to establish. If you cannot
   write that sentence, the brief is not ready, and no outline will rescue
   it.

3. Read what currently ranks and name two things: the assumption every result
   shares, and the point at which they all stop. The second is usually where
   this page's reason to exist is hiding.

4. Decide what this page adds. Not "more thorough" — something nameable: a
   step the others skip, a figure nobody has published, a case where the
   standard advice fails, a decision the reader has to make that no one has
   framed for them.

5. List the first-hand evidence the writer must gather before drafting, each
   with where it comes from and who to ask. This list is the brief's real
   payload; the outline is the packaging.

6. Build the outline as questions. Each section is the question the reader
   asks next, given what the previous section just told them. If a section
   does not answer a question, cut it.

7. Write the must-not-claim list: guarantees, comparisons the team has not
   actually run, competitor behaviour taken from that competitor's own
   marketing, and any number the writer cannot source.

8. Specify the mechanical parts last: page type, which existing pages should
   link in and out, and what the title and description promise. Do not
   specify how often any term appears.

## Output

A brief containing: target query, reader sentence, the claim, what this page
adds and why, first-hand evidence to gather with its sources, an outline
written as questions, the must-not-claim list, internal links in and out, and
page type. Close with what you could not determine and what data would settle
it.

## Refuse to

- Ship a brief that has headings but no claim.
- Invent a statistic, a quote, a case study, or a benchmark for the writer.
- Present an estimate as a measurement, or fill an unavailable metric with
  zero.
- Promise a ranking, a traffic number, or a timeline.
- Specify a keyword density or a repetition count.
- List a section without being able to say why the reader needs it.
```

## What it does

The brief that fails looks complete. It has the target query, a word count, a list of headings taken from the pages that currently rank, and a block of related terms. The writer follows it exactly and produces something that covers the topic and argues nothing. It reads like the other eight results because it was assembled from the other eight results, and the only honest summary of it is that the topic has been covered.

This skill inverts the order. The claim comes first: one sentence the page exists to establish, written before any heading. Then the reason the page deserves to exist, expressed as the specific thing the current results do not do. Then the evidence the writer has to gather first-hand — a timed test, a support ticket, a figure from the company's own systems — because that is the part of the page nobody else can produce.

Headings arrive last, as questions rather than labels. A section that cannot be phrased as the question the reader asks next is a section the writer does not need to write.

The brief also carries a boundary. Every page has claims it cannot support: benchmark comparisons the team never ran, competitor behaviour lifted from that competitor's marketing, numbers that would be convenient if they were true. The skill writes those down as refusals, so the writer does not have to guess where the line is and the reviewer does not have to find it afterwards.

## In action

### You ask

We run rootstock.dev, a managed Postgres backup service for small engineering teams. I want a page targeting "postgres point in time recovery". Our writer is technical but has never run a restore on our infrastructure.

### The agent does

The claim I would build the page on: point-in-time recovery fails at restore time, not at backup time, and the thing that actually breaks is that nobody has ever timed a restore. Every section serves that sentence or comes out.

Page one is eight results. Six are the same `pg_basebackup` plus `recovery_target_time` walkthrough, and all six end at the moment the recovery command is issued. None of them says how long the restore took, on what data volume, or what happened to the application while it ran. That silence is the page's reason to exist.

Evidence your writer has to gather before drafting, none of which I can supply: one restore timed on your own infrastructure with dataset size, wall-clock total, and the WAL replay stage costed separately; the exact error text Postgres emits when `recovery_target_time` precedes the base backup; and one sentence from support on how customers usually discover the gap.

I could not attach a search volume figure to this query. No keyword tool is connected to this project, and I will not put a number in a brief that I have not seen. The evidence gap justifies the page on its own.

Must not claim: any recovery time objective for a reader's setup, or that competitors lack PITR — check their docs before writing that sentence.

## How it works

### Fix the claim before the outline

The agent writes the reader in one sentence and the claim in one sentence, and refuses to proceed without both. A query like "sso vs saml" produces a different page for an engineer choosing an implementation than for a buyer answering a security questionnaire, and the claim is what forces that choice into the open.

### Find where everyone stops

Reading the current results is not heading collection. The agent looks for the assumption every ranking page shares and the point at which all of them stop, because the second one is usually where the page's contribution lives. If the results genuinely leave no gap, the brief says so rather than manufacturing an angle.

### Name the first-hand evidence and its source

The brief lists what the writer must go and get: the test to run, the ticket to read, the person to ask, the figure to pull. The agent does not supply example numbers to be swapped out later, because example numbers survive into published drafts more often than anyone admits.

### Turn the outline into questions and write the refusals

Sections are phrased as the question the reader asks next, so a section with no question is visibly redundant. The brief closes with the must-not-claim list and a note on what could not be determined, which gives the reviewer something concrete to check rather than a general impression to form.

## What it covers

- Claim-first brief construction, with the page's argument written before any heading
- Reader definition tied to the moment the query is typed, not a generic persona
- Result reading for shared assumptions and the common stopping point
- First-hand evidence lists naming the test, the source, and the person to ask
- Question-form outlines that expose redundant sections before drafting starts
- Explicit must-not-claim boundaries and an unavailable-data note for the reviewer

## When to use it

- A keyword list has been approved but nobody has decided what any page will argue
- Drafts keep coming back comprehensive, on-topic, and unconvincing
- Writers are strong on craft but have no access to the product or its data
- A freelancer or agency is producing pages and the review cycle is spent correcting claims
- Two writers were briefed on adjacent queries and produced pages that say the same thing

## FAQ

### How is this different from the Keyword Research skill?

Keyword research decides which page should exist and why it is worth the effort. This skill decides what that page argues once the decision is made. The handoff is a single row: keyword research hands over a query, an intent, a target page, and a status, and the brief turns that row into something a writer can start on without a meeting.

### Why will it not include example statistics for the writer to replace?

Because placeholder numbers get published. A figure written into a brief as an illustration travels into the draft, survives review because it looks sourced, and ends up on a live page attached to your domain. Naming the number the writer must obtain, and where to obtain it, costs one extra sentence and removes that failure entirely.

### Does this remove the need for a subject matter expert?

No, and it is designed to make the need explicit rather than absorb it. The evidence list is a set of requests to the people who hold the information, with names attached. What the skill removes is the meeting where a writer and an expert discover in real time that neither knows what the page is supposed to argue.

### Can I use it to brief an update rather than a new page?

Partly. The claim, evidence, and must-not-claim sections apply to any page. But an update also needs to know what the existing page already earns and what would be lost by rewriting it, which is the Content Refresh skill's job. Run the refresh assessment first, then use this skill to brief whatever it decides is worth writing.
