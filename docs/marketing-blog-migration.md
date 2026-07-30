# GenGrowth legacy blog migration

This manifest records the one-way content migration from the last preserved
`gengrowth-agents` `blog_posts` SQL seeds into the repository-backed public
GenGrowth blog. The importer is read-only with respect to Supabase: it reads
SQL files and writes Markdown files only. No database migration or write was run.

## Input provenance

- `gengrowth-agents/supabase/seed.sql` — SHA-256 `cab5d4204edd16329816ff240666c77d82a929870d77e55c64a59144e5b8accd`
- `gengrowth-agents/supabase/seed-blog.sql` — SHA-256 `54b592514f7f245b76424e780ada4c2599f93651a5fc081e7232244b8107735c`
- `gengrowth-agents/supabase/seed-blog-w25.sql` — SHA-256 `5e8b1faa52c187e2a805bb749bd74ed5bdc8de1999cd89136417897945f3c508`

## Result

- Legacy rows discovered: **17**
- Published legacy rows discovered: **15**
- Markdown articles generated: **17** (including non-published content)
- `en`: **10** article(s)
- `zh`: **7** article(s)
- Every migrated source row is represented by the same `locale + slug` route.
- The legacy HTML body is retained inside Markdown files for lossless first release;
  the existing runtime sanitizes it through the same allow-list used for GFM output.
- Missing legacy cover fields use the existing public `/images/og-default.svg` asset.

## Generated routes and hashes

| Route | Status | Markdown SHA-256 |
| --- | --- | --- |
| `/en/blog/astrologywiki-case-study` | `published` | `e82190aa759c47f0e74a634ea4893357469dedb1880effdf162f80ba4c894c08` |
| `/en/blog/growth-experiment-playbook` | `published` | `51c0591bc4b5fe43f6f967e0297d8769a67b9e6766b151ff6230dea6ba704ed8` |
| `/en/blog/marketing-attribution-models` | `published` | `984fd45f1528427ffccf1ca967ddd3be876a2119e4eef3a189d1af12113adec4` |
| `/en/blog/organic-traffic-growth-case-study` | `published` | `511afbeb9bf0f3d03b34480550ab5304b1d9cac580dad8ae8786a8728575b159` |
| `/en/blog/programmatic-seo-at-scale` | `published` | `17cb56bcb6d34db7c3664a66d6a4d57cdf4e4188566cf4fef914a82344dcc2c2` |
| `/en/blog/seo-content-clusters-draft` | `draft` | `8c829a446a3a08820005ad92fc765941f2273f3414f5b6f2f60d418e1faae47e` |
| `/en/blog/social-first-probe-week-1` | `published` | `94de0899d061b0833e7f5187d7c6ce0093e3381e385bb8d68784f6321ee894cd` |
| `/en/blog/social-first-week-1` | `published` | `0312f882a197d824d05abde01cf05e3898573572e42b7e75edc01ea633544661` |
| `/en/blog/what-is-growth-automation` | `published` | `6f4a1150896e16e7542ab23893dbbe6cf8cd158f1fbea153d55b677dd63045d5` |
| `/en/blog/white-label-keyword-research` | `published` | `6f5dc0907f78a7404fb0a2d0cd67e0210b13142c225a65fd9abdfe4ac4957035` |
| `/zh/blog/astrologywiki-case-study` | `published` | `9f7ae1d685c175e8fb77f879409e24123afee345e0b5a0f0f493f382a498b061` |
| `/zh/blog/growth-experiment-playbook` | `published` | `8383f77454837bc7a0cad6b9cbfa625ab8b9fa4947fec45d11624ebcc33284e0` |
| `/zh/blog/keyword-gap-analysis-guide-draft` | `draft` | `9dedc122f71c61cf048b8e9f5a8a6e5ee380813adab6519e959c0cb86fb924d8` |
| `/zh/blog/marketing-attribution-models` | `published` | `d04e41fe2e5ce0f53a8dc570ae3ff20809a1b6482338b9e8827e623149475ea8` |
| `/zh/blog/programmatic-seo-at-scale` | `published` | `ce96a71088db230ba35c4118a4df0d4d52da07c7d068127daf91710fe298a3cd` |
| `/zh/blog/social-first-week-1` | `published` | `6945f3298c460ce6002a568cedef79c6dcb0eb7f125ac76c237d1f0c9b7dd239` |
| `/zh/blog/what-is-growth-automation` | `published` | `cd715334fb56cc2219f5b5a19caaa815bf6c34e4b3b7d43ee15cb20acee0f971` |

## Cutover rule

Keep `BLOG_LEGACY_SUPABASE_ENABLED=true` only while an independently verified
legacy database still has published rows not represented above. After URL parity,
rendering, image, RSS and sitemap checks pass on production, set it to `false`
and remove the read-only bridge in a separate, reviewed change.
