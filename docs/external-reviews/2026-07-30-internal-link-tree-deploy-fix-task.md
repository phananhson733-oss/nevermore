# GenGrowth internal-link tree and deployment hardening review

Date: 2026-07-30

## Baseline

- Repository: `phananhson733-oss/nevermore`
- Baseline commit: `4860f3e4217255b7e72b0c0d4c2d1ad01edf3121`
- Review package: `artifacts/external-review/2026-07-30-internal-link-tree-deploy-fix.zip`
- Package size and SHA-256: supplied by the orchestrator with the uploaded
  archive and recorded outside this self-contained package.
- Product surface: `https://gengrowth.ai/{locale}/tools/internal-link-audit`
- Marketing project root: `apps/marketing`
- Application project root: `apps/web`

The supplied files include the current uncommitted candidate changes on top of
the baseline commit.

## Background and goal

The public internal-link audit already performs a real, bounded, same-origin
static-HTML crawl and returns collected nodes, observed directed edges, and
evidence-bounded findings. The previous result view technically rendered a
tree, but 20–25 page reports remained hard to scan: every row repeated several
technical badges, branches could not be collapsed, and columns did not align.

The candidate implementation changes only the presentation layer into a
compact, collapsible file-browser-style hierarchy. It keeps the graph facts and
tree derivation unchanged.

A production smoke test also found `POST /api/consent` returning 500. Evidence
shows the marketing Vercel project has no project or linked shared Supabase
variables, and the new Supabase production project does not currently contain
`public.consent_events`. Database migration and production environment changes
are explicitly out of scope. The candidate therefore treats server-side
consent telemetry as optional: browser cookie preferences remain authoritative,
and the API returns `202` with `recorded:false` when persistence is not
configured or the optional table is unavailable.

Vercel’s built-in “Skip deployments when there are no changes to the root
directory or its dependencies” setting has been enabled separately for both
the `apps/marketing` and `apps/web` projects. No application product code was
changed for that setting.

## Architectural boundaries

- Do not change the crawl engine, URL safety boundary, rate limits, report
  schema, or graph-to-tree derivation unless a concrete correctness defect is
  proven.
- Do not add mock data or a production mock path.
- Do not add a database migration, modify production data, or require Supabase
  credentials for the public marketing site.
- Do not expose internal stop codes, database messages, secrets, or service-role
  credentials.
- Do not modify `app.gengrowth.ai` product behavior.
- A tree is an interpretation of a directed graph. Cross-links must remain
  represented as secondary evidence rather than being silently discarded.
- Mobile output must not create horizontal page overflow.

## Review scope

Please independently review:

1. The compact hierarchy and its branch/global expand-collapse interactions.
2. Search and kind filters, especially whether matching descendants remain
   visible with their ancestors.
3. Accessible names, focus behavior, touch targets, semantic HTML, and mobile
   layout.
4. Whether displayed parent/child, child counts, inbound/outbound counts,
   crawl depth, and secondary inbound counts remain truthful.
5. The consent fallback’s semantics and security:
   - missing environment values -> `202`, `recorded:false`;
   - missing PostgREST table (`PGRST205`) -> `202`, `recorded:false`;
   - all other database errors remain sanitized 500 responses;
   - successful inserts remain 201 responses.
6. Whether tests cover the highest-risk behavior and whether any assertions now
   validate implementation trivia instead of user-observable behavior.

## Required deliverables

- A severity-ordered review report with exact file and line references.
- An explicit verdict: pass, pass with non-blocking issues, or fail.
- For every blocking issue, a minimal complete patch or precise code change.
- A list of checks actually executed. Do not claim production, database, or
  browser verification that you did not personally perform.
- A short residual-risk section.

## Required tests

At minimum, inspect or execute the closest available equivalents of:

```text
pnpm --filter @sf/marketing typecheck
pnpm --filter @sf/marketing lint
pnpm exec vitest run --project unit \
  apps/marketing/src/components/tools/internal-link-audit-tree.test.ts \
  apps/marketing/src/components/tools/internal-link-audit-tool.test.ts \
  apps/marketing/src/app/api/consent/persistence.test.ts \
  apps/marketing/src/app/api/consent/route.test.ts
pnpm --filter @sf/marketing build
pnpm --filter @sf/marketing exec playwright test \
  e2e/internal-link-audit.spec.ts --config=playwright.config.ts
```

## Acceptance criteria

- A 24-page real report is materially easier to scan as a hierarchy.
- Branches can be expanded and collapsed without changing the selected page or
  underlying report.
- Search reveals matching nodes and the ancestors needed to understand their
  location.
- Desktop columns align; mobile rows remain readable without document-level
  horizontal overflow.
- Normal page rows avoid low-value repeated badges; issue kinds and cross-link
  evidence remain visible.
- The API never reports persistence success when no event was recorded.
- No secret, credential, migration, production-data operation, push, or deploy
  is introduced or claimed by the reviewer.
