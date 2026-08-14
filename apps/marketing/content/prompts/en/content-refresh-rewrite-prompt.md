---
title: Content Refresh Prompt
description: Decide what to change on a page that has lost or never gained traffic - one diagnosis, the change list it implies, and an explicit list of what to leave alone.
category: optimization
useCase: Updating pages
outputFormat: Revision plan
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: content refresh prompt, seo content refresh, update old blog posts, content decay, republish old content, content refresh checklist, rewrite existing page seo
relatedSkill: content-refresh
relatedPrompts: seo-content-audit-prompt, humanize-ai-content-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are an SEO editor deciding what to change on a page that is already live,
and what to leave exactly as it is.

# Scope
Work only from the data supplied below. Do not invent positions, impressions,
clicks, publication dates, search volumes or competitor facts. If a number was
not given to you, write that it is unavailable. Never substitute 0 for a
figure you do not have.

# Inputs
Page URL, publish date, last substantive update, and full text: {{page_text}}
Query it is meant to serve, plus secondaries and market: {{target_query}}
Search Console history for this URL, if available: {{performance_history}}
What occupies page one for that query now, if you have it: {{serp_snapshot}}
What must not change on this page: {{change_constraints}}

# What to produce
A revision plan that names one diagnosis, lists only the changes that
diagnosis implies, and states what must be left untouched.

# Steps
1. Say what kind of page this currently is (definition, how-to, comparison,
   list, template, product page), judging from the body copy rather than the
   title or the URL.
2. Say what kind of page the target query wants: from the snapshot if you have
   one, otherwise from query wording alone, labelled as weaker evidence.
3. Choose exactly one diagnosis and give the evidence for it:
   - STALE: the type matches the intent and the page once performed; named
     facts, dates, prices or screenshots have aged.
   - NEVER MATCHED: the type does not match what the query wants, and no
     period in the history shows impressions it could have lost.
   - QUERY MOVED: the type matched what the query used to want, the history
     declines gradually rather than in one period, and today's results are a
     different page type or sub-intent.
   - NOT THE PAGE: nothing in the page text explains the loss. Name what to
     check instead: a sibling page competing for the query, a redirect or
     template change, or a sitewide movement.
4. Rule out the other three in one line each, citing the specific input that
   rules them out.
5. Write the change list for the chosen diagnosis only. STALE gets fact-level
   edits and keeps the structure. NEVER MATCHED gets a rebuild, or a
   recommendation to serve the intent elsewhere; do not dress a rebuild up as
   an edit. QUERY MOVED gets a re-scoping decision, including whether the old
   sub-intent still deserves its own URL. NOT THE PAGE gets no content changes.
6. List what to leave alone: the passages currently earning the impressions
   the page still has, plus everything named in the constraints. Mark which
   entries rest on supplied data and which are judgement.
7. Name the one measurable thing to watch afterwards, and what it would look
   like if the change did nothing.

# Output format
1. Diagnosis: one line with its evidence.
2. Ruled out: three lines.
3. Changes: a table, Section | Change | Why | Effort (S/M/L).
4. Leave alone: a list with one reason each.
5. What to watch afterwards.
6. Data you did not have, and what each piece would have settled.

# Quality checks before you answer
- Exactly one diagnosis is chosen, and each rejected one cites input evidence.
- No position, date, volume or competitor fact appears that was not supplied.
- With no history supplied, the plan states that STALE, NEVER MATCHED and
  QUERY MOVED cannot be separated from page text alone, and labels its reading
  provisional.
- The leave-alone list is non-empty unless the recommendation is a rebuild.
- No change is recommended whose only justification is that the page is old.

# When the input is thin
If the page text is truncated, plan only for the part you were given and name
the sections you could not see. With no history and no results snapshot, still
compare page type against query wording, label that as intent-only evidence,
and do not claim to know whether traffic was lost or never arrived. Absence of
history is not evidence of zero traffic.

# Boundaries
Do not promise rankings, traffic or a recovery timeline. Do not recommend a
keyword density or a repetition count. Do not recommend changing the published
date, adding an "updated" stamp, or reordering paragraphs when no fact on the
page has changed. Do not recommend deleting or consolidating a page when no
traffic history for it was supplied.
```

## Variables

### page_text
Required. The page URL, its publish date, the date of its last substantive edit, and the full visible body copy including headings. Strip navigation and footer.
Example: https://ridgelinehr.com/blog/pto-policy-template - published 2023-06-14, last substantive update 2024-02-20 - followed by the full article text

### target_query
Required. The query the page is meant to serve, plus any secondary queries and the market. This is what the page type gets judged against.
Example: Primary: pto policy template (US). Secondary: paid time off policy, how many pto days is standard

### performance_history
Optional. Search Console rows for this URL across at least two windows a year apart, and a recent query breakdown. The shape over time is what separates decay from never-arrived.
Example: 2025-02: 5,120 impressions, 388 clicks, avg position 6.4; 2026-07: 3,610 impressions, 74 clicks, avg position 17.9

### serp_snapshot
Optional. What is on page one for the primary query right now: titles, page types, and whether the deliverable sits above the fold. Paste what you saw, not what you assume.
Example: 4 of 10 results offer a downloadable file above the fold; one is a fill-in generator; one long-form explainer remains at position 5

### change_constraints
Optional. What the plan is not allowed to touch: URLs, claims that need legal sign-off, brand vocabulary, gating rules, design system limits.
Example: URL must stay - linked from onboarding email. No gated downloads. Anything reading as legal advice needs legal review.

## How to use

Paste the rendered body copy rather than CMS markup, and keep the headings, because page type is read from structure as much as from wording. The two dates matter more than they look: without a last-substantive-update date the model has nothing to anchor a STALE reading to, and it will reach for one anyway. For `performance_history`, export at least two non-adjacent windows about a year apart plus a recent query breakdown. A single 28-day export cannot distinguish a page that decayed from a page that never arrived, and that distinction is the whole point of this prompt.

Check the output at the "Ruled out" block first. If the three rejections cite reasons that do not appear anywhere in your input, the model picked a diagnosis it liked and reverse-engineered support for it. Rerun with the history quoted back at it. Then scan the change table for any row whose justification is the page's age. Those are the rows that turn a targeted revision into a rewrite.

The failure you will actually hit is a reflexive STALE. It is the diagnosis every refresh article trains a model to give, and it produces a satisfying list of small edits. The signature that contradicts it is impressions roughly holding while clicks collapse and average position slides over several periods; that is a match problem, not an aging problem. Also watch how the model reads the position column: Search Console averages position weighted by impressions, so a page-level average is not "where your keyword ranks", and a plan built on that misreading will target the wrong section.

If it returns NOT THE PAGE, do not treat that as a failed run. That branch exists because the most expensive refresh is the one performed on a page whose problem was a redirect, a sibling page competing for the same query, or a sitewide movement. It costs you one prompt to rule that out before anyone opens the CMS.

## Example input

```text
Page URL, publish date, last substantive update, and the full current text:
https://ridgelinehr.com/blog/pto-policy-template - published 2023-06-14,
last substantive update 2024-02-20. ~2,000 words. H1 "How to Write a PTO
Policy". Sections: why PTO policies matter (3 paragraphs); accrual vs lump
sum, with worked examples; how many PTO days is standard; a sample policy
rendered as an HTML table roughly 60% down the page; PTO laws by state
(reviewed 2024-02); FAQ.

Query or queries the page is meant to serve, and the market:
Primary: pto policy template (US). Secondary: paid time off policy, how many
pto days is standard.

Search Console history for this page, if available:
2025-02: 5,120 impressions, 388 clicks, avg position 6.4
2025-08: 4,780 impressions, 301 clicks, avg position 8.1
2026-02: 3,940 impressions, 122 clicks, avg position 13.7
2026-07: 3,610 impressions, 74 clicks, avg position 17.9
Query split, 2026-07: "pto policy template" 1,910 impr / 12 clicks / pos 22.4;
"how many pto days is standard" 980 impr / 41 clicks / pos 8.6;
"paid time off policy" 720 impr / 21 clicks / pos 14.2.

What currently occupies page one for the target query:
Positions 1-4 and 7 are template libraries or a fill-in generator with the
file or form above the fold (two offer .docx and Google Docs copies).
Position 5 is a long-form explainer. Position 6 is a law-firm page titled
"PTO laws by state, 2026". Positions 8-10 are HR vendor template pages.

What must not change on this page:
URL must stay - linked from onboarding email and the sales deck. No gated
downloads. Anything reading as legal advice needs legal review. Brand writes
"PTO", never "paid leave".
```

## Example output

**Diagnosis: QUERY MOVED.** Between 2025-02 and 2026-07 impressions fell 29% while clicks fell 81% (388 to 74) and average position slid 6.4 to 17.9 across four readings: a gradual decline, not a single-period drop. Five of the ten current page-one results put the asset above the fold; this page is an explainer with the sample policy buried about 60% down.

**Ruled out**

- STALE: the state-law section carries a 2024-02 review date, but "how many pto days is standard" still holds 8.6 here, so the body is not being read as aged.
- NEVER MATCHED: it held position 6.4 with 388 clicks in 2025-02. There was traffic to lose.
- NOT THE PAGE: the loss sorts by query, 22.4 for the template query while another on the same URL holds 8.6. A redirect or sitewide cause would not do that.

**Changes**

| Section | Change | Why | Effort |
| --- | --- | --- | --- |
| Above the fold | Lead with the template: ungated .docx plus a Google Docs copy link, then the existing sample-policy table verbatim as the preview | Five of ten page-one results deliver the asset there; ours sits behind ~1,200 words | M |
| Intro, 3 paragraphs on why PTO policies matter | Cut to two sentences | Material the searcher scrolls past to reach the file | S |
| H1 and title | Rewrite to lead with the deliverable: "PTO Policy Template (Word and Google Docs)" | "How to Write a PTO Policy" names an explainer; this will not be one | S |
| PTO laws by state, reviewed 2024-02 | Move to its own URL and link to it; this URL is unaffected | A second sub-intent a page-one competitor covers as a whole page; it needs legal review anyway | L, blocked on legal review |

**Leave alone**

- The "how many PTO days is standard" section: 980 impressions and 41 clicks at position 8.6 in 2026-07, the healthiest query on this URL. Do not shorten it or fold it into the intro. (From supplied data.)
- The accrual worked examples: they carry the standard-days section. No query data isolates them, so this is judgement, not measurement.
- The URL, the ungated delivery, and the word "PTO", per the constraints.

**What to watch afterwards**

Clicks and average position for "pto policy template" on this URL, with the same figures for "how many pto days is standard" as a regression check. Read no sooner than two full calendar months; a shorter window will not separate the change from normal movement. If the template query is still in the twenties and the second is unchanged, page type was not the constraint, and the option left is a separate template page.

**Data you did not have**

- No results snapshot for "how many pto days is standard", so whether that sub-intent is shifting too is unknown; that call rests on position history alone.
- No device or country split. If the click collapse is concentrated on one device, the fix may be presentation rather than page type. Unavailable, not zero.
- No internal link or backlink data, so consolidating with another page here could not be evaluated.

## Safety notes

Every fact-level edit in the plan is a draft, not a finding. A model told that a state-law section is dated will cheerfully produce a replacement from training data, complete with rates and effective dates that read exactly like the real ones. Verify each number, date and legal statement against a source you control before it ships, and check the leave-alone list against your own knowledge too. The model kept those sections because nothing in your input contradicted them, which is not the same as confirming they are correct.

The prompt does not claim the revision will recover anything. It orders work, names the evidence behind that order, and says what it could not determine. A QUERY MOVED diagnosis is a reading of the inputs at one moment: if your results snapshot is a week old, so is the diagnosis, and if you supplied no snapshot at all the diagnosis rests on query wording and history shape alone. The prompt is written to say that out loud rather than close the gap with an estimate.

## FAQ

### What if I have no Search Console history for the page?

The three content-side diagnoses partly collapse. You can still compare page type against what the query wants and get a usable read, and the prompt is written to label that as intent-only evidence. What you cannot do is tell a page that decayed from one that never arrived, because both look identical today. If the page is newer than your reporting window, remember that missing data is missing, not zero; a plan that treats an empty export as proof of failure is arguing from an absence.

### The page is obviously both stale and mismatched. Why force one diagnosis?

Because the fixes differ in size, order and who has to do them. Refreshing dated facts on a page whose type no longer matches the query produces an accurate page that still loses; rebuilding a page whose only problem is a dated price is a week of work for an edit. Forcing the choice makes the plan prioritise. Once the first fix has shipped and you have two months of readings, rerun the prompt with the new history. If the second diagnosis was real, it will still be there.

### Does updating the published date help?

The prompt refuses to recommend it, and so would I. Changing a date stamp without changing anything a reader would notice gives you no new evidence about whether the page works, and it destroys your own audit trail: next quarter you will not be able to tell which pages were genuinely revised. If the content changed, date the change. If it did not, there is nothing to date.

### When does this prompt not work well?

Three cases. Templated or programmatic pages, where the problem lives in the template and fixing one URL fixes nothing — audit the template instead. Pages losing traffic alongside the rest of the site, where the diagnosis is NOT THE PAGE and the real work is elsewhere. And pages whose target query has an ambiguous or mixed result set, where "what kind of page the query wants" has no single answer; there the prompt will pick one reading, and you should supply the snapshot and challenge it.
