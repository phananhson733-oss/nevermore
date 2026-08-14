---
title: On-Page SEO
description: Review one page the way a reader and a crawler both meet it — title, outline, naming, markup, and links — and change only what the page and its data support.
tagline: Make one page legible to a reader and a crawler at the same time
category: seo
owner: seo
keywords: on-page seo skill, title tag review, heading structure seo, structured data validation, meta description writing, entity clarity seo, page level seo review
relatedSkills: seo-audit, internal-linking
relatedPrompts: title-tag-meta-description-prompt, faq-generation-schema-prompt
status: published
publishedAt: 2026-08-14
---

## Skill file

```text
---
name: on-page-seo
description: Revise a single page so its title, outline, naming, markup, and links all state the same thing, using only what the delivered page and its measured data show. Use when someone asks to optimise a page, rewrite its title or meta description, add schema, or fix its headings — and when a page ranks below what its content deserves and nobody has checked whether the page says one consistent thing.
metadata:
  owner: GenGrowth SEO Agent
  source: https://gengrowth.ai/skills/on-page-seo
---

# On-Page SEO

Your job is to make one page say clearly what it is — to a person scanning a
result list and to a crawler parsing the HTML — without adding claims the page
does not support.

## What counts as evidence

Four sources, in descending order of trust:

1. The delivered page — the HTML served at that URL, plus the text a reader
   actually sees. This is the only authority on what the page says today.
2. Measured — Search Console rows for this URL: the queries it appears for,
   impressions, clicks, and impression-weighted average position.
3. Observed — what the pages currently ranking for the same query family cover,
   read from live results.
4. Tool output — readability figures, page scores, generic linters. Advisory
   only. A score is never a finding on its own; name the element it points at.

Search Console withholds queries below its reporting threshold, so the query
rows for a URL rarely account for all of its impressions. Report the share they
do cover. When a metric is unavailable, write that it is unavailable. Do not
substitute zero: zero clicks is a measurement, and no data is not zero.

## Procedure

1. Write the page's job in one sentence: which reader, which question, which
   next step. If it takes two sentences, the page is serving two query families
   and the first decision is split or refocus, not tags.

2. Fetch the page as delivered and compare it against the rendered view. Record
   any main content that exists only after client-side scripting, and say its
   indexing is not guaranteed rather than assuming either outcome.

3. Read the title alone, out of context, as it would sit in a result list beside
   nine others. It must name the subject and separate this page from the rest of
   the site. Judge the description separately: it is the click argument, not a
   ranking input.

4. Strip the body and read the headings on their own. The outline should read as
   the page's argument. Headings such as Overview, Details, and Conclusion carry
   no information; replace them with the actual claims or comparison axes. Check
   that the h1 and the title agree with each other.

5. Check naming. Every subject the page is about should appear with its full
   name on first use, together with the version, unit, region, or size range
   that bounds it. Replace "most models" and "recently" with the real scope.
   This is what makes the page resolvable to a reader who arrived cold.

6. Validate structured data field by field against the visible page. Every
   marked-up value must correspond to something a reader can see. Remove or
   render anything that does not, including FAQ markup for questions the page
   never asks.

7. Review the links leaving the body. Each should lead to a page that answers a
   question this page raises, with anchor text that names the destination rather
   than the act of clicking.

8. Reconcile with measured queries. If the URL takes impressions for a query
   family the page does not address, say so, and recommend split, refocus, or
   leave alone with the reason attached.

## Output

An ordered change list. For each item: the element, what it says now, the
proposed change, the evidence behind it, and the risk of making it. State the
ordering rule you used so it can be argued with. Close with what you could not
determine and what data would settle it.

## Refuse to

- Recommend a keyword density, a repetition count, or a target word count.
- Add structured data for content that is not visible on the page.
- Rewrite a title to match a query the page does not actually serve.
- Report a tool score or an estimate as a measurement.
- Replace an unavailable metric with zero or with a guess.
- Promise a ranking, a traffic number, or a timeline.
```

## What it does

On-page work goes wrong when it becomes a list of tags to fill. Someone confirms there is a title, a description, one h1, an alt attribute per image, and a block of schema, ticks all six, and moves on. The page still tells a reader nothing in the first screen, its headings still read Overview and Conclusion, its FAQ markup still describes questions that were cut in the last edit, and its title is still indistinguishable from every other page in the same directory. Every box was ticked and the page is no more legible than before.

This skill treats the page as one argument that has to survive two readings at once: a person deciding in a second and a half whether this result is the one, and a parser building a representation of what the page covers. Those two readings mostly want the same thing — a stated subject, a visible structure, named entities with their scope, and markup that repeats only what is on the page.

The output is an ordered list of changes with the evidence behind each one and the risk of making it. Where the data does not reach — a query Search Console withholds, a metric no connected source provides — the change list says so instead of filling the space. That matters here more than in most work, because on-page changes are cheap to make and easy to make for no reason.

## In action

### You ask

Can you look at kestrelcase.com/guides/laptop-sleeve-vs-hard-case? It has had impressions for about eight weeks and almost no clicks. We sell laptop cases. Nothing on the page has changed since we published it.

### The agent does

The title is the first problem. It reads `Guides | Kestrel Case`, which is also true of eleven other URLs on the site. In a result list nothing separates this page from the rest of the guides directory, and the h1 does not rescue it either: it reads "Which One?". The fix names both options and the decision being made, in that order.

The outline is second. Stripped of body copy, the headings read Overview, The Options, Considerations, Conclusion. The page does contain a real comparison — drop protection, weight, whether it fits under an airline seat — but those axes live inside paragraphs, so neither a skimming reader nor a parser can see the argument exists.

Third, the FAQPage markup declares four questions and three of them appear nowhere in the visible page; they were cut before publication. That is a claim the page does not support. Either render them or remove the markup.

On the numbers: Search Console reports 0 clicks for this URL across the eight weeks, which is a measurement, not a gap. Its query rows cover 61 percent of the URL's impressions; the rest fall below the reporting threshold and are withheld. I have not estimated what they are.

Ordered by how much of the observed mismatch each change addresses, not by effort.

## How it works

### Establish the page's job from what it already attracts

The agent writes one sentence naming the reader, the question, and the next step, then checks it against the queries the URL already takes impressions for. A page that needs two sentences is serving two query families, and that is a scope decision to make before any tag is touched.

### Read what is actually delivered

The HTML served at the URL is compared with the rendered view, so content that only exists after client-side scripting is identified rather than assumed. Where main content is script-injected, the report says its indexing is not guaranteed — it does not claim the content is invisible, and it does not claim it is fine.

### Read the outline and the naming on their own

Headings are read stripped of body copy, because that is close to how both a skimming reader and a parser encounter them. In the same pass the agent checks that subjects are named in full on first use, with the version, unit, region, or size range that bounds them, so nothing depends on the reader already knowing.

### Check every claim in the markup against the visible page

Structured data is validated field by field against what a reader can see, and outgoing links are checked for whether they answer a question this page raises and whether the anchor names the destination. The result is a change list ordered by an explicitly stated rule, each item carrying its evidence and its risk.

## What it covers

- Title and description reviewed against the query family the URL already appears for, and against the other titles it sits beside
- Heading outline read as an argument, independently of body copy, with h1 and title checked for agreement
- Entity naming: full names on first use, with version, unit, region, or range so the page's scope is stated rather than implied
- Structured data validated field by field against visible content, with unsupported fields removed or rendered
- Outgoing links and anchor text checked against the questions the page actually raises
- Delivered HTML compared with the rendered view, with script-injected main content reported rather than assumed either way

## When to use it

- A page has had impressions for weeks and nobody has read its title next to the queries it appears for
- A subject expert wrote the page and its headings are Overview, Details, and Conclusion
- Structured data arrived with a plugin or a template and no one has checked whether the marked-up fields exist on the page
- One URL is taking impressions for two different query families and no one has decided whether to split it
- A template migration changed the layout and the title, h1, and breadcrumb no longer say the same thing

## FAQ

### How is this different from the SEO Audit skill?

The audit works across a site and sorts pages by what class of problem is holding them back — indexing, templates, thin coverage, or something on the page itself. This skill works on one page at a time, at the level of the words in it. They hand off in one direction: the audit names the page and the class of problem, and this skill decides what the page should actually say.

### Where does this stop and the Internal Linking skill begin?

This one looks at the links leaving a single page and asks whether each answers a question that page raises and whether the anchor names its destination. Internal linking works at the level of the graph: which pages deserve links at all, where they should come from, and which parts of the site are unreachable in a few steps. Fixing one page's outbound links does not tell you whether that page receives any.

### Does it tell me how many times to use the target term?

No, and it will not produce a density figure if asked. No threshold has ever survived contact with a real page, and writing to one produces copy that reads as written to a threshold. The working test is different: can a reader who lands cold, having read nothing else on the site, tell within a screen what page they are on and what it will settle for them. Pages that pass that test name their subject where it belongs without anyone counting.

### The page looks fine in my browser. Why does it read the source HTML?

Because your browser is not the only client. The check compares what is served at the URL with what you see after scripts run, and reports any main content that appears only in the second. It does not conclude that such content goes unindexed — that varies, and asserting it either way would be a guess. It records the difference so the decision to move that content into the served HTML is made deliberately rather than discovered later.
