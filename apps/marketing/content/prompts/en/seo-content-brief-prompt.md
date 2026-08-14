---
title: SEO Content Brief Prompt
description: Turn one target query into the brief a writer can work from - the page's argument, the questions it must answer, the evidence each section needs, and what is out of scope.
category: writing
useCase: Writer handoff
outputFormat: Brief
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: seo content brief prompt, content brief template, ai content brief, brief for writers, content brief generator, seo writer handoff
relatedSkill: content-brief
relatedPrompts: seo-article-outline-prompt, serp-competitor-analysis-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are a content strategist writing the brief a writer will work from. You are
not writing the page.

# Scope
Produce a brief for one page targeting one search. Do not draft sentences the
writer would publish. Do not invent statistics, survey figures, competitor
quotes, search volumes, or customer numbers. Any figure you use must come from
the inputs below; if a section needs a number you were not given, mark it as
missing and name the kind of source that would settle it. Never substitute a
plausible number for one you do not have.

# Inputs
Primary query: {{primary_query}}
Reader: {{reader_context}}
What the company sells and can honestly claim: {{product_context}}
Pages already covering this query: {{competing_pages}}
Internal pages available to link to: {{internal_pages}}

# What to produce
A brief whose spine is an argument, not an outline. A list of headings tells a
writer what to type; it does not tell them what the page is for. Every section
in your brief must state what it argues, not only what it covers.

# Steps
1. Write the one job of the page in a sentence: what the reader can do after
   reading it that they could not do before.
2. Write the page's argument as a single claim a competent person could
   disagree with. "Appointment reminders" is a topic. "Reminder timing moves
   the no-show rate more than a cancellation fee does" is a claim. If the
   inputs support no claim, say so and name what you would need. Do not invent
   a position to fill the line.
3. List the questions the reader must have answered before they will act. Take
   them from the reader description and from what the competing pages leave
   unanswered, not from what is easiest to write.
4. Lay out the sections. For each, state the sub-claim it makes and the
   evidence that carries it. Mark every piece of evidence as supplied (it is in
   the inputs) or to-source (it is not). Never mark something supplied because
   it sounds true.
5. Choose internal links only from the pages listed. For each, say why this
   reader, at that point in the page, would click it. Drop any link you cannot
   justify that way.
6. Write the out-of-scope list: what this page deliberately does not cover, and
   where each of those belongs instead. Name at least two things.

# Output format
A brief with these parts, in this order: Page and primary query; One job;
Reader; The argument; Sections (a table with the columns Section | What it
argues | Evidence | Supplied or to-source); Questions the page must answer;
Internal links; Out of scope; Evidence to source before drafting.

# Quality checks before you answer
- The argument is a claim someone could argue against, not a subject label.
- Reading the section sub-claims in order makes a case, not a checklist.
- Every figure in the brief traces to an input or is marked to-source.
- The out-of-scope list has at least two entries.
- Every internal link is one of the supplied URLs, with a stated reason.

# When the input is thin
If you were given no competing pages, write the brief and say the section order
is not informed by what already covers the query. If the reader description is
one line, name the two or three facts about the reader that would most change
the brief. If the company has no evidence for its own claim, say the page
cannot make that claim yet and mark it to-source. Do not close any of these
gaps with an estimate.

# Boundaries
Do not draft the page. Do not promise rankings, traffic, or results. Do not
specify keyword counts, densities, or how many times to repeat a phrase. Do not
attribute a claim to a competitor unless their page was quoted to you. Do not
soften the argument into balance for safety: a brief that argues nothing
produces a page that says nothing.
```

## Variables

### primary_query
Required. The one search this page is for, written the way a person would type it. One query, not a cluster — a brief that serves three queries serves none of them.
Example: how to reduce no shows veterinary clinic

### reader_context
Required. Who reads the page, what they have already tried, and the decision they are about to make. This is what separates a brief from an outline.
Example: Practice manager at a 3-vet independent clinic, already sends one text reminder the morning of, about to sign off on a $35 cancellation fee

### product_context
Required. What the company sells, what it can honestly claim, and what evidence it can actually put on the page.
Example: Halden, practice management software for independent US vet clinics; we can publish aggregate reminder-response data from the 340 clinics on the platform, but not clinic names

### competing_pages
Optional. URLs already covering the query, with one line on what each argues. The brief uses these to find what is unanswered, not to copy their structure.
Example: vetpracticeblog.com/no-shows — argues for a cancellation fee, cites no data

### internal_pages
Optional. URLs and titles the writer may link to. The prompt will not invent a URL that is not on this list.
Example: /features/reminders — "Automated appointment reminders"

## How to use

Fill `reader_context` and `product_context` properly before you touch anything else. Those two decide whether you get a brief or a table of contents. "Vet clinic owners" produces generic sections; "practice manager who already sends a morning-of reminder and is about to approve a $35 fee" produces an argument, because the model now knows what the reader has already rejected. If you find yourself writing the brief by hand afterwards, the fix is almost always in these two fields, not in the prompt.

Read the output starting from the Sections table, specifically the "What it argues" column. The failure you will actually hit is a row that restates its own heading — "Cancellation fees | Covers cancellation fees and how they work". That is an outline wearing a brief's formatting, and a writer handed it will produce a page that reads like a checklist. When you see it, do not rerun the whole prompt; paste back the offending rows and ask for the sub-claim each one makes, or delete the section outright if it turns out there is nothing to argue there.

Then audit the Supplied-or-to-source column against what you actually pasted in. Models mark evidence "supplied" when the sentence sounds plausible, which is exactly the failure this column exists to catch. Every "supplied" row should be findable in your `product_context` text; anything else is a to-source item, and to-source items are the writer's real blocking list. If your evidence turns out to be thinner than the argument needs, that is a useful result — it means the page cannot yet make the claim, and the honest options are to source the evidence or to narrow the claim, never to publish the claim unsupported.

## Example input

```text
Primary query: how to reduce no shows veterinary clinic
Reader: Practice manager at a 3-vet independent clinic in Ohio. Already sends one
text reminder the morning of the appointment. Is about to sign off on a $35
cancellation fee. Has never looked at when reminders go out, only whether they go.
What the company sells and can honestly claim: Halden, practice management
software for independent US vet clinics. We can publish aggregate
reminder-response data across the 340 clinics on the platform, including response
rate by send time and no-show rate by booking lead time. We cannot name clinics
and we have no data on whether cancellation fees get collected.
Pages already covering this query:
vetpracticeblog.com/no-shows — argues for a cancellation fee, cites no data
clinicgrowth.com/reduce-no-shows — 12-item listicle, no reader decision in it
avma-forum thread — practice managers arguing about fees, no resolution
Internal pages available to link to:
/features/reminders — "Automated appointment reminders"
/blog/front-desk-scripts — "Front desk scripts for confirming appointments"
/pricing — "Halden pricing"
```

## Example output

**Page:** How to cut no-shows at an independent vet clinic
**Primary query:** how to reduce no shows veterinary clinic

**One job:** Give a practice manager who already sends a morning-of reminder one specific change to make this month, and a reason to make it instead of approving the $35 fee.

**Reader:** Practice manager, 3-vet independent clinic. Has a reminder system and believes it is working. Is one signature away from a cancellation fee. Has never considered send timing as a variable.

**The argument:** A cancellation fee acts after the slot is already lost; reminder timing acts before. For a clinic already sending one reminder, changing when it goes out is the cheaper intervention and does not spend the client relationship that the fee spends.

**Sections**

| Section | What it argues | Evidence | Supplied or to-source |
| --- | --- | --- | --- |
| Why the fee feels like the obvious answer | The fee is attractive because it is visible and easy to implement, not because it addresses the cause | Argument from mechanism only; we have no data on fee collection | To-source |
| Where your no-shows come from | No-shows vary by how far ahead the appointment was booked; the section reports whichever pattern the data shows | No-show rate by booking lead time, 340 clinics | Supplied — the data decides the direction, the brief does not |
| One reminder is a notification, two is a confirmation | Response rate varies by send time; the section argues for whichever schedule the data supports over the single morning-of send | Reminder-response rate by send time, 340 clinics | Supplied — the data decides the direction, the brief does not |
| What the confirmation should ask for | Requesting a reply turns a passive reminder into a stated commitment | Our published front desk scripts | Supplied |
| When a fee is genuinely the right tool | Repeat offenders and surgical slots, where the lost slot cannot be refilled | Argument from mechanism; make no claim about how often fees are collected | To-source |

**Questions the page must answer**
- What is a normal no-show rate for a clinic my size? We have no citable benchmark. Either source one or state plainly that published figures vary too widely to compare against — do not print a number.
- Will a second reminder annoy clients?
- Do cancellation fees actually get paid? We do not know. Say so.
- What do I change on Monday morning?

**Internal links**
- `/features/reminders` from the two-reminder section, for the reader who has accepted the timing argument and now needs to know whether their system can send on a schedule.
- `/blog/front-desk-scripts` from the confirmation-wording section; it is literally the next thing they need.
- Not linking `/pricing`. This reader is diagnosing a problem, not shopping.

**Out of scope**
- Choosing practice management software — belongs on the comparison page
- Wellness-plan and recall reminders — different reader, different job
- Setting up payment processing for fees — support documentation

**Evidence to source before drafting**
- A citable industry no-show benchmark, or the first section runs without one.
- Any statement about fee collection rates. We hold none. Do not estimate one.

## Safety notes

Before you hand this to a writer, check every row marked Supplied against the material you actually pasted in, and check that no number appears anywhere in the brief that you did not provide. A model asked for a persuasive brief will reach for a benchmark figure, and a fabricated figure that survives into a draft is much harder to catch once it is wrapped in a sentence. The to-source list is the part of the output with real operational value: it is the writer's blocking list, and shipping the page without clearing it means publishing a claim you cannot support.

The brief makes no claim about how the page will perform. It states what the page argues, who it is for, and what evidence that argument needs — all of which are editorial decisions you can check today. Nothing in it says the page will rank, and a brief with a sharp argument and no evidence behind it is worse than a dull one, not better.

## FAQ

### Why insist on an argument instead of a good outline?

Because a writer given only headings fills each one with whatever is true and adjacent, and the result reads like a checklist — accurate, complete, and pointless to read. An argument tells the writer what to leave out, which is the harder half of the job. It also forces the uncomfortable decision up front: if you cannot state the claim in a sentence, you have not decided what the page is for, and no amount of drafting will decide it for you.

### What about pages that genuinely have no argument, like a definition or a glossary entry?

This prompt is a poor fit for those. A page answering "what is net 30" has a job, not a position, and forcing a claim onto it produces contrarian filler. Run it anyway and read step 2 honestly: if the model reports that the inputs support no claim, take that at face value and brief the page as a definition instead. The prompt is built for pages where a reader has options and your page is recommending one.

### The model marked evidence "supplied" that we do not have. Is the prompt broken?

No, that is the known failure the column is designed to surface. Models infer that a company selling reminder software must have reminder data, and mark the row accordingly. The prompt tells it not to, which reduces the rate but does not eliminate it, so the check stays manual: every Supplied row must be traceable to a sentence in your `product_context`. If you cannot find it there, it is to-source.

### Can I paste in the full text of competing pages?

You can, and the brief gets better at finding what is unanswered. Two cautions. Long pastes push the model toward mirroring the strongest competitor's structure, which is the opposite of what you want — a one-line summary of what each page argues usually produces a sharper brief than the full text does. And anything you paste can end up quoted back at you as though it were your own finding, so keep competitor material clearly labelled in the input and check any quoted line in the output against the source before it reaches a draft.
