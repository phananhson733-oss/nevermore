# GenGrowth marketing application

`apps/marketing` contains the public `gengrowth.ai` experience migrated from
the former `gengrowth-agents` repository. It is intentionally separate from
`apps/web`: the latter remains the authenticated SignalFrame product workbench,
while this app owns the public website, locale routing, SEO metadata, content
pages and calculators. Product CTAs go to `https://app.gengrowth.ai`; this
marketing deployment does not operate a separate trial or waitlist capture
system.

## Local development

Run `pnpm --filter @sf/marketing dev` and open `http://127.0.0.1:3001`.
The root request redirects to the English locale; the full site is available
under `/en` and `/zh`.

## Production deployment

The Vercel project serving `gengrowth.ai` must use this monorepo, production
branch `main`, the `apps/marketing` Root Directory, the Next.js preset and
Node.js 24.x. The public app must not be deployed from `apps/web`, which is the
authenticated product app.

Set `BLOG_LEGACY_SUPABASE_ENABLED=false` for Preview and Production after the
legacy blog migration is verified. No Supabase or Resend credentials are needed
for the present public-site release. Do not copy the authenticated-product
environment variables into this project merely because both applications share
a repository.

Until a new, migrated lead-capture data contract and email sender have been
explicitly enabled, `/api/contact`, `/api/trial` and `/api/waitlist` deliberately
return `503 LEAD_CAPTURE_UNAVAILABLE`. The contact page uses
`hello@gengrowth.ai` directly and the conversion CTAs open the existing product
application. This protects the retired Supabase project from new writes and
prevents promises of an email workflow that is not configured.

## Blog content and media

The marketing blog's canonical source is repository-backed Markdown, not
`blog_posts.content`. Author one file per language in
`apps/marketing/content/blog/{en,zh}/<slug>.md`; the shared
`/[locale]/blog/[slug]` route renders it into sanitized, server HTML and uses
the same source for blog lists, category pages, RSS, sitemap and Article
metadata. The frontmatter contract and image conventions are documented in
[`apps/marketing/content/blog/README.md`](../apps/marketing/content/blog/README.md).

Small, reviewed and versioned images can live under
`apps/marketing/public/images/blog/<slug>/` and are referenced by root-relative
URLs in Markdown. Never write image binaries/Base64 to Postgres. When editorial
uploads or large media require object storage, upload the object to Supabase
Storage or R2 while preserving its URL in Markdown; the article schema and
public route do not change.

`BLOG_LEGACY_SUPABASE_ENABLED=true` enables a **temporary, read-only** bridge
for existing `blog_posts` rows. A local article wins when it has the same
`locale + slug`; errors from the bridge never fall back to mock content. Keep
the bridge enabled until every published legacy URL is exported, converted,
reviewed and deployed. Then set it to `false`, verify sitemap/RSS/redirect
parity, and remove the bridge in a later change.

The old Supabase tables for `waitlist_subscribers`, `trial_applications` and
`contact_submissions` are not a runtime dependency of this release. Before
re-enabling them, migrate and verify the intended data schema and RLS in the
active project, add abuse protection, and configure the email sender. Glossary
and legal-page data behavior remains unchanged; formal blog publishing has
moved to the repository-backed content system.
