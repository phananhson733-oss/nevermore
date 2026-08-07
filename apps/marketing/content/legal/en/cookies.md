---
title: Cookie Policy
version: 1.0
effectiveDate: 2026-08-07
status: draft
---

This page lists every cookie GenGrowth sets, what it is for, and how long it
lasts. It is the companion to our [Privacy Policy](/privacy).

## Strictly necessary

These make the site work. Without them sign-in, the Search Console connection,
and the free tools cannot function.

| Cookie | Purpose | Lifetime |
| --- | --- | --- |
| `sb-<project>-auth-token` | Your signed-in session. Scoped to `gengrowth.ai` so one sign-in covers both the marketing site and the app. HTTP-only. | Until sign-out or expiry |
| `gg_onetap` | A single-use nonce that binds a Google sign-in to the page that started it, so a captured token cannot be replayed. Encrypted, HTTP-only. | 10 minutes |
| `gg_oauth_tx` | Holds the in-flight Google authorisation exchange. Encrypted, HTTP-only. | 10 minutes |
| `gg_id` | Remembers which Google identity authorised Search Console, so you are not asked again on every visit. Encrypted, HTTP-only. | 30 days |
| `gg_gsc` | Your Search Console **read-only** access token. Encrypted, HTTP-only, and sent only to `/api` paths. | Until the token expires |
| `gg_sites` | The list of Search Console properties you granted, so the page can offer them. Encrypted, HTTP-only. | Same as `gg_gsc` |
| `NEXT_LOCALE` | Your language choice. | 1 year |

The `gg_*` cookies are sealed: each purpose has its own derived key, so a value
issued for one cannot be presented as another.

## Analytics

| Cookie | Purpose | Lifetime |
| --- | --- | --- |
| `_ga` | Google Analytics 4 — distinguishes visitors. | 2 years |
| `_ga_71TET2Y97Q` | Google Analytics 4 — maintains session state for our property. | 2 years |

## What we do not set

We set no advertising cookies, no cross-site tracking pixels, and no third-party
cookies beyond Google Analytics and the cookies Google itself sets while you are
signing in on `accounts.google.com`.

## Managing cookies

You can clear or block cookies in your browser settings. Blocking the strictly
necessary cookies will prevent sign-in and the Search Console tools from
working; the free public tools will continue to function.

To opt out of Google Analytics specifically, you can install Google's
[opt-out browser add-on](https://tools.google.com/dlpage/gaoptout).

To revoke our Search Console access, use your
[Google account permissions page](https://myaccount.google.com/permissions).
This takes effect immediately, regardless of any cookie still in your browser.

## Changes

We will update the version and effective date at the top of this page when the
set of cookies changes.
