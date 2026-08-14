---
title: AI Answer Visibility
description: Work out where AI assistants actually source their answers, fix what blocks retrieval on your pages, and target the off-site references that citations track.
tagline: Find out who AI assistants cite for your topics, and why it is not you
category: geo
owner: seo
fileName: geo-ai-visibility.md
keywords: ai visibility, generative engine optimization, ai overview citations, llm citation tracking, ai answer monitoring, geo seo skill, brand mentions in ai answers
relatedSkills: on-page-seo, content-brief
relatedPrompts: geo-ai-overview-optimization-prompt, faq-generation-schema-prompt
status: published
publishedAt: 2026-08-14
---

## Skill file

```text
---
name: geo-ai-visibility
description: Measure where AI assistants source answers on a topic, fix retrieval blockers on the site, and identify the off-site references that citation depends on.
owner: GenGrowth SEO Agent
---

# AI Answer Visibility

Your job is to find out who AI assistants currently cite for a set of
questions, why, and what would have to change. You do not promise that a
page edit will produce a citation, because on its own it usually does not.

## What counts as evidence

Four sources, in descending order of trust:

1. Captured answers — an assistant response you ran and recorded, with the
   exact prompt, the date, the assistant, and every domain it cited.
2. Off-site references — third-party pages that name the brand, each one a
   URL you can open.
3. Server logs — requests from assistant crawler user agents, verified by
   reverse DNS or published IP ranges, proving a page was fetched.
4. Vendor visibility scores — third-party estimates of AI share of voice.
   These are estimates. Label them as estimates every time they appear.

Assistant answers vary between runs, accounts, and regions. One capture is a
sample, not a measurement. Report a capture rate with its sample size and
date ("cited in 2 of 24 captures, 2026-08-11"), never a bare yes or no.

If referral data, crawler logs, or a citation count is not available, write
that it is unavailable and say why. Do not write zero. Zero means you looked
and found none; unavailable means you could not look.

## Procedure

1. Build the question set. Write 20 to 30 questions a real buyer would type
   into an assistant, in their words, covering definitions, comparisons,
   pricing, and troubleshooting. These are questions, not keywords.

2. Capture the baseline before changing anything. Run every question at
   least twice, on each assistant that matters for the market. Record date,
   assistant, prompt, whether an answer was produced, every cited domain and
   URL, and how the topic was characterised.

3. Read the citation pattern. Group cited domains by type: government or
   standards bodies, trade publications, third-party roundups and
   directories, vendor documentation, community threads. The mix tells you
   which surface is actually winnable and which is not worth contesting.

4. Check retrieval preconditions on the site. Confirm the answer text exists
   in the server-rendered HTML, that robots rules and edge protection do not
   block assistant crawlers you want, and that pages return a stable
   canonical URL. Failing these guarantees no citation. Passing them does not
   produce one.

5. Fix extractability. Each page should answer its question in the opening
   lines, make claims that survive being lifted out of context, name the
   entity instead of writing "we", date anything time-sensitive, and use
   headed tables for comparisons. Attribute figures to their source inline.

6. Plan the off-site work, ordered by what the captures actually named. Being
   cited tracks being referenced elsewhere. Target the specific roundups,
   directories, publications, and community threads that appeared in your own
   captures, plus first-party data others have a reason to cite.

7. Re-capture on a fixed schedule with identical prompt wording. Report the
   change in capture rate with sample sizes on both dates.

## Output

A capture log (date, assistant, prompt, cited domains, site cited yes/no); a
citation-source breakdown by domain type; a retrieval and extractability
finding list with the page and the specific blocker; an off-site target list
ordered by how often each domain appeared in the captures; and a list of what
could not be determined and what access would settle it.

## Refuse to

- Promise that on-page changes will produce a citation.
- Report a single capture as proof of presence or absence.
- Report zero where a number was never sampled or is inaccessible.
- Present a vendor visibility score as a measured citation count.
- Claim an assistant crawled a page without a verified log line.
- Promise rankings, traffic, revenue, or a timeline.
- Recommend a keyword density or a repetition count.
```

## What it does

The common failure is treating AI visibility as an on-page checklist. A team adds FAQ markup, a summary box at the top of each page, and a few sentences written to sound quotable, ships it, then asks an assistant one question. If the brand appears, the work is declared successful; if it does not, the work is declared broken. Neither conclusion follows from one sample. The one case we watched closely was a site with no meaningful off-site presence, where the page changes went in and citations did not follow. That is one observation rather than a measured effect, and it is why this skill treats off-site references as the part worth working on rather than promising citations from page edits.

This skill is built around that observation. It treats on-page extractability as a precondition rather than a lever: if the answer is not in the served HTML, or a crawler is blocked at the edge, no amount of off-site work reaches it. But it does not stop there, and it will not tell you that rewriting an intro paragraph is a path to being cited. The larger half of the output is off-site: which publications, roundups, directories, and threads the assistants are actually pulling from for your questions, taken from your own capture log rather than assumed.

Measurement is handled the same way. Assistant answers move between runs and accounts, so the unit of reporting is a capture rate with a sample size and a date, not a claim of presence. Where referral data or crawler logs are unavailable, the output says unavailable and names the access that would close the gap, instead of reporting a zero that reads like a finding.

## In action

### You ask

We are meridian-payroll.com — payroll software for UK construction subcontractors. We rewrote all our guide pages for AI last month and added FAQ schema. Are we showing up in AI answers yet?

### The agent does

I ran 24 buyer questions twice each across two assistants on 2026-08-11, so 96 captures. Your domain appeared in 3.

The pattern is more useful than the count. Questions about CIS deductions and verification (11 of the 24) cite HMRC guidance in almost every capture, with a trade publication second. That surface is not realistically contestable and I would not spend on it. The comparison and selection questions — "best payroll software for CIS subcontractors", "payroll software that handles CIS returns" — behave differently: they route through four roundup pages, three of which do not list Meridian at all. Your three appearances all came from the fourth.

Two retrieval problems are real. Your pricing page renders its table client-side, so the fetched HTML contains no figures. And your comparison pages describe "our platform" without naming Meridian in the sentence that carries the claim, which does not survive being lifted out of the page.

Referral sessions from assistant hosts are unavailable — this property groups those referrers under direct, and I will not report that as zero. A referrer-level export would settle it.

Fixing the two page problems removes blockers. Getting listed in the three roundups is the part that plausibly changes the count.

## How it works

### Capture the baseline before changing anything

The agent writes 20 to 30 questions in buyer language, runs each of them more than once across the assistants that matter for the market, and logs every cited domain verbatim with the date and prompt. Nothing is edited before this exists, because without a baseline no later change can be attributed to anything.

### Read who gets cited, not just whether you do

Cited domains are grouped by type — government and standards bodies, trade press, roundups and directories, vendor documentation, community threads. A question set dominated by statutory guidance is a different problem from one dominated by third-party comparison pages, and only the second is usually worth contesting.

### Clear the retrieval preconditions

The agent checks that the answer text is present in the server-rendered HTML, that robots rules and edge protection are not blocking the crawlers you intend to allow, and that canonical URLs are stable. These are reported as blockers, not as improvements, because passing them does not earn a citation on its own.

### Work the surfaces the captures named

The off-site plan is built from the capture log rather than from a generic list: the specific roundups, directories, publications, and threads that already appear for your questions, plus first-party data other people have a reason to reference. Re-capture runs on the same prompts so the change is measured against a like-for-like baseline.

## What it covers

- Buyer-language question sets for assistant capture, separated from keyword lists
- Repeated multi-assistant capture logging with dates, prompts, and every cited URL
- Citation-source analysis by domain type, to separate contestable from statutory surfaces
- Retrieval precondition checks: server-rendered answer text, crawler access, canonical stability
- Extractability review of claims that must stand alone when lifted out of a page
- Off-site target lists drawn from your own captures, ordered by how often each domain appeared
- Capture-rate reporting with sample sizes, and explicit unavailable-data flags

## When to use it

- A team has rewritten pages "for AI" and has no baseline to compare against
- Someone asked an assistant one question, got no mention, and concluded the site is invisible
- A site publishes steadily but nothing external ever references it
- Buyers report that an assistant recommended competitors and nobody knows which sources it used
- A vendor AI visibility score exists and no one can say what it sampled or when
- Pages render their key figures client-side and nobody has checked what a crawler receives

## FAQ

### How is this different from the On-Page SEO skill?

On-page SEO works on a page that already has search visibility and finds what is limiting it. This skill starts from captured assistant answers and works backwards to why a source is cited, which usually points off the page entirely. They overlap on one thing: server-rendered, extractable content is a requirement for both. Where they part is that on-page work can move a ranking on its own, whereas in the one case we watched closely, page edits alone were not followed by citations.

### Will adding FAQ schema get us cited?

Structured data helps a machine parse a page and is worth having, but we have not measured what it does on its own; on the one site we watched closely, which had no off-site presence, adding it was not followed by citations. Treat it as removing an obstacle. If your question set shows assistants citing roundups and trade publications for your topics, the schema on your own page is not what decides which of those sources gets quoted.

### Why does the report give a capture rate instead of saying whether we are visible?

Because assistant answers are not stable. The same prompt can return different sources across runs, accounts, and regions, so a single yes or no is a sample presented as a fact. A rate with a sample size and a date can be compared against the next run honestly, and it makes it obvious when a change is smaller than the noise.

### Can it tell us how much traffic AI assistants send us?

Only if the analytics property can distinguish those referrers, and many cannot — assistant traffic is frequently bucketed as direct. When that is the case the skill reports the figure as unavailable and names what would settle it, such as a referrer-level export or a UTM convention on links you control. It will not estimate the number and present it as measured.
