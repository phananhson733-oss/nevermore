---
title: AI Draft Editing Prompt
description: Edit an AI first draft into publishable prose by cutting throat-clearing and machine rhythm, and flagging every claim that needs a fact instead of inventing one.
category: writing
useCase: Editing
outputFormat: Rewritten draft
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: humanize ai content prompt, ai draft editing prompt, edit ai written content, remove ai writing patterns, rewrite ai text prompt, ai content editing
relatedSkill: content-brief
relatedPrompts: seo-blog-post-writing-prompt, content-refresh-rewrite-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are a line editor preparing an AI first draft for publication.

# Scope
Edit the draft below so it reads like it was written by someone who knows the
subject. This is an editing job, not a detector-evasion job. Do not optimise for
AI-detection scores, do not add typos or filler to sound human, and do not
invent a number, a date, a name or an anecdote to make a sentence sound
specific. Fabricated specificity is a worse failure than the generic sentence
you started with.

# Inputs
Draft to edit: {{draft_text}}
What this page is and who reads it: {{page_context}}
Facts you are allowed to add: {{verified_facts}}
Voice sample from a published page: {{voice_sample}}
Elements that must survive the edit unchanged: {{locked_elements}}

# What to produce
A rewritten draft, a change log of the edits, and a list of the places where the
draft needs a fact you were not given.

# Steps
1. Read the draft once against {{page_context}}: what should this reader be able
   to do afterwards, and which paragraphs do not move them there. Paragraphs
   carrying no claim a reader could disagree with get cut, not rewritten.
2. Delete the throat-clearing. The first sentence that tells the reader
   something they did not know is the real opening. Cut everything above it.
3. Break the machine rhythm. Look for three-item lists used for cadence rather
   than completeness, "not just X but Y" constructions, matched paragraph
   lengths, trailing participles that add nothing ("making it a valuable tool"),
   and transitions such as moreover, furthermore and additionally that join
   sentences with no logical turn. Cut the padding, keep the item that carries
   information, and let paragraph lengths differ.
4. For every vague claim, make one of three decisions and record which:
   replace it with a fact from {{verified_facts}}, cut the sentence, or keep it
   and list it as a gap. Never resolve vagueness by supplying a plausible
   number. "Studies show" with no study named is a gap, not a sentence to
   improve.
5. Rewrite hollow sentences as claims with an owner. "It is widely considered
   best practice" becomes either who considers it that, or nothing.
6. Read the result against {{voice_sample}} for sentence length, contraction
   use and how directly it addresses the reader. Match those habits, not its
   phrasing.
7. Confirm every item in {{locked_elements}} survived the edit unmodified.

# Output format
1. "Edited draft" - the full rewritten text, ready to paste.
2. "Change log" - a table with the columns: Original phrase | What was wrong |
   What replaced it. One row per substantive edit. Skip pure typo fixes.
3. "Needs a fact" - a numbered list of sentences that stayed vague for want of a
   verified fact, each with the specific question a subject-matter expert has to
   answer.

# Quality checks before you answer
- Every number, date, name and product capability in the edited draft traces to
  the original or to {{verified_facts}}. Nothing new.
- The edited draft contains no anecdote or customer story that was not in the
  input.
- No paragraph opens with a transition that could be deleted without changing
  the meaning.
- Paragraph lengths vary. No run of three paragraphs with the same shape.
- Every locked element is present, unchanged.
- The change log accounts for each meaningful difference between the drafts.

# When the input is thin
If {{verified_facts}} is empty, edit for structure and rhythm only, say plainly
that specificity could not be added, and list every vague claim under "Needs a
fact". If the draft is too short to have a rhythm problem, say so and return
only what still needs work.

# Boundaries
Do not promise rankings, traffic or revenue. Do not add or remove terms to reach
a keyword density, and do not repeat a term a set number of times. Do not claim
the edited draft will pass any AI-detection tool; that is not what this edit
does and those tools are not reliable enough to target. If a sentence can only
be fixed with information you do not have, say so instead of writing something
that sounds right.
```

## Variables

### draft_text
Required. The AI first draft, pasted whole. Keep the original headings and links in place so the editor can see what it is allowed to move.
Example: In today's fast-paced e-commerce landscape, inventory accuracy is more important than ever...

### page_context
Required. What the page is for and who reads it. This decides which paragraphs earn their place and which are filler.
Example: Blog post for Bramble, a warehouse inventory app; read by ops leads at 5-50 person e-commerce brands running one warehouse

### verified_facts
Optional. The specifics the editor may add, and only these. Numbers, product defaults, named sources, internal measurements with their caveats.
Example: Bramble default cadence, set by ABC class, is A items weekly, B monthly, C quarterly

### voice_sample
Optional. Two or three sentences from a page you already published and liked. Used for sentence habits, not subject matter.
Example: You don't need a barcode scanner to start. A phone camera and a printed bin map get you through the first count.

### locked_elements
Optional. Headings, links, anchor text, product names or legal wording that must come back unchanged.
Example: H2 "Where to start"; the link to /guides/bin-locations; product name spelled Bramble

## How to use

Paste the prompt and fill the five placeholders. `verified_facts` is the one that decides whether the output is worth anything: with it, the editor can swap "significantly faster" for a real figure; without it, every soft claim lands in the "Needs a fact" list and the edit is structural only. That is the intended behaviour, not a failure, but it means an empty `verified_facts` gives you a tighter draft rather than a more credible one.

Check the output in one pass: read the change log's right-hand column and confirm every specific in it appears in your input. This is where fabrication shows up. The usual shapes are a number that arrived from nowhere ("up to 40 percent faster"), a named study that does not exist, and a first-person anecdote about a client or a warehouse the model has never seen. Anything in the edited draft that traces to neither the original nor `verified_facts` is invented, and the change log is the fastest place to catch it because the model has to write down what it put there.

Work in chunks of roughly 800 to 1,200 words. On a full 3,000-word article the model starts summarising instead of editing, and the tell is the change log: it covers the first third in detail and then thins out. Rerun the back half on its own rather than asking for a longer log.

The other failure to watch for is over-correction. Told to break a symmetric rhythm, a model will sometimes produce a page of short declarative sentences, which is just a different uniform rhythm. If every sentence in the output is under twelve words, paste the edited draft back in with `voice_sample` filled and ask only for sentence-length variety.

## Example input

```text
Draft to edit:
In today's fast-paced e-commerce landscape, inventory accuracy is more important
than ever. Cycle counting has emerged as a powerful solution for warehouse teams
looking to maintain accurate stock levels without the disruption of a full
physical inventory.

Cycle counting isn't just about counting products - it's about building a culture
of accuracy. By counting a small subset of SKUs on a regular basis, teams can
identify discrepancies early, address root causes quickly, and improve overall
inventory health. Moreover, this approach allows operations to continue
uninterrupted, which is critical for growing brands.

It's worth noting that most experts agree cycle counting delivers significant
improvements in inventory accuracy. Studies show that companies implementing
cycle counts see substantial reductions in shrinkage. Furthermore, Bramble's
cycle count feature is highly scalable, making it a valuable tool for warehouses
of all sizes.

## Where to start

To get started, teams should first segment their SKUs, then establish a counting
cadence, and finally train staff on the process. Setting up
[bin locations](/guides/bin-locations) correctly is a foundational step in this
journey.

What this page is and who reads it: Blog post for Bramble, a warehouse inventory
app; read by ops leads at 5-50 person e-commerce brands running one warehouse.

Facts you are allowed to add:
- Bramble default cadence, set by ABC class: A items weekly, B monthly, C
  quarterly.
- Support categorises count-discrepancy tickets; the three largest categories are
  receiving errors, unrecorded damage write-offs and mis-scanned bin locations.
  We have not published the split between them.
- At our own fulfilment site, one picker counts 40-60 SKUs in about 45 minutes
  across a 5,000 sq ft floor. Single site, single floor plan.

Voice sample from a published page: You don't need a barcode scanner to start. A
phone camera and a printed bin map get you through the first count; the scanner
pays for itself later, when counting gets boring.

Elements that must survive the edit unchanged: H2 "Where to start"; the link to
/guides/bin-locations with its anchor text; product name spelled Bramble.
```

## Example output

**Edited draft**

```text
Cycle counting means counting a slice of your SKUs while the warehouse keeps
running, instead of closing the floor for a full physical count.

The reason to count a slice is timing. A discrepancy found in March on a SKU
last received in February still has a paper trail you can walk back. The same
discrepancy found in an annual December count does not.

Bramble's default cadence is set by ABC class: A items weekly, B monthly, C
quarterly. Change it if your mix demands it.

Our support team sorts count-discrepancy tickets into categories, and the three
largest are receiving errors, unrecorded damage write-offs and mis-scanned bin
locations. We have not published how the volume splits, so treat that as a list
to check, not a ranking.

## Where to start

Segment your SKUs first. Then set a cadence you can hold for a full quarter
rather than the one that sounds most rigorous. Set up your
[bin locations](/guides/bin-locations) before the first count; a wrong bin map
produces discrepancies that are not discrepancies.

At our own fulfilment site, one picker counts 40 to 60 SKUs in about 45 minutes
across a 5,000 sq ft floor. That is one site and one floor plan; use it to
sanity-check your first count, not as a target.
```

**Change log**

| Original phrase | What was wrong | What replaced it |
| --- | --- | --- |
| "In today's fast-paced e-commerce landscape..." | Throat-clearing; tells an ops lead nothing new | Cut; the page opens on the definition |
| "isn't just about counting products - it's about building a culture of accuracy" | Rhetorical frame around an uncheckable claim | The actual mechanism: an early error still has a paper trail |
| "identify discrepancies early, address root causes quickly, and..." | Three items for cadence; the third restates the first two | Kept the mechanism, dropped the pair |
| "Moreover", "Furthermore", "It's worth noting that" | Transitions and hedges with no logical turn | Deleted; sentence order carries the relation |
| "Studies show... substantial reductions in shrinkage" | Attributes a measurement to an unnamed source | Cut and listed as a gap |
| "making it a valuable tool for warehouses of all sizes" | Trailing participle carrying no information | The measured count rate, with its single-site caveat |
| "first segment... then establish... and finally train staff" | Symmetric list; the third step has no content | Two concrete instructions; training moved to the gap list |

**Needs a fact**

1. Shrinkage. The draft claimed studies show substantial reductions and no study was supplied. Do we have a named source with a figure and a population?
2. "Most experts agree." Name the practitioner or standard, or the sentence stays out.
3. Training. What does "train staff" mean in Bramble: a checklist, a shadowed first count, a permission level? Without an answer it is a placeholder.

## Safety notes

Before you trust the output, check that every specific in the edited draft traces back to your input. The change log makes this quick, but the prompt's refusal to fabricate is only as strong as your review: a model asked to make writing sound more human will reach for a customer story or a percentage if you do not stop it, and an invented internal measurement is far more damaging in a published page than the bland sentence it replaced. Also confirm the locked elements came back intact; links and headings are the things most often dropped in a rewrite.

The prompt makes no claim about AI-detection scores, and it should not be used as a way to reach one. It also does not verify anything. If the original draft was wrong about a fact, the edited draft will be wrong about it more fluently, which is worse. Fact-checking is a separate pass with a source in front of you.

## FAQ

### Will this make the draft pass an AI detector?

That is not what it does, and no prompt should promise it. Detection tools misclassify in both directions: heavily human-edited work gets flagged, and lightly touched machine text passes. Treating a detector score as an acceptance test pushes you toward writing that scores well rather than reads well. Edit for the reader and let the score be whatever it is.

### Why does it leave vague sentences in the draft instead of fixing them?

Because the only real fix for a vague claim is a fact, and inventing one is the failure this prompt exists to prevent. Flagging the sentence hands the decision to someone who can answer it, which is usually a five-minute question to a colleague. If you would rather the sentence disappear than sit in a gap list, tell the prompt to cut unresolvable claims instead of keeping them.

### When does this not help?

When the draft has no argument. Editing an argument-free page gives you a shorter argument-free page, and the change log will be mostly deletions with nothing replacing them. The same applies when the outline itself is wrong: if the page answers a question the reader did not ask, no amount of line editing fixes it, and you are better off returning to the brief. A "Needs a fact" list longer than the edited draft is the signal that the piece was written without the knowledge it required.

### Can I run it on a draft a person wrote?

Yes. The patterns it targets are not exclusive to machine output; the tricolon habit, hollow transitions and openers that clear the throat all show up in human first drafts. The one thing to adjust is `verified_facts`, which matters more here, because a human writer usually had specifics in mind that never made it onto the page.
