# P0-2 Internal Link Audit — ChatGPT Pro external engineering task

Date: 2026-07-30

Owner and final validator: Codex

External reviewer: ChatGPT Pro

Repository baseline: `9c60184ded41e099e998feedb3f76128affac89a`

Branch at packaging: `codex/pre-v03-local-preservation-20260727`

## Source package record

- Package: `.gstack/p02-external-review/gengrowth-p02-source-20260730.zip`
- Files: 33
- Bytes: 224,685
- SHA-256: `731e332ec45aa272d7c4e2e914ac39992f727dd0a7ddf4cbfe2229fbb6d253f9`
- Package scope: the applicable repository instructions, workspace and
  marketing package manifests, current tools index, current P0-4 public tool
  page/components, shared SEO JSON-LD helpers, current English and Chinese
  message catalogs, marketing styles/configuration, P0-4 E2E reference, and the
  three P0 product documents plus the P0-2 static interaction prototype.
- Excluded: `.git`, dependencies, build/cache output, databases, logs, browser
  state, environment files, credentials, cookies, tokens, private keys and
  unrelated application code.
- Secret scan: explicit pattern scan for private-key headers, common OpenAI,
  GitHub and Google credential formats, Supabase service-role assignments,
  Resend key assignments and cookie assignments returned no matches. This was
  a bounded pattern scan, not proof that arbitrary prose cannot contain a
  secret.
- Working tree note: the baseline had pre-existing, uncommitted changes,
  especially an in-progress P0-4 implementation and unrelated app work. The
  attached files are the current working-tree versions where applicable.

## External review delivery record

- Conversation:
  <https://chatgpt.com/c/6a6b3fe2-cae0-83e8-a056-b7e71300f620>
- The in-app browser rejected the local ZIP attachment upload. ChatGPT Pro did
  **not** receive or access the ZIP and was explicitly told not to claim that it
  did.
- The full engineering task and the essential current-source excerpts were
  pasted into the conversation instead. The review is therefore an
  excerpt-based architecture and implementation review, not an independent
  checkout, build, test run, repository scan or verification of the recorded
  package hash.
- Final re-review after Codex supplied the local correction and gate evidence:
  no evidenced remaining P0/P1 issues; advisory status `Accept`. The local
  acceptance and disposition are recorded in
  `2026-07-30-p02-internal-link-audit-final-acceptance.md`.

## Background and goal

Implement the first production-quality front-end slice for GenGrowth public
tool P0-2 at `/{locale}/tools/internal-link-audit`. The page belongs to
`gengrowth.ai`, not `app.gengrowth.ai`. It is one of five peer public tools and
must not be presented as a parent shell or an authenticated workspace.

The product is an internal-link audit: a user enters a public site URL and sees
an internal-link graph plus prioritized orphan-page, thin-link, deep-page and
broken-link findings. For this milestone, fixed mock results are explicitly
allowed. The UI must plainly disclose that it did not crawl the submitted
website, did not connect Search Console, and did not save data. The product
shape should nevertheless be ready for a later real crawler contract.

## Current architecture and non-breakable boundaries

- Next.js 16.2 App Router, React 19, TypeScript strict, `next-intl`, Tailwind 4.
- Public site and anonymous tool routes live in `apps/marketing`.
- Reusable public-tool contracts and deterministic logic belong in
  `packages/public-tools`; common SSRF-safe public collection belongs in
  `packages/sources`.
- Public Tools must not import `apps/web`, worker, database, queue, authenticated
  project/workspace code, internal OpenAPI or production runtime configuration.
- V0 is anonymous and non-persistent. A CTA may link to `app.gengrowth.ai`, but
  this change must not implement auth, database writes, background jobs or
  production crawling.
- Preserve all current P0-4 working-tree changes. Do not rewrite, revert or
  “clean up” unrelated files.
- The authoritative route is `/tools/internal-link-audit`; the earlier
  `/tools/internal-link-map` and `/tools/internal-link-checker` names are
  reference-only.
- P0-2 is crawler-shaped and does not use GSC OAuth. Do not add Search Console
  authorization.
- The P0-2 landing-page copy document is the content authority; the site
  architecture document is the route/template authority; the prototype is a
  visual and interaction reference only.

## Required product surface

1. Add P0-2 to the public `/tools` index.
2. Add localized English and Chinese route
   `/{locale}/tools/internal-link-audit`.
3. Provide correct localized metadata and canonical/hreflang behavior through
   the existing SEO helper.
4. Emit `SoftwareApplication`, `FAQPage`, `HowTo` and `BreadcrumbList` JSON-LD
   with page-appropriate content.
5. Build an accessible interactive URL form. This milestone may simulate
   analysis entirely in the client and return a fixed 42-page demo dataset.
6. Make demo status persistent and unmistakable before and after submit.
7. Present a useful result command deck:
   - crawl/sample coverage and evidence boundary;
   - summary metrics;
   - filterable, accessible internal-link graph;
   - prioritized orphan/thin/deep/broken findings;
   - four-part Observation / Diagnosis / Recommendation / Artifact narrative;
   - node/finding detail interaction with evidence, counter-evidence,
     recommended source page, anchor text and verification step;
   - non-functional export/project actions must be honestly labelled as preview
     or omitted.
8. Include the page’s authoritative methodology, limitations, comparison,
   use-case, 10-item FAQ, related tools/reading and final CTA content without an
   unresolved `[X]` production crawl limit or unverified customer claims.
9. Preserve the current charcoal/terracotta GenGrowth visual language while
   making the link graph the distinctive product moment.
10. Support keyboard use, visible focus, semantic headings, non-colour status
    labels, `aria-live`, reduced motion and a usable 390 px layout.

## Requested external deliverables

Return:

1. A concise architecture and UX review with any contradictions found in the
   supplied documents.
2. A file-by-file implementation plan.
3. A complete minimal patch or complete replacement contents for every proposed
   file. Avoid pseudocode.
4. Test additions covering English and Chinese route rendering, form/demo
   transition, filters, details keyboard behaviour, demo disclosure, JSON-LD,
   responsive assumptions and absence of real network/persistence.
5. A list of assumptions, risks and intentionally deferred real-crawler work.

## Tests and acceptance gates

The final Codex implementation will independently run, as applicable:

- formatter/checks for changed files;
- `pnpm --filter @sf/marketing typecheck`;
- `pnpm --filter @sf/marketing lint`;
- relevant unit tests;
- marketing production build;
- relevant Playwright E2E;
- `pnpm verify:public-tools-boundary`;
- `pnpm secrets:scan`;
- `git diff --check`.

Acceptance requires both locales, correct metadata/JSON-LD, a genuinely usable
mock interaction, no hidden production claims, no external network request on
submit, no storage/persistence API use, no forbidden Public Tools dependency,
and no regression to P0-4.

## Forbidden operations and claims

- Do not assume access to the local repository, private GitHub, Vercel,
  Supabase, production environment, current browser session or user accounts.
- Do not ask for or include secrets.
- Do not deploy, migrate a database, change online configuration, commit, push
  or create a pull request.
- Do not claim tests were run unless they were actually run in an environment
  supplied to you; attachment review alone is not test execution.
- Do not represent mock data as a real crawl, real Search Console evidence or a
  production validation.
- Do not expand the milestone into a real crawler, auth flow, background job,
  database persistence, CSV export backend or App project integration.
