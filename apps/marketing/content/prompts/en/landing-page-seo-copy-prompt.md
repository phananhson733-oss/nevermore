---
title: Landing Page Copy Prompt
description: Draft landing page copy that answers one search query in the first screen and then earns one action, using only the facts you supply.
category: writing
useCase: Conversion copy
outputFormat: Draft
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: landing page copy prompt, seo landing page copy, landing page copywriting prompt, conversion copy prompt, ai landing page copy, search intent landing page
relatedSkill: on-page-seo
relatedPrompts: comparison-page-copy-prompt, title-tag-meta-description-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are a landing page copywriter working only from facts an operator gave you.

# Scope
Write one page that serves one search query and asks for one action. You cannot
open URLs or look the product up, and every claim must trace to a line in the
input. Do not invent customer counts, logos, testimonials, ratings,
percentages, time savings, prices or deadlines. If a proof point is not in the
input, the page is written without proof rather than with invented proof.

# Inputs
The query this page serves, and who types it: {{target_query}}
What the offer is, what it does, and where it stops: {{offer_facts}}
The one action the page asks for, and what happens right after:
{{primary_action}}
Proof you can actually cite, if any: {{proof_assets}}
Voice, spelling, and claims you cannot make: {{copy_constraints}}

# What to produce
A full draft: H1, subhead, first screen, the sections below it, the
call-to-action wording, and three FAQ entries. Then a short note naming the
decision you made where search relevance and conversion pulled apart.

# Steps
1. Restate the query as the question the visitor is actually asking. If the
   input carries two questions or two actions, name the split, serve one, and
   recommend a second page for the other. Do not average them into one page
   that serves neither.
2. Write the first screen to answer that question directly. The H1 names the
   thing in the searcher's vocabulary, not the brand's. Someone arriving from
   that query must confirm in one read that this page is about their problem,
   before any persuasion happens.
3. Below the first screen, earn the action. Order the sections by the objection
   a reader raises next, not by what the business most wants to say. Each
   section settles one objection using facts from the input.
4. State the limits. Name who this is not for, what it does not do, and what it
   requires, in the page's own voice. A limit the reader can check does more
   here than a claim they cannot.
5. Write the action wording so it says what happens on click. State only
   conditions that appear in the input.
6. Use proof only where it was supplied, and attribute it: who said it, or
   where the number came from. Where a section needs proof you were not given,
   write it without and list the gap under "Proof requested".
7. Write three FAQ entries answering what this specific searcher asks before
   acting. Answer them; do not use them to restate the pitch.

# Output format
Markdown, in this order: Page intent (query, audience, single action); H1;
Subhead; First screen; Sections, each with heading and body; Action wording,
with the button label and the line under it; three FAQ entries;
Relevance-versus-conversion note; Proof requested; Refused, with reasons.

# Quality checks before you answer
- Every noun, number, limit and name in the draft traces to a line in the
  input.
- The first screen answers the query without a scroll or a click.
- The page asks for exactly one action, and no secondary link competes with it.
- No urgency, scarcity or deadline appears unless the input supplied a real one.
- No proof appears without an attribution a reader could check, and no figure
  supplied as a range, median or average is restated as a promise.
- Swapping the brand for a competitor's would make the first screen read wrong.
  Any sentence that survives that swap is generic; rewrite it.

# When the input is thin
Say so and write only what the input supports. If the offer facts run to one
line, write the first screen, mark the remaining sections unwritten, and name
the fact each one needs. If no proof was supplied, ship with no proof section
rather than placeholder testimonials or bracketed metrics. Never fill a gap
with a plausible number.

# Boundaries
Do not promise rankings, traffic, revenue, or a timeline to results. Do not
recommend a keyword density or a repetition count. Do not fabricate scarcity,
countdowns or expiring offers. Do not write testimonials, customer names or
logos. Do not assert a certification, compliance status or guarantee that was
not supplied. Do not use emoji.
```

## Variables

### target_query
Required. The single query the page serves, plus who types it and what they already know. Write what they are trying to rule in or out, not just the keyword.
Example: "online laser cutting service" — an engineer sourcing cut parts, comparing three or four vendors in one sitting

### offer_facts
Required. What the thing is, what it does, and where it stops: materials, limits, minimums, exclusions, what happens to unsupported cases. The exclusions carry more weight here than the features.
Example: Cutting only, no bending or finishing. Max sheet 120 x 60 in. DXF or DWG only; STEP files are rejected.

### primary_action
Required. The one action the page asks for, and what the visitor gets immediately after taking it, including what it costs and what it commits them to.
Example: Upload a DXF or DWG. A quoting engineer sends a firm price by the end of the next business day. No account, no card.

### proof_assets
Optional. Proof you can put in public: named customers who have given permission, published figures with their source and sample size, third-party ratings. Anything absent here will not appear in the draft.
Example: Median 3 business days from approved quote to shipment, 612 orders shipped January to March 2026, from our dispatch records

### copy_constraints
Optional. Voice, spelling variant, words to avoid, and claims legal or commercial reality will not support.
Example: US spelling. Never state a turnaround as a promise for a specific order. Do not use "fast" or "precision" without a number behind it.

## How to use

The exclusions in `offer_facts` do more work than the features. Most operators fill that field with what the product does and leave out what it refuses, and the draft that comes back could belong to any vendor in the category. Write the maximum size, the minimum order, the file formats you reject, the regions you do not ship to. A page that tells a visitor in the first screen that their part is too long for your bed loses that visitor, which is the correct outcome and cheaper than losing them after a quote round-trip.

The failure you will actually hit is reintroduced proof. Read the draft once looking only at numbers, names and superlatives, and check each against `proof_assets`. Drafts routinely arrive with "trusted by hundreds of engineers", "industry-leading tolerances" or "24-hour turnaround" attached to a product whose input mentioned none of those. The subtler version is a supplied figure quietly upgraded: you gave a median of three business days and the draft says "we ship in three days". That sentence has become a commitment your operations team never made, and it reads so naturally that it survives most reviews.

If you find yourself wanting to add a newsletter box to the first screen or a second button beside the primary one, you have hit the tension this prompt exists to resolve, and adding both is how pages end up serving neither. Same signal in reverse: if the draft feels like it is answering two questions, the input contained two queries and the fix is upstream in `target_query`, not in the copy.

When one section comes back generic, that section's facts were thin. Add the missing detail and ask for that section again rather than rerunning the page. A full rerun reshuffles headings and an H1 you had already approved, and you will spend the second review re-approving work you had settled.

## Example input

```text
The query this page serves, and who types it: "online laser cutting service" — a
mechanical engineer or small shop owner sourcing cut parts, comparing three or
four vendors in one sitting. They want to know what we cut, how big, how thick,
and how price is worked out before they send a file to anyone.

What the offer is, what it does, and where it stops:
Kerfline is a fiber laser cutting shop in Cleveland, Ohio. Upload a DXF or DWG,
we quote it, we cut it, we ship it.
Materials: mild steel, stainless 304 and 316, aluminum. No brass, no copper, no
acrylic.
Max sheet 120 x 60 in. Max thickness 0.75 in mild steel, 0.5 in stainless,
0.375 in aluminum.
Cutting only. We do not bend, tap, weld, powder coat or anodize.
Priced on cut path length plus sheet usage, not by machine hour. We have no
hourly rate to quote.
Minimum order $150. Tolerance +/- 0.005 in on parts under 24 in.
Ships to the lower 48. No international shipping, no local pickup.
DXF or DWG only. The quoting system rejects STEP files.

The one action the page asks for, and what happens right after:
Upload a DXF or DWG. A quoting engineer reviews it and sends a firm price by the
end of the next business day. No account needed, no card. Nothing is cut until
the quote is approved in writing.

Proof you can actually cite:
Ridgeline Cycles (small-batch e-bike frames, Portland) gave written permission
to be named and to use this sentence: "We moved our dropout blanks to Kerfline
because they would quote a 40-part run without asking us to commit to 400."
Median 3 business days from approved quote to shipment, across 612 orders
shipped January to March 2026, from our own dispatch records.
Nothing else is cleared. No ratings, no case studies, no customer count we are
willing to publish.

Voice, spelling, and claims you cannot make:
US spelling. Write for someone who reads drawings. Do not say "solutions" or
"manufacturing partner". Never state a turnaround as a promise for a specific
order; the 3-day figure is a median. Do not use "fast", "affordable" or
"precision" without a number behind it. We would also like this page to pick up
"laser cutting cost per hour" searches.
```

## Example output

**Page intent** — Query: "online laser cutting service". Audience: an engineer comparing vendors. Single action: upload a DXF or DWG for a quote.

**H1** — Online Laser Cutting for Steel, Stainless and Aluminum Parts

**Subhead** — Upload a DXF or DWG and a quoting engineer sends a firm price by the end of the next business day. Nothing is cut until you approve it in writing.

**First screen** — spec block, with the upload button beside it:

| | |
| --- | --- |
| Materials | Mild steel, stainless 304 and 316, aluminum |
| Sheet size | Up to 120 x 60 in |
| Thickness | 0.75 in mild steel, 0.5 in stainless, 0.375 in aluminum |
| Tolerance | +/- 0.005 in on parts under 24 in |
| Files | DXF or DWG |
| Ships | Lower 48 |

**What we do not do** — Cutting only: no bending, tapping, welding, powder coat or anodizing, so a part that needs a bend needs a second shop. No brass, copper or acrylic. No international shipping, no local pickup. The quoting system rejects STEP files.

**How a quote is priced** — On cut path length plus sheet usage. There is no machine-hour rate to quote. Minimum order $150.

**What happens after you upload** — A quoting engineer reviews the file, and nothing is cut until you approve the price in writing. Across 612 orders shipped January to March 2026, our dispatch records show a median of 3 business days from approved quote to shipment. That is a median across those orders, not a date for yours.

**Who works with us** — Ridgeline Cycles, who build small-batch e-bike frames in Portland: "We moved our dropout blanks to Kerfline because they would quote a 40-part run without asking us to commit to 400."

**Action wording** — Button: Upload a DXF or DWG. Under it: No account, no card. A quoting engineer replies with a firm price by the end of the next business day.

**FAQ**

- Can you cut a part longer than 120 in? No. 120 x 60 in is the sheet, and splitting a longer part into sections is a design change we do not make for you.
- Do you cut acrylic or brass? No. Mild steel, stainless 304 and 316, and aluminum.
- Can I send a STEP file? No. Export to DXF or DWG.

**Relevance-versus-conversion note** — The first screen is a spec block rather than a value proposition because this searcher disqualifies before evaluating, so the button sits beside the specs rather than below the argument. Answering "can you cut my part" in one read costs a screen of persuasion and saves both sides a quote cycle on work you cannot take. Separately: "laser cutting cost per hour" is a different question this page cannot answer honestly, because you do not price by the hour. Those searches need a page explaining cut path pricing, and its action should not be the upload.

**Proof requested** — A second named customer outside cycling. How the +/- 0.005 in tolerance is verified. Whether the 612-order median still holds, since the page will outlive Q1 2026.

**Refused** — No customer count, rating or success rate: none were supplied. No turnaround promise, per your constraint. "Precision" left out, having no number behind it. No scarcity or deadline language.

## Safety notes

Before this goes live, check every number and name in the draft against its source, and check that the limits are still true — a minimum order, a thickness ceiling or a shipping region that changed three months ago will sit uncorrected on the page for as long as nobody rereads it. Get written sign-off from any named customer on the exact sentence you quote, not on the idea of being quoted. Anything that could be read as a guarantee, a certification or a compliance claim needs whoever owns that risk to read it, because "our records show a median of three days" and "we ship in three days" are one editing pass apart.

The prompt makes no claim about rankings, traffic or conversion rate, and nothing in the output is evidence that this page performs better than what you have now. Its claim is narrower: the copy traces to facts you supplied, it serves one query and asks for one action, and it contains no proof you did not give it.

## FAQ

### Does answering the search query first hurt conversion?

It usually lowers the raw number of people who take the action and raises the share of those who do that you can actually serve. In the example above, an engineer with a 3-metre part now leaves in five seconds instead of submitting a file and consuming a quoting engineer's afternoon. If the metric you report on is form fills, that reads as a loss, so agree beforehand on which number you are managing. What it is not is a trade you can dodge: a first screen that withholds the answer to keep people scrolling gets read as evasion by exactly the audience that knows what to ask.

### Should the call to action be in the first screen or after the argument?

Put it where the visitor has enough information to act, which depends on what the query implies they already know. A comparison-stage searcher needs the specs before the button means anything, so the button belongs beside the specs. Someone arriving on a branded query has already decided and does not need the argument at all. The pattern that fails in both cases is a hero with a button and no substance, then the substance further down: the first group cannot evaluate and the second group has to scroll past nothing.

### When is this prompt the wrong tool?

When the page has to serve several intents at once. Home pages, category pages and pricing pages that cover four plans all break the one-query, one-action rule by design, and forcing them through this prompt produces a page that serves whichever intent you happened to list first. It is also the wrong tool when the offer facts do not exist yet — if nobody can state what the product does that its competitors do not, the draft will come back generic no matter how you word the input, and that is a positioning problem that copy cannot solve.

### Can I use it for paid search landing pages?

Partly. The structure carries over, but a paid landing page matches the ad, not the query, and the ad has already made a specific promise that the first screen has to honour word for word. Put the ad headline and its offer into `target_query` so the draft answers the promise the visitor clicked. Treat the result as one variant and nothing more: this prompt produces a draft, not evidence about which version converts, and the only thing that settles that is a test you run yourself.
