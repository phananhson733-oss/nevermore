# GenGrowth marketing application

`apps/marketing` contains the `gengrowth.ai` acquisition experience migrated
from the former `gengrowth-agents` repository. It is intentionally separate
from `apps/web`: the latter remains the canonical authenticated GenGrowth
product workbench, while this app owns the website, locale routing, SEO
metadata, content pages, supporting public tools, and the registration-gated
SEO / Tech Agent acquisition surfaces. Agent runs on this host are bounded,
non-canonical and non-persistent; they do not create an app project or claim an
app analysis run occurred. The product app is not currently open, so public
marketing CTAs stay on `gengrowth.ai`: shipped work goes to the public Agents
or tools, while broader-product interest goes to the in-site waitlist and its
hardened `/api/waitlist` endpoint.

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
legacy blog migration is verified. The current marketing application does need
its own explicitly provisioned Supabase/Auth and public-tool infrastructure:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the
  Google/Supabase session used by registration-gated Agent routes;
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` for the existing Google Identity button;
- `SESSION_COOKIE_DOMAIN=gengrowth.ai` in production when one Supabase session
  is intentionally shared with `app.gengrowth.ai`;
- the marketing deployment's existing server-side Supabase configuration for
  durable public-tool quota and completed-crawl cache RPCs.

Do not copy unrelated authenticated-product secrets into this project merely
because both applications share a repository. In particular, the marketing
site's sealed `gg_*` Google/Search Console cookies are host-scoped and are not
app authentication or app workspace authority. Resend is not required for the
current waitlist-only closure.

The Agent access gate is the Supabase user returned by
`supabase.auth.getUser()`, checked before request parsing or crawl admission.
Google sign-in requests identity data only; it is not Gmail mailbox access.
The implementation and acceptance boundary is recorded in
[`docs/plans/2026-08-12-marketing-seo-tech-agents-mvp.md`](plans/2026-08-12-marketing-seo-tech-agents-mvp.md).

The current lead-capture split is deliberate:

- `/api/waitlist` is the hardened marketing-domain waitlist endpoint. It uses
  `createAdminSupabaseClient()`, rate limits by IP, stores to
  `waitlist_signups`, and fails closed with `503 LEAD_CAPTURE_UNAVAILABLE`
  until the owner applies
  `apps/marketing/supabase/migrations/0003_waitlist_signups.sql` to the active
  marketing Supabase project and provisions either `SUPABASE_SECRET_KEY` or
  the compatible `SUPABASE_SERVICE_ROLE_KEY` server-side variable.
- `/api/trial` stays `503 LEAD_CAPTURE_UNAVAILABLE`; this release does not
  promise or start a trial flow on the marketing domain.
- `/api/contact` stays `503 LEAD_CAPTURE_UNAVAILABLE`; the contact page uses
  `hello@gengrowth.ai` directly instead of writing to the retired project.

That split protects the retired Supabase project from new writes while still
allowing a minimal waitlist-only closure once the production migration and
admin-secret authority are in place. Email sender authority remains separate:
the current waitlist flow does not require Resend, and no production email
promise should be made until sender configuration is explicitly approved.

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
`locale + slug`; errors from the bridge never fall back to mock content. The
preserved legacy seed corpus has been migrated in full: 15 published rows and
2 drafts. Keep the bridge disabled unless an independently recovered database
export reveals a published URL outside that audited corpus; otherwise, verify
sitemap/RSS/redirect parity and remove the bridge in a later change.

The old Supabase tables for `waitlist_subscribers`, `trial_applications` and
`contact_submissions` are not a runtime dependency of this release. Before
re-enabling them, migrate and verify the intended data schema and RLS in the
active project, add abuse protection, and configure the email sender. Glossary
and legal-page data behavior remains unchanged; formal blog publishing has
moved to the repository-backed content system.
