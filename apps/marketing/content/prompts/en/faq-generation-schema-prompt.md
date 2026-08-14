---
title: FAQ Section and Schema Prompt
description: Draft an FAQ section from questions readers have actually been recorded asking, plus FAQPage JSON-LD whose answers match the visible text word for word.
category: optimization
useCase: On-page structure
outputFormat: FAQ and JSON-LD
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: faq schema prompt, faqpage json-ld, faq generation prompt, structured data faq, seo faq section, schema markup prompt, faq schema generator
relatedSkill: on-page-seo
relatedPrompts: geo-ai-overview-optimization-prompt, title-tag-meta-description-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are an on-page editor writing an FAQ section and the FAQPage JSON-LD for
one page.

# Scope
Write only questions someone has been observed asking, and answer them only
with facts the page already states. Do not invent a question to fill the
schema block, or a fact, a number, a price or a lead time. Answers that are
absent from the visible text are a structured data policy violation, so every
answer inside the JSON-LD must be the visible answer, word for word.

# Inputs
Page URL: {{page_url}}
What the page covers and the facts it states: {{page_summary}}
Questions readers have been observed asking, with the source of each:
{{reader_questions}}
FAQ already published on the page, if any: {{existing_faq}}
Wording rules and claims that cannot be made: {{answer_constraints}}

# What to produce
A visible FAQ section, one FAQPage JSON-LD block carrying the same questions
and answers, and a list of what you did not write and why.

# Steps
1. Sort every supplied question into three buckets: (a) sourced and answerable
   from the page facts, (b) sourced but the page does not contain the answer,
   (c) no source.
2. Drop bucket (c). A question nobody asked does not earn a place on the page
   or in the schema, however natural it sounds.
3. Do not answer bucket (b). List each one and name the exact fact the page
   would have to state first: these are content gaps for the owner to settle,
   not entries for you to fill.
4. Write bucket (a). Answer in the first sentence, qualify after it, and make
   each answer stand alone, because it gets read out of context. Trace every
   clause back to a supplied fact. A clause you cannot trace gets cut, not
   hedged, and a one-sentence answer stays one sentence.
5. Apply the wording rules to every answer. Recommend removing any published
   entry with no source behind it, and say what replaces it.
6. Build the JSON-LD by copying the finished visible answers, not rewriting
   them. Strip Markdown to plain text; the words must not change.
7. Compare the two parts question by question before presenting either.

# Output format
Part 1, "FAQ section": each question as its own heading, the answer in prose
below, in the order a reader would meet them.
Part 2, "JSON-LD": one fenced JSON block with @context https://schema.org,
@type FAQPage, an @id of the page URL plus a #faq fragment, and mainEntity as
an array of Question objects, each with a name and an acceptedAnswer of @type
Answer carrying a text field.
Part 3, "Not written": a table of Question | Source | Why not written | What
the page needs first.
Close with the count in each part and confirm they match.

# Quality checks before you answer
- The visible section and the JSON-LD carry the same questions in the same
  order.
- Each acceptedAnswer text is the visible answer with markup removed and
  nothing else changed.
- Every question you wrote traces to a named source in the input.
- Every sentence traces to a supplied fact, and no number appears that was not
  supplied.
- The JSON parses: quoted keys, no trailing commas, escaped quotes inside
  answer text.
- No wording rule is broken in any answer.

# When the input is thin
If only two questions carry sources, write two: a short FAQ of real questions
beats a long one of guesses. If none carries a source, write
no FAQ and no JSON-LD: return the Not written table and name the sources that
would settle it, such as Search Console queries for this URL, support ticket
subjects or the on-site search log. If the page facts answer no sourced
question, say so and stop. Do not estimate a missing fact, and do not record
it as zero when the truth is that you were not told.

# Boundaries
Do not emit JSON-LD for a question absent from the visible section. Do not
promise a rich result, a ranking or traffic; markup makes a page eligible for
treatment it may never receive. Do not repeat a term to hit a count. Do not
answer a pricing, legal, medical or availability question from general
knowledge; an unsupplied fact is a gap, not a blank to fill.
```

## Variables

### page_url
Required. The canonical URL of the page the FAQ will live on. It anchors the JSON-LD @id, so a block copied onto a second page is visible as a mismatch rather than passing quietly.
Example: https://voltside.co.uk/ev-charging/apartment-buildings

### page_summary
Required. What the page covers plus the specific facts it states, as bullets. These are the only materials the answers may draw on, so include the numbers, the coverage area and the exclusions, and say plainly what the page does not state.
Example: Load-managed 7kW units; residents pay per kWh in the app; the page states no prices and no lead times

### reader_questions
Required. One question per line with where it came from: a Search Console query, a support ticket count, a sales call, the on-site search log. A question with no source is dropped, which is the point of the field.
Example: "Do we need the freeholder's permission?" - 6 of the last 9 survey booking calls

### existing_faq
Optional. The FAQ already published on the page, question and answer, so the output can tell you what to keep, rewrite or remove instead of silently duplicating it.
Example: "What is an EV charger?" - "An EV charger is a device that supplies electricity to an electric vehicle."

### answer_constraints
Optional. Brand spelling, regional English, claims that legal or sales will not allow, and anything that must never appear on this page.
Example: UK English; do not call the survey free, the fee is credited against the install

## How to use

The field that takes real work is `reader_questions`, and it is the one that decides whether the output is worth publishing. Pull queries for the URL out of Search Console, subject lines out of the support inbox, the on-site search log, and whatever the person who answers the phone remembers being asked twice a week. Paste the source next to each question. The prompt treats a missing source as a reason to drop the question, so pasting a tidy list you wrote from imagination produces an empty FAQ, which is the correct result.

In `page_summary`, write what the page states, then write what it does not state. That second half matters more than it looks. A model that is not told the page is silent on price will reach for a plausible range, and a plausible range in a schema block is a claim the business has to stand behind. Ending the summary with a line such as "the page states no prices and no lead times" is what turns those questions into flagged gaps instead of invented answers.

Check the output mechanically, not by eye. Copy each `acceptedAnswer` text out of the JSON and search for it in the page draft. The failure you will actually hit is not a hallucinated answer, it is tidying: the model retypes the sentence into JSON and quietly changes a comma, swaps "3 years" for "three years", or trims a qualifying clause because it reads better short. Then the schema states something the page does not, which is exactly the mismatch the whole prompt exists to prevent. If several answers drift, ask for Part 2 to be regenerated from Part 1 alone rather than rerunning the whole thing.

When the output invents a question anyway, the cause is almost always in the input rather than the model, so look there first for a question that arrived without a source. Before shipping, run the JSON through Google's Rich Results Test or the Schema Markup Validator, and check the rendered page rather than the draft, because an answer that only exists in a component the crawler never receives is not visible content.

## Example input

```text
Page URL: https://voltside.co.uk/ev-charging/apartment-buildings
What the page covers and the facts it states:
- Voltside installs shared EV chargers in residential apartment buildings in England and Wales.
- Every install starts with an on-site survey of about 90 minutes, checking the incoming supply, the meter position, and the distance from the intake to the parking bays.
- The units are load-managed 7kW chargers. Load management shares the building's spare capacity between chargers, so most buildings do not need a supply upgrade.
- Written consent is required from whoever holds the building's electrical supply, usually the freeholder or the managing agent. Voltside prepares the consent pack.
- Residents pay per kWh through the Voltside app. The building's supply account is not billed for charging.
- Chargers carry 3 years parts and labour.
- The page states no prices and no lead times.
Questions readers have been observed asking, and where each came from:
- "Do we need the freeholder's permission?" - 6 of the last 9 survey booking calls (sales notes, Feb to Apr)
- "Will the building need a supply upgrade?" - 5 support emails in March
- "Who pays for the electricity?" - 22 on-site searches for "who pays" on this page
- "Do you cover Scotland?" - 4 support emails
- "How much is it per parking bay?" - 11 support emails, highest volume question
- "How long does the install take once we sign?" - 3 survey booking calls
- "Is Voltside the best EV charger installer in the UK?" - drafted by marketing, no source
FAQ already published on the page:
- "What is an EV charger?" - "An EV charger is a device that supplies electricity to an electric vehicle."
Wording rules and claims that cannot be made: Write Voltside with a capital V and no space. UK English. Do not call the survey free; the fee is credited against the install, not waived. Prices and lead times are quoted per building and must not appear on the page.
```

## Example output

**FAQ section**

#### Do we need the freeholder's permission before Voltside can install?

Yes. Voltside needs written consent from whoever holds the building's electrical supply, which is usually the freeholder or the managing agent. Voltside prepares the consent pack for you to pass on.

#### Will the building need a power supply upgrade?

Usually not. The units are load-managed 7kW chargers that share the building's spare capacity rather than each drawing full power at once, so most buildings do not need an upgrade. The survey tells you whether yours is an exception.

#### Who pays for the electricity the chargers use?

Residents do. Each driver pays per kWh through the Voltside app for the energy they draw, and the building's supply account is not billed for charging.

#### Do you install in Scotland?

No. Voltside installs in England and Wales only.

**JSON-LD**

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "@id": "https://voltside.co.uk/ev-charging/apartment-buildings#faq",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Do we need the freeholder's permission before Voltside can install?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. Voltside needs written consent from whoever holds the building's electrical supply, which is usually the freeholder or the managing agent. Voltside prepares the consent pack for you to pass on."
      }
    },
    {
      "@type": "Question",
      "name": "Will the building need a power supply upgrade?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Usually not. The units are load-managed 7kW chargers that share the building's spare capacity rather than each drawing full power at once, so most buildings do not need an upgrade. The survey tells you whether yours is an exception."
      }
    },
    {
      "@type": "Question",
      "name": "Who pays for the electricity the chargers use?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Residents do. Each driver pays per kWh through the Voltside app for the energy they draw, and the building's supply account is not billed for charging."
      }
    },
    {
      "@type": "Question",
      "name": "Do you install in Scotland?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "No. Voltside installs in England and Wales only."
      }
    }
  ]
}
```

**Not written**

| Question | Source | Why not written | What the page would need first |
| --- | --- | --- | --- |
| How much is it per parking bay? | 11 support emails | Page states no prices; pricing is quoted per building | A line saying pricing is quoted per building after the survey |
| How long does the install take once we sign? | 3 survey calls | Page states no lead times | A range from operations, or a line saying the survey sets the date |
| Is Voltside the best EV charger installer in the UK? | Marketing draft, no source | Nobody was recorded asking it, and no supplied fact answers it | Nothing; it does not belong on the page |
| What is an EV charger? (published) | None | Live with no source behind it, on a page read by building managers | Remove it; the entries above cover what the page is asked |

**Counts:** 4 questions visible, 4 in the JSON-LD, answers identical.

**Notes:** the Scotland answer is one sentence because that is the whole of the supplied fact. The 3 years parts and labour warranty is on the page but nobody was recorded asking about it, so it stays in the body copy rather than becoming a question.

## Safety notes

Before this ships, check three things against the published page rather than the draft: that every fact in every answer is stated on the page, that each `acceptedAnswer` text can be found in the HTML the crawler receives, and that nothing in the answers contradicts a page the same site already publishes on price, coverage or terms. Answers rendered only after a click, or injected by a script the crawler does not run, are not visible content no matter how good the markup is.

The prompt does not claim the markup will earn a rich result, and you should not either. FAQPage markup makes a page eligible for a treatment Google has narrowed sharply, and eligibility is not a placement. What the prompt does claim is narrower and checkable: the questions came from somewhere real, the answers came from the page, and the schema says the same thing the reader sees.

## FAQ

### Is FAQ schema still worth adding when the rich result is mostly gone?

For most sites the SERP treatment is no longer the reason to do it. Google restricted FAQ rich results to a small set of well-known health and government sources, so assume your page will not get one and decide on the rest of the value: a visible section that answers what people ask, and a machine-readable version of those answers that is easy for any parser to lift cleanly. If a page only gets an FAQ because someone wants the markup, that is the wrong reason and it usually shows in the questions.

### What do I do with the questions it refused to answer?

Treat them as the most useful part of the output. A question with eleven support emails behind it and no answer on the page is a costed content gap, and the fix is a decision by a human: publish the price, publish the range, or publish a line saying it is quoted per building. Once someone has made that call and the page states it, rerun the prompt and the question moves into the FAQ. Filling it in yourself with a plausible-sounding answer converts a known gap into an unverified claim sitting inside structured data.

### Can I reuse one FAQ block across a set of similar pages?

No, and templated FAQ blocks are the most common way a site ends up with schema that does not match its pages. The markup describes the page it sits on, so if the block is identical across forty location pages while the visible text differs, some of those pages are now asserting things they do not say. If a question genuinely applies everywhere, it belongs on one page that everything else links to.

### What if the page is new and I have no questions to feed it?

Then the prompt will correctly return nothing, and that is the signal to go and get the evidence rather than to loosen the input. Half an hour with whoever answers sales calls or support tickets for the adjacent product usually produces four real questions, and pre-sales email threads are often better than any keyword tool because they contain the objection in the customer's own words. If none of that exists yet, publish the page without an FAQ and add one after the page has enough Search Console data to show what people typed to reach it.
