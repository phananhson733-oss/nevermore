# GenGrowth public-site launch — 2026-07-30

## Scope

This release owns the public `gengrowth.ai` marketing site only. It does not
change, deploy, migrate, or validate `app.gengrowth.ai`, Supabase databases, or
Resend/email delivery.

## Release identity

| Item | Evidence |
| --- | --- |
| GitHub repository | `phananhson733-oss/nevermore` |
| Production branch | `main` |
| Marketing source root | `apps/marketing` |
| Vercel project | `gengrowth-agents` |
| First public-site code release | `1e393e24c9583460edf4b2e3683de7ba5bdac053` |
| Production deployment | `dpl_22niLiWFwU3S14kVP1CGQ3PQkidU` |
| Deployment inspector | `https://vercel.com/wzbs-projects-39a68c1d/gengrowth-agents/22niLiWFwU3S14kVP1CGQ3PQkidU` |

Vercel is linked to `phananhson733-oss/nevermore`, tracks `main`, uses the
Next.js preset with Node.js 24.x, and permits source files outside
`apps/marketing` for its workspace dependencies. The Ready production deployment
above owns `https://gengrowth.ai` and `https://www.gengrowth.ai`.

## Product decisions in this release

- The canonical blog source is repository-backed Markdown. The 13 published
  legacy articles were imported from the available historical SQL seeds in
  `0ede753077d8dffb5c21c1b3428746e61bda2caf`; the original Supabase project
  was inactive and was not modified.
- `BLOG_LEGACY_SUPABASE_ENABLED=false` is configured for Preview and Production.
  The public blog does not query the retired project at request time.
- Trial and waitlist CTAs open the existing `https://app.gengrowth.ai` product
  entry point. The public site's former form APIs return
  `503 LEAD_CAPTURE_UNAVAILABLE`, so they cannot write to the retired Supabase
  data source or attempt email delivery.
- The contact page offers the configured direct email address
  `hello@gengrowth.ai` rather than a nonfunctional database-backed form.
- The locale layout publishes the correct RSS discovery link:
  `/{locale}/blog/rss.xml`.

## Independent verification

Executed in the isolated release worktree before the initial production
release:

| Check | Result |
| --- | --- |
| `pnpm --filter @sf/marketing typecheck` | passed |
| `pnpm --filter @sf/marketing lint` | passed |
| `pnpm --filter @sf/marketing build` | passed; 24 routes generated |
| `pnpm test --reporter=dot` | passed |
| `pnpm secrets:scan` | passed; associated redaction tests: 4 files / 75 tests |
| Local production-build smoke | passed: English/Chinese pages, blog routes, 13 migrated URLs, RSS, sitemap, robots, contact and disabled lead APIs |
| Vercel Git production build | Ready, exact `1e393e24c9583460edf4b2e3683de7ba5bdac053` |
| Production-domain HTTP smoke | passed: `/en`, `/zh`, both blog indexes, representative English/Chinese migrated posts, both RSS feeds, sitemap, robots, contact page, and all three disabled lead APIs |

Production RSS includes `what-is-growth-automation`; the production sitemap
includes `marketing-attribution-models`; the rendered English home page exposes
the correct RSS discovery link. Both `gengrowth.ai` and `www.gengrowth.ai`
returned HTTP 200 during the production-domain check.

## Follow-up constraints

Do not re-enable database-backed lead capture until the active Supabase schema,
RLS, abuse protection and intended email sender have been migrated and verified.
That work is deliberately outside this public-site release. The existing product
app also remains out of scope.
