---
title: Internal Linking Prompt
description: Produce an internal link plan for one page: anchor text, the sentence each link belongs in, and a flag for any pages that overlap so heavily they should be merged instead.
category: optimization
useCase: Site structure
outputFormat: Link plan
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: internal linking prompt, internal link building ai, anchor text prompt, seo internal links, internal linking strategy, site structure prompt, keyword cannibalization check
relatedSkill: internal-linking
relatedPrompts: topical-map-prompt, seo-content-audit-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are an editor placing internal links inside a page that is already written.

# Scope
Propose internal links from the page below to other pages on the same site.
Work only from the text given. Do not guess what a URL contains from its slug,
and do not report traffic, rankings, or link equity figures — none were
supplied. A link exists to move a reader who needs to move; a phrase matching a
keyword in a destination's title is not a reason to link.

# Inputs
Page receiving the links: {{target_page}}
Other pages on the site: {{candidate_pages}}
Who reads this page and what they are doing: {{reader_context}}
Links already on the page: {{existing_links}}
Most new links to propose: {{link_budget}}

# What to produce
A link plan: for each link, the anchor text, the sentence it sits in, its
section, and the reader question that makes it necessary there. Plus two lists
that matter as much — candidates you rejected, and any pair of pages that
overlap so heavily that linking them is the wrong fix.

# Steps
1. Read {{target_page}} section by section. For each section, write the
   question the reader described in {{reader_context}} has just formed: what
   they now want that this page will not give them. Some produce none. Say so;
   those get no link.
2. Match each question against {{candidate_pages}}. A candidate qualifies only
   if its description says it answers that question. If it is a slug or a bare
   title with no summary, mark it "not enough information to judge" and do not
   link it.
3. Write the sentence for each qualifying pair: quote the sentence the link
   attaches to, or draft a new one and mark it NEW. Anchor text is what a
   reader would click to get that answer — a noun phrase describing the
   destination, not its title pasted in, and not a term you want to rank for.
4. Before proposing a link, compare {{target_page}} against the candidate. If
   it answers a question a section of this page already answers, the two pages
   compete for the same reader. Do not link them. Put the pair in the overlap
   list, name the shared question, and say which page should own it and what
   happens to the other.
5. Drop proposals that duplicate {{existing_links}} or repeat a destination.
6. Cut to {{link_budget}}, keeping the links whose reader question is most
   urgent at that point. Everything cut goes in the rejected list with a
   reason. Order the survivors by position in the page.

# Output format
A table: Section | Reader question at this point | Anchor text | Destination |
Sentence, quoted or marked NEW. Include every section, even those with no link.
Then "Rejected candidates", with one-line reasons.
Then "Overlapping pages": the two URLs, the shared question, which page should
own it, and what has to happen to the other.
Then one line: links proposed against {{link_budget}}.

# Quality checks before you answer
- Every link states a reader question this page does not answer itself. If you
  cannot state it, delete the link.
- Every candidate appears exactly once: proposed, rejected, or overlapping.
- No two links share a destination, and none repeats {{existing_links}}.
- Every anchor reads naturally when its sentence is read aloud.
- Nothing describes the contents of a page whose summary you were not given.
- No ranking, traffic, or link equity claim appears anywhere.

# When the input is thin
If {{candidate_pages}} is URLs without summaries, say the plan cannot be built
from slugs and ask for one line per page. Do not infer what /blog/seo-basics
contains. If {{target_page}} is an outline rather than the text, propose
anchors but say the sentences are drafts written blind that must be refitted
to the real copy. If no candidate answers a question the page raises, say
there are no links to add: an empty plan is a valid answer.

# Boundaries
Do not promise rankings, traffic, or crawl improvements. Do not recommend links
per thousand words, a keyword density, or repeating an anchor to strengthen it.
Do not add links to reach the budget, invent URLs, or link outside
{{candidate_pages}}. When you flag an overlap, say what has to happen to the
losing page, but do not present it as measured: you have descriptions, not
query data.
```

## Variables

### target_page
Required. The URL and title of the page receiving links, plus its text. Paste the real copy if you have it; the plan is only as good as the sentences it can attach to.
Example: /guides/job-costing-for-electricians — "Job costing for electrical contractors", followed by the full draft

### candidate_pages
Required. One line per page: URL, title, and what question that page answers. Slugs alone force the model to guess, and it will.
Example: /blog/labor-burden-rate — "What is labor burden rate" — defines burden and walks a worked calculation of the true hourly cost of an employee

### reader_context
Required. Who lands on the target page and what they are trying to do. This decides whether a link is needed at a given point rather than merely available.
Example: Electrical contractors with 3 to 15 employees who already quote jobs but cannot tell which finished jobs made money

### existing_links
Optional. Internal links already on the page, including the ones in your sitewide navigation and footer. Without these, the plan proposes links the reader already has.
Example: /features/time-tracking (in the intro), /pricing (in the footer)

### link_budget
Optional. The most new links you are willing to add. Left out, the model tends to fill every section whether or not the reader needs it.
Example: 6 new links

## How to use

Spend your effort on `candidate_pages`. A list of bare URLs produces a confident, useless plan, because the model reads the slug and invents what the page contains — `/blog/margin-vs-markup` becomes "explains how to set margin on electrical work" and the link goes in. One line per page describing the question that page answers is the difference between a plan you hand to an editor and a plan you verify link by link. If your site is large, do not paste the whole sitemap; paste the twenty or thirty pages in the same topic area, since those are the only ones a reader would move to anyway.

Read the output in an order that feels backwards. Start with the overlapping pages list, then the rejected candidates, then the table. The overlap list is the part people skip, because it turns a linking task into a content decision nobody scheduled — but "these two pages answer the same question, and linking them just hands the reader a near-duplicate" is worth more than five well-placed anchors. When that list comes back empty on a mature site, it usually means the descriptions you supplied were too vague to compare, not that nothing overlaps.

The failure you will actually hit in the table is a link placed where the phrase appears rather than where the question forms. It is easy to miss because the sentence reads fine. Cover the destination column and read only the section and the reader question: if the question is one the section itself answers two sentences later, the link is premature and the reader bounces back. The second failure is anchor text that is the destination's title pasted in, five times down the page, which reads like a directory rather than an argument.

When a section comes back wrong, rerun that section alone — paste back the section text, the candidates you still consider live, and what was wrong with the proposal. Regenerating the whole page reshuffles placements you had already accepted, and you lose the reconciliation against `existing_links` with it.

## Example input

```text
Page receiving the links: /guides/job-costing-for-electricians — "Job costing for electrical contractors". Full draft:

[H2] The jobs that surprise you
Most contractors can tell you what a job quoted at. Far fewer can tell you what it finished at, which is why a busy quarter and a profitable quarter are not the same quarter.

[H2] What a job cost actually includes
A job cost is labour, materials, subcontractors, and a share of overhead. The number most contractors get wrong is labour, because they use the wage rate rather than what the hour actually costs.

[H2] Getting hours onto the right job
Hours written on a paper sheet at the end of the week are a guess. The fix is capture at the point of work, on the job the crew is standing on.

[H2] Materials, including the ones nobody logs
Materials booked to a job are the ones that came off the purchase order. The ones that came off the van are the ones that quietly eat the margin.

[H2] Allocating overhead
Rent, vans, insurance, and the phone that rings all day belong on jobs somehow. Pick a method, apply it to every job, and stop arguing about it.

[H2] Reading the finished-job report
A finished-job report is only useful if you look at it while you still remember the job.

[H2] Changing the next quote
Job costing that does not change the next quote is bookkeeping.

Other pages on the site:
/guides/how-to-price-an-electrical-job — "How to price an electrical job" — builds a quote from labour, materials, and target margin
/blog/labor-burden-rate — "What is labor burden rate" — defines burden and walks a worked calculation of the true hourly cost of an employee
/guides/job-costing-explained — "Job costing explained" — general introduction to what job costing is and why contractors do it
/features/time-tracking — product page for crew time tracking against a job
/blog/change-order-template — "Change order template for contractors" — free template plus how to document scope added on site
/blog/quickbooks-job-costing-limits — "Where QuickBooks job costing falls short" — what the built-in job costing does and does not count
/guides/estimating-materials — "Estimating materials on an electrical job" — the takeoff process before the job starts
/blog/margin-vs-markup

Who reads the target page and what they are doing: electrical contractors with 3 to 15 employees who already quote jobs but cannot tell which finished jobs made money; most arrive from a search about job costing and read on a phone

Links already on the page: /features/time-tracking (in the intro), /pricing (in the footer)

Most new links to propose: 6
```

## Example output

**Link plan — /guides/job-costing-for-electricians**

| Section | Reader question at this point | Anchor text | Destination | Sentence |
| --- | --- | --- | --- | --- |
| The jobs that surprise you | None yet. The reader is being told they have a problem, not asked to act. | — | — | No link. |
| What a job cost actually includes | "What does an hour of my crew actually cost?" | what the hour actually costs | /blog/labor-burden-rate | Existing: "...the wage rate rather than **what the hour actually costs**." |
| Getting hours onto the right job | "How do I capture hours at the point of work?" | — | — | /features/time-tracking answers it but is already linked in the intro. See rejected. |
| Materials, including the ones nobody logs | "How do I get the material list right before the job starts?" | estimating materials before the job starts | /guides/estimating-materials | NEW: "That gap narrows when the takeoff was done properly, which is its own discipline: **estimating materials before the job starts**." |
| Materials, including the ones nobody logs | "Two circuits were added on site. Where does that cost land?" | documents it as a change order | /blog/change-order-template | NEW: "Scope added on site reaches the job cost only if somebody **documents it as a change order**." |
| Allocating overhead | "How much of my rent belongs on this job?" | — | — | No candidate answers this. Content gap, not a link gap. |
| Reading the finished-job report | "My accounting software claims to do this. Why doesn't it reconcile?" | where QuickBooks job costing stops short | /blog/quickbooks-job-costing-limits | NEW: "If the report comes out of accounting software, check what it counts first: **where QuickBooks job costing stops short**." |
| Changing the next quote | "How do I get these numbers into the next quote?" | price the next electrical job | /guides/how-to-price-an-electrical-job | NEW: "Carry the burden rate and material variance from your last three jobs into how you **price the next electrical job**." |

**Rejected candidates**

- /features/time-tracking — already linked from the intro. If that link is doing less work than one in "Getting hours onto the right job" would, move it rather than add a second.
- /blog/margin-vs-markup — no description supplied, so whether it answers the question in "Changing the next quote" cannot be judged. Send a summary line and it can be reconsidered.
- /guides/job-costing-explained — not rejected on merit; see overlap.

**Overlapping pages**

- /guides/job-costing-explained and /guides/job-costing-for-electricians both answer "what is job costing and why should a contractor do it". Linking them sends the reader to a vaguer version of the section they are already reading. The electrician page should own the question: it has the audience, the worked detail, and the next step. Merge the general page into it and redirect, or narrow it to a question this page does not answer. Confirm against real query data before redirecting anything.

**5 links proposed against a budget of 6.** No remaining section raised a question a candidate answers.

## Safety notes

A reviewer has to open every destination and confirm it says what the summary claimed, because the model never sees those pages — it trusts your one-line description completely. The failure is quiet: a link to `/blog/labor-burden-rate` looks correct in the plan and lands on a stub that defines the term without the calculation the reader came for. Read the NEW sentences aloud inside the paragraph too; they arrive in a generic register and usually need a rewrite to sound like the rest of the page.

The overlap flag is a hypothesis, not a measurement. It is derived from descriptions you wrote, not from query data or how the two URLs actually behave, so treat it as a reason to go and look rather than grounds to delete a page. Nothing in the output claims a link will improve rankings, crawling, or traffic; no such data was supplied, and the prompt is instructed to leave numbers out rather than estimate them.

## FAQ

### Why did it refuse to link a page that is obviously about the same subject?

Because same subject and same question are different things. If a candidate answers a question your page already answers, a link there sends the reader sideways into a near-duplicate, and you now have two pages competing to be the answer. The prompt is written to stop, name the question both pages answer, and say which one should own it. That is usually the most useful line in the output, and the one people argue with.

### How many internal links should the page end up with?

There is no correct number, which is why the prompt takes a budget from you instead of proposing one. Link counts and links-per-word ratios are downstream of how many questions the page genuinely raises: a short definition page might raise one, a long guide six or seven. Set the budget from your editorial tolerance, and treat an unused budget as a good sign rather than a gap to fill.

### Does it know about my navigation and footer links?

Only if you put them in `existing_links`. The model sees the page text you paste, and body copy rarely includes the sitewide nav, so it will happily propose a body link to a page that already sits in your main menu on every page of the site. Listing the nav and footer destinations up front is the cheapest improvement you can make to the output.

### When does this prompt not work well?

Three cases. Programmatic pages built from a template, where links are generated by rules rather than written into sentences. Very large sites, where you cannot paste a meaningful candidate list and the useful unit of work is a crawl-based link graph rather than one page at a time. And the reverse direction — finding which existing pages should link to a page you just published — which this prompt does not do; you would run it once per source page, which is slow enough that a crawl report is the better tool.
