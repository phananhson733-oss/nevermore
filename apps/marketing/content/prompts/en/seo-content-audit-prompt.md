---
title: Content Audit Prompt
description: Sort an existing set of pages into keep, update, consolidate or retire, with a reason, a next action, and a named destination for every URL that comes down.
category: optimization
useCase: Portfolio review
outputFormat: Decision table
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: content audit prompt, seo content audit, content inventory template, content pruning seo, keep update consolidate retire, content consolidation, audit old blog posts
relatedSkill: seo-audit
relatedPrompts: content-refresh-rewrite-prompt, internal-linking-suggestions-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are a content strategist sorting existing pages into decisions an owner can
act on.

# Scope
Judge only the pages listed below, from only the fields supplied. Do not invent
clicks, impressions, positions, backlinks, conversion rates or dates. A blank,
missing or "not in export" field is unknown: not zero, and you may not reason as
though it were. Where a verdict turns on a number you lack, give it anyway and
mark it provisional.

# Inputs
What the site sells and who the pages are for: {{site_context}}
Page inventory, one page per line, whatever fields exist: {{page_inventory}}
Where the numbers came from and the period they cover: {{metrics_source}}
Pages that stay live regardless of performance: {{must_keep_pages}}
What this team can do with a removed URL: {{retirement_policy}}

# What to produce
One row per URL with exactly one verdict — keep, update, consolidate or retire
— plus the reason, the next action, and the URL's destination if it leaves the
index.

# Steps
1. Restate each page as the job it does for one reader: the question it answers
   and who is asking. Read that from the title, description or page type
   supplied. If a row is a bare URL, write "job unknown from slug" rather than
   guessing from the path.
2. Group pages whose jobs are the same or nested. Overlap is judged between
   named URLs, never in the abstract.
3. Resolve every group of two or more: name the page that survives and
   consolidate the others into it, or write one line per surviving page saying
   what it does that the others do not. No group ends undecided.
4. Assign one verdict per URL:
   - keep: the job is real, this page holds it, nothing is queued.
   - update: the job is real and this page holds it, but something has expired
     — a year in the title, a price, a product behaviour, an unsupportable
     claim.
   - consolidate: another named URL does the same job better.
   - retire: you cannot name a reader who needs this page, or its job belongs
     to an audience {{site_context}} says the site does not serve. A page you
     cannot argue for is a retire, not a keep; "recent", "long" and "well
     written" are not jobs. If the only argument for keeping it is that removal
     feels risky, say so and still write retire.
   A page in {{must_keep_pages}} is a keep; say the verdict came from that
   constraint, not its row.
5. Give every consolidate and retire row a URL disposition: a 301 to a named
   URL doing the same job, or a deliberate 410 when no page does. Do not use
   the homepage or a section index to avoid choosing — if nothing matches, 410
   is the answer. Respect {{retirement_policy}}; flag any row it cannot
   accommodate.
6. Mark each row confirmed or provisional. A provisional row names the exact
   figure that would settle it and its source.

# Output format
A table: URL | Verdict | Basis (confirmed/provisional) | Reason | Next action |
URL disposition. Then the overlap groups with their one-line resolutions, then
the missing data by field and which verdicts depend on it.

# Quality checks before you answer
- Every URL in the inventory appears exactly once, with exactly one verdict.
- No cell shows 0 for a figure that was not supplied; unknown reads unknown.
- Every consolidate and retire row names a 301 target or an explicit 410.
- Every overlap group ends in a consolidation or a written reason each page
  survives.
- Each reason cites a field from that row or a named other URL.

# When the input is thin
With no performance data, sort on job and overlap anyway, mark every
traffic-dependent verdict provisional, and name the export that would settle
those rows. If rows are URLs alone, say overlap cannot be judged from slugs and
ask for titles. Never estimate a missing figure or read a missing row as zero.

# Boundaries
Do not promise what any verdict will do to traffic, rankings or revenue. Do not
score pages or the site. Do not recommend a keyword count or density. Do not
remove a URL without a disposition. Do not upgrade a provisional verdict by
guessing.
```

## Variables

### site_context

Required. What the site sells, who the pages are for, and what a reader is meant to do next. This is what a retire verdict is argued against, so vague input here produces timid verdicts.
Example: Cadence Fieldworks sells scheduling software to independent US HVAC contractors with 3-20 technicians; the blog reaches owners still running the schedule on a whiteboard

### page_inventory

Required. One page per line. Include whatever you actually have: URL, title, page type, published date, last updated, clicks, impressions. Leave a field blank or write "not in export" rather than filling it with a zero.
Example: /blog/hvac-scheduling-software | Best HVAC Scheduling Software in 2024 | listicle | 2024-02-11 | 412 clicks | 18,300 impressions

### metrics_source

Optional. Where the numbers came from and the exact period they cover, so the model can tell a page that underperformed from a page published halfway through the window.
Example: Search Console, sc-domain property, clicks and impressions for 2025-08-01 to 2026-07-31

### must_keep_pages

Optional. URLs that stay live whatever the data says, with the reason. Sales collateral, compliance pages and anything linked from inside the product belong here.
Example: /blog/hvac-invoice-template — sales sends it on first calls

### retirement_policy

Optional. What the team can actually do to a removed URL, and how long each option takes. Without it the plan may assume redirects nobody can ship.
Example: 301s are self-serve in the CMS; a 410 needs an engineering ticket, about a week

## How to use

Fill `site_context` before anything else, and make it a sentence about a buyer rather than a description of the company. Every retire verdict is an argument that no reader in that sentence needs the page, so "we sell field service software" produces hedging while "owners with 3-20 technicians who schedule on a whiteboard" produces decisions. Then paste the inventory exactly as your export gives it to you. The prompt does not need a fixed column order and will work from titles alone, at a stated cost in confidence.

The failure to watch for is the export that silently truncated. Search Console caps a UI export at 1,000 rows, so a large blog will hand you a file where the tail of the site simply is not present. If you paste that file and say nothing, every missing page looks like a page with no impressions, and the audit will retire a chunk of your site on evidence that does not exist. Mark those rows "not in export" and fill in `metrics_source` with the real period; the prompt then returns them as provisional with an instruction to check indexation rather than as a verdict.

Read the output by column, not by row. Scan Basis first and count the provisional rows: if most of the table is provisional, the audit is telling you to go and get data, not to start deleting. Then scan URL disposition and reject any row that says "redirect to homepage", "delete" or "remove" — those are the rows where the model dodged the decision, and rerunning just those URLs with the retirement policy restated usually fixes it. Finally check that each overlap group ended in either a consolidation or a written reason both pages survive; a group left unresolved is the specific thing this prompt exists to prevent.

For inventories past roughly 150 pages, split them into batches by topic rather than alphabetically. Overlap is only detected inside a batch, so an alphabetical split separates exactly the pages you needed compared side by side.

## Example input

```text
What the site sells and who the pages are for: Cadence Fieldworks sells scheduling
and dispatch software to independent HVAC contractors in the US with 3 to 20
technicians. The blog exists to reach owners who currently run the schedule on a
whiteboard and a phone. The conversion is a 14-day trial started from the site.

Page inventory (URL | title | type | published | last updated | clicks | impressions):
/blog/hvac-scheduling-software | Best HVAC Scheduling Software in 2024 | listicle | 2024-02-11 | 2024-02-11 | 412 | 18,300
/blog/hvac-dispatch-software | HVAC Dispatch Software Compared | listicle | 2026-06-03 | — | 96 | 5,120
/blog/how-to-schedule-hvac-technicians | How to Schedule HVAC Technicians | how-to | 2023-09-20 | 2026-01-14 | 1,240 | 44,900
/blog/hvac-industry-statistics-2023 | 47 HVAC Industry Statistics for 2023 | stats | 2023-01-08 | — | 610 | 61,200
/blog/holiday-party-2022 | Our 2022 Holiday Party | news | 2022-12-20 | — | not in export | not in export
/blog/what-is-dispatch-software | What Is Dispatch Software? | definition | 2025-05-30 | — | not in export | not in export
/blog/hvac-technician-pay-guide | HVAC Technician Pay Guide | guide | 2025-03-18 | — | 2,180 | 96,400
/blog/servicetitan-alternatives | ServiceTitan Alternatives | comparison | 2026-01-22 | — | 340 | 12,700
/blog/hvac-invoice-template | Free HVAC Invoice Template | template | 2024-08-09 | — | 1,905 | 52,800
/blog/summer-ac-maintenance-checklist | Summer AC Maintenance Checklist | checklist | 2023-06-01 | — | 44 | 9,800

Where the numbers came from: Search Console, sc-domain property, clicks and
impressions for 2025-08-01 to 2026-07-31. Pages with no row in the export are
marked "not in export".

Pages that stay live regardless: /blog/hvac-invoice-template — sales sends it to
prospects on the first call.

What we can do with a removed URL: 301s are self-serve in the CMS. A 410 needs an
engineering ticket, about a week. We do not want redirects that land a reader on a
page about a different subject.
```

## Example output

| URL | Verdict | Basis | Reason | Next action | URL disposition |
| --- | --- | --- | --- | --- | --- |
| /blog/hvac-scheduling-software | Update | Confirmed | Strongest page in the software-choice group at 412 clicks, but the title and framing are dated 2024 | Refresh the roundup, absorb the entries only covered by /blog/hvac-dispatch-software, drop the year from the title | Stays live, URL unchanged |
| /blog/hvac-dispatch-software | Consolidate | Confirmed | Same job as /blog/hvac-scheduling-software: an owner choosing software. Published 2026-06-03, so its 96 clicks cover two months of a twelve-month window and are not comparable | Move its unique vendor entries into the scheduling roundup, then redirect | 301 to /blog/hvac-scheduling-software |
| /blog/how-to-schedule-hvac-technicians | Keep | Confirmed | Distinct job — running the schedule, not buying software. Updated 2026-01-14, 1,240 clicks | None | Stays live |
| /blog/hvac-industry-statistics-2023 | Update | Confirmed | 61,200 impressions against a title and URL stamped 2023 | Rewrite with current figures and retitle. Leave the URL alone; changing it costs the page its history for no gain | Stays live, URL unchanged |
| /blog/holiday-party-2022 | Retire | Confirmed | No reader described in site context needs it, and no other page does this job | Check referring domains first; the 410 needs an engineering ticket under the stated policy | 410 |
| /blog/what-is-dispatch-software | Update | Provisional | Absent from the export. A missing row can mean no impressions or an export truncated at the row limit; those need different actions | Inspect the URL in Search Console, pull a page-filtered export for this path, then rerun this row | Stays live pending that check |
| /blog/hvac-technician-pay-guide | Keep | Confirmed | Largest impression source at 96,400. It serves technicians rather than the owner in site context, but nothing here says what it produces | None from this audit. Whether it earns its place commercially is a conversion question this inventory cannot answer | Stays live |
| /blog/servicetitan-alternatives | Keep | Confirmed | Overlaps the software-choice group but survives: this reader has already chosen a named competitor and wants a like-for-like swap, which the roundup does not give | Link it from /blog/hvac-scheduling-software | Stays live |
| /blog/hvac-invoice-template | Keep | Confirmed by constraint | Listed in must-keep for sales use. Its 1,905 clicks support the same verdict independently | None | Stays live |
| /blog/summer-ac-maintenance-checklist | Retire | Provisional | Written for technicians, not the owner in site context, and 44 clicks against 9,800 impressions across the full window | Before removing, check whether this URL assists any trial signups — a figure not in this inventory that would flip the verdict to keep | 410 — nothing here does seasonal maintenance advice, and sending a technician to the owner-facing how-to is the mismatch the policy rules out |

**Overlap groups**

- Software choice: /blog/hvac-scheduling-software survives; /blog/hvac-dispatch-software folds into it; /blog/servicetitan-alternatives survives separately because it serves a reader who has already chosen a competitor.
- No other group. The remaining six pages hold distinct jobs.

**Missing data, by field**

- Trial signups per URL: absent for all ten rows. Two verdicts depend on it — the keep on /blog/hvac-technician-pay-guide and the retire on /blog/summer-ac-maintenance-checklist.
- Referring domains: absent. Affects the disposition of /blog/holiday-party-2022, not its verdict.
- Export rows for /blog/what-is-dispatch-software and /blog/holiday-party-2022: absent, treated as unknown throughout, never as zero.
- Last-updated dates: supplied for two of ten pages; staleness for the rest was read from published date and title only.

## Safety notes

Before executing any retire row, check the two things this prompt cannot see: whether the URL has referring domains, and whether anyone inside the company links to it from a proposal, an onboarding email, a help article or an ad. An audit works from the inventory you pasted, and a page with no search traffic can still be load-bearing somewhere the export does not reach. The same applies to consolidations — confirm the 301 target genuinely answers the question the folded page answered, because a redirect into a page about something adjacent moves the reader nowhere useful.

The output makes no claim about what any verdict will do to traffic, rankings or revenue, and it does not score pages. It says which pages have a job, which have expired, which duplicate each other, and where each removed URL should point. Rows marked provisional are decisions the input could not support; they are listed with the exact figure that would settle them so you can go and get it rather than treat the verdict as final.

## FAQ

### How do I choose between update and consolidate when two pages overlap?

Ask whether a reader arriving at either page wants the same thing. If yes, that is one page, and the weaker URL should fold into the stronger one. If the two readers differ in what they already know — one is choosing among vendors, one has already chosen and wants a replacement for it — they are separate jobs, and the fix is to update each and link them. The prompt forces you to write that distinction down for every group, which is where most of the value is.

### Half my pages had no row in the Search Console export. Are they dead?

You cannot tell from the export, and the prompt will not pretend otherwise. A missing row means the page had no impressions in the period, or the page is not indexed, or your export hit the row cap and the page fell off the bottom. Those need three different responses, so the audit returns those pages as provisional with an instruction to inspect the URL directly. Treating a missing row as zero traffic is how sites delete pages that were working.

### Is a 410 ever better than a 301?

Yes, when nothing on the site does the removed page's job. A 301 into an unrelated page is a poor experience for the reader who clicked, and search engines commonly treat an irrelevant redirect as a soft 404 anyway, so you take the cost of the redirect without the benefit. Redirect when a real equivalent exists; return 410 when it does not and you have accepted that the page is gone.

### When is this prompt the wrong tool?

Two cases. If your inventory is URLs with no titles, types or descriptions, overlap cannot be judged — a slug is not a description of a page, and the audit will correctly refuse to guess. And if the pages are programmatic at scale, thousands of location or product-attribute URLs, a per-URL decision table is unusable; audit the template and the rules that generate the set instead, then apply one decision to each pattern.
