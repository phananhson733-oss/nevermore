# Marketing Account Websites Local Baseline

**Captured:** 2026-08-27

**Worktree:** `/Users/wzb/Code/nevermore/account-websites-20260827`

**Branch:** `feat/marketing-account-websites-20260827`

**HEAD and `origin/main`:** `806c6e04c109ba57b18b4d1e331e13b3741e17ae`

## Permission boundary

The user authorized local implementation. The current request does not authorize
external source upload, commit, push, PR, deploy, hosted migration, production
configuration, or real-user-data operations.

Repository `AGENTS.md` requires an explicit choice between a sanitized external
ChatGPT Pro review and a Codex-only exemption before production implementation.
The user subsequently selected the Codex-only exemption (option A). No source
may be uploaded externally; local implementation may proceed under the remaining
Git, deploy, migration, and production restrictions.

## Toolchain

```text
Node.js: v24.12.0
pnpm: 10.32.1
PostgreSQL client: 18.3
PostgreSQL 127.0.0.1:5432: accepting connections
```

## Focused current-surface unit baseline

Command:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/auth/account-menu.test.tsx \
  apps/marketing/src/lib/auth/use-account.test.tsx \
  apps/marketing/src/app/api/auth/profile/route.test.ts \
  apps/marketing/src/components/agents/agent-profile.test.ts \
  apps/marketing/src/lib/agents/profile-refresh-contract.test.ts \
  apps/marketing/src/lib/agents/profile-refresh-handler.test.ts \
  apps/marketing/src/components/agents/agent-workbench.test.tsx \
  'apps/marketing/src/app/[locale]/account/credits/page.test.ts'
```

Result: **PASS — 8 files, 175 tests.**

## Marketing static/build baseline

`pnpm --filter @sf/marketing typecheck`: **PASS**.

`pnpm --filter @sf/marketing build`: **PASS**. Next.js generated 260 static
pages and retained `/[locale]/account/credits` as a dynamic route.

`pnpm --filter @sf/marketing lint`: **FAIL — 4 existing errors**:

- `apps/marketing/src/components/tools/competitor-keyword-gap-tool.test.tsx:282` — unused `pressEnter`;
- `apps/marketing/src/components/tools/on-page-check-list.tsx:11` — unused `OnPageCheck`;
- `apps/marketing/src/lib/agents/draft-handler.ts:137` — unused `PLACEHOLDER`;
- `apps/marketing/src/lib/agents/draft-handler.ts:147` — `no-control-regex`.

These files were unchanged at baseline. They are not evidence against the new
feature unless the implementation touches or worsens them. Final verification
must still report the repository-wide lint result accurately.

## Marketing SQL baseline

A disposable local database named
`signalframe_codex_account_websites_baseline_20260827` was created, used only for
the existing Credits SQL suite, and dropped after the command.

Command:

```bash
MARKETING_TEST_DATABASE_URL=postgresql://wzb@127.0.0.1:5432/signalframe_codex_account_websites_baseline_20260827 \
  pnpm exec vitest run --project marketing-sql \
  apps/marketing/src/lib/credits/credits-sql.integration.test.ts
```

Result: **PASS — 1 file, 27 tests.**

## Marketing browser baseline

Command:

```bash
pnpm --filter @sf/marketing test:e2e -- agents.spec.ts locale-switch.spec.ts
```

Result: **FAIL before browser execution.** Playwright's default discovery reads
`apps/marketing/e2e/fixtures/agent-envelope.test.ts`, which is a Vitest test,
then fails inside Vitest's `describe()` because no Vitest runner config exists.
The implementation plan therefore includes a narrow Playwright `testIgnore` or
`testMatch` correction before adding the new account-settings browser spec.

## Git state after baseline

Only planning/evidence documents are untracked. No product source, migration,
test, lockfile, build configuration, or generated authority file is modified.
