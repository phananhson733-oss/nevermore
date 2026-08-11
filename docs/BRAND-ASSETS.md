# Brand assets

Every logo file in `apps/marketing/public` and `apps/web/public` comes from the
Direction A flat kit, which lives outside this repo:

```
gengrowth-wiki/docs/06-shared/assets/brand/logo-v2-flat/
```

That directory's `ASSET_INDEX.txt` is the brand's own spec sheet — palette, size
rules, clear space, and the "do not substitute Direction B" rule. Read it before
changing anything here. The kit's `logo-v2-flat-b-reference/` sibling is an
explicitly rejected direction; do not take files from it.

Because the kit is a separate repository there is no build step wiring the two
together. These files were copied in by hand, so this page records which kit file
each one came from, and the guard tests in `apps/marketing/src/app/layout.test.ts`
and `apps/web/src/app/layout.test.ts` read the shipped bytes rather than trusting
a file name.

## What each target is

| Target | Kit source |
| --- | --- |
| `apps/{marketing,web}/public/favicon.ico` | `favicon/favicon.ico` (16 + 32 + 48 frames) |
| `apps/{marketing,web}/public/icon-32x32.png` | `favicon/favicon-32x32.png` |
| `apps/{marketing,web}/public/icon-192x192.png` | **derived** — `mark/logo-mark-gradient-256.png` resampled to 192 |
| `apps/{marketing,web}/public/apple-touch-icon.png` | `app/app-icon-180x180.png` |
| `apps/marketing/public/images/logo-mark.png` | `mark/logo-mark-gradient-1024.png` |
| `apps/marketing/public/images/logo.png` | `mark/logo-mark-gradient-on-light-1024.png` |
| `apps/marketing/public/images/og-default.png` | **derived** — the existing OG card with the real mark composited into its brand row |
| `apps/web/public/images/logo-mark.png` | `mark/logo-mark-gradient-512.png` |

## Why the two derived files are derived

**`icon-192x192.png`.** The kit ships transparent marks at 16/32/48/64/128/256/
512/1024/2048 and an opaque 192 under `app/`, but the 192 favicon slot wants
alpha. It is resampled from the 256 tier rather than the 1024 master because the
kit deliberately tightens the mark's clear space as sizes drop — the 32px file
fills 81% of its canvas where the 1024 fills 63% — so downscaling from the master
would land at the wrong optical weight.

**`og-default.png`.** The OG card is our own layout, not a kit file. Its brand row
carried a plain teal disc standing in for the logo; the mark now sits there
instead, cropped to its ink and scaled to 32px wide so it matches the wordmark's
weight. Everything else on the card is untouched.

## Constraints the tests enforce

- `apple-touch-icon.png` and `images/logo.png` carry **no alpha channel**. iOS
  composites a transparent Apple Touch icon onto black, and Google renders the
  Organization logo on surfaces we do not control — its guidance is to check the
  logo against white, which is why that slot takes the on-light build and not the
  bare mark the site chrome uses.
- `icon-32x32.png`, `icon-192x192.png` and both `logo-mark.png` files **are**
  transparent. The web app's tile paints the brand navy behind its copy itself,
  in both the paper and ink themes.
- The marketing header and footer must not round-crop the mark. The old crop
  existed to hide a white square in the previous file; this mark's arrow runs out
  to the corner of its canvas, so a round crop would cut the arrow off.
- `favicon.ico` is a real Windows icon whose directory contains the 32x32 frame
  the root metadata advertises.

## Not wired up

- **No web app manifest.** Neither app ships a `manifest.webmanifest`, so the
  kit's `app/app-icon-maskable-512x512.png` has nowhere to go yet. Adding one is
  the prerequisite, not copying the file.
- **Transactional email.** `apps/marketing/src/lib/email.ts` sends plain HTML with
  no logo. The kit's `email/` signatures need a publicly reachable URL before they
  can be used there.
