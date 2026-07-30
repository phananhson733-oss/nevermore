# GenGrowth marketing application

`apps/marketing` contains the public `gengrowth.ai` experience migrated from
the former `gengrowth-agents` repository. It is intentionally separate from
`apps/web`: the latter remains the authenticated SignalFrame product workbench,
while this app owns the public website, locale routing, SEO metadata, content
pages, calculators, trial and waitlist forms.

## Local development

Run `pnpm --filter @sf/marketing dev` and open `http://127.0.0.1:3001`.
The root request redirects to the English locale; the full site is available
under `/en` and `/zh`.

## Production deployment

Create or update the Vercel project serving `gengrowth.ai` with this monorepo
as the repository and `apps/marketing` as its Root Directory. The public app
must not be deployed from `apps/web`, which is the authenticated product app.

Configure these production environment variables from the already-migrated
GenGrowth Supabase and email setup:

- `NEXT_PUBLIC_APP_URL=https://gengrowth.ai`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_POSTAL_ADDRESS`, and
  `UNSUBSCRIBE_SECRET` when email delivery is enabled

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

The remaining Supabase data contract is unchanged: `glossary_terms`,
`legal_documents`, `legal_document_versions`,
`waitlist_subscribers`, `trial_applications`, `contact_submissions`,
`consent_events`, `change_logs`, and `link_redirects`. Glossary pages retain
their existing data behavior; only formal blog publishing has moved to the
repository-backed content system.
