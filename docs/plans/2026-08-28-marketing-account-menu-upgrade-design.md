# Marketing Account Menu Upgrade and Website Add Recovery Design

**Status:** Approved by the user on 2026-08-28. After local verification the
user authorized commit, push, PR creation, and a local fast-forward integration.
Remote PR merge, migration, and deployment remain unauthorized.

**Initial baseline:** `origin/main` at
`e6669a0ec3f547b602ac8d60a899196b30747b1e`. Before final verification the
worktree was fast-forwarded to the non-overlapping current main
`6c21f1b93cb9a60a42bda58e9c4ccdffdb9ffa5b`.

## Goal

Remove the testing-credit remainder hint, place a compact `Upgrade` action next
to the account balance like the supplied competitor reference, route it to the
current locale's Pricing page, and fix the production website-add false failure.

## Approved menu behavior

Desktop and mobile use the same identity summary pattern:

- account name and email remain unchanged;
- the balance is a compact bordered pill when available;
- `Upgrade` is a neighboring high-contrast pill link;
- English and Chinese both use the short label `Upgrade`;
- English links to `/pricing`; Chinese links to `/zh/pricing`;
- activating the link closes the account menu/sheet through the existing
  navigation callback;
- the Credits destination remains a real menu row;
- Integrations and Docs remain absent.

The menu no longer renders `account.menu.welfareRemaining`. The welfare amount
continues to exist in the Credits account page and API; this change removes only
the avatar-menu prompt.

The visual direction is restrained and native to the current GenGrowth panel:
compact neutral pills, current typography, current focus ring, no new gradient,
font, animation, component dependency, or pricing state.

## Website-add failure root cause

The production request did not fail at authentication or the RPC write:

- PostgREST exposes the current six-argument `marketing_add_website` RPC;
- the function is owned by `postgres`, is `SECURITY DEFINER`, and has the
  expected fixed configuration;
- production contains the newly inserted `astrologywiki.com` website row;
- no draft or snapshot was written.

The failure occurs when the route reads the created website back. PostgreSQL /
PostgREST returns `timestamptz` values such as
`2026-08-28T07:30:41.615548+00:00`. `WebsiteDetails` intentionally accepts only
canonical JavaScript ISO timestamps such as `2026-08-28T07:30:41.615Z`.
`store.ts` currently forwards the database string without normalization, so the
strict parser returns `malformed_store_response` after the successful insert.

## Fix boundary

Normalize database scalar timestamps at the server store boundary before they
enter the strict DTO parser:

- website `created_at` and `updated_at`;
- draft `updated_at`;
- snapshot `confirmed_at` in current and historical reads.

Invalid or unparseable database timestamps must still fail closed. Profile JSON
timestamps are not changed; they already belong to the canonical application
contract.

No production retry, cleanup, forced overwrite, duplicate delete, or real
provider operation belongs to this local change. The existing production
website row is preserved.

## Verification

- RED/GREEN store tests with real PostgREST timestamp spelling;
- account-menu desktop and mobile tests for the removed hint, Pricing href,
  activation, keyboard order, and credits-disabled state;
- focused route/dialog/store tests proving a created website response parses;
- changed-file lint and Marketing typecheck;
- provider-free Marketing build and account-menu/browser checks if the local
  production bundle is available;
- no production write is used to verify the fix in this turn.
