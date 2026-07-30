# GenGrowth Blog Content

`en/` and `zh/` hold the canonical, versioned source for public GenGrowth blog
articles. One lowercase, hyphenated `slug.md` file maps to exactly one public
route: `/{locale}/blog/{slug}`. The route is shared; never create a bespoke
React page or raw HTML file for an article.

Each file uses scalar frontmatter followed by standard GFM Markdown:

```md
---
title: A concise, searchable title
excerpt: One or two sentence summary for cards and metadata.
author: GenGrowth Team
category: methodology
pillar: growth_automation
status: published
publishedAt: 2026-07-30
updatedAt: 2026-07-30
heroImage: /images/blog/my-article/hero.webp
heroImageAlt: Descriptive alternative text.
localeExclusive: false
---

## The article
```

The initial legacy migration retains its already-published sanitized HTML bodies
inside `.md` files to avoid changing copy, tables, or links during the cutover.
That HTML goes through the same strict allow-list as rendered Markdown; it is a
lossless migration boundary, not a format for new authoring. New and revised
articles should use GFM Markdown. The generated source and per-route checksums
are recorded in `docs/marketing-blog-migration.md`.

Required keys are `title`, `excerpt`, `author`, `category`, `status`,
`publishedAt`, `heroImage`, and `heroImageAlt`. `pillar`, `updatedAt`, and
`localeExclusive` are optional. Valid categories and pillars are validated by
`src/lib/blog-content.ts` at build/render time; invalid or unknown keys fail
the build instead of silently producing a malformed article.

Article media is never stored as binary or Base64 in Postgres. Keep small,
reviewed, versioned assets adjacent to the article conventionally under
`public/images/blog/<slug>/`, use a root-relative URL in Markdown, and include
accurate alt text. `heroImage` accepts either a root-relative, traversal-free
path or an HTTPS URL. For future editorial uploads or larger media, move only
the object to Supabase Storage or R2 and retain the same HTTPS/root-relative
URL in the Markdown source; the article format and routes must not change.

`BLOG_LEGACY_SUPABASE_ENABLED` governs the temporary read-only migration bridge
for legacy `blog_posts` records. Local Markdown always wins for an identical
`locale + slug`. Leave the bridge enabled until every published legacy URL has
been exported, converted, reviewed, and deployed; then set it to `false` and
eventually remove the legacy branch. Database errors never fall back to mock
articles.
