# GenGrowth marketing blog local-content review

## Purpose

Move the public GenGrowth blog's canonical article source from Supabase
`blog_posts.content` HTML to repository-backed Markdown with independent image
URLs, while preserving the existing public routes, SEO surfaces and a
read-only, removable legacy bridge.

## External review record

- External engineer: ChatGPT Pro (advisory/design and patch review only)
- Conversation: <https://chatgpt.com/c/6a6b079d-a8dc-83e8-8f81-1df06cc07a4f>
- Task created: 2026-07-30, Asia/Shanghai
- Source baseline branch: `codex/pre-v03-local-preservation-20260727`
- Source baseline commit: `41f77d7740e01d9f1dfc56b49a2239bef9f9cdf7`
- Source archive: temporary local review attachment `source.zip` (not checked
  into Git)
- Archive members: 307
- Archive size: 603,560 bytes
- SHA-256:
  `98fd676d762d3bdf10f0316c2a92ce3b8471d2a9da382691356f5f7b7cbcf437`

The attachment contained only the marketing app source necessary to review the
blog data layer, routes, RSS, sitemap, configuration and existing image asset.
It excluded `.git`, `node_modules`, build outputs, caches, logs, environment
files and credentials. Archive entry inspection found no excluded path. A
targeted credential signature scan found no match, and the repository command
`pnpm secrets:scan` passed before upload (including 74 redaction tests).

## External observations independently confirmed by Codex

1. Blog list/detail/category, RSS and sitemap had split data sources; the last
   two queried Supabase directly.
2. A Supabase error could silently display mock article data at a canonical URL.
   That is unsafe for a public SEO site because an outage may serve unrelated
   content under a real permalink.
3. Existing `marked`, `sanitize-html` and `zod` dependencies are sufficient for
   a strict Markdown implementation. No new dependency or lockfile change is
   needed for this migration.

Codex accepted these observations only after source inspection and implemented
the local source, sanitization, legacy bridge and unified query surface in the
working tree. ChatGPT Pro has no access to local code, Supabase, deployment or
production systems; its output is not treated as deployment or test evidence.

ChatGPT Pro completed its advisory review in the linked conversation. Its final
recommendation matched the accepted architecture (strict Markdown,
`locale + slug` local precedence, explicit removable legacy reads, and unified
RSS/sitemap). No external patch was applied verbatim. Codex independently
fixed the concrete review findings below and did not need to request a
corrective external turn.

During independent implementation review, Codex also corrected two issues not
safe to leave for release: RSS now reads the unpaginated unified content list
before limiting itself to 20 entries (rather than inheriting the UI's 12-post
page size), and blog detail metadata supplies the article title only so the
root layout's title template does not duplicate the GenGrowth brand suffix.

## Independent acceptance evidence

Executed locally after implementation:

- `pnpm vitest run --project unit apps/marketing/src/lib/blog-content.test.ts`
  — 6 tests passed, including invalid calendar dates and protocol-relative
  image URLs.
- `pnpm --filter @sf/marketing typecheck` — passed.
- `pnpm --filter @sf/marketing lint` — passed.
- `pnpm --filter @sf/marketing build` — passed; standalone trace contains both
  Markdown source files under `apps/marketing/content/blog`.
- Local runtime with `BLOG_LEGACY_SUPABASE_ENABLED=false` — HTTP 200 for both
  locale article pages, English RSS and sitemap; the response body contains the
  Markdown-derived content, Article metadata and expected URLs.
- `pnpm typecheck`, `pnpm lint`, `pnpm test --reporter=dot` — passed (2,256
  unit tests in 200 files).
- `pnpm secrets:scan`, `pnpm verify:spec`, `pnpm openapi:lint`, and
  `pnpm contracts:check` — passed.
- `pnpm build` — marketing production build passed; the Web production build
  was also run separately and passed after its recursive output was truncated.

Not run: database integration tests or production E2E, because this change does
not write database data and no production deployment/credentials are in scope.
No deployment, database migration, online configuration change or production
data operation was performed.

## Commit and remote status

- Local source commit: recorded by `git rev-parse HEAD` in the final delivery.
  (This evidence file is amended into the same commit, so embedding that hash
  here would be self-referential.)
- An isolated worktree created from the locally recorded `origin/main`
  (`5960b6d2f67e84dca96c6a1261bdc7def1d11bc7`) cherry-picked cleanly as
  `6e10329`. Frozen-lockfile installation, 43 relevant unit tests, marketing
  typecheck, lint and production build passed there.
- Fetch and push to the configured `origin`
  (`https://github.com/xdawayer/nevermore.git`) both failed with `Repository
  not found`. No remote ref was changed. `production-origin` was intentionally
  not used: the authorization named remote main generally, but did not
  authorize redirecting a failed `origin` push to a differently named remote.
