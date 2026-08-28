# Marketing Account Menu Upgrade and Website Add Recovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the approved locale-aware Upgrade CTA and make successful website creation readable when PostgreSQL returns native `timestamptz` strings.

**Architecture:** Keep the Pricing CTA inside the existing desktop/mobile account components and reuse `localePath`. Normalize database timestamps only inside the Marketing website store, before strict DTO parsing; keep invalid database values fail-closed.

**Tech Stack:** Next.js 16, React 19, next-intl, Zod, Supabase/PostgREST, Vitest, Playwright.

**Permission boundary:** The implementation was first completed as local-only
work. The user then authorized commit, push, PR creation, and a local
fast-forward integration. Do not merge the remote PR, deploy, migrate, or write
production user data without a separate authorization.

---

### Task 1: Reproduce PostgreSQL timestamp parsing failure

**Files:**

- Modify: `apps/marketing/src/lib/account-websites/store.test.ts`
- Modify: `apps/marketing/src/lib/account-websites/store.ts`

1. Add a store test whose website, draft, and snapshot rows use PostgreSQL
   spellings such as `2026-08-28T07:30:41.615548+00:00`.
2. Assert that the public `WebsiteDetails` values are canonical `.615Z` strings.
3. Add a malformed timestamp case and assert `malformed_store_response` without
   logging the raw value.
4. Run:

   ```bash
   pnpm exec vitest run --project unit \
     apps/marketing/src/lib/account-websites/store.test.ts
   ```

   Expected RED: the native PostgreSQL timestamp is rejected.
5. Add one narrowly scoped helper that reads a required timestamp, parses it,
   and returns `new Date(parsed).toISOString()`; throw on invalid input.
6. Use it for website `created_at`/`updated_at`, draft `updated_at`, and snapshot
   `confirmed_at`, including historical snapshot resolution.
7. Rerun the focused test; expect GREEN.

### Task 2: Specify the Upgrade CTA and removed hint

**Files:**

- Modify: `apps/marketing/src/components/auth/account-menu.test.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`

1. Replace the assertion for `560 left to earn while testing` with assertions
   that the text is absent and `Upgrade` is present.
2. Assert the English desktop Upgrade link is `/pricing` and is a keyboard
   menuitem before the full Credits destination.
3. Assert the CTA still renders when `balance` is unavailable.
4. Assert the mobile Upgrade link is present before Credits and calls the
   existing navigation callback.
5. Run the account-menu test and confirm RED.
6. Remove only `account.menu.welfareRemaining` from both catalogs and add
   `account.menu.upgrade: "Upgrade"` with EN/ZH key parity.

### Task 3: Implement the desktop and mobile account summary

**Files:**

- Modify: `apps/marketing/src/components/auth/account-menu.tsx`

1. Replace the desktop balance/hint stack with one compact flex row.
2. Render the balance as a bordered mono pill when available.
3. Render a high-contrast `Upgrade` `Link` beside it using
   `localePath(locale, "/pricing")`, the existing focus-visible treatment, and
   `closeMenu(false)`.
4. Add the same balance-plus-Upgrade row to `AccountSummaryMobile`, using its
   `onNavigate` callback.
5. Keep the existing full Credits row and every approved destination.
6. Rerun the account-menu test; expect GREEN.

### Task 4: Verify the full affected behavior

**Files:**

- Test: `apps/marketing/src/components/auth/account-menu.test.tsx`
- Test: `apps/marketing/src/components/account/add-website-dialog.test.tsx`
- Test: `apps/marketing/src/lib/account-websites/store.test.ts`
- Test: `apps/marketing/src/app/api/account/websites/route.test.ts`

1. Run the four focused unit files.
2. Run Marketing typecheck.
3. Run ESLint over the changed TS/TSX files.
4. Run `pnpm verify:docs` and `git diff --check`.
5. Run a clean Marketing production build.
6. If the provider-free standalone build is available, run the account settings
   Playwright spec and confirm the menu CTA plus add/create response flow.
7. Review the final diff for unrelated changes and report the existing
   production `astrologywiki.com` row as preserved, not recreated.
