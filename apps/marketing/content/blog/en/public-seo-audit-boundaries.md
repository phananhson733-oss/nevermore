---
title: Sitemaps, robots.txt, and the Limits of a Public SEO Audit
excerpt: Learn what an account-gated SEO Agent can inspect from public static HTML, why sitemap and robots checks are useful, and where a public scan must stop.
author: GenGrowth Team
category: methodology
pillar: seo_content
status: published
publishedAt: 2026-07-30
updatedAt: 2026-08-12
heroImage: /images/blog/public-seo-audit-boundaries.jpg
heroImageAlt: Technical line illustration: a tall solid fence across the frame with one small open viewing window cut into it, simple building silhouettes visible through the window and nothing else
localeExclusive: false
---

A public SEO audit should earn trust by being precise about its boundary. With
only a public URL, a tool can inspect what an unauthenticated request can
retrieve. It cannot see Search Console performance, private server logs,
conversion data, or every page rendered behind an application session.

That is not a weakness when the scope is stated clearly. It is a useful first
step: a bounded, reproducible check of discoverable same-origin public static
HTML and the standard files around it.

## What a public request can actually inspect

For an accessible URL, a bounded crawl can read the response and check visible
technical and on-page signals. GenGrowth exposes those facts through two
independent views: the SEO Agent reports observed metadata, heading structure,
and structured-data conditions; the Tech Agent reports observed crawl,
indexability, and internal-link conditions. Both retain the collected coverage
and whether `robots.txt` and `sitemap.xml` were fetched. The result separates
measured checks from checks that were unavailable or outside the scan.

This is enough to answer practical first questions:

- Did the submitted URL return a reachable page or a redirect?
- Does the static response contain a title, description, and clear heading?
- Are static indexability, canonical, or internal-link conditions visible in
  the collected technical evidence?
- Were the standard robots and sitemap resources fetched, unavailable, or
  outside the bounded scan's scope?

It is not enough to claim that a page is indexed, ranks for a query, or is
responsible for a traffic change. Those questions need data a public request
does not have.

## A sitemap is a discovery aid, not an indexing receipt

Google describes a sitemap as a file that provides information about the pages
and files a site considers important. It can improve discovery on larger or
more complex sites, but it does not guarantee that a listed URL will be
crawled or indexed. The full explanation is in Google's [sitemap overview](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview).

That is why an audit should report a missing sitemap as a useful observation,
not a verdict about search visibility. A small, well-linked site may not need
one. A larger site may benefit from one even when its internal linking is
healthy. The right next action depends on the site's size, content model, and
whether important pages are reachable through ordinary navigation.

## robots.txt manages fetching, not search visibility

`robots.txt` is another file that is often given more meaning than it can
carry. Google says it communicates which URLs a crawler may request and is
mainly used to manage crawling traffic; it is not a reliable way to keep a web
page out of Google Search. For that, the page needs an appropriate indexing
control such as `noindex`, with the crawler still able to read it. See the
[Google robots.txt guide](https://developers.google.com/search/docs/crawling-indexing/robots/intro).

In a public audit, the useful result is therefore specific:

| Observation | Good next question |
| --- | --- |
| `robots.txt` is reachable | Does it intentionally allow the pages that should be fetched? |
| `robots.txt` is missing | Is there a concrete crawl-management need before adding one? |
| A page appears disallowed | Is the desired outcome “avoid fetching” or “avoid indexing”? Those are different controls. |
| The file cannot be retrieved | Is the site public, stable, and returning a normal response to unauthenticated requests? |

## Use a coverage statement before acting on a score

One overall number is tempting, but it can hide the most important fact: how
much was checked. A transparent public audit should distinguish three states:

1. **Measured** — the request retrieved the required public evidence.
2. **Unavailable** — the required public file or response could not be read.
3. **Outside scope** — the question requires authenticated product data or a
   wider crawl.

For example, a page can have a valid title and still have low search traffic.
The first is observable from HTML; the second needs performance data. Keeping
those statements apart gives a team a cleaner handoff to its next diagnostic.

## Pick the next tool by the unanswered question

Run the [SEO Agent](/agents/seo) when you want a bounded review of on-page
signals. Run the [Tech Agent](/agents/tech) when the question is structural and
needs a bounded relationship map. Both require a verified GenGrowth account,
read public static HTML without Search Console or site-ownership access, and do
not save the marketing run to an app project. Move to a connected project only
when the decision requires data that a public request cannot honestly prove.
