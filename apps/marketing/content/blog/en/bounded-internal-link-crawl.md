---
title: What a Bounded Internal Link Crawl Can Prove
excerpt: A practical way to read a public internal-link crawl: what its observed HTML paths can show, what a candidate orphan means, and what still needs human review.
author: GenGrowth Team
category: methodology
pillar: seo_content
status: published
publishedAt: 2026-07-30
updatedAt: 2026-08-12
heroImage: /images/blog/bounded-internal-link-crawl.jpg
heroImageAlt: Technical line illustration: a flashlight beam bounded by two thin lines, the boxes inside it drawn solid and the boxes outside it dashed
localeExclusive: false
---

An internal-link audit is useful when it narrows a structural question. It is
not a substitute for a full crawler, a Search Console property, or editorial
judgment. The useful question is smaller: **which public HTML paths did this
specific crawl observe, and where should a person investigate next?**

That distinction keeps the result actionable. A public audit can collect a
bounded sample of pages, their same-origin HTML links, and sitemap URLs when
they are available. It can then show a relationship map instead of pretending
to know the entire website.

## Start with observed paths, not a promise of complete coverage

Google explains that crawlable links help it find other pages, and that anchor
text helps people and Google understand a site. That is why an audit should
record the actual source page, target, and anchor text it encountered, rather
than only returning a count. Read Google's [link best practices](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)
for the underlying crawlability requirements.

In GenGrowth's Tech Agent, the crawl reads static, same-origin HTML and has
no normal-use scan quota or fixed customer-facing page allowance. Each online
run still has technical processing boundaries for elapsed time, request and
response volume, redirects, concurrency, and host pacing. Those boundaries
protect the live service; they are not a quality score. They mean a result can
say:

| Observation | What it supports | What it does not support |
| --- | --- | --- |
| A link from page A to page B was collected | That one static HTML path existed during this request | That every version of the site links this way |
| A sitemap URL was not reached through observed links | A candidate orphan worth checking | That the URL is absent from all navigation or JavaScript-rendered UI |
| A page is four observed hops from home | The sampled graph has a long route to that page | A claim about Google's exact crawl priority or PageRank |

This makes a bounded audit particularly useful after a migration, navigation
change, URL restructure, or large publishing batch. You are checking whether
the paths you expect are still visible in a real, public request.

## Treat “candidate orphan” as a review queue

A sitemap is a list of URLs a site owner considers important. Google notes
that a sitemap can help discovery, especially on larger or more complex sites,
but it does not guarantee that a URL will be crawled or indexed. It also notes
that a comprehensively internally linked site can make important pages
discoverable without relying on a sitemap. See Google's [sitemap overview](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview).

That gives a good operational definition for a candidate orphan in a bounded
audit: a URL appears in the sitemap, but the current static-HTML crawl did not
reach it through an observed internal link. It is a prompt to inspect, not an
instruction to add a link.

For each candidate, use this short decision sequence:

1. **Should the page remain public?** A duplicate, expired, or thin page may
   need consolidation or retirement rather than more links.
2. **Is the page reachable in another legitimate way?** Check pagination,
   language variants, client-rendered navigation, and the intended template.
3. **Which source page gives a reader a natural reason to continue?** Add a
   contextual link where the target answers the next question; do not add a
   token link simply to change a count.
4. **How will you verify the change?** Re-run the bounded crawl and review the
   edited source URL, target URL, and anchor text.

## Keep JavaScript and robots limits visible

A static-HTML crawl is deliberately conservative. Client-side links that
appear only after JavaScript runs may not be in the collected document. Treat
an unexpected finding on a heavily rendered application as a hypothesis, then
verify it in the browser and in the product's own navigation.

The audit also respects `robots.txt`. That file tells crawlers which URLs they
may request; it is not a way to guarantee that a URL will never appear in
search. Google's [robots.txt guide](https://developers.google.com/search/docs/crawling-indexing/robots/intro)
explains the distinction. If a path cannot be fetched during an audit, the
right conclusion is “not inspected,” not “bad page” or “not indexed.”

## Turn the report into one reviewable change

Pick a single structural finding with a clear source page and target page. Put
the proposed link in context, record why the target matters, and choose a
review window. The goal is not to maximize the number of links. It is to make
the important paths on a site understandable for readers and observable in
your own maintenance process.

Run the [Tech Agent](/agents/tech) when you have a public site to inspect. A
verified GenGrowth account is required, but no Search Console connection or
site-ownership verification is needed. The Agent reads public static HTML, and
the marketing run is intentionally not saved to an app project, so use the
result as evidence for a decision—not as an automatic change list.
