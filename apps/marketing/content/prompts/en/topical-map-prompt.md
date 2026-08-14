---
title: Topical Map Prompt
description: Turn a subject into a hierarchy of pillar and supporting pages with internal links, an explicit out-of-scope list, and a page count that fits what your team can publish.
category: research
useCase: Site planning
outputFormat: Hierarchy
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: topical map prompt, topical authority map, pillar page planning, seo site structure prompt, content hub structure, internal linking plan
relatedSkill: keyword-research
relatedPrompts: seo-keyword-clustering-prompt, search-intent-classification-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are a site planner building a topical map that a small team can actually publish.

# Scope
Plan pages for the subject below. Do not invent search volumes, difficulty
scores, traffic figures, or competitor counts. If a number was not given to
you, leave it out rather than estimating it. A map that lists more pages than
the team can publish, or pages the team cannot write from first-hand
knowledge, is a failed map.

# Inputs
Subject to map: {{subject}}
What the business sells and to whom: {{business_offer}}
What this team can speak about first-hand: {{credibility_basis}}
Pages the team can publish this planning window: {{page_budget}}
Pages that already exist, if any: {{existing_pages}}

# What to produce
A hierarchy of pillar pages and supporting pages, the internal links between
them, an explicit out-of-scope list, and a list of pages that are worth
writing but that this team cannot currently write credibly. The map must fit
inside the page budget. Cutting is part of the job, not a failure of it.

# Steps
1. List the questions a buyer described in {{business_offer}} works through,
   from first awareness to the decision to buy. Work from the subject and the
   buyer, not from keyword patterns.
2. Group those questions into pillars. A pillar is broad enough to introduce a
   whole area and narrow enough that one writer can finish it. Three to five
   pillars is normal; more than that usually means the subject was too wide to
   map in one pass, and you should say so.
3. Under each pillar, list supporting pages. Each must answer one question
   completely. If two would say most of the same thing, merge them.
4. Test every page against {{credibility_basis}}. Name the specific source —
   the data set, the practitioner, the process — that qualifies this team to
   publish it. A page with no named source does not go in the map. It goes in
   the cannot-publish-credibly list, with the evidence that would unlock it.
5. Cut the map down to {{page_budget}}. Keep the pages closest to the buying
   decision and closest to the credibility base. Move everything you cut into
   the out-of-scope list with a one-line reason. Never drop a topic silently.
6. Reconcile against {{existing_pages}}: mark each planned page as new, as an
   update to a page that already covers the same ground, or as a merge target.
7. Assign internal links. Every pillar links down to its supporting pages and
   every supporting page links up to its pillar. Add sibling links only where a
   reader would genuinely move between those two pages.

# Output format
A nested list. Each pillar with its URL slug, page intent, credibility source,
and new/update/merge status; its supporting pages indented under it with the
same four fields. Then the internal link plan, a table of out-of-scope topics
with reasons, the cannot-publish-credibly list, and one line giving planned
pages against the budget.

# Quality checks before you answer
- The planned page count is at or under {{page_budget}}, and you state both.
- Every page names a specific source from {{credibility_basis}}. None of them
  says "general industry knowledge" or "our expertise".
- Every topic you considered and cut appears in the out-of-scope list.
- No two supporting pages answer the same question.
- Every page has at least one internal link in and one internal link out.
- No search volume, keyword difficulty, or traffic figure appears anywhere.

# When the input is thin
If {{credibility_basis}} is empty or generic, say so and stop before assigning
pages: a map built on unstated expertise is guesswork dressed as a plan. If
{{page_budget}} is missing, ask for it instead of assuming a number. If the
subject is too broad for the budget, map one slice, name it, and say plainly
which parts of the subject you left unmapped.

# Boundaries
Do not promise rankings, traffic, or timelines. Do not recommend a keyword
density or a number of repetitions. Do not pad the map to reach a round number
of pages. Do not plan pages that give regulated advice — medical, legal,
financial, or safety-critical — unless {{credibility_basis}} names a qualified
reviewer who will sign them off.
```

## Variables

### subject
Required. The area you want to own, stated as a subject rather than a keyword. Narrow enough that a reader would recognise it as one field of knowledge.
Example: Cold chain temperature monitoring for food and pharmaceutical shipments

### business_offer
Required. What the business sells and who buys it. This decides which questions are worth a page and which belong to somebody else's funnel.
Example: Bluetooth and single-use temperature data loggers plus a shipment dashboard, sold to QA and logistics managers at mid-size food and pharma distributors

### credibility_basis
Required. The concrete sources of first-hand knowledge: named data sets, named practitioners, owned processes. Vague entries here produce a vague map, which is the single most common failure.
Example: In-house ISO 17025 calibration lab; anonymised temperature traces from about 12,000 customer shipments; a QA lead who was a GDP-responsible person for six years

### page_budget
Required. How many pages the team can genuinely publish in this planning window, and with whom. The number is what forces the map to stop.
Example: 14 pages over two quarters, one writer plus one part-time QA reviewer

### existing_pages
Optional. Slugs and titles of pages already live, so the model can tell a new page from an update or a merge.
Example: /blog/what-is-cold-chain; /docs/calibration-certificates

## How to use

Fill all five placeholders, but spend your effort on `credibility_basis`. It is the variable that changes the output. "We know the industry well" produces a map indistinguishable from a competitor's, because the model has nothing to filter against; "an ISO 17025 lab, 12,000 shipment traces, and a QA lead who was a GDP-responsible person" produces a map where three or four pages exist that nobody else can write. List the artefacts, not the adjectives.

Read the output bottom-up. Check the page count line first, then the out-of-scope list. The failure you will actually hit is a map that respects the budget in its headline count while quietly exceeding it — usually by nesting a third level of sub-supporting pages under the supporting pages, or by listing "FAQ hub" as one page when it is eleven. Count the leaf entries yourself. The second failure is an out-of-scope list with two entries on it, which means the model never generated enough candidates to have to cut anything; rerun with the budget halved and see what it sacrifices, then restore the budget knowing which pages it ranks lowest.

When a pillar comes back wrong, rerun that pillar alone rather than the whole map. Paste back the pillar and its supporting pages, say what is wrong — too broad, overlapping with the pillar above, no credibility source — and ask for that branch only. Regenerating the full map reshuffles branches you had already accepted, and you lose the reconciliation against your existing pages along with it.

Treat the cannot-publish-credibly list as a work item, not a rejection. Each entry names the evidence that would unlock the page: a reviewer, a data set, a customer who will go on record. Some of those are a week of work, and the page becomes the strongest one on the site.

## Example input

```text
Subject to map: cold chain temperature monitoring for food and pharmaceutical shipments
What the business sells and to whom: Thermalog sells Bluetooth and single-use temperature data loggers plus a shipment dashboard, to QA and logistics managers at mid-size food and pharma distributors in the EU and US
What this team can speak about first-hand: nine years of logger manufacturing; an in-house ISO 17025 calibration lab; anonymised temperature traces from about 12,000 customer shipments; a QA lead who spent six years as a GDP-responsible person at a pharma wholesaler
Pages the team can publish this planning window: 14 pages over two quarters, one writer plus one part-time QA reviewer
Pages that already exist: /products/bluetooth-logger; /blog/what-is-cold-chain; /docs/calibration-certificates
```

## Example output

**Topical map — cold chain temperature monitoring**

- **/cold-chain-monitoring** — pillar. What a monitoring programme contains end to end. Source: 12,000-shipment trace archive. *Update* — absorbs and redirects /blog/what-is-cold-chain.
  - /cold-chain-monitoring/choosing-a-data-logger — decision guide by shipment type and duration. Source: nine years of manufacturing. *New*
  - /cold-chain-monitoring/logger-placement — where loggers go in a pallet, reefer, or parcel. Source: trace archive, placement against recorded excursions. *New*
  - /cold-chain-monitoring/single-use-vs-reusable — cost and handling trade-off. Source: own product line unit economics. *New*
- **/temperature-excursions** — pillar. What an excursion is and what has to happen next. Source: QA lead. *New*
  - /temperature-excursions/investigation-checklist — the steps a QA team runs after an alert. Source: QA lead. *New*
  - /temperature-excursions/mean-kinetic-temperature — worked calculation from real traces. Source: calibration lab, trace archive. *New*
  - /temperature-excursions/alarm-thresholds — setting thresholds that do not drown the team in alerts. Source: trace archive, false-alarm rates by threshold. *New*
- **/calibration** — pillar. What calibration means for a temperature logger. Source: ISO 17025 lab. *New*
  - /calibration/reading-a-certificate — field by field. *Merge* — /docs/calibration-certificates already covers this; expand it rather than publish a second page.
  - /calibration/recalibration-intervals — how often, and how to justify the interval. Source: lab drift records. *New*
  - /calibration/in-house-verification — ice-point and reference checks between lab visits. Source: ISO 17025 lab. *New*
- **/lane-qualification** — pillar. Proving a shipping lane holds temperature. Source: QA lead, trace archive. *New*
  - /lane-qualification/seasonal-profiling — why a summer run and a winter run are different studies. Source: trace archive. *New*
  - /lane-qualification/mapping-protocol — how to write the protocol before you ship. Source: QA lead. *New*

**Internal links.** Each pillar links down to its own supporting pages; each supporting page links up to its pillar. Cross-links: choosing-a-data-logger → /products/bluetooth-logger (existing, no new page); alarm-thresholds → logger-placement (a threshold problem is often a placement problem); reading-a-certificate ↔ recalibration-intervals.

**Out of scope**

| Topic | Reason |
| --- | --- |
| EU GDP compliance guidance | Regulated advice. The team can describe requirements but not interpret them for a reader's operation. |
| Refrigeration unit selection and repair | No first-hand basis. Thermalog builds loggers, not reefers. |
| Customs and import documentation | Sits outside the buying decision for a logger. |
| Writing a HACCP plan | Adjacent subject, different buyer, different service. |
| "Best cold chain monitoring software" | Thermalog would be ranking itself. The page cannot be neutral. |

**Worth writing, not credible yet**

- Releasing a shipment after an excursion — a QA release decision. Unlocks when the GDP-responsible QA lead reviews it and the page publishes decision criteria rather than a verdict.
- Preparing for a GDP inspection — unlocks with a named co-author who has worked the auditor side.

**Budget: 14 planned against 14 available.** Two topics deferred, five out of scope.

## Safety notes

A reviewer has to verify the credibility claims, because the prompt cannot. The model accepts whatever you typed into `credibility_basis` as true and attaches those sources to pages; if the trace archive is 300 shipments rather than 12,000, or the QA lead left last quarter, the map will still cite them confidently. Check every named source against reality before a writer starts, and check that no page in the map quietly gives regulated advice under a general-interest title.

The map is a publishing plan, not a forecast. It contains no search volumes, no difficulty scores, and no claim that any page will rank or attract traffic — those numbers were not in the input, so the prompt is instructed to leave them out rather than estimate them. If you need opportunity data to sequence the build, bring it from a keyword tool and order the map afterwards.

## FAQ

### How many pillars should a map have?

Three to five for one planning window. Two usually means the pillars are really one subject split arbitrarily. Six or more means the subject was too broad to map in a single pass, and the honest move is to pick the slice closest to the buying decision and map that. The prompt is written to say so rather than produce a sprawling map it cannot support.

### Why does the prompt insist on a page budget?

Because an unbounded topical map is the standard failure mode of this exercise. A 180-page map handed to one writer is a backlog nobody works through, and the pages that do get written are the easy ones rather than the important ones. Forcing the cut early makes the model rank pages against the credibility base and the buying decision, and the out-of-scope list it produces is often more useful than the map itself.

### When does this prompt not work well?

Two cases. First, when the team genuinely has no first-hand basis in the subject — the output will be mostly deferred pages, which is the correct answer but not a usable plan; fix the input, not the prompt. Second, large catalogue sites where most pages are category and product templates generated from a database. This maps editorial pages and the links between them; it does not plan faceted navigation or template hierarchies.

### Can I use the slugs directly?

Treat them as planning labels. They are readable and consistent, which makes the hierarchy easy to review, but they ignore your existing URL conventions and any redirect history you are carrying. Map them onto your real structure before anything is built, and do not restructure live URLs purely to match the shape of the plan.
