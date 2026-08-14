---
title: AI Answer Visibility Prompt
description: Rewrite a page passage by passage so an assistant can quote a correct, self-contained answer from it, plus a straight read on whether page edits alone can change anything.
category: geo
useCase: GEO
outputFormat: Revision plan
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: ai overview optimization prompt, generative engine optimization prompt, ai search visibility, geo prompt seo, get cited by ai, ai answer optimization, llm citation seo
relatedSkill: geo-ai-visibility
relatedPrompts: faq-generation-schema-prompt, content-refresh-rewrite-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are an editor restructuring one page so an assistant can lift a correct
answer out of it, and reporting honestly on whether that will change anything.

# Scope
Work only from the page content and facts pasted below. Do not add numbers,
dates, sources, or claims that were not given to you. Where an answer needs a
fact you were not given, write the gap as a marker, never as a plausible value.

# Inputs
The page and who it serves: {{target_page}}
The page as published: {{page_content}}
Questions this page should be able to answer: {{target_questions}}
What exists about this entity off our own site: {{offsite_presence}}
Facts we can stand behind, with dates: {{verified_facts}}

# What to produce
A revision plan: passage by passage, the text as published and its replacement,
plus a plain statement of what the revisions can and cannot affect.

# Steps
1. For each question, find the passage that answers it and quote it word for
   word. If nothing on the page answers it, record that. Do not write the
   answer yet.
2. Read each quoted passage alone, as if pasted somewhere with no heading and
   no sentence before it. Mark what breaks: a pronoun with no antecedent, "we"
   with no entity named, a comparative with no baseline, a figure with no unit
   or date, a qualifier such as "fast" standing in for a number.
3. Check how the entity is named. A reader arriving cold must be able to tell
   which organisation or product this is and separate it from others with
   similar names. Name it in full wherever a passage would travel without it.
4. Sort every checkable claim into three piles: sourced on the page; true and
   supportable but with no source shown; unsupportable as written. Claims of
   standing — leading, trusted, award-winning — go in the third pile unless a
   named source was supplied.
5. Write the replacements. Each replacement answers its question in the first
   sentence, names the entity, states the scope it applies to, and carries a
   date where the fact can go stale. Use only facts from the pasted page or the
   supplied list. Where a replacement needs a fact you do not have, write
   [fact needed: ...] in its place and move on.
6. Assess retrieval separately from extraction. If no independent source
   describes this entity, say plainly that these revisions do not cause an
   assistant to cite the page: they make it quotable once it is already
   retrieved, which without off-site presence means mostly branded queries.
   List the off-site work required as its own item, outside the page plan.
7. Close with what the plan does not change.

# Output format
A coverage table: Question | Answered as published | Passage or "not answered".
Then a revision table: Section | Current text | Replacement | What it fixes.
Then the [fact needed] list, entity naming, the retrieval assessment, and what
this plan does not change.

# Quality checks before you answer
- Every quoted current text appears word for word in the pasted page.
- Every replacement still reads correctly with nothing above it.
- No number, date, source, or accreditation appears that was not supplied;
  gaps are markers, not values.
- The retrieval assessment states the limit in plain words and nowhere
  describes page edits as producing citations.
- No recommendation involves repeating a term a set number of times.

# When the input is thin
If no questions were supplied, derive candidates from the page's own headings,
label them as inferred, and confirm before treating them as the brief. If the
off-site input is blank, treat it as unknown rather than as nothing, say the
retrieval assessment cannot be made, and name what to go and check. Never
estimate a citation rate, a share of answers, or a visibility score.

# Boundaries
Do not promise citation, inclusion in an AI answer, rankings, or traffic. Do
not present structured data or a machine-readable file as a mechanism that
causes an assistant to cite the page. Do not turn the page into a wall of
questions. Do not delete a claim you were given a source for.
```

## Variables

### target_page
Required. The URL, what the page is for, and who reads it. This is what decides whether a passage that reads well to an insider reads at all to an outsider.
Example: https://otterbecksoil.co.uk/services/soil-carbon-testing — service page for Otterbeck Soil Lab, read by farm managers deciding where to send samples

### page_content
Required. The page as published, in reading order, headings included. Paste the body copy, not the rendered navigation, cookie banner, or footer.
Example: H2: Fast, reliable results / We turn tests around fast, so you are never left waiting on an agronomy decision.

### target_questions
Required. The questions someone would actually type into an assistant that this page should be able to answer. Take them from sales calls and support tickets rather than a keyword tool.
Example: How long does a soil carbon test take? How much does soil organic carbon testing cost in the UK?

### offsite_presence
Required. Everything that describes this entity somewhere other than your own site: directory entries, press mentions, reference-work entries, reviews, bylined articles. Write "none that I know of" if that is the truth; leave it blank only if you have not checked.
Example: Listed in the Soil Association supplier directory as a name and postcode; no Wikipedia or Wikidata entry; no third-party reviews

### verified_facts
Optional. The numbers, dates, methods, and sources you can stand behind, each with the date it was true. Anything missing here comes back as a [fact needed] marker instead of a number.
Example: Turnaround 10 working days from sample receipt; median 8 working days across 2025 over 1,140 samples

## How to use

Paste the page exactly as it is published, then fill `verified_facts` before you run anything. That order matters: the prompt is written to replace vague copy with specific copy, and the only thing standing between it and an invented specific is the fact list you supplied. Give it "we turn tests around fast" with an empty fact list and a model will happily write "within 5 to 7 business days", because that is what pages like this usually say. The `[fact needed]` markers are your tell — a plan that comes back with none of them, on a page full of unquantified claims, has filled the gaps itself. Check every figure in the replacement column against your fact list line by line.

The second failure is the FAQ reflex. Ask any model to make a page easier for an assistant to use and the first draft tends to be the same page with a question-shaped heading above each paragraph. That is not the deliverable. The deliverable is passages that survive being quoted: pull any replacement sentence out, paste it into a blank document, and see whether it still says who it is about, what it applies to, and when it was true. If it does not, the revision has not done its job, and adding a question above it does not fix anything.

The third failure is the one that matters most, and it is a softening. The retrieval section comes back as "building topical authority over time will improve AI visibility" — a sentence that sounds like a plan and commits to nothing. When you see it, ask the model one question: name one source, other than our own site, that an assistant could retrieve which describes us. If the honest answer is none, then the honest conclusion is that these page edits do not change whether you are cited, and the prompt is written to say so rather than to sell you the rewrite.

Work the plan in two streams once you have it. The revision table is a writing task you can finish this week. The off-site list is a different kind of work with a different owner, and treating it as a follow-up bullet on a content ticket is how it stays undone for a year.

## Example input

```text
The page and who it serves: https://otterbecksoil.co.uk/services/soil-carbon-testing — service page for Otterbeck Soil Lab, an independent soil-testing laboratory in Shropshire. Read by farm managers and land agents deciding where to send samples.

The page as published:
H1: Soil Carbon Testing
Understanding what is in your soil starts here.

H2: Fast, reliable results
We turn tests around fast, so you are never left waiting on an agronomy decision. It typically takes about a fortnight, though this varies with demand.

H2: The method
The lab uses the industry-standard method for organic carbon, and we can also offer a cheaper screening option if budget is a concern.

H2: Why choose us
We are the leading soil carbon lab in the Midlands. Our results are trusted by farms across the region and our team has decades of combined experience.

H2: Accreditation
We are fully accredited, so your results will stand up wherever you need to submit them.

H2: Pricing
Pricing is competitive. Get in touch for a quote and we will build a package around your holding.

H2: Sampling
Sample density depends on your situation. Talk to us and we will advise.

Questions this page should be able to answer:
How long does a soil carbon test take?
How much does soil organic carbon testing cost in the UK?
What method is used to measure soil organic carbon?
Is Otterbeck Soil Lab accredited?
How many soil samples do I need per hectare?

What exists about this entity off our own site: Listed in the Soil Association supplier directory as a name and postcode, no description. Named once, without a link, in a Farmers Weekly piece on carbon markets in March 2025. No Wikipedia or Wikidata entry. No third-party reviews anywhere. Two case studies exist but sit only on our own site. Nobody at the lab has published a bylined article. A branded search returns our own site and the directory listing.

Facts we can stand behind, with dates:
Turnaround: 10 working days from sample receipt is the published commitment; median across 2025 was 8 working days over 1,140 samples.
Method: dry combustion (Dumas) on a LECO analyser for total organic carbon. Loss-on-ignition offered as a lower-cost screen, reported separately, not interchangeable with dry combustion results.
Accreditation: ISO/IEC 17025, certificate 4471, first issued March 2024; current scope covers total organic carbon and pH.
Price: 48 GBP per sample; 75 GBP mobilisation fee if we take the samples. Current as of 1 July 2026.
Sampling density: we have no defensible per-hectare figure. We advise per field.
```

## Example output

**Coverage**

| Question | Answered as published | Passage |
| --- | --- | --- |
| How long does a test take? | Partly | "It typically takes about a fortnight" |
| How much does it cost? | No | "Pricing is competitive." |
| What method is used? | No | "the industry-standard method for organic carbon" |
| Is the lab accredited? | No | "We are fully accredited" |
| Samples per hectare? | No | "Sample density depends on your situation." |

**Revisions**

| Section | Current text | Replacement | What it fixes |
| --- | --- | --- | --- |
| Fast, reliable results | "It typically takes about a fortnight" | Otterbeck Soil Lab returns soil carbon results within 10 working days of sample receipt. The median across 2025 was 8 working days over 1,140 samples. | "It" has no antecedent once quoted; a fortnight is not the commitment |
| The method | "The lab uses the industry-standard method for organic carbon" | Otterbeck measures total organic carbon by dry combustion (Dumas) on a LECO analyser. Loss-on-ignition is offered as a lower-cost screen, reported separately and not interchangeable with dry combustion. | Names the method; keeps two non-equivalent tests apart |
| Why choose us | "We are the leading soil carbon lab in the Midlands. Our results are trusted by farms across the region" | Delete the first sentence; replace the second with [fact needed: holdings tested, or years in operation]. | Standing claims with no source supplied; a count would be checkable |
| Accreditation | "We are fully accredited, so your results will stand up wherever you need to submit them." | Otterbeck Soil Lab is accredited to ISO/IEC 17025 under certificate 4471, first issued March 2024. The scope covers total organic carbon and pH. | Names standard, certificate and scope; drops a promise about what others accept |
| Pricing | "Pricing is competitive. Get in touch for a quote" | Soil carbon testing at Otterbeck Soil Lab costs 48 GBP per sample. On-site sampling adds a 75 GBP mobilisation fee. Prices current as of 1 July 2026. | The date lets the figure be seen going stale |
| Sampling | "Sample density depends on your situation." | Otterbeck Soil Lab does not publish a per-hectare density. It is set per field from size, cropping history and slope, because one figure would be wrong for most holdings. | Answers honestly rather than deflecting, without inventing a number |

**Facts needed:** one — holdings tested or years in operation, to replace "trusted by farms across the region".

**Entity naming:** the body never states the name; every claim rides on "we" or "the lab", so a passage quoted away from the page arrives with no entity attached. Each section now opens with "Otterbeck Soil Lab", and the intro should say what it is and where: an independent soil-testing laboratory in Shropshire.

**Retrieval:** nothing off your own site describes Otterbeck Soil Lab. The directory entry is a name and a postcode; the Farmers Weekly mention is one unlinked line. An assistant asked which UK labs test soil carbon has nothing about you to retrieve, so these revisions will not produce a citation. They make the page quotable once it is retrieved, which today means branded queries. Off-site work, which is not a page edit: get a description and certificate 4471 into the directory entry, ask Farmers Weekly to link the March 2025 mention, and host the two case studies off your own domain.

**This plan does not change:** search positions, whether any assistant cites the page, or traffic. No estimate of those is given.

## Safety notes

Before this plan reaches a writer, check the replacement column against `verified_facts` figure by figure. Every number, date, certificate, and method name in a replacement must trace to something you supplied — anything else is the model writing what a lab like yours would plausibly say. Then check the deletions in the other direction: the prompt removes claims of standing because no source was attached, and occasionally someone in the business does have the source. Restore those with the source named, not as the original claim.

The plan deliberately does not say the page will be cited, retrieved, or shown in an AI answer, and it gives no visibility score or share of answers. It makes one narrow claim: that a revised passage says what it means when read on its own. That is checkable by you in a minute, which is why it is the thing being promised.

## FAQ

### Will this get my page cited in AI answers?

No, and the prompt is written not to claim it. Restructuring changes whether a passage can be extracted and quoted correctly once a page has been retrieved. Retrieval happens upstream of that and is driven largely by whether independent sources describe you at all. On a site with no off-site presence, expect these edits to improve the answers people already get about you by name, and to change nothing else.

### Should I add FAQ schema or an llms.txt file?

Add them if they are cheap, but do not count them as the work. Markup helps a parser find structure it could mostly infer from good headings anyway; it does not make a claim more trustworthy or a site more retrievable. Schema that contradicts the visible text is worse than no schema at all, because it creates a discrepancy someone has to resolve in your disfavour. If you want the FAQ markup done properly, that is a separate job — see the FAQ generation and schema prompt.

### How do I tell whether the rewrite worked?

At page level, mostly by inspection rather than by measurement. Take each revised passage, paste it into a blank document, and read it cold: does it name the entity, state its scope, and carry a date where one is needed? That is the deliverable and it is directly verifiable. Referral data from assistants is partial and inconsistently labelled across tools, so an absence of it means you do not know, not that you were never cited — do not build a report on that number.

### Does this work on any page, or only guides?

It works on any page that contains an answer someone would ask for: a service page, a pricing page, a specification, a policy. It works badly on pages whose job is not to answer anything. A homepage usually has no extractable answer in it, and rewriting one into a set of self-contained claims tends to damage it for the humans it was built for. Pick the pages where a real question already has a real answer buried in soft copy.
