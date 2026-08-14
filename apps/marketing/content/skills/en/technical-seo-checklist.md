---
title: Technical SEO
description: Find what actually stops a site being crawled, rendered and indexed, separating a blocked URL from an undiscovered one from one deliberately left out.
tagline: Know why a page is missing from the index, not just that it is
category: technical
owner: tech
keywords: technical seo checklist, crawlability audit, indexation issues, canonical tag audit, xml sitemap validation, structured data validation, robots txt check
relatedSkills: seo-audit, internal-linking
relatedPrompts: seo-content-audit-prompt, internal-linking-suggestions-prompt
status: published
publishedAt: 2026-08-14
---

## Skill file

```text
---
name: technical-seo-checklist
description: Explain why specific URLs are missing from the index, separating blocked from undiscovered from deliberately excluded, using observed responses only. Use when pages are missing from Google, when someone asks about indexing, crawl budget, robots.txt, canonicals, or sitemaps, or when Search Console reports a URL as discovered but not indexed and the cause has not been established.
metadata:
  owner: GenGrowth Tech Agent
  source: https://gengrowth.ai/skills/technical-seo-checklist
---

# Technical SEO

Your job is to explain why specific URLs behave the way they do in search,
using responses you observed rather than causes you assumed. A page missing
from the index has several possible causes, and reporting one cause for all of
them is the most common way a technical review spends a sprint on nothing.

## What counts as evidence

Four sources, in descending order of trust:

1. Observed response — what the server returned when you requested the URL:
   status, headers, body. Reproducible right now, so it is the strongest
   evidence available. Record the user agent you used; the answer can depend
   on it.
2. Search engine report — URL Inspection and the page indexing report. This is
   what the engine did, which no fetch of yours can reveal. It lags by days and
   its example lists are capped, so read it as a state, not as a complete
   inventory.
3. Crawler output — a crawler's own summary across many URLs. Good for finding
   candidates at scale, but it reflects that crawler's settings: user agent,
   whether it executed JavaScript, how fast it went.
4. Inference — what you conclude from the above. Always labelled as inference,
   never merged into the first three.

If you did not observe a cause, do not name one.

## Four states, four kinds of evidence

Never report "not indexed" as a single problem. Split it:

- Blocked. A robots rule prevents the fetch. Evidence: the matching rule and
  the user agent it applies to. A blocked URL can stay indexed, and a noindex
  tag on a blocked URL is never read.
- Not discovered. Nothing points at the URL — no internal link in the crawled
  HTML, no sitemap entry, no redirect target. Evidence: absence from the link
  graph you built, not absence from a report.
- Deliberately excluded. The page is reachable and says not to index it: a
  robots meta tag, an X-Robots-Tag header, or a canonical pointing elsewhere.
  Evidence: the tag or header, quoted.
- Fetched and not selected. The engine retrieved the page and did not index it.
  Evidence: the engine's own report, and nothing else. You cannot observe the
  reason. State what you ruled out, then stop.

## Procedure

1. Read robots.txt and every sitemap it references. Record which rules apply to
   which user agents, and which URL patterns each rule actually matches.
2. Crawl from the homepage and build the internal link graph. Keep the raw
   result for every URL: final status, full redirect chain, response headers.
3. For each template, compare raw HTML with the rendered DOM. Note any link,
   canonical, or main content that exists only after JavaScript runs.
4. Reconcile the sets: sitemap members that nothing links to, linked URLs
   absent from the sitemap, and sitemap members returning anything but 200.
5. Classify every non-indexed URL into one of the four states, evidence
   attached. Leave a URL unclassified rather than guessing at it.
6. Check directives against each other: canonical target status, canonical host
   and protocol, canonicals pointing at noindexed pages, redirect chains longer
   than one hop, and 200 responses whose body is an error message.
7. Validate structured data twice per template — as markup (required
   properties, correct types, resolvable references) and against the page (does
   the page show what the markup asserts).
8. Order fixes by dependency, not by severity. Unblocking a path so its noindex
   becomes readable is a prerequisite, not a preference.

## Output

A table of URL patterns with state, the evidence for that state, and the fix.
Then contradictions, ordered by dependency. Then what you could not determine,
why, and what access would settle it.

## Refuse to

- Name a cause you did not observe.
- Scale a sampled state up into a count.
- Present a crawler's coverage summary as the search index's state.
- Substitute zero for a number you could not obtain.
- Promise a rich result, a ranking, a traffic number, or a timeline.
- Recommend a fix whose prerequisite has not been done first.
```

## What it does

Technical reviews usually arrive as one number and one cause: three thousand pages are not indexed, and it is crawl budget. The number is real. The cause is a guess, and it tends to be the same guess whatever the site. In practice that set breaks into URLs canonicalised away on purpose, URLs blocked by a rule nobody remembers adding, URLs nothing has ever linked to, and a remainder the engine fetched and passed over for reasons no tool reports. Treating four states as one produces a quarter of a sprint of useful work and three quarters of motion.

This skill separates them and holds each to its own evidence. Blocked means a quoted rule and the user agent it matches. Not discovered means absence from a link graph the agent actually built, not absence from a report. Deliberately excluded means the tag or header, quoted. Fetched and not selected means the engine's own report and nothing further — the reason is not observable, so the skill names what it ruled out and stops rather than supplying a plausible story.

Contradictions get treated as findings in their own right, because most technical fixes have a required order. A noindex tag on a path disallowed in robots.txt is never read, so removing the tag first changes nothing; the block has to come off before the tag can do its job. The same applies to canonicals aimed at redirecting or noindexed URLs, and to sitemaps listing pages the site has already canonicalised away.

Rendering is checked rather than assumed. The agent diffs the raw HTML against the rendered DOM and reports which links and directives exist only after JavaScript runs, so nobody has to argue from what a browser tab looked like.

## In action

### You ask

We run harborlight-outdoors.com, roughly 4,000 URLs. Search Console shows about 1,100 indexed. Our developer says it is crawl budget and wants to trim the sitemap. Is that the right fix?

### The agent does

The unindexed URLs are not one problem, and nothing I observed points at crawl budget.

1,842 are product variant URLs carrying ?color= and ?size=. They return 200 and each canonicalises to the clean product URL. That is deliberate exclusion working as designed. Trimming the sitemap does not touch them, because they are not in the sitemap.

410 URLs under /guides/ are blocked — robots.txt disallows /guides/ for all user agents. Those pages also carry a noindex meta tag, which is never read while the path is blocked, so any that were indexed before the block can remain indexed indefinitely. The block has to come off first and the noindex read second. The reverse order accomplishes nothing.

287 sitemap URLs are linked from nowhere in the site's own HTML. The crawl reached them only through the sitemap file. This is the genuine discovery problem, and it is where the developer's time goes.

That leaves about 360 I classified as fetched and not selected. I inspected 20; URL Inspection is quota-limited per property per day, so I do not have that state for the rest and I have not scaled the sample into a count.

Ordering is by evidence strength rather than size: the blocked set is smaller than the variant set but is the only place the site contradicts itself.

## How it works

### Map the crawl surface first

The agent reads robots.txt and every sitemap it references, recording which rules apply to which user agents and which URL patterns each rule actually matches. This comes before any judgement about a page, because a rule blocking a path changes what every other signal on those pages can mean.

### Fetch and keep the raw response

It crawls from the homepage and stores the final status, the full redirect chain and the response headers for every URL, alongside the internal link graph. Directives live in headers as often as in markup — an X-Robots-Tag never appears in a page's source — so a review that reads only the body misses them.

### Compare source with rendered DOM

For each template, the agent diffs the raw HTML against the rendered DOM and notes which links, canonicals and main content appear only after JavaScript runs. This is what separates "the page looks fine in my browser" from "the crawler received a shell", and the two need different fixes.

### Classify, then order by dependency

Every non-indexed URL gets one of the four states with its evidence attached, and anything that fits none is left unclassified rather than assigned a cause. Fixes are then sequenced by what must happen first, so the report reads as an order of operations instead of a severity list.

## What it covers

- Robots rules and meta or header directives, read per user agent, with the URL patterns each rule actually matches
- Status code observation across the crawl, including redirect chains, redirects to irrelevant targets, and 200 responses whose body is an error
- Raw HTML against rendered DOM, for links, canonicals and main content that exist only after JavaScript
- Canonical consistency: self-reference, host and protocol mismatches, canonicals aimed at redirecting or noindexed URLs, and conflicts with the sitemap
- Sitemap validity: non-200 members, canonicalised-away members, orphan members, and lastmod values that change on every build and therefore carry no signal
- Structured data checked twice — as markup for required properties and types, and against the page for anything the markup asserts but the page does not show

## When to use it

- A large share of a site's URLs sit in the not-indexed report and nobody has separated them by cause
- A site changed host, framework or URL structure and nobody has checked what the new stack returns to a crawler
- Pages look correct in a browser but the source HTML is nearly empty, and no one has established which version the crawler receives
- A rich result stopped appearing and the markup has not been read since the day it was added
- Someone has proposed a crawl budget fix and there is no evidence about which URLs were fetched at all

## FAQ

### How is this different from the SEO Audit skill?

The audit asks whether a page that is already in the index can compete: what it covers, who it is for, how it is written and linked. This skill asks the prior question — whether the page can be fetched, indexed and parsed at all. There is no point rewriting a page the crawler never receives, so this runs first and hands the audit a set of URLs that are genuinely in play.

### Why will it not tell me why a page was crawled and then not indexed?

Because that decision belongs to the search engine and no report states its reason. The skill can prove the page was reachable, returned 200, was not blocked and was not excluded by a directive — which rules out four causes. Naming a fifth would be a guess dressed as a finding, and a guess in that slot sends a team off to fix something that was never wrong.

### Does it need Search Console access?

It does more with it. Without it, the agent can still observe everything a request reveals: status codes, headers, robots rules, canonicals, rendering and sitemap integrity. What it cannot see is what the engine did with a URL it discovered, and in that case the report says so plainly rather than passing a crawler's own coverage summary off as the index's state.

### Will it tell me whether I qualify for a rich result?

No. Validity is observable and eligibility is not — the markup can be correct in every required property and a search engine may still show nothing. The skill reports whether the markup parses, whether required properties are present and typed correctly, and whether the page actually shows what the markup claims. It does not promise the result appears.
